// The studio's capture layers of the diagnostics journal (CHB-038), one per source the host owns: the GPU devices
// (the engine's, through GpuRuntime's events, and the presenter's), the engine worker, the LibRaw worker and the
// service worker. The console, uncaught errors and the runtime (commands, log entries, renders) are captured by the
// shell (captureConsole, captureErrors, services.journal). What the GPU said about itself is kept for the report's
// environment (`gpuFacts`).
import type { Journal } from '@chromobench/shell';
import type { WorkerLog } from './worker-protocol.ts';

/** GpuRuntime's events (@chromobench/gpu GpuEvent), structurally: the UI side never imports the GPU package. */
export type GpuEventLike =
  | { kind: 'device'; name: string; adapter: { vendor: string; architecture: string; description: string; fallback: boolean }; features: string[]; limits: Record<string, number>; requested: { features: string[]; limits: Record<string, number> }; budget?: { bytes: number; rule: string } }
  | { kind: 'error'; type: 'validation' | 'out-of-memory' | 'internal' | 'unknown'; message: string; during: string | null; scope?: 'submit' }
  | { kind: 'lost'; reason: string; message: string }
  | { kind: 'recreate'; why: string }
  | { kind: 'memory'; what: 'render'; during: string; peak: number; live: number; limit: number; resident: number }
  | { kind: 'memory'; what: 'evict'; freed: number; frames: number; live: number; limit: number; during: string | null }
  | { kind: 'memory'; what: 'recover'; ok: boolean; freed: number; live: number; limit: number; during: string; message: string };

/** What the devices said about themselves (the report's environment): the latest per role, and how many were made. */
export interface GpuFacts {
  engine: Extract<GpuEventLike, { kind: 'device' }> | null;
  presenter: { adapter: Record<string, unknown>; features: string[]; limits: Record<string, number> } | null;
  devicesMade: number;
  lost: { device: string; reason: string; message: string; at: number }[];
}
export const gpuFacts: GpuFacts = { engine: null, presenter: null, devicesMade: 0, lost: [] };

/** The engine's memory over this page (CHB-041): the highest per-render high-water mark, and the render that made it. */
export const gpuMemory = { high: 0, during: '', renders: 0, limit: 0 };
const MB = (x: number): number => Math.round(x / 2 ** 20);
/** a new high-water mark row only when the mark grows by this much (MB): one row per step, not per render */
const HIGH_STEP_MB = 32;

const CODE: Record<string, string> = { validation: 'GPU_VALIDATION', 'out-of-memory': 'GPU_OUT_OF_MEMORY', internal: 'GPU_INTERNAL', unknown: 'GPU_ERROR' };

/** The GPU engine's events as journal rows (source gpu). `device` names which device ('engine', 'presenter'). */
export function gpuEvents(journal: Journal, device = 'engine'): (e: GpuEventLike) => void {
  return (e) => {
    switch (e.kind) {
      case 'device':
        if (device === 'engine') gpuFacts.engine = e;
        gpuFacts.devicesMade++;
        journal.info('gpu', `${device} device: ${e.name}${e.adapter.fallback ? ' (software)' : ''}`, { code: 'GPU_DEVICE', data: { adapter: e.adapter, features: e.features, requested: e.requested, ...(e.budget ? { budgetMB: MB(e.budget.bytes), budgetRule: e.budget.rule } : {}) } });
        return;
      case 'memory':
        memoryRow(journal, e);
        return;
      case 'error':
        // the message names the pipeline, texture or bind group by its label; what ran is in the data (it differs per
        // node, so it must not split a repeated error into many rows)
        journal.error('gpu', `${device}: ${e.type} error: ${e.message}`, { code: CODE[e.type] ?? 'GPU_ERROR', data: { device, during: e.during, ...(e.scope ? { scope: e.scope } : {}) } });
        return;
      case 'lost':
        gpuFacts.lost.push({ device, reason: e.reason, message: e.message, at: Date.now() });
        // a device the studio destroys itself (a layout switch, a dispose) is no problem
        if (e.reason === 'destroyed') journal.info('gpu', `${device} device destroyed`, { code: 'GPU_DEVICE_DESTROYED' });
        else journal.error('gpu', `${device} device lost: ${e.reason}${e.message ? `: ${e.message}` : ''}`, { code: 'GPU_DEVICE_LOST' });
        return;
      case 'recreate':
        journal.warn('gpu', `${device} device made again after a loss`, { code: 'GPU_RECREATE', data: { why: e.why } });
        return;
    }
  };
}

/**
 * The engine's memory as journal rows (CHB-041). Every render: one row "GPU memory per render" whose count is the
 * renders and whose data is the latest render's high-water mark and the page's highest so far (a row per render would
 * push everything else out of the ring); a row when the highest grows by HIGH_STEP_MB; a row when textures of frames not
 * on screen were let go; a warning when the engine ran out and recovered, an error when it did not.
 */
function memoryRow(journal: Journal, e: Extract<GpuEventLike, { kind: 'memory' }>): void {
  switch (e.what) {
    case 'render': {
      const m = gpuMemory;
      m.renders++;
      m.limit = e.limit;
      const grew = MB(e.peak) >= MB(m.high) + HIGH_STEP_MB || m.high === 0;
      if (e.peak > m.high) {
        m.high = e.peak;
        m.during = e.during;
      }
      journal.info('gpu', 'GPU memory per render', { code: 'GPU_MEMORY', data: { peakMB: MB(e.peak), liveMB: MB(e.live), residentMB: MB(e.resident), limitMB: MB(e.limit), during: e.during, highMB: MB(m.high), highDuring: m.during, renders: m.renders } });
      if (grew) journal.info('gpu', `GPU memory high-water mark: ${MB(e.peak)} MB of ${MB(e.limit)} MB`, { code: 'GPU_MEMORY_HIGH', data: { during: e.during, liveMB: MB(e.live), residentMB: MB(e.resident) } });
      return;
    }
    case 'evict':
      journal.info('gpu', 'GPU memory: textures of frames not on screen let go to make room', { code: 'GPU_EVICT', data: { freedMB: MB(e.freed), frames: e.frames, liveMB: MB(e.live), limitMB: MB(e.limit), during: e.during } });
      return;
    case 'recover':
      if (e.ok) journal.warn('gpu', 'GPU memory ran out: let go of what the render did not need, and it succeeded on the second try', { code: 'GPU_OOM_RECOVERED', data: { freedMB: MB(e.freed), liveMB: MB(e.live), limitMB: MB(e.limit), during: e.during, first: e.message } });
      else journal.error('gpu', 'GPU memory ran out, and again after letting go of everything the render did not need', { code: 'GPU_OOM', data: { freedMB: MB(e.freed), liveMB: MB(e.live), limitMB: MB(e.limit), during: e.during, first: e.message } });
      return;
  }
}

/** A device the host made itself (the presenter's): its uncaptured errors and its loss, and what it is. */
/** the devices the host made itself (the test hook injects a validation error into one) */
export const watchedDevices: GPUDevice[] = [];

export function watchDevice(journal: Journal, device: GPUDevice, adapter: GPUAdapter | null, name: string): void {
  watchedDevices.push(device);
  const report = gpuEvents(journal, name);
  if (adapter) {
    const i = adapter.info;
    const limits: Record<string, number> = {};
    for (const k in device.limits) {
      const v = (device.limits as unknown as Record<string, unknown>)[k];
      if (typeof v === 'number') limits[k] = v;
    }
    gpuFacts.presenter = { adapter: { vendor: i.vendor, architecture: i.architecture, description: i.description, device: i.device }, features: [...device.features].map(String).sort(), limits };
    gpuFacts.devicesMade++;
    journal.info('gpu', `${name} device: ${[i.vendor, i.architecture, i.description].filter(Boolean).join(' ') || 'GPU'}`, { code: 'GPU_DEVICE' });
  }
  device.addEventListener('uncapturederror', (ev) => {
    const err = (ev as GPUUncapturedErrorEvent).error;
    const n = err?.constructor?.name ?? '';
    const type = n === 'GPUValidationError' ? 'validation' : n === 'GPUOutOfMemoryError' ? 'out-of-memory' : n === 'GPUInternalError' ? 'internal' : 'unknown';
    report({ kind: 'error', type, message: err.message, during: null });
  });
  void device.lost.then((info) => report({ kind: 'lost', reason: String(info.reason), message: info.message }));
}

/** The engine worker's events (its console and its crash) as journal rows (source worker). */
export function workerLog(journal: Journal): (l: WorkerLog) => void {
  return (l) => void journal.add({ level: l.level, source: 'worker', message: l.message, ...(l.code ? { code: l.code } : {}), ...(l.data !== undefined ? { data: l.data } : {}) });
}

/** A worker the host started (LibRaw's): its uncaught errors (source decode). */
export function watchWorker(journal: Journal, w: { addEventListener(t: 'error', f: (e: ErrorEvent) => void): void }, name: string): void {
  w.addEventListener('error', (e) => void journal.error('decode', `the ${name} worker failed: ${e.message ?? 'unknown'}`, { code: 'E_WORKER', data: e.filename ? { at: `${e.filename}:${e.lineno}` } : undefined }));
}

/** The service worker's version and its updates (source sw). Returns what is known of it, for the report. */
export interface SwFacts {
  state: 'none' | 'registering' | 'registered' | 'failed';
  scriptURL?: string;
  /** the cache version the running service worker answers ('chromobench-shell-v1'); null: it did not answer (an older build) */
  version?: string | null;
  controller: boolean;
  updates: number;
}
export const swFacts: SwFacts = { state: 'none', controller: false, updates: 0 };

/** Asks the controlling service worker for its version (public/sw.js answers { version }); null after 1.5 s. */
export async function swVersion(sw: ServiceWorkerContainer): Promise<string | null> {
  const c = sw.controller;
  if (!c) return null;
  return new Promise((ok) => {
    const ch = new MessageChannel();
    const t = setTimeout(() => ok(null), 1500);
    ch.port1.onmessage = (e: MessageEvent) => {
      clearTimeout(t);
      ok(typeof (e.data as { version?: unknown })?.version === 'string' ? (e.data as { version: string }).version : null);
    };
    c.postMessage({ type: 'version' }, [ch.port2]);
  });
}

export function watchServiceWorker(journal: Journal, sw: ServiceWorkerContainer, reg: ServiceWorkerRegistration): void {
  swFacts.state = 'registered';
  swFacts.scriptURL = (reg.active ?? reg.waiting ?? reg.installing)?.scriptURL ?? '';
  swFacts.controller = !!sw.controller;
  const ask = (): void =>
    void swVersion(sw).then((v) => {
      swFacts.version = v;
      journal.info('sw', `service worker ${v ?? 'without a version (an older build)'}${sw.controller ? '' : ' (not controlling yet)'}`, { code: 'SW_VERSION', data: { scriptURL: swFacts.scriptURL, version: v } });
    });
  ask();
  sw.addEventListener('controllerchange', () => {
    swFacts.controller = true;
    journal.info('sw', 'a new service worker took over the page', { code: 'SW_CONTROLLER' });
    ask();
  });
  reg.addEventListener('updatefound', () => {
    swFacts.updates++;
    const w = reg.installing;
    journal.info('sw', 'a service worker update was found', { code: 'SW_UPDATE' });
    w?.addEventListener('statechange', () => {
      if (w.state === 'installed' || w.state === 'redundant') journal.info('sw', `the update is ${w.state}`, { code: 'SW_UPDATE_STATE' });
    });
  });
}
