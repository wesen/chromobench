// Cull: a full-screen pass through a shoot with two keys (W-01). P keeps, X drops, the next photo comes up;
// hold C to see the last pick beside the current one.
import { ck } from '../shell/index.js';
import { h, icon } from '../shell/ui/dom.js';
import { filtered, primaryOf } from './catalog.js';
import { render } from './engine-graphs.js';
import { photoCell, CULL_KEYS } from './library.js';
import { effective } from './develop-model.js';

const lastPickExpr = ck.image(s => { const id = s.ui.lastPick; const p = id && s.catalog.photos.find(x => x.id === id); return p ? p.file : null; }).develop(s => effective((s.ui.lastPick && s.dev[s.ui.lastPick]) || s.devDefaults, s.ui.lastPick && s.catalog.photos.find(x => x.id === s.ui.lastPick)));

export function cullModule(shell) {
  shell.module('cull', m => m.label('Cull').key('Alt+C').icon('flag')
    .center(ck.column({ grow: 1, class: 'cull' },
      ck.match(s => (s.ui.peek && s.ui.lastPick && s.ui.lastPick !== (s.ui.selection && s.ui.selection.primary) ? 'peek' : 'one'), {
        one: ck.viewport(render, { id: 'main', dims: s => { const p = primaryOf(s); return p ? [p.w, p.h] : null; }, click: 'toggle-1:1', compare: false,
          hud: ck.column({ class: 'cull-hud' },
            ck.hud({ at: 'top-right' }, s => { const L = filtered(s), p = primaryOf(s); const i = p ? L.findIndex(x => x.id === p.id) : -1; const picks = L.filter(x => x.flag === 'pick').length, out = L.filter(x => x.flag === 'reject').length; return `${i + 1} of ${L.length} · ${picks} picks · ${out} out`; }),
            ck.hud({ at: 'top-left' }, s => { const p = primaryOf(s); return p ? `${p.title} · ${p.flag === 'pick' ? 'Kept' : p.flag === 'reject' ? 'Out' : 'Unflagged'}` : ''; }),
            ck.hud({ at: 'bottom-left' }, () => 'P keep · X out · U undecided · 1–5 stars · ← → move · Z 1:1 · hold C: last pick')) }),
        peek: ck.row({ grow: 1 },
          ck.viewport(lastPickExpr, { id: 'peek', label: 'Last pick', compare: false }),
          ck.viewport(render, { id: 'main', label: 'Current', compare: false, dims: s => { const p = primaryOf(s); return p ? [p.w, p.h] : null; } })),
      })))
    .bottom(ck.view.filmstrip(s => s.catalog.filtered, { id: 'cull-strip', cell: (p, i) => photoCell(p, i, { compact: true }), select: { bind: s => s.ui.selection, mode: 'single' }, aspect: 1.15 }))
    .keys({ ...CULL_KEYS, ArrowRight: 'photo.next', ArrowLeft: 'photo.previous', Home: 'photo.first', End: 'photo.last', Z: 'view.toggle-1:1' })
    .onEnter(ctx => {
      const g = ctx.state.workspace.layout && ctx.state.workspace.layout.cull; if (!g) ctx.set({ workspace: { layout: { cull: { bottom: { size: 70 } } } } });
      // one photo at a time: a selection brought in from the grid would be flagged unseen
      const sel = ctx.state.ui.selection; if (sel && sel.ids.length > 1) ctx.set({ ui: { selection: { ids: [sel.primary], primary: sel.primary, anchor: sel.primary } } });
    }));
  // hold C: the last pick beside the current photo; let go and it is gone
  shell.spring('C', { down: ctx => ctx.set({ ui: { peek: true } }), up: ctx => ctx.set({ ui: { peek: false } }) }, { label: 'the last pick beside this one', while: () => document.querySelector('.ck-app')?.dataset.module === 'cull' });
}
