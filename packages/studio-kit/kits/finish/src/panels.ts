// cb.kits.finish: the builder calls (split from kit.ts, CHB-032): the finish viewer and the crop, spot and tones
// panels, built from ck.ui and cb.arg only.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Document } from '@chromobench/contract';
import type { Ck } from '@chromobench/shell';
import type { Cb } from '../../../src/cb.ts';
import { frameRef, type ImageHandle } from '../../../src/handles.ts';
import { ASPECTS } from './geometry.ts';
import { type SpotMode, FINISHING_PATHS, type SpotRef, spotsOf, cropProblem, withoutFinishing } from './state.ts';
import { sel } from '../../../src/sel.ts';
import type { FinishContext } from './context.ts';

export function createFinishPanels(ck: Ck, cb: Cb, F: FinishContext) {
  const { sizes } = F;
  // ── builder calls ──
  /** the print as the finish module shows it: the print stage and the dust turned off while finish.toggle is on */
  const shown = (s: any): ImageHandle | null => {
    const h = cb.sel.frame(s)?.print() ?? null;
    if (!h || !s.finish?.bypass || typeof h.doc !== 'object') return h;
    return frameRef(h.frame, withoutFinishing(h.doc), `${h.expr} /* before finishing */`).print();
  };
  const viewer = (o: Record<string, unknown> = {}) => cb.viewer(shown, { id: 'finish', tools: ['crop', 'spot'], compare: true, ...o } as any);
  const aspectOptions = (list: readonly string[]) => list.map((a) => ({ value: a, label: a === 'original' ? 'Original' : a === 'free' ? 'Free' : a }));
  const cropPanel = (o: { id?: string; title?: string; aspects?: readonly string[] } = {}) =>
    ck.panel.define(o.id ?? 'finish-crop', { title: o.title ?? 'Crop & straighten' },
      ck.row({ class: 'cb-finish-tools' }, ck.ui.button({ run: 'tool.crop', text: 'Crop (R)', small: true }), ck.ui.button({ run: 'crop.done', text: 'Done', small: true })),
      ck.ui.select({ options: aspectOptions(o.aspects ?? ASPECTS), bind: (s: any) => s.finish.crop.aspect, set: 'crop.aspect', label: 'Aspect' } as any),
      ck.ui.checkbox({ label: 'Lock aspect', switch: true, bind: (s: any) => s.finish.crop.locked } as any),
      ck.text((s: any) => {
        const r = s.docs?.[sel.current(s) ?? ''] as Document | undefined;
        if (!r) return 'No frame';
        const f = r.geometry;
        return `${f.crop ? `${f.crop.w} × ${f.crop.h} px` : 'Whole frame'} · ${f.angle_deg.toFixed(1)}° · ${f.orientation}`;
      }, { dim: true, class: 'cb-crop-readout' } as any),
      ck.row({ class: 'cb-finish-angle' },
        ck.ui.button({ label: '−1°', run: ['crop.straighten', -1], small: true } as any),
        ck.ui.button({ label: '−0.1°', run: ['crop.straighten', -0.1], small: true } as any),
        ck.ui.button({ label: '0°', run: ['crop.straighten', { to: 0 }], small: true } as any),
        ck.ui.button({ label: '+0.1°', run: ['crop.straighten', 0.1], small: true } as any),
        ck.ui.button({ label: '+1°', run: ['crop.straighten', 1], small: true } as any)),
      ck.row({ class: 'cb-finish-orient' },
        ck.ui.button({ run: 'orient.ccw', text: '⟲', small: true }), ck.ui.button({ run: 'orient.cw', text: '⟳', small: true }),
        ck.ui.button({ run: 'orient.flipH', text: '⇋', small: true }), ck.ui.button({ run: 'orient.flipV', text: '⇵', small: true }),
        ck.ui.button({ run: 'crop.swap', text: 'Swap', small: true }), ck.ui.button({ run: 'crop.reset', text: 'Reset', small: true })),
      ck.text((s: any) => {
        const f = sel.current(s);
        const z = f ? sizes.get(f) : undefined;
        const p = f && z && s.docs?.[f] ? cropProblem(s.docs[f], z.W, z.H) : null;
        return p ? `${p.code}: ${p.message}` : '';
      }, { class: 'cb-warn' } as any),
    );
  const retouchPanel = (o: { id?: string; title?: string; modes?: SpotMode[] } = {}) =>
    ck.panel.define(o.id ?? 'finish-retouch', { title: o.title ?? 'Spot removal' },
      ck.row({ class: 'cb-finish-tools' }, ck.ui.button({ run: 'tool.spot', text: 'Spots (Q)', small: true }), ck.ui.button({ run: 'spot.show', text: 'Show', small: true })),
      ck.ui.segmented({ options: (o.modes ?? ['heal', 'clone', 'dust']).map((m) => ({ value: m, label: m === 'dust' ? 'Dust (on the film)' : m === 'heal' ? 'Heal' : 'Clone' })), bind: (s: any) => s.finish.spot.mode, label: 'Mode', small: true } as any),
      ck.ui.slider({ min: 1, max: 200, bind: (s: any) => s.finish.spot.r, label: 'Size', step: 1, unit: 'px', decimals: 0 } as any),
      ck.ui.slider({ min: 0, max: 1, bind: (s: any) => s.finish.spot.feather, label: 'Feather', step: 0.05, decimals: 2 } as any),
      ck.ui.slider({ min: 0, max: 1, bind: (s: any) => s.finish.spot.opacity, label: 'Opacity', step: 0.05, decimals: 2 } as any),
      ck.view.list((s: any) => spotsOf(s.docs?.[sel.current(s) ?? '']), {
        id: 'finish-spots',
        key: (x: SpotRef) => x.id,
        row: (x: SpotRef) => ck.row({ class: 'cb-spot-row' },
          ck.ui.button({ label: `${x.id} · ${x.mode} · r ${x.r}`, run: ['spot.select', x.id], small: true, quiet: true } as any),
          ck.ui.button({ label: '✕', run: ['spot.delete', x.id], small: true, quiet: true } as any)),
        empty: 'No spots: choose the tool (Q) and click a speck',
      } as any),
      ck.row({ class: 'cb-finish-spot-cmds' }, ck.ui.button({ run: 'spot.delete', text: 'Delete', small: true }), ck.ui.button({ run: 'spot.clear', text: 'Clear all', small: true })),
      ck.text('Heal and clone are layers of the print (the Retouch group); Dust heals the negative of a scan (the Dust group).', { dim: true } as any),
    );
  const tonesPanel = (o: { id?: string; title?: string; only?: string[] } = {}) =>
    ck.panel.define(o.id ?? 'finish-tones', { title: o.title ?? 'Finishing (digital, after the print)' },
      ck.text('Not darkroom controls: they change the finished print digitally.', { dim: true } as any),
      ...FINISHING_PATHS.filter((p) => !o.only || o.only.some((x) => p.endsWith(x))).map((p) => cb.arg(p, { why: 'finishing, not darkroom' })),
      ck.row({ class: 'cb-finish-tone-cmds' }, ck.ui.button({ run: 'finish.addClarity', text: '+ Clarity', small: true }), ck.ui.button({ run: 'finish.toggle', text: 'Before / after', small: true }), ck.ui.button({ run: 'finish.resetTones', text: 'Reset', small: true })),
    );
  return { shown, viewer, cropPanel, retouchPanel, tonesPanel };
}
