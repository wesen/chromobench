// The studio's state and its typed selectors (CHB-035 §31 rule 3, §32; CHB-029 item 7). Interaction lambdas read
// state through these, never by hand: `cb.sel.current(s)` is the one current frame, `cb.sel.frame(s)` its handle.
// Kits add their own (`cb.kits.roll.sel.*`, `cb.kits.looks.sel.*`); headless and DOM code import this module.
import type { Document } from '@chromobench/contract';
import { frameRef, type FrameRef } from './handles.ts';
import type { ViewMode } from './model/settings.ts';
import type { OpenAs } from './bridge/frames.ts';
import type { HostFlags, LogView, Proposal } from './studio.ts';

export interface CatalogFrame {
  id: string;
  sha256: string;
  name: string;
  flag: 'pick' | 'reject' | null;
  stars: number;
  label: string | null;
  keywords: string[];
  /** how the file is open: as a photo or as a negative (CHB-027) */
  kind?: 'photo' | 'negative';
  /** a small JPEG of the last print (data URL), so the library shows the frame after a reload (F5) */
  thumb?: string;
  /** a frame of a strip (CHB-027 WS-D): the file's name (`name` adds the frame's place, "raw010.dng · 2/3") */
  file?: string;
}
export interface Selection {
  ids: string[];
  primary: string | null;
  anchor: string | null;
}
export interface Snapshot {
  id: string;
  name: string;
  ts: number;
  /** the frame's document when the snapshot was taken (Restore writes it back as one step) */
  doc: Document;
}
export interface CbView {
  module?: string;
  mode: string;
  view: ViewMode;
  compare: string;
  split: number;
  step: string;
  filter: { text: string; flag: string | null };
  thumbSize: number;
  vp: Record<string, unknown>;
}
export interface CbUi {
  selection: Selection;
  tool: string | null;
  toolOptions: Record<string, any>;
  focusPath: string | null;
  probe: [number, number] | null;
  showProposal: string | null;
  approvals: Record<string, { off?: number[]; stale?: { code: string; message: string }[] }>;
  /** what the Studio publishes about the log: a change counter and the pending proposals per frame */
  log?: LogView;
  /** what the host publishes (Studio.setHost): its folder and the layouts it can switch to */
  host?: HostFlags;
}
export interface CbPrefs {
  agentMode: 'read-only' | 'ask' | 'auto';
  /** how File ▸ Open opens (CHB-027) */
  openAs?: OpenAs;
  /** keep it after a restart (CHB-031 F18: else Guess at start) */
  openAsKeep?: boolean;
  /** heal dust on open */
  dust?: boolean;
}
/**
 * The state cb.core declares (the kits add their slices: roll, rollView, finish, looks, looksView). `docs.<frame>` is
 * the frame's document in the store's log (mounted by cb.core, opened by the Studio); the library (`catalog`) is
 * the view tier: opening a file is not an edit.
 */
export interface CbState {
  catalog: { frames: Record<string, CatalogFrame>; order: string[] };
  snapshots: Record<string, Snapshot[]>;
  docs: Record<string, Document>;
  view: CbView;
  ui: CbUi;
  prefs: CbPrefs;
  workspace: Record<string, unknown>;
}

/** a state that may not have every slice yet (a selector runs on whatever the store holds) */
type St = Partial<CbState> | null | undefined;

/** the frame shown (the selection's primary), or null */
const current = (s: St): string | null => s?.ui?.selection?.primary ?? null;

/** the frames of the catalog in roll order, after the library filter, including those not open in this session
 *  (CHB-027 F5: listed with their saved thumbnail; selecting one asks the host to read its file again) */
function library(s: St): CatalogFrame[] {
  const c = s?.catalog;
  if (!c) return [];
  const f = s?.view?.filter ?? { text: '', flag: null };
  const text = String(f.text ?? '').toLowerCase();
  return c.order
    .map(id => c.frames[id])
    .filter((x): x is CatalogFrame => !!x)
    .filter(x => (!text || x.name.toLowerCase().includes(text) || x.keywords.some(k => k.toLowerCase().includes(text))) && (!f.flag || (f.flag === 'unflagged' ? !x.flag : x.flag === f.flag)));
}

/** The typed selectors (τ): every read of the studio's state goes through one of these. */
export const sel = {
  current,
  /** the selected frames (ids), in selection order */
  selection: (s: St): string[] => s?.ui?.selection?.ids ?? [],
  /** what a command acts on: the selection, else the current frame */
  targets: (s: St): string[] => {
    const ids = s?.ui?.selection?.ids ?? [];
    if (ids.length) return ids;
    const c = current(s);
    return c ? [c] : [];
  },
  /** a frame's handle (the current one by default), or null when it is not open */
  frame: (s: St, id?: string | null): FrameRef | null => {
    const f = id ?? current(s);
    if (!f) return null;
    const d = s?.docs?.[f];
    if (!d) return null;
    return frameRef(f, d, f === current(s) ? 'frame' : `frames['${f}']`);
  },
  /**
   * a frame's handle on its committed document (the current one by default), or null when it is not open: what
   * thumbnails show, so a drag re-renders the viewer only, and the thumbnails once on release
   */
  committed: (s: St, id?: string | null): FrameRef | null => {
    const f = id ?? current(s);
    return f && s?.docs?.[f] ? frameRef(f, 'committed', f === current(s) ? 'frame' : `frames['${f}']`) : null;
  },
  /** a frame's document (the current one by default), as the state shows it (with a gesture's preview) */
  doc: (s: St, id?: string | null): Document | undefined => s?.docs?.[id ?? current(s) ?? ''],
  /** a frame's catalog entry (the current one by default) */
  entry: (s: St, id?: string | null): CatalogFrame | undefined => s?.catalog?.frames?.[id ?? current(s) ?? ''],
  /** a frame's name in the library (the current one by default), or '' */
  name: (s: St, id?: string | null): string => s?.catalog?.frames?.[id ?? current(s) ?? '']?.name ?? '',
  library,
  /** the library's frames that are open in this session (frames whose file was not opened since a reload are left
   *  out until their file is opened again) */
  visible: (s: St): CatalogFrame[] => library(s).filter(x => !s?.docs || !!s.docs[x.id]),
  /** a library frame whose file is not open in this session */
  isOffline: (s: St, id: string): boolean => !!s?.catalog?.frames?.[id] && !s?.docs?.[id],
  /** how a frame is open: as a photo or a negative (a library frame: as the catalog says) */
  kind: (s: St, id: string | null): 'photo' | 'negative' | null =>
    id ? (s?.docs?.[id] ? (s.docs[id]!.stages.scan ? 'negative' : 'photo') : (s?.catalog?.frames?.[id]?.kind ?? null)) : null,
  /** the agent's pending proposals on a frame (the current one by default) */
  proposals: (s: St, id?: string | null): Proposal[] => s?.ui?.log?.proposals?.[id ?? current(s) ?? ''] ?? [],
  /** a counter of log changes (a cell that reads the log itself depends on it) */
  logVersion: (s: St): number => s?.ui?.log?.v ?? 0,
  /** a frame's snapshots (the current one by default) */
  snapshots: (s: St, id?: string | null): Snapshot[] => s?.snapshots?.[id ?? current(s) ?? ''] ?? [],
  prefs: (s: St): Partial<CbPrefs> => s?.prefs ?? {},
  view: (s: St): Partial<CbView> => s?.view ?? {},
  /** the module shown */
  module: (s: St): string | null => s?.view?.module ?? null,
  /** the active tool */
  tool: (s: St): string | null => s?.ui?.tool ?? null,
  /** what the host publishes: its folder and its layouts */
  host: (s: St): HostFlags | null => s?.ui?.host ?? null,
};
export type Sel = typeof sel;
