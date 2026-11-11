// createCb(ck): the `cb` namespace (guide §4–5) bound to one ck instance. Everything here records nodes and
// definitions; nothing touches the DOM, an engine or storage. Services (the frames, the EditLog route, the render
// bridge) are reached at run time through ctx.services.studio.
//
//   cb.studio(name)       ck.shell(name).use(cb.core) with chromobench's state options
//   cb.core               the kit: state, routes, forms, fragments, commands, tools, keys, passes, docs
//   cb.arg / cb.nudge     controls from ArgSpec          cb.panel.*   history, approvals, why, snapshots, …
//   cb.frame / cb.viewer  handles and the viewer         cb.view.*    grid, strip, loupe, compare, survey, ring
//   cb.cell.frame         a θ cell: a print thumbnail (bg lane, cached by node id) + name, flag, stars

/* eslint-disable @typescript-eslint/no-explicit-any */
import { defaultRecipe, getPath, type FrameRecipe, type Vec3 } from '@chromobench/contract';
import { libraryRoot, type Ck, type NodeData } from '@chromobench/shell';
import { argModel, argProblem, parseStep, stepUnits, STRIPPABLE } from './kit/args.ts';
import { CB_FORMS } from './kit/forms.ts';
import { frameRef, isImageHandle, type FrameRef, type ImageHandle } from './handles.ts';
import { DARKROOM, allParameters, type Arrangement } from './model/arrangement.ts';
import { controlModels } from './kit/args.ts';
import { diffRecipes, PRINT_SETTINGS, VIEW_MODES, type ViewMode } from './model/recipes.ts';
import { ringTiles, stripMutation, stripValues, maskSpec, nextExposureId, type StripVary, type MaskDoc } from './model/tools.ts';
import type { Studio } from './studio.ts';

// variants' lines, not studio-kit's, are the call sites of their nodes
libraryRoot(new URL('.', import.meta.url).href);

export interface CatalogFrame {
  id: string;
  sha256: string;
  name: string;
  flag: 'pick' | 'reject' | null;
  stars: number;
  label: string | null;
  keywords: string[];
}
export interface CbState {
  catalog: { frames: Record<string, CatalogFrame>; order: string[] };
  snapshots: Record<string, { id: string; name: string; ts: number; stateHash: string; recipe: FrameRecipe }[]>;
  recipes: Record<string, FrameRecipe>;
  proposals: Record<string, any[]>;
  view: { module?: string; mode: string; view: ViewMode; compare: string; split: number; step: string; filter: { text: string; flag: string | null }; thumbSize: number; vp: Record<string, unknown> };
  ui: { selection: { ids: string[]; primary: string | null; anchor: string | null }; tool: string | null; toolOptions: Record<string, any>; focusPath: string | null; probe: [number, number] | null; showProposal: string | null; approvals: Record<string, { off?: number[]; stale?: { code: string; message: string }[] }> };
  prefs: { agentMode: 'read-only' | 'ask' | 'auto' };
  workspace: Record<string, unknown>;
}

export const CORE_STATE = {
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
export const current = (s: any): string | null => s?.ui?.selection?.primary ?? null;
const sel = (s: any): string[] => s?.ui?.selection?.ids ?? [];
const targets = (ctx: any): string[] => (sel(ctx.state).length ? sel(ctx.state) : [current(ctx.state)].filter((x): x is string => !!x));

/** the frames of the catalog in roll order, after the library filter */
export function visibleFrames(s: any): CatalogFrame[] {
  const c = s?.catalog;
  if (!c) return [];
  const f = s.view?.filter ?? {};
  const text = String(f.text ?? '').toLowerCase();
  return (c.order as string[])
    .map(id => c.frames[id])
    .filter((x: CatalogFrame | undefined): x is CatalogFrame => !!x)
    .filter(x => (!text || x.name.toLowerCase().includes(text) || x.keywords.some(k => k.toLowerCase().includes(text))) && (!f.flag || (f.flag === 'unflagged' ? !x.flag : x.flag === f.flag)));
}

export function createCb(ck: Ck) {
  const node = (form: string, props: Record<string, unknown> = {}, kids: unknown[] = []): any => ck.node(form, props, kids);

  // ── handles ──
  const frame = (s: any, id?: string | null): FrameRef | null => {
    const f = id ?? current(s);
    if (!f) return null;
    const r = s?.recipes?.[f];
    if (!r) return null;
    return frameRef(f, r, f === current(s) ? 'frame' : `frames['${f}']`);
  };

  // ── fragments ──
  const testStripFragment = ck.fragment('cb.arg', {
    when: n => STRIPPABLE.has(String(n.props['path'])),
    methods: {
      testStrip(this: any, opts: Record<string, unknown> = {}) {
        return this.prop('strip', { step: '1/3 st', ...opts });
      },
    },
    doc: 'A Strip button beside time or filtration that opens the test strip around this value (T)',
  });
  const padFragment = ck.fragment('cb.arg', {
    when: n => String(n.props['path']) === 'print.lights.logH',
    methods: {
      pad(this: any) {
        return this.prop('widget', 'pad');
      },
    },
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
  const handlesPass = ck.pass('cb.handles', { on: 'ui', after: 'normalize' }, (ir: any, p) => {
    for (const n of ir.find('viewport') as NodeData[]) {
      const views = n.props['views'];
      if (Array.isArray(views)) for (const v of views) if (!VIEW_MODES.includes(v)) p.error('CB-F201', `viewer '${n.props['id']}': unknown view '${v}'`, { at: n.at, facts: [`views: ${VIEW_MODES.join(', ')}`] });
    }
  });

  // ── tools (gestures on the viewer) ──
  const recipeOf = (ctx: any, f: string): FrameRecipe | undefined => ctx.state.recipes?.[f];
  const core = ck.kit<CbState>('cb.core', k => {
    k.version('1')
      .state('catalog', { init: CORE_STATE.catalog })
      .state('snapshots', { init: CORE_STATE.snapshots })
      .state('recipes', { init: {} })
      .route('recipes', {
        keyDepth: 1,
        checkPath: rest => {
          const path = rest.map(String).join('.');
          if (!path || argModel(path) || getPath(DUMMY, path) !== undefined) return null;
          const pr = argProblem(path);
          return { message: `no recipe path ${path}`, ...(pr?.code === 'CB-A101' && pr.fix ? { fix: pr.fix } : {}) };
        },
      })
      .state('proposals', { init: {} })
      .route('proposals', { keyDepth: 1, readonly: true })
      .state('view', { init: CORE_STATE.view, view: true })
      .state('ui', { init: CORE_STATE.ui, view: true })
      .state('prefs', { init: CORE_STATE.prefs, view: true })
      .forms(...CB_FORMS)
      .fragments(testStripFragment, padFragment)
      .passes(argsPass, handlesPass)
      .commands(c => {
        const needFrame = { enabled: (s: any) => !!current(s), why: 'Open a frame first' };
        const flag = (ctx: any, v: CatalogFrame['flag'], label: string) =>
          ctx.tx(label, (t: any) => {
            for (const id of targets(ctx)) if (t.catalog.frames[id]) t.catalog.frames[id].flag = v;
          });
        c.add('frame.pick', { label: 'Flag as Pick', menu: 'Frame', ...needFrame, run: ctx => flag(ctx, 'pick', 'Flag as Pick') })
          .add('frame.reject', { label: 'Reject', menu: 'Frame', ...needFrame, run: ctx => flag(ctx, 'reject', 'Reject') })
          .add('frame.unflag', { label: 'Unflag', menu: 'Frame', ...needFrame, run: ctx => flag(ctx, null, 'Unflag') })
          .add('frame.rate', {
            label: 'Set Stars',
            menu: 'Frame',
            palette: false,
            ...needFrame,
            run: (ctx, n: number) =>
              ctx.tx(`${n} Stars`, (t: any) => {
                for (const id of targets(ctx)) if (t.catalog.frames[id]) t.catalog.frames[id].stars = n;
              }),
          })
          .add('frame.label', {
            label: 'Set Colour Label',
            palette: false,
            ...needFrame,
            run: (ctx, colour: string | null) =>
              ctx.tx(`Label ${colour ?? 'none'}`, (t: any) => {
                const id = current(ctx.state)!;
                if (t.catalog.frames[id]) t.catalog.frames[id].label = t.catalog.frames[id].label === colour ? null : colour;
              }),
          })
          .add('frame.select', {
            label: 'Select Frame',
            palette: false,
            run: (ctx, id: string) => {
              studioOf(ctx).route.endBurst();
              ctx.set({ ui: { selection: { ids: [id], primary: id, anchor: id }, showProposal: null } });
            },
          })
          .add('frame.next', { label: 'Next Frame', menu: 'Frame', run: ctx => step(ctx, 1) })
          .add('frame.previous', { label: 'Previous Frame', menu: 'Frame', run: ctx => step(ctx, -1) })
          .add('view.mode', { label: 'Library View', palette: false, run: (ctx, mode: string) => ctx.set({ view: { mode } }) })
          .add('view.show', { label: 'Show View', palette: false, run: (ctx, v: ViewMode) => ctx.set({ view: { view: v } }) })
          .add('view.beforeAfter', {
            label: 'Before / After',
            menu: 'View',
            ...needFrame,
            checked: (s: any) => s.view?.compare !== 'off',
            run: ctx => ctx.set({ view: { compare: ({ off: 'split', split: 'before', before: 'off' } as Record<string, string>)[ctx.state.view.compare] ?? 'off' } }),
          })
          .add('view.sideBySide', { label: 'Side by Side', menu: 'View', ...needFrame, run: ctx => ctx.set({ view: { compare: ctx.state.view.compare === 'lr' ? 'off' : 'lr' } }) })
          .add('step.go', { label: 'Go to Step', palette: false, run: (ctx, id: string) => ctx.set({ view: { step: id } }) })
          .add('history.jump', {
            label: 'Jump in History',
            palette: false,
            run: (ctx, f: string, index: number) => studioOf(ctx).route.jump(f, index),
          })
          .add('proposal.show', {
            label: 'Show Proposal',
            palette: false,
            run: (ctx, tx: string | null) => ctx.set({ ui: { showProposal: ctx.state.ui.showProposal === tx ? null : tx } }),
          })
          .add('proposal.toggle', {
            label: 'Include Change',
            palette: false,
            run: (ctx, tx: string, seq: number) => {
              const off = ctx.state.ui.approvals?.[tx]?.off ?? [];
              ctx.set({ ui: { approvals: { [tx]: { off: off.includes(seq) ? off.filter((x: number) => x !== seq) : [...off, seq] } } } });
            },
          })
          .add('proposal.approve', {
            label: 'Approve Agent Change',
            palette: false,
            run: (ctx, f: string, tx: string, force = false) => approve(ctx, f, tx, !!force),
          })
          .add('proposal.reject', {
            label: 'Reject Agent Change',
            palette: false,
            run: (ctx, f: string, tx: string) => {
              const p = (ctx.state.proposals?.[f] ?? []).find((x: any) => x.tx === tx);
              if (!p) return;
              studioOf(ctx).route.reject(f, p.seqs);
              ctx.set({ ui: { showProposal: ctx.state.ui.showProposal === tx ? null : ctx.state.ui.showProposal } });
            },
          })
          .add('proposal.approveAll', {
            label: 'Approve All Agent Changes',
            menu: 'Edit',
            enabled: (s: any) => !!current(s) && (s.proposals?.[current(s)!]?.length ?? 0) > 0,
            why: 'No pending agent changes on this frame',
            run: ctx => {
              const f = current(ctx.state)!;
              for (const p of [...(ctx.state.proposals?.[f] ?? [])]) approve(ctx, f, p.tx, false);
            },
          })
          .add('snapshot.new', {
            label: 'New Snapshot',
            menu: 'Frame',
            ...needFrame,
            run: (ctx, name?: string) => {
              const f = current(ctx.state)!;
              const e = studioOf(ctx).frames.get(f);
              if (!e) return;
              const list = ctx.state.snapshots?.[f] ?? [];
              const snap = { id: `s${list.length + 1}`, name: name ?? `Snapshot ${list.length + 1}`, ts: ctx.rt.clock.now(), stateHash: e.log.stateHash, recipe: e.log.committed };
              ctx.tx(`Snapshot "${snap.name}"`, (t: any) => {
                t.$set(['snapshots', f], [...list, snap]);
              });
            },
          })
          .add('snapshot.restore', {
            label: 'Restore Snapshot',
            palette: false,
            run: (ctx, id: string) => {
              const f = current(ctx.state)!;
              const snap = (ctx.state.snapshots?.[f] ?? []).find((x: any) => x.id === id);
              const e = studioOf(ctx).frames.get(f);
              if (!snap || !e) return;
              const ms = diffRecipes(e.log.committed, snap.recipe);
              if (ms.length) studioOf(ctx).route.applyMutations(f, ms, `Restore "${snap.name}"`);
            },
          })
          .add('print.applyToSelection', {
            label: 'Apply Print Settings to Selection',
            menu: 'Frame',
            enabled: (s: any) => sel(s).length > 1,
            why: 'Select the frames to copy the settings to (and the source as primary)',
            run: ctx => {
              const src = recipeOf(ctx, current(ctx.state)!);
              if (!src) return;
              ctx.tx('Apply Print Settings', (t: any) => {
                for (const id of sel(ctx.state)) {
                  if (id === current(ctx.state) || !t.recipes[id]) continue;
                  for (const p of PRINT_SETTINGS) t.$set(['recipes', id, ...p.split('.')], getPath(src, p));
                }
              });
            },
          })
          .add('probe.pin', {
            label: 'Pin Probe',
            menu: 'Frame',
            enabled: (s: any) => !!current(s) && !!s.ui?.probe,
            why: 'Hover the print with the probe tool first',
            run: ctx => {
              const f = current(ctx.state)!;
              const [x, y] = ctx.state.ui.probe!;
              const n = Object.keys(recipeOf(ctx, f)?.probes ?? {}).length + 1;
              ctx.tx(`Pin probe ${n}`, (t: any) => {
                t.$set(['recipes', f, 'probes', `p${n}`], { x, y, r: 2 });
              });
            },
          })
          .add('ring.apply', {
            label: 'Use This Print',
            palette: false,
            run: (ctx, offset: Vec3, label = 'Ring-around') => {
              const f = current(ctx.state)!;
              const r = recipeOf(ctx, f);
              if (!r) return;
              const l = r.print.lights.logH;
              ctx.tx(label, (t: any) => {
                t.$set(['recipes', f, 'print', 'lights', 'logH'], l.map((x, i) => Number((x + offset[i]!).toFixed(6))));
              });
              ctx.set({ ui: { tool: null } });
            },
          })
          .add('exposure.add', {
            label: 'Add Exposure',
            menu: 'Frame',
            ...needFrame,
            run: (ctx, kind: 'dodge' | 'burn' | 'flash' = 'burn') => {
              const f = current(ctx.state)!;
              const r = recipeOf(ctx, f)!;
              const id = nextExposureId(r, kind);
              studioOf(ctx).route.applyMutations(f, [{ op: 'exposure.add', exposure: { id, kind, stops: kind === 'flash' ? null : 0.5, ...(kind === 'flash' ? { time_s: 2 } : {}) } }], `Add ${kind} ${id}`);
            },
          })
          .add('exposure.remove', {
            label: 'Remove Exposure',
            palette: false,
            run: (ctx, id: string) => studioOf(ctx).route.applyMutations(current(ctx.state)!, [{ op: 'exposure.remove', id }], `Remove exposure ${id}`),
          })
          .add('agent.mode', {
            label: 'Agent Mode',
            palette: false,
            run: (ctx, mode: 'read-only' | 'ask' | 'auto') => {
              studioOf(ctx).frames.setMode(mode);
              ctx.set({ prefs: { agentMode: mode } });
            },
          })
          .add('output.save', {
            label: 'Save the Print',
            menu: 'File',
            ...needFrame,
            run: ctx => {
              const save = ctx.services['save'] as ((f: string) => unknown) | undefined;
              if (save) return save(current(ctx.state)!);
              ctx.toast('Export with colour management comes with CHB-011', { kind: 'info' });
              return null;
            },
          });
      })
      .tools(t =>
        t
          .tool('probe', {
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
          })
          .tool('test-strip', {
            label: 'Test Strip',
            icon: 'layers',
            key: 'T',
            cursor: 'pointer',
            image: (r, s: any) => (isImageHandle(r) && r.what === 'print' ? frameRef(r.frame, r.recipe).testStrip(s.ui?.toolOptions?.['test-strip']) : r),
            on: {
              down: (e, ctx) => {
                const f = current(ctx.state);
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
          })
          .tool('ring-around', { label: 'Ring-around', icon: 'grid', key: 'R' })
          .tool('mask-ellipse', {
            label: 'Burn Ellipse',
            key: 'M',
            cursor: 'crosshair',
            on: {
              down: (e, ctx) => ({ x0: e.x, y0: e.y }),
              drag: () => undefined,
              up: (e, ctx, g) => maskGesture(ctx, { kind: 'ellipse', cx: (g.x0 + e.x) / 2, cy: (g.y0 + e.y) / 2, rx: Math.max(2, Math.abs(e.x - g.x0) / 2), ry: Math.max(2, Math.abs(e.y - g.y0) / 2) }),
            },
          })
          .tool('mask-gradient', {
            label: 'Burn Gradient',
            cursor: 'crosshair',
            on: {
              down: (e, ctx) => ({ x0: e.x, y0: e.y }),
              drag: () => undefined,
              up: (e, ctx, g) => maskGesture(ctx, { kind: 'gradient', from: [g.x0, g.y0], to: [e.x, e.y] }),
            },
          })
          .tool('mask-brush', {
            label: 'Burn Brush',
            cursor: 'crosshair',
            on: {
              down: (e, ctx) => ({ points: [[e.x, e.y, e.pressure || 1]] }),
              drag: (e, ctx, g) => void g.points.push([e.x, e.y, e.pressure || 1]),
              up: (e, ctx, g) => maskGesture(ctx, { kind: 'stroke', points: g.points, radius: ctx.state.ui.toolOptions['mask-brush']?.radius ?? 6, hardness: 0.5, mode: 'add' }),
            },
          }),
      )
      .docs(CORE_DOCS);
  });

  function step(ctx: any, dir: number): void {
    const list = visibleFrames(ctx.state);
    if (!list.length) return;
    const i = list.findIndex(x => x.id === current(ctx.state));
    const next = list[Math.max(0, Math.min(list.length - 1, (i < 0 ? 0 : i) + dir))]!;
    ctx.run('frame.select', next.id);
  }
  function approve(ctx: any, f: string, tx: string, force: boolean): unknown {
    const p = (ctx.state.proposals?.[f] ?? []).find((x: any) => x.tx === tx);
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
    const f = current(ctx.state);
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
    const before = o.compare ? (typeof o.compare === 'object' && o.compare.before ? o.compare.before : (s: any) => frame(s)?.initial().print() ?? null) : null;
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
        label: o.label ?? ((s: any) => s.catalog?.frames?.[current(s) ?? '']?.name ?? ''),
        ...(o.hud ? { hud: o.hud } : {}),
      } as any,
    );
    const parts: any[] = [];
    if (views) parts.push(ck.ui.segmented(views.map(v => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) })), { bind: (s: any) => s.view.view, label: 'View', small: true } as any));
    parts.push(node('cb.ribbon', {}));
    const ring = o.tools?.includes('ring-around');
    const centre = ring ? ck.match((s: any) => (s.ui?.tool === 'ring-around' ? 'ring' : 'view'), { view: vp, ring: ring_({}) }, { of: ['view', 'ring'] }) : vp;
    return ck.column({ grow: 1, class: 'cb-viewer' }, ...parts, centre);
  };
  const ring_ = (o: { step?: number; size?: number }): any => node('cb.ring', o);

  // ── cells and library views ──
  const cellFrame = (o: { size?: 'large' | 'small'; badges?: boolean; print?: boolean } = {}) => (item: CatalogFrame) =>
    ck.column(
      { class: `cb-cell${o.size === 'large' ? ' is-large' : ''}` },
      ck.view.thumb({ image: (s: any) => frame(s, item.id)?.print() ?? null, max: o.size === 'large' ? 320 : 160, badge: (s: any) => badgeOf(s, item.id) } as any),
      ck.text((s: any) => cellCaption(s.catalog?.frames?.[item.id] ?? item), { dim: true }),
    );
  const strip = (o: { vertical?: boolean; id?: string } = {}) =>
    (o.vertical ? ck.view.list : ck.view.filmstrip)((s: any) => visibleFrames(s), {
      id: o.id ?? (o.vertical ? 'strip-v' : 'strip'),
      ...(o.vertical ? { row: cellFrame() } : { cell: cellFrame() }),
      key: (x: CatalogFrame) => x.id,
      select: { bind: (s: any) => s.ui.selection, mode: 'multi' },
      empty: 'Open a negative (File ▸ Open, or drop a TIFF)',
    } as any);
  const grid = (o: { cell?: any; id?: string; keys?: Record<string, unknown>; source?: (s: any) => CatalogFrame[]; size?: 'large' } = {}) =>
    ck.view.grid(o.source ?? ((s: any) => visibleFrames(s)), {
      id: o.id ?? 'grid',
      cell: o.cell ?? cellFrame(o.size ? { size: o.size } : {}),
      key: (x: CatalogFrame) => x.id,
      size: (s: any) => (o.size === 'large' ? 320 : s.view.thumbSize),
      select: { bind: (s: any) => s.ui.selection, mode: 'multi' },
      ...(o.keys ? { keys: o.keys } : {}),
      empty: 'No frames yet: open a negative',
    } as any);
  const loupe = () => viewer(s => frame(s)?.print() ?? null, { id: 'loupe' });
  const compareView = () =>
    ck.row(
      { grow: 1 },
      viewer(s => frame(s)?.print() ?? null, { id: 'cmp-a' }),
      viewer(s => frame(s, sel(s).find(x => x !== current(s)) ?? null)?.print() ?? null, { id: 'cmp-b', label: (s: any) => s.catalog?.frames?.[sel(s).find(x => x !== current(s)) ?? '']?.name ?? 'Select a second frame' }),
    );
  const survey = () => grid({ id: 'survey', source: (s: any) => visibleFrames(s).filter(x => sel(s).includes(x.id)), size: 'large' });
  const libraryViews = () =>
    ck.match((s: any) => s.view.mode, { grid: grid(), loupe: loupe(), compare: compareView(), survey: survey() }, { of: ['grid', 'loupe', 'compare', 'survey'] });

  // ── controls ──
  const arg = (path: string, o: Record<string, unknown> = {}): any => node('cb.arg', { path, ...o });
  const controls = (which: 'darkroom' | 'all' | Arrangement, o: { id?: string; title?: string } = {}): any => {
    const a = which === 'darkroom' ? DARKROOM : which === 'all' ? allParameters(controlModels()) : which;
    const id = o.id ?? `controls-${typeof which === 'string' ? which : a.name.toLowerCase().replace(/\W+/g, '-')}`;
    return ck.panel(id, { title: o.title ?? a.name }, ...a.groups.map(g => ck.section(g.title, {}, ...g.paths.map(p => arg(p, p === 'print.lights.logH' ? { widget: 'pad' } : {})))));
  };
  const panel = (form: string, id: string, title: string) => (o: Record<string, unknown> = {}) => {
    const { id: pid, title: t, ...rest } = o as { id?: string; title?: string };
    return ck.panel(pid ?? id, { title: t ?? title }, node(form, rest));
  };

  const cb = {
    core,
    ck,
    current,
    frame,
    visible: visibleFrames,
    recipe: (s: any, f?: string): FrameRecipe | undefined => s?.recipes?.[f ?? current(s) ?? ''],
    studio: (name: string, opts: Record<string, unknown> = {}) =>
      ck
        .shell(name, opts as any)
        .state({}, {
          channelName: (id: string, s: any) => s.catalog?.frames?.[id]?.name,
          currentChannel: (s: any) => current(s),
          keepUi: ['selection', 'toolOptions'],
          transient: ['vp'],
        } as any)
        .use(core),
    arg,
    nudge: (path: string, o: Record<string, unknown> = {}): any => node('cb.arg', { path, widget: 'nudge', ...o }),
    viewer,
    view: { grid, strip, loupe, compare: compareView, survey, ringAround: ring_ },
    views: { library: libraryViews },
    cell: { frame: cellFrame },
    panel: {
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
      chat: panel('cb.chat', 'chat', 'Chat'),
      navigator: (o: { id?: string } = {}) => ck.panel(o.id ?? 'navigator', { title: 'Navigator' }, ck.view.thumb({ image: (s: any) => frame(s)?.print() ?? null, max: 240 } as any), ck.text((s: any) => s.catalog?.frames?.[current(s) ?? '']?.name ?? 'No frame', { dim: true })),
    },
    /** approvals without a panel frame (simple: inline under the print) */
    approvals: (o: Record<string, unknown> = {}) => node('cb.approvals', o),
    hud: { readout: () => node('cb.readout', {}) },
    bar: {
      steps: (steps: string[], labels: Record<string, string> = {}) => node('cb.steps', { steps, labels }),
      filter: () => node('cb.filter', {}),
    },
    keys: {
      cull: { P: 'frame.pick', X: 'frame.reject', U: 'frame.unflag', ...ck.digits(0, 5, 'frame.rate'), '6': ['frame.label', 'red'], '7': ['frame.label', 'yellow'], '8': ['frame.label', 'green'], '9': ['frame.label', 'blue'], ArrowRight: 'frame.next', ArrowLeft: 'frame.previous' } as Record<string, any>,
      libraryModes: { G: ['view.mode', 'grid'], E: ['view.mode', 'loupe'], C: ['view.mode', 'compare'], N: ['view.mode', 'survey'] } as Record<string, any>,
      views: { '1': ['view.show', 'print'], '2': ['view.show', 'negative'], '3': ['view.show', 'dyes'], '4': ['view.show', 'classes'] } as Record<string, any>,
      darkroom: { '\\': 'view.beforeAfter', Y: 'view.sideBySide', P: 'probe.pin', S: 'snapshot.new', ArrowRight: 'frame.next', ArrowLeft: 'frame.previous' } as Record<string, any>,
    },
    ring: { tiles: ringTiles },
    arrangements: { DARKROOM },
    kits: {} as Record<string, unknown>,
  };
  return cb;
}

export type Cb = ReturnType<typeof createCb>;

const badgeOf = (s: any, id: string): string => {
  const pending = s.proposals?.[id]?.length ?? 0;
  return pending ? `agent ${pending}` : '';
};
const cellCaption = (f: CatalogFrame): string => `${f.flag === 'pick' ? '⚑ ' : f.flag === 'reject' ? '✕ ' : ''}${f.name}${f.stars ? ' ' + '★'.repeat(f.stars) : ''}`;

// a recipe with every optional part present, for checking binding paths under recipes.*
const DUMMY = defaultRecipe('negative-scan', { sha256: '0'.repeat(64), name: 'x' });

const CORE_DOCS = `## cb.core
Chromobench's studio vocabulary on the CraftKit shell. Recipes are a projection of each frame's EditLog
(recipes.<frame>); agent proposals are published under proposals.<frame> and shown, never applied, until approved.
One global undo (Mod+Z) walks shell transactions and EditLog units together; a step the History panel already
undid is skipped (CB-H401).`;
