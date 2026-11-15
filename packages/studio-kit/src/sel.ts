// The studio's state and its typed selectors (CHB-035 §31 rule 3, §32; CHB-029 item 7). Interaction lambdas read
// state through these, never by hand: `cb.sel.current(s)` is the one current frame, `cb.sel.frame(s)` its handle.
// Kits add their own (`cb.kits.roll.sel.*`, `cb.kits.looks.sel.*`); headless and DOM code import this module.
import type { FrameRecipe } from '@chromobench/contract';
import { frameRef, type FrameRef } from './handles.ts';
import type { ViewMode } from './model/recipes.ts';
import type { OpenAs } from './bridge/frames.ts';
import type { HostFlags } from './studio.ts';

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
  stateHash: string;
  recipe: FrameRecipe;
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
/** The state cb.core declares (the kits add their slices: roll, rollView, finish, looks, looksView). */
export interface CbState {
  catalog: { frames: Record<string, CatalogFrame>; order: string[] };
  snapshots: Record<string, Snapshot[]>;
  recipes: Record<string, FrameRecipe>;
  proposals: Record<string, any[]>;
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
    const r = s?.recipes?.[f];
    if (!r) return null;
    return frameRef(f, r, f === current(s) ? 'frame' : `frames['${f}']`);
  },
  /** a frame's recipe (the current one by default) */
  recipe: (s: St, id?: string | null): FrameRecipe | undefined => s?.recipes?.[id ?? current(s) ?? ''],
  /** a frame's catalog entry (the current one by default) */
  entry: (s: St, id?: string | null): CatalogFrame | undefined => s?.catalog?.frames?.[id ?? current(s) ?? ''],
  /** a frame's name in the library (the current one by default), or '' */
  name: (s: St, id?: string | null): string => s?.catalog?.frames?.[id ?? current(s) ?? '']?.name ?? '',
  library,
  /** the library's frames that are open in this session (frames whose file was not opened since a reload are left
   *  out until their file is opened again) */
  visible: (s: St): CatalogFrame[] => library(s).filter(x => !s?.recipes || !!s.recipes[x.id]),
  /** a library frame whose file is not open in this session */
  isOffline: (s: St, id: string): boolean => !!s?.catalog?.frames?.[id] && !s?.recipes?.[id],
  /** how a frame is open: as a photo or a negative (a library frame: as the catalog says) */
  kind: (s: St, id: string | null): 'photo' | 'negative' | null =>
    id ? (s?.recipes?.[id] ? (s.recipes[id]!.kind === 'digital-raw' ? 'photo' : 'negative') : (s?.catalog?.frames?.[id]?.kind ?? null)) : null,
  /** the agent's pending proposals on a frame (the current one by default) */
  proposals: (s: St, id?: string | null): any[] => s?.proposals?.[id ?? current(s) ?? ''] ?? [],
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
