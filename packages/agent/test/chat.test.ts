// The chat step loop on a scripted model, the DSL session in an in-thread worker and engine-mock (guide §8 "Chat loop
// tests"): tool round trips with an append-only history, approvals inside the step, Stop, cut tool calls, refusals,
// the step limit, mode changes as appended system messages, revert, bad tool input and looks as image blocks.
import { describe, expect, it } from 'vitest';
import type { AgentMode } from '@chromobench/contract';
import { ChatSession, ScriptedModel, lastToolResult, type ChatHost, type MessageParam, type ModelRequest } from '../src/index.ts';
import { FRAME, page, type Page } from './helpers.ts';

const MEASURE = `const d = await frame.print().measure.densitometer({ at: [48, 32], aperture_px: 15 })
return { D: d.D }`;
const EDIT = `frame.edit({ 'print.enlarger.time_s': 12.6 }, { why: 'a third of a stop darker' })
return 'proposed'`;

function hostOf(p: Page): ChatHost {
  let mode: AgentMode = p.log.mode;
  return {
    evaluate: (req, signal) => p.dsl.eval(req, { signal }),
    currentFrame: () => FRAME,
    frames: p.frames,
    mode: () => mode,
    setMode: (m) => {
      mode = m;
      p.log.setMode(m);
    },
  };
}

const chatOf = (p: Page, model: ScriptedModel, o: { maxSteps?: number } = {}) => new ChatSession({ host: hostOf(p), model, system: 'test system prompt', ...o });

/** every request's system, tools and messages extend the previous request's exactly (append-only history) */
function expectAppendOnly(reqs: ModelRequest[]): void {
  for (let i = 1; i < reqs.length; i++) {
    const a = reqs[i - 1]!;
    const b = reqs[i]!;
    expect(b.system).toBe(a.system);
    expect(JSON.stringify(b.tools)).toBe(JSON.stringify(a.tools));
    expect(b.messages.length).toBeGreaterThan(a.messages.length);
    expect(JSON.stringify(b.messages.slice(0, a.messages.length))).toBe(JSON.stringify(a.messages));
  }
}

const userBlocks = (m: MessageParam | undefined): { type: string; text?: string; tool_use_id?: string; is_error?: boolean }[] =>
  (m && typeof m.content !== 'string' ? m.content : []) as never;

async function until(cond: () => boolean, ms = 5000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('ChatSession', () => {
  it('two-step round trip: eval result goes back as a tool_result; the history only grows', async () => {
    const p = await page();
    const model = new ScriptedModel([
      { thinking: 'Measure the grey card first.', text: 'Let me measure the grey card.', evals: [{ code: MEASURE }] },
      (req) => ({ text: lastToolResult(req).includes('D:') ? 'The grey card reads as above.' : 'no result?' }),
    ]);
    const chat = chatOf(p, model);
    const events: string[] = [];
    chat.on((e) => e.t !== 'changed' && e.t !== 'text' && e.t !== 'thinking' && e.t !== 'step.code' && events.push(e.t));
    await chat.send('How dense is the grey card?');
    expect(model.requests).toHaveLength(2);
    expectAppendOnly(model.requests);
    const second = model.requests[1]!;
    const toolMsg = second.messages.at(-1)!;
    const tr = userBlocks(toolMsg)[0]!;
    expect(tr.type).toBe('tool_result');
    expect(tr.tool_use_id).toBe('toolu_scripted_1');
    expect(lastToolResult(second)).toContain('D:');
    // first user message: the photographer's text, then the context block
    const first = userBlocks(model.requests[0]!.messages[0]);
    expect(first.map((b) => b.type)).toEqual(['text', 'text']);
    expect(first[1]!.text).toContain(`frame: ${FRAME} ("M1 test negative") · mode ask`);
    const kinds = chat.state.items.map((i) => i.kind);
    expect(kinds).toEqual(['user', 'assistant', 'step', 'assistant']);
    const step = chat.state.items[2]!;
    expect(step.kind === 'step' && step.status).toBe('done');
    expect(step.kind === 'step' && step.code).toBe(MEASURE);
    expect(chat.state.items[3]!.kind === 'assistant' && (chat.state.items[3] as { text: string }).text).toBe('The grey card reads as above.');
    expect(events).toEqual(['step.started', 'step.done', 'done']);
    expect(chat.state.status).toBe('idle');
    p.dsl.dispose();
  });

  it('ask mode: the step waits for the photographer; the decision is appended to the tool result', async () => {
    const p = await page({ mode: 'ask' });
    const model = new ScriptedModel([{ evals: [{ code: EDIT }] }, { text: 'Done.' }]);
    const chat = chatOf(p, model);
    const turn = chat.send('Print it a third of a stop darker');
    await until(() => chat.state.status === 'waiting');
    const step = chat.state.items.find((i) => i.kind === 'step')!;
    if (step.kind !== 'step') throw new Error('no step');
    expect(step.approval?.changes.map((c) => c.text)).toEqual(['print.enlarger.time_s 10 → 12.6']);
    expect(p.log.committed.print.enlarger.time_s).toBe(10);
    chat.decide(step.id, step.approval!.seqs, 'approve');
    await turn;
    expect(p.log.committed.print.enlarger.time_s).toBe(12.6);
    expect(p.log.why('print.enlarger.time_s').at(-1)).toMatchObject({ by: 'agent', approvedBy: 'user' });
    expect(lastToolResult(model.requests[1]!)).toContain('[the photographer approved 1 change(s): print.enlarger.time_s 10 → 12.6]');
    expect(step.approval?.outcome).toEqual({ approved: step.approval!.seqs, rejected: [], pending: [] });
    p.dsl.dispose();
  });

  it('partial approval: the unticked change is rejected; a decision in another panel also resumes the step', async () => {
    const p = await page({ mode: 'ask' });
    const two = `frame.edit({ 'print.enlarger.time_s': 12.6 })\nframe.edit({ 'print.lights.logH': [0.05, 0, 0] })\nreturn 2`;
    const model = new ScriptedModel([{ evals: [{ code: two }, { code: EDIT }] }, { text: 'ok' }]);
    const chat = chatOf(p, model);
    const turn = chat.send('two changes');
    await until(() => chat.state.status === 'waiting');
    const s1 = chat.state.items.find((i) => i.kind === 'step')! as Extract<(typeof chat.state.items)[number], { kind: 'step' }>;
    chat.decide(s1.id, [s1.approval!.seqs[1]!], 'approve');
    await until(() => (chat.state.items.filter((i) => i.kind === 'step')[1] as { status?: string } | undefined)?.status === 'waiting');
    expect(p.log.committed.print.lights.logH).toEqual([0.05, 0, 0]);
    expect(p.log.committed.print.enlarger.time_s).toBe(10);
    expect(s1.approval?.outcome?.rejected).toEqual([s1.approval!.seqs[0]]);
    // the second step's card is decided in the studio's approvals panel instead (EditLog.reject directly)
    const s2 = chat.state.items.filter((i) => i.kind === 'step')[1]! as typeof s1;
    p.log.reject(s2.approval!.seqs);
    await turn;
    expect(lastToolResult(model.requests[1]!)).toContain('rejected 1');
    p.dsl.dispose();
  });

  it('decide later: the change stays pending and the agent is told so', async () => {
    const p = await page({ mode: 'ask' });
    const model = new ScriptedModel([{ evals: [{ code: EDIT }] }, { text: 'ok' }]);
    const chat = chatOf(p, model);
    const turn = chat.send('darker');
    await until(() => chat.state.status === 'waiting');
    const s = chat.state.items.find((i) => i.kind === 'step')!;
    chat.decide(s.id, [], 'later');
    await turn;
    expect(p.log.pending()).toHaveLength(1);
    expect(lastToolResult(model.requests[1]!)).toContain('1 still pending (they will decide later)');
    p.dsl.dispose();
  });

  it('a refusal ends the turn with a notice', async () => {
    const p = await page();
    const model = new ScriptedModel([{ text: '', stop: 'refusal', refusal: { category: 'cyber' } }]);
    const chat = chatOf(p, model);
    await chat.send('something');
    expect(chat.state.items.at(-1)).toMatchObject({ kind: 'notice', level: 'error', text: 'Claude declined this request (cyber).' });
    p.dsl.dispose();
  });

  it('a tool call cut at max_tokens is not run; its tool_result opens the next user message', async () => {
    const p = await page({ mode: 'auto' });
    const model = new ScriptedModel([{ evals: [{ code: EDIT }], stop: 'max_tokens', cutAt: 20 }, { text: 'ok' }]);
    const chat = chatOf(p, model);
    await chat.send('darker');
    expect(p.log.entries).toHaveLength(0);
    expect(chat.state.items.at(-1)).toMatchObject({ kind: 'notice', text: 'The reply was cut off mid-code; the cut eval was not run.' });
    await chat.send('try again');
    const next = userBlocks(model.requests[1]!.messages.at(-1));
    expect(next[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_scripted_1', is_error: true });
    expect(next[1]).toMatchObject({ type: 'text', text: 'try again' });
    expectAppendOnly(model.requests);
    p.dsl.dispose();
  });

  it('Stop while the model streams appends nothing; Send works again', async () => {
    const p = await page();
    const model = new ScriptedModel([{ text: 'x'.repeat(400) }, { text: 'second' }], { chunk: 4, delayMs: 2 });
    const chat = chatOf(p, model);
    const turn = chat.send('long answer please');
    await until(() => chat.state.items.some((i) => i.kind === 'assistant' && i.text.length > 8));
    chat.stop();
    await turn;
    expect(chat.messages).toHaveLength(0); // the unanswered first request is taken back
    await chat.send('again');
    expect(chat.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    p.dsl.dispose();
  });

  it('Stop during an eval interrupts it; the stopped tool_result is carried into the next message', async () => {
    const p = await page({ mode: 'auto' });
    const slow = `frame.edit({ 'print.enlarger.time_s': 14 })\nfor (let i = 0; ; i++) await frame.print({ time_s: 10 + (i % 5) }).measure.densitometer({ at: [48, 32] })`;
    const model = new ScriptedModel([{ evals: [{ code: slow }] }, { text: 'ok' }]);
    const chat = chatOf(p, model);
    const turn = chat.send('loop');
    await until(() => chat.state.status === 'running');
    await new Promise((r) => setTimeout(r, 50));
    chat.stop();
    await turn;
    expect(p.log.entries).toHaveLength(0);
    const step = chat.state.items.find((i) => i.kind === 'step')!;
    expect(step.kind === 'step' && step.status).toBe('stopped');
    await chat.send('what happened?');
    const first = userBlocks(model.requests[1]!.messages.at(-1))[0]!;
    expect(first).toMatchObject({ type: 'tool_result', is_error: true });
    expect(JSON.stringify(first)).toContain('Stopped by the photographer');
    p.dsl.dispose();
  });

  it('the step limit: the last allowed result asks for an answer; a further call is not run', async () => {
    const p = await page();
    const model = new ScriptedModel([{ evals: [{ code: 'return 1' }] }, { evals: [{ code: 'return 2' }] }, { evals: [{ code: 'return 3' }] }]);
    const chat = chatOf(p, model, { maxSteps: 2 });
    await chat.send('count');
    expect(model.requests).toHaveLength(3);
    expect(JSON.stringify(model.requests[2]!.messages.at(-1))).toContain('Step limit reached');
    expect(chat.state.items.filter((i) => i.kind === 'step').map((i) => (i as { status: string }).status)).toEqual(['done', 'done', 'not-run']);
    expect(chat.state.items.at(-1)).toMatchObject({ kind: 'notice', text: 'The agent used all its steps.' });
    p.dsl.dispose();
  });

  it('a mode change is an appended system message after the next user message; earlier messages are untouched', async () => {
    const p = await page({ mode: 'ask' });
    const model = new ScriptedModel([{ text: 'hello' }, { evals: [{ code: EDIT }] }, { text: 'applied' }]);
    const chat = chatOf(p, model);
    await chat.send('hi');
    chat.setMode('auto');
    expect(p.log.mode).toBe('auto');
    await chat.send('darker, go ahead');
    expectAppendOnly(model.requests);
    const msgs = model.requests[1]!.messages;
    expect(msgs.at(-2)!.role).toBe('user');
    expect(msgs.at(-1)).toEqual({ role: 'system', content: 'The photographer set the agent to auto mode: edits apply at once (they stay undoable).' });
    expect(p.log.committed.print.enlarger.time_s).toBe(12.6); // auto: applied, no card
    p.dsl.dispose();
  });

  it('revert: the step\'s applied change is undone by the photographer and reported in the next context block', async () => {
    const p = await page({ mode: 'auto' });
    const model = new ScriptedModel([{ evals: [{ code: EDIT }] }, { text: 'done' }, { text: 'noted' }]);
    const chat = chatOf(p, model);
    await chat.send('darker');
    const step = chat.state.items.find((i) => i.kind === 'step')!;
    expect(p.log.committed.print.enlarger.time_s).toBe(12.6);
    expect(chat.revertStep(step.id)).toBe(true);
    expect(p.log.committed.print.enlarger.time_s).toBe(10);
    expect(p.log.why('print.enlarger.time_s').at(-1)!.by).toBe('user');
    await chat.send('ok?');
    expect(JSON.stringify(model.requests[2]!.messages.at(-1))).toContain(`the photographer reverted eval ${step.id}`);
    p.dsl.dispose();
  });

  it('malformed tool input is answered with E_TOOL_INPUT and nothing runs', async () => {
    const p = await page();
    const model = new ScriptedModel([
      () => ({ evals: [{ code: '' }] }),
      { text: 'sorry' },
    ]);
    const chat = chatOf(p, model);
    await chat.send('x');
    expect(lastToolResult(model.requests[1]!)).toContain('E_TOOL_INPUT');
    expect(p.dsl.evals).toBe(0);
    p.dsl.dispose();
  });

  it('looks travel as image blocks inside the tool_result and are counted', async () => {
    const p = await page();
    const model = new ScriptedModel([{ evals: [{ code: "frame.print().look('print')\nreturn 1" }] }, { text: 'ok' }]);
    const chat = chatOf(p, model);
    await chat.send('show me');
    const tr = userBlocks(model.requests[1]!.messages.at(-1))[0] as unknown as { content: { type: string; source?: { media_type: string; data: string } }[] };
    const img = tr.content.find((b) => b.type === 'image')!;
    expect(img.source!.media_type).toBe('image/png');
    expect(Buffer.from(img.source!.data, 'base64').subarray(1, 4).toString()).toBe('PNG');
    expect(chat.state.imagesSent).toBe(1);
    const step = chat.state.items.find((i) => i.kind === 'step')!;
    expect(step.kind === 'step' && step.looks[0]!.bytes.length).toBeGreaterThan(100);
    p.dsl.dispose();
  });

  it('without a model, Send explains what to do', async () => {
    const p = await page();
    const chat = new ChatSession({ host: hostOf(p), system: 'x' });
    await chat.send('hi');
    expect(chat.state.items.at(-1)).toMatchObject({ kind: 'notice', level: 'error' });
    expect(chat.messages).toHaveLength(0);
    p.dsl.dispose();
  });
});
