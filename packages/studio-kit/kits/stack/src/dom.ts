// The DOM half of the stack kit: the one row, the one amount control, the one mask chip and the one provenance chip,
// and the panels built from them (a stage's stack, the selected entry's parameters, its mask). A renderer reads the
// store through cells and writes through commands (structure) or the store's gesture (a drag previews and commits
// one step on release), so everything is a step of the log and an action of the palette.
//
//   mountStudio(app, el, studio)   // CB_RENDERERS includes STACK_RENDERERS: every layout has the stack kit
/* eslint-disable @typescript-eslint/no-explicit-any */
import { clear, h, listen, type MountCtx, type Renderer } from '@chromobench/shell/dom';
import { makeNode, type NodeData } from '@chromobench/shell';
import { Coll, type Id, type Why } from '@chromobench/values';
import { getOp, type ArgSpec, type Document, type Entry, type MaskCombine, type MaskComponent, type StageName } from '@chromobench/contract';
import { DOCS, entryName, findEntry, storePath, type Placed } from '../../../src/model/doc.ts';
import { argModel } from '../../../src/kit/args.ts';
import { renderArg } from '../../../src/dom/arg.ts';
import { WHO } from '../../../src/model/history.ts';
import { sel } from '../../../src/sel.ts';
import {
  amountHint, amountTrack, blendChoices, blendWord, COMBINE_WORDS, combines, componentKinds, entryDetail, formatAmount, HINT_WORDS, KIND_WORDS, kindBadge, kindSummary, lawOf,
  linkWords, maskOf, maskUsers, opWord, provenance, readsChoices, rowsOf, addableOps, addMenu, type StackRow,
} from './model.ts';
import { selectedIn } from './state.ts';
import { COLOUR_WORDS, coverageMasks, MODE_WORDS, OVERLAY_COLOURS, OVERLAY_MODES, overlayOf, overlayReason, type OverlayMode } from './overlay.ts';
import { btn, frameOf, numAt, numberControl, parsePercent, peekDoc, readPath, run, words } from './controls/dom.ts';
import { EDITOR_RENDERERS } from './editors/dom.ts';
import { EDITOR_FORMS, mathOf, oklabCss, type Editors } from './editors.ts';

/** The one amount control: the law's range and unit hint ("Amount · opacity"). */
function amountControl(m: MountCtx, frame: (s: any) => string | null, id: Id, stage: StageName, e: Pick<Entry, 'kind'> & { op?: string }, o: { compact?: boolean } = {}): HTMLElement {
  const tr = amountTrack(stage);
  const hint = amountHint(stage, e);
  return numberControl(m, {
    ...(e.kind === 'link' ? { commit: (v: number) => void run(m, 'layer.amount', id, v) } : {}),
    label: o.compact ? '' : 'Amount', path: `${id}.amount`, frame, min: tr.min, max: tr.max, hard: tr.hard, step: tr.step, show: formatAmount, parse: parsePercent,
    stepLabel: `${findName(m, frame, id)} amount`, cls: ['cb-stack-amount', o.compact && 'is-compact'].filter(Boolean).join(' '),
    tip: `Amount: ${HINT_WORDS[hint]}${lawOf(stage)?.amount === 'scale' ? ` (up to ${formatAmount(tr.hard[1])} typed)` : ''}`,
    read: (s) => {
      const f = frame(s);
      const d = f ? sel.doc(s, f) : undefined;
      return d ? (findEntry(d, id)?.entry.amount ?? undefined) : undefined;
    },
  });
}
const entryNameOf = (e: Placed['entry'] | undefined): string => (e ? entryName(e) : '');
const findName = (m: MountCtx, frame: (s: any) => string | null, id: Id): string => {
  const f = frame(m.store.readonly());
  const d = f ? peekDoc(m, f) : undefined;
  const e = d ? findEntry(d, id)?.entry : undefined;
  return e ? entryName(e) : id;
};

// ── the one mask chip and the one provenance chip ──

function maskChip(m: MountCtx, frame: (s: any) => string | null, id: Id): HTMLElement {
  const chip = h('button', { type: 'button', class: 'cb-stack-chip cb-stack-mask' });
  listen(m.scope, chip, 'click', (ev: MouseEvent) => {
    ev.stopPropagation();
    run(m, 'layer.select', id);
    const f = frame(m.store.readonly());
    const d = f ? peekDoc(m, f) : undefined;
    if (d && findEntry(d, id)?.entry.mask && (ev.altKey || ev.shiftKey)) {
      // as on a mask thumbnail in Photoshop: Alt shows the mask alone, Shift its overlay (again: off)
      const o = overlayOf(m.store.readonly());
      const mode: OverlayMode = ev.altKey ? 'mask' : 'tint';
      if (o.on && o.mode === mode) run(m, 'mask.overlay.toggle', false);
      else run(m, 'mask.overlay.mode', mode);
      return;
    }
    if (d && findEntry(d, id)?.entry.mask) {
      // the masks panel shows it: bring it into view
      const p = (chip.ownerDocument as globalThis.Document).querySelector('.cb-stack-masks');
      (p as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest' });
      return;
    }
    const r = chip.getBoundingClientRect();
    const lib = d ? Coll.entries(d.masks) : [];
    m.rt.chrome.contextMenu(r.left, r.bottom + 2, [
      ...componentKinds().map((k) => ({ label: `New mask: ${KIND_WORDS[k] ?? k}`, run: ['mask.new', k, id] })),
      ...(lib.length ? ['-' as const, ...lib.map(([mid, mk]) => ({ label: `Use ${mk.name}`, run: ['mask.attach', mid, id] }))] : []),
    ] as any);
  });
  m.cell((s) => {
    const f = frame(s);
    const d = f ? sel.doc(s, f) : undefined;
    const mid = d ? findEntry(d, id)?.entry.mask : null;
    const mk = d && mid ? Coll.get(d.masks, mid) : undefined;
    // the overlay shows this entry's mask now: the chip says so
    const shown = !!mid && !!overlayReason(s) && selectedIn(s, f) === id;
    return mid ? `${shown ? '1' : '0'}${mk?.name ?? mid}${mk?.invert ? ' (inverted)' : ''}` : '';
  }, (v) => {
    const name = v.slice(1);
    chip.classList.toggle('is-overlay', v[0] === '1');
    chip.textContent = name ? `◐ ${name}` : '+ mask';
    chip.classList.toggle('is-empty', !name);
    chip.setAttribute('aria-label', name ? `Mask ${name}` : 'Add a mask');
    chip.dataset['tip'] = name ? `Through the mask ${name}: click to edit it in the mask panel; Shift-click shows where it acts on the picture, Alt-click the mask alone (O: the overlay)` : 'No mask: click to draw one or use one of the library';
  });
  return chip;
}

/** who last changed the entry (the log's why), and in the tooltip who made it and the last change */
function provChip(m: MountCtx, frame: (s: any) => string | null, id: Id): HTMLElement {
  const chip = h('span', { class: 'cb-stack-chip cb-stack-prov' });
  m.cell((s) => {
    const f = frame(s);
    const log = m.rt.store.log;
    if (!f || !log.has(f)) return null;
    void sel.logVersion(s);
    const d = sel.doc(s, f);
    const e = d ? findEntry(d, id)?.entry : undefined;
    return { w: provenance(log, f).get(id) ?? null, made: e?.source ?? null };
  }, (v) => {
    if (!v || !v.w) {
      chip.hidden = true;
      return;
    }
    chip.hidden = false;
    const w = v.w as Why;
    const made = v.made ? String(v.made['kind']) : 'user';
    const by = w.seq === 0 ? (made === 'user' ? 'You' : madeWord(made, v.made)) : WHO[w.by];
    chip.textContent = by;
    chip.className = `cb-stack-chip cb-stack-prov is-${w.seq === 0 ? (made === 'user' ? 'user' : 'auto') : w.by}`;
    chip.dataset['tip'] = [`Made by ${madeWord(made, v.made)}`, w.seq ? `last changed by ${WHO[w.by]}: ${w.label}${w.approvedBy ? ' (approved)' : ''}` : 'not changed since'].join(' · ');
  }, { equals: (a: any, b: any) => a === b || (!!a && !!b && a.w === b.w && a.made === b.made) });
  return chip;
}
const madeWord = (kind: string, src: Record<string, unknown> | null): string => {
  if (kind === 'user') return 'You';
  if (kind === 'agent') return 'Agent';
  if (kind === 'auto') return `Auto${src?.['by'] ? ` (${String(src['by'])})` : ''}`;
  return kind.charAt(0).toUpperCase() + kind.slice(1);
};

// ── the one row ──

interface RowView {
  el: HTMLElement;
  key: string;
  dispose(): void;
}
/** the standard row of an entry: on/off, twisty, name and what it does, amount, blend, mask chip, provenance chip */
function drawRow(m: MountCtx, frame: (s: any) => string | null, r: Pick<StackRow, 'id' | 'stage'> & Partial<StackRow>, o: { density?: string } = {}): HTMLElement {
  const id = r.id;
  const compact = o.density === 'compact';
  const el = h('div', { class: ['cb-stack-row', compact && 'is-compact', r.kind === 'group' && 'is-group'], 'data-id': id, 'data-stage': r.stage, role: 'option', draggable: 'true' });
  if (r.depth) el.style.setProperty('--depth', String(r.depth));
  const on = h('input', { type: 'checkbox', class: 'cb-stack-on', 'aria-label': `${id} on` }) as HTMLInputElement;
  listen(m.scope, on, 'change', () => run(m, 'layer.toggle', id));
  const tw = h('button', { type: 'button', class: 'cb-stack-tw', 'aria-label': `Open or close ${id}`, hidden: r.kind !== 'group' });
  listen(m.scope, tw, 'click', (e: MouseEvent) => {
    e.stopPropagation();
    run(m, 'layer.collapse', id);
  });
  const name = h('span', { class: 'cb-stack-name' });
  // D5 (CHB-046): a darkroom row says its kind (Burn, Dodge, Flash, …) whatever he named it
  const badge = h('span', { class: 'cb-stack-kind', hidden: r.stage !== 'darkroom' });
  const detail = h('span', { class: 'cb-stack-detail' });
  const text = h('div', { class: 'cb-stack-text' }, h('span', { class: 'cb-stack-title' }, name, badge), detail);
  listen(m.scope, name, 'dblclick', (e: MouseEvent) => {
    e.stopPropagation();
    rename(m, name, id);
  });
  const blend = h('select', { class: 'cb-stack-blend', 'aria-label': `${id} blend` }) as HTMLSelectElement;
  listen(m.scope, blend, 'change', () => run(m, 'layer.blend', id, blend.value));
  const kind = r.kind ?? 'layer';
  const choices = blendChoices(r.stage, kind);
  for (const b of choices) blend.append(h('option', { value: b, text: blendWord(b) }));
  blend.hidden = choices.length < 2;
  const amount = amountControl(m, frame, id, r.stage, { kind, ...(r.op ? { op: r.op } : {}) }, { compact: true });
  const chips = h('div', { class: 'cb-stack-chips' }, maskChip(m, frame, id), provChip(m, frame, id));
  // a link (a look, a preset, a roll's stack) is one row: its Amount, Bake into plain layers, Remove
  const linkCmds: HTMLElement[] = [];
  if (kind === 'link') {
    blend.hidden = true;
    for (const [label, cmd] of [['Bake', 'link.bake'], ['Remove', 'link.remove']] as const) {
      const b = btn(label, `cb-stack-${cmd.replace('.', '-')}`, { 'aria-label': `${label} ${id}` });
      listen(m.scope, b, 'click', (e: MouseEvent) => {
        e.stopPropagation();
        run(m, cmd, id);
      });
      linkCmds.push(b);
    }
  }
  el.append(h('div', { class: 'cb-stack-line' }, on, tw, text, chips), h('div', { class: 'cb-stack-line is-controls' }, amount, blend, ...linkCmds));
  if (kind === 'link') el.classList.add('is-link');
  // selection: a click on the row (not on its controls)
  listen(m.scope, el, 'pointerdown', (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('input,button,select,textarea')) return;
    run(m, 'layer.select', id);
  });
  dnd(m, el, id, kind === 'group');
  m.cell((s) => {
    const f = frame(s);
    const d = f ? sel.doc(s, f) : undefined;
    const p = d ? findEntry(d, id) : undefined;
    return { p, d, sel: selectedIn(s, f) === id, collapsed: !!s.stack?.collapsed?.[id] };
  }, (v) => {
    const p = v.p as Placed | undefined;
    if (!p || !v.d) return;
    const e = p.entry;
    on.checked = e.enabled;
    on.disabled = e.kind === 'layer' && getOp(e.op).term === 'main';
    el.classList.toggle('is-off', !e.enabled);
    el.classList.toggle('is-sel', v.sel);
    el.setAttribute('aria-selected', v.sel ? 'true' : 'false');
    name.textContent = entryName(e);
    badge.textContent = r.stage === 'darkroom' ? (id === 'lights' ? 'Printer lights' : kindBadge(e)) : '';
    badge.hidden = r.stage !== 'darkroom' || badge.textContent === name.textContent;
    detail.textContent = entryDetail(v.d, p);
    blend.value = e.blend;
    tw.textContent = v.collapsed ? '▸' : '▾';
  }, { equals: (a: any, b: any) => a.p?.entry === b.p?.entry && a.sel === b.sel && a.collapsed === b.collapsed && a.p?.parent === b.p?.parent });
  return el;
}

function rename(m: MountCtx, name: HTMLElement, id: Id): void {
  const input = h('input', { type: 'text', class: 'cb-stack-rename', value: name.textContent ?? '', 'aria-label': `Rename ${id}` }) as HTMLInputElement;
  name.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const end = (ok: boolean): void => {
    if (done) return;
    done = true;
    input.replaceWith(name);
    if (ok && input.value.trim() && input.value.trim() !== name.textContent) run(m, 'layer.rename', id, input.value.trim());
  };
  listen(m.scope, input, 'keydown', (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') end(true);
    else if (e.key === 'Escape') end(false);
  });
  listen(m.scope, input, 'blur', () => end(true));
}

/** drag a row: onto the upper or lower part of another row (before, after), or onto the middle of a group (into it) */
let dragged: Id | null = null;
function dnd(m: MountCtx, el: HTMLElement, id: Id, isGroup: boolean): void {
  const where = (e: DragEvent): 'before' | 'after' | 'into' => {
    const r = el.getBoundingClientRect();
    const y = (e.clientY - r.top) / Math.max(1, r.height);
    if (isGroup && y > 0.25 && y < 0.75) return 'into';
    return y < 0.5 ? 'before' : 'after';
  };
  const unmark = (): void => el.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-into');
  listen(m.scope, el, 'dragstart', (e: DragEvent) => {
    if ((e.target as HTMLElement).closest?.('input,select')) return;
    dragged = id;
    e.dataTransfer?.setData('application/x-cb-entry', id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    el.classList.add('is-dragging');
  });
  listen(m.scope, el, 'dragend', () => {
    dragged = null;
    el.classList.remove('is-dragging');
  });
  listen(m.scope, el, 'dragover', (e: DragEvent) => {
    if (!dragged || dragged === id) return;
    e.preventDefault();
    unmark();
    el.classList.add(`is-drop-${where(e)}`);
  });
  listen(m.scope, el, 'dragleave', unmark);
  listen(m.scope, el, 'drop', (e: DragEvent) => {
    unmark();
    const from = dragged ?? e.dataTransfer?.getData('application/x-cb-entry');
    if (!from || from === id) return;
    e.preventDefault();
    run(m, 'layer.move', from, id, where(e));
  });
}

// ── a stage's stack ──

const LAW_WORDS: Record<string, string> = {
  light: 'Light on the paper: amounts scale time and density; the order does not change the print.',
  composite: 'Applied from the top down; amount is opacity.',
  repair: 'Applied from the top down, each spot replacing pixels; amount is opacity.',
};

const NO_FRAME = 'Select a photo to print it.';
const NO_PHOTOS = 'No photos yet: File ▸ Open Files… (Ctrl+O), or drop them here.';

const layers: Renderer = (n, m) => {
  const p = n.props as Record<string, any>;
  const stage = p['stage'] as StageName;
  const frame = (s: any) => frameOf(n, s);
  const el = h('div', { class: ['cb-panel cb-stack', p['density'] === 'compact' && 'is-compact'], 'data-stage': stage, tabindex: '0', role: 'listbox', 'aria-label': `${stage} stack` });
  const law = lawOf(stage);
  const caption = h('p', { class: 'cb-stack-law cb-dim', text: law ? LAW_WORDS[law.name] ?? '' : '' });
  const list = h('div', { class: 'cb-stack-rows' });
  const empty = h('p', { class: 'cb-empty' });
  const foot = h('div', { class: 'cb-stack-foot' });
  if (p['add'] !== false && addableOps(stage).length) {
    const add = btn('+ Layer', 'cb-stack-add', { 'aria-label': `Add a layer to the ${stage} stage` });
    listen(m.scope, add, 'click', () => {
      const r = add.getBoundingClientRect();
      m.rt.chrome.contextMenu(r.left, r.bottom + 2, addMenu(stage, Array.isArray(p['add']) ? p['add'] : undefined) as any);
    });
    foot.append(add);
  }
  // D5 (CHB-046): 'choice' lists his order unless he asks for the darkroom by kind; a one-line summary by kind stays
  const orderOf = (s: any): 'stack' | 'kind' => (p['order'] === 'choice' ? (s?.stack?.darkroomOrder === 'kind' ? 'kind' : 'stack') : (p['order'] ?? 'stack'));
  if (p['order'] === 'choice') {
    const summary = h('p', { class: 'cb-stack-kinds cb-dim' });
    const byKind = btn('By kind', 'cb-stack-bykind', { 'aria-pressed': 'false', 'data-tip': 'List the darkroom by kind (a view: the print is the same in any order)' });
    listen(m.scope, byKind, 'click', () => run(m, 'stack.byKind'));
    m.cell((s: any) => {
      const f = frameOf(n, s);
      const d = f ? sel.doc(s, f) : undefined;
      return { text: kindSummary(d, stage), on: s?.stack?.darkroomOrder === 'kind' };
    }, (v) => {
      summary.textContent = v.text;
      summary.hidden = !v.text;
      byKind.setAttribute('aria-pressed', v.on ? 'true' : 'false');
      byKind.classList.toggle('is-on', v.on);
    }, { equals: (a: any, b: any) => a.text === b.text && a.on === b.on });
    foot.append(byKind);
    el.append(caption, summary, list, empty, foot);
  } else el.append(caption, list, empty, foot);
  const views = new Map<Id, RowView>();
  const rowFn = p['row'] as ((r: StackRow) => unknown) | undefined;
  const mountRow = (r: StackRow): RowView => {
    const rm = m.child('row', { item: r });
    let rel: HTMLElement;
    if (rowFn) {
      const node = rm.mount(rowFn(r));
      rel = h('div', { class: 'cb-stack-cell', 'data-id': r.id }, ...(node ? [node] : []));
    } else rel = h('div', { class: 'cb-stack-cell', 'data-id': r.id }, drawRow(rm, frame, r, { density: p['density'] }));
    if (r.depth) rel.style.setProperty('--depth', String(r.depth));
    return { el: rel, key: r.key, dispose: () => rm.scope.dispose() };
  };
  m.cell((s) => {
    const f = frame(s);
    const d = f ? sel.doc(s, f) : undefined;
    const has = !!d?.stages[stage];
    const rows = rowsOf(d, stage, { order: orderOf(s), filter: p['filter'] ?? null, collapsed: s.stack?.collapsed ?? {} });
    const library = sel.library(s).length > 0;
    return { f, has, rows, open: !!d, library, key: `${f}|${!!d}|${library}|${has}|${rows.map((r) => `${r.key}|${r.collapsed}|${r.kids}`).join(',')}` };
  }, (v) => {
    const keep = new Set<Id>();
    const order: HTMLElement[] = [];
    for (const r of v.rows) {
      let rv = views.get(r.id);
      if (rv && rv.key !== r.key) {
        rv.dispose();
        rv.el.remove();
        views.delete(r.id);
        rv = undefined;
      }
      if (!rv) {
        rv = mountRow(r);
        views.set(r.id, rv);
      }
      keep.add(r.id);
      order.push(rv.el);
    }
    for (const [id, rv] of views) if (!keep.has(id)) {
      rv.dispose();
      rv.el.remove();
      views.delete(id);
    }
    // put the rows in order (moving a node keeps its state)
    order.forEach((x, i) => {
      if (list.children[i] !== x) list.insertBefore(x, list.children[i] ?? null);
    });
    empty.hidden = v.rows.length > 0;
    // no frame: what to do (CHB-031 F19, 8iv8); a frame without this stage: say so
    empty.textContent = !v.f || !v.open ? (v.library ? NO_FRAME : NO_PHOTOS) : !v.has ? (p['empty'] ?? `This frame has no ${stage} stage.`) : 'No layers yet: + Layer adds one.';
    foot.hidden = !v.has;
    caption.hidden = !v.has;
  }, { equals: (a: any, b: any) => a.key === b.key });
  // keys while the panel has the focus: arrows move the selection, Delete deletes
  listen(m.scope, el, 'keydown', (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).matches?.('input,textarea,select')) return;
    const s = m.store.readonly();
    const f = frame(s);
    const d = f ? sel.doc(s, f) : undefined;
    const rows = rowsOf(d, stage, { order: orderOf(s), filter: p['filter'] ?? null, collapsed: (s as any).stack?.collapsed ?? {} });
    const cur = rows.findIndex((r) => r.id === selectedIn(s, f));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const next = rows[Math.max(0, Math.min(rows.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) run(m, 'layer.select', next.id);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && cur >= 0) {
      e.preventDefault();
      e.stopPropagation();
      run(m, 'layer.delete', rows[cur]!.id);
    }
  });
  return el;
};

const row: Renderer = (n, m) => {
  const frame = (s: any) => frameOf(n, s);
  const id = String(n.props['entry']);
  const f = frame(m.store.readonly());
  const p = f ? findEntry(peekDoc(m, f) ?? ({ stages: {} } as Document), id) : undefined;
  const e = p?.entry;
  return drawRow(m, frame, { id, stage: n.props['stage'] as StageName, kind: e?.kind ?? 'layer', op: e?.kind === 'layer' ? e.op : null, depth: p?.depth ?? 0 }, { density: n.props['density'] as string });
};

// ── the selected entry's parameters ──

/** a control for an argument without ui hints: numbers with a range, enums; geometry is drawn with the tools */
function specControl(m: MountCtx, frame: (s: any) => string | null, path: string, arg: string, spec: ArgSpec): HTMLElement | null {
  if (spec.type === 'number' && spec.min !== undefined && spec.max !== undefined) {
    const step = spec.integer ? 1 : Number(((spec.max - spec.min) / 100).toPrecision(2));
    const dec = Math.max(0, Math.min(3, -Math.floor(Math.log10(step))));
    return numberControl(m, {
      label: spec.ui?.label ?? words(arg), path, frame, min: spec.usual?.[0] ?? spec.min, max: spec.usual?.[1] ?? spec.max, hard: [spec.min, spec.max], step,
      show: (v) => `${v.toFixed(dec)}${spec.unit && spec.unit !== 'none' && spec.unit !== 'fraction' ? ` ${spec.unit}` : ''}`, stepLabel: spec.ui?.label ?? words(arg), tip: spec.doc,
      read: (s) => {
        const f = frame(s);
        const d = f ? sel.doc(s, f) : undefined;
        const v = d ? readPath(d, path) : undefined;
        return typeof v === 'number' ? v : v === undefined && d && spec.default !== undefined && typeof spec.default === 'number' ? spec.default : undefined;
      },
    });
  }
  if (spec.type === 'enum' && spec.values) {
    const s = h('select', { class: 'cb-select', 'aria-label': words(arg) }) as HTMLSelectElement;
    for (const v of spec.values) s.append(h('option', { value: v, text: v }));
    listen(m.scope, s, 'change', () => {
      const f = frame(m.store.readonly());
      const d = f ? peekDoc(m, f) : undefined;
      if (f && d) m.rctx().tx(`${words(arg)} ${s.value}`, (t: any) => t.$set(storePath(f, d, path), s.value));
    });
    m.cell((st) => {
      const f = frame(st);
      const d = f ? sel.doc(st, f) : undefined;
      return d ? (readPath(d, path) ?? spec.default) : undefined;
    }, (v) => void (s.value = String(v ?? '')));
    return h('div', { class: 'cb-stack-num', 'data-path': path }, h('span', { class: 'cb-stack-num-l', text: spec.ui?.label ?? words(arg) }), s);
  }
  return null;
}
const isAdvanced = (spec: ArgSpec): boolean => !!(spec.ui as { advanced?: boolean } | undefined)?.advanced || !!(spec as { advanced?: boolean }).advanced;
/** an op argument's control: the cb.arg control where the catalogue has ui hints, else the generic number or enum */
function argControl(m: MountCtx, frame: (s: any) => string | null, id: Id, arg: string, spec: ArgSpec, d: Document): HTMLElement | null {
  const path = `${id}.params.${arg}`;
  if (spec.type === 'Image' || spec.type === 'Mask' || spec.type === 'list' || spec.type === 'box' || spec.type === 'point' || spec.type === 'polyline') return null;
  if (spec.ui && argModel(path, d)) return renderArg({ $: 'cb.arg', props: { path }, kids: [], at: null } as unknown as NodeData, m) as HTMLElement;
  return specControl(m, frame, path, arg, spec);
}

/** a colour range's colour: its swatch and OkLab numbers, and Sample, which arms the eyedropper for this component */
function colourSample(m: MountCtx, frame: (s: any) => string | null, cid: Id): HTMLElement {
  const sw = h('span', { class: 'cb-ed-swatch is-big', role: 'img' });
  const txt = h('span', { class: 'cb-stack-detail cb-ed-lab' });
  const b = btn('Sample', 'cb-stack-sample', { 'aria-label': 'Sample the colour on the picture', 'aria-pressed': 'false' });
  const can = !!mathOf(m.rt.services);
  if (!can) {
    b.disabled = true;
    b.dataset['tip'] = 'The host gives no colour conversion (services.editorMath)';
  } else b.dataset['tip'] = 'Click, then click the picture: the colour there (the image the mask reads)';
  listen(m.scope, b, 'click', () => {
    const armed = (m.store.readonly() as any).stack?.mask?.sample === cid;
    m.rctx().set({ stack: { mask: { sample: armed ? null : cid } } });
    const on = (m.store.readonly() as any).ui?.tool === 'mask-colour';
    // tool.<id> toggles: arm turns the eyedropper on, disarm turns it off
    if (armed === on) run(m, 'tool.mask-colour');
  });
  m.cell((s) => {
    const d = sel.doc(s, frame(s));
    const v = d ? readPath(d, `${cid}.params.colour`) : undefined;
    return { lab: Array.isArray(v) ? (v as number[]).join(',') : '', armed: s.stack?.mask?.sample === cid };
  }, (v) => {
    const lab = v.lab ? v.lab.split(',').map(Number) : [0.7, 0, 0];
    sw.style.background = oklabCss(lab);
    sw.setAttribute('aria-label', `Colour L ${lab[0]!.toFixed(2)}, a ${lab[1]!.toFixed(3)}, b ${lab[2]!.toFixed(3)}`);
    txt.textContent = `${lab[0]!.toFixed(2)}  ${lab[1]!.toFixed(3)}  ${lab[2]!.toFixed(3)}`;
    txt.title = 'OkLab L, a, b of the image the mask reads';
    b.classList.toggle('is-on', v.armed);
    b.setAttribute('aria-pressed', v.armed ? 'true' : 'false');
  }, { equals: (a: any, c: any) => a.lab === c.lab && a.armed === c.armed });
  return h('div', { class: 'cb-stack-num cb-ed-colour', 'data-path': `${cid}.params.colour` }, h('span', { class: 'cb-stack-num-l', text: 'Colour' }), sw, txt, b);
}


const params: Renderer = (n, m) => {
  const frame = (s: any) => frameOf(n, s);
  const el = h('div', { class: 'cb-panel cb-stack-params' });
  const editors: Editors = n.props['editors'] === false ? {} : ((n.props['editors'] as Editors | undefined) ?? EDITOR_FORMS);
  let scope: MountCtx | null = null;
  m.cell((s) => {
    const f = frame(s);
    const id = selectedIn(s, f);
    const d = f ? sel.doc(s, f) : undefined;
    const p = d && id ? findEntry(d, id) : undefined;
    return { f, id, key: p ? `${f}|${id}|${p.entry.kind}|${p.entry.kind === 'layer' ? p.entry.op : ''}|${p.stage}` : `${f}|none` };
  }, (v) => {
    scope?.scope.dispose();
    clear(el);
    scope = m.child('params');
    const pm = scope;
    const d = v.f ? peekDoc(m, v.f) : undefined;
    const p = d && v.id ? findEntry(d, v.id) : undefined;
    if (!d || !p || !v.id) return void el.append(h('p', { class: 'cb-empty', text: v.f ? 'Select a layer in a stack to see its settings.' : 'Select a photo first.' }));
    const id = v.id;
    const e = p.entry;
    const head = h('div', { class: 'cb-stack-head' }, h('strong', { class: 'cb-stack-title', text: entryName(e) }), h('span', { class: 'cb-dim', text: ` · ${e.kind === 'layer' ? opWord(e.op) : e.kind === 'group' ? 'Group' : 'Linked'} · ${p.stage}` }), provChip(pm, frame, id));
    pm.cell((s) => (sel.doc(s, frame(s)) ? entryNameOf(findEntry(sel.doc(s, frame(s))!, id)?.entry) : ''), (nm) => void ((head.firstChild as HTMLElement).textContent = nm ?? ''));
    el.append(head);
    if (e.kind === 'layer' && e.op && getOp(e.op).doc) el.append(h('p', { class: 'cb-dim cb-stack-doc', text: getOp(e.op).doc.split(/(?<=\.)\s/)[0] ?? '' }));
    el.append(amountControl(pm, frame, id, p.stage, { kind: e.kind, ...(e.kind === 'layer' ? { op: e.op } : {}) }));
    const choices = blendChoices(p.stage, e.kind);
    if (choices.length > 1) {
      const b = h('select', { class: 'cb-select', 'aria-label': 'Blend' }) as HTMLSelectElement;
      for (const c of choices) b.append(h('option', { value: c, text: blendWord(c) }));
      listen(pm.scope, b, 'change', () => run(pm, 'layer.blend', id, b.value));
      pm.cell((s) => (sel.doc(s, frame(s)) ? findEntry(sel.doc(s, frame(s))!, id)?.entry.blend : ''), (x) => void (b.value = String(x ?? '')));
      el.append(h('div', { class: 'cb-stack-num' }, h('span', { class: 'cb-stack-num-l', text: 'Blend' }), b));
    }
    el.append(h('div', { class: 'cb-stack-num' }, h('span', { class: 'cb-stack-num-l', text: 'Mask' }), maskChip(pm, frame, id)));
    if (e.kind === 'layer') {
      const op = getOp(e.op);
      // the op's editor (curve, levels, HSL, grading wheels, mixer, or one a layout registers), then the generic
      // controls of the arguments it does not cover
      const ed = editors[e.op];
      if (ed) {
        const x = pm.child('editor').mount(makeNode(ed.form, { entry: id, stage: p.stage }));
        if (x) el.append(h('div', { class: 'cb-stack-editor', 'data-op': e.op }, x));
      }
      const basic = h('div', { class: 'cb-stack-args' });
      const adv = h('details', { class: 'cb-stack-adv' }, h('summary', { text: 'More' }));
      for (const [k, spec] of Object.entries(op.args)) {
        if (ed?.covers.includes(k)) continue;
        const c = argControl(pm, frame, id, k, spec, d);
        if (c) (isAdvanced(spec) ? adv : basic).append(c);
      }
      el.append(basic);
      if (adv.children.length > 1) el.append(adv);
      if (op.coalesce) el.append(h('p', { class: 'cb-dim', text: 'Its spots are placed with the spot tool (Q) on the print.' }));
    } else if (e.kind === 'link') el.append(h('p', { class: 'cb-dim', text: `Linked (${linkWords(e)}): one Amount over every stage it touches. Bake makes it plain layers you can edit.` }));
    else if (e.kind === 'group') el.append(h('p', { class: 'cb-dim', text: `${Coll.size(e.stack)} entries; ${e.blend === 'pass' ? 'they act on the image below and the group fades and masks them together' : 'they are composited on their own, then blended as one layer'}.` }));
    const cmds = h('div', { class: 'cb-card-b cb-stack-cmds' });
    const actions: (readonly [string, string])[] = e.kind === 'link'
      ? [['Bake', 'link.bake'], ['Remove', 'link.remove']]
      : [['Duplicate', 'layer.duplicate'], ['Delete', 'layer.delete'], ['Group', 'layer.group'], ...(e.kind === 'group' ? [['Ungroup', 'layer.ungroup'] as const] : [])];
    for (const [label, cmd] of actions) {
      const bb = btn(label, `cb-stack-${cmd.split('.')[1]}`);
      listen(pm.scope, bb, 'click', () => run(pm, cmd, ...(cmd === 'layer.group' ? [[id]] : [id])));
      cmds.append(bb);
    }
    el.append(cmds);
  }, { equals: (a: any, b: any) => a.key === b.key });
  return el;
};

// ── the selected entry's mask ──

/**
 * The mask overlay's controls (CHB-039): Show (O), how it shows (where it acts, where it does not, the mask alone),
 * its colour and opacity. View state through the mask.overlay.* commands, so a key, the palette and an agent's
 * wb.run do the same.
 */
function overlayControls(pm: MountCtx): HTMLElement {
  const show = btn('Show', 'cb-stack-ov-show', { 'aria-pressed': 'false', 'data-tip': 'Show where the mask acts on the picture (O)' });
  listen(pm.scope, show, 'click', () => run(pm, 'mask.overlay.toggle'));
  const modes = h('div', { class: 'cb-seg cb-stack-ov-modes', role: 'radiogroup', 'aria-label': 'Overlay shows' });
  const SHORT: Record<OverlayMode, string> = { tint: 'Tint', inverse: 'Inverse', mask: 'Mask' };
  for (const md of OVERLAY_MODES) {
    const b = btn(SHORT[md], `is-${md}`, { 'data-mode': md, 'data-tip': MODE_WORDS[md] });
    listen(pm.scope, b, 'click', () => run(pm, 'mask.overlay.mode', md));
    modes.append(b);
  }
  const colour = h('select', { class: 'cb-select cb-stack-ov-colour', 'aria-label': 'Overlay colour' }) as HTMLSelectElement;
  for (const c of OVERLAY_COLOURS) colour.append(h('option', { value: c, text: COLOUR_WORDS[c] }));
  listen(pm.scope, colour, 'change', () => run(pm, 'mask.overlay.colour', colour.value));
  const opacity = h('input', { type: 'range', class: 'cb-range', min: '0.05', max: '1', step: '0.05', 'aria-label': 'Overlay opacity' }) as HTMLInputElement;
  const pct = h('span', { class: 'cb-dim cb-stack-ov-pct' });
  listen(pm.scope, opacity, 'input', () => run(pm, 'mask.overlay.opacity', Number(opacity.value)));
  const el = h('div', { class: 'cb-stack-overlay' },
    h('div', { class: 'cb-stack-num' }, h('span', { class: 'cb-stack-num-l', text: 'Overlay' }), show, modes),
    h('div', { class: 'cb-stack-num' }, h('span', { class: 'cb-stack-num-l', text: '' }), colour, opacity, pct));
  pm.cell((s) => ({ ...overlayOf(s), why: overlayReason(s) }), (o) => {
    show.classList.toggle('is-on', o.on);
    show.setAttribute('aria-pressed', String(o.on));
    for (const b of modes.children) (b as HTMLElement).classList.toggle('is-on', (b as HTMLElement).dataset['mode'] === o.mode);
    colour.value = o.colour;
    colour.disabled = o.mode === 'mask';
    opacity.disabled = o.mode === 'mask';
    opacity.value = String(o.opacity);
    pct.textContent = `${Math.round(o.opacity * 100)} %`;
    el.dataset['shown'] = o.why ?? '';
  }, { equals: (a: any, b: any) => !!a && JSON.stringify(a) === JSON.stringify(b) });
  return el;
}

/** while a gesture previews a path of the document's masks (a mask or component setting dragged): overlay.live */
function watchMaskGestures(m: MountCtx): void {
  const st = m.store;
  let live = false;
  const set = (v: boolean): void => queueMicrotask(() => m.rctx().set({ stack: { overlay: { live: v } } }));
  const off = st.on(() => {
    const now = st.previewing && st.gesture.writes().some((w) => w.path[0] === DOCS && w.path[2] === 'masks');
    if (now === live) return;
    live = now;
    set(now);
  });
  m.scope.onDispose(() => {
    off();
    if (live) set(false);
  });
}

const masks: Renderer = (n, m) => {
  const frame = (s: any) => frameOf(n, s);
  const el = h('div', { class: 'cb-panel cb-stack-masks' });
  watchMaskGestures(m);
  let scope: MountCtx | null = null;
  m.cell((s) => {
    const f = frame(s);
    const id = selectedIn(s, f);
    const d = f ? sel.doc(s, f) : undefined;
    const mk = d && id ? maskOf(d, id) : null;
    return { f, id, key: `${f}|${id}|${mk ? `${mk.id}|${mk.components.map(([c, x]) => `${c}:${x.kind}`).join(',')}` : 'none'}` };
  }, (v) => {
    scope?.scope.dispose();
    clear(el);
    scope = m.child('masks');
    const pm = scope;
    const d = v.f ? peekDoc(m, v.f) : undefined;
    const p = d && v.id ? findEntry(d, v.id) : undefined;
    if (!d || !p || !v.id) return void el.append(h('p', { class: 'cb-empty', text: 'Select a layer to see its mask.' }));
    const id = v.id;
    const mk = maskOf(d, id);
    // the tools: how a drawn component combines with the mask
    const comb = h('div', { class: 'cb-seg cb-stack-combine', role: 'radiogroup', 'aria-label': 'Draw' });
    for (const c of combines()) {
      const b = btn(COMBINE_WORDS[c], `is-${c}`, { 'data-combine': c });
      listen(pm.scope, b, 'click', () => pm.rctx().set({ stack: { mask: { combine: c } } }));
      comb.append(b);
    }
    pm.cell((s) => s.stack?.mask?.combine ?? 'add', (c: MaskCombine) => {
      for (const b of comb.children) (b as HTMLElement).classList.toggle('is-on', (b as HTMLElement).dataset['combine'] === c);
    });
    const tools = h('div', { class: 'cb-card-b cb-stack-mtools' });
    for (const [label, tool] of [['Linear', 'mask-linear'], ['Radial', 'mask-radial'], ['Brush', 'mask-paint'], ['Luminance', 'mask-luminance'], ...(componentKinds().includes('colour' as never) ? [['Colour', 'mask-colour']] : [])] as const) {
      const b = btn(label, `cb-stack-tool-${tool}`);
      listen(pm.scope, b, 'click', () => run(pm, `tool.${tool}`));
      tools.append(b);
    }
    if (!mk) {
      // a layer in a masked group acts through the group's mask: the overlay shows that
      if (coverageMasks(d, id).length) el.append(h('p', { class: 'cb-dim cb-stack-ov-note', text: `${entryName(p.entry)} acts through its group's mask.` }), overlayControls(pm));
      el.append(h('p', { class: 'cb-empty', text: `${entryName(p.entry)} ${coverageMasks(d, id).length ? 'has no mask of its own' : 'acts everywhere'}. Draw a mask on the print with a tool, or add a range:` }), tools);
      const add = h('div', { class: 'cb-card-b' });
      for (const k of componentKinds().filter((x) => x === 'luminance' || x === ('colour' as never))) {
        const b = btn(`+ ${KIND_WORDS[k] ?? k}`, `cb-stack-new-${k}`);
        listen(pm.scope, b, 'click', () => run(pm, 'mask.new', k, id));
        add.append(b);
      }
      el.append(add);
      return;
    }
    const mid = mk.id;
    const users = maskUsers(d, mid);
    el.append(h('div', { class: 'cb-stack-head' }, h('strong', { text: mk.mask.name }), h('span', { class: 'cb-dim', text: users.length > 1 ? ` · also used by ${users.filter((u) => u !== id).map((u) => entryNameOf(findEntry(d, u)?.entry) || u).join(', ')}` : '' })));
    el.append(overlayControls(pm));
    el.append(h('div', { class: 'cb-stack-num' }, h('span', { class: 'cb-stack-num-l', text: 'Draw' }), comb), tools);
    const ol = h('ol', { class: 'cb-stack-comps' });
    for (const [cid, c] of mk.components) {
      const li = h('li', { class: 'cb-stack-comp', 'data-id': cid });
      const on = h('input', { type: 'checkbox', 'aria-label': `${cid} on` }) as HTMLInputElement;
      listen(pm.scope, on, 'change', () => run(pm, 'mask.set', `${cid}.enabled`, on.checked, `${on.checked ? 'Turn on' : 'Turn off'} a mask component`));
      const cs = h('select', { class: 'cb-stack-combine-sel', 'aria-label': `${cid} combine` }) as HTMLSelectElement;
      for (const x of combines()) cs.append(h('option', { value: x, text: COMBINE_WORDS[x] }));
      listen(pm.scope, cs, 'change', () => run(pm, 'mask.set', `${cid}.combine`, cs.value, `Mask component: ${COMBINE_WORDS[cs.value as MaskCombine]}`));
      const rm = btn('×', 'cb-stack-comp-rm', { 'aria-label': `Remove ${cid}` });
      listen(pm.scope, rm, 'click', () => run(pm, 'mask.removeComponent', cid));
      li.append(h('div', { class: 'cb-stack-line' }, on, h('span', { class: 'cb-stack-name', text: KIND_WORDS[c.kind] ?? c.kind }), cs, rm));
      li.append(numberControl(pm, { label: 'Amount', path: `${cid}.amount`, frame, min: 0, max: 1, step: 0.01, show: formatAmount, parse: parsePercent, stepLabel: 'Mask component amount', read: (s) => numAt(s, frame, `${cid}.amount`) }));
      if (c.kind === ('colour' as never)) li.append(colourSample(pm, frame, cid));
      for (const [k, spec] of Object.entries(getOp(`mask.${c.kind}`).args)) {
        const ctl = specControl(pm, frame, `${cid}.params.${k}`, k, spec);
        if (ctl) li.append(ctl);
      }
      pm.cell((s) => {
        const dd = sel.doc(s, frame(s));
        const x = dd ? Coll.get(Coll.get(dd.masks, mid)?.components ?? Coll.empty<MaskComponent>(), cid) : undefined;
        return x ? `${x.enabled}|${x.combine}` : '';
      }, (x) => {
        const [en, cb] = x.split('|');
        on.checked = en === 'true';
        cs.value = cb ?? 'add';
        li.classList.toggle('is-off', en !== 'true');
      });
      ol.append(li);
    }
    el.append(ol);
    el.append(numberControl(pm, { label: 'Feather', path: `${mid}.feather_mm`, frame, min: 0, max: 20, hard: [0, 1000], step: 0.1, show: (x) => `${x.toFixed(1)} mm`, stepLabel: 'Mask feather', tip: 'The soft edge, in mm on the print (the same at every export size)', read: (s) => numAt(s, frame, `${mid}.feather_mm`) }));
    const inv = h('input', { type: 'checkbox', 'aria-label': 'Invert the mask' }) as HTMLInputElement;
    listen(pm.scope, inv, 'change', () => run(pm, 'mask.set', `${mid}.invert`, inv.checked, inv.checked ? 'Invert the mask' : 'Mask not inverted'));
    const reads = h('select', { class: 'cb-select', 'aria-label': 'The mask reads' }) as HTMLSelectElement;
    for (const r of readsChoices(d, p.stage)) reads.append(h('option', { value: r, text: r === 'stage-input' ? `the ${p.stage} stage's input` : `the ${r} cut` }));
    listen(pm.scope, reads, 'change', () => run(pm, 'mask.set', `${mid}.reads`, reads.value, `The mask reads ${reads.value}`));
    pm.cell((s) => {
      const dd = sel.doc(s, frame(s));
      const x = dd ? Coll.get(dd.masks, mid) : undefined;
      return x ? `${x.invert}|${x.reads}` : '';
    }, (x) => {
      const [i, r] = x.split('|');
      inv.checked = i === 'true';
      reads.value = r ?? 'stage-input';
    });
    el.append(h('label', { class: 'cb-stack-num' }, h('span', { class: 'cb-stack-num-l', text: 'Invert' }), inv));
    el.append(h('div', { class: 'cb-stack-num', title: 'What luminance and colour ranges measure' }, h('span', { class: 'cb-stack-num-l', text: 'Reads' }), reads));
    const detach = btn('Remove mask', 'cb-stack-detach');
    listen(pm.scope, detach, 'click', () => run(pm, 'mask.detach', id));
    el.append(h('div', { class: 'cb-card-b' }, detach));
  }, { equals: (a: any, b: any) => a.key === b.key });
  return el;
};
/** the stack kit's renderers (part of CB_RENDERERS) */
export const STACK_RENDERERS: Record<string, Renderer> = { 'stack.layers': layers, 'stack.row': row, 'stack.params': params, 'stack.masks': masks, ...EDITOR_RENDERERS };
