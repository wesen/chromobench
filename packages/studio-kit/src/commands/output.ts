// The Output module's commands (CHB-047, OUT-1): his export settings (output.set), the export of this frame or of the
// selected frames (output.export: the host's capability host.exportFrames, with progress and results in ui.export),
// Cancel, and File ▸ Export… (the same settings in a dialog, in every layout). The settings are his preferences
// (prefs.export: kept, never undone); an export changes no document, so it runs in every agent mode.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CommandTable, Ctx } from '@chromobench/shell';
import { sel, type CbState } from '../sel.ts';
import type { StudioHost } from '../studio.ts';
import { exportPrefsOf, exportPrefsProblem, type ExportPrefs, type ExportResult, type ExportRun } from '../model/export.ts';
import { needFrame } from './env.ts';

/** What the host's export does with the frames (StudioHost.exportFrames). */
export interface ExportRequestOf {
  frames: string[];
  settings: ExportPrefs;
  /** 'files': where he chooses (one file: a save dialog; several: a folder), else downloads; 'memory': nothing written (an agent, a test) */
  to: 'files' | 'memory';
  signal: AbortSignal;
  onProgress: (p: Omit<ExportRun, 'results' | 'running'> & { results: ExportResult[] }) => void;
}

const running = new WeakMap<object, AbortController>();

/** The frames an export takes: 'current', 'selected' (the selection, else the current frame), or ids. */
function framesOf(s: Partial<CbState>, which: 'current' | 'selected' | readonly string[] = 'selected'): string[] {
  if (Array.isArray(which)) return [...which];
  if (which === 'current') return sel.current(s) ? [sel.current(s)!] : [];
  return sel.targets(s).filter((id) => !!s.docs?.[id]);
}

const explain = (ctx: Ctx<CbState>, e: unknown): string => ctx.rt.explainError?.(e, {})?.text ?? (e instanceof Error ? e.message : String(e));

async function runExport(ctx: Ctx<CbState>, o: { frames?: 'current' | 'selected' | string[]; to?: 'files' | 'memory' } = {}): Promise<ExportResult[]> {
  const host = ctx.host as StudioHost;
  const frames = framesOf(ctx.state, o.frames);
  if (!frames.length) {
    ctx.toast('Open a photo first', { kind: 'info' });
    return [];
  }
  if (running.has(ctx.rt)) {
    ctx.toast('An export is running: wait for it, or cancel it', { kind: 'info' });
    return [];
  }
  const ac = new AbortController();
  running.set(ctx.rt, ac);
  const settings = exportPrefsOf(ctx.state);
  const start: ExportRun = { running: true, at: 1, total: frames.length, file: '', phase: 'plan', tilesDone: 0, tilesTotal: 0, results: [] };
  ctx.set({ ui: { export: start } });
  try {
    const results = await host.exportFrames!({
      frames, settings, to: o.to ?? 'files', signal: ac.signal,
      onProgress: (p) => ctx.set({ ui: { export: { ...p, running: true } } }),
    });
    ctx.set({ ui: { export: { ...start, running: false, at: frames.length, results, ...(ac.signal.aborted ? { cancelled: true } : {}) } } });
    const ok = results.filter((r) => r.ok).length;
    if (ac.signal.aborted) ctx.toast(`Export cancelled after ${ok} of ${frames.length}`, { kind: 'info' });
    else if (ok < results.length) ctx.toast(`Exported ${ok} of ${results.length}: ${results.find((r) => !r.ok)?.error ?? 'failed'}`, { kind: 'warn', ms: 6000 });
    return results;
  } catch (e) {
    const error = explain(ctx, e);
    ctx.set({ ui: { export: { ...start, running: false, results: [{ frame: frames[0]!, file: '', ok: false, error }] } } });
    ctx.toast(`Export failed: ${error}`, { kind: 'error', ms: 6000 });
    return [];
  } finally {
    running.delete(ctx.rt);
  }
}

export const outputCommands = (): CommandTable<CbState> => ({
  'output.set': {
    label: 'Export Settings',
    palette: false,
    // his preferences, not an edit: kept across sessions, never undone
    run: (ctx, p: Partial<ExportPrefs> = {}) => {
      const why = exportPrefsProblem(p);
      if (why) {
        // a value out of range (an agent's, a typed number): said, and nothing changes
        ctx.toast(why, { kind: 'warn' });
        return { error: why };
      }
      const next = { ...exportPrefsOf(ctx.state), ...p };
      ctx.set({ prefs: { export: next } });
      return next;
    },
  },
  'output.export': {
    label: s => {
      const n = framesOf(s as Partial<CbState>).length;
      return n > 1 ? `Export ${n} Photos` : 'Export';
    },
    ...needFrame,
    requires: 'host.exportFrames',
    run: (ctx, o?: { frames?: 'current' | 'selected' | string[]; to?: 'files' | 'memory' }) => runExport(ctx, o ?? {}),
  },
  'output.addPrinterProfile': {
    label: 'Add Printer Profile…',
    requires: 'host.addPrinterProfile',
    run: ctx => (ctx.host as StudioHost).addPrinterProfile!(),
  },
  'output.cancel': {
    label: 'Cancel Export',
    palette: false,
    enabled: s => !!(s as Partial<CbState>).ui?.export?.running,
    why: 'No export is running',
    run: ctx => {
      running.get(ctx.rt)?.abort();
      return null;
    },
  },
  // File ▸ Export… (Mod+E): his settings in a dialog (the Output panel's form), then the export of the selection
  'file.export': {
    label: 'Export…',
    ...needFrame,
    requires: 'host.exportFrames',
    run: async ctx => {
      const make = ctx.services['exportForm'] as ((ctx: Ctx<CbState>) => HTMLElement) | undefined;
      const n = framesOf(ctx.state).length;
      if (make) {
        const r = await ctx.rt.chrome.dialog({
          title: n > 1 ? `Export ${n} photos` : `Export ${sel.name(ctx.state)}`,
          body: make(ctx),
          buttons: [{ label: 'Cancel', value: 'cancel' }, { label: n > 1 ? `Export ${n}` : 'Export', value: 'export', primary: true }],
        }).result;
        if (r !== 'export') return null;
      }
      return runExport(ctx, {});
    },
  },
});
