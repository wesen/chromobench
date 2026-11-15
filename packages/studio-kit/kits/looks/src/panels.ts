// cb.kits.looks: the builder calls (split from kit.ts, CHB-032): the panels and their models, the library and the
// survey grids, a look's cell and a one-row choice. Each form node carries its model, so the renderers stay dumb.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FrameRecipe } from '@chromobench/contract';
import type { Ck } from '@chromobench/shell';
import type { Cb } from '../../../src/cb.ts';
import { sel } from '../../../src/sel.ts';
import type { Studio } from '../../../src/studio.ts';
import { type Look, type Preset } from './engine/look.ts';
import { planFrame } from './engine/plan.ts';
import { type CompareSource, looksView, agentBatches } from './state.ts';
import type { LooksModel } from './model.ts';

export function createLooksPanels(ck: Ck, cb: Cb, M: LooksModel) {
  const { looksOf, ringLooks, lookById, paramsOf, optsOf, tile, caption, diffAgainst, selection, rollFrameIds, pickedLook, syncGroupsOf } = M;
  const node = (form: string, props: Record<string, unknown> = {}): any => ck.node(form, props, []);

  // ── builder calls ──
  // each form node carries its model (a τ function of the state and the services), so the renderers stay dumb
  const panel = (form: string, id: string, title: string, model: (s: any, o: Record<string, unknown>, services: any) => unknown) => (o: Record<string, unknown> = {}) => {
    const { id: pid, title: t, ...rest } = o as { id?: string; title?: string };
    return ck.panel.define(pid ?? id, { title: t ?? title }, node(form, { ...rest, model: (s: any, services?: any) => model(s, rest, services) }));
  };
  const nameOf = (s: any, f: string): string => s?.catalog?.frames?.[f]?.name ?? f;
  const paramsModel = (s: any) => {
    const v = looksView(s);
    const l = pickedLook(s);
    if (!l) return { look: null, preview: v.preview };
    const vals = paramsOf(s, l);
    return {
      look: { id: l.id, name: l.name, group: l.group, notes: l.notes ?? null, requires: l.requires, origin: l.origin },
      params: Object.entries(l.params).map(([name, spec]) => ({ name, spec: { type: spec.type, unit: spec.unit ?? null, min: spec.min ?? null, max: spec.max ?? null, step: spec.ui?.step ?? null, values: spec.values ?? null, label: spec.ui?.label ?? name }, value: vals[name] ?? spec.default })),
      preview: v.preview,
      inSurvey: v.surveySet.includes(l.id),
      favourite: (s.looks?.favourites ?? []).includes(l.id),
    };
  };
  const amountModel = (s: any, o: Record<string, unknown>) => {
    const v = looksView(s);
    const l = pickedLook(s);
    const f = sel.current(s);
    const r = f ? (s.recipes?.[f] as FrameRecipe | undefined) : undefined;
    const pf = l && f && r ? planFrame(l, paramsOf(s, l), f, r, optsOf(s)) : null;
    return {
      pct: v.amount,
      range: (o['range'] as [number, number] | undefined) ?? [0, 200],
      look: l ? l.name : null,
      frame: f ? nameOf(s, f) : null,
      result: pf ? (pf.skipped ? null : pf.diff.map((d) => d.shown)) : null,
      skipped: pf?.skipped ? (pf.skipped.hint ?? pf.skipped.message) : null,
      warnings: pf?.warnings.map((w) => w.message) ?? [],
      selected: selection(s).length,
      roll: rollFrameIds(s).length,
      library: sel.visible(s).length,
      from: v.from ?? l?.base ?? 'current',
    };
  };
  const SOURCES: { key: string; label: string; src: CompareSource }[] = [
    { key: 'before', label: 'Before (first print)', src: 'before' },
    { key: 'defaults', label: 'Defaults', src: 'defaults' },
  ];
  const srcKey = (src: CompareSource): string => (typeof src === 'string' ? src : 'snapshot' in src ? `snapshot:${src.snapshot}` : 'frame' in src ? `frame:${src.frame}` : 'look' in src ? `look:${src.look}` : 'recipe');
  const diffModel = (s: any, o: Record<string, unknown>, services: any) => {
    const v = looksView(s);
    const against = (o['against'] as string | undefined) ?? null;
    const src: CompareSource =
      against === 'snapshot' ? ((s.snapshots?.[sel.current(s) ?? ''] ?? []).slice(-1)[0] ? { snapshot: (s.snapshots[sel.current(s)!] as any[]).slice(-1)[0].id } : v.compare)
        : against === 'defaults' ? 'defaults' : against === 'before' ? 'before' : v.compare;
    const studio = services?.studio as Studio | undefined;
    const entries = diffAgainst(s, src, (f) => studio?.frames.get(f)?.initial);
    return { against: srcKey(src), entries: entries.map((e) => ({ shown: e.shown, group: e.group ?? 'Other', path: e.path })), previewing: !!(v.preview && v.picked) };
  };
  const compareModel = (s: any) => {
    const f = sel.current(s);
    const v = looksView(s);
    const snaps = f ? ((s.snapshots?.[f] ?? []) as any[]).map((x) => ({ key: `snapshot:${x.id}`, label: `Snapshot “${x.name}”`, src: { snapshot: x.id } as CompareSource })) : [];
    const ref = typeof v.compare === 'object' && 'frame' in v.compare ? [{ key: `frame:${v.compare.frame}`, label: `Frame ${nameOf(s, v.compare.frame)}`, src: v.compare }] : [];
    return { current: srcKey(v.compare), options: [...SOURCES, ...snaps, ...ref], frame: f ? nameOf(s, f) : null };
  };
  const cardModel = (s: any) => {
    const v = looksView(s);
    const p = v.pending;
    return {
      pending: p
        ? {
            id: p.id, label: p.label, why: p.why,
            frames: p.frames.filter((f) => !f.skipped && f.mutations.length).map((f) => ({ frame: f.frame, name: nameOf(s, f.frame), on: !v.off.includes(f.frame), warnings: f.warnings.map((w) => w.code) })),
            skipped: p.frames.filter((f) => f.skipped).map((f) => ({ frame: f.frame, name: nameOf(s, f.frame), why: f.skipped!.hint ?? f.skipped!.message })),
            aggregate: p.aggregate.map((a) => `${a.label} ${a.short}${a.frames > 1 ? ` (${a.frames} frames)` : ''}`),
            stale: v.stale.map((x) => x.message),
          }
        : null,
      batches: agentBatches(s).map((b) => ({
        batch: b.batch, why: b.why,
        frames: b.frames.map((f) => ({ frame: f.frame, name: nameOf(s, f.frame), on: !(v.batchOff?.[b.batch] ?? []).includes(f.frame), changes: f.diff.length })),
        aggregate: b.aggregate.map((a) => `${a.label} ${a.short}${a.frames > 1 ? ` (${a.frames} frames)` : ''}`),
        stale: (v.batchStale?.[b.batch] ?? []).map((x) => x.message),
      })),
    };
  };
  const groupsModel = (s: any) => ({ chosen: looksView(s).groups, all: Object.entries(syncGroupsOf()).map(([name, g]) => ({ name, default: g.default, note: g.note ?? null })) });
  const presetsModel = (s: any) => ({
    presets: Object.values((s.looks?.presets ?? {}) as Record<string, Preset>).map((p) => ({ id: p.id, name: p.name, entries: p.entries.length, review: (s.looks?.review?.[p.id] ?? []) as string[] })),
    frame: sel.current(s) ? nameOf(s, sel.current(s)!) : null,
  });
  const favMark = (s: any, l: Look): string => ((s.looks?.favourites ?? []).includes(l.id) ? '★ ' : '');
  const lookCell = (o: { size?: number; survey?: boolean } = {}) => (l: Look) =>
    ck.column(
      { class: `cb-look-cell${o.survey ? ' is-survey' : ''}` },
      ck.view.thumb({ image: (s: any) => tile(s, l), max: o.size ?? 120 } as any),
      ck.text((s: any) => `${looksView(s).picked === l.id ? '● ' : ''}${favMark(s, l)}${l.name}`, { strong: true } as any),
      ck.text((s: any) => caption(s, l), { dim: true, class: 'cb-look-caption' } as any),
      ck.row(
        { class: 'cb-look-actions' },
        ck.ui.button({ label: 'Preview', run: ['looks.pick', l.id], small: true } as any),
        o.survey ? ck.ui.button({ label: 'Apply', run: ['looks.apply', l.id], small: true, primary: true } as any) : ck.ui.button({ label: 'Survey ±', run: ['looks.survey.toggle', l.id], small: true } as any),
      ),
    );
  const library = (o: { groups?: string[]; size?: number; id?: string; title?: string } = {}) =>
    ck.panel.define(
      o.id ?? 'looks-library',
      { title: o.title ?? 'Looks' },
      ck.ui.segmented({ options: [{ value: null, label: 'All' }, ...(o.groups ?? ['Print', 'Contrast', 'Film', 'Mine']).map((g) => ({ value: g, label: g }))], bind: (s: any) => s.looksView.group, label: 'Group', small: true } as any),
      ck.view.grid((s: any) => looksOf(s).filter((l) => (!looksView(s).group || l.group === looksView(s).group) && (!o.groups || o.groups.includes(l.group))), {
        id: `${o.id ?? 'looks-library'}-grid`,
        cell: lookCell({ size: o.size ?? 96 }),
        key: (l: Look) => l.id,
        size: () => (o.size ?? 96) + 24,
        empty: 'No looks in this group',
      } as any),
    );
  const surveyLooks = (s: any): Look[] => {
    const v = looksView(s);
    if (v.survey === 'ring') return ringLooks;
    const set = v.surveySet.map((id) => lookById(s, id)).filter((l): l is Look => !!l);
    return set.length ? set : looksOf(s).filter((l) => l.group === 'Print' || l.group === 'Contrast');
  };
  const survey = (o: { size?: number; id?: string } = {}) =>
    ck.column(
      { grow: 1, class: 'cb-looks-survey' },
      ck.row(
        { class: 'cb-looks-survey-bar' },
        ck.text((s: any) => `Survey: ${surveyLooks(s).length} ${looksView(s).survey === 'ring' ? 'ring-around prints' : 'looks'} of ${s.catalog?.frames?.[sel.current(s) ?? '']?.name ?? 'no frame'} at ${looksView(s).amount} %`, { strong: true } as any),
        ck.ui.segmented({ options: [{ value: 'set', label: 'Chosen looks' }, { value: 'ring', label: 'Ring-around' }], bind: (s: any) => s.looksView.survey, label: 'Survey', small: true } as any),
        ck.ui.button({ run: 'looks.survey.open', text: 'Back to the print', small: true } as any),
      ),
      ck.view.grid((s: any) => surveyLooks(s), { id: o.id ?? 'looks-survey', cell: lookCell({ size: o.size ?? 220, survey: true }), key: (l: Look) => l.id, size: () => (o.size ?? 220) + 30, empty: 'Add looks to the survey (Survey ± in the library)' } as any),
    );
  /** a one-row choice of looks for a simple variant: a button per look applies it at the current Amount */
  const choiceRow = (ids: string[]) => ck.row({ class: 'cb-looks-choice' }, ...ids.map((id) => ck.ui.button({ label: lookById({}, id)?.name ?? id, run: ['looks.apply', id], small: true } as any)));
  return { panel, paramsModel, amountModel, diffModel, compareModel, cardModel, groupsModel, presetsModel, lookCell, library, survey, choiceRow };
}
