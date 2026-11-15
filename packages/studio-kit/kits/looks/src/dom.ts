// The DOM half of the looks kit: renderers for looks.params, looks.amount, looks.diff, looks.compare, looks.card,
// looks.groups and looks.presets. Each node carries its model (a function the kit computed); a renderer reads it
// through one cell and acts only through commands, so every action is also in the palette and the menus. The
// library and the survey are built from shell primitives (grid, thumb, text, buttons) and need no renderer.
//
//   mountStudio(app, el, studio, { renderers: { ...ROLL_RENDERERS, ...LOOKS_RENDERERS } })

/* eslint-disable @typescript-eslint/no-explicit-any */
import { canonicalJSON } from '@chromobench/contract';
import { clear, h, listen, type MountCtx, type Renderer } from '@chromobench/shell/dom';
import type { NodeData } from '@chromobench/shell';

const btn = (text: string, cls = '', attrs: Record<string, unknown> = {}) => h('button', { type: 'button', class: `ck-btn is-small ${cls}`, text, ...attrs });
const run = (m: MountCtx, el: HTMLElement, id: string, ...a: unknown[]): void => listen(m.scope, el, 'click', () => void m.rt.runCommand(id, null, ...a));
const empty = (text: string) => h('p', { class: 'cb-empty', text });
const UNIT: Record<string, string> = { point: 'pt', stop: 'st', s: 's', K: 'K', CC: 'CC', percent: '%' };
const fmtParam = (v: number, unit: string | null): string => {
  const u = unit ? UNIT[unit] ?? '' : '';
  const x = Number(v.toFixed(unit === 'stop' ? 2 : 1));
  return `${unit === 'stop' && x > 0 ? '+' : ''}${x}${u ? ` ${u}` : ''}`;
};

/** one cell over the node's model; redraw only when the model changes (canonical JSON) */
const form = (cls: string, draw: (el: HTMLElement, v: any, m: MountCtx, n: NodeData) => void): Renderer => (n, m) => {
  const el = h('div', { class: `cb-panel ${cls}` });
  const model = n.props['model'] as (s: any, services: any) => unknown;
  m.cell(
    (s) => model(s, m.rt.services),
    (v) => {
      clear(el);
      draw(el, v, m, n);
    },
    { equals: (a: unknown, b: unknown) => canonicalJSON(a ?? null) === canonicalJSON(b ?? null) },
  );
  return el;
};

const params = form('cb-looks-params', (el, v, m) => {
  if (!v.look) return void el.append(empty('Pick a look in the library (Preview)'));
  el.append(h('div', { class: 'cb-looks-title', id: 'looks-picked' }, h('strong', { text: v.look.name }), h('span', { class: 'cb-dim', text: ` · ${v.look.group}${v.look.requires !== 'any' ? ` · needs a ${v.look.requires === 'digital-raw' ? 'digital RAW' : 'film scan'}` : ''}` })));
  if (v.look.notes) el.append(h('div', { class: 'cb-dim', text: v.look.notes }));
  for (const p of v.params ?? []) {
    const row = h('label', { class: 'cb-looks-param', 'data-param': p.name });
    if (p.spec.type === 'enum') {
      const sel = h('select', { 'aria-label': p.spec.label }) as HTMLSelectElement;
      for (const x of p.spec.values ?? []) sel.append(h('option', { value: x, text: x, ...(x === p.value ? { selected: true } : {}) }));
      listen(m.scope, sel, 'change', () => void m.rt.runCommand('looks.param', null, p.name, sel.value));
      row.append(h('span', { text: p.spec.label }), sel);
    } else {
      const out = h('span', { class: 'cb-looks-value', text: fmtParam(Number(p.value), p.spec.unit) });
      const input = h('input', { type: 'range', min: String(p.spec.min ?? 0), max: String(p.spec.max ?? 1), step: String(p.spec.step ?? 'any'), value: String(p.value), 'aria-label': p.spec.label }) as HTMLInputElement;
      listen(m.scope, input, 'input', () => void (out.textContent = fmtParam(Number(input.value), p.spec.unit)));
      listen(m.scope, input, 'change', () => void m.rt.runCommand('looks.param', null, p.name, Number(input.value)));
      row.append(h('span', { text: p.spec.label }), input, out);
    }
    el.append(row);
  }
  const prev = btn(v.preview ? 'Previewing' : 'Preview', v.preview ? 'is-active' : '', { id: 'looks-preview' });
  run(m, prev, 'looks.preview');
  const surv = btn(v.inSurvey ? 'In survey' : 'Add to survey', '', { id: 'looks-survey-add' });
  run(m, surv, 'looks.survey.toggle', v.look.id);
  const fav = btn(v.favourite ? '★' : '☆', '', { 'aria-label': 'Favourite' });
  run(m, fav, 'looks.favourite', v.look.id);
  el.append(h('div', { class: 'cb-looks-actions' }, prev, surv, fav));
});

const amount = form('cb-looks-amount', (el, v, m) => {
  const pct = h('strong', { class: 'cb-looks-pct', id: 'looks-pct', text: `${v.pct} %` });
  const input = h('input', { type: 'range', min: String(v.range[0]), max: String(v.range[1]), step: '5', value: String(v.pct), 'aria-label': 'Amount', id: 'looks-amount' }) as HTMLInputElement;
  listen(m.scope, input, 'input', () => void (pct.textContent = `${input.value} %`));
  listen(m.scope, input, 'change', () => void m.rt.runCommand('looks.amount', null, Number(input.value)));
  el.append(h('label', { class: 'cb-looks-amount-row' }, 'Amount ', input, ' ', pct));
  if (!v.look) return void el.append(empty('Pick a look to set its Amount'));
  const res = h('div', { class: 'cb-looks-result', id: 'looks-result' });
  if (v.skipped) res.append(h('div', { class: 'cb-warn', text: v.skipped }));
  else if (v.result && !v.result.length) res.append(h('div', { class: 'cb-dim', text: `${v.look}: no change on ${v.frame}` }));
  else for (const line of v.result ?? []) res.append(h('div', { text: line }));
  for (const w of v.warnings) res.append(h('div', { class: 'cb-warn', text: w }));
  el.append(res);
  const a = btn(v.selected > 1 ? `Apply to ${v.selected} frames` : 'Apply', 'is-primary', { id: 'looks-apply' });
  run(m, a, 'looks.apply');
  const r = btn(`Roll’s unedited frames…`, '', { id: 'looks-apply-roll', ...(v.roll ? {} : { disabled: true, title: 'Make a roll first' }) });
  run(m, r, 'looks.applyToRoll');
  const lib = btn(`Library (${v.library})…`, '', { id: 'looks-apply-library' });
  run(m, lib, 'looks.applyToLibrary');
  el.append(h('div', { class: 'cb-looks-actions' }, a, r, lib));
  // the frame's looks: one Amount each (over every stage the look touches), bake into plain layers, remove
  if (v.applied?.length) {
    const ul = h('ul', { class: 'cb-looks-applied', id: 'looks-applied' });
    for (const x of v.applied) {
      const pctOut = h('span', { class: 'cb-looks-value', text: `${x.pct} %` });
      const range = h('input', { type: 'range', min: '0', max: x.stages.includes('darkroom') ? '200' : '100', step: '5', value: String(x.pct), 'aria-label': `${x.name} amount` }) as HTMLInputElement;
      listen(m.scope, range, 'input', () => void (pctOut.textContent = `${range.value} %`));
      listen(m.scope, range, 'change', () => void m.rt.runCommand('looks.setAmount', null, x.key, Number(range.value)));
      const bake = btn('Bake', '', { 'aria-label': `Bake ${x.name}`, title: 'Keep the look as plain layers (detached from the look)' });
      run(m, bake, 'looks.bake', x.key);
      const del = btn('Remove', 'reject', { 'aria-label': `Remove ${x.name}` });
      run(m, del, 'looks.remove', x.key);
      ul.append(h('li', { 'data-look': x.key }, h('strong', { text: x.name }), h('span', { class: 'cb-dim', text: ` · ${x.stages.join(' + ')}` }), h('label', { class: 'cb-looks-amount-row' }, range, ' ', pctOut), h('div', { class: 'cb-looks-actions' }, bake, del)));
    }
    el.append(h('div', { class: 'cb-dim', text: 'On this frame' }), ul);
  }
});

const diffForm = form('cb-looks-diff', (el, v) => {
  if (!v.entries.length) return void el.append(empty(`No change against ${v.against}`));
  el.append(h('div', { class: 'cb-dim', text: `${v.previewing ? 'with the previewed look, ' : ''}against ${v.against}` }));
  const by = new Map<string, string[]>();
  for (const e of v.entries) by.set(e.group, [...(by.get(e.group) ?? []), e.shown]);
  const ul = h('ul', { class: 'cb-looks-diff-list', id: 'looks-diff' });
  for (const [g, lines] of by) ul.append(h('li', {}, h('span', { class: 'cb-looks-group', text: g }), ...lines.map((t) => h('div', { text: t }))));
  el.append(ul);
});

const compare = form('cb-looks-compare', (el, v, m) => {
  const sel = h('select', { 'aria-label': 'Compare with', id: 'looks-compare' }) as HTMLSelectElement;
  for (const o of v.options) sel.append(h('option', { value: o.key, text: o.label, ...(o.key === v.current ? { selected: true } : {}) }));
  listen(m.scope, sel, 'change', () => {
    const o = v.options.find((x: any) => x.key === sel.value);
    if (o) void m.rt.runCommand('looks.compare', null, o.src);
  });
  const ref = btn('Use this frame as reference', '', { id: 'looks-reference' });
  run(m, ref, 'looks.setReference');
  const snap = btn('Snapshot', '', { id: 'looks-snapshot' });
  run(m, snap, 'looks.snapshot');
  el.append(sel, h('div', { class: 'cb-looks-actions' }, ref, snap), h('div', { class: 'cb-dim', text: 'Before / after: \\ in the print module' }));
});

const card = form('cb-looks-card', (el, v, m) => {
  if (!v.pending && !v.batches.length) return void el.append(empty('No planned or proposed looks'));
  if (v.pending) {
    const p = v.pending;
    const on = p.frames.filter((f: any) => f.on).length;
    const c = h('div', { class: 'cb-card cb-looks-pending', id: 'looks-pending', 'data-batch': p.id },
      h('div', { class: 'cb-card-h' }, h('strong', { text: p.label }), ` · ${on} frame${on === 1 ? '' : 's'}`),
      h('div', { class: 'cb-dim', text: p.aggregate.length ? p.aggregate.join('; ') : 'no change' }));
    const list = h('div', { class: 'cb-changes' });
    for (const f of p.frames) {
      const box = h('input', { type: 'checkbox', 'aria-label': `Include ${f.name}` }) as HTMLInputElement;
      box.checked = f.on;
      listen(m.scope, box, 'change', () => void m.rt.runCommand('looks.pending.toggle', null, f.frame));
      list.append(h('div', { class: 'cb-change' }, h('label', {}, box, ` ${f.name}${f.warnings.length ? ` (${f.warnings.join(', ')})` : ''}`)));
    }
    c.append(list);
    if (p.skipped.length) c.append(h('div', { class: 'cb-dim', id: 'looks-skipped', text: `${p.skipped.length} skipped: ${p.skipped.map((x: any) => `${x.name} (${x.why})`).join(', ')}` }));
    if (p.stale.length) c.append(h('div', { class: 'cb-warn', id: 'looks-stale', text: p.stale.join('; ') }));
    const ok = btn(p.stale.length ? 'Apply anyway' : `Apply to ${on}`, 'is-primary approve', { id: 'looks-pending-approve' });
    run(m, ok, 'looks.pending.approve', p.stale.length > 0);
    const no = btn('Cancel', 'reject', { id: 'looks-pending-reject' });
    run(m, no, 'looks.pending.reject');
    c.append(h('div', { class: 'cb-looks-actions' }, ok, no));
    el.append(c);
  }
  for (const b of v.batches) {
    const on = b.frames.filter((f: any) => f.on).length;
    const c = h('div', { class: 'cb-card cb-looks-batch', 'data-batch': b.batch },
      h('div', { class: 'cb-card-h' }, h('strong', { text: `Agent: ${b.why}` }), ` · ${b.frames.length} frame${b.frames.length === 1 ? '' : 's'}`),
      h('div', { class: 'cb-dim', text: b.aggregate.join('; ') || 'no change' }));
    const list = h('div', { class: 'cb-changes' });
    for (const f of b.frames) {
      const box = h('input', { type: 'checkbox', 'aria-label': `Include ${f.name}` }) as HTMLInputElement;
      box.checked = f.on;
      listen(m.scope, box, 'change', () => void m.rt.runCommand('looks.batch.toggle', null, b.batch, f.frame));
      list.append(h('div', { class: 'cb-change' }, h('label', {}, box, ` ${f.name}`)));
    }
    c.append(list);
    const acts = h('div', { class: 'cb-looks-actions' });
    if (b.stale.length) {
      c.append(h('div', { class: 'cb-warn cb-looks-batch-stale', text: `${b.stale.length} changed since this was proposed: ${b.stale.join('; ')}` }));
      const anyway = btn('Apply anyway', 'is-primary approve', {});
      run(m, anyway, 'looks.batch.approve', b.batch, true);
      const skip = btn('Skip those', 'reject', {});
      run(m, skip, 'looks.batch.reject', b.batch, true);
      acts.append(anyway, skip);
    } else {
      const ok = btn(`Approve ${on}`, 'is-primary approve', {});
      run(m, ok, 'looks.batch.approve', b.batch, false);
      const no = btn('Reject', 'reject', {});
      run(m, no, 'looks.batch.reject', b.batch, false);
      acts.append(ok, no);
    }
    c.append(acts, h('div', { class: 'cb-dim', text: 'Review per frame: Agent proposals' }));
    el.append(c);
  }
});

const groups = form('cb-looks-groups', (el, v, m) => {
  for (const g of v.all) {
    const box = h('input', { type: 'checkbox', 'aria-label': g.name }) as HTMLInputElement;
    box.checked = v.chosen.includes(g.name);
    listen(m.scope, box, 'change', () => void m.rt.runCommand('looks.syncGroup', null, g.name));
    el.append(h('label', { class: 'cb-looks-groupbox', 'data-group': g.name }, box, ` ${g.name}`, g.note ? h('span', { class: 'cb-dim', text: ` (${g.note})` }) : null));
  }
  // sync by copy (values: each frame on its own afterwards) or by link (one preset: the frames stay together)
  const mode = h('div', { class: 'cb-looks-syncmode', role: 'radiogroup', 'aria-label': 'Sync by' });
  for (const [x, label] of [['copy', 'Copy values'], ['link', 'Link (stay together)']] as const) {
    const b = h('input', { type: 'radio', name: 'looks-sync-mode', value: x, 'aria-label': label, ...(v.mode === x ? { checked: true } : {}) }) as HTMLInputElement;
    listen(m.scope, b, 'change', () => void m.rt.runCommand('looks.syncMode', null, x));
    mode.append(h('label', {}, b, ` ${label}`));
  }
  const copy = btn('Copy', '', { id: 'looks-copy' });
  run(m, copy, 'looks.copy');
  const paste = btn('Paste', '', { id: 'looks-paste' });
  run(m, paste, 'looks.paste');
  const sync = btn(v.mode === 'link' ? 'Link selection' : 'Sync to selection', '', { id: 'looks-sync' });
  run(m, sync, 'looks.sync');
  el.append(mode, h('div', { class: 'cb-dim', id: 'looks-sync-says', text: v.mode === 'link' ? 'The selected frames will link one preset made from this frame’s layers: a change to it reaches all of them.' : 'The selected frames get copies of this frame’s values and looks: each is on its own afterwards.' }), h('div', { class: 'cb-looks-actions' }, copy, paste, sync));
  if (v.clipboard) el.append(h('div', { class: 'cb-dim', id: 'looks-clipboard', text: `Copied from ${v.clipboard.from}: ${v.clipboard.lines.join(', ') || 'nothing'}` }));
});

const presets = form('cb-looks-presets', (el, v, m) => {
  const save = btn('Save frame as preset', '', { id: 'looks-save-preset', ...(v.frame ? {} : { disabled: true }) });
  run(m, save, 'looks.saveAsPreset');
  const bake = btn('Save look as preset', '', { id: 'looks-save-look' });
  run(m, bake, 'looks.saveLookAsPreset');
  el.append(h('div', { class: 'cb-looks-actions' }, save, bake));
  if (!v.presets.length) return void el.append(empty('No presets of your own yet'));
  const ul = h('ul', { class: 'cb-looks-presets', id: 'looks-presets' });
  for (const p of v.presets) {
    const del = btn('Delete', 'reject', { 'aria-label': `Delete ${p.name}` });
    run(m, del, 'looks.deletePreset', p.id);
    const exp = btn('Export', '', { 'aria-label': `Export ${p.name}` });
    listen(m.scope, exp, 'click', async () => {
      const text = (await m.rt.runCommand('looks.exportPreset', null, p.id)) as string | null;
      if (!text || typeof document === 'undefined') return;
      const a = document.createElement('a');
      a.download = `${p.id}.cbpreset.json`;
      a.href = `data:application/json;charset=utf-8,${encodeURIComponent(text)}`;
      a.click();
    });
    ul.append(h('li', { 'data-preset': p.id }, h('strong', { text: p.name }), h('span', { class: 'cb-dim', text: ` · ${p.entries} entries` }), p.review.length ? h('div', { class: 'cb-warn', text: `needs review: ${p.review.join('; ')}` }) : null, h('div', { class: 'cb-looks-actions' }, exp, del)));
  }
  el.append(ul);
});

export const LOOKS_RENDERERS: Record<string, Renderer> = {
  'looks.params': params,
  'looks.amount': amount,
  'looks.diff': diffForm,
  'looks.compare': compare,
  'looks.card': card,
  'looks.groups': groups,
  'looks.presets': presets,
};
