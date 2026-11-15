// The in-app chat session (guide §5.6): the step loop that streams the model's replies, runs each `eval` tool call
// in the thread's DSL session, waits inside the step for the photographer's decision on proposals (ask mode),
// supports Stop, and keeps the conversation append-only (system prompt and tools frozen per thread, a mode change
// is an appended system message, per-turn context is a text block in the user message).
//
//   const chat = new ChatSession({ host: { evaluate, currentFrame, docs, setMode }, model });
//   chat.on((e) => …);            // ChatEvents; chat.state is the snapshot the panel renders
//   await chat.send('the skin looks green');
//   chat.decide(stepId, seqs, 'approve');   chat.stop();   chat.setMode('auto');   chat.revertStep(stepId);
//
// Safety (guide §5.3): the model reaches the darkroom only through `eval`, i.e. the DSL sandbox; its edits enter
// the document log only through the agent's door (agentSubmit: by 'agent', proposed in ask mode); mode changes,
// approvals and reverts are methods the UI calls, which nothing the model produces can reach.
import { toDiagnostic, type AgentMode, type Diagnostic, type EvalRequest, type EvalResult } from '@chromobench/contract';
import { describeMutation } from '@chromobench/dsl';
import { plan, transaction, type Edit, type Batch, type LogEntry, type Mutation } from '@chromobench/values';
import type { AgentDocs } from '../worker/client.ts';
import {
  ModelError, type ChatModel, type ContentBlockParam, type Effort, type MessageParam, type ModelReply, type ToolDef,
  type ToolResultBlockParam, type ToolUseBlock,
} from './model.ts';
import { EVAL_TOOL, MODE_TEXT, systemPrompt } from './prompt.ts';

export const MAX_STEPS = 10;

export interface ChatHost {
  /** Runs one eval in this thread's DSL session (DslWorkerClient.eval). Never rejects. */
  evaluate(req: EvalRequest, signal: AbortSignal): Promise<EvalResult>;
  /** The frame the photographer has open. */
  currentFrame(): string | null;
  /** The documents, the log and the mode (approvals, reverts, names). */
  docs: AgentDocs;
  /** Sets the mode; called only from setMode(), i.e. by the UI. */
  setMode(m: AgentMode): void;
}

export interface ChatSessionOptions {
  host: ChatHost;
  model?: ChatModel | null;
  effort?: Effort;
  /** The thread's system prompt (default: systemPrompt()). Frozen at the first send. */
  system?: string | (() => string);
  maxSteps?: number;
}

export interface LookView {
  n: number;
  caption: string;
  mime: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  numbers: Record<string, unknown>;
}

export interface ChangeView {
  seq: number;
  text: string;
}

export interface ApprovalView {
  frame: string;
  seqs: number[];
  changes: ChangeView[];
  /** what happened (after the decision) */
  outcome?: { approved: number[]; rejected: number[]; pending: number[] };
  /** refusals of the last Approve (E_STALE …): the card offers Apply anyway */
  problems?: Diagnostic[];
}

export type StepStatus = 'writing' | 'running' | 'waiting' | 'done' | 'error' | 'stopped' | 'not-run';

export type ChatItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; thinking: string; model?: string; fallback?: string }
  | {
      kind: 'step'; id: string; code: string; frame?: string; status: StepStatus; text?: string; looks: LookView[]; ms?: number;
      isError?: boolean; approval?: ApprovalView; applied?: { frame: string; seqs: number[] }; reverted?: boolean;
    }
  | { kind: 'notice'; id: string; level: 'info' | 'error'; text: string };

export type ChatStatus = 'idle' | 'thinking' | 'running' | 'waiting';

export interface ChatState {
  status: ChatStatus;
  items: ChatItem[];
  mode: AgentMode;
  effort: Effort;
  model: string | null;
  usage: { input: number; output: number; cacheRead: number };
  /** images shared with the model in this thread (privacy counter) */
  imagesSent: number;
}

export type ChatEvent =
  | { t: 'text'; delta: string }
  | { t: 'thinking'; delta: string }
  | { t: 'step.code'; step: string; partial: string }
  | { t: 'step.started'; step: string; code: string }
  | { t: 'step.done'; step: string; text: string; looks: LookView[]; ms: number; isError: boolean }
  | { t: 'approval'; step: string; pending: LogEntry[] }
  | { t: 'notice'; kind: 'fallback' | 'mode' | 'info'; detail: string }
  | { t: 'error'; kind: string; message: string }
  | { t: 'done'; stopReason: string; usage: { input: number; output: number; cacheRead: number } }
  | { t: 'changed' };

interface Waiter {
  step: string;
  resolve(how: 'decided' | 'later' | 'stopped'): void;
}

const text = (t: string): { type: 'text'; text: string } => ({ type: 'text', text: t });

export function toBase64(bytes: Uint8Array): string {
  const B = (globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } }).Buffer;
  if (B) return B.from(bytes).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** One line per mutation, for approval cards and decision notes; printer lights also in points. */
export function describeChange(m: Mutation, inverse?: Mutation): string {
  const text = describeMutation(m, inverse);
  if (m.op !== 'set' || !/\.logH$/.test(m.path) || !Array.isArray(m.value)) return text;
  return `${text} (${(m.value as number[]).map((v) => `${v >= 0 ? '+' : ''}${Math.round((v / 0.025) * 10) / 10}`).join(' / ')} pt)`;
}

/** The changes of log entries, one line each (prefixed with the frame when they span several). */
export function changesOf(entries: readonly LogEntry[]): ChangeView[] {
  const many = new Set(entries.map((e) => e.doc)).size > 1;
  return entries.flatMap((e) => e.tx.mutations.map((m, i) => ({ seq: e.seq, text: `${many ? `${e.doc}: ` : ''}${describeChange(m, e.tx.inverses[i])}` })));
}

export class ChatSession {
  readonly host: ChatHost;
  model: ChatModel | null;
  readonly maxSteps: number;
  private readonly systemSource: string | (() => string);
  private system: string | null = null;
  private tools: ToolDef[] | null = null;
  readonly messages: MessageParam[] = [];
  private carry: ToolResultBlockParam[] = [];
  /** the mode the model was last told about (context block or system message) */
  private toldMode: AgentMode | null = null;
  private sinceLast: string[] = [];
  private abort: AbortController | null = null;
  private readonly waiters = new Set<Waiter>();
  private readonly listeners = new Set<(e: ChatEvent) => void>();
  private ids = 0;
  private stopped = false;
  private readonly st: ChatState;

  constructor(o: ChatSessionOptions) {
    this.host = o.host;
    this.model = o.model ?? null;
    this.maxSteps = o.maxSteps ?? MAX_STEPS;
    this.systemSource = o.system ?? (() => systemPrompt());
    this.st = { status: 'idle', items: [], mode: o.host.docs.mode(), effort: o.effort ?? 'medium', model: this.model?.label ?? null, usage: { input: 0, output: 0, cacheRead: 0 }, imagesSent: 0 };
  }

  get state(): Readonly<ChatState> {
    this.st.mode = this.host.docs.mode(); // the photographer may change it anywhere in the studio
    return this.st;
  }
  get busy(): boolean {
    return this.st.status !== 'idle';
  }
  get started(): boolean {
    return this.system !== null;
  }
  /** The frozen system prompt (null before the first send). */
  get systemPrompt(): string | null {
    return this.system;
  }

  on(fn: (e: ChatEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(e: ChatEvent): void {
    for (const fn of this.listeners) fn(e);
    if (e.t !== 'changed') for (const fn of this.listeners) fn({ t: 'changed' });
  }
  private changed(): void {
    for (const fn of this.listeners) fn({ t: 'changed' });
  }
  private id(p: string): string {
    return `${p}${++this.ids}`;
  }
  private item<K extends ChatItem['kind']>(id: string): Extract<ChatItem, { kind: K }> | undefined {
    return this.st.items.find((i) => i.id === id) as Extract<ChatItem, { kind: K }> | undefined;
  }
  private notice(level: 'info' | 'error', t: string): void {
    this.st.items.push({ kind: 'notice', id: this.id('n'), level, text: t });
    this.changed();
  }

  // ── settings the photographer changes ──
  setModel(m: ChatModel | null): void {
    this.model = m;
    this.st.model = m?.label ?? null;
    this.changed();
  }
  setEffort(e: Effort): void {
    this.st.effort = e;
    this.changed();
  }
  /** Only the UI calls this: the agent cannot change its own mode. */
  setMode(m: AgentMode): void {
    if (m === this.st.mode) return;
    this.host.setMode(m);
    this.st.mode = m;
    this.emit({ t: 'notice', kind: 'mode', detail: m });
  }

  /** The per-turn context block (data, not instructions). */
  private contextBlock(): string {
    const f = this.host.currentFrame();
    const docs = this.host.docs;
    const v = f ? docs.get(f) : undefined;
    const lines = ['context:'];
    lines.push(`  frame: ${f ? `${f}${v?.name && v.name !== f ? ` (${JSON.stringify(v.name)})` : ''}` : '(none open)'} · mode ${docs.mode()}`);
    const pending = f && v && docs.log().has(f) ? docs.log().pending(f).length : 0;
    if (pending) lines.push(`  pending proposals: ${pending}`);
    const others = docs.ids().filter((x) => x !== f);
    if (others.length) lines.push(`  other open frames: ${others.slice(0, 12).join(', ')}${others.length > 12 ? ', …' : ''}`);
    if (this.sinceLast.length) lines.push(`  since your last turn: ${this.sinceLast.join('; ')}`);
    this.sinceLast = [];
    return lines.join('\n');
  }

  /** Sends the photographer's message and runs the turn to its end (or Stop). */
  async send(userText: string): Promise<void> {
    const t = userText.trim();
    if (!t || this.busy) return;
    const model = this.model;
    if (!model) {
      this.notice('error', 'Choose a model first: enter an API key, or pick the scripted demo.');
      return;
    }
    if (this.system === null) {
      this.system = typeof this.systemSource === 'function' ? this.systemSource() : this.systemSource;
      this.tools = [EVAL_TOOL];
    }
    this.stopped = false;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.st.items.push({ kind: 'user', id: this.id('u'), text: t });
    const turnStart = this.messages.length;
    const carried = this.carry;
    this.carry = [];
    const mode = this.host.docs.mode();
    this.messages.push({ role: 'user', content: [...carried, text(t), text(this.contextBlock())] });
    // a mode change since the model last heard: an appended system message (the frozen prompt is never edited)
    if (this.toldMode !== null && this.toldMode !== mode) this.messages.push({ role: 'system', content: MODE_TEXT[mode] } as MessageParam);
    const toldBefore = this.toldMode;
    this.toldMode = mode;
    try {
      await this.turn(model, signal, turnStart, carried, toldBefore);
    } finally {
      this.abort = null;
      this.st.status = 'idle';
      this.changed();
    }
  }

  private async turn(model: ChatModel, signal: AbortSignal, turnStart: number, carried: ToolResultBlockParam[], toldBefore: AgentMode | null): Promise<void> {
    for (let step = 0; ; step++) {
      this.st.status = 'thinking';
      this.changed();
      let reply: ModelReply;
      const aid = this.id('a');
      let assistant: Extract<ChatItem, { kind: 'assistant' }> | null = null;
      const ensure = (): Extract<ChatItem, { kind: 'assistant' }> => {
        if (!assistant) {
          assistant = { kind: 'assistant', id: aid, text: '', thinking: '' };
          this.st.items.push(assistant);
        }
        return assistant;
      };
      const partial = new Map<string, string>();
      try {
        reply = await model.send({ system: this.system!, tools: this.tools!, messages: this.messages, effort: this.st.effort }, {
          text: (d) => {
            ensure().text += d;
            this.emit({ t: 'text', delta: d });
          },
          thinking: (d) => {
            ensure().thinking += d;
            this.emit({ t: 'thinking', delta: d });
          },
          toolStart: (id) => {
            partial.set(id, '');
            this.st.items.push({ kind: 'step', id, code: '', status: 'writing', looks: [] });
            this.changed();
          },
          toolInput: (id, json) => {
            const s = (partial.get(id) ?? '') + json;
            partial.set(id, s);
            const it = this.item<'step'>(id);
            if (it) it.code = partialCode(s);
            this.emit({ t: 'step.code', step: id, partial: it?.code ?? '' });
          },
        }, signal);
      } catch (e) {
        // the request was not answered: nothing is appended for it
        for (const id of partial.keys()) {
          const it = this.item<'step'>(id);
          if (it) it.status = 'stopped';
        }
        if (e instanceof ModelError && e.kind === 'aborted') {
          this.notice('info', 'Stopped.');
          if (step === 0 && this.messages.length > turnStart) this.restoreTurn(turnStart, carried, toldBefore);
          return;
        }
        const me = e instanceof ModelError ? e : new ModelError('api', String(e));
        // a first request that failed is taken back (Send retries it); later ones leave the history valid as it is
        if (step === 0) this.restoreTurn(turnStart, carried, toldBefore);
        this.notice('error', me.message);
        this.emit({ t: 'error', kind: me.kind, message: me.message });
        return;
      }
      this.messages.push({ role: 'assistant', content: reply.content as ContentBlockParam[] });
      if (reply.usage) {
        this.st.usage.input += reply.usage.input;
        this.st.usage.output += reply.usage.output;
        this.st.usage.cacheRead += reply.usage.cacheRead;
      }
      const a = assistant as Extract<ChatItem, { kind: 'assistant' }> | null;
      if (a && reply.model) a.model = reply.model;
      if (reply.fallback) {
        if (a) a.fallback = reply.fallback;
        this.emit({ t: 'notice', kind: 'fallback', detail: `answered by a fallback model (${reply.fallback})` });
      }
      if (reply.stop_reason === 'refusal') {
        const cat = reply.stop_details?.category;
        this.notice('error', `Claude declined this request${cat ? ` (${cat})` : ''}.`);
        this.emit({ t: 'done', stopReason: 'refusal', usage: { ...this.st.usage } });
        return;
      }
      if (reply.stop_reason === 'pause_turn') continue;
      const calls = reply.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
      if (calls.length === 0) {
        this.emit({ t: 'done', stopReason: reply.stop_reason ?? 'end_turn', usage: { ...this.st.usage } });
        return;
      }
      if (reply.stop_reason === 'max_tokens' || step >= this.maxSteps) {
        const why = step >= this.maxSteps ? 'step limit reached' : 'cut off at max_tokens';
        this.carry = calls.map((c) => notRun(c, why));
        for (const c of calls) this.markNotRun(c.id);
        this.notice('error', step >= this.maxSteps ? 'The agent used all its steps.' : 'The reply was cut off mid-code; the cut eval was not run.');
        return;
      }
      const results: ToolResultBlockParam[] = [];
      for (const call of calls) {
        results.push(await this.runStep(call, signal));
        if (this.stopped) {
          for (const c of calls.slice(results.length)) this.markNotRun(c.id);
          this.carry = [...results, ...calls.slice(results.length).map((c) => notRun(c, 'stopped by the photographer'))];
          this.notice('info', 'Stopped.');
          return;
        }
      }
      const tail = step + 1 === this.maxSteps ? [text('Step limit reached. Answer now from what you have; do not call eval again.')] : [];
      this.messages.push({ role: 'user', content: [...results, ...tail] });
    }
  }

  /** Takes the unanswered first request of a turn back (its user message and mode note). */
  private restoreTurn(turnStart: number, carried: ToolResultBlockParam[], toldBefore: AgentMode | null): void {
    this.messages.splice(turnStart);
    this.carry = carried;
    this.toldMode = toldBefore;
  }

  private markNotRun(id: string): void {
    const it = this.item<'step'>(id);
    if (it && it.status !== 'done') it.status = 'not-run';
    this.changed();
  }

  private async runStep(call: ToolUseBlock, signal: AbortSignal): Promise<ToolResultBlockParam> {
    let it = this.item<'step'>(call.id);
    if (!it) {
      it = { kind: 'step', id: call.id, code: '', status: 'writing', looks: [] };
      this.st.items.push(it);
    }
    const input = call.input as { code?: unknown; frame?: unknown } | null;
    const bad = !input || typeof input !== 'object' || typeof input.code !== 'string' || !input.code.trim() || (input.frame !== undefined && typeof input.frame !== 'string')
      || Object.keys(input).some((k) => k !== 'code' && k !== 'frame');
    if (bad) {
      it.status = 'error';
      it.isError = true;
      it.text = 'E_TOOL_INPUT: the eval input must be { code: string, frame?: string }';
      this.changed();
      return { type: 'tool_result', tool_use_id: call.id, is_error: true, content: [text('E_TOOL_INPUT: the eval input must be {"code": "<the body of an async function>"} with an optional "frame" id string; nothing ran.')] };
    }
    const code = input.code as string;
    const frame = (input.frame as string | undefined) ?? this.host.currentFrame() ?? undefined;
    it.code = code;
    if (frame) it.frame = frame;
    it.status = 'running';
    this.st.status = 'running';
    this.emit({ t: 'step.started', step: call.id, code });
    const t0 = Date.now();
    const res = await this.host.evaluate({ code, ...(frame ? { frame } : {}) }, signal);
    it.ms = Date.now() - t0;
    it.looks = res.looks.map((l) => ({ n: l.n, caption: l.caption, mime: l.image.mime, bytes: l.image.bytes, width: l.image.width, height: l.image.height, numbers: l.numbers }));
    it.text = res.yaml;
    it.isError = !!res.error;
    if (this.stopped && res.error?.code === 'E_CANCELLED') {
      it.status = 'stopped';
      this.changed();
      return { type: 'tool_result', tool_use_id: call.id, is_error: true, content: [text('Stopped by the photographer before this eval finished; nothing it asked to change was applied.')] };
    }
    let note = '';
    const pending = res.transactions.filter((e) => e.tx.status === 'pending');
    const applied = res.transactions.filter((e) => e.tx.status === 'applied');
    if (applied.length) it.applied = { frame: applied[0]!.doc, seqs: applied.map((e) => e.seq) };
    if (pending.length) {
      it.approval = { frame: pending[0]!.doc, seqs: pending.map((e) => e.seq), changes: changesOf(pending) };
      it.status = 'waiting';
      this.st.status = 'waiting';
      this.emit({ t: 'approval', step: call.id, pending });
      const how = await this.waitDecision(it, signal);
      note = this.decisionNote(it, how);
    }
    it.status = this.stopped ? 'stopped' : res.error ? 'error' : 'done';
    this.emit({ t: 'step.done', step: call.id, text: res.yaml, looks: it.looks, ms: it.ms, isError: !!res.error });
    const images = res.looks.map((l) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: l.image.mime, data: toBase64(l.image.bytes) } }));
    this.st.imagesSent += images.length;
    return { type: 'tool_result', tool_use_id: call.id, ...(res.error ? { is_error: true } : {}), content: [text(res.yaml + note), ...images] };
  }

  private status(seq: number): string {
    return this.host.docs.log().entry(seq)?.tx.status ?? 'gone';
  }

  private waitDecision(it: Extract<ChatItem, { kind: 'step' }>, signal: AbortSignal): Promise<'decided' | 'later' | 'stopped'> {
    const ap = it.approval!;
    return new Promise((resolve) => {
      const isOpen = (): boolean => ap.seqs.some((s) => this.status(s) === 'pending');
      let off = (): void => undefined;
      const w: Waiter = {
        step: it.id,
        resolve: (how) => {
          off();
          signal.removeEventListener('abort', onAbort);
          this.waiters.delete(w);
          resolve(how);
        },
      };
      const onAbort = (): void => w.resolve('stopped');
      // decided anywhere (this card, the approvals panel, Approve all): the step continues
      off = this.host.docs.subscribe(() => {
        if (!isOpen()) w.resolve('decided');
      });
      signal.addEventListener('abort', onAbort, { once: true });
      this.waiters.add(w);
      if (!isOpen()) w.resolve('decided');
    });
  }

  private decisionNote(it: Extract<ChatItem, { kind: 'step' }>, how: 'decided' | 'later' | 'stopped'): string {
    const ap = it.approval!;
    const status = (s: number): string => this.status(s);
    const approved = ap.seqs.filter((s) => status(s) === 'applied');
    const rejected = ap.seqs.filter((s) => status(s) === 'rejected');
    const pending = ap.seqs.filter((s) => status(s) === 'pending');
    ap.outcome = { approved, rejected, pending };
    if (approved.length) it.applied = { frame: ap.frame, seqs: [...(it.applied?.seqs ?? []), ...approved] };
    this.changed();
    const say = (seqs: number[]): string => seqs.map((s) => ap.changes.find((c) => c.seq === s)?.text ?? `#${s}`).join('; ');
    const parts: string[] = [];
    if (approved.length) parts.push(`approved ${approved.length} change(s): ${say(approved)}`);
    if (rejected.length) parts.push(`rejected ${rejected.length}: ${say(rejected)}`);
    if (pending.length) parts.push(`${pending.length} still pending${how === 'later' ? ' (they will decide later)' : how === 'stopped' ? ' (the photographer pressed Stop)' : ''}: ${say(pending)}`);
    return `\n\n[the photographer ${parts.join('; ')}]`;
  }

  /**
   * The photographer's decision on a step's proposals: approve the given seqs (the others of the step are rejected;
   * an entry of a batch stands for the whole batch), reject them all, or decide later (they stay pending). Approve may
   * be refused (E_STALE …): the problems are shown on the card, and `force` applies anyway.
   */
  decide(step: string, seqs: readonly number[], decision: 'approve' | 'reject' | 'later', o: { force?: boolean } = {}): void {
    const it = this.item<'step'>(step);
    const ap = it?.approval;
    if (!it || !ap) return;
    const docs = this.host.docs;
    const open = (): number[] => ap.seqs.filter((s) => this.status(s) === 'pending');
    if (decision === 'later') {
      for (const w of this.waiters) if (w.step === step) w.resolve('later');
      return;
    }
    if (decision === 'reject') {
      const sel = open();
      if (sel.length) docs.change((l) => l.reject(sel));
      return;
    }
    const chosen = seqs.filter((s) => open().includes(s));
    if (chosen.length) {
      try {
        docs.change((l) => l.approve(chosen, { by: 'user', ...(o.force ? { force: true } : {}) }));
      } catch (e) {
        ap.problems = [toDiagnostic(e)];
        this.changed();
        return;
      }
      delete ap.problems;
    }
    const rest = open();
    if (rest.length) docs.change((l) => l.reject(rest));
    this.changed();
  }

  /** Undo a step's applied changes as one new transaction by the photographer; the agent hears of it next turn. */
  revertStep(step: string): boolean {
    const it = this.item<'step'>(step);
    if (!it?.applied || it.reverted) return false;
    const docs = this.host.docs;
    const log = docs.log();
    const entries = it.applied.seqs.map((s) => log.entry(s)).filter((e): e is LogEntry => !!e && e.tx.status === 'applied');
    if (!entries.length) return false;
    const undo = (e: LogEntry): Mutation[] => [...e.tx.inverses].reverse();
    const id = `revert:${entries[0]!.tx.batch ?? entries[0]!.tx.id}`;
    const meta = { id, label: 'revert agent step', by: 'user' as const, source: { kind: 'revert', of: entries[0]!.tx.batch ?? entries[0]!.tx.id } };
    const x: Edit | Batch = entries.length === 1
      ? { doc: entries[0]!.doc, tx: transaction({ ...meta, mutations: undo(entries[0]!) }) }
      : plan(log.targets(entries.map((e) => e.doc)), (_d, doc) => undo(entries.find((e) => e.doc === doc)!), meta);
    try {
      if ('skipped' in x && x.skipped.length) throw x.skipped[0]!.error;
      docs.change((l) => l.commit(x));
    } catch (e) {
      this.notice('error', `Revert failed: ${toDiagnostic(e).message}`);
      return false;
    }
    it.reverted = true;
    this.sinceLast.push(`the photographer reverted eval ${step} (${changesOf(entries).map((c) => c.text).join('; ')})`);
    this.changed();
    return true;
  }

  /** Stop: ends the model's stream, interrupts a running eval (its edits are dropped), ends an approval wait. */
  stop(): void {
    if (!this.abort) return;
    this.stopped = true;
    this.abort.abort();
    for (const w of [...this.waiters]) w.resolve('stopped');
  }

  /** The thread as sent (system prompt, tools, messages), for storage and transcripts. */
  toJSON(): { system: string | null; model: string | null; effort: Effort; messages: MessageParam[]; carry: ToolResultBlockParam[] } {
    return { system: this.system, model: this.st.model, effort: this.st.effort, messages: structuredClone(this.messages), carry: structuredClone(this.carry) };
  }
}

function notRun(c: ToolUseBlock, why: string): ToolResultBlockParam {
  return { type: 'tool_result', tool_use_id: c.id, is_error: true, content: [{ type: 'text', text: `Not run: ${why}. Nothing was changed.` }] };
}

/** The code field of a partial tool-input JSON, for the step card while the model writes it. */
export function partialCode(json: string): string {
  const m = /"code"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(json);
  if (!m) return '';
  try {
    return JSON.parse(`"${m[1]!.replace(/\\$/, '')}"`) as string;
  } catch {
    return m[1]!.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}
