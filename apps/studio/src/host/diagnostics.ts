// The studio's diagnostics (CHB-038): the journal of this page, and the service `diagnostics` the diagnostics kit's
// commands run on (studio-kit kits/diagnostics): Help ▸ Diagnostics…, Help ▸ Report a Problem…, File ▸ Open Report…,
// Copy Problem Summary. The host gathers what only it can: the environment (browser, screen, the GPU devices, the
// service worker), the pictures (each open frame's print ≤ 1600 px, the viewer), the original files, the zip and the
// download; studio-kit decides what goes where (reportFiles) and reads a report back (readReport).
//
// Privacy: a report is made only when he asks, stays on this computer (a download), and holds the original files
// only when he ticks them. Nothing here sends anything anywhere.
import type { Document } from '@chromobench/contract';
import { unzip, zip } from '@chromobench/output';
import { captureConsole, captureErrors, Journal, type PresentImage, type Runtime } from '@chromobench/shell';
import { Canvas2DPresenter, type DomViewport } from '@chromobench/shell/dom';
import { frameRef, frameSave, logKey, type KV, type Studio } from '@chromobench/studio-kit';
import { CHOICES, readReport, reportFiles, reportName, sizeText, summaryText, type DiagnosticsService, type Report, type ReportEntry, type ReportFrame, type ReportPart } from '@chromobench/studio-kit/kits/diagnostics';
import { journalView, reportForm, reportView, type PartSizes } from '@chromobench/studio-kit/kits/diagnostics/dom';
import type { Json } from '@chromobench/values';
import { gpuFacts, swFacts } from './capture.ts';
import { download } from './export.ts';
import type { PickedFile } from '../storage/fsa.ts';

/** the build's version and commit (vite.config.ts defines them) */
export const APP = {
  version: typeof __CHROMOBENCH_VERSION__ === 'string' ? __CHROMOBENCH_VERSION__ : 'dev',
  commit: typeof __CHROMOBENCH_COMMIT__ === 'string' ? __CHROMOBENCH_COMMIT__ : 'unknown',
};

/**
 * The page's journal, made before anything else so the boot is in it: the console and the uncaught errors are
 * captured from here on. `?debug` keeps debug events (every render) and turns on the GPU error scopes.
 */
export function startJournal(q: URLSearchParams): Journal {
  const journal = new Journal({ debug: q.has('debug') });
  captureConsole(journal, console);
  captureErrors(journal, window);
  journal.info('app', `start ${APP.version} (${APP.commit})`, { code: 'START', data: { url: location.pathname + location.search } });
  return journal;
}

/** What main.ts gives the service: the runtime on screen, the studio and the host's facts and actions. */
export interface DiagnosticsHost {
  journal: Journal;
  q: URLSearchParams;
  kv: KV;
  studio: Studio;
  rt(): Runtime;
  engineLabel(): string;
  layout(): { id: string; label: string };
  viewports(): DomViewport[];
  /** opens files as the File menu does (with File ▸ Open As's choice per call) */
  openFiles(files: PickedFile[], as: 'photo' | 'negative'): Promise<void>;
  /** host settings worth knowing (dust, …) */
  settings(): Json;
}

export interface StudioDiagnostics extends DiagnosticsService {
  /** what this computer and the studio are (the report's environment.json) */
  environment(): Promise<Json>;
  /** a report's zip, without the dialog (the hook and the tests) */
  build(o: { description?: string; parts?: ReportPart[] }): Promise<{ bytes: Uint8Array; name: string; files: string[] }>;
  /** the last report opened (File ▸ Open Report…) */
  readonly opened: Report | null;
}

/** "Chrome 142 on macOS" from the user agent (the full string stays in environment.json) */
function browserSummary(ua: string): string {
  const b = /Edg\/(\d+)/.exec(ua) ? `Edge ${/Edg\/(\d+)/.exec(ua)![1]}` : /Chrome\/(\d+)/.exec(ua) ? `Chrome ${/Chrome\/(\d+)/.exec(ua)![1]}` : /Firefox\/(\d+)/.exec(ua) ? `Firefox ${/Firefox\/(\d+)/.exec(ua)![1]}` : /Version\/(\d+).*Safari/.exec(ua) ? `Safari ${/Version\/(\d+)/.exec(ua)![1]}` : 'a browser';
  const os = /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : /iPhone|iPad/.test(ua) ? 'iOS' : 'an unknown system';
  return `${b} on ${os}`;
}

/** A rendered image as PNG bytes (drawn as the shell's 2D presenter draws it). */
async function pngOf(image: PresentImage): Promise<Uint8Array | null> {
  try {
    const cv = document.createElement('canvas');
    cv.width = image.width;
    cv.height = image.height;
    const pres = new Canvas2DPresenter(cv);
    pres.setImages(image, null);
    const reg = image.region;
    pres.draw({ docW: reg.w, docH: reg.h, cx: reg.x + reg.w / 2, cy: reg.y + reg.h / 2, zoom: image.width / (reg.w || 1), dpr: 1, split: null }, { stage: [0, 0, 0], frame: [0, 0, 0] });
    const blob = await new Promise<Blob | null>((ok) => cv.toBlob(ok, 'image/png'));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

const enc = new TextEncoder();
const PREVIEW_LONG = 1600;
/** what a picture of a frame weighs, roughly (a 1600 px PNG of a print) */
const PREVIEW_ABOUT = 2.5 * 2 ** 20;

export function createDiagnostics(h: DiagnosticsHost): StudioDiagnostics {
  const { journal, studio } = h;
  let opened: Report | null = null;
  const frames = () => studio.frames.all().filter((e) => studio.log.has(e.id));

  async function environment(): Promise<Json> {
    const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { platform?: string; mobile?: boolean; brands?: { brand: string; version: string }[] } };
    const ua = nav.userAgent;
    const storage = await navigator.storage?.estimate?.().catch(() => null);
    const vps = h.viewports().map((v) => ({ id: v.id, presenter: v.presenter ? `${v.presenter.kind} · ${v.presenter.colorSpace}` : null }));
    return JSON.parse(JSON.stringify({
      app: APP,
      url: { path: location.pathname, options: Object.fromEntries(h.q), secure: isSecureContext, origin: location.origin },
      browser: {
        summary: browserSummary(ua), userAgent: ua, platform: nav.userAgentData?.platform ?? null, brands: nav.userAgentData?.brands ?? null, languages: navigator.languages,
        cores: navigator.hardwareConcurrency, memoryGB: nav.deviceMemory ?? null, crossOriginIsolated: self.crossOriginIsolated, online: navigator.onLine, webgpu: 'gpu' in navigator,
      },
      screen: { width: screen.width, height: screen.height, dpr: devicePixelRatio, p3: matchMedia('(color-gamut: p3)').matches, hdr: matchMedia('(dynamic-range: high)').matches, window: [innerWidth, innerHeight] },
      gpu: gpuFacts,
      engine: { label: h.engineLabel(), frames: frames().length, viewports: vps },
      layout: h.layout(),
      sw: swFacts,
      storage: storage ? { usage: storage.usage ?? null, quota: storage.quota ?? null } : null,
      journal: { session: journal.session, debug: journal.debugOn, totals: journal.totals() },
    })) as Json;
  }

  const entriesOf = (f: string): ReportEntry[] =>
    studio.log.entries.filter((e) => e.doc === f).map((e) => ({
      seq: e.seq, at: e.at, by: e.tx.by, label: e.tx.label, status: e.tx.status, mutations: e.tx.mutations as unknown as Json[],
      ...(e.why !== undefined ? { why: e.why } : {}), ...(e.approvedBy !== undefined ? { approvedBy: e.approvedBy } : {}), ...(e.tx.batch !== undefined ? { batch: e.tx.batch } : {}),
    }));

  /** each open frame's print, display cut, at most 1600 px on its long side */
  async function preview(id: string, doc: Document): Promise<Uint8Array | null> {
    try {
      const r = await studio.bridge.render(frameRef(id, doc).print(), { slot: `report:${id}`, epoch: 0, lane: 'bg', pass: 'screen', maxSide: PREVIEW_LONG, signal: new AbortController().signal });
      return await pngOf(r.image);
    } catch (e) {
      journal.warn('app', `the report's picture of ${id} could not be made`, { code: 'REPORT_PREVIEW', frame: id, data: e });
      return null;
    }
  }

  async function build(o: { description?: string; parts?: ReportPart[] } = {}): Promise<{ bytes: Uint8Array; name: string; files: string[] }> {
    const parts = new Set<ReportPart>(o.parts ?? CHOICES.filter((c) => c.on).map((c) => c.part));
    const rt = h.rt();
    const fs: ReportFrame[] = [];
    for (const e of frames()) {
      const doc = studio.doc(e.id);
      if (!doc) continue;
      const f: ReportFrame = {
        id: e.id, name: e.name, sha256: e.sha, kind: e.kind, ...(e.strip ? { strip: { index: e.strip.index, of: e.strip.of } } : {}),
        document: doc as unknown as Json, save: frameSave(studio.log, e.id), entries: entriesOf(e.id),
      };
      if (parts.has('pictures')) {
        const p = await preview(e.id, doc);
        if (p) f.preview = p;
      }
      if (parts.has('originals')) {
        const b = await studio.frames.sourceBytes(e.id);
        if (b) f.original = { name: e.name, bytes: b };
        else journal.warn('app', `the original of ${e.name} could not be read for the report`, { code: 'REPORT_ORIGINAL', frame: e.id });
      }
      fs.push(f);
    }
    const shown = parts.has('pictures') ? h.viewports()[0]?.shown().image : null;
    const screenshot = shown ? await pngOf(shown) : null;
    const created = Date.now();
    journal.info('app', 'problem report made', { code: 'REPORT', data: { parts: [...parts], frames: fs.length } });
    const { files } = reportFiles({
      created, description: o.description ?? '', app: APP, parts: [...parts], environment: await environment(), journal: journal.toJSON(),
      settings: JSON.parse(JSON.stringify({ prefs: rt.store.peek(['prefs']) ?? null, agentMode: studio.mode, host: h.settings() })) as Json,
      view: JSON.parse(JSON.stringify({ module: rt.module, current: studio.current, selection: rt.store.peek(['ui', 'selection']) ?? null, tool: rt.store.peek(['ui', 'tool']) ?? null, view: rt.store.peek(['view']) ?? null })) as Json,
      frames: fs, ...(screenshot ? { screenshot } : {}),
    });
    return { bytes: zip(files), name: reportName(created, journal.session), files: files.map(([p]) => p) };
  }

  const copy = (text: string): void => {
    void navigator.clipboard?.writeText(text).then(
      () => h.rt().chrome.toast('Copied: paste it into your message', { kind: 'ok' }),
      () => h.rt().chrome.toast('The clipboard is not available here', { kind: 'warn' }),
    );
  };
  const summary = async (): Promise<string> => summaryText({ app: APP, environment: await environment(), journal: { rows: journal.rows() } });

  async function report(): Promise<void> {
    const rt = h.rt();
    const fr = frames();
    const docs = fr.reduce((s, e) => s + enc.encode(JSON.stringify({ d: studio.doc(e.id), x: entriesOf(e.id) })).length * 2, 0);
    const originals = fr.reduce((s, e) => s + (studio.frames.sourceSize(e.id) ?? 0), 0);
    const none = fr.length ? null : { none: 'no photos open' };
    const sizes: PartSizes = {
      documents: none ?? { bytes: docs },
      pictures: none ?? { about: `about ${sizeText(PREVIEW_ABOUT * fr.length)}` },
      originals: none ?? (fr.every((e) => studio.frames.canReread(e.id)) ? { bytes: originals } : { bytes: originals, about: 'some files are not at hand' }),
    };
    const t = journal.totals();
    const form = reportForm({ sizes, frames: fr.length, problems: { errors: t.error, warnings: t.warn }, base: enc.encode(JSON.stringify(journal.toJSON())).length * 2 });
    const d = rt.chrome.dialog({
      title: 'Report a Problem',
      body: form.el,
      cls: 'cb-report-dialog',
      buttons: [
        {
          label: 'Copy summary', value: 'copy', run: () => {
            void summary().then(copy);
            return false;
          },
        },
        { label: 'Cancel', value: 'cancel' },
        { label: 'Save the report…', value: 'save', primary: true },
      ],
    });
    if ((await d.result) !== 'save') return;
    const v = form.value();
    rt.chrome.toast('Making the report…', { kind: 'info', ms: 1500 });
    try {
      const r = await build({ description: v.description, parts: v.parts });
      download(new Blob([r.bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), r.name);
      rt.chrome.toast(`Saved ${r.name} (${sizeText(r.bytes.length)}) in your downloads. Send it to whoever helps you.`, { kind: 'ok', ms: 9000 });
    } catch (e) {
      journal.error('app', `the problem report could not be made: ${(e as Error)?.message ?? e}`, { code: 'REPORT_FAILED', data: e });
      rt.chrome.toast('The report could not be made', { kind: 'error', detail: `Technical: ${(e as Error)?.message ?? e}` });
    }
  }

  function show(): void {
    const rt = h.rt();
    journal.markSeen();
    const v = journalView(journal, { report: () => {
      d.close();
      void rt.runCommand('diagnostics.report', null);
    }, copy });
    const d = rt.chrome.dialog({ title: 'Diagnostics', body: v.el, wide: true, buttons: [{ label: 'Close', primary: true }], onClose: () => {
      v.dispose();
      journal.markSeen();
    } });
  }

  /** a report someone sent: read it, show it, and offer to open its photos with their edits */
  async function openReport(bytes?: Uint8Array): Promise<Report | null> {
    const rt = h.rt();
    if (!bytes) {
      const picked = await new Promise<File | null>((ok) => {
        const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.zip,application/zip' });
        input.addEventListener('change', () => ok(input.files?.[0] ?? null), { once: true });
        input.addEventListener('cancel', () => ok(null), { once: true });
        input.click();
      });
      if (!picked) return null;
      bytes = new Uint8Array(await picked.arrayBuffer());
    }
    let r: Report;
    try {
      r = readReport(unzip(bytes));
    } catch (e) {
      rt.chrome.toast((e as Error).message.startsWith('unzip') ? 'This file is not a problem report (not a zip the studio made)' : (e as Error).message, { kind: 'error', ms: 6000 });
      return null;
    }
    opened = r;
    journal.info('app', `opened a problem report from ${r.manifest.created}`, { code: 'REPORT_OPENED', data: { app: r.manifest.app, frames: r.frames.length, parts: r.manifest.parts } });
    const urls: string[] = [];
    const url = (b: Uint8Array, type: string): string => {
      const u = URL.createObjectURL(new Blob([b as Uint8Array<ArrayBuffer>], { type }));
      urls.push(u);
      return u;
    };
    const body = reportView(r, { open: () => undefined, url });
    const d = rt.chrome.dialog({ title: `Problem report · ${new Date(r.manifest.created).toLocaleString()}`, body, wide: true, buttons: [{ label: 'Close', primary: true }], onClose: () => setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 1000) });
    body.querySelector('#report-open')?.addEventListener('click', () => {
      d.close();
      void reopen(r);
    });
    return r;
  }

  /**
   * Opens the report's frames whose originals it holds, with their documents and history: each frame's saved edit
   * goes where the studio reads it on open (the KV, by hash, mode and place on a strip), then the file opens as the
   * mode it was. A file already open here stays as it is (the status line says so).
   */
  async function reopen(r: Report): Promise<number> {
    const byFile = new Map<string, { name: string; bytes: Uint8Array; kind: string }>();
    for (const f of r.frames) {
      if (!f.original || !f.save) continue;
      await h.kv.put('logs', logKey(f.sha256, f.kind as 'negative-scan' | 'digital-raw', f.strip?.index), f.save);
      byFile.set(f.sha256, { name: f.file ?? f.name, bytes: f.original, kind: f.kind });
    }
    for (const x of byFile.values()) {
      const file = new File([x.bytes as Uint8Array<ArrayBuffer>], x.name);
      await h.openFiles([{ name: x.name, relPath: x.name, size: file.size, lastModified: file.lastModified, file: async () => file }], x.kind === 'digital-raw' ? 'photo' : 'negative');
    }
    journal.info('app', `opened ${byFile.size} file${byFile.size === 1 ? '' : 's'} of the report with their edits`, { code: 'REPORT_REOPENED' });
    return byFile.size;
  }

  const service: StudioDiagnostics & { reopen(r: Report): Promise<number> } = {
    journal,
    show,
    report,
    openReport,
    copySummary: () => void summary().then(copy),
    environment,
    build,
    reopen,
    get opened() {
      return opened;
    },
  };
  return service;
}

/** The quiet badge in the status line: the errors since he last looked, a click opens Help ▸ Diagnostics…. */
export function diagnosticsBadge(journal: Journal, open: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.id = 'diag-badge';
  b.className = 'pill cb-diag-badge';
  b.hidden = true;
  b.title = 'The studio recorded problems. Click to see them, or Help ▸ Report a Problem… to send them.';
  const draw = (): void => {
    const n = journal.unseenErrors;
    b.hidden = n === 0;
    b.dataset['count'] = String(n);
    b.textContent = n === 1 ? '1 problem' : `${n} problems`;
  };
  let queued = false;
  journal.subscribe(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      draw();
    });
  });
  b.addEventListener('click', open);
  draw();
  return b;
}
