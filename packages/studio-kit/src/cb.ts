// createCb(ck): the `cb` namespace (guide §4–5) bound to one ck instance. Everything here records nodes and
// definitions; nothing touches the DOM, an engine or storage. Services (the frames, the EditLog route, the render
// bridge) are reached at run time through ctx.services.studio.
//
//   cb.studio(name)       ck.shell(name).use(cb.core) with chromobench's state options
//   cb.core               the kit: state, routes, forms, fragments, commands, tools, keys, passes, docs
//   cb.sel.*              the typed selectors (current, frame, recipe, visible, …): every read of state
//   cb.arg / cb.viewer    a control from ArgSpec; the viewer      cb.panels.*   history, approvals, why, snapshots, …
//   cb.modules.*          library, print                          cb.views.*    grid, strip, loupe, compare, survey, ring
//   cb.menus.*            file … help, standard()                 cb.keys.*     cull, libraryModes, views, darkroom
//   cb.kits.*             roll, finish, looks, chat: each { kit, panels, views, modules, menus, keys, sel, lib, … }
//   cb.cell.frame         a θ cell: a print thumbnail (bg lane, cached by node id) + name, flag, stars

/* eslint-disable @typescript-eslint/no-explicit-any */
import { defaultRecipe, getPath, type FrameRecipe, type Vec3 } from '@chromobench/contract';
import { isProps, libraryRoot, type Ck, type CommandTable, type NodeData, type ToolTable } from '@chromobench/shell';
import { argModel, argProblem, parseStep, stepUnits, STRIPPABLE } from './kit/args.ts';
import { CB_FORMS } from './kit/forms.ts';
import { frameRef, isImageHandle, type FrameRef, type ImageHandle } from './handles.ts';
import { DARKROOM, allParameters, type Arrangement } from './model/arrangement.ts';
import { controlModels } from './kit/args.ts';
import { diffRecipes, PRINT_SETTINGS, VIEW_MODES, type ViewMode } from './model/recipes.ts';
import { ringTiles, stripLabel, stripMutation, stripValues, maskSpec, nextExposureId, type StripVary, type MaskDoc } from './model/tools.ts';
import type { Studio } from './studio.ts';
import { sel, type CatalogFrame, type CbState } from './sel.ts';
import type { OpenAs } from './bridge/frames.ts';
import { createRollKit, rollTag } from '../kits/roll/src/kit.ts';
import { createFinishKit } from '../kits/finish/src/kit.ts';
import { orientFrame } from '../kits/finish/src/geometry.ts';
import { createLooksKit } from '../kits/looks/src/kit.ts';
import { createChatKit } from '../kits/chat/src/kit.ts';

// variants' lines, not studio-kit's, are the call sites of their nodes
libraryRoot(new URL('.', import.meta.url).href);

/** cb.core's state slices, typed by CbState (the kits declare theirs: ROLL_STATE, FINISH_STATE, LOOKS_STATE) */
export const CORE_STATE: Pick<CbState, 'catalog' | 'snapshots' | 'view' | 'ui' | 'prefs'> = {
  catalog: { frames: {}, order: [] },
  snapshots: {},
  view: { mode: 'grid', view: 'print', compare: 'off', split: 0.5, step: 'pick', filter: { text: '', flag: null }, thumbSize: 150, vp: {} },
  ui: {
    selection: { ids: [], primary: null, anchor: null },
    tool: null,
    toolOptions: { 'test-strip': { vary: 'time', step: 1 / 3, count: 5 }, 'ring-around': { step: 4 }, 'mask-brush': { radius: 6 } },
    focusPath: null,
    probe: null,
    showProposal: null,
    approvals: {},
  },
  prefs: { agentMode: 'ask' },
};

const studioOf = (ctx: any): Studio => {
  const s = ctx.services?.studio as Studio | undefined;
  if (!s) throw new Error('No studio service: start the app with studio.services()');
  return s;
};
/** the host's actions (ui.host, written by Studio.setHost) */
const hostHas = (s: any, action: string): boolean => !!sel.host(s)?.actions?.includes(action);

/** the thumbnail context menu (CHB-027, F6) */
export const FRAME_CONTEXT = ['frame.reopenAsPhoto', 'frame.reopenAsNegative', '-', 'frame.rotateLeft', 'frame.rotateRight', '-', 'frame.pick', 'frame.reject', 'frame.unflag', '-', 'frame.remove'];

export function createCb(ck: Ck) {
  const node = (form: string, props: Record<string, unknown> = {}, kids: unknown[] = []): any => ck.node(form, props, kids);

  // ── fragments ──
  const testStripFragment = ck.fragment('cb.arg', {
    when: n => STRIPPABLE.has(String(n.props['path'])),
    methods: { testStrip: (opts: Record<string, unknown> = {}) => ({ strip: { step: '1/3 st', ...opts } }) },
    doc: 'A Strip button beside time or filtration that opens the test strip around this value (T)',
  });
  const padFragment = ck.fragment('cb.arg', {
    when: n => String(n.props['path']) === 'print.lights.logH',
    methods: { pad: () => ({ widget: 'pad' }) },
    doc: 'Printer lights as a colour pad plus a density slider, in points',
  });

  // ── passes ──
  const argsPass = ck.pass('cb.args', { on: 'ui', after: 'slots' }, (ir: any, p) => {
    for (const n of ir.find('cb.arg') as NodeData[]) {
      const path = String(n.props['path'] ?? '');
      const pr = argProblem(path);
      if (pr?.code === 'CB-A101') {
        p.error('CB-A101', pr.message, { at: n.at, ...(pr.fix ? { fix: pr.fix } : {}), facts: [`did you mean ${pr.fix ? pr.fix.slice(8, -2) : '…'}?`, `${pr.valid.length} recipe paths have controls`] });
        continue;
      }
      if (pr) {
        p.warn(pr.code, pr.message, { at: n.at });
        continue;
      }
      const a = argModel(path)!;
      const st = n.props['step'];
      if (st !== undefined) {
        const s = parseStep(st);
        const ok = stepUnits(a.model);
        if (!s || !ok.includes(s.unit)) p.error('CB-A110', `cb.arg('${path}'): the step ${JSON.stringify(st)} does not fit ${a.model.label} (${a.model.displayUnit})`, { at: n.at, facts: [`steps for this path: ${ok.filter(Boolean).join(', ') || 'plain numbers'}`] });
      }
      const w = n.props['widget'];
      if (w === 'pad' && a.model.type !== 'vec3') p.error('CB-A120', `cb.arg('${path}'): the pad widget edits printer lights (vec3), not ${a.model.type}`, { at: n.at, fix: `cb.arg('print.lights.logH').pad()` });
    }
  });
  /** CB-R001, CB-F102, CB-L001: a kit's forms or tools used where the kit is not installed (the kit's own passes run
   *  only where it is installed, so cb.core runs each kit's check) */
  const kitsPass = ck.pass('cb.kits', { on: 'ui', after: 'slots' }, (ir: any, p) => {
    for (const k of Object.values(cb.kits)) (k as { whenAbsent?: (ir: unknown, p: unknown) => void }).whenAbsent?.(ir, p);
  });
  const handlesPass = ck.pass('cb.handles', { on: 'ui', after: 'normalize' }, (ir: any, p) => {
    for (const n of ir.find('viewport') as NodeData[]) {
      const views = n.props['views'];
      if (Array.isArray(views)) for (const v of views) if (!VIEW_MODES.includes(v)) p.error('CB-F201', `viewer '${n.props['id']}': unknown view '${v}'`, { at: n.at, facts: [`views: ${VIEW_MODES.join(', ')}`] });
    }
  });

  const recipeOf = (ctx: any, f: string): FrameRecipe | undefined => ctx.state.recipes?.[f];
  // ── the command table and the tools ──
  const needFrame = { enabled: (s: any) => !!sel.current(s), why: 'Open a frame first' };
  const flag = (ctx: any, v: CatalogFrame['flag'], label: string) =>
    ctx.tx(label, (t: any) => {
      for (const id of sel.targets(ctx.state)) if (t.catalog.frames[id]) t.catalog.frames[id].flag = v;
    });
  const hostRun = (ctx: any, action: string, ...args: unknown[]): unknown => {
    const h = studioOf(ctx).host as Record<string, unknown> | null;
    const f = h?.[action];
    if (typeof f === 'function') return (f as (...a: unknown[]) => unknown).apply(h, args);
    ctx.toast('Not available in this window', { kind: 'why' });
    return null;
  };
  const openFrame = { enabled: (s: any) => !!sel.recipe(s), why: 'Open a frame first' };
  const orientCurrent = (ctx: any, step: 'cw90' | 'ccw90' | 'flipH', label: string): void => {
    const f = sel.current(ctx.state);
    const r = f ? recipeOf(ctx, f) : undefined;
    if (!f || !r) return;
    const next = orientFrame(r.view.frame, step);
    ctx.tx(label, (t: any) => t.$set(['recipes', f, 'view', 'frame'], { ...next, crop: next.crop ? { ...next.crop } : null }));
  };
  const reopenAs = async (ctx: any, id: string | null, as: 'photo' | 'negative'): Promise<unknown> => {
    if (!id) return null;
    const studio = studioOf(ctx);
    const name = ctx.state.catalog?.frames?.[id]?.name ?? id;
    if (!studio.frames.get(id)) {
      ctx.toast(`${name} is not open: select it to open its file first`, { kind: 'why' });
      return null;
    }
    ctx.toast(`Re-opening ${name} as a ${as}…`, { kind: 'info' });
    try {
      const r = await studio.reopen(id, as);
      ctx.toast(`${name} is open as a ${as} now${r.outcome === 'resumed' ? ` (its saved recipe as a ${as})` : ''}`, { kind: 'ok' });
      return r.entry.id;
    } catch (e) {
      ctx.toast(`${name}: ${String((e as { diag?: { message?: string } })?.diag?.message ?? (e as Error)?.message ?? e)}`, { kind: 'error' });
      return null;
    }
  };
  const coreCommands: CommandTable<CbState> = {
    'frame.pick': { label: 'Flag as Pick', ...needFrame, run: ctx => flag(ctx, 'pick', 'Flag as Pick') },
    'frame.reject': { label: 'Reject', ...needFrame, run: ctx => flag(ctx, 'reject', 'Reject') },
    'frame.unflag': { label: 'Unflag', ...needFrame, run: ctx => flag(ctx, null, 'Unflag') },
    'frame.rate': {
      label: 'Set Stars',
      palette: false,
      ...needFrame,
      run: (ctx, n: number) =>
        ctx.tx(`${n} Stars`, (t: any) => {
          for (const id of sel.targets(ctx.state)) if (t.catalog.frames[id]) t.catalog.frames[id].stars = n;
        }),
    },
    'frame.label': {
      label: 'Set Colour Label',
      palette: false,
      ...needFrame,
      run: (ctx, colour: string | null) =>
        ctx.tx(`Label ${colour ?? 'none'}`, (t: any) => {
          const id = sel.current(ctx.state)!;
          if (t.catalog.frames[id]) t.catalog.frames[id].label = t.catalog.frames[id].label === colour ? null : colour;
        }),
    },
    'frame.select': {
      label: 'Select Frame',
      palette: false,
      run: (ctx, id: string) => {
        studioOf(ctx).route.endBurst();
        ctx.set({ ui: { selection: { ids: [id], primary: id, anchor: id }, showProposal: null } });
      },
    },
    'frame.reopenAsPhoto': {
      label: 'Re-open as Photo',
      enabled: (s: any) => !!sel.recipe(s),
      why: 'Open a frame first',
      hidden: (s: any) => sel.kind(s, sel.current(s)) === 'photo',
      run: (ctx, item?: CatalogFrame) => reopenAs(ctx, item?.id ?? sel.current(ctx.state), 'photo'),
    },
    'frame.reopenAsNegative': {
      label: 'Re-open as Negative',
      enabled: (s: any) => !!sel.recipe(s),
      why: 'Open a frame first',
      hidden: (s: any) => sel.kind(s, sel.current(s)) === 'negative',
      run: (ctx, item?: CatalogFrame) => reopenAs(ctx, item?.id ?? sel.current(ctx.state), 'negative'),
    },
    'frame.remove': {
      label: (s: any) => (sel.selection(s).length > 1 ? `Remove ${sel.selection(s).length} Frames from Library` : 'Remove from Library'),
      ...needFrame,
      run: ctx => {
        const ids = sel.targets(ctx.state);
        if (!ids.length) return;
        const names = ids.map(id => ctx.state.catalog?.frames?.[id]?.name ?? id);
        studioOf(ctx).remove(ids);
        ctx.toast(`${names.length === 1 ? `Removed ${names[0]}` : `Removed ${names.length} frames`}: open the file again to get it back, with its recipe`, { kind: 'info' });
      },
    },
    // CHB-031 F20: turn or mirror the frame shown (view.frame.orientation; a strip's frames may come sideways)
    'frame.rotateLeft': { label: 'Rotate Left', ...openFrame, run: ctx => orientCurrent(ctx, 'ccw90', 'Rotate Left') },
    'frame.rotateRight': { label: 'Rotate Right', ...openFrame, run: ctx => orientCurrent(ctx, 'cw90', 'Rotate Right') },
    'frame.flip': { label: 'Flip Left to Right', ...openFrame, run: ctx => orientCurrent(ctx, 'flipH', 'Flip') },
    // ── the host's actions (CHB-027: the top bar folded into the menus); hidden where the host has none ──
    'file.open': { label: 'Open Files…', hidden: (s: any) => !hostHas(s, 'openFiles'), run: ctx => hostRun(ctx, 'openFiles') },
    'file.openFolder': { label: 'Open Folder…', hidden: (s: any) => !hostHas(s, 'openFolder'), run: ctx => hostRun(ctx, 'openFolder') },
    'file.reopenFolder': {
      label: (s: any) => `Reopen ${s.ui?.host?.folder ?? 'Last Folder'}`,
      hidden: (s: any) => !hostHas(s, 'reopenFolder') || !s.ui?.host?.folder,
      run: ctx => hostRun(ctx, 'reopenFolder'),
    },
    'file.openAs.auto': { label: 'Photo or Negative: Guess', palette: false, checked: (s: any) => (s.prefs?.openAs ?? 'auto') === 'auto', hidden: (s: any) => !hostHas(s, 'openFiles'), run: ctx => ctx.set({ prefs: { openAs: 'auto' } }) },
    'file.openAs.photo': { label: 'Open as Photos', palette: false, checked: (s: any) => s.prefs?.openAs === 'photo', hidden: (s: any) => !hostHas(s, 'openFiles'), run: ctx => ctx.set({ prefs: { openAs: 'photo' } }) },
    'file.openAs.negative': { label: 'Open as Negatives', palette: false, checked: (s: any) => s.prefs?.openAs === 'negative', hidden: (s: any) => !hostHas(s, 'openFiles'), run: ctx => ctx.set({ prefs: { openAs: 'negative' } }) },
    // F18: Photos / Negatives last until the studio restarts (then Guess), unless kept
    'file.openAs.keep': { label: 'Keep This Choice After Restart', palette: false, checked: (s: any) => !!s.prefs?.openAsKeep, hidden: (s: any) => !hostHas(s, 'openFiles'), run: ctx => ctx.set({ prefs: { openAsKeep: !ctx.state.prefs?.openAsKeep } }) },
    'file.dust': {
      label: 'Heal Dust on Open',
      checked: (s: any) => !!s.prefs?.dust,
      hidden: (s: any) => !hostHas(s, 'dust'),
      run: ctx => {
        const on = !ctx.state.prefs?.dust;
        ctx.set({ prefs: { dust: on } });
        return hostRun(ctx, 'dust', on);
      },
    },
    // Export…: the host's dialog (format, colour space), else output.save (the Output panel's Save)
    'file.export': { label: 'Export…', ...needFrame, run: ctx => (hostHas(ctx.state, 'exportPrint') ? hostRun(ctx, 'exportPrint') : ctx.run('output.save')) },
    'file.saveRecipe': { label: 'Save Recipe', ...needFrame, hidden: (s: any) => !hostHas(s, 'saveRecipe'), run: ctx => hostRun(ctx, 'saveRecipe') },
    'view.layout': {
      label: 'Layout…',
      hidden: (s: any) => !hostHas(s, 'setLayout') || !(s.ui?.host?.layouts?.length > 0),
      run: async (ctx, id?: string) => {
        if (typeof id === 'string') return hostRun(ctx, 'setLayout', id);
        const h = ctx.state.ui?.host;
        const pick = await studioOf(ctx).rt!.chrome.dialog({
          title: 'Layout of the studio',
          buttons: (h?.layouts ?? []).map((l: { id: string; label: string }) => ({ label: l.label, value: l.id, primary: l.id === h?.layout })),
        }).result;
        if (typeof pick === 'string' && pick !== h?.layout) return hostRun(ctx, 'setLayout', pick);
        return null;
      },
    },
    'frame.next': { label: 'Next Frame', run: ctx => step(ctx, 1) },
    'frame.previous': { label: 'Previous Frame', run: ctx => step(ctx, -1) },
    'view.mode': { label: 'Library View', palette: false, run: (ctx, mode: string) => ctx.set({ view: { mode } }) },
    'view.show': { label: 'Show View', palette: false, run: (ctx, v: ViewMode) => ctx.set({ view: { view: v } }) },
    'view.beforeAfter': {
      label: 'Before / After',
      ...needFrame,
      checked: (s: any) => s.view?.compare !== 'off',
      run: ctx => ctx.set({ view: { compare: ({ off: 'split', split: 'before', before: 'off' } as Record<string, string>)[ctx.state.view.compare] ?? 'off' } }),
    },
    'view.sideBySide': { label: 'Side by Side', ...needFrame, run: ctx => ctx.set({ view: { compare: ctx.state.view.compare === 'lr' ? 'off' : 'lr' } }) },
    'step.go': { label: 'Go to Step', palette: false, run: (ctx, id: string) => ctx.set({ view: { step: id } }) },
    'history.jump': {
      label: 'Jump in History',
      palette: false,
      run: (ctx, f: string, index: number) => studioOf(ctx).route.jump(f, index),
    },
    'proposal.show': {
      label: 'Show Proposal',
      palette: false,
      run: (ctx, tx: string | null) => ctx.set({ ui: { showProposal: ctx.state.ui.showProposal === tx ? null : tx } }),
    },
    'proposal.toggle': {
      label: 'Include Change',
      palette: false,
      run: (ctx, tx: string, seq: number) => {
        const off = ctx.state.ui.approvals?.[tx]?.off ?? [];
        ctx.set({ ui: { approvals: { [tx]: { off: off.includes(seq) ? off.filter((x: number) => x !== seq) : [...off, seq] } } } });
      },
    },
    'proposal.approve': {
      label: 'Approve Agent Change',
      palette: false,
      run: (ctx, f: string, tx: string, force = false) => approve(ctx, f, tx, !!force),
    },
    'proposal.reject': {
      label: 'Reject Agent Change',
      palette: false,
      run: (ctx, f: string, tx: string) => {
        const p = (sel.proposals(ctx.state, f)).find((x: any) => x.tx === tx);
        if (!p) return;
        studioOf(ctx).route.reject(f, p.seqs);
        ctx.set({ ui: { showProposal: ctx.state.ui.showProposal === tx ? null : ctx.state.ui.showProposal } });
      },
    },
    'proposal.approveAll': {
      label: 'Approve All Agent Changes',
      enabled: (s: any) => sel.proposals(s).length > 0,
      why: 'No pending agent changes on this frame',
      run: ctx => {
        const f = sel.current(ctx.state)!;
        for (const p of [...(sel.proposals(ctx.state, f))]) approve(ctx, f, p.tx, false);
      },
    },
    'snapshot.new': {
      label: 'New Snapshot',
      ...needFrame,
      run: (ctx, name?: string) => {
        const f = sel.current(ctx.state)!;
        const e = studioOf(ctx).frames.get(f);
        if (!e) return;
        const list = sel.snapshots(ctx.state, f);
        const snap = { id: `s${list.length + 1}`, name: name ?? `Snapshot ${list.length + 1}`, ts: ctx.rt.clock.now(), stateHash: e.log.stateHash, recipe: e.log.committed };
        ctx.tx(`Snapshot "${snap.name}"`, (t: any) => {
          t.$set(['snapshots', f], [...list, snap]);
        });
      },
    },
    'snapshot.restore': {
      label: 'Restore Snapshot',
      palette: false,
      run: (ctx, id: string) => {
        const f = sel.current(ctx.state)!;
        const snap = (sel.snapshots(ctx.state, f)).find((x: any) => x.id === id);
        const e = studioOf(ctx).frames.get(f);
        if (!snap || !e) return;
        const ms = diffRecipes(e.log.committed, snap.recipe);
        if (ms.length) studioOf(ctx).route.applyMutations(f, ms, `Restore "${snap.name}"`);
      },
    },
    'print.applyToSelection': {
      label: 'Apply Print Settings to Selection',
      enabled: (s: any) => sel.selection(s).length > 1,
      why: 'Select the frames to copy the settings to (and the source as primary)',
      run: ctx => {
        const src = recipeOf(ctx, sel.current(ctx.state)!);
        if (!src) return;
        ctx.tx('Apply Print Settings', (t: any) => {
          for (const id of sel.selection(ctx.state)) {
            if (id === sel.current(ctx.state) || !t.recipes[id]) continue;
            for (const p of PRINT_SETTINGS) t.$set(['recipes', id, ...p.split('.')], getPath(src, p));
          }
        });
      },
    },
    'probe.pin': {
      label: 'Pin Probe',
      enabled: (s: any) => !!sel.current(s) && !!s.ui?.probe,
      why: 'Hover the print with the probe tool first',
      run: ctx => {
        const f = sel.current(ctx.state)!;
        const [x, y] = ctx.state.ui.probe!;
        const n = Object.keys(recipeOf(ctx, f)?.probes ?? {}).length + 1;
        ctx.tx(`Pin probe ${n}`, (t: any) => {
          t.$set(['recipes', f, 'probes', `p${n}`], { x, y, r: 2 });
        });
      },
    },
    'ring.apply': {
      label: 'Use This Print',
      palette: false,
      run: (ctx, offset: Vec3, label = 'Ring-around') => {
        const f = sel.current(ctx.state)!;
        const r = recipeOf(ctx, f);
        if (!r) return;
        const l = r.print.lights.logH;
        ctx.tx(label, (t: any) => {
          t.$set(['recipes', f, 'print', 'lights', 'logH'], l.map((x, i) => Number((x + offset[i]!).toFixed(6))));
        });
        ctx.set({ ui: { tool: null } });
      },
    },
    'exposure.add': {
      label: 'Add Exposure',
      ...needFrame,
      run: (ctx, kind: 'dodge' | 'burn' | 'flash' = 'burn') => {
        const f = sel.current(ctx.state)!;
        const r = recipeOf(ctx, f)!;
        const id = nextExposureId(r, kind);
        studioOf(ctx).route.applyMutations(f, [{ op: 'exposure.add', exposure: { id, kind, stops: kind === 'flash' ? null : 0.5, ...(kind === 'flash' ? { time_s: 2 } : {}) } }], `Add ${kind} ${id}`);
      },
    },
    'exposure.remove': {
      label: 'Remove Exposure',
      palette: false,
      run: (ctx, id: string) => studioOf(ctx).route.applyMutations(sel.current(ctx.state)!, [{ op: 'exposure.remove', id }], `Remove exposure ${id}`),
    },
    'agent.mode': {
      label: 'Agent Mode',
      palette: false,
      run: (ctx, mode: 'read-only' | 'ask' | 'auto') => {
        studioOf(ctx).frames.setMode(mode);
        ctx.set({ prefs: { agentMode: mode } });
      },
    },
    'output.save': {
      label: 'Save the Print',
      // in menus as File ▸ Export… (file.export, CHB-027), which runs this where the host has no export dialog
      ...needFrame,
      run: ctx => {
        const save = ctx.services['save'] as ((f: string) => unknown) | undefined;
        if (save) return save(sel.current(ctx.state)!);
        ctx.toast('Export with colour management comes with CHB-011', { kind: 'info' });
        return null;
      },
    },
  };
  // the tools: gestures on the viewer
  const coreTools: ToolTable<CbState> = {
    'probe': {
      label: 'Densitometer',
      icon: 'eyedropper',
      key: 'I',
      cursor: 'crosshair',
      on: {
        hover: (e, ctx) => ctx.set({ ui: { probe: [Math.round(e.x), Math.round(e.y)] } }),
        down: (e, ctx) => {
          ctx.set({ ui: { probe: [Math.round(e.x), Math.round(e.y)] } });
          return false;
        },
      },
    },
    'test-strip': {
      label: 'Test Strip',
      icon: 'layers',
      key: 'T',
      cursor: 'pointer',
      image: (r, s: any) => (isImageHandle(r) && r.what === 'print' ? frameRef(r.frame, r.recipe).testStrip(s.ui?.toolOptions?.['test-strip']) : r),
      // the bands' edges and values over the print (click a band to use its value)
      overlay: (g: any, vp: any, s: any) => {
        const f = sel.current(s);
        const r = f ? s.recipes?.[f] : undefined;
        const [w, h] = vp.natural();
        if (!r || !w) return;
        const o = s.ui.toolOptions['test-strip'] as { vary: StripVary; step: number; count: number };
        const base = o.vary === 'time' ? r.print.enlarger.time_s : r.print.enlarger.filtration[o.vary.slice(-1) as 'c' | 'm' | 'y'];
        const vals = stripValues(o.vary, base, o.step, o.count);
        const doc = g.ownerDocument as Document;
        const el = (tag: string, a: Record<string, string | number>) => {
          const x = doc.createElementNS('http://www.w3.org/2000/svg', tag);
          for (const [k, v] of Object.entries(a)) x.setAttribute(k, String(v));
          return x;
        };
        vals.forEach((v, i) => {
          const [x0, y0] = vp.toScreen(i / vals.length, 0);
          const [x1, y1] = vp.toScreen((i + 1) / vals.length, 1);
          const band = el('g', { class: `cb-band${i === (vals.length - 1) / 2 ? ' is-current' : ''}`, 'data-value': v });
          band.append(el('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, class: 'cb-band-r' }));
          const t = el('text', { x: (x0 + x1) / 2, y: y1 - 8, 'text-anchor': 'middle', class: 'cb-band-t' });
          t.textContent = stripLabel(o.vary, v, r);
          band.append(t);
          g.append(band);
        });
        void h;
      },
      on: {
        down: (e, ctx) => {
          const f = sel.current(ctx.state);
          const r = f ? recipeOf(ctx, f) : undefined;
          if (!f || !r) return false;
          const o = ctx.state.ui.toolOptions['test-strip'] as { vary: StripVary; step: number; count: number };
          const base = o.vary === 'time' ? r.print.enlarger.time_s : r.print.enlarger.filtration[o.vary.slice(-1) as 'c' | 'm' | 'y'];
          const vals = stripValues(o.vary, base, o.step, o.count);
          const i = Math.max(0, Math.min(vals.length - 1, Math.floor(e.u * vals.length)));
          const m = stripMutation(o.vary, r, vals[i]!);
          if (m.op === 'set') ctx.tx('Test strip band', (tx: any) => tx.$set(['recipes', f, ...m.path.split('.')], m.value));
          ctx.set({ ui: { tool: null } });
          return false;
        },
      },
    },
    'ring-around': { label: 'Ring-around', icon: 'grid', key: 'R' },
    'mask-ellipse': {
      label: 'Burn Ellipse',
      key: 'M',
      cursor: 'crosshair',
      on: {
        down: (e, ctx) => ({ x0: e.x, y0: e.y }),
        drag: () => undefined,
        up: (e, ctx, g) => maskGesture(ctx, { kind: 'ellipse', cx: (g.x0 + e.x) / 2, cy: (g.y0 + e.y) / 2, rx: Math.max(2, Math.abs(e.x - g.x0) / 2), ry: Math.max(2, Math.abs(e.y - g.y0) / 2) }),
      },
    },
    'mask-gradient': {
      label: 'Burn Gradient',
      cursor: 'crosshair',
      on: {
        down: (e, ctx) => ({ x0: e.x, y0: e.y }),
        drag: () => undefined,
        up: (e, ctx, g) => maskGesture(ctx, { kind: 'gradient', from: [g.x0, g.y0], to: [e.x, e.y] }),
      },
    },
    'mask-brush': {
      label: 'Burn Brush',
      cursor: 'crosshair',
      on: {
        down: (e, ctx) => ({ points: [[e.x, e.y, e.pressure || 1]] }),
        drag: (e, ctx, g) => void g.points.push([e.x, e.y, e.pressure || 1]),
        up: (e, ctx, g) => maskGesture(ctx, { kind: 'stroke', points: g.points, radius: ctx.state.ui.toolOptions['mask-brush']?.radius ?? 6, hardness: 0.5, mode: 'add' }),
      },
    },
  };

  const core = ck
    .kit('cb.core')
    .version('1')
    .state('catalog', { init: CORE_STATE.catalog })
    .state('snapshots', { init: CORE_STATE.snapshots })
    .state('recipes', { init: {} as CbState['recipes'] })
    .route('recipes', {
      keyDepth: 1,
      checkPath: rest => {
        const path = rest.map(String).join('.');
        if (!path || argModel(path) || getPath(DUMMY, path) !== undefined) return null;
        const pr = argProblem(path);
        return { message: `no recipe path ${path}`, ...(pr?.code === 'CB-A101' && pr.fix ? { fix: pr.fix } : {}) };
      },
    })
    .state('proposals', { init: {} as CbState['proposals'] })
    .route('proposals', { keyDepth: 1, readonly: true })
    .state('view', { init: CORE_STATE.view, view: true })
    .state('ui', { init: CORE_STATE.ui, view: true })
    .state('prefs', { init: CORE_STATE.prefs, view: true })
    .keys({ 'Mod+O': 'file.open', 'Mod+E': 'file.export' })
    .forms(...CB_FORMS)
    .fragments(testStripFragment, padFragment)
    .passes(argsPass, handlesPass, kitsPass)
    .commands(coreCommands)
    .tools(coreTools)
    .docs(CORE_DOCS);

  function step(ctx: any, dir: number): void {
    const list = sel.library(ctx.state);
    if (!list.length) return;
    const i = list.findIndex(x => x.id === sel.current(ctx.state));
    const next = list[Math.max(0, Math.min(list.length - 1, (i < 0 ? 0 : i) + dir))]!;
    ctx.run('frame.select', next.id);
  }
  function approve(ctx: any, f: string, tx: string, force: boolean): unknown {
    const p = (sel.proposals(ctx.state, f)).find((x: any) => x.tx === tx);
    if (!p) return null;
    const off: number[] = ctx.state.ui.approvals?.[tx]?.off ?? [];
    const seqs = p.seqs.filter((s: number) => !off.includes(s));
    if (!seqs.length) return null;
    const res = studioOf(ctx).route.approve(f, seqs, force);
    if (Array.isArray(res)) {
      ctx.set({ ui: { approvals: { [tx]: { off, stale: res.map(d => ({ code: d.code, message: d.message })) } } } });
      ctx.rt.diagnostics.info('CB-H410', `Approval of ${tx} refused: ${res[0]?.code}`, { runtime: true, facts: res.map(d => d.message) });
      return res;
    }
    ctx.set({ ui: { approvals: { [tx]: { off: [], stale: [] } }, showProposal: ctx.state.ui.showProposal === tx ? null : ctx.state.ui.showProposal } });
    return res;
  }
  function maskGesture(ctx: any, shape: MaskDoc['shapes'][number]): void {
    const f = sel.current(ctx.state);
    const studio = studioOf(ctx);
    const e = f ? studio.frames.get(f) : undefined;
    if (!f || !e) return;
    const r = e.log.committed;
    const src = e.graph.intern('source.open', [], { source: r.source.sha256, encoding: r.source.decode.encoding }).node;
    const id = `m${Object.keys(r.masks).length + 1}`;
    const spec = maskSpec(e.graph, src.id, { shapes: [shape], feather: 8, invert: false });
    const ex = nextExposureId(r, 'burn');
    studio.route.applyMutations(f, [{ op: 'mask.set', id, mask: spec }, { op: 'exposure.add', exposure: { id: ex, kind: 'burn', stops: 0.5, mask: id } }], `Burn ${ex} through mask ${id}`);
  }

  // ── viewer ──
  interface ViewerOpts {
    id?: string;
    views?: ViewMode[] | boolean;
    compare?: boolean | { before?: (s: any) => ImageHandle | null };
    tools?: string[];
    overlays?: unknown[];
    hud?: NodeData;
    label?: (s: any) => string;
  }
  const withProposal = (h: ImageHandle | null, s: any): ImageHandle | null => {
    const tx = s.ui?.showProposal;
    if (!h || !tx) return h;
    const p = (s.proposals?.[h.frame] ?? []).find((x: any) => x.tx === tx);
    return p ? Object.freeze({ ...h, recipe: p.recipe, expr: `${h.expr} /* proposal ${tx} */` }) : h;
  };
  const withView = (h: ImageHandle | null, s: any): ImageHandle | null => {
    const v: ViewMode = s.view?.view ?? 'print';
    if (!h || v === 'print' || h.what !== 'print') return h;
    return frameRef(h.frame, h.recipe).view(v);
  };
  const viewer = (fn: (s: any) => ImageHandle | null, o: ViewerOpts = {}): any => {
    const id = o.id ?? 'main';
    const views = o.views === true ? [...VIEW_MODES] : o.views || null;
    const before = o.compare ? (typeof o.compare === 'object' && o.compare.before ? o.compare.before : (s: any) => sel.frame(s)?.initial().print() ?? null) : null;
    const vp = ck.viewport(
      (s: any) => {
        let h = fn(s);
        if (views) h = withView(h, s);
        return withProposal(h, s);
      },
      {
        id,
        ...(o.tools ? { tools: o.tools.filter(t => t !== 'ring-around') } : {}),
        ...(before ? { compare: true, before: (s: any) => (views ? withView(before(s), s) : before(s)) } : { compare: false }),
        overlays: o.overlays ?? [],
        label: o.label ?? ((s: any) => sel.name(s)),
        ...(o.hud ? { hud: o.hud } : {}),
      } as any,
    );
    const parts: any[] = [];
    if (views) parts.push(ck.ui.segmented({ options: views.map(v => ({ value: v, label: VIEW_LABELS[v] ?? v, ...(VIEW_TIPS[v] ? { tip: VIEW_TIPS[v] } : {}) })), bind: (s: any) => s.view.view, label: 'View', small: true } as any));
    parts.push(node('cb.ribbon', {}));
    const ring = o.tools?.includes('ring-around');
    const centre = ring ? ck.match((s: any) => (s.ui?.tool === 'ring-around' ? 'ring' : 'view'), { view: vp, ring: ring_({}) }, { of: ['view', 'ring'] }) : vp;
    return ck.column({ grow: 1, class: 'cb-viewer' }, ...parts, centre);
  };
  /** the ring-around (CHB-009's decision: ordinary print nodes with a lights offset, so the centre tile is the
   *  main view's node by hash-consing); click the print that looks best */
  const ring_ = (o: { step?: number; size?: number } = {}): any => {
    const tiles = ringTiles(o.step ?? 4);
    const tile = (t: (typeof tiles)[number]) =>
      ck.column(
        { class: `cb-ring-tile${t.id === 'current' ? ' is-current' : ''}` },
        ck.view.thumb({ image: (s: any) => sel.frame(s)?.ringTile(t.offset) ?? null, max: o.size ?? 200 } as any),
        t.id === 'current' ? ck.ui.button({ run: 'tool.none', text: 'Keep this one', small: true }) : ck.ui.button({ label: t.label, run: ['ring.apply', t.offset, `Ring-around ${t.label}`], small: true } as any),
      );
    const at = (r: number, c: number) => tiles.find(t => t.row === r && t.col === c);
    const colour = [0, 1, 2].flatMap(r => [0, 1, 2].map(c => at(r, c))).map(t => (t ? tile(t) : ck.spacer()));
    return ck.column(
      { class: 'cb-ring', grow: 1 },
      ck.text(`Ring-around, ${o.step ?? 4} pt: click the print that looks best`, { strong: true }),
      ck.grid({ cols: 3, class: 'cb-ring-grid' } as any, ...colour),
      ck.row({ class: 'cb-ring-density' }, ...tiles.filter(t => t.row === 3).map(tile)),
    );
  };

  // ── cells and library views ──
  const cellFrame = (o: { size?: 'large' | 'small'; badges?: boolean; print?: boolean } = {}) => (item: CatalogFrame) =>
    ck.column(
      { class: `cb-cell${o.size === 'large' ? ' is-large' : ''}` },
      ck.view.thumb({
        image: (s: any) => sel.frame(s, item.id)?.print() ?? null,
        // a frame not open in this session: the thumbnail saved with the library (F5)
        src: (s: any) => (sel.isOffline(s, item.id) ? (s.catalog.frames[item.id].thumb ?? null) : null),
        max: o.size === 'large' ? 320 : 160,
        badge: (s: any) => badgeOf(s, item.id),
      } as any),
      ck.text((s: any) => cellCaption(s.catalog?.frames?.[item.id] ?? item), { dim: true }),
    );
  const EMPTY = 'No photos yet: File ▸ Open Files… (Ctrl+O), or drop them here';
  const LIBRARY_KEYS = { Delete: 'frame.remove', Backspace: 'frame.remove' };
  const strip = (o: { vertical?: boolean; id?: string } = {}) =>
    (o.vertical ? ck.view.list : ck.view.filmstrip)((s: any) => sel.library(s), {
      id: o.id ?? (o.vertical ? 'strip-v' : 'strip'),
      ...(o.vertical ? { row: cellFrame() } : { cell: cellFrame() }),
      key: (x: CatalogFrame) => x.id,
      select: { bind: (s: any) => s.ui.selection, mode: 'multi' },
      context: FRAME_CONTEXT,
      keys: LIBRARY_KEYS,
      empty: EMPTY,
    } as any);
  const grid = (o: { cell?: any; id?: string; keys?: Record<string, unknown>; source?: (s: any) => CatalogFrame[]; size?: 'large' } = {}) =>
    ck.view.grid(o.source ?? ((s: any) => sel.library(s)), {
      id: o.id ?? 'grid',
      cell: o.cell ?? cellFrame(o.size ? { size: o.size } : {}),
      key: (x: CatalogFrame) => x.id,
      size: (s: any) => (o.size === 'large' ? 320 : s.view.thumbSize),
      select: { bind: (s: any) => s.ui.selection, mode: 'multi' },
      context: FRAME_CONTEXT,
      keys: { ...LIBRARY_KEYS, ...(o.keys ?? {}) },
      empty: EMPTY,
    } as any);
  const loupe = () => viewer(s => sel.frame(s)?.print() ?? null, { id: 'loupe' });
  const compareView = () =>
    ck.row(
      { grow: 1 },
      viewer(s => sel.frame(s)?.print() ?? null, { id: 'cmp-a' }),
      viewer(s => sel.frame(s, sel.selection(s).find(x => x !== sel.current(s)) ?? null)?.print() ?? null, { id: 'cmp-b', label: (s: any) => s.catalog?.frames?.[sel.selection(s).find(x => x !== sel.current(s)) ?? '']?.name ?? 'Select a second frame' }),
    );
  const survey = () => grid({ id: 'survey', source: (s: any) => sel.library(s).filter(x => sel.selection(s).includes(x.id)), size: 'large' });
  const libraryViews = () =>
    ck.match((s: any) => s.view.mode, { grid: grid(), loupe: loupe(), compare: compareView(), survey: survey() }, { of: ['grid', 'loupe', 'compare', 'survey'] });

  // ── controls ──
  const arg = (path: string, o: Record<string, unknown> = {}): any => node('cb.arg', { path, ...o });
  const controls = (which: 'darkroom' | 'all' | Arrangement, o: { id?: string; title?: string } = {}): any => {
    const a = which === 'darkroom' ? DARKROOM : which === 'all' ? allParameters(controlModels()) : which;
    const id = o.id ?? `controls-${typeof which === 'string' ? which : a.name.toLowerCase().replace(/\W+/g, '-')}`;
    const sections = a.groups.map(g =>
      ck.section({ title: g.title }, ...g.paths.map(p => arg(p, p === 'print.lights.logH' ? { widget: 'pad' } : {})), ...(g.note ? [ck.text((s: any) => { const r = sel.recipe(s); return r ? g.note!(r) : ''; }, { dim: true, wrap: true })] : [])),
    );
    return ck.panel.define(id, { title: o.title ?? a.name }, ifFrame(...sections));
  };
  /** a container: its children while a frame is selected, else an empty state (CHB-031 F19: no live sliders without a frame) */
  const ifFrame = (...args: any[]): any => {
    const props = isProps(args[0]) ? args.shift() : {};
    return ck.when((s: any) => !!sel.recipe(s), ck.column(props, ...args), ck.text(NO_FRAME, { dim: true, wrap: true }));
  };
  const panel = (form: string, id: string, title: string) => (o: Record<string, unknown> = {}) => {
    const { id: pid, title: t, ...rest } = o as { id?: string; title?: string };
    return ck.panel.define(pid ?? id, { title: t ?? title }, node(form, rest));
  };

  const cb = {
    core,
    ck,
    /** the typed selectors: every interaction lambda reads state through these (cb.sel.current(s), cb.sel.frame(s), …) */
    sel,
    studio: (name: string, opts: Record<string, unknown> = {}) =>
      ck
        .shell(name, opts as any)
        .state({}, {
          channelName: (id: string, s: any) => s.catalog?.frames?.[id]?.name,
          currentChannel: (s: any) => sel.current(s),
          keepUi: ['selection', 'toolOptions'],
          transient: ['vp'],
        } as any)
        .use(core),
    arg,
    viewer,
    /** library and print views (not panels): grid, strip, loupe, compare, survey, the ring-around, the Library module's centre */
    views: { grid, strip, loupe, compare: compareView, survey, ringAround: ring_, library: libraryViews },
    cell: { frame: cellFrame },
    /** the studio's panels: each defines a panel where it is placed (props: id, title, …) */
    panels: {
      /** the darkroom's tools as buttons (each is also a key: I, T, R, \\) */
      tools: (o: { id?: string; title?: string } = {}) =>
        ck.panel.define(
          o.id ?? 'tools',
          { title: o.title ?? 'Tools' },
          ck.row(
            { class: 'cb-tools' },
            ck.ui.button({ run: 'tool.probe', text: 'Densitometer', small: true }),
            ck.ui.button({ run: 'tool.test-strip', text: 'Test strip', small: true }),
            ck.ui.button({ run: 'tool.ring-around', text: 'Ring-around', small: true }),
            ck.ui.button({ run: 'view.beforeAfter', text: 'Before / after', small: true }),
          ),
        ),
      controls,
      history: panel('cb.history', 'history', 'History'),
      approvals: panel('cb.approvals', 'approvals', 'Agent proposals'),
      why: panel('cb.why', 'why', 'Why'),
      snapshots: panel('cb.snapshots', 'snapshots', 'Snapshots'),
      exposures: panel('cb.exposures', 'exposures', 'Exposures'),
      journal: panel('cb.journal', 'journal', 'Journal'),
      nodes: panel('cb.nodes', 'nodes', 'Nodes'),
      explain: panel('cb.explain', 'explain', 'Explain'),
      metadata: panel('cb.metadata', 'metadata', 'Metadata'),
      library: panel('cb.library', 'library', 'Library'),
      densitometer: panel('cb.densitometer', 'densitometer', 'Densitometer'),
      output: panel('cb.output', 'output', 'Save'),
      navigator: (o: { id?: string } = {}) => ck.panel.define(o.id ?? 'navigator', { title: 'Navigator' }, ck.view.thumb({ image: (s: any) => sel.frame(s)?.print() ?? null, max: 240 } as any), ck.text((s: any) => sel.name(s) || 'No frame', { dim: true })),
    },
    /** the children while a frame is selected, else "Select a photo to print it." (CHB-031 F19) */
    ifFrame,
    /** approvals without a panel frame (simple: inline under the print) */
    approvals: (o: Record<string, unknown> = {}) => node('cb.approvals', o),
    hud: { readout: () => node('cb.readout', {}) },
    bar: {
      /** the steps bar: (steps, { labels }) */
      steps: (steps: string[], props: { labels?: Record<string, string> } = {}) => node('cb.steps', { steps, labels: {}, ...props }),
      filter: () => node('cb.filter', {}),
    },
    keys: {
      cull: { P: 'frame.pick', X: 'frame.reject', U: 'frame.unflag', ...ck.digits(0, 5, 'frame.rate'), '6': ['frame.label', 'red'], '7': ['frame.label', 'yellow'], '8': ['frame.label', 'green'], '9': ['frame.label', 'blue'], ArrowRight: 'frame.next', ArrowLeft: 'frame.previous' } as Record<string, any>,
      libraryModes: { G: ['view.mode', 'grid'], E: ['view.mode', 'loupe'], C: ['view.mode', 'compare'], N: ['view.mode', 'survey'] } as Record<string, any>,
      views: { '1': ['view.show', 'print'], '2': ['view.show', 'negative'], '3': ['view.show', 'dyes'], '4': ['view.show', 'classes'] } as Record<string, any>,
      darkroom: { '\\': 'view.beforeAfter', Y: 'view.sideBySide', P: 'probe.pin', S: 'snapshot.new', ArrowRight: 'frame.next', ArrowLeft: 'frame.previous' } as Record<string, any>,
    },
    /** the studio's modules (the kits offer theirs: cb.kits.roll.modules.roll(), …) */
    modules: {
      /** Library (G): the navigator and the library left, filter and the library views centre, metadata right */
      library: (o: { id?: string } = {}) =>
        ck
          .module(o.id ?? 'library', { label: 'Library', key: 'G' })
          .left(ck.dock.column({ width: 236 }, cb.panels.navigator(), cb.panels.library()))
          .center(ck.column({ grow: 1 }, cb.bar.filter(), cb.views.library()))
          .right(ck.dock.column({ width: 260 }, cb.panels.metadata()))
          .bottom(ck.dock.column({ width: 124 }, cb.views.strip()))
          .keys({ ...cb.keys.cull, ...cb.keys.libraryModes }),
      /** Print (D): navigator, snapshots, history left; the print with views, compare and the darkroom tools centre;
       *  tools, densitometer, darkroom controls, exposures, approvals right (o.extraRight adds panels below) */
      print: (o: { id?: string; extraRight?: unknown[] } = {}) =>
        ck
          .module(o.id ?? 'print', { label: 'Print', key: 'D', txOpts: (s: any) => ({ channel: sel.current(s) }) })
          .left(ck.dock.column({ width: 236 }, cb.panels.navigator({ id: 'navigator-print' }), cb.panels.snapshots(), cb.panels.history()))
          .center(
            viewer((s: any) => sel.frame(s)?.print() ?? null, {
              id: 'main',
              views: true,
              compare: true,
              tools: ['probe', 'test-strip', 'ring-around', 'mask-ellipse', 'mask-gradient', 'mask-brush'],
              hud: cb.hud.readout(),
            }),
          )
          .right(ck.dock.column({ width: 300 }, cb.panels.tools(), cb.panels.densitometer(), cb.panels.controls('darkroom'), cb.panels.exposures(), cb.panels.approvals(), ...((o.extraRight ?? []) as any[])))
          .bottom(ck.dock.column({ width: 124 }, cb.views.strip({ id: 'strip-print' })))
          .keys({ ...cb.keys.views, ...cb.keys.darkroom }),
    },
    /** the studio's standard menus; the kits add theirs (cb.kits.roll.menus.roll(), …) */
    menus: {
      file: () =>
        ck.menu('File', [
          // the host's actions (CHB-027); hidden where the host has none (the dev host, tests)
          'file.open', 'file.openFolder', 'file.reopenFolder',
          { label: 'Open As', items: ['file.openAs.auto', 'file.openAs.photo', 'file.openAs.negative', 'file.openAs.keep', '-', 'file.dust'] },
          '-', 'file.export', 'file.saveRecipe', '-', 'app.palette',
        ]),
      edit: () => ck.menu('Edit', ['edit.undo', 'edit.redo', '-', 'proposal.approveAll']),
      frame: () =>
        ck.menu('Frame', [
          'frame.pick', 'frame.reject', 'frame.unflag', '-', 'frame.rotateLeft', 'frame.rotateRight', 'frame.flip', '-', 'frame.reopenAsPhoto', 'frame.reopenAsNegative', 'frame.remove',
          '-', 'frame.next', 'frame.previous', '-', 'snapshot.new', 'probe.pin', 'exposure.add', 'print.applyToSelection',
        ]),
      view: () => ck.menu('View', ['view.beforeAfter', 'view.sideBySide', '-', 'view.fit', 'view.actual', 'view.zoomIn', 'view.zoomOut', '-', 'view.layout', 'app.theme']),
      window: () => ck.menu('Window', ['view.hideSides', 'view.toggleLeft', 'view.toggleRight', 'view.toggleBottom', 'workspace.reset']),
      help: () => ck.menu('Help', ['app.shortcuts', 'app.diagnostics']),
      /** File, Edit, Frame, View, Window, Help */
      standard: () => [cb.menus.file(), cb.menus.edit(), cb.menus.frame(), cb.menus.view(), cb.menus.window(), cb.menus.help()],
    },
    ring: { tiles: ringTiles },
    arrangements: { DARKROOM },
    kits: {} as Record<string, any>,
  };
  // kits built on cb.core reach variants as cb.kits.<name> (CHB-020 roll; CHB-021 looks and CHB-022 finish later)
  cb.kits['roll'] = createRollKit(ck, cb as any);
  cb.kits['finish'] = createFinishKit(ck, cb as any);
  cb.kits['looks'] = createLooksKit(ck, cb as any);
  cb.kits['chat'] = createChatKit(ck, cb as any); // CHB-008: the assistant chat
  // the kits' fragment methods (cb.arg(…).pad(), .testStrip(), .rollScope()) on the nodes layouts build with this ck
  ck.extend(core, ...Object.values(cb.kits).map(k => k.kit));
  return cb;
}

export type Cb = ReturnType<typeof createCb>;

/** the empty state of the print controls (CHB-031 F19) */
export const NO_FRAME = 'Select a photo to print it.';

// the views in a photographer's words, the technical name second, in the tooltip (CHB-031 F9)
const VIEW_LABELS: Record<string, string> = { print: 'Print', negative: 'Negative', dyes: 'No mask', classes: 'Clipping' };
const VIEW_TIPS: Record<string, string> = {
  print: 'The print on paper',
  negative: 'The scan of the negative as it is',
  dyes: 'The negative without its orange mask: the colour the print is made from (the dyes view)',
  classes: 'Where the negative holds no picture (bare film base, prints black) or a colour the paper cannot reach (the base and gamut view)',
};

const badgeOf = (s: any, id: string): string => {
  const pending = s.proposals?.[id]?.length ?? 0;
  return [sel.isOffline(s, id) ? 'not open' : '', pending ? `agent ${pending}` : '', rollTag(s, id)].filter(Boolean).join(' · ');
};
const cellCaption = (f: CatalogFrame): string => `${f.flag === 'pick' ? '⚑ ' : f.flag === 'reject' ? '✕ ' : ''}${f.name}${f.stars ? ' ' + '★'.repeat(f.stars) : ''}`;

// a recipe with every optional part present, for checking binding paths under recipes.*
const DUMMY = defaultRecipe('negative-scan', { sha256: '0'.repeat(64), name: 'x' });

const CORE_DOCS = `## cb.core
Chromobench's studio vocabulary on the CraftKit shell. Recipes are a projection of each frame's EditLog
(recipes.<frame>); agent proposals are published under proposals.<frame> and shown, never applied, until approved.
One global undo (Mod+Z) walks shell transactions and EditLog units together; a step the History panel already
undid is skipped (CB-H401).`;
