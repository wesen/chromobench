// The mini studio: a TS cut-down of CraftKit Studio's Library and Develop modules, built with the ported shell.
// Used by the headless build tests, the DOM tests and the demo page.

import type { Ck } from '../../src/index.ts';

export interface Photo {
  id: string;
  name: string;
  flag: 'pick' | 'reject' | null;
  rating: number;
  date: number;
}
export interface Dev {
  light: { exposure: number; contrast: number; highlights: number; shadows: number };
  color: { temp: number; tint: number; vibrance: number; saturation: number };
}
export interface MiniState {
  catalog: { photos: Photo[] };
  dev: Record<string, Dev>;
  view: { module?: string; mode: 'grid' | 'loupe'; thumbSize: number; grid: boolean; filter: { minRating: number } };
  ui: { selection: { ids: string[]; primary: string | null; anchor: string | null }; tool: string | null; probe: [number, number] | null };
  prefs: Record<string, unknown>;
  workspace: Record<string, unknown>;
}

export const defaultDev = (): Dev => ({ light: { exposure: 0, contrast: 0, highlights: 0, shadows: 0 }, color: { temp: 5500, tint: 0, vibrance: 0, saturation: 0 } });

export function miniState(n = 12): MiniState {
  const photos: Photo[] = [];
  const dev: Record<string, Dev> = {};
  for (let i = 0; i < n; i++) {
    const id = 'p' + i;
    photos.push({ id, name: `Photo ${i + 1}`, flag: null, rating: i % 6, date: 1000 + i });
    dev[id] = defaultDev();
  }
  return {
    catalog: { photos },
    dev,
    view: { mode: 'grid', thumbSize: 140, grid: false, filter: { minRating: 0 } },
    ui: { selection: { ids: ['p0'], primary: 'p0', anchor: 'p0' }, tool: null, probe: null },
    prefs: {},
    workspace: {},
  };
}

/** a procedural renderable: the gradient bridge (demo) and the fake bridge (tests) both understand { fake, name } */
export const pictureOf = (s: MiniState, id: string | null): Record<string, unknown> | null => {
  if (!id) return null;
  const d = s.dev[id];
  if (!d) return null;
  return { fake: true, name: id, w: 600, h: 400, exposure: d.light.exposure, contrast: d.light.contrast, temp: d.color.temp, tint: d.color.tint, saturation: d.color.saturation };
};

/** the mini studio's commands, keys and tools: the kit its shell installs (commands and tools come from kits) */
export function miniKit(ck: Ck<MiniState>) {
  const sel = (s: MiniState) => s.ui.selection.primary;
  return ck
    .kit('mini')
    .commands<MiniState>({
      'photo.pick': {
        label: 'Flag as Pick',
        icon: 'flag',
        enabled: (s: MiniState) => !!sel(s),
        why: 'Select a photo first',
        run: ctx =>
          ctx.tx('Flag as Pick', (t: MiniState) => {
            t.catalog.photos.find(p => p.id === sel(ctx.state))!.flag = 'pick';
          }),
      },
      'photo.reject': {
        label: 'Reject',
        enabled: (s: MiniState) => !!sel(s),
        why: 'Select a photo first',
        run: ctx =>
          ctx.tx('Reject', (t: MiniState) => {
            t.catalog.photos.find(p => p.id === sel(ctx.state))!.flag = 'reject';
          }),
      },
      'photo.rate': {
        label: 'Set Rating',
        palette: false,
        run: (ctx, n: number) =>
          ctx.tx(`Rating ${n}`, (t: MiniState) => {
            t.catalog.photos.find(p => p.id === sel(ctx.state))!.rating = n;
          }),
      },
      'dev.reset': {
        label: 'Reset Develop Settings',
        module: 'develop',
        enabled: (s: MiniState) => {
          const id = sel(s);
          return !!id && JSON.stringify(s.dev[id]) !== JSON.stringify(defaultDev());
        },
        why: 'Nothing to reset',
        run: ctx =>
          ctx.tx('Reset', (t: MiniState) => {
            t.dev[sel(ctx.state)!] = defaultDev();
          }),
      },
      'view.grid': { label: 'Show Grid Overlay', checked: (s: MiniState) => s.view.grid, run: ctx => ctx.set({ view: { grid: !ctx.state.view.grid } }) },
    })
    // the kit's keys bind in every module
    .keys({ P: 'photo.pick', X: 'photo.reject', ...ck.digits(0, 5, 'photo.rate') })
    .tools({
      probe: {
        label: 'Probe',
        key: 'I',
        icon: 'eyedropper',
        cursor: 'crosshair',
        on: {
          down: (e, ctx) => {
            ctx.set({ ui: { probe: [Math.round(e.x), Math.round(e.y)] } });
            return false;
          },
        },
      },
    });
}

export function miniStudio(ck: Ck<MiniState>, o: { n?: number } = {}) {
  const sel = (s: MiniState) => s.ui.selection.primary;
  const photoOf = (s: MiniState) => s.catalog.photos.find(p => p.id === sel(s));
  const library = ck
    .module('library', { label: 'Library', key: 'G', icon: 'grid' })
    .left(ck.dock.column({ width: 220 }, ck.panel.define('navigator', { title: 'Navigator' }, ck.stat(s => photoOf(s)?.name ?? '—', { label: 'Selected' }))))
    .center(
      ck.view.grid(s => (s as any).catalog.filtered, {
        id: 'grid',
        cell: (p: Photo) => ck.column({}, ck.view.thumb({ image: s => pictureOf(s, p.id), max: 160 }), ck.text(p.name, { dim: true })),
        size: s => s.view.thumbSize,
        select: { bind: s => s.ui.selection, mode: 'multi' },
        keys: { Enter: 'module.develop' },
        activate: (_p: Photo, ctx: any) => ctx.go('develop'),
        empty: 'No photos match the filter',
      }),
    )
    .right(
      ck.dock.column(
        { width: 260 },
        ck.panel.define(
          'filter',
          { title: 'Filter' },
          ck.ui.slider(0, 5, { label: 'Minimum rating', bind: s => s.view.filter.minRating, step: 1, reset: 0 }),
          ck.ui.slider(60, 280, { label: 'Thumbnail size', bind: s => s.view.thumbSize, step: 10, reset: 140 }),
        ),
      ),
    )
    .bottom(ck.view.filmstrip(s => s.catalog.photos, { id: 'strip', cell: (p: Photo) => ck.text(p.name), select: { bind: s => s.ui.selection } }));
  const develop = ck
    .module('develop', { label: 'Develop', key: 'D', icon: 'adj', txOpts: s => ({ channel: s.ui.selection.primary, snapPath: ['dev', s.ui.selection.primary!] }) })
    .left(ck.dock.column({ width: 220 }, ck.panel('navigator')))
    .center(
      ck.viewport(s => pictureOf(s, s.ui.selection.primary), {
        id: 'main',
        tools: ['probe'],
        compare: true,
        overlays: [ck.overlay.grid({ when: s => s.view.grid })],
        label: s => photoOf(s)?.name ?? '',
      }),
    )
    .right(
      ck.dock.column(
        { width: 280, solo: false },
        ck.panel.define(
          'basic',
          { title: 'Basic', reset: true },
          ck.section(
            'Light',
            { reset: true },
            ck.ui.slider(-5, 5, { label: 'Exposure', bind: s => s.dev[s.ui.selection.primary!]!.light.exposure, step: 0.05, reset: 0, bipolar: true }),
            ck.ui.slider(-100, 100, { label: 'Contrast', bind: s => s.dev[s.ui.selection.primary!]!.light.contrast, step: 1, reset: 0, bipolar: true }),
            ck.ui.slider(-100, 100, { label: 'Highlights', bind: s => s.dev[s.ui.selection.primary!]!.light.highlights, step: 1, reset: 0, bipolar: true }),
            ck.ui.slider(-100, 100, { label: 'Shadows', bind: s => s.dev[s.ui.selection.primary!]!.light.shadows, step: 1, reset: 0, bipolar: true }),
          ),
          ck.section(
            'Color',
            { reset: true },
            ck.ui.slider(2000, 12000, { label: 'Temp', bind: s => s.dev[s.ui.selection.primary!]!.color.temp, step: 50, reset: 5500, track: 'temp' }),
            ck.ui.slider(-100, 100, { label: 'Tint', bind: s => s.dev[s.ui.selection.primary!]!.color.tint, step: 1, reset: 0, track: 'tint', bipolar: true }),
            ck.ui.slider(-100, 100, { label: 'Saturation', bind: s => s.dev[s.ui.selection.primary!]!.color.saturation, step: 1, reset: 0, bipolar: true }),
          ),
          ck.row({}, ck.ui.command('dev.reset'), ck.ui.command('photo.pick')),
        ),
      ),
    )
    .bottom(ck.view.filmstrip(s => s.catalog.photos, { id: 'strip2', cell: (p: Photo) => ck.text(p.name), select: { bind: s => s.ui.selection } }))
    .keys({ '\\': 'view.grid' });
  return ck
    .shell('Mini Studio')
    .state(miniState(o.n), {
      channelName: (id, s) => s.catalog.photos.find(p => p.id === id)?.name,
      currentChannel: s => s.ui.selection.primary,
      keepUi: ['selection'],
    })
    .derive('catalog.filtered', (s: MiniState) => s.catalog.photos.filter(p => p.rating >= s.view.filter.minRating))
    .use(miniKit(ck))
    .menus(
      ck.menu('File', ['app.palette']),
      ck.menu('Edit', ['edit.undo', 'edit.redo']),
      ck.menu('Photo', ['photo.pick', 'photo.reject', '-', { label: 'Rating', items: ['photo.rate'] }]),
      ck.menu('Settings', ['dev.reset']),
      ck.menu('View', ['view.grid', 'view.fit', 'view.zoomIn', 'view.zoomOut', '-', 'app.theme']),
      ck.menu('Window', ['view.hideSides', 'view.toggleLeft', 'view.toggleRight', 'workspace.reset']),
      ck.menu('Help', ['app.shortcuts', 'app.diagnostics']),
    )
    .keys({ 'Mod+Shift+R': 'dev.reset' })
    .spring('Space', 'hand')
    .module(library)
    .module(develop);
}
