// The chat's model transport (CHB-008 guide §5.6), pluggable: the chat loop talks to a ChatModel, which streams one
// assistant message for a request. Implementations: AnthropicModel (the Claude API, key entered by the
// photographer at runtime), ScriptedModel (tests and the offline demo). Requests and messages use the Claude
// Messages API shapes (the SDK's beta types), so a scripted transcript and a real one are the same data.
import type Anthropic from '@anthropic-ai/sdk';

export type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
export type ContentBlock = Anthropic.Beta.Messages.BetaContentBlock;
export type ContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;
export type ToolResultBlockParam = Anthropic.Beta.Messages.BetaToolResultBlockParam;
export type ToolUseBlock = Anthropic.Beta.Messages.BetaToolUseBlock;
export type ToolDef = Anthropic.Beta.Messages.BetaTool;
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export interface ModelRequest {
  /** Frozen when the thread starts. */
  system: string;
  /** Frozen when the thread starts. */
  tools: ToolDef[];
  /** Append-only. */
  messages: MessageParam[];
  effort: Effort;
}

/** Streaming callbacks: deltas as they arrive (the step card shows eval code while it is written). */
export interface ModelSink {
  text(delta: string): void;
  thinking(delta: string): void;
  toolStart(id: string, name: string): void;
  toolInput(id: string, partialJson: string): void;
}

export interface ModelReply {
  content: ContentBlock[];
  stop_reason: string | null;
  stop_details?: { category?: string | null; explanation?: string | null } | null;
  usage?: { input: number; output: number; cacheRead: number };
  /** The model that answered (differs from the request's when a fallback model answered). */
  model?: string;
  /** Set when a fallback model answered (refusal fallbacks). */
  fallback?: string;
}

export type ModelErrorKind = 'auth' | 'rate' | 'network' | 'overloaded' | 'bad-request' | 'aborted' | 'api';

/** A transport failure the chat shows as one sentence. */
export class ModelError extends Error {
  readonly kind: ModelErrorKind;
  constructor(kind: ModelErrorKind, message: string) {
    super(message);
    this.name = 'ModelError';
    this.kind = kind;
  }
}

export interface ChatModel {
  /** Shown in the panel, e.g. "claude-opus-5-5" or "scripted demo". */
  readonly label: string;
  send(req: ModelRequest, sink: ModelSink, signal: AbortSignal): Promise<ModelReply>;
}

// ── the scripted model ──

/** One scripted assistant message: text, optional thinking, eval calls (code), the stop reason. */
export interface ScriptReply {
  thinking?: string;
  text?: string;
  evals?: { code: string; frame?: string }[];
  stop?: 'end_turn' | 'tool_use' | 'refusal' | 'max_tokens' | 'pause_turn';
  /** max_tokens: the last eval's input is cut after this many characters (a cut tool call). */
  cutAt?: number;
  refusal?: { category: string; explanation?: string };
  fallback?: string;
}

/** A scripted step: a fixed reply, or one computed from the request (e.g. reading the last tool_result). */
export type ScriptStep = ScriptReply | ((req: ModelRequest) => ScriptReply);

export interface ScriptedModelOptions {
  label?: string;
  /** Characters per streamed chunk (default 12). */
  chunk?: number;
  /** Delay between chunks in ms (default 0: a microtask). */
  delayMs?: number;
  /** What to answer when the script is used up (default: a short end_turn text). */
  after?: ScriptStep;
  /** Keep a copy of every request in `requests` (default true; the demo turns it off). */
  record?: boolean;
}

/** The last tool_result text of a request (what the scripted steps read to "react" to an eval). */
export function lastToolResult(req: ModelRequest): string {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i]!;
    if (m.role !== 'user' || typeof m.content === 'string') continue;
    for (const b of [...m.content].reverse()) {
      if (b.type !== 'tool_result') continue;
      const c = b.content;
      if (typeof c === 'string') return c;
      return (c ?? []).map((x) => (x.type === 'text' ? x.text : '')).join('');
    }
  }
  return '';
}

/** The last user text of a request. */
export function lastUserText(req: ModelRequest): string {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i]!;
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    const t = m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text);
    if (t.length) return t[0]!;
  }
  return '';
}

/**
 * A model that plays a script: each send() streams the next scripted reply in chunks, honouring the abort
 * signal, and records the request (deep copy) so tests can check that history only grows.
 */
export class ScriptedModel implements ChatModel {
  readonly label: string;
  readonly requests: ModelRequest[] = [];
  private readonly steps: ScriptStep[];
  private readonly o: ScriptedModelOptions;
  private n = 0;
  private ids = 0;

  constructor(steps: ScriptStep[], o: ScriptedModelOptions = {}) {
    this.steps = [...steps];
    this.o = o;
    this.label = o.label ?? 'scripted';
  }

  get remaining(): number {
    return Math.max(0, this.steps.length - this.n);
  }

  async send(req: ModelRequest, sink: ModelSink, signal: AbortSignal): Promise<ModelReply> {
    if (this.o.record !== false) this.requests.push(structuredClone(req));
    const step = this.steps[this.n++] ?? this.o.after ?? { text: 'That is all I have for now.' };
    const r = typeof step === 'function' ? step(req) : step;
    const chunk = this.o.chunk ?? 12;
    const pause = async (): Promise<void> => {
      if (signal.aborted) throw new ModelError('aborted', 'stopped');
      await new Promise<void>((res) => (this.o.delayMs ? setTimeout(res, this.o.delayMs) : queueMicrotask(res)));
      if (signal.aborted) throw new ModelError('aborted', 'stopped');
    };
    const content: ContentBlock[] = [];
    if (r.thinking) {
      for (let i = 0; i < r.thinking.length; i += chunk) {
        await pause();
        sink.thinking(r.thinking.slice(i, i + chunk));
      }
      content.push({ type: 'thinking', thinking: r.thinking, signature: `scripted-${this.n}` } as ContentBlock);
    }
    if (r.text) {
      for (let i = 0; i < r.text.length; i += chunk) {
        await pause();
        sink.text(r.text.slice(i, i + chunk));
      }
      content.push({ type: 'text', text: r.text, citations: null } as ContentBlock);
    }
    const evals = r.evals ?? [];
    for (const [k, e] of evals.entries()) {
      const id = `toolu_scripted_${++this.ids}`;
      sink.toolStart(id, 'eval');
      let json = JSON.stringify(e.frame ? { code: e.code, frame: e.frame } : { code: e.code });
      const cut = r.stop === 'max_tokens' && k === evals.length - 1 && r.cutAt !== undefined;
      if (cut) json = json.slice(0, r.cutAt);
      for (let i = 0; i < json.length; i += chunk) {
        await pause();
        sink.toolInput(id, json.slice(i, i + chunk));
      }
      let input: unknown = {};
      try {
        input = JSON.parse(json);
      } catch {
        input = {}; // a cut call: the loop must not run it
      }
      content.push({ type: 'tool_use', id, name: 'eval', input } as ContentBlock);
    }
    await pause();
    const stop = r.stop ?? (evals.length ? 'tool_use' : 'end_turn');
    return {
      content,
      stop_reason: stop,
      ...(r.refusal ? { stop_details: { category: r.refusal.category, explanation: r.refusal.explanation ?? null } } : {}),
      usage: { input: JSON.stringify(req.messages).length >> 2, output: JSON.stringify(content).length >> 2, cacheRead: 0 },
      model: this.label,
      ...(r.fallback ? { fallback: r.fallback } : {}),
    };
  }
}
