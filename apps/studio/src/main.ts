// The studio host (CHB-019 guide §7.1; CHB-023's real-engine wiring): boot the engine, open IndexedDB, build the
// variant (?variant=, default classic), mount it with studio-kit's services plus the WebGPU presenter, the export
// and the first print, and wire the host frame around it (files, export, status line) and the test/agent hook
// window.chromobench.
//
// URL options: ?variant=classic|darkroom|simple|lab|tiny; ?engine=auto (GPU when WebGPU works, else the reference
// engine) | gpu | reference | mock; ?long=N (GPU working image long side, 0 = the file's own size); ?canvas2d
// (present without WebGPU); ?nosw (no service worker); ?fresh (a KV in memory: nothing saved).
import { closest, type Engine, type LoggedMutation, type Mutation } from '@chromobench/contract';
import { MockEngine } from '@chromobench/engine-mock';
import { pickerAvailable } from '@chromobench/output';
import type { Runtime } from '@chromobench/shell';
import '@chromobench/shell/shell.css';
import { buildVariant, createStudio, frameRef, memoryKV, setKnownValues, type InitialRecipe, type KV, type Studio } from '@chromobench/studio-kit';
import type { DomViewport } from '@chromobench/shell/dom';
import { mountStudio } from '@chromobench/studio-kit/dom';
import '@chromobench/studio-kit/studio-kit.css';
import { DEFAULT_VARIANT, VARIANTS, type VariantId } from '@chromobench/studio-kit/variants';
import { download, EXPORT_FORMATS, EXPORT_SPACES, exportPrint, type ExportFormat } from './host/export.ts';
import { firstPrint } from './host/first-print.ts';
import type { HostSettings } from './host/engines.ts';
import type { StudioEngine } from './host/studio-engine.ts';
import { hostPresenter, presentDevice } from './present/host-presenter.ts';
import { openIdb } from './storage/db.ts';
import { addScanExtensions, fromFileList, hasDirectoryPicker, listScans, pickDirectory, reconnect, SCAN_EXTENSIONS, type PickedFile } from './storage/fsa.ts';
import './app.css';

const q = new URLSearchParams(location.search);
const root = document.getElementById('app')!;
const barEl = document.getElementById('bar')!;
const statusBarEl = document.getElementById('statusbar')!;

// ── small DOM helpers ──
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v);
  }
  e.append(...kids);
  return e;
}
const msgOf = (e: unknown): string => {
  const d = e as { code?: string; diag?: { message?: string }; message?: string };
  return d?.code ? `${d.code}: ${d.diag?.message ?? d.message ?? ''}` : e instanceof Error ? e.message : String(e);
};

// ── the status line (exists before anything else, so the boot can talk) ──
const engineEl = el('span', { id: 'engine', class: 'pill', title: 'The engine that computes the prints' });
const notesEl = el('span', { id: 'notes' });
const statusEl = el('span', { id: 'status', role: 'status', text: 'starting…' });
statusBarEl.append(engineEl, notesEl, statusEl);
let sticky = false;
function status(text: string, o: { error?: boolean; sticky?: boolean } = {}): void {
  if (sticky && !o.sticky && !o.error) return;
  statusEl.textContent = text;
  statusEl.classList.toggle('is-error', !!o.error);
  sticky = !!o.sticky;
}

function report(title: string, lines: string[], html?: string): void {
  root.innerHTML = '';
  const div = el('div', { class: 'report', id: 'build-report' }, el('h2', { text: title }));
  if (html) div.insertAdjacentHTML('beforeend', html);
  if (lines.length) div.append(el('pre', { text: lines.join('\n') }));
  root.append(div);
  document.body.dataset['ready'] = 'report';
}

// ── the engine ──
interface Host {
  engine: Engine;
  label: string;
  initial?: InitialRecipe;
  notes(sha: string): string[];
  settings: HostSettings | null;
}

async function startEngine(): Promise<Host> {
  const want = q.get('engine') ?? 'auto';
  if (want === 'mock') return { engine: new MockEngine(), label: 'mock engine (no physics)', notes: () => [], settings: null };
  const { createHostEngine } = await import('./host/engines.ts');
  const long = q.get('long');
  const h = await createHostEngine({ want: want === 'gpu' || want === 'reference' ? want : 'auto', ...(long !== null ? { long: Number(long) } : {}), onStatus: (s) => status(s) });
  setKnownValues(h.catalog);
  addScanExtensions(h.extensions);
  const se: StudioEngine = h.engine;
  return {
    engine: se,
    label: se.label,
    initial: (d, g) => firstPrint(se, g, d, { integrate: h.integrate }),
    notes: (sha) => se.notes.get(sha)?.notes ?? [],
    settings: h.settings,
  };
}

async function main(): Promise<void> {
  const id = q.get('variant') ?? DEFAULT_VARIANT;
  const load = VARIANTS[id as VariantId];
  if (!load) {
    const guess = closest(id, Object.keys(VARIANTS));
    report(`Unknown variant '${id}'`, [`?variant=${id} is not a registered variant.`, guess ? `Did you mean ?variant=${guess}?` : '', `Variants: ${Object.keys(VARIANTS).join(', ')}`]);
    return;
  }
  status('starting the engine…');
  let host: Host;
  try {
    host = await startEngine();
  } catch (e) {
    status(`the engine did not start: ${msgOf(e)}`, { error: true });
    report('The engine did not start', [msgOf(e)], '<p>Try <a href="?engine=reference">the reference engine</a> or <a href="?engine=mock">the mock engine</a>.</p>');
    throw e;
  }
  engineEl.textContent = host.label;

  // the variant is built after setKnownValues, so the paper and stock menus list the data packs' stocks
  const def = (await load()).default;
  const built = buildVariant(def, { env: { params: Object.fromEntries(q), dev: q.has('dev') } });
  const errors = built.app.diagnostics.list.filter((d) => d.level === 'error');
  if (errors.length) {
    report(`Build Report: ${def.label}`, errors.map((d) => `${d.code} ${d.message}${d.at ? `  ${d.at.file}:${d.at.line}` : ''}${d.fix ? `\n  fix: ${d.fix}` : ''}`));
    return;
  }

  let kv: KV;
  try {
    kv = q.has('fresh') ? memoryKV() : await openIdb();
  } catch {
    kv = memoryKV();
  }
  const device = q.has('canvas2d') ? null : await presentDevice();
  const studio: Studio = createStudio({ engine: host.engine, kv, displaySpace: 'srgb', ...(host.initial ? { initial: host.initial } : {}) });
  const presenter = hostPresenter({
    device,
    onSpace: (space, why) => {
      studio.bridge.displaySpace = space;
      if (why !== 'display') status(why, { error: true });
    },
  });
  const exportState = { format: 'tiff16' as ExportFormat, space: 'srgb' as (typeof EXPORT_SPACES)[number]['id'] };
  const save = (f: string): Promise<unknown> => exportFrame(f, 'picker');

  root.innerHTML = '';
  const { rt } = await mountStudio(built.app, root, studio, { presenter, save });
  // the presenters exist now: the display space follows the main viewer's canvas
  const vp0 = viewports(rt)[0];
  if (vp0) studio.bridge.displaySpace = vp0.presenter.colorSpace;

  // ── status from the runtime ──
  let rendered = 0;
  rt.on('rendered', (e: { pass: string; viewport: string }) => {
    rendered++;
    status(`rendered ${rendered} · ${e.pass}`);
  });
  rt.on('renderError', (e: { error: unknown }) => status(msgOf(e.error), { error: true }));
  let lastFrame: string | null = null;
  let lastLog: unknown = null;
  rt.store.on(() => {
    const f = studio.current;
    const e = f ? studio.frames.get(f) : undefined;
    if (f !== lastFrame) {
      lastFrame = f;
      notesEl.textContent = e ? host.notes(e.sha).join(' · ') : '';
      notesEl.title = notesEl.textContent;
    }
    // a refusal (E_STALE, …) stays in the status line until the frame's log changes
    const a = rt.store.peek(['ui', 'approvals']) as Record<string, { stale?: { code: string; message: string }[] }> | undefined;
    const stale = Object.values(a ?? {}).flatMap((x) => x.stale ?? []);
    const recipe = f ? rt.store.peek(['recipes', f]) : null;
    if (stale.length && !sticky) status(stale.map((d) => `${d.code}: ${d.message}`).join('; '), { sticky: true, error: true });
    else if (sticky && recipe !== lastLog) sticky = false;
    lastLog = recipe;
  });

  // ── files ──
  async function openFiles(files: PickedFile[]): Promise<void> {
    if (!files.length) {
      status(`no scan files (${SCAN_EXTENSIONS.join(', ')})`, { error: true });
      return;
    }
    let first = true;
    let n = 0;
    for (const pf of files) {
      n++;
      status(`opening ${pf.name}${files.length > 1 ? ` (${n} of ${files.length})` : ''}…`);
      try {
        const bytes = new Uint8Array(await (await pf.file()).arrayBuffer());
        const e = await studio.open(bytes, pf.name);
        if (first) {
          first = false;
          rt.runCommand('frame.select', null, e.id);
          if (rt.app.ir.modules.some((m) => m.id === 'print') && rt.module !== 'print') rt.go('print');
        }
      } catch (err) {
        status(`${pf.name}: ${msgOf(err)}`, { error: true });
        console.error(err);
      }
    }
    if (files.length > 1) status(`opened ${files.length} files`);
  }

  // ── the bar ──
  const fileInput = el('input', { type: 'file', id: 'file', multiple: '', accept: SCAN_EXTENSIONS.map((x) => `.${x}`).join(',') });
  fileInput.addEventListener('change', () => {
    void openFiles(fromFileList(fileInput.files ?? []));
    fileInput.value = '';
  });
  const openBtn = el('label', { class: 'file', for: 'file', title: 'Open scans: TIFF, PNG, DNG, camera RAW', text: 'Open files…' });
  const folderInput = el('input', { type: 'file', id: 'folder', webkitdirectory: '', multiple: '' });
  folderInput.addEventListener('change', () => {
    void openFiles(fromFileList(folderInput.files ?? []));
    folderInput.value = '';
  });
  const folderBtn = el('button', { type: 'button', id: 'open-folder', title: 'Open every scan in a folder', text: 'Open folder…' });
  folderBtn.addEventListener('click', () => {
    if (!hasDirectoryPicker()) return folderInput.click();
    void (async () => {
      try {
        const dir = await pickDirectory();
        await kv.put('handles', 'last-folder', dir);
        reopen.hidden = true;
        await openFiles(await listScans(dir));
      } catch (e) {
        if ((e as Error)?.name !== 'AbortError') status(msgOf(e), { error: true });
      }
    })();
  });
  // the last folder (Chrome keeps the handle; reading it again needs a click)
  const reopen = el('button', { type: 'button', id: 'reopen-folder', text: 'Reopen folder' });
  reopen.hidden = true;
  const lastDir = await kv.get<FileSystemDirectoryHandle>('handles', 'last-folder').catch(() => undefined);
  if (lastDir && hasDirectoryPicker()) {
    reopen.hidden = false;
    reopen.textContent = `Reopen ${lastDir.name}`;
    reopen.title = 'Open the scans of the folder you used last time';
    reopen.addEventListener('click', () => {
      void (async () => {
        if (!(await reconnect(lastDir))) return status(`no access to ${lastDir.name}`, { error: true });
        reopen.hidden = true;
        await openFiles(await listScans(lastDir));
      })();
    });
  }
  const undo = el('button', { type: 'button', id: 'undo', title: 'Undo (Ctrl+Z)', text: 'Undo' });
  undo.addEventListener('click', () => rt.runCommand('edit.undo', null));
  const redo = el('button', { type: 'button', id: 'redo', title: 'Redo (Shift+Ctrl+Z)', text: 'Redo' });
  redo.addEventListener('click', () => rt.runCommand('edit.redo', null));
  const exp = el('button', { type: 'button', id: 'export', class: 'primary', title: `Export the print${pickerAvailable() ? ' (you choose where)' : ' (downloaded)'}`, text: 'Export' });
  exp.addEventListener('click', () => void rt.runCommand('output.save', null));
  const fmt = el('select', { id: 'export-format', 'aria-label': 'Export format' }, ...EXPORT_FORMATS.map((f) => el('option', { value: f.id, text: f.label })));
  fmt.addEventListener('change', () => void (exportState.format = fmt.value as ExportFormat));
  const space = el('select', { id: 'export-space', 'aria-label': 'Export colour space' }, ...EXPORT_SPACES.map((f) => el('option', { value: f.id, text: f.label })));
  space.addEventListener('change', () => void (exportState.space = space.value as typeof exportState.space));
  const saveRecipe = el('button', { type: 'button', id: 'save-recipe', title: 'Download the recipe and its history as JSON (it is also kept in the browser, by the file’s hash)', text: 'Save recipe' });
  saveRecipe.addEventListener('click', () => {
    const r = recipeJson();
    if (r) download(new Blob([r.json], { type: 'application/json' }), r.fileName);
  });
  const variantSel = el('select', { id: 'variant', 'aria-label': 'Studio layout', title: 'Studio layout (variant)' }, ...Object.keys(VARIANTS).map((v) => el('option', { value: v, text: v })));
  variantSel.value = def.id;
  variantSel.addEventListener('change', () => {
    const u = new URL(location.href);
    u.searchParams.set('variant', variantSel.value);
    location.href = u.toString();
  });
  const offline = el('span', { id: 'offline-state', class: 'small' });
  const kids: (Node | string)[] = [el('span', { class: 'brand' }, 'Chromobench ', el('i', { text: def.label })), fileInput, openBtn, folderInput, folderBtn, reopen, el('span', { class: 'sep' }), undo, redo, el('span', { class: 'sep' }), exp, fmt, space, saveRecipe];
  if (host.settings) {
    const dust = el('input', { type: 'checkbox', id: 'dust' });
    dust.addEventListener('change', () => void (host.settings!.dust = dust.checked));
    kids.push(el('label', { for: 'dust', title: 'Detect and heal dust specks when a scan is opened (slow on big scans)' }, dust, ' dust'));
  }
  kids.push(el('span', { class: 'sp' }), offline, el('label', { for: 'variant', text: 'Layout' }), variantSel);
  barEl.append(...kids);

  // ── export and the recipe ──
  function recipeJson(): { json: string; fileName: string } | null {
    const f = studio.current;
    const e = f ? studio.frames.get(f) : undefined;
    if (!e) return null;
    return { json: JSON.stringify(e.log.toJSON(), null, 2), fileName: `${e.name.replace(/\.[^.]+$/, '')}.chromobench.json` };
  }
  async function exportFrame(f: string, to: 'picker' | 'memory', o: { format?: ExportFormat; space?: typeof exportState.space } = {}) {
    const e = studio.frames.get(f);
    if (!e) return null;
    studio.route.endBurst();
    const format = o.format ?? exportState.format;
    const sp = o.space ?? exportState.space;
    try {
      status('exporting…', { sticky: true });
      const x = await exportPrint({
        engine: studio.engine, graph: e.graph, recipe: e.log.committed, name: e.name, format, space: sp, to,
        onProgress: (p) => status(`exporting: ${p.phase}${p.tilesTotal > 1 ? ` ${p.tilesDone}/${p.tilesTotal}` : ''}`, { sticky: true }),
      });
      status(`exported ${x.name} · ${x.width}×${x.height} · ${x.bits}-bit ${EXPORT_SPACES.find((s) => s.id === sp)?.label ?? sp}`, { sticky: true });
      return x;
    } catch (err) {
      const cancelled = (err as Error)?.name === 'AbortError' || /E_CANCELLED/.test(msgOf(err));
      status(cancelled ? 'export cancelled' : `export failed: ${msgOf(err)}`, { error: !cancelled, sticky: true });
      return null;
    }
  }

  // ── service worker (offline start) ──
  if ('serviceWorker' in navigator && !q.has('nosw')) {
    void navigator.serviceWorker.register('/sw.js').then((reg) => {
      const ready = (): void => void (offline.textContent = 'offline ready');
      if (navigator.serviceWorker.controller) ready();
      else offline.textContent = 'caching…';
      navigator.serviceWorker.addEventListener('controllerchange', ready);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offline.textContent = 'update ready: reload';
        });
      });
    }).catch(() => undefined);
  }

  hook(rt, studio, def.id, host, exportFrame);
  status('ready: open a scan (Open files…)');
  for (const d of built.app.diagnostics.list) if (d.level === 'warning') console.warn(d.code, d.message);
  document.body.dataset['ready'] = '1';
  document.body.dataset['variant'] = def.id;
}

/** the mounted viewports, the visible ones first */
function viewports(rt: Runtime): DomViewport[] {
  const all = [...(rt.viewports as Map<string, DomViewport>).values()];
  return all.sort((a, b) => Number(b.el.isConnected && b.el.offsetParent !== null) - Number(a.el.isConnected && a.el.offsetParent !== null));
}

type ExportFn = (f: string, to: 'picker' | 'memory', o?: { format?: ExportFormat; space?: 'srgb' | 'display-p3' | 'adobe-rgb' | 'prophoto' }) => Promise<{ width: number; height: number; bytes: number; mime: string; name: string; bits: number } | null>;

function hook(rt: Runtime, studio: Studio, variant: string, host: Host, exportFrame: ExportFn): void {
  window.chromobench = makeHook(rt, studio, variant, host, exportFrame);
}

/** The test and agent hook (CHB-009's surface on studio-kit; CHB-007/008 replace propose with a real DSL eval). */
function makeHook(rt: Runtime, studio: Studio, variant: string, host: Host, exportFrame: ExportFn) {
  const cur = (): string => studio.current ?? '';
  const vp = (): DomViewport | null => viewports(rt)[0] ?? null;
  const idle = async (): Promise<void> => {
    for (let i = 0; i < 3; i++) {
      await rt.settle();
      await studio.flush();
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  const recipePath = (f: string, path: string): string[] => ['recipes', f, ...path.split('.')];
  const h = {
    app: rt.app,
    rt,
    studio,
    variant,
    get engine() {
      return studio.engine;
    },
    /** engine label as the status line shows it */
    get engineLabel(): string {
      return host.label;
    },
    /** the selected frame's EditLog */
    get log() {
      return studio.frames.get(cur())?.log ?? null;
    },
    /** the selected frame's source size */
    size: () => {
      const e = studio.frames.get(cur());
      return e ? { width: e.info.width, height: e.info.height } : null;
    },
    explain: () => rt.explain({ live: true }),
    run: (cmd: string, ...a: unknown[]) => rt.runCommand(cmd, null, ...a),
    state: () => rt.store.peek([]),
    /** waits for renders, log writes and queued frames */
    idle,
    /** one transaction by the user: set(path, value) on the selected frame */
    set(path: string, value: unknown, label = path): void {
      rt.ctx().tx(label, (t: { $set(p: string[], v: unknown): void }) => t.$set(recipePath(cur(), path), value));
    },
    /** select a tool on the viewer ('test-strip', 'ring-around', 'probe', …; null: none) */
    tool: (id: string | null) => rt.selectTool(id),
    /** the node id the main viewer shows for the selected frame's print (the ring-around centre tile is this node) */
    printNode(): string | null {
      const f = cur();
      const r = rt.store.peek(['recipes', f]);
      return r ? studio.bridge.key(frameRef(f, r as never).print()) : null;
    },
    /** display-encoded value of a document pixel in the main viewer's last presented render */
    pixel(x: number, y: number): number[] | null {
      const l = vp()?.shown().image;
      if (!l) return null;
      const tx = Math.floor((x - l.region.x) * l.scale);
      const ty = Math.floor((y - l.region.y) * l.scale);
      if (tx < 0 || ty < 0 || tx >= l.width || ty >= l.height) return null;
      const i = (ty * l.width + tx) * l.channels;
      return [0, 1, 2].map((k) => Number(l.data[i + Math.min(k, l.channels - 1)]));
    },
    /** the 8-bit value the presenter shows for a document pixel, read back from its pipeline */
    canvasPixel: (x: number, y: number): Promise<number[] | null> => vp()?.presenter.readDocPixel(x, y) ?? Promise.resolve(null),
    presenter: () => {
      const p = vp()?.presenter;
      return p ? `${p.kind} · ${p.colorSpace}` : null;
    },
    /** how often the engine computed each node of the selected frame's display chain (MockEngine counts) */
    chainRuns(): { op: string; runs: number }[] {
      const f = cur();
      const e = studio.frames.get(f);
      const runs = (studio.engine as Engine & { runs?: (id: string) => number }).runs;
      const r = rt.store.peek(['recipes', f]);
      if (!e || !runs || !r) return [];
      const top = studio.bridge.lower(frameRef(f, r as never).print()).shown;
      return e.graph.closure(top.id).map((d) => ({ op: d.op, runs: runs.call(studio.engine, e.graph.adopt([d]).at(-1)!.id) }));
    },
    /** densitometer readings at a source pixel of the selected frame's print */
    measure: (x: number, y: number) => {
      const f = cur();
      const r = rt.store.peek(['recipes', f]);
      return r ? studio.measure(f, r as never, x, y) : Promise.resolve(null);
    },
    /** exports the selected frame's print into memory; returns its description, not the bytes */
    async exportPng(space: 'srgb' | 'display-p3' = 'srgb', format: ExportFormat = 'png8') {
      const x = await exportFrame(cur(), 'memory', { format, space });
      return x ? { width: x.width, height: x.height, bytes: x.bytes, type: x.mime, fileName: x.name, bits: x.bits } : null;
    },
    /**
     * Frame times on this machine (CHB-023 stage 5): `steps` drag previews of the enlarger time (draft pass), one
     * screen pass after release, and an export at the working size. With a scan open: `await chromobench.bench()`.
     */
    async bench(steps = 12) {
      const f = cur();
      const e = studio.frames.get(f);
      if (!e) return null;
      await idle();
      const t0 = e.log.state.print.enlarger.time_s;
      const path = recipePath(f, 'print.enlarger.time_s');
      const drafts: number[] = [];
      for (let i = 0; i < steps; i++) {
        const a = performance.now();
        rt.store.preview(path, Number((t0 * 2 ** ((i % 2 ? 1 : -1) / 6)).toFixed(3)));
        await idle();
        drafts.push(performance.now() - a);
      }
      const b = performance.now();
      rt.store.cancel();
      await idle();
      const screen = performance.now() - b;
      const c = performance.now();
      const x = await exportFrame(f, 'memory', { format: 'png8', space: 'srgb' });
      const exportMs = performance.now() - c;
      drafts.sort((p, q2) => p - q2);
      return {
        engine: host.label, frame: `${e.info.width}×${e.info.height}`, draftMedianMs: Math.round(drafts[drafts.length >> 1]!), draftMaxMs: Math.round(drafts.at(-1)!),
        screenMs: Math.round(screen), exportMs: Math.round(exportMs), exported: x ? `${x.width}×${x.height}` : null,
      };
    },
    /** frame.edit({path: value}) or mutations from an eval: one tx, by 'agent' */
    propose(edits: Record<string, unknown> | Mutation[], why?: string): LoggedMutation[] {
      const ms: Mutation[] = Array.isArray(edits) ? edits : Object.entries(edits).map(([path, value]) => ({ op: 'set', path, value }));
      return studio.propose(ms, why ? { why } : {});
    },
    chainRunsByShown: () => Object.fromEntries(studio.bridge.runs),
  };
  return h;
}

declare global {
  interface Window {
    chromobench: ReturnType<typeof makeHook>;
  }
}

main().catch((e) => {
  console.error(e);
  if (document.body.dataset['ready'] !== 'report') report('The studio failed to start', [String((e as Error)?.stack ?? e)]);
});
