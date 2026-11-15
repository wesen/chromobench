// The offline demo model end to end (measure, solve lights in log exposure, propose, summarise). (That ChatSession
// satisfies studio-kit's ChatSessionLike is the chat kit's own test: the agent does not import the UI.)
import { describe, expect, it } from 'vitest';
import { ChatSession, demoModel, type ChatHost } from '../src/index.ts';
import { FRAME, page, param } from './helpers.ts';

describe('demo model', () => {
  it('balances the centre of the M1 frame through the real loop; approve applies the proposed lights', async () => {
    const p = await page({ mode: 'ask' });
    const host: ChatHost = {
      evaluate: (req, signal) => p.dsl.eval(req, { signal }),
      currentFrame: () => FRAME,
      docs: p.docs,
      setMode: (m) => p.docs.setMode(m),
    };
    const chat = new ChatSession({ host, model: demoModel({ size: () => ({ width: 96, height: 64 }), delayMs: 0 }), system: 'demo' });
    expect(chat.busy).toBe(false);
    const turn = chat.send('balance it');
    const t0 = Date.now();
    while (chat.state.status !== 'waiting' && Date.now() - t0 < 10_000) await new Promise((r) => setTimeout(r, 5));
    const step = chat.state.items.filter((i) => i.kind === 'step')[1]!;
    if (step.kind !== 'step' || !step.approval) throw new Error('no approval');
    expect(step.approval.changes[0]!.text).toMatch(/^set lights\.params\.logH = \[.*\] \(was \[0, 0, 0\]\) \(.* pt\)$/);
    chat.decide(step.id, step.approval.seqs, 'approve');
    await turn;
    expect(param(p, 'lights', 'logH')).not.toEqual([0, 0, 0]);
    const final = chat.state.items.at(-1)!;
    expect(final.kind === 'assistant' && final.text).toMatch(/^I proposed printer lights of \[.*\] \(red \/ green \/ blue\) to neutralise the centre\. You approved 1 change\(s\)\./);
    // a second turn starts the script again
    const again = chat.send('once more');
    while (chat.state.status !== 'waiting' && Date.now() - t0 < 10_000) await new Promise((r) => setTimeout(r, 5));
    chat.stop();
    await again;
    p.dsl.dispose();
  });
});
