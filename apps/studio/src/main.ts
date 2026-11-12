// The studio host (CHB-019 guide §7.1; CHB-023's real-engine wiring): boot the engine, open IndexedDB, build the
// variant (?variant=, default classic), mount it with studio-kit's services plus the WebGPU presenter, the export
// and the first print, and wire the host frame around it (files, export, status line) and the test/agent hook
// window.chromobench.
//
// URL options: ?variant=classic|darkroom|simple|lab|tiny; ?engine=auto (GPU when WebGPU works, else the reference
// engine) | gpu | reference | mock; ?long=N (GPU working image long side, 0 = the file's own size); ?refLong=N (the
// reference engine's, default 512); ?worker=0 (decode and the reference engine on the main thread); ?canvas2d
// (present without WebGPU); ?nosw (no service worker); ?fresh (a KV in memory: nothing saved).
import { closest, defaultRecipe, type Engine, type FrameRecipe, type LoggedMutation, type Mutation } from '@chromobench/contract';
import { MockEngine } from '@chromobench/engine-mock';
import { pickerAvailable } from '@chromobench/output';
import type { PresentImage, Runtime } from '@chromobench/shell';
import '@chromobench/shell/shell.css';
import { buildVariant, createStudio, explainError, frameRef, isOffline, memoryKV, setKnownValues, type CatalogFrame, type FrameEntry, type InitialRecipe, type KV, type OpenAs, type SourceOpener, type Studio, type StudioHost } from '@chromobench/studio-kit';
import { Canvas2DPresenter, type DomViewport } from '@chromobench/shell/dom';
import { mountStudio } from '@chromobench/studio-kit/dom';
import { ROLL_RENDERERS } from '@chromobench/studio-kit/kits/roll/dom';
import '@chromobench/studio-kit/kits/roll/roll.css';
import '@chromobench/studio-kit/studio-kit.css';
import { CHAT_RENDERERS } from '@chromobench/studio-kit/kits/chat/dom';
import '@chromobench/studio-kit/kits/chat/chat.css';
import { LOOKS_RENDERERS } from '@chromobench/studio-kit/kits/looks/dom';
import '@chromobench/studio-kit/kits/looks/looks.css';
import { chromogen, craftkit, resolveTheme, type Runtime as ShellRuntime } from '@chromobench/shell';
import { themeHandle } from '@chromobench/shell/dom';
import { DEFAULT_VARIANT, VARIANTS, type VariantId } from '@chromobench/studio-kit/variants';
import type { BridgePageClient } from '@chromobench/agent';
import { createStudioChat, type StudioChat } from './host/chat.ts';
import { engineSummary, notesSummary } from './status-text.ts';
import { download, EXPORT_FORMATS, EXPORT_SPACES, exportPrint, type ExportFormat } from './host/export.ts';
import { firstPrint, withMeasured } from './host/first-print.ts';
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
  initial?: InitialRecipe;
  notes(sha: string): string[];
  settings: HostSettings | null;
  /** The roll kit's physics service; the mock engine has none (the Roll panels say so). */
  rollPhysics?: unknown;
  /** Opens a file as a photo, a negative or as guessed (CHB-027); the mock engine opens everything as a negative. */
  opener?: SourceOpener;
  /** What the pixels of an open file look like (the guess), for the "looks like a negative" hint (F15). */
  guess(sha: string): OpenGuess | null;
}

/** Asks the photographer when a guess is unsure; set for the length of one open batch (one question per batch). */
let askOpen: AskOpenMode | undefined;

/** A photo's first recipe (CHB-012): the frame's id and source, shot on the default film (as-shot white balance when known). */
function photoRecipe(d: FrameRecipe, asShot: boolean): FrameRecipe {
  const { decode, ...src } = d.source;
  const r = defaultRecipe('digital-raw', src, { frame: d.frame, decode: { ...decode, mode: 'photo' } });
  if (asShot) r.capture!.whiteBalance.mode = 'as-shot';
  return r;
}

async function startEngine(): Promise<Host> {
  const want = q.get('engine') ?? 'auto';
  if (want === 'mock') return { engine: new MockEngine(), label: 'mock engine (no physics)', notes: () => [], settings: null, guess: () => null };
  const { createHostEngine } = await import('./host/engines.ts');
  const long = q.get('long');
  const refLong = q.get('refLong');
  const h = await createHostEngine({
    want: want === 'gpu' || want === 'reference' ? want : 'auto', ...(long !== null ? { long: Number(long) } : {}), ...(refLong !== null ? { refLong: Number(refLong) } : {}),
    worker: q.get('worker') !== '0', onStatus: (s) => status(s),
  });
  setKnownValues(h.catalog);
  addScanExtensions(h.extensions);
  const se: StudioEngine = h.engine;
  return {
    engine: se,
    label: se.label,
    // ?filtration=1: the first print's colour goes into the enlarger's filtration and time (CHB-010 bake), not the printer lights
    initial: (d, g) => (se.notes.get(d.source.sha256)?.kind === 'digital-raw'
      ? Promise.resolve(photoRecipe(d, se.notes.get(d.source.sha256)?.info.camera?.asShotNeutral !== undefined))
      : firstPrint(se, g, withMeasured(d, se.notes.get(d.source.sha256)), { integrate: h.integrate, ...(q.get('filtration') === '1' ? { bake: h.bake } : {}) })),
    notes: (sha) => se.notes.get(sha)?.notes ?? [],
    settings: h.settings,
    rollPhysics: h.rollPhysics,
    opener: (src, as) => se.openAs(src, as, askOpen),
    guess: (sha) => se.notes.get(sha)?.guess ?? null,
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
  // the status line in his words; the technical label stays in the tooltip and data-engine (CHB-027 F9)
  engineEl.textContent = engineSummary(host.label);
  engineEl.title = `The engine that computes the prints: ${host.label}`;
  engineEl.dataset['engine'] = host.label;

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
  const studio: Studio = createStudio({ engine: host.engine, kv, displaySpace: 'srgb', ...(host.initial ? { initial: host.initial } : {}), ...(host.opener ? { opener: host.opener } : {}) });
  const chat = createStudioChat(studio);
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
  const { rt } = await mountStudio(built.app, root, studio, { presenter, save, chat, themeRoot: document.documentElement, renderers: { ...ROLL_RENDERERS, ...LOOKS_RENDERERS, ...CHAT_RENDERERS }, ...(host.rollPhysics ? { rollPhysics: host.rollPhysics } : {}) });
  mirrorTheme(rt);
  chat.attach(rt);
  // CHB-027 (F4): on a real engine, drags show drafts sized to ≈150 ms, and a slow engine still shows one
  // render per 250 ms while the hand moves (else every move would abort the render in flight)
  if (host.settings) {
    studio.bridge.draftTargetMs = 150;
    rt.renders.progressMs = 250;
    rt.renders.preemptBackground = true;
  }
  // external agents: a bridge serving this page (or ?bridge=ws://127.0.0.1:7341/ws/page from the dev server)
  const bridgeEl = el('span', { id: 'bridge', class: 'pill', title: 'External agents (Claude Code, Claude Desktop) through chromobench serve' });
  bridgeEl.hidden = true;
  statusBarEl.insertBefore(bridgeEl, notesEl);
  const bridge = await startBridge(chat, (s) => {
    bridgeEl.hidden = false;
    bridgeEl.textContent = `agents: ${s}`;
  });
  // the presenters exist now: the display space follows the main viewer's canvas
  const vp0 = viewports(rt)[0];
  if (vp0) studio.bridge.displaySpace = vp0.presenter.colorSpace;

  // ── status from the runtime ──
  let rendered = 0;
  rt.on('rendered', (e: { pass: string; viewport: string }) => {
    rendered++;
    status(`rendered ${rendered} · ${e.pass}`);
  });
  rt.on('renderError', (e: { error: unknown }) => status(explainError(e.error)?.text ?? msgOf(e.error), { error: true, detail: msgOf(e.error) }));
  let lastFrame: string | null = null;
  let lastEntry: FrameEntry | undefined;
  let lastMode = studio.frames.mode;
  let lastLog: unknown = null;
  rt.store.on(() => {
    const f = studio.current;
    const e = f ? studio.frames.get(f) : undefined;
    if (bridge && (f !== lastFrame || studio.frames.mode !== lastMode)) {
      lastMode = studio.frames.mode;
      bridge.update();
    }
    if (f !== lastFrame || e !== lastEntry) {
      lastFrame = f;
      lastEntry = e;
      const notes = e ? host.notes(e.sha) : [];
      notesEl.textContent = notesSummary(notes);
      notesEl.title = notes.join(' · ');
      showMode(e);
    }
    // a refusal (E_STALE, …) stays in the status line until the frame's log changes
    const a = rt.store.peek(['ui', 'approvals']) as Record<string, { stale?: { code: string; message: string }[] }> | undefined;
    const stale = Object.values(a ?? {}).flatMap((x) => x.stale ?? []);
    const recipe = f ? rt.store.peek(['recipes', f]) : null;
    if (stale.length && !sticky) status(explainError({ diag: stale[0] })?.text ?? stale[0]!.message, { sticky: true, error: true, detail: stale.map((d) => `${d.code}: ${d.message}`).join('; ') });
    else if (sticky && recipe !== lastLog) sticky = false;
    lastLog = recipe;
  });

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
      hintEl.title = `The picture ${g.why}. Click to re-open ${e.name} as a ${g.kind}.`;
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
  /** One question per open batch when a guess is unsure (F1): photos from a camera, or scans of negatives? */
  async function askMode(g: OpenGuess, name: string, count: number): Promise<'photo' | 'negative'> {
    const body = el('div', {},
      el('p', { text: `${count > 1 ? `${name} and the other files` : name}: the picture ${g.why}.` }),
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
          } else opened.push(pf.name);
          if (pf.handle) void kv.put('handles', `file:${r.entry.sha}`, pf.handle).catch(() => undefined);
          if (o.expect && o.expect.sha256 !== r.entry.sha) rt.chrome.toast(`${pf.name} is not the file ${o.expect.name} was made from: it opened as a frame of its own`, { kind: 'warn' });
          if (first) {
            first = false;
            rt.runCommand('frame.select', null, r.entry.id);
            if (rt.app.ir.modules.some((m) => m.id === 'print') && rt.module !== 'print') rt.go('print');
          }
        } catch (err) {
          // in his words (WS-C's explainError), the technical text in the tooltip
          failed.push(`${pf.name}: ${rt.explainError?.(err, {})?.text ?? msgOf(err)}`);
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
    status(parts.join(' · ') || 'nothing opened', { error: failed.length > 0 && !opened.length && !already.length, ...(details.length ? { detail: details.join('\n') } : {}) });
  }

  // ── the library across reloads (F5): a thumbnail of each frame's print is kept in its catalog entry; a frame not
  //    open in this session is read again through its file handle (one permission click) or located by him ──
  const thumbTimers = new Map<string, ReturnType<typeof setTimeout>>();
  function scheduleThumb(id: string, ms = 2000, tries = 6): void {
    clearTimeout(thumbTimers.get(id));
    thumbTimers.set(id, setTimeout(() => {
      thumbTimers.delete(id);
      const r = rt.store.peek(['recipes', id]) as FrameRecipe | undefined;
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
  // the thumbnails saved last session, into the catalog before anything renders
  {
    const ids = (rt.store.peek(['catalog', 'order']) as string[] | undefined) ?? [];
    const got = await Promise.all(ids.map((id) => kv.get<string>('frames', `thumb:${id}`).catch(() => undefined)));
    const writes = ids.flatMap((id, i) => (got[i] && (rt.store.peek(['catalog', 'frames', id]) as CatalogFrame | undefined)?.thumb !== got[i] ? [{ path: ['catalog', 'frames', id, 'thumb'], value: got[i] }] : []));
    if (writes.length) rt.store.writeDoc(writes, { tier: 'document' });
  }
  studio.frames.onAdded((e) => {
    scheduleThumb(e.id, 500);
    e.log.on((ev) => {
      if (ev.type !== 'preview' && studio.frames.get(e.id) === e) scheduleThumb(e.id);
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
        if (await reconnect(h).catch(() => false)) return await openFiles(await fromHandles([h]), { as, expect: c });
      }
      const r = await rt.chrome.dialog({
        title: `Where is ${c.name}?`,
        body: el('p', { text: `The library keeps ${c.name} and its recipe, but the browser needs the file again to show it.` }),
        buttons: [{ label: 'Remove from library', value: 'remove' }, { label: 'Not now', value: 'later' }, { label: `Locate ${c.name}…`, value: 'locate', primary: true }],
      }).result;
      if (r === 'remove') studio.remove([id]);
      else if (r === 'locate') {
        const files = await chooseFiles(false);
        if (files.length) await openFiles(files, { as, expect: c });
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
        if ((e as Error)?.name !== 'AbortError') status(msgOf(e), { error: true });
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
  let rightAt = 0;
  document.addEventListener('pointerdown', (e) => void (e.button === 2 && (rightAt = performance.now())), true);
  rt.store.on(() => {
    const f = studio.current;
    if (f === lastSel) return;
    lastSel = f;
    if (armed && f && isOffline(rt.state, f) && performance.now() - rightAt > 500) void relink(f);
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
  const layouts = Object.keys(VARIANTS).map((v) => ({ id: v, label: v === def.id ? def.label : v[0]!.toUpperCase() + v.slice(1) }));
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
        if ((e as Error)?.name !== 'AbortError') status(msgOf(e), { error: true });
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
    saveRecipe: () => {
      const r = recipeJson();
      if (r) download(new Blob([r.json], { type: 'application/json' }), r.fileName);
    },
    ...(host.settings ? { dust: (on: boolean) => void (host.settings!.dust = on) } : {}),
    layouts,
    layout: def.id,
    setLayout: (v: string) => {
      const u = new URL(location.href);
      u.searchParams.set('variant', v);
      location.href = u.toString();
    },
  };
  studio.setHost(hostActions);

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

  hook(rt, studio, def.id, host, exportFrame, chat);
  // a selection restored from last time that is not open: cleared, so the first click on it opens its file
  if (studio.current && isOffline(rt.state, studio.current)) {
    rt.store.writeDoc([{ path: ['ui', 'selection'], value: { ids: [], primary: null, anchor: null } }], { tier: 'view' });
    lastSel = null;
  }
  armed = true;
  const offlineCount = (rt.store.peek(['catalog', 'order']) as string[] | undefined)?.filter((x) => isOffline(rt.state, x)).length ?? 0;
  status(offlineCount ? `ready: ${offlineCount} frame${offlineCount > 1 ? 's' : ''} in the library; select one to open its file again` : 'ready: open photos or negatives (File ▸ Open Files…, Ctrl+O, or drop them here)');
  for (const d of built.app.diagnostics.list) if (d.level === 'warning') console.warn(d.code, d.message);
  document.body.dataset['ready'] = '1';
  document.body.dataset['variant'] = def.id;
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

/** Connects to a bridge when one serves this page, or when ?bridge[=ws-url] asks for it. */
async function startBridge(chat: StudioChat, onStatus: (s: string) => void): Promise<BridgePageClient | null> {
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

function hook(rt: Runtime, studio: Studio, variant: string, host: Host, exportFrame: ExportFn, chat: StudioChat): void {
  window.chromobench = makeHook(rt, studio, variant, host, exportFrame, chat);
}

/** The test and agent hook (CHB-009's surface on studio-kit; CHB-007/008 replace propose with a real DSL eval). */
function makeHook(rt: Runtime, studio: Studio, variant: string, host: Host, exportFrame: ExportFn, chat: StudioChat) {
  const cur = (): string => studio.current ?? '';
  const vp = (): DomViewport | null => viewports(rt)[0] ?? null;
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
    /** the assistant's chat session (CHB-008) and its service (connect('demo'), …) */
    chat: chat.session,
    chatService: chat,
    /** dev entry point: run DSL code in its own worker session on the selected frame (edits are proposals) */
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
