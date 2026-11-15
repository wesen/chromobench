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
import { frameCommands } from './commands/frame.ts';
import { hostCommands } from './commands/host.ts';
import { viewCommands } from './commands/view.ts';
import { printCommands } from './commands/print.ts';
import { agentCommands } from './commands/agent.ts';
import { coreTools } from './commands/tools.ts';
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
    // one declarative command table per area (CHB-029 item 3)
    .commands(frameCommands())
    .commands(hostCommands())
    .commands(viewCommands())
    .commands(printCommands())
    .commands(agentCommands())
    .tools(coreTools())
    .docs(CORE_DOCS);

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
