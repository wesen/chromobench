// createCb(ck): the `cb` namespace (guide §4–5) bound to one ck instance. Everything here records nodes and
// definitions; nothing touches the DOM, an engine or storage. Services (the frames, the render bridge, the log's
// host side) are reached at run time through ctx.services.studio. A frame's edit is its document at docs.<frame>
// (cb.core's mount; the store's log holds it under the contract's LOG_RULES).
//
//   cb.studio(name)       ck.shell(name).use(cb.core) with chromobench's state options
//   cb.core               the kit: state, the docs mount, forms, fragments, commands, tools, keys, passes, docs
//   cb.sel.*              the typed selectors (current, frame, doc, visible, …): every read of state
//   cb.arg / cb.viewer    a control from ArgSpec; the viewer      cb.panels.*   history, approvals, why, snapshots, …
//   cb.modules.*          library, print                          cb.views.*    grid, strip, loupe, compare, survey, ring
//   cb.menus.*            file … help, standard()                 cb.keys.*     cull, libraryModes, views, darkroom
//   cb.kits.*             roll, finish, looks, chat, stack, diagnostics: each { kit, panels, views, modules, menus, keys, sel, lib, … }
//   cb.cell.frame         a θ cell: a print thumbnail (bg lane, cached by node id) + name, flag, stars

/* eslint-disable @typescript-eslint/no-explicit-any */
import { getIn, isProps, libraryRoot, type Ck, type NodeData } from '@chromobench/shell';
import { argModel, argProblem, controlModels, parseStep, stepUnits, STRIPPABLE } from './kit/args.ts';
import { CB_FORMS } from './kit/forms.ts';
import { frameRef, type ImageHandle } from './handles.ts';
import { DARKROOM, allParameters, type Arrangement } from './model/arrangement.ts';
import { DOCS, defaultDocument, GRADE_PATH, LIGHTS_PATH } from './model/doc.ts';
import { NEUTRALISE } from './model/aim.ts';
import { VIEW_MODES, type ViewMode } from './model/settings.ts';
import { ringTiles } from './model/tools.ts';
import { sel, type CatalogFrame, type CbState } from './sel.ts';
import { frameCommands } from './commands/frame.ts';
import { hostCommands } from './commands/host.ts';
import { viewCommands } from './commands/view.ts';
import { printCommands } from './commands/print.ts';
import { agentCommands } from './commands/agent.ts';
import { outputCommands } from './commands/output.ts';
import { coreTools } from './commands/tools.ts';
import { sceneCommands, sceneTools } from './commands/scene.ts';
import { mediaCommands } from './commands/media.ts';
import { NEGATIVE_WB_NOTE, TEMPERATURE_PATH, TINT_PATH, WB_NOTE, whiteBalanceIn } from './model/white-balance.ts';
import { createRollKit, rollTag } from '../kits/roll/src/kit.ts';
import { createFinishKit } from '../kits/finish/src/kit.ts';
import { createLooksKit } from '../kits/looks/src/kit.ts';
import { createChatKit } from '../kits/chat/src/kit.ts';
import { createStackKit } from '../kits/stack/src/kit.ts';
import { createDiagnosticsKit } from '../kits/diagnostics/src/kit.ts';
import { createSelectKit } from '../kits/select/src/kit.ts';
import { SELECT_TOOLS } from '../kits/select/src/commands.ts';
import { MASK_TOOLS } from '../kits/stack/src/commands.ts';
import { maskCover } from '../kits/stack/src/overlay.ts';

// layouts' lines, not studio-kit's, are the call sites of their nodes
libraryRoot(new URL('.', import.meta.url).href);

/** cb.core's state slices, typed by CbState (the kits declare theirs: ROLL_STATE, FINISH_STATE, LOOKS_STATE) */
/** what Neutralise means, in his words (D8) */
const NEUTRALISE_TIP = 'How much of each frame’s colour cast a first print takes out: 100 % prints it to neutral grey, 75 % keeps a quarter of a sunset’s warmth.';

export const CORE_STATE: Pick<CbState, 'catalog' | 'ratings' | 'snapshots' | 'view' | 'ui' | 'prefs'> = {
  catalog: { frames: {}, order: [] },
  ratings: {},
  snapshots: {},
  view: { mode: 'grid', view: 'print', compare: 'off', split: 0.5, step: 'pick', filter: { text: '', flag: null }, thumbSize: 150, vp: {} },
  ui: {
    selection: { ids: [], primary: null, anchor: null },
    tool: null,
    toolOptions: { 'test-strip': { vary: 'time', step: 1 / 3, count: 5 }, 'ring-around': { step: 4 } },
    focusPath: null,
    probe: null,
    showProposal: null,
    approvals: {},
  },
  prefs: { agentMode: 'ask', neutralise: NEUTRALISE * 100 },
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
    when: n => String(n.props['path']) === LIGHTS_PATH,
    methods: { pad: () => ({ widget: 'pad' }) },
    doc: 'Printer lights as a colour pad plus a density slider, in points',
  });

  // ── passes ──
  const argsPass = ck.pass('cb.args', { on: 'ui', after: 'slots' }, (ir: any, p) => {
    for (const n of ir.find('cb.arg') as NodeData[]) {
      const path = String(n.props['path'] ?? '');
      const pr = argProblem(path);
      if (pr?.code === 'CB-A101') {
        p.error('CB-A101', pr.message, { at: n.at, ...(pr.fix ? { fix: pr.fix } : {}), facts: [`did you mean ${pr.fix ? pr.fix.slice(8, -2) : '…'}?`, `${pr.valid.length} document paths have controls`] });
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
      if (w === 'pad' && a.model.type !== 'vec3') p.error('CB-A120', `cb.arg('${path}'): the pad widget edits printer lights (vec3), not ${a.model.type}`, { at: n.at, fix: `cb.arg('${LIGHTS_PATH}').pad()` });
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
    // the ratings are the document tier (one undo step each); the library's membership is the view tier
    .state('ratings', { init: CORE_STATE.ratings })
    // a frame's document: docs.<frame> is the frame's document in the log (the Studio opens it); a binding under
    // it names the document's tree (stages.darkroom.stack.items.main.params.time_s)
    .mount(DOCS, {
      keyDepth: 1,
      kind: 'frame',
      checkPath: rest => {
        if (!rest.length || DUMMIES.some(d => getIn(d, rest) !== undefined)) return null;
        return { message: `no document path ${rest.map(String).join('.')}` };
      },
    })
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
    .commands(outputCommands())
    .commands(sceneCommands())
    .commands(mediaCommands())
    .tools(coreTools())
    .tools(sceneTools())
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
    /** the mask overlay over the print (CHB-039; default on): the selected entry's mask as a tint or alone */
    cover?: boolean;
  }
  const withProposal = (h: ImageHandle | null, s: any): ImageHandle | null => {
    const tx = s.ui?.showProposal;
    if (!h || !tx) return h;
    const p = sel.proposals(s, h.frame).find(x => x.tx === tx);
    return p?.doc ? Object.freeze({ ...h, doc: p.doc, expr: `${h.expr} /* proposal ${tx} */` }) : h;
  };
  const withView = (h: ImageHandle | null, s: any): ImageHandle | null => {
    const v: ViewMode = s.view?.view ?? 'print';
    if (!h || v === 'print' || h.what !== 'print') return h;
    return frameRef(h.frame, h.doc).view(v);
  };
  const viewer = (fn: (s: any) => ImageHandle | null, o: ViewerOpts = {}): any => {
    const id = o.id ?? 'main';
    const views = o.views === true ? [...VIEW_MODES] : o.views || null;
    const before = o.compare ? (typeof o.compare === 'object' && o.compare.before ? o.compare.before : (s: any) => sel.frame(s)?.initial().print() ?? null) : null;
    const shown = (s: any): ImageHandle | null => {
      let h = fn(s);
      if (views) h = withView(h, s);
      return withProposal(h, s);
    };
    const vp = ck.viewport(
      shown,
      {
        id,
        ...(o.cover === false ? {} : { cover: (s: any) => maskCover(s, shown(s)) }),
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
        image: (s: any) => sel.committed(s, item.id)?.print() ?? null,
        // a frame not open in this session: the thumbnail saved with the library (F5)
        src: (s: any) => (sel.isOffline(s, item.id) ? (s.catalog.frames[item.id].thumb ?? null) : null),
        max: o.size === 'large' ? 320 : 160,
        badge: (s: any) => badgeOf(s, item.id),
      } as any),
      ck.text((s: any) => cellCaption(sel.entry(s, item.id) ?? item), { dim: true }),
    );
  const EMPTY = 'No photos yet: File ▸ Open Files… (Ctrl+O), or drop them here';
  const LIBRARY_KEYS = { Delete: 'frame.remove', Backspace: 'frame.remove' };
  const strip = (o: { vertical?: boolean; id?: string } = {}) =>
    (o.vertical ? ck.view.list : ck.view.filmstrip)((s: any) => sel.library(s), {
      id: o.id ?? (o.vertical ? 'strip-v' : 'strip'),
      // a vertical strip's rows hold a thumbnail and its caption (the list's 24 px default left the picture 2 px tall:
      // only names showed, CHB-037 P9-4)
      ...(o.vertical ? { row: cellFrame(), rowHeight: 150 } : { cell: cellFrame() }),
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
  /**
   * The white balance before the film (CHB-048, D2): the preset (As shot, Lightroom's, None, or Custom), Temperature and
   * Tint in Lightroom's units, Pick a neutral (the eyedropper: W), what it does. A negative says why it has none.
   */
  const whiteBalanceView = (): any =>
    ck.when(
      (s: any) => !!whiteBalanceIn(sel.doc(s)),
      ck.column(
        { class: 'cb-wb' },
        node('cb.preset', { kind: 'white-balance' }),
        arg(TEMPERATURE_PATH),
        arg(TINT_PATH),
        ck.ui.button({ run: 'tool.white-balance', text: 'Pick a neutral', small: true, tip: 'Click something grey or white in the picture: its colour becomes neutral (W)' } as any),
        ck.text(WB_NOTE, { dim: true, wrap: true }),
      ),
      ck.text(NEGATIVE_WB_NOTE, { dim: true, wrap: true }),
    );
  const controls = (which: 'darkroom' | 'all' | Arrangement, o: { id?: string; title?: string } = {}): any => {
    const a = which === 'darkroom' ? DARKROOM : which === 'all' ? allParameters(controlModels()) : which;
    const id = o.id ?? `controls-${typeof which === 'string' ? which : a.name.toLowerCase().replace(/\W+/g, '-')}`;
    // the paper's grade is a preset picker (named grades, CHB-048); the stock selects are pickers in cb.arg itself
    const control = (p: string): any => (p === GRADE_PATH ? node('cb.preset', { kind: 'grade' }) : arg(p, p === LIGHTS_PATH ? { widget: 'pad' } : {}));
    const sections = a.groups.map(g =>
      ck.section({ title: g.title }, ...g.paths.map(control), ...(g.note ? [ck.text((s: any) => { const d = sel.doc(s); return d ? g.note!(d) : ''; }, { dim: true, wrap: true })] : [])),
    );
    return ck.panel.define(id, { title: o.title ?? a.name }, ifFrame(...sections));
  };
  /** a container: its children while a frame is selected, else an empty state (CHB-031 F19: no live sliders without a frame) */
  const ifFrame = (...args: any[]): any => {
    const props = isProps(args[0]) ? args.shift() : {};
    return ck.when((s: any) => !!sel.doc(s), ck.column(props, ...args), ck.text(NO_FRAME, { dim: true, wrap: true }));
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
        .shell(name, (({ state: _s, ...o }) => o)(opts) as any)
        .state({}, {
          // the library is the view tier (opening a file is not an edit); the frames' documents are saved by the
          // Studio with their history, so the workspace save leaves them out
          view: ['ui', 'view', 'prefs', 'workspace', 'catalog'],
          persist: (d: any) => {
            const { [DOCS]: _docs, ...rest } = d ?? {};
            return rest;
          },
          docName: (id: string, s: any) => s.catalog?.frames?.[id]?.name,
          currentDoc: (s: any) => sel.current(s),
          keepUi: ['selection', 'toolOptions'],
          transient: ['vp'],
          ...opts['state'] as object,
        } as any)
        .use(core)
        // every studio has the stack kit: the darkroom's exposures are its view of the darkroom stage
        .use(cb.kits['stack'].kit)
        // and the diagnostics kit: Help ▸ Report a Problem… wherever he is (CHB-038)
        .use(cb.kits['diagnostics'].kit)
        // and the select kit: selections are masks (CHB-049, D3)
        .use(cb.kits['select'].kit),
    arg,
    /** a preset picker in his words (CHB-048): 'white-balance', 'film', 'paper' or 'grade' */
    preset: (kind: string, o: Record<string, unknown> = {}): any => node('cb.preset', { kind, ...o }),
    viewer,
    /** library and print views (not panels): grid, strip, loupe, compare, survey, the ring-around, the Library module's centre */
    views: { grid, strip, loupe, compare: compareView, survey, ringAround: ring_, library: libraryViews, whiteBalance: whiteBalanceView },
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
      /** the white balance before the film (CHB-048): Classic's Print and Scene modules; a negative says why it has none */
      whiteBalance: (o: { id?: string; title?: string } = {}) => ck.panel.define(o.id ?? 'white-balance', { title: o.title ?? 'White balance (before the film)' }, ifFrame(whiteBalanceView())),
      history: panel('cb.history', 'history', 'History'),
      approvals: panel('cb.approvals', 'approvals', 'Agent proposals'),
      why: panel('cb.why', 'why', 'Why'),
      snapshots: panel('cb.snapshots', 'snapshots', 'Snapshots'),
      journal: panel('cb.journal', 'journal', 'Journal'),
      nodes: panel('cb.nodes', 'nodes', 'Nodes'),
      explain: panel('cb.explain', 'explain', 'Explain'),
      metadata: panel('cb.metadata', 'metadata', 'Metadata'),
      library: panel('cb.library', 'library', 'Library'),
      densitometer: panel('cb.densitometer', 'densitometer', 'Densitometer'),
      output: panel('cb.output', 'output', 'Export'),
      /**
       * D8 (CHB-046): the first print's colour aim as an amount he can change, "Neutralise" (prefs.neutralise, 75 % by
       * default: a quarter of each frame's cast stays), used by the studio's first print and the Roll module's; "First
       * print again" prints the current frame anew with it (where the host can).
       */
      firstPrint: (o: { id?: string } = {}) =>
        ck.panel.define(
          o.id ?? 'first-print',
          { title: 'First print' },
          ck.ui.slider({ min: 0, max: 100, step: 5, bind: (s: any) => s.prefs.neutralise, label: 'Neutralise', unit: '%', decimals: 0, reset: NEUTRALISE * 100, tip: NEUTRALISE_TIP } as any),
          ck.text(NEUTRALISE_TIP, { dim: true, wrap: true }),
          ck.ui.button({ run: 'print.firstPrint', text: 'First print again', small: true } as any),
        ),
      navigator: (o: { id?: string } = {}) => ck.panel.define(o.id ?? 'navigator', { title: 'Navigator' }, ck.view.thumb({ image: (s: any) => sel.committed(s)?.print() ?? null, max: 240 } as any), ck.text((s: any) => sel.name(s) || 'No frame', { dim: true })),
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
          .module(o.id ?? 'print', { label: 'Print', key: 'D', stages: ['darkroom'] })
          .left(ck.dock.column({ width: 236 }, cb.panels.navigator({ id: 'navigator-print' }), cb.panels.snapshots(), cb.panels.history()))
          .center(
            viewer((s: any) => sel.frame(s)?.print() ?? null, {
              id: 'main',
              views: true,
              compare: true,
              tools: ['probe', 'test-strip', 'ring-around', 'white-balance', ...MASK_TOOLS, ...SELECT_TOOLS],
              hud: cb.hud.readout(),
            }),
          )
          // CHB-048: the white balance first after the tools, where a Lightroom user looks for it (Develop's Basic panel)
          .right(ck.dock.column({ width: 300 }, cb.panels.tools(), cb.panels.whiteBalance(), cb.panels.densitometer(), cb.panels.controls('darkroom'), cb.panels.firstPrint(), cb.kits['stack'].panels.exposures(), cb.kits['stack'].panels.params({ id: 'layer-params-print' }), cb.kits['stack'].panels.masks({ id: 'layer-masks-print' }), cb.panels.approvals(), ...((o.extraRight ?? []) as any[])))
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
          '-', 'file.export', 'file.saveDocument', '-', 'diagnostics.openReport', '-', 'app.palette',
        ]),
      edit: () => ck.menu('Edit', ['edit.undo', 'edit.redo', '-', 'proposal.approveAll']),
      frame: () =>
        ck.menu('Frame', [
          'frame.pick', 'frame.reject', 'frame.unflag', '-', 'frame.rotateLeft', 'frame.rotateRight', 'frame.flip', '-', 'frame.reopenAsPhoto', 'frame.reopenAsNegative', 'frame.remove',
          '-', 'frame.next', 'frame.previous', '-', 'snapshot.new', 'probe.pin', 'print.applyToSelection',
        ]),
      view: () => ck.menu('View', ['view.beforeAfter', 'view.sideBySide', '-', 'view.fit', 'view.actual', 'view.zoomIn', 'view.zoomOut', '-', 'view.layout', 'app.theme']),
      window: () => ck.menu('Window', ['view.hideSides', 'view.toggleLeft', 'view.toggleRight', 'view.toggleBottom', 'workspace.reset']),
      help: () => ck.menu('Help', ['app.shortcuts', '-', ...cb.kits['diagnostics'].menus.help(), '-', 'app.diagnostics']),
      /** the stack kit's Layer menu (add from the catalogue, duplicate, delete, group, order, masks) */
      layer: () => cb.kits['stack'].menus.layer(),
      /** the select kit's Select menu (CHB-049) */
      select: () => cb.kits['select'].menus.select(),
      /** File, Edit, Frame, Layer, Select, View, Window, Help */
      standard: () => [cb.menus.file(), cb.menus.edit(), cb.menus.frame(), cb.menus.layer(), cb.menus.select(), cb.menus.view(), cb.menus.window(), cb.menus.help()],
    },
    ring: { tiles: ringTiles },
    arrangements: { DARKROOM },
    kits: {} as Record<string, any>,
  };
  // kits built on cb.core reach layouts as cb.kits.<name> (CHB-020 roll; CHB-021 looks and CHB-022 finish later)
  cb.kits['roll'] = createRollKit(ck, cb as any);
  cb.kits['finish'] = createFinishKit(ck, cb as any);
  cb.kits['looks'] = createLooksKit(ck, cb as any);
  cb.kits['chat'] = createChatKit(ck, cb as any); // CHB-008: the assistant chat
  // CHB-035 §33: one stack kit for every stage (layers, params, masks; the darkroom's exposures and enlarger views)
  cb.kits['stack'] = createStackKit(ck, cb as any);
  // CHB-038: the diagnostics journal's panel and problem reports (every studio installs it)
  cb.kits['diagnostics'] = createDiagnosticsKit(ck, cb as any);
  // CHB-049: selections as mask components (D3)
  cb.kits['select'] = createSelectKit(ck, cb as any);
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
  const pending = sel.proposals(s, id).length;
  return [sel.isOffline(s, id) ? 'not open' : '', pending ? `agent ${pending}` : '', rollTag(s, id)].filter(Boolean).join(' · ');
};
const cellCaption = (f: CatalogFrame): string => `${f.flag === 'pick' ? '⚑ ' : f.flag === 'reject' ? '✕ ' : ''}${f.name}${f.stars ? ' ' + '★'.repeat(f.stars) : ''}`;

// a document of each kind, for checking binding paths under docs.*
const DUMMIES = [
  defaultDocument('negative-scan', { sha256: '0'.repeat(64), width: 3000, height: 2000 }),
  defaultDocument('digital-raw', { sha256: '0'.repeat(64), width: 3000, height: 2000 }),
];

const CORE_DOCS = `## cb.core
Chromobench's studio vocabulary on the CraftKit shell. A frame's edit is its document (format 3) at docs.<frame>,
a document of the store's log under the contract's rules; controls address it by document paths (main.params.time_s,
lights.params.logH, stages.darkroom.medium.paper). Agent proposals are pending entries of the log, shown (never
applied) until approved. One undo (Mod+Z) walks the log's steps, whichever frame they changed.`;
