// M1 page wiring: open a TIFF → frame.add → compile → mock engine → canvas; one generated control,
// undo/redo, history, provenance and an approval queue for agent proposals. CHB-009 replaces this
// page; CHB-007 replaces `window.chromobench.propose` with a real DSL eval.
import { canonicalJSON, type AgentMode, type LoggedMutation, type Mutation } from '@chromobench/contract';
import { MockEngine } from '@chromobench/engine-mock';
import { vec3Slider } from './controls.ts';
import { openFrame, type FrameSession } from './session.ts';
import { Viewer } from './viewer.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const engine = new MockEngine();
const canvas = $<HTMLCanvasElement>('view');
const viewer = new Viewer(canvas);
let session: FrameSession | null = null;
let rendering: Promise<boolean> = Promise.resolve(false);

const lights = vec3Slider($('controls'), () => session?.log ?? null, 'print.lights', 'logH');

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const describe = (m: Mutation): string => (m.op === 'set' ? `${m.path} = ${canonicalJSON(m.value)}` : m.op);

function renderPending(): void {
  const log = session!.log;
  const pending = $('pending');
  pending.innerHTML = '';
  const byTx = new Map<string, LoggedMutation[]>();
  for (const e of log.pending()) byTx.set(e.tx ?? '', [...(byTx.get(e.tx ?? '') ?? []), e]);
  $('pending-count').textContent = String(byTx.size);
  $('pending-count').classList.toggle('bad', byTx.size > 0);
  for (const [tx, es] of byTx) {
    const li = el('li', 'ask');
    li.dataset['tx'] = tx;
    const p = el('p');
    p.append(el('b', undefined, es[0]?.why ?? 'Agent proposal'), el('span', 'mut small', ` · ${tx}`));
    li.append(p);
    for (const e of es) li.append(el('code', undefined, describe(e.m)));
    const row = el('div', 'row');
    const ok = el('button', 'btn sm primary approve', 'Approve') as HTMLButtonElement;
    ok.onclick = () => {
      const r = log.approve(es.map((e) => e.seq));
      if (Array.isArray(r)) setStatus(r.map((d) => `${d.code}: ${d.message}`).join('; '), true);
    };
    const no = el('button', 'btn sm reject', 'Reject') as HTMLButtonElement;
    no.onclick = () => log.reject(es.map((e) => e.seq));
    row.append(ok, no);
    li.append(row);
    pending.append(li);
  }
}

function renderHistory(): void {
  const log = session!.log;
  const h = $('history');
  h.innerHTML = '';
  const first = el('div', `hist-it${log.cursor === 0 ? ' cur' : ''}`);
  first.append(el('span', 'by', 'auto'), el('span', undefined, 'frame.add (default recipe)'));
  h.append(first);
  log.units.forEach((u, i) => {
    const e = log.entries[u.seqs[0]! - 1]!;
    const it = el('div', `hist-it${i + 1 === log.cursor ? ' cur' : ''}${i >= log.cursor ? ' undone' : ''}${e.by === 'agent' ? ' agent' : ''}`);
    it.title = u.seqs.map((s) => describe(log.entries[s - 1]!.m)).join('\n');
    it.append(el('span', 'by', e.by), el('span', undefined, u.label));
    h.append(it);
  });
}

function setStatus(text: string, bad = false): void {
  const s = $('status');
  s.textContent = text;
  s.style.color = bad ? 'var(--accent)' : '';
}

function refresh(): void {
  if (!session) return;
  const { log } = session;
  $('hash').textContent = log.stateHash.slice(0, 12);
  $<HTMLButtonElement>('undo').disabled = !log.canUndo();
  $<HTMLButtonElement>('redo').disabled = !log.canRedo();
  $('why').textContent = log.formatWhy('print.lights.logH');
  renderPending();
  renderHistory();
}

async function render(): Promise<void> {
  if (!session) return;
  refresh();
  rendering = viewer.render(engine, session.displayNode());
  await rendering;
  setStatus(`rendered ${viewer.renders}`);
}

$<HTMLInputElement>('file').addEventListener('change', async (ev) => {
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    session = await openFrame(engine, new Uint8Array(await f.arrayBuffer()), f.name, $<HTMLSelectElement>('mode').value as AgentMode);
    $('frame-name').textContent = f.name;
    $('drop').hidden = true;
    canvas.hidden = false;
    lights.sync(session.log.committed.print.lights.logH);
    session.log.on((e) => {
      if (e.type !== 'preview') lights.sync(session!.log.committed.print.lights.logH);
      void render();
    });
    await render();
  } catch (e) {
    setStatus(`error: ${e instanceof Error ? e.message : String(e)}`, true);
  }
});
$('undo').addEventListener('click', () => session?.log.undo());
$('redo').addEventListener('click', () => session?.log.redo());
$('mode').addEventListener('change', () => session?.log.setMode($<HTMLSelectElement>('mode').value as AgentMode));

// Readout under the cursor, in the canvas's own pixel grid (= source pixels for the M1 chain).
canvas.addEventListener('mousemove', (ev) => {
  const l = viewer.last;
  if (!l) return;
  const r = canvas.getBoundingClientRect();
  const scale = Math.min(r.width / l.width, r.height / l.height);
  const x = Math.floor((ev.clientX - r.left - (r.width - l.width * scale) / 2) / scale);
  const y = Math.floor((ev.clientY - r.top - (r.height - l.height * scale) / 2) / scale);
  const ro = $('readout');
  if (x < 0 || y < 0 || x >= l.width || y >= l.height) return;
  const i = (y * l.width + x) * 3;
  ro.innerHTML = '';
  const add = (k: string, v: string): void => { const s = el('span', undefined, `${k} `); s.append(el('b', undefined, v)); ro.append(s); };
  add('x, y', `${x}, ${y}`);
  ['R', 'G', 'B'].forEach((c, k) => add(c, Number(l.data[i + k]).toFixed(4)));
});

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
