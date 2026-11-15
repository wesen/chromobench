// The studio host (CHB-019 guide §7.1; CHB-023's real-engine wiring): boot the engine, open IndexedDB, build the
// layout (?layout=, default classic), mount it with studio-kit's services plus the WebGPU presenter, the export
// and the first print, and wire the host frame around it (files, export, status line) and the test/agent hook
// window.chromobench.
//
// URL options: ?layout=classic|darkroom|simple|lab|tiny; ?engine=auto (GPU when WebGPU works, else the reference
// engine) | gpu | reference | mock; ?long=N (GPU working image long side, 0 = the file's own size); ?refLong=N (the
// reference engine's, default 640); ?refMode=exact|tabulated (the reference engine's physics: tabulated previews by default); ?worker=0 (decode and the reference engine on the main thread); ?canvas2d
// (present without WebGPU); ?nosw (no service worker); ?fresh (a KV in memory: nothing saved).
//
// CHB-037 P5b-1: a frame's edit is its format-3 document in the store's log (docs.<frame>); the first print, dust
// and export work on documents; the stored data of earlier versions is cleared once at start (resetStorage).
import { closest, edit, type Document, type Engine } from '@chromobench/contract';
import { insert, type Mutation } from '@chromobench/values';
import { MockEngine } from '@chromobench/engine-mock';
import { documentPayload, pickerAvailable } from '@chromobench/output';
import type { PresentImage, Runtime } from '@chromobench/shell';
import '@chromobench/shell/shell.css';
import {
  buildLayout, createStudio, DOCS, DUST, explainError, frameRef, liftComponents, mainExposure, memoryKV, modelAt, read, resetStorage, sel, setKnownValues,
  STORAGE_RESET_MESSAGE, storePath, TIME_PATH,
  type CatalogFrame, type FrameEntry, type InitialDocument, type KV, type OpenAs, type SourceOpener, type Studio, type StudioHost,
} from '@chromobench/studio-kit';
import { Canvas2DPresenter, mount, type DomServices, type DomViewport, type Mounted } from '@chromobench/shell/dom';
import { CB_RENDERERS } from '@chromobench/studio-kit/dom';
import { ROLL_RENDERERS } from '@chromobench/studio-kit/kits/roll/dom';
import '@chromobench/studio-kit/kits/roll/roll.css';
import '@chromobench/studio-kit/studio-kit.css';
import { CHAT_RENDERERS } from '@chromobench/studio-kit/kits/chat/dom';
import '@chromobench/studio-kit/kits/chat/chat.css';
import { LOOKS_RENDERERS } from '@chromobench/studio-kit/kits/looks/dom';
import '@chromobench/studio-kit/kits/looks/looks.css';
import { chromogen, craftkit, resolveTheme, type Runtime as ShellRuntime } from '@chromobench/shell';
import { themeHandle } from '@chromobench/shell/dom';
import { DEFAULT_LAYOUT, LAYOUTS, type LayoutId } from '@chromobench/studio-kit/layouts';
import { lazyChat, type BridgeLike, type LazyChat } from './host/lazy-chat.ts';
import { engineSummary, engineTip, guessWhy, notesSummary, notesTip, passWords, plainError } from './status-text.ts';
import { download, EXPORT_FORMATS, EXPORT_SPACES, exportPrint, type ExportFormat } from './host/export.ts';
import { firstPrint, firstPrintAim, photoDocument, withMeasured } from './host/first-print.ts';
import type { HostSettings } from './host/engines.ts';
import type { AskOpenMode, OpenGuess, StudioEngine } from './host/studio-engine.ts';
import { hostPresenter, presentDevice } from './present/host-presenter.ts';
import { openIdb } from './storage/db.ts';
import { addScanExtensions, fromFileList, fromHandles, hasDirectoryPicker, hasFilePicker, isScan, listScans, pickDirectory, pickFiles, reconnect, SCAN_EXTENSIONS, type PickedFile } from './storage/fsa.ts';
import './app.css';

const q = new URLSearchParams(location.search);
const root = document.getElementById('app')!;
const statusBarEl = document.getElementById('statusbar')!;

// ── theme boot (CHB-025): the last theme and interface gray, mirrored from prefs into localStorage, paint the host
// frame before the studio mounts; after that the shell writes the theme on <html> (themeRoot) from prefs ──
const THEME_KEY = 'chromobench.theme';
const bootTheme = ((): { dispose(): void } => {
  let saved: { theme?: string; gray?: string } = {};
  try {
    saved = JSON.parse(localStorage.getItem(THEME_KEY) ?? '{}') as typeof saved;
  } catch {
    /* no storage: CraftKit */
  }
  const h = themeHandle(document.documentElement, craftkit);
  h.set(resolveTheme(new Map([craftkit, chromogen].map((t) => [t.name, t])), saved.theme), saved.gray ?? 'auto');
  return h;
})();
function mirrorTheme(rt: ShellRuntime): void {
  rt.cell(
    (s: { prefs?: { gray?: string } }) => `${rt.themeName(s)}|${s.prefs?.gray || 'auto'}`,
    (v: string) => {
      const [theme, gray] = v.split('|');
      try {
        localStorage.setItem(THEME_KEY, JSON.stringify({ theme, gray }));
      } catch {
        /* no storage */
      }
    },
  );
}

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
/** an error's message without its code: the code goes to the "Technical:" line of the tooltip (CHB-031 F35) */
const plainMsg = (e: unknown): string => plainError(msgOf(e));

// ── the status line (exists before anything else, so the boot can talk) ──
const engineEl = el('span', { id: 'engine', class: 'pill', title: 'The engine that computes the prints' });
const notesEl = el('span', { id: 'notes' });
const statusEl = el('span', { id: 'status', role: 'status', text: 'starting…' });
statusBarEl.append(engineEl, notesEl, statusEl);
let sticky = false;
function status(text: string, o: { error?: boolean; sticky?: boolean; detail?: string } = {}): void {
  if (sticky && !o.sticky && !o.error) return;
  statusEl.textContent = text;
  statusEl.title = o.detail ?? '';
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
  initial?: InitialDocument;
  notes(sha: string): string[];
  settings: HostSettings | null;
  /** The roll kit's physics service; the mock engine has none (the Roll panels say so). */
  rollPhysics?: unknown;
  /** The stack kit's editors' numbers (core's curve, levels and encodings); the mock engine has none. */
  editorMath?: unknown;
  /** Opens a file as a photo, a negative or as guessed (CHB-027); the mock engine opens everything as a negative. */
  opener?: SourceOpener;
  /** What the pixels of an open file look like (the guess), for the "looks like a negative" hint (F15). */
  guess(sha: string): OpenGuess | null;
}

/** Asks the photographer when a guess is unsure; set for the length of one open batch (one question per batch). */
let askOpen: AskOpenMode | undefined;

async function startEngine(): Promise<Host> {
  const want = q.get('engine') ?? 'auto';
  if (want === 'mock') return { engine: new MockEngine(), label: 'mock engine (no physics)', notes: () => [], settings: null, guess: () => null };
  const { createHostEngine } = await import('./host/engines.ts');
  const long = q.get('long');
  const refLong = q.get('refLong');
  const refMode = q.get('refMode');
  const h = await createHostEngine({
    ...(refMode === 'exact' || refMode === 'tabulated' ? { refMode } : {}),
    want: want === 'gpu' || want === 'reference' ? want : 'auto', ...(long !== null ? { long: Number(long) } : {}), ...(refLong !== null ? { refLong: Number(refLong) } : {}),
    worker: q.get('worker') !== '0', onStatus: (s) => status(s),
  });
  setKnownValues(h.catalog);
  addScanExtensions(h.extensions);
  const se: StudioEngine = h.engine;
  return {
    engine: se,
    label: se.label,
    // the first print of a negative and (F31) of a photo, its colour from the camera's white balance (FIRST_PRINT_AIM;
    // ?alpha, ?subjectFailure try another aim for negatives, ?photoDensity for photos). ?filtration=1: the colour goes
    // into the enlarger's filtration and time (CHB-010 bake), not the printer lights
    initial: async (d, g) => {
      const n = se.notes.get(d.source.sha256);
      const doc = n?.kind === 'digital-raw' ? photoDocument(d, n.info.camera?.asShotNeutral !== undefined) : withMeasured(d, n);
      // CHB-034 fusz: metered on the file's analysis image, so both engines propose the same Time
      const kind = doc.stages.scan ? 'negative-scan' : 'digital-raw';
      const fp = await firstPrint(se, g, doc, { integrate: h.integrate, aim: firstPrintAim(kind, (k) => q.get(k)), analysis: se.analysisOf(doc.source.sha256), ...(q.get('filtration') === '1' ? { bake: h.bake } : {}) });
      // Heal Dust: the specks the decode found are scan-stage heal layers in a Dust group (a strip frame takes the
      // specks on its own frame), so the photographer sees them, turns them off and undoes them
      const crop = fp.geometry.crop;
      const spots = (n?.dust ?? []).filter((p) => !crop || (p.x >= crop.x - p.r && p.y >= crop.y - p.r && p.x <= crop.x + crop.w + p.r && p.y <= crop.y + crop.h + p.r));
      return spots.length && fp.stages.scan ? edit(fp, [insert('stages.scan.stack', DUST, h.dustGroup(spots))]).doc : fp;
    },
    notes: (sha) => se.notes.get(sha)?.notes ?? [],
    settings: h.settings,
    rollPhysics: h.rollPhysics,
    editorMath: h.editorMath,
    opener: (src, as) => se.openAs(src, as, askOpen),
    guess: (sha) => se.notes.get(sha)?.guess ?? null,
  };
}

async function main(): Promise<void> {
  const id = q.get('layout') ?? DEFAULT_LAYOUT;
  const load = LAYOUTS[id as LayoutId];
  if (!load) {
    const guess = closest(id, Object.keys(LAYOUTS));
    report(`Unknown layout '${id}'`, [`?layout=${id} is not a registered layout.`, guess ? `Did you mean ?layout=${guess}?` : '', `Layouts: ${Object.keys(LAYOUTS).join(', ')}`]);
    return;
  }
  status('starting the engine…');
  let host: Host;
  try {
    host = await startEngine();
  } catch (e) {
    status(`the engine did not start: ${plainMsg(e)}`, { error: true, detail: `Technical: ${msgOf(e)}` });
    report('The engine did not start', [msgOf(e)], '<p>Try <a href="?engine=reference">the reference engine</a> or <a href="?engine=mock">the mock engine</a>.</p>');
    throw e;
  }
  // the status line in his words; the technical label stays in the tooltip and data-engine (CHB-027 F9)
  engineEl.textContent = engineSummary(host.label);
  engineEl.title = engineTip(host.label);
  engineEl.dataset['engine'] = host.label;

  // the layout is built after setKnownValues, so the paper and stock menus list the data packs' stocks; View ▸
  // Layout builds another one in place (CHB-031 F24)
  let def = (await load()).default;
  let built = buildLayout(def, { env: { params: Object.fromEntries(q), dev: q.has('dev') } });
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
  // the hard cut-off (CHB-037, design D8): edits saved by an earlier studio are cleared once, and he is told
  const storageReset = await resetStorage(kv).catch(() => false);
  const device = q.has('canvas2d') ? null : await presentDevice();
  // the layout's enlarger mode for new documents (CHB-031: real by default, normalised in simple and tiny)
  const studio: Studio = createStudio({ engine: host.engine, kv, displaySpace: 'srgb', enlarger: def.enlarger ?? 'real', ...(host.initial ? { initial: host.initial } : {}), ...(host.opener ? { opener: host.opener } : {}) });
  let rtNow: Runtime | null = null;
  const chat: LazyChat = lazyChat(studio, (message, err) => {
    console.warn(message, err);
    rtNow?.diagnostics.warn('CB-H420', message, { runtime: true, facts: err ? [msgOf(err)] : [] });
    rtNow?.chrome.toast(message, { kind: 'warn', ms: 5000, ...(err ? { detail: `Technical: ${msgOf(err)}` } : {}) });
  });
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
  bootTheme.dispose();
  const mountOpts = { presenter, save, chat, themeRoot: document.documentElement, renderers: { ...ROLL_RENDERERS, ...LOOKS_RENDERERS, ...CHAT_RENDERERS }, ...(host.rollPhysics ? { rollPhysics: host.rollPhysics } : {}), ...(host.editorMath ? { editorMath: host.editorMath } : {}) };
  /**
   * Mounts a built layout with the studio's services and renderers, then attaches the studio (studio-kit's
   * mountStudio, in two halves): `adopt` takes over the log and the mounted documents of the runtime before (View ▸
   * Layout), before the studio attaches, so the open frames are not opened again in the new runtime.
   */
  const mountLayout = async (app: typeof built.app, adopt?: Runtime): Promise<Mounted<unknown>> => {
    const services = studio.services(mountOpts) as DomServices;
    services.renderers = { ...CB_RENDERERS, ...(mountOpts.renderers ?? {}) };
    const m = await mount(app, root, services);
    if (adopt) m.rt.store.adopt(adopt.store);
    studio.attach(m.rt);
    return m;
  };
  let mounted = await mountLayout(built.app);
  // the runtime of the layout on screen: View ▸ Layout replaces it (switchLayout), and everything below that is
  // wired to a runtime is registered with eachMount, which runs it now and again for the next runtime (F24)
  let rt = mounted.rt;
  rtNow = rt;
  if (storageReset) rt.chrome.toast(STORAGE_RESET_MESSAGE, { kind: 'info', ms: 12000 });
  const perMount: (() => void)[] = [];
  const eachMount = (f: () => void): void => {
    perMount.push(f);
    f();
  };
  if (host.settings) studio.bridge.draftTargetMs = 150;
  eachMount(() => {
    mirrorTheme(rt);
    chat.attach(rt);
    // CHB-027 (F4): on a real engine, drags show drafts sized to ≈150 ms, and a slow engine still shows one
    // render per 250 ms while the hand moves (else every move would abort the render in flight)
    if (host.settings) {
      rt.renders.progressMs = 250;
      rt.renders.preemptBackground = true;
    }
  });
  // external agents: a bridge serving this page (or ?bridge=ws://127.0.0.1:7341/ws/page from the dev server)
  const bridgeEl = el('span', { id: 'bridge', class: 'pill', title: 'External agents (Claude Code, Claude Desktop) through chromobench serve' });
  bridgeEl.hidden = true;
  statusBarEl.insertBefore(bridgeEl, notesEl);
  const bridge = await startBridge(chat, (s) => {
    bridgeEl.hidden = false;
    bridgeEl.textContent = `agents: ${s}`;
  });
  // the presenters exist now: the display space follows the main viewer's canvas
  eachMount(() => {
    const vp0 = viewports(rt)[0];
    if (vp0) studio.bridge.displaySpace = vp0.presenter.colorSpace;
  });

  // ── status from the runtime ──
  let rendered = 0;
  eachMount(() => {
    rt.on('rendered', (e: { pass: string; viewport: string }) => {
      rendered++;
      // the pass in plain words (CHB-031 F35), its name in the tooltip
      status(`rendered ${rendered} · ${passWords(e.pass)}`, { detail: `Technical: ${e.pass} pass` });
    });
    rt.on('renderError', (e: { error: unknown }) => status(explainError(e.error)?.text ?? plainMsg(e.error), { error: true, detail: `Technical: ${msgOf(e.error)}` }));
  });
  let lastFrame: string | null = null;
  let lastEntry: FrameEntry | undefined;
  let lastMode = studio.mode;
  let lastLog: unknown = null;
  eachMount(() => {
    lastFrame = null;
    lastEntry = undefined;
    rt.store.on(onStore);
  });
  function onStore(): void {
    const f = studio.current;
    const e = f ? studio.frames.get(f) : undefined;
    if (bridge && (f !== lastFrame || studio.mode !== lastMode)) {
      lastMode = studio.mode;
      bridge.update();
    }
    if (f !== lastFrame || e !== lastEntry) {
      lastFrame = f;
      lastEntry = e;
      const notes = e ? host.notes(e.sha) : [];
      notesEl.textContent = notesSummary(notes);
      notesEl.title = notesTip(notes);
      showMode(e);
    }
    // a refusal (E_STALE, …) stays in the status line until the frame's log changes
    const a = rt.store.peek(['ui', 'approvals']) as Record<string, { stale?: { code: string; message: string }[] }> | undefined;
    const stale = Object.values(a ?? {}).flatMap((x) => x.stale ?? []);
    const doc = f ? rt.store.peek([DOCS, f]) : null;
    if (stale.length && !sticky) status(explainError({ diag: stale[0] })?.text ?? stale[0]!.message, { sticky: true, error: true, detail: `Technical: ${stale.map((d) => `${d.code}: ${d.message}`).join('; ')}` });
    else if (sticky && doc !== lastLog) sticky = false;
    lastLog = doc;
  }

  // ── the frame's mode in the status line (CHB-027): Photo / Negative, a click re-opens it the other way (F3, F6);
  //    a hint when the pixels say otherwise (F15) ──
  const modeEl = el('button', { type: 'button', id: 'frame-mode', class: 'pill' });
  modeEl.hidden = true;
  const hintEl = el('button', { type: 'button', id: 'mode-hint', class: 'pill is-hint' });
  hintEl.hidden = true;
  statusBarEl.insertBefore(hintEl, notesEl);
  statusBarEl.insertBefore(modeEl, hintEl);
  const asWord = (k: FrameEntry['kind']): 'photo' | 'negative' => (k === 'digital-raw' ? 'photo' : 'negative');
  function showMode(e: FrameEntry | undefined): void {
    modeEl.hidden = !e;
    hintEl.hidden = true;
    if (!e) return;
    const now = asWord(e.kind);
    const other = now === 'photo' ? 'negative' : 'photo';
    modeEl.textContent = now === 'photo' ? 'Photo' : 'Negative';
    modeEl.title = `${e.name} is open as a ${now}. Click to re-open it as a ${other} (Frame ▸ Re-open as ${other === 'photo' ? 'Photo' : 'Negative'}).`;
    modeEl.dataset['mode'] = now;
    const g = host.guess(e.sha);
    if (g && g.kind !== now) {
      hintEl.hidden = false;
      hintEl.textContent = `Looks like a ${g.kind}: re-open as ${g.kind}?`;
      hintEl.title = `${guessWhy(g.why)} Click to re-open ${e.name} as a ${g.kind}.`;
      hintEl.dataset['mode'] = g.kind;
    }
  }
  const reopenOther = (to: string | undefined): void => {
    if (to === 'photo' || to === 'negative') void rt.runCommand(to === 'photo' ? 'frame.reopenAsPhoto' : 'frame.reopenAsNegative', null);
  };
  modeEl.addEventListener('click', () => reopenOther(modeEl.dataset['mode'] === 'photo' ? 'negative' : 'photo'));
  hintEl.addEventListener('click', () => reopenOther(hintEl.dataset['mode']));

  // ── files ──
  const openAsPref = (): OpenAs => ((rt.store.peek(['prefs', 'openAs']) as OpenAs | undefined) ?? 'auto');
  // ── File ▸ Open As in the status line while it is not Guess (CHB-031 F18): new files open that way, not guessed ──
  const openAsEl = el('button', { type: 'button', id: 'open-as', class: 'pill is-hint' });
  openAsEl.hidden = true;
  statusBarEl.insertBefore(openAsEl, modeEl);
  let shownAs = '';
  const showOpenAs = (): void => {
    const a = openAsPref();
    if (a === shownAs) return;
    shownAs = a;
    openAsEl.hidden = a === 'auto';
    openAsEl.dataset['as'] = a;
    openAsEl.textContent = a === 'photo' ? 'Opening as photos' : 'Opening as negatives';
    openAsEl.title = `File ▸ Open As: files you open now open as ${a === 'photo' ? 'photos' : 'negatives'}, not guessed. Click to let the studio guess again.`;
  };
  eachMount(() => {
    shownAs = '';
    rt.store.on(showOpenAs);
  });
  openAsEl.addEventListener('click', () => void rt.runCommand('file.openAs.auto', null));

  /** One question per open batch when a guess is unsure (F1): photos from a camera, or scans of negatives? */
  async function askMode(g: OpenGuess, name: string, count: number): Promise<'photo' | 'negative'> {
    const body = el('div', {},
      el('p', { text: `${count > 1 ? `${name} and the other files` : name}: ${guessWhy(g.why, false)}` }),
      el('p', { text: 'Are these photos from a camera, or scans of negatives?' }));
    const r = await rt.chrome.dialog({
      title: count > 1 ? 'Photos or negatives?' : 'Photo or negative?',
      body,
      buttons: [
        { label: 'Photos from a camera', value: 'photo', primary: g.kind === 'photo' },
        { label: 'Scans of negatives', value: 'negative', primary: g.kind === 'negative' },
      ],
    }).result;
    return r === 'photo' || r === 'negative' ? r : g.kind;
  }
  /** The file is open the other way: re-open it as asked? (F2: never a silent no-op) */
  async function confirmReopen(e: FrameEntry, want: 'photo' | 'negative'): Promise<boolean> {
    const now = asWord(e.kind);
    const r = await rt.chrome.dialog({
      title: `${e.name} is open as a ${now}`,
      body: el('p', { text: `Re-open it as a ${want}? What you did to it as a ${now} is kept: re-opening it as a ${now} brings it back.` }),
      buttons: [{ label: `Keep it as a ${now}`, value: 'keep' }, { label: `Re-open as a ${want}`, value: 'reopen', primary: true }],
    }).result;
    return r === 'reopen';
  }
  /** the library frame whose file "Where is …?" asked for last: an open of that file selects it (F26) */
  let asking: string | null = null;
  /** the open "Where is …?" dialog (a layout switch closes it) */
  let whereIs: { close(): void } | null = null;
  /**
   * Opens files as File ▸ Open As says (Auto guesses each file; one question per batch when unsure). The status line
   * always ends with what happened (F2): opened, already open, or the error.
   */
  async function openFiles(files: PickedFile[], o: { as?: OpenAs; expect?: CatalogFrame } = {}): Promise<void> {
    if (!files.length) {
      status(`no photos or scans among the files (${SCAN_EXTENSIONS.join(', ')})`, { error: true });
      return;
    }
    const as = o.as ?? openAsPref();
    // how the library had each file before this open (F18: say so when Open As overrides it)
    const libKind = new Map(Object.values((rt.store.peek(['catalog', 'frames']) as Record<string, CatalogFrame> | undefined) ?? {}).map((c) => [c.sha256, c.kind]));
    let answer: Promise<'photo' | 'negative'> | null = null;
    askOpen = (g, name) => (answer ??= askMode(g, name, files.length));
    const opened: string[] = [];
    const already: string[] = [];
    const failed: string[] = [];
    const details: string[] = [];
    let first = true;
    let n = 0;
    try {
      for (const pf of files) {
        n++;
        status(`opening ${pf.name}${files.length > 1 ? ` (${n} of ${files.length})` : ''}…`);
        try {
          const read = async (): Promise<Uint8Array> => new Uint8Array(await (await pf.file()).arrayBuffer());
          let r = await studio.openFile(await read(), pf.name, { as, read });
          if (r.outcome === 'conflict' && as !== 'auto') {
            if (await confirmReopen(r.entry, as)) r = await studio.reopen(r.entry.id, as);
            else r = { ...r, outcome: 'already' };
          }
          if (r.outcome === 'already' || r.outcome === 'conflict') {
            already.push(pf.name);
            rt.chrome.toast(`${pf.name} is already open (as a ${asWord(r.entry.kind)})`, { kind: 'info' });
          } else {
            opened.push(r.entries.length > 1 ? `${pf.name} (${r.entries.length} frames)` : pf.name);
            const was = libKind.get(r.entry.sha);
            if (as !== 'auto' && was && was !== asWord(r.entry.kind)) {
              rt.chrome.toast(`${pf.name} opened as a ${asWord(r.entry.kind)} (File ▸ Open As); your library had it as a ${was}: Frame ▸ Re-open as ${was === 'photo' ? 'Photo' : 'Negative'} brings that back`, { kind: 'info' });
            }
          }
          if (pf.handle) void kv.put('handles', `file:${r.entry.sha}`, pf.handle).catch(() => undefined);
          if (o.expect && o.expect.sha256 !== r.entry.sha) rt.chrome.toast(`${pf.name} is not the file ${o.expect.name} was made from: it opened as a frame of its own`, { kind: 'warn' });
          if (first) {
            first = false;
            // the frame he asked for when it is on this file ("Where is raw010.dng?" for its frame 2), else the first
            const asked = asking && r.entries.some((x) => x.id === asking) ? asking : null;
            if (asked) asking = null;
            rt.runCommand('frame.select', null, asked ?? r.entry.id);
            if (rt.app.ir.modules.some((m) => m.id === 'print') && rt.module !== 'print') rt.go('print');
          }
        } catch (err) {
          // in his words (WS-C's explainError), the technical text in the tooltip
          failed.push(`${pf.name}: ${rt.explainError?.(err, {})?.text ?? plainMsg(err)}`);
          details.push(`${pf.name}: ${msgOf(err)}`);
          console.error(err);
        }
      }
    } finally {
      askOpen = undefined;
    }
    const parts: string[] = [];
    if (opened.length) parts.push(opened.length === 1 ? `opened ${opened[0]}` : `opened ${opened.length} files`);
    if (already.length) parts.push(already.length === 1 ? `${already[0]} was already open` : `${already.length} were already open`);
    if (failed.length) parts.push(failed.length === 1 ? failed[0]! : `${failed.length} could not be opened (${failed[0]})`);
    status(parts.join(' · ') || 'nothing opened', { error: failed.length > 0 && !opened.length && !already.length, ...(details.length ? { detail: `Technical: ${details.join('\n')}` } : {}) });
  }

  // ── the library across reloads (F5): a thumbnail of each frame's print is kept in its catalog entry; a frame not
  //    open in this session is read again through its file handle (one permission click) or located by him ──
  const thumbTimers = new Map<string, ReturnType<typeof setTimeout>>();
  function scheduleThumb(id: string, ms = 2000, tries = 6): void {
    clearTimeout(thumbTimers.get(id));
    thumbTimers.set(id, setTimeout(() => {
      thumbTimers.delete(id);
      const r = rt.store.peek([DOCS, id]) as Document | undefined;
      if (!r) return;
      // the filmstrip's own thumbnail from the shell's thumbnail cache (same key and size). Only a cache hit: asking
      // for a render here as well made a second evaluation of the same node race the filmstrip's, and idle() then
      // hung now and then on the GPU engine. Not drawn yet (no filmstrip in this module): try again later.
      const x = rt.renders.peekThumb(frameRef(id, r).print(), 160);
      if (!x) {
        if (tries > 1) scheduleThumb(id, 3000, tries - 1);
        return;
      }
      // into the KV, not the store: a catalog write while the GPU engine renders made idle() hang on SwiftShader
      // (studio-real "gpu: first print", every run). The catalog takes the saved thumbnails at the next start.
      const url = thumbUrl(x.image);
      if (url) void kv.put('frames', `thumb:${id}`, url).catch(() => undefined);
    }, ms));
  }
  // the thumbnails saved last session, into the catalog before anything renders (and after a layout switch)
  async function savedThumbs(): Promise<void> {
    const ids = (rt.store.peek(['catalog', 'order']) as string[] | undefined) ?? [];
    const got = await Promise.all(ids.map((id) => kv.get<string>('frames', `thumb:${id}`).catch(() => undefined)));
    const writes = ids.flatMap((id, i) => (got[i] && (rt.store.peek(['catalog', 'frames', id]) as CatalogFrame | undefined)?.thumb !== got[i] ? [{ path: ['catalog', 'frames', id, 'thumb'], value: got[i] }] : []));
    // the library is the view tier (studio-kit cb.studio): no undo step for a thumbnail
    if (writes.length) rt.store.writeView(writes);
  }
  await savedThumbs();
  studio.frames.onAdded((e) => scheduleThumb(e.id, 500));
  // a frame's document changed (an edit, an undo): its thumbnail again, later
  eachMount(() => {
    rt.store.on((paths, info) => {
      if (info.tier !== 'document' || info.preview) return;
      const ids = new Set(paths.filter((p) => p[0] === DOCS && p.length > 1).map((p) => String(p[1])));
      for (const id of ids) if (studio.frames.get(id)) scheduleThumb(id);
    });
  });
  const relinking = new Set<string>();
  /** A library frame whose file is not open: its handle (a permission click), else he locates the file. */
  async function relink(id: string): Promise<void> {
    const c = rt.store.peek(['catalog', 'frames', id]) as CatalogFrame | undefined;
    if (!c || relinking.has(id) || studio.frames.get(id)) return;
    relinking.add(id);
    try {
      const as: OpenAs = c.kind ?? 'auto';
      const h = await kv.get<FileSystemFileHandle>('handles', `file:${c.sha256}`).catch(() => undefined);
      if (h) {
        status(`opening ${c.name} again…`);
        if (await reconnect(h).catch(() => false)) {
          asking = id;
          await openFiles(await fromHandles([h]), { as, expect: c });
          if (asking === id) asking = null;
          return;
        }
      }
      const file = c.file ?? c.name;
      const d = rt.chrome.dialog({
        title: `Where is ${file}?`,
        body: el('p', { text: `The library keeps ${c.name} and its edits, but the browser needs the file again to show it.` }),
        buttons: [{ label: 'Remove from library', value: 'remove' }, { label: 'Not now', value: 'later' }, { label: `Locate ${file}…`, value: 'locate', primary: true }],
      });
      // answered another way (F26): the file opened through File ▸ Open or a drop while the dialog was up. The
      // dialog closes as soon as the frame is open, and that open selects it (asking).
      asking = id;
      whereIs = d;
      const off = studio.frames.onAdded((e) => void (e.id === id && d.close()));
      let r: unknown;
      try {
        r = await d.result;
      } finally {
        off();
        if (whereIs === d) whereIs = null;
      }
      if (studio.frames.get(id)) return;
      if (r !== 'locate' && asking === id) asking = null;
      if (r === 'remove') studio.remove([id]);
      else if (r === 'locate') {
        const files = await chooseFiles(false);
        if (files.length) await openFiles(files, { as, expect: c });
        if (asking === id) asking = null;
      } else status(`${c.name} is not open: select it again to open its file`);
    } finally {
      relinking.delete(id);
    }
  }
  /** Files through the File System Access picker (handles kept with the library), else an <input type=file>. */
  async function chooseFiles(multiple = true): Promise<PickedFile[]> {
    if (hasFilePicker()) {
      try {
        return await pickFiles(multiple);
      } catch (e) {
        if ((e as Error)?.name !== 'AbortError') status(plainMsg(e), { error: true, detail: `Technical: ${msgOf(e)}` });
        return [];
      }
    }
    return new Promise((ok) => {
      const input = el('input', { type: 'file', accept: SCAN_EXTENSIONS.map((x) => `.${x}`).join(','), ...(multiple ? { multiple: '' } : {}) });
      input.addEventListener('change', () => ok(fromFileList(input.files ?? [])), { once: true });
      input.addEventListener('cancel', () => ok([]), { once: true });
      input.click();
    });
  }
  // selecting a frame that is not open (after a reload) opens its file again; not the selection restored at boot
  // (a right-click selects too, for the context menu: that one does not ask for the file)
  let armed = false;
  let lastSel: string | null = studio.current;
  // no right-click yet: -Infinity, not 0 (performance.now() starts at 0 with the page, so a click in its first half
  // second counted as a right-click and asked for nothing)
  let rightAt = -Infinity;
  document.addEventListener('pointerdown', (e) => void (e.button === 2 && (rightAt = performance.now())), true);
  eachMount(() => {
    lastSel = studio.current;
    rt.store.on(() => {
      const f = studio.current;
      if (f === lastSel) return;
      lastSel = f;
      if (armed && f && sel.isOffline(rt.state, f) && performance.now() - rightAt > 500) void relink(f);
    });
  });
  // drop files anywhere on the window ("or drop them here"); Chrome hands file handles too
  document.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  });
  document.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (!dt?.files.length) return;
    e.preventDefault();
    const items = [...dt.items].filter((i) => i.kind === 'file');
    const handles = items.map((i) => (i as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }).getAsFileSystemHandle?.() ?? Promise.resolve(null));
    const files = fromFileList(dt.files);
    void Promise.all(handles).then((hs) => {
      const byName = new Map(hs.filter((h): h is FileSystemFileHandle => h?.kind === 'file').map((h) => [h.name, h]));
      return openFiles(files.map((f) => ({ ...f, ...(byName.get(f.name) ? { handle: byName.get(f.name)! } : {}) })));
    });
  });

  // ── the host's actions in the studio's menus (CHB-027: the top bar folded into File and View; Edit has Undo and
  //    Redo already). Hidden file inputs stay for browsers without the File System Access API, and for tests. ──
  const fileInput = el('input', { type: 'file', id: 'file', multiple: '', hidden: '', accept: SCAN_EXTENSIONS.map((x) => `.${x}`).join(',') });
  fileInput.addEventListener('change', () => {
    void openFiles(fromFileList(fileInput.files ?? []));
    fileInput.value = '';
  });
  const folderInput = el('input', { type: 'file', id: 'folder', webkitdirectory: '', multiple: '', hidden: '' });
  folderInput.addEventListener('change', () => {
    void openFiles(fromFileList(folderInput.files ?? []));
    folderInput.value = '';
  });
  document.body.append(fileInput, folderInput);
  let lastDir = hasDirectoryPicker() ? await kv.get<FileSystemDirectoryHandle>('handles', 'last-folder').catch(() => undefined) : undefined;
  if (host.settings) host.settings.dust = !!rt.store.peek(['prefs', 'dust']);
  const layouts = (): { id: string; label: string }[] => Object.keys(LAYOUTS).map((v) => ({ id: v, label: v === def.id ? def.label : v[0]!.toUpperCase() + v.slice(1) }));
  const hostActions: StudioHost = {
    openFiles: async () => {
      if (!hasFilePicker()) return fileInput.click();
      const files = await chooseFiles(true);
      if (files.length) await openFiles(files);
    },
    openFolder: async () => {
      if (!hasDirectoryPicker()) return folderInput.click();
      try {
        const dir = await pickDirectory();
        await kv.put('handles', 'last-folder', dir);
        lastDir = dir;
        studio.setHost({ ...hostActions, folder: dir.name });
        await openFiles(await listScans(dir));
      } catch (e) {
        if ((e as Error)?.name !== 'AbortError') status(plainMsg(e), { error: true, detail: `Technical: ${msgOf(e)}` });
      }
    },
    // the last folder (Chrome keeps the handle; reading it again needs a click)
    reopenFolder: async () => {
      if (!lastDir) return;
      if (!(await reconnect(lastDir))) return status(`no access to ${lastDir.name}`, { error: true });
      await openFiles(await listScans(lastDir));
    },
    folder: lastDir?.name ?? null,
    exportPrint: () => exportDialog(),
    saveDocument: () => {
      const r = documentJson();
      if (r) download(new Blob([r.json], { type: 'application/json' }), r.fileName);
    },
    ...(host.settings ? { dust: (on: boolean) => void (host.settings!.dust = on) } : {}),
    layouts: layouts(),
    layout: def.id,
    // in place (F24): the open frames stay open; after the command that asked has returned
    setLayout: (v: string) => void setTimeout(() => void switchLayout(v), 0),
  };
  studio.setHost(hostActions);

  /**
   * View ▸ Layout (CHB-031 F24): builds the other layout and mounts it in place of this one. The engine, its decoded
   * sources and the store's log (the frames' documents and the one undo history) stay: the new runtime restores the
   * library, the selection and the workspace from what this one saved, and adopts the old store's log and mounts
   * before the studio attaches. A reload lost every frame whose file the browser could not read again without asking.
   */
  let switching = false;
  async function switchLayout(v: string): Promise<void> {
    const load2 = LAYOUTS[v as LayoutId];
    if (switching || !load2 || v === def.id) return;
    switching = true;
    try {
      const def2 = (await load2()).default;
      const built2 = buildLayout(def2, { env: { params: { ...Object.fromEntries(q), layout: v }, dev: q.has('dev') } });
      const errs = built2.app.diagnostics.list.filter((d) => d.level === 'error');
      if (errs.length) {
        rt.chrome.toast(`The layout ${def2.label} could not be built`, { kind: 'error', detail: `Technical: ${errs.map((d) => `${d.code} ${d.message}`).join('\n')}` });
        return;
      }
      status(`switching to ${def2.label}…`);
      whereIs?.close();
      rt.store.commit('Change');
      await studio.flush();
      await rt.save();
      const past = rt;
      mounted.dispose();
      studio.detach();
      def = def2;
      built = built2;
      studio.setEnlarger(def.enlarger ?? 'real');
      hostActions.layout = def.id;
      hostActions.layouts = layouts();
      const u = new URL(location.href);
      u.searchParams.set('layout', def.id);
      try {
        // one undo history across layouts: Mod+Z after the switch undoes the step made before it
        mounted = await mountLayout(built.app, past);
      } catch (e) {
        // the old interface is gone: start the new layout the old way (a reload; frames without a file handle close)
        console.error(e);
        location.href = u.toString();
        return;
      }
      rt = mounted.rt;
      rtNow = rt;
      for (const f of perMount) f();
      await savedThumbs();
      dropOfflineSelection();
      history.replaceState(history.state, '', u.toString());
      document.body.dataset['layout'] = def.id;
      for (const d of built.app.diagnostics.list) if (d.level === 'warning') console.warn(d.code, d.message);
      const open = studio.frames.all().length;
      status(`layout: ${def.label}${open ? ` · ${open} frame${open > 1 ? 's' : ''} open` : ''}`);
    } finally {
      switching = false;
    }
  }

  /** File ▸ Export…: format and colour space, then where to (the picker) */
  async function exportDialog(): Promise<void> {
    const f = studio.current;
    if (!f || !studio.frames.get(f)) return;
    const fmt = el('select', { id: 'export-format', 'aria-label': 'Export format' }, ...EXPORT_FORMATS.map((x) => el('option', { value: x.id, text: x.label })));
    fmt.value = exportState.format;
    const sp = el('select', { id: 'export-space', 'aria-label': 'Export colour space' }, ...EXPORT_SPACES.map((x) => el('option', { value: x.id, text: x.label })));
    sp.value = exportState.space;
    const row = (label: string, c: HTMLElement): HTMLElement => el('label', { class: 'cb-export-row' }, el('span', { text: label }), c);
    const body = el('div', { class: 'cb-export' }, row('Format', fmt), row('Colour space', sp),
      el('p', { class: 'small', text: pickerAvailable() ? 'You choose where the file goes next.' : 'The file is downloaded.' }));
    const r = await rt.chrome.dialog({ title: `Export ${studio.frames.get(f)!.name}`, body, buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Export', value: 'export', primary: true }] }).result;
    if (r !== 'export') return;
    exportState.format = fmt.value as ExportFormat;
    exportState.space = sp.value as typeof exportState.space;
    await exportFrame(f, 'picker');
  }
  // service worker state, in the status line
  const offline = el('span', { id: 'offline-state', class: 'small', title: 'Whether the studio starts without a network connection' });
  statusBarEl.insertBefore(offline, statusEl);

  // ── export and the document ──
  /** File ▸ Save Document: the selected frame's document (format 3), as JSON beside the scan's name */
  function documentJson(): { json: string; fileName: string } | null {
    const f = studio.current;
    const e = f ? studio.frames.get(f) : undefined;
    const d = f ? studio.doc(f) : undefined;
    if (!e || !d) return null;
    return { json: documentPayload(d).json, fileName: `${e.name.replace(/\.[^.]+$/, '')}.chromobench.json` };
  }
  async function exportFrame(f: string, to: 'picker' | 'memory', o: { format?: ExportFormat; space?: typeof exportState.space } = {}) {
    const e = studio.frames.get(f);
    // links resolved (a roll's scan settings, looks as groups): the export and its sidecar stand on their own
    const doc = studio.resolved(f);
    if (!e || !doc) return null;
    const format = o.format ?? exportState.format;
    const sp = o.space ?? exportState.space;
    try {
      status('exporting…', { sticky: true });
      const x = await exportPrint({
        engine: studio.engine, graph: e.graph, doc, name: e.name, format, space: sp, to,
        onProgress: (p) => status(`exporting: ${p.phase}${p.tilesTotal > 1 ? ` ${p.tilesDone}/${p.tilesTotal}` : ''}`, { sticky: true }),
      });
      status(`exported ${x.name} · ${x.width}×${x.height} · ${x.bits}-bit ${EXPORT_SPACES.find((s) => s.id === sp)?.label ?? sp}`, { sticky: true });
      return x;
    } catch (err) {
      const cancelled = (err as Error)?.name === 'AbortError' || /E_CANCELLED/.test(msgOf(err));
      status(cancelled ? 'export cancelled' : `export failed: ${plainMsg(err)}`, { error: !cancelled, sticky: true, ...(cancelled ? {} : { detail: `Technical: ${msgOf(err)}` }) });
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

  // F18: Open as Photos / Negatives lasts until a restart, then Guess again, unless he kept it (File ▸ Open As)
  if (openAsPref() !== 'auto' && !rt.store.peek(['prefs', 'openAsKeep'])) void rt.runCommand('file.openAs.auto', null);
  showOpenAs();
  eachMount(() => hook(rt, studio, def.id, host, exportFrame, chat));
  // a selection restored from last time that is not open: cleared, so the first click on it opens its file
  function dropOfflineSelection(): void {
    if (studio.current && sel.isOffline(rt.state, studio.current)) {
      rt.store.writeView([{ path: ['ui', 'selection'], value: { ids: [], primary: null, anchor: null } }]);
      lastSel = null;
    }
  }
  dropOfflineSelection();
  armed = true;
  const offlineCount = (rt.store.peek(['catalog', 'order']) as string[] | undefined)?.filter((x) => sel.isOffline(rt.state, x)).length ?? 0;
  status(offlineCount ? `ready: ${offlineCount} frame${offlineCount > 1 ? 's' : ''} in the library; select one to open its file again` : 'ready: open photos or negatives (File ▸ Open Files…, Ctrl+O, or drop them here)');
  for (const d of built.app.diagnostics.list) if (d.level === 'warning') console.warn(d.code, d.message);
  document.body.dataset['ready'] = '1';
  document.body.dataset['layout'] = def.id;
}

/** A rendered thumbnail as a small JPEG data URL, drawn as the shell's thumb draws it (F5: kept in the catalog). */
function thumbUrl(image: PresentImage): string | null {
  try {
    const cv = document.createElement('canvas');
    cv.width = image.width;
    cv.height = image.height;
    const pres = new Canvas2DPresenter(cv);
    pres.setImages(image, null);
    const reg = image.region;
    pres.draw({ docW: reg.w, docH: reg.h, cx: reg.x + reg.w / 2, cy: reg.y + reg.h / 2, zoom: image.width / (reg.w || 1), dpr: 1, split: null }, { stage: [0, 0, 0], frame: [0, 0, 0] });
    return cv.toDataURL('image/jpeg', 0.8);
  } catch {
    return null;
  }
}

/** Connects to a bridge when one serves this page, or when ?bridge[=ws-url] asks for it (loads the assistant). */
async function startBridge(chat: LazyChat, onStatus: (s: string) => void): Promise<BridgeLike | null> {
  const want = q.get('bridge');
  const sameOrigin = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/page`;
  if (want !== null) return chat.connectBridge(want || sameOrigin, onStatus);
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    if (r.headers.get('X-Chromobench-Bridge')) return chat.connectBridge(sameOrigin, onStatus);
  } catch {
    // no bridge
  }
  return null;
}

/** the mounted viewports, the visible ones first */
function viewports(rt: Runtime): DomViewport[] {
  const all = [...(rt.viewports as Map<string, DomViewport>).values()];
  return all.sort((a, b) => Number(b.el.isConnected && b.el.offsetParent !== null) - Number(a.el.isConnected && a.el.offsetParent !== null));
}

type ExportFn = (f: string, to: 'picker' | 'memory', o?: { format?: ExportFormat; space?: 'srgb' | 'display-p3' | 'adobe-rgb' | 'prophoto' }) => Promise<{ width: number; height: number; bytes: number; mime: string; name: string; bits: number } | null>;

function hook(rt: Runtime, studio: Studio, layout: string, host: Host, exportFrame: ExportFn, chat: LazyChat): void {
  window.chromobench = makeHook(rt, studio, layout, host, exportFrame, chat);
}

/** A frame's entry in the log, as the hook reports it. */
interface HookEntry {
  seq: number;
  by: 'user' | 'agent' | 'auto';
  approvedBy?: 'user' | 'agent' | 'auto';
  label: string;
  why?: string;
  status: string;
  batch?: string;
  mutations: readonly Mutation[];
}

/**
 * The test and agent hook, window.chromobench (CHB-009's surface on studio-kit; CHB-037: on documents and the log).
 * Paths are document paths of the selected frame's document: an entry's params by its id (`main.params.time_s`,
 * `lights.params.logH`), a medium by its stage (`stages.darkroom.medium.grade`), `geometry.crop`, `output.…`.
 *
 *   doc                 the selected frame's document (committed; format 3), or null
 *   get(path)           a value of it (undefined when the document has no such path)
 *   set(path, v, label) one transaction by the user (written where the path sits in the document's tree)
 *   propose(edits, why) an agent's change under the studio's mode: { path: value } or values mutations; the seq
 *   log                 the store's document log (values Log: every frame, one cursor)
 *   entries()           the selected frame's entries in effect, oldest first: { seq, by, approvedBy, label, why, status, batch, mutations }
 *   pending()           its pending proposals, in the same shape
 *   units()             the number of steps in effect that changed the selected frame
 *   paths()             the paths of the sets in effect on the selected frame, in order (what its History recorded)
 *   idle()              waits for renders, saves and queued frames
 *   app, rt, studio, layout, engine, engineLabel, size(), explain(), run(cmd, …), state(), tool(id), printNode(),
 *   pixel(x, y), canvasPixel(x, y), presenter(), chainRuns(), chainRunsByShown(), measure(x, y), exportPng(space, format),
 *   bench(steps), chat (the session), chatService, eval(code)
 */
function makeHook(rt: Runtime, studio: Studio, layout: string, host: Host, exportFrame: ExportFn, chat: LazyChat) {
  const cur = (): string => studio.current ?? '';
  const vp = (): DomViewport | null => viewports(rt)[0] ?? null;
  const docNow = (): Document | null => studio.doc(cur()) ?? null;
  const idle = async (): Promise<void> => {
    for (let i = 0; i < 3; i++) {
      await rt.settle();
      // renders run in the engine worker (CHB-027): settle() can return while one is in flight; wait for it (≤ 5 min)
      const until = performance.now() + 300_000;
      while (rt.renders.busy() && performance.now() < until) {
        await Promise.race([rt.renders.idle(), new Promise((r) => setTimeout(r, 100))]);
        await rt.settle();
      }
      await studio.flush();
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  const entry = (e: ReturnType<Studio['log']['inEffect']>[number]): HookEntry => ({
    seq: e.seq, by: e.tx.by, label: e.tx.label, status: e.tx.status, mutations: e.tx.mutations,
    ...(e.approvedBy !== undefined ? { approvedBy: e.approvedBy } : {}), ...(e.why !== undefined ? { why: e.why } : {}), ...(e.tx.batch !== undefined ? { batch: e.tx.batch } : {}),
  });
  const has = (): boolean => !!studio.rt && studio.log.has(cur());
  const h = {
    app: rt.app,
    rt,
    studio,
    layout,
    get engine() {
      return studio.engine;
    },
    /** engine label as the status line shows it */
    get engineLabel(): string {
      return host.label;
    },
    /** the store's document log (every frame's document and history) */
    get log() {
      return studio.log;
    },
    /** the selected frame's document (committed), or null */
    get doc(): Document | null {
      return docNow();
    },
    /** a value of the selected frame's document at a document path */
    get: (path: string): unknown => read(docNow(), path),
    /** the selected frame's entries in effect, oldest first */
    entries: (): HookEntry[] => (has() ? studio.log.inEffect(cur()).map(entry) : []),
    /** the selected frame's pending proposals */
    pending: (): HookEntry[] => (has() ? studio.log.pending(cur()).map(entry) : []),
    /** the number of steps in effect that changed the selected frame */
    units: (): number => {
      if (!has()) return 0;
      const log = studio.log;
      return log.steps.slice(0, log.cursor).filter((st) => log.docsOf(st).includes(cur())).length;
    },
    /** the paths the selected frame's sets in effect wrote, in order (inserts and removes as their op) */
    // a set of one component of a vec3 / cmy control (lights.params.logH.0) counts as a set of the control's path
    paths: (): string[] => (has()
      ? studio.log.inEffect(cur()).flatMap((e) => liftComponents(e.tx.mutations, studio.log.doc<Document>(cur()), (p, d) => modelAt(p, d) ?? undefined).map((m) => (m.op === 'set' ? m.path : m.op)))
      : []),
    /** the selected frame's source size */
    size: () => {
      const e = studio.frames.get(cur());
      return e ? { width: e.info.width, height: e.info.height } : null;
    },
    explain: () => rt.explain({ live: true }),
    run: (cmd: string, ...a: unknown[]) => rt.runCommand(cmd, null, ...a),
    state: () => rt.store.peek([]),
    /** waits for renders, saves and queued frames */
    idle,
    /** one transaction by the user: set(path, value) on the selected frame's document */
    set(path: string, value: unknown, label = path): void {
      const f = cur();
      const d = studio.doc(f);
      if (!d) throw new Error('set: no frame is open');
      rt.ctx().tx(label, (t: { $set(p: (string | number)[], v: unknown): void }) => t.$set(storePath(f, d, path), value));
    },
    /** select a tool on the viewer ('test-strip', 'ring-around', 'probe', …; null: none) */
    tool: (id: string | null) => rt.selectTool(id),
    /** the node id the main viewer shows for the selected frame's print (the ring-around centre tile is this node) */
    printNode(): string | null {
      const f = cur();
      const d = rt.store.peek([DOCS, f]) as Document | undefined;
      return d ? studio.bridge.key(frameRef(f, d).print()) : null;
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
      const d = rt.store.peek([DOCS, f]) as Document | undefined;
      if (!e || !runs || !d) return [];
      const top = studio.bridge.lower(frameRef(f, d).print()).shown;
      return e.graph.closure(top.id).map((x) => ({ op: x.op, runs: runs.call(studio.engine, e.graph.adopt([x]).at(-1)!.id) }));
    },
    /** densitometer readings at a source pixel of the selected frame's print */
    measure: (x: number, y: number) => {
      const f = cur();
      const d = rt.store.peek([DOCS, f]) as Document | undefined;
      return d ? studio.measure(f, d, x, y) : Promise.resolve(null);
    },
    /** exports the selected frame's print into memory; returns its description, not the bytes */
    async exportPng(space: 'srgb' | 'display-p3' = 'srgb', format: ExportFormat = 'png8') {
      const x = await exportFrame(cur(), 'memory', { format, space });
      return x ? { width: x.width, height: x.height, bytes: x.bytes, type: x.mime, fileName: x.name, bits: x.bits } : null;
    },
    /**
     * Frame times on this machine (CHB-023 stage 5): `steps` drag previews of the main exposure's time (draft pass),
     * one screen pass after release, and an export at the working size. With a scan open: `await chromobench.bench()`.
     */
    async bench(steps = 12) {
      const f = cur();
      const e = studio.frames.get(f);
      const d = studio.doc(f);
      if (!e || !d) return null;
      await idle();
      const t0 = mainExposure(d).time_s;
      const path = storePath(f, d, TIME_PATH);
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
    /** an agent's change on the selected frame: { path: value } (sets) or values mutations; one transaction; its seq */
    propose(edits: Record<string, unknown> | Mutation[], why?: string): number {
      const ms: Mutation[] = Array.isArray(edits) ? edits : Object.entries(edits).map(([path, value]) => ({ op: 'set' as const, path, value }));
      return studio.propose(ms, why ? { why } : {});
    },
    chainRunsByShown: () => Object.fromEntries(studio.bridge.runs),
    /** the assistant's chat session (CHB-008; empty until the assistant is loaded) and its service */
    chat: chat.session,
    chatService: chat,
    /** dev entry point: run DSL code in its own worker session on the selected frame (loads the assistant) */
    eval: (code: string, o: { frame?: string; timeoutMs?: number; signal?: AbortSignal } = {}) => chat.devEval(code, o),
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
