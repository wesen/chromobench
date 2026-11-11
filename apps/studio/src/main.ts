// M1 page wiring: open a TIFF → frame.add → compile → mock engine → canvas; one generated control,
// undo/redo, and an approval queue for agent proposals. CHB-009 replaces this page; CHB-007 replaces
// `window.chromobench.propose` with a real DSL eval.
import type { AgentMode, LoggedMutation, Mutation, Vec3 } from '@chromobench/contract';
import { MockEngine } from '@chromobench/engine-mock';
import { vec3Slider } from './controls.ts';
import { openFrame, type FrameSession } from './session.ts';
import { Viewer } from './viewer.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const engine = new MockEngine();
const viewer = new Viewer($<HTMLCanvasElement>('view'));
let session: FrameSession | null = null;
let rendering: Promise<boolean> = Promise.resolve(false);

const controls = $('controls');
vec3Slider(controls, () => session?.log ?? null, 'print.lights', 'logH');

function refresh(): void {
  if (!session) return;
  const { log } = session;
  $('hash').textContent = log.stateHash.slice(0, 16);
  $<HTMLButtonElement>('undo').disabled = !log.canUndo();
  $<HTMLButtonElement>('redo').disabled = !log.canRedo();
  $('why').textContent = log.formatWhy('print.lights.logH');
  const pending = $('pending');
  pending.innerHTML = '';
  const byTx = new Map<string, LoggedMutation[]>();
  for (const e of log.pending()) byTx.set(e.tx ?? '', [...(byTx.get(e.tx ?? '') ?? []), e]);
  for (const [tx, es] of byTx) {
    const li = document.createElement('li');
    li.dataset['tx'] = tx;
    li.textContent = `${tx}: ${es.map((e) => (e.m.op === 'set' ? `${e.m.path} = ${JSON.stringify(e.m.value)}` : e.m.op)).join('; ')}${es[0]?.why ? ` — ${es[0].why}` : ''} `;
    const ok = document.createElement('button');
    ok.textContent = 'Approve';
    ok.className = 'approve';
    ok.onclick = () => {
      const r = log.approve(es.map((e) => e.seq));
      if (Array.isArray(r)) $('status').textContent = r.map((d) => `${d.code}: ${d.message}`).join('; ');
    };
    const no = document.createElement('button');
    no.textContent = 'Reject';
    no.onclick = () => log.reject(es.map((e) => e.seq));
    li.append(ok, no);
    pending.append(li);
  }
}

async function render(): Promise<void> {
  if (!session) return;
  refresh();
  rendering = viewer.render(engine, session.displayNode());
  await rendering;
  $('status').textContent = `rendered ${viewer.renders}`;
}

$<HTMLInputElement>('file').addEventListener('change', async (ev) => {
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    session = await openFrame(engine, new Uint8Array(await f.arrayBuffer()), f.name, $<HTMLSelectElement>('mode').value as AgentMode);
    session.log.on((e) => {
      if (e.type !== 'preview') (controls as HTMLElement & { syncFrom?: (v: Vec3) => void }).syncFrom?.(session!.log.committed.print.lights.logH);
      void render();
    });
    await render();
  } catch (e) {
    $('status').textContent = `error: ${e instanceof Error ? e.message : String(e)}`;
  }
});
$('undo').addEventListener('click', () => session?.log.undo());
$('redo').addEventListener('click', () => session?.log.redo());
$('mode').addEventListener('change', () => session?.log.setMode($<HTMLSelectElement>('mode').value as AgentMode));

/** Test and agent hook. Stands in for CHB-007's DSL eval until it lands: proposals enter by 'agent'. */
const hook = {
  get log() { return session?.log ?? null; },
  get viewer() { return viewer; },
  get engine() { return engine; },
  /** Waits for the render in flight. */
  idle: async (): Promise<void> => { await rendering; await new Promise((r) => setTimeout(r, 0)); await rendering; },
  pixel(x: number, y: number): number[] | null {
    const l = viewer.last;
    if (!l) return null;
    const i = (y * l.width + x) * 3;
    return [l.data[i]!, l.data[i + 1]!, l.data[i + 2]!];
  },
  /** How often the engine computed each node of the current display chain. */
  chainRuns(): { op: string; runs: number }[] {
    if (!session) return [];
    const s = session;
    const top = s.displayNode();
    return s.graph.closure(top.id).map((d) => ({ op: d.op, runs: engine.runs(s.graph.adopt([d]).at(-1)!.id) }));
  },
  /** frame.edit({path: value}) from an eval: one tx, by 'agent'. */
  propose(edits: Record<string, unknown>, why?: string): LoggedMutation[] {
    if (!session) throw new Error('no frame');
    const ms: Mutation[] = Object.entries(edits).map(([path, value]) => ({ op: 'set', path, value }));
    return session.log.propose(ms, { tx: `eval-${Date.now().toString(36)}`, ...(why ? { why } : {}) });
  },
};
declare global {
  interface Window { chromobench: typeof hook }
}
window.chromobench = hook;
