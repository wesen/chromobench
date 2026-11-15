// The DOM half of the roll kit: renderers for roll.library, roll.setup, roll.balanceBar, roll.inspector and
// roll.progress. Each reads the store through one cell and acts through commands (so every action is also in the
// palette and the menus).
//
//   mountStudio(app, el, studio, { rollPhysics, renderers: ROLL_RENDERERS })

/* eslint-disable @typescript-eslint/no-explicit-any */
import { canonicalJSON } from '@chromobench/values';
import type { Vec3 } from '@chromobench/contract';
import { read } from '../../../src/model/doc.ts';
import { clear, h, listen, type MountCtx, type Renderer } from '@chromobench/shell/dom';
import { makeNode, type NodeData } from '@chromobench/shell';
import { frameRef } from '../../../src/handles.ts';
import { stockName, valueName } from '../../../src/model/names.ts';
import { previewOf } from './engine/batch.ts';
import { SHARED_PATHS } from './engine/constants.ts';
import { divergence, type Roll } from './engine/model.ts';
import { rollFrames, rollOf } from './kit.ts';
import { sel } from '../../../src/sel.ts';

const LOGH_PER_POINT = 0.025;
const pts = (v: readonly number[] | null | undefined): string => (v ? v.map((x) => `${x >= 0 ? '+' : ''}${(x / LOGH_PER_POINT).toFixed(1)}`).join(' ') : '–');
const d3 = (v: readonly number[] | null | undefined): string => (v ? v.map((x) => x.toFixed(3)).join(' ') : '–');
const pct = (x: number | null | undefined, digits = 1): string => (x == null ? '–' : `${(100 * x).toFixed(digits)} %`);
const nameOf = (s: any, f: string): string => s.catalog?.frames?.[f]?.name ?? f;
const btn = (text: string, cls = '', attrs: Record<string, unknown> = {}) => h('button', { type: 'button', class: `ck-btn is-small ${cls}`, text, ...attrs });

const panelOf = (cls: string, read: (s: any, n: NodeData) => unknown, draw: (el: HTMLElement, v: any, m: MountCtx, n: NodeData) => void): Renderer => (n, m) => {
  const el = h('div', { class: `cb-panel ${cls}` });
  m.cell(
    (s) => read(s, n),
    (v) => {
      clear(el);
      draw(el, v, m, n);
    },
    { equals: (a: any, b: any) => !!a && !!b && Object.keys(a).every((k) => a[k] === b[k]) && Object.keys(b).every((k) => a[k] === b[k]) },
  );
  return el;
};
const run = (m: MountCtx, el: HTMLElement, id: string, ...a: unknown[]): void => listen(m.scope, el, 'click', () => void m.rt.runCommand(id, null, ...a));

const library = panelOf('cb-roll-library', (s) => ({ d: s.roll, p: s.rollView?.progress, n: s.catalog?.order?.length ?? 0 }), (el, v, m) => {
  const ul = h('ul', { class: 'cb-roll-list', id: 'rolls' });
  for (const id of v.d?.order ?? []) {
    const r: Roll = v.d.rolls[id];
    if (!r) continue;
    const li = h('li', { class: ['cb-roll-card', v.d.current === id && 'is-current'], 'data-roll': id },
      h('strong', { text: r.label }),
      h('div', { class: 'cb-dim', text: `${r.frames.length} frames · ${r.status}${r.reference ? ` · ref ${r.reference}` : ''}` }));
    run(m, li, 'roll.select', id);
    ul.append(li);
  }
  if (!v.d?.order?.length) el.append(h('p', { class: 'cb-empty', text: v.n ? `${v.n} open frames, no roll yet` : 'Open the scans of a roll' }));
  el.append(ul);
  const bar = h('div', { class: 'cb-roll-actions' });
  const b1 = btn('New roll from open frames', 'is-primary', { id: 'roll-new' });
  run(m, b1, 'roll.fromFrames');
  const b2 = btn('Analyse', '', { id: 'roll-analyse' });
  run(m, b2, 'roll.analyse');
  const b3 = btn('First print…', '', { id: 'roll-first-print', title: 'Plan the first print of every frame as one card to approve' });
  run(m, b3, 'roll.firstPrint', true);
  bar.append(b1, b2, b3);
  el.append(bar);
  if (v.p) el.append(h('p', { class: 'cb-dim', text: `Analysing ${v.p.done}/${v.p.total}…` }));
});

const progress = panelOf('cb-roll-progress', (s) => ({ p: s.rollView?.progress, e: s.rollView?.error }), (el, v) => {
  if (v.p) el.append(h('span', { id: 'roll-progress', text: `Analysing ${v.p.done}/${v.p.total}${v.p.frame ? ` · ${v.p.frame}` : ''}` }));
  if (v.e) el.append(h('span', { class: 'cb-err', text: v.e }));
});

/** one setup row: label, value, evidence, divergence note, optional chooser */
function row(label: string, value: string, evidence: string | null, note: string | null, extra?: HTMLElement | null): HTMLElement {
  return h('div', { class: 'cb-roll-row', 'data-row': label.toLowerCase() },
    h('div', { class: 'cb-roll-row-h' }, h('span', { class: 'cb-roll-scope', text: 'roll' }), ' ', h('strong', { text: label }), ' ', h('span', { class: 'cb-roll-value', text: value })),
    evidence ? h('div', { class: 'cb-dim cb-roll-evidence', text: evidence }) : null,
    note ? h('div', { class: 'cb-warn', text: note }) : null,
    extra ?? null);
}

const setup = panelOf('cb-roll-setup', (s) => {
  const r = rollOf(s);
  return { r, recipes: r ? r.frames.map((f) => s.docs?.[f]).map((x) => x && canonicalJSON(SHARED_PATHS.map((p) => read(x, p) ?? null))).join('|') : '', s };
}, (el, v, m, n) => {
  const r: Roll | null = v.r;
  if (!r) return void el.append(h('p', { class: 'cb-empty', text: 'No roll selected' }));
  const s = v.s;
  const a = r.analysis;
  const div = divergence(r, (f) => s.docs?.[f]);
  const over = (p: string): string | null => {
    const fs = (div as Record<string, string[] | undefined>)[p];
    return fs?.length ? `overridden on ${fs.length} frame${fs.length === 1 ? '' : 's'}: ${fs.map((f) => nameOf(s, f)).join(', ')}` : null;
  };
  const sections: string[] = (n.props['sections'] as string[] | undefined) ?? ['stock', 'scanner', 'base', 'veil', 'noise', 'frames'];
  el.append(h('div', { class: 'cb-roll-title', text: `${r.label} · ${r.status}` }));
  if (!a) el.append(h('p', { class: 'cb-dim', text: 'Not analysed yet: Roll ▸ Analyse Roll' }));
  for (const sec of sections) {
    if (sec === 'stock') {
      const cur = String(r.fragment['stock'] ?? '');
      const sel = h('select', { 'aria-label': 'Stock', id: 'roll-stock' }) as HTMLSelectElement;
      const names = [...new Set([cur, ...(a?.ranking ?? []).map((x) => x.stock)].filter(Boolean))];
      for (const x of names) sel.append(h('option', { value: x, text: stockName(x), ...(x === cur ? { selected: true } : {}) }));
      listen(m.scope, sel, 'change', () => void m.rt.runCommand('roll.setShared', null, 'stages.scan.medium.stock', sel.value));
      const rk = a?.ranking;
      const ev = rk && rk.length
        ? `${stockName(rk[0]!.stock)} fits the base to ${(a!.base.absD ? rk[0]!.maxDiffD : rk[0]!.shapeDiffD).toFixed(3)} D${rk[1] ? `; ${stockName(rk[1].stock)} is ${((a!.base.absD ? rk[1].maxDiffD - rk[0]!.maxDiffD : rk[1].shapeDiffD - rk[0]!.shapeDiffD)).toFixed(3)} D further` : ''}${a!.base.absD ? '' : ' (weak: by shape only, no open gate)'}`
        : 'no ranking (no stock data from the host)';
      el.append(row('Stock', cur ? stockName(cur) : '–', ev, over('stages.scan.medium.stock'), sel));
    } else if (sec === 'scanner') {
      el.append(row('Scanner', r.fragment['scanner'] ? valueName('scanners', String(r.fragment['scanner'])) : '–', 'estimated, not calibrated (CHB-013 measures the scanner)', over('stages.scan.medium.scanner')));
    } else if (sec === 'base' && a) {
      const b = a.base;
      const ev = b.T ? `median of ${b.used.length} frame rebate${b.used.length === 1 ? '' : 's'}, spread ${b.spreadD.toFixed(3)} D at ${a.long} px${b.absD ? `; absolute ${d3(b.absD)} D` : ''}; written to every frame's film base (baseT)` : 'no rebate found';
      const mixedNote = b.mixed.length ? `mixed: ${b.mixed.map((f) => `${nameOf(s, f)} (${b.deviationD[f]!.toFixed(3)} D)`).join(', ')} keep their own base` : null;
      el.append(row('Base', b.T ? `T ${d3(b.T)}` : '–', ev, mixedNote ?? over('stages.scan.medium.baseT')));
    } else if (sec === 'veil' && a) {
      const b = a.base;
      const veilOfBase = b.veil && b.T ? (b.veil.map((x, k) => x / b.T![k]!) as Vec3) : null;
      const ev = b.veil
        ? `read on the holder of ${b.veilFrames} frame${b.veilFrames === 1 ? '' : 's'}: ${veilOfBase ? veilOfBase.map((x) => pct(x, 2)).join(' ') : ''} of the base, written to the scan's flare${b.flare ? `; flare ${b.flare.map((x) => pct(x, 2)).join(' ')} of the open gate` : ' (no open gate: flare fraction unknown)'}`
        : 'no opaque holder in view: the veil is not measured or corrected';
      el.append(row('Veil (flare)', b.veil ? d3(b.veil.map((x) => x * 1000)) + ' ‰' : '–', ev, over('stages.scan.medium.flare')));
    } else if (sec === 'noise' && a) {
      const ss = r.frames.map((f) => a.frames[f]).filter((x) => x?.sigma);
      const f0 = ss[0];
      el.append(row('Noise σ', f0?.sigma ? d3(f0.sigma) + ' D' : '–', f0 ? `at ${f0.size[0]}×${f0.size[1]} (σ depends on the size)` : null, null));
    } else if (sec === 'frames' && a) {
      const named = (t: string): string => r.frames.reduce((x, f) => x.split(f).join(nameOf(s, f)), t);
      const notes = a.diagnostics.map((d) => `${d.code}: ${named(d.message)}`);
      if (notes.length) el.append(h('ul', { class: 'cb-roll-diags' }, ...notes.map((t) => h('li', { class: 'cb-warn', text: t }))));
    }
  }
});

const BATCH_THUMBS = 12;
/** a small print thumbnail (the shell's thumb form), mounted from a renderer */
const thumb = (m: MountCtx, image: unknown, which: 'before' | 'after'): Node => {
  const el = m.mount(makeNode('thumb', { image, max: 72 }, [], null)) as HTMLElement;
  el.classList.add('cb-change-thumb', `is-${which}`);
  el.title = which === 'before' ? 'now' : 'with the batch';
  return el;
};

const balanceBar = panelOf('cb-roll-balance', (s) => ({ r: rollOf(s), v: s.rollView, sel: sel.current(s), cat: s.catalog, rec: s.rollView?.pending ? s.docs : null }), (el, v, m) => {
  const r: Roll | null = v.r;
  if (!r) return void el.append(h('p', { class: 'cb-empty', text: 'No roll selected' }));
  const s = { catalog: v.cat };
  const chip = h('div', { class: 'cb-roll-ref', id: 'roll-reference', text: r.reference ? `Reference: ${nameOf(s, r.reference)}` : 'No reference frame' });
  const setRef = btn('Use selected as reference', '', { id: 'roll-set-ref' });
  run(m, setRef, 'roll.setReference');
  const slider = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(v.v.alpha), 'aria-label': 'Roll consistency (colour share α)', id: 'roll-alpha' }) as HTMLInputElement;
  listen(m.scope, slider, 'change', () => void m.rt.runCommand('roll.alpha', null, Number(slider.value)));
  const match = btn('Match to reference', 'is-primary', { id: 'roll-match' });
  run(m, match, 'roll.matchToReference');
  const clearB = btn('Clear match', '', { id: 'roll-clear' });
  run(m, clearB, 'roll.clearMatch');
  el.append(chip, h('div', { class: 'cb-roll-actions' }, setRef), h('label', { class: 'cb-roll-alpha' }, `Colour share α ${Number(v.v.alpha).toFixed(2)} `, slider), h('div', { class: 'cb-roll-actions' }, match, clearB));
  if (r.match) el.append(h('p', { class: 'cb-dim', text: `Applied: α ${r.match.alpha}` }));
  const b = v.v.pending;
  if (!b) return;
  const off: string[] = v.v.off ?? [];
  const card = h('div', { class: 'cb-card cb-roll-card-pending', id: 'roll-pending', 'data-batch': b.id },
    h('div', { class: 'cb-card-h' }, h('strong', { text: b.label }), ` · ${b.frames.length - off.length} frame${b.frames.length - off.length === 1 ? '' : 's'}`),
    h('div', { class: 'cb-dim', text: b.why }));
  const list = h('div', { class: 'cb-changes' });
  let shown = 0;
  for (const f of b.frames) {
    const box = h('input', { type: 'checkbox', 'aria-label': `Include ${nameOf(s, f.frame)}` }) as HTMLInputElement;
    box.checked = !off.includes(f.frame);
    listen(m.scope, box, 'change', () => void m.rt.runCommand('roll.pending.toggle', null, f.frame));
    // before and after: the frame's print as it is, and as the batch would make it (the same thumbnail cache as the sheet)
    const cur = v.rec?.[f.frame];
    const thumbs = cur && shown++ < BATCH_THUMBS
      ? h('span', { class: 'cb-change-thumbs' },
        thumb(m, frameRef(f.frame, cur).print(), 'before'), h('span', { class: 'cb-dim', text: '→' }), thumb(m, frameRef(f.frame, previewOf(b, f.frame, cur)).print(), 'after'))
      : null;
    list.append(h('div', { class: 'cb-change' }, h('label', {}, box, ` ${nameOf(s, f.frame)}`), thumbs));
  }
  if (b.frames.length > BATCH_THUMBS) list.append(h('div', { class: 'cb-dim', text: `before and after shown for the first ${BATCH_THUMBS} of ${b.frames.length} frames` }));
  card.append(list);
  if (b.skipped.length) card.append(h('div', { class: 'cb-dim', id: 'roll-skipped', text: `${b.skipped.length} skipped: ${b.skipped.map((x: any) => `${nameOf(s, x.frame)} (${x.why})`).join(', ')}` }));
  const stale = v.v.stale ?? [];
  if (stale.length) card.append(h('div', { class: 'cb-warn', id: 'roll-stale', text: stale.map((x: any) => x.message).join('; ') }));
  const ok = btn(stale.length ? 'Apply anyway' : 'Approve', 'is-primary approve', { id: 'roll-approve' });
  run(m, ok, 'roll.pending.approve', stale.length > 0);
  const no = btn('Reject', 'reject', { id: 'roll-reject' });
  run(m, no, 'roll.pending.reject');
  card.append(h('div', { class: 'cb-roll-actions' }, ok, no));
  el.append(card);
});

const inspector = panelOf('cb-roll-inspector', (s) => ({ r: rollOf(s), cat: s.catalog }), (el, v) => {
  const r: Roll | null = v.r;
  const a = r?.analysis;
  if (!r || !a) return void el.append(h('p', { class: 'cb-empty', text: 'No analysis' }));
  const s = { catalog: v.cat };
  const t = h('table', { class: 'cb-roll-table', id: 'roll-inspector-table' });
  t.append(h('tr', {}, ...['frame', 'rebate', 'ΔD base', 'σ', 'blank', 'below', 'LATD (pt)', 'auto (pt)', ''].map((x) => h('th', { text: x }))));
  for (const f of r.frames) {
    const fa = a.frames[f];
    if (!fa) continue;
    const reb = fa.layout.rebate;
    t.append(h('tr', { 'data-frame': f },
      h('td', { text: nameOf(s, f) }),
      h('td', { text: reb ? `${reb.from} ${reb.confidence.toFixed(2)}` : '–' }),
      h('td', { text: a.base.deviationD[f]?.toFixed(3) ?? '–' }),
      h('td', { text: d3(fa.sigma) }),
      h('td', { text: pct(fa.classes?.blank) }),
      h('td', { text: pct(fa.classes?.below) }),
      h('td', { text: pts(fa.latd) }),
      h('td', { text: pts(fa.auto) }),
      h('td', { text: [fa.hint === 'under' ? 'under?' : '', a.base.mixed.includes(f) ? 'mixed' : ''].filter(Boolean).join(' ') })));
  }
  el.append(h('div', { class: 'cb-dim', text: `measured at ${a.long} px long side; σ and class shares at the frame's image area at that size` }), t);
});

export const ROLL_RENDERERS: Record<string, Renderer> = {
  'roll.library': library,
  'roll.setup': setup,
  'roll.balanceBar': balanceBar,
  'roll.inspector': inspector,
  'roll.progress': progress,
};
export { rollFrames };
