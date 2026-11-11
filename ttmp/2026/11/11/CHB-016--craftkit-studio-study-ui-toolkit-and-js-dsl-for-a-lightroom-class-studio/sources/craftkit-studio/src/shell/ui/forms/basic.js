// Forms: text, glyph, field, track, choice — and the opinionated widgets made of them and their habits.
import { defineForm, node, setDisabled } from '../node.js';
import { h, icon, listen, drag, fmtNum } from '../dom.js';
import { scrub, nudge, reset, parseValue, UNITS, modStep, snap, rename, MIXED } from '../habits.js';
import { clamp } from '../../core/util.js';
import { chordLabel, parseChord } from '../../core/keys.js';

// ── text and glyph ───────────────────────────────────────────────────────
defineForm('text', {
  slots: { value: 'τ', strong: 'β', dim: 'β', mono: 'β', rename: 'ρ', size: 'β', wrap: 'β' },
  mount(n, m) {
    const p = n.props;
    const el = h('span', { class: ['ck-text', p.strong && 'is-strong', p.dim && 'is-dim', p.mono && 'is-mono', p.size && 'is-' + p.size, p.wrap && 'is-wrap'] });
    m.val(p.value, v => { el.textContent = v == null ? '' : String(v); });
    if (p.rename) rename(m.scope, el, { get: () => el.textContent, set: v => m.run(p.rename, v) });
    return el;
  },
});
defineForm('glyph', {
  slots: { name: 'τ', size: 'β' },
  mount(n, m) {
    const el = h('span', { class: 'ck-glyph' });
    m.val(n.props.name, v => { el.replaceChildren(v ? icon(v, n.props.size || 14) : ''); });
    return el;
  },
});
defineForm('stat', {
  slots: { value: 'τ', label: 'τ', mono: 'β' },
  mount(n, m) {
    const el = h('div', { class: 'ck-stat' }); const lab = h('span', { class: 'ck-stat-l' }); const val = h('span', { class: ['ck-stat-v', n.props.mono && 'is-mono'] });
    el.append(lab, val);
    m.val(n.props.label, v => { lab.textContent = v || ''; lab.hidden = !v; });
    m.val(n.props.value, v => { val.textContent = v == null ? '—' : String(v); });
    return el;
  },
});
defineForm('kbd', {
  slots: { chord: 'β' },
  mount(n) { let c; try { c = chordLabel(parseChord(n.props.chord)); } catch (e) { c = n.props.chord; } return h('kbd', { class: 'ck-kbd', text: c }); },
});

// ── buttons ───────────────────────────────────────────────────────────────
// run: a command id or ρ (ctx, e) => …; a command id also supplies the label, the tip with its key, and the disabled state
defineForm('button', {
  slots: { run: 'ρ', primary: 'β', icon: 'β', checked: 'τ', quiet: 'β', small: 'β', menu: 'β', text: 'β' },
  mount(n, m) {
    const p = n.props, app = m.app;
    const cmd = typeof p.run === 'string' ? app.commands.get(p.run) : null;
    const el = h('button', { type: 'button', class: ['ck-btn', p.primary && 'is-primary', p.quiet && 'is-quiet', p.small && 'is-small', p.icon && !p.label && !p.text && 'is-icon'] });
    if (p.icon) el.append(icon(p.icon, p.small ? 12 : 14));
    const lab = h('span', { class: 'ck-btn-l' }); el.append(lab);
    // a command button shows the command's label, except an icon button in a toolbar (quiet), which shows the icon
    const labelSrc = p.label !== undefined ? p.label : p.text !== undefined ? p.text : cmd && !(p.icon && p.quiet) ? s => app.commands.label(cmd.id, s) : '';
    m.val(labelSrc, v => { lab.textContent = v || ''; lab.hidden = !v; });
    if (cmd) {
      el.dataset.ownTip = '1'; el.dataset.ownDisabled = p.disabled === undefined ? '1' : '';
      const chord = app.keymap.chordsFor(cmd.id)[0];
      m.cell(s => app.commands.label(cmd.id, s), v => { const t = p.tip || v; el.dataset.tip = chord ? `${t}  (${chordLabel(chord)})` : t; el.setAttribute('aria-label', v); });
      if (p.disabled === undefined) m.cell(s => app.commands.status(cmd.id, s), st => setDisabled(el, !st.ok, st.why, m), { equals: (a, b) => a && b && a.ok === b.ok && a.why === b.why });
      if (cmd.checked !== undefined) m.cell(s => app.commands.checked(cmd.id, s), v => el.classList.toggle('is-on', !!v));
    } else if (p.tip === undefined && p.icon && typeof p.label === 'string') el.dataset.tip = p.label;
    if (p.checked !== undefined) m.val(p.checked, v => { el.classList.toggle('is-on', !!v); el.setAttribute('aria-pressed', v ? 'true' : 'false'); });
    listen(m.scope, el, 'click', e => { if (el.classList.contains('is-disabled')) { const w = el.dataset.why; if (w) app.chrome.toast(w, { kind: 'why' }); return; } if (p.run) m.run(p.run, e); });
    return el;
  },
});

// ── number field: units, arithmetic, scrub on the label, nudge with arrows, reset, mixed ──
defineForm('number', {
  slots: { bind: 'bind', unit: 'τ', accepts: 'β', expr: 'β', step: 'β', min: 'β', max: 'β', scrub: 'β', commit: 'β', decimals: 'β', mixed: 'β', reset: 'β', format: 'ƒ', suffix: 'β', compact: 'β', historyLabel: 'β' },
  mount(n, m) {
    const p = n.props;
    const step = typeof p.step === 'object' ? p.step.arrow || 1 : p.step || 1;
    const decimals = p.decimals != null ? p.decimals : step < 1 ? Math.min(3, String(step).split('.')[1].length) : 0;
    const b = m.binding(p.bind, n.at, { label: p.historyLabel || (typeof p.label === 'string' ? p.label : '') });
    const el = h('label', { class: ['ck-field', 'ck-number', p.compact && 'is-compact'] });
    const lab = h('span', { class: 'ck-field-l' });
    const input = h('input', { class: 'ck-field-i', type: 'text', inputmode: 'decimal', spellcheck: 'false', autocomplete: 'off' });
    const suffix = h('span', { class: 'ck-field-u' });
    el.append(lab, input, suffix);
    m.val(p.label, v => { lab.textContent = v || ''; lab.hidden = !v; input.setAttribute('aria-label', v || b.name); });
    let unit = '';
    m.val(p.unit, v => { unit = v || ''; suffix.textContent = p.suffix != null ? p.suffix : unit; });
    let editing = false;
    const show = v => { if (editing) return; input.value = v === MIXED || (p.mixed && v === undefined) ? (p.mixed || '—') : p.format ? p.format(v) : fmtNum(v, decimals); };
    b.watch(show);
    const commitText = () => {
      const r = parseValue(input.value, { unit, current: +b.get() || 0, units: UNITS, min: p.min ?? -Infinity, max: p.max ?? Infinity });
      if (!r.ok) { m.app.chrome.toast(r.error, { kind: 'error' }); show(b.get()); return; }
      b.set(+r.value.toFixed(Math.max(decimals, 4)), null, {});
      if (r.clamped) m.app.chrome.toast(`Kept within ${fmtNum(p.min, decimals)}–${fmtNum(p.max, decimals)}${unit ? ' ' + unit : ''}`, { kind: 'info' });
    };
    listen(m.scope, input, 'focus', () => { editing = true; input.select(); });
    listen(m.scope, input, 'blur', () => { if (editing) { editing = false; commitText(); show(b.get()); } });
    listen(m.scope, input, 'keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commitText(); input.select(); }
      else if (e.key === 'Escape') { e.preventDefault(); editing = false; show(b.get()); input.blur(); }
      else if (e.key === 'Tab') { /* default: next field */ }
    });
    nudge(m.scope, input, { get: () => b.get(), set: v => { b.set(v, null, { coalesce: 'nudge:' + b.name }); editing = false; show(v); editing = true; input.select(); }, step, min: p.min, max: p.max });
    if (p.scrub !== false) scrub(m.scope, lab, { get: () => b.get(), preview: v => b.preview(v), commit: () => b.commit(), cancel: () => b.cancel(), step, min: p.min, max: p.max, pxPerStep: 3, enabled: () => !el.classList.contains('is-disabled') });
    if (p.reset !== undefined) reset(m.scope, lab, { apply: () => b.set(typeof p.reset === 'function' ? p.reset(m.store.readonly()) : p.reset, `Reset ${lab.textContent || b.name}`) });
    return el;
  },
});

defineForm('textField', {
  slots: { bind: 'bind', placeholder: 'β', multiline: 'β', commit: 'β', search: 'β', onEnter: 'ρ', historyLabel: 'β', set: 'ρ' },
  mount(n, m) {
    const p = n.props;
    const b = m.binding(p.bind, n.at, { label: p.historyLabel || (typeof p.label === 'string' ? p.label : '') });
    const el = h('label', { class: ['ck-field', 'ck-textfield', p.search && 'is-search'] });
    if (p.search) el.append(icon('search', 12, 'ck-field-ico'));
    const lab = h('span', { class: 'ck-field-l' });
    const input = h(p.multiline ? 'textarea' : 'input', { class: 'ck-field-i', placeholder: p.placeholder || '', spellcheck: p.multiline ? 'true' : 'false' });
    el.append(lab, input);
    m.val(p.label, v => { lab.textContent = v || ''; lab.hidden = !v; input.setAttribute('aria-label', v || p.placeholder || b.name); });
    let editing = false, opened = null;
    b.watch(v => { if (!editing) input.value = v == null ? '' : String(v); });
    const live = p.commit === 'live';
    // a field commits to what it was opened on: clicking another photo blurs the field after the selection has
    // already moved, so the path (and, for a set handler, the state) are taken when typing starts
    const open = () => { if (opened) return; b.pin(); opened = { state: m.store.current, path: b.path }; };
    const close = () => { b.unpin(); opened = null; };
    const write = (v, extra) => { if (p.set) m.run(p.set, v, opened || { state: m.store.current, path: b.path }); else b.set(v, null, extra); };
    listen(m.scope, input, 'focus', () => { editing = true; open(); });
    listen(m.scope, input, 'input', () => { open(); if (live) write(input.value, { coalesce: 'type:' + b.name }); });
    listen(m.scope, input, 'blur', () => { editing = false; if (!live && input.value !== (b.get() ?? '')) write(input.value); close(); });
    listen(m.scope, input, 'keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter' && !p.multiline) { e.preventDefault(); if (!live) write(input.value); if (p.onEnter) m.run(p.onEnter, input.value); close(); open(); }
      if (e.key === 'Escape') { input.value = b.get() ?? ''; input.blur(); }
    });
    return el;
  },
});

// ── track: Lightroom's slider. label · track · value; drag, click, scrub the value, double-click to reset ──
const TRACKS = {
  temp: 'linear-gradient(90deg, #3b6fd6, #c9c9c9 50%, #e2c33a)',
  tint: 'linear-gradient(90deg, #3fae3f, #c9c9c9 50%, #c43fc4)',
  rainbow: 'linear-gradient(90deg, #f33, #ff3 17%, #3f3 33%, #3ff 50%, #33f 67%, #f3f 83%, #f33)',
};
defineForm('slider', {
  slots: { bind: 'bind', min: 'β', max: 'β', step: 'β', decimals: 'β', track: 'β', bipolar: 'β', reset: 'β', commit: 'β', scale: 'β', unit: 'β', format: 'ƒ', altPreview: 'β', historyLabel: 'β', labelWidth: 'β', compact: 'β', readout: 'τ' },
  mount(n, m) {
    const p = n.props;
    const min = p.min, max = p.max, log = p.scale === 'log';
    const step = p.step || (max - min > 20 ? 1 : (max - min) / 200);
    const decimals = p.decimals != null ? p.decimals : step >= 1 ? 0 : String(step).split('.')[1].length;
    const labelText = () => (typeof p.label === 'string' ? p.label : lab.textContent);
    const b = m.binding(p.bind, n.at, { label: p.historyLabel || (typeof p.label === 'string' ? p.label : '') });
    const toT = v => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
    const fromT = t => (log ? min * Math.pow(max / min, t) : min + t * (max - min));
    const fmt = v => (p.format ? p.format(v) : fmtNum(v, decimals, !!p.bipolar) + (p.unit ? (p.unit.length > 2 ? ' ' : '') + p.unit : ''));

    const el = h('div', { class: ['ck-slider', p.bipolar && 'is-bipolar', p.compact && 'is-compact'], role: 'group' });
    const lab = h('span', { class: 'ck-slider-l' });
    if (p.labelWidth) lab.style.width = p.labelWidth + 'px';
    const track = h('div', { class: 'ck-slider-t', tabindex: '0', role: 'slider', 'aria-valuemin': min, 'aria-valuemax': max });
    const rail = h('div', { class: 'ck-slider-r' }), fill = h('div', { class: 'ck-slider-f' }), knob = h('div', { class: 'ck-slider-k' });
    const tk = typeof p.track === 'string' ? p.track : p.track && p.track.kind;
    if (TRACKS[tk]) { rail.style.background = TRACKS[tk]; rail.classList.add('is-colored'); }
    else if (p.track && p.track.from) { rail.style.background = `linear-gradient(90deg, ${p.track.from}, ${p.track.to})`; rail.classList.add('is-colored'); }
    track.append(rail, fill, knob);
    const val = h('input', { class: 'ck-slider-v', type: 'text', inputmode: 'decimal', spellcheck: 'false', 'aria-label': 'value' });
    el.append(lab, track, val);
    m.val(p.label, v => { lab.textContent = v || ''; track.setAttribute('aria-label', v || b.name); });

    let editing = false, cur = 0;
    const show = v => {
      cur = +v || 0;
      const t = clamp(toT(cur), 0, 1);
      knob.style.left = (t * 100) + '%';
      if (p.bipolar && !rail.classList.contains('is-colored')) { const c = clamp(toT(0), 0, 1); fill.style.left = Math.min(c, t) * 100 + '%'; fill.style.width = Math.abs(t - c) * 100 + '%'; }
      else if (!rail.classList.contains('is-colored')) { fill.style.left = '0'; fill.style.width = t * 100 + '%'; } else fill.style.width = '0';
      track.setAttribute('aria-valuenow', cur); track.setAttribute('aria-valuetext', fmt(cur));
      if (!editing) val.value = fmt(cur);
      const def = p.reset !== undefined && typeof p.reset !== 'function' ? p.reset : null;
      el.classList.toggle('is-changed', def != null && Math.abs(cur - def) > step / 2);
    };
    b.watch(show);
    const enabled = () => !el.classList.contains('is-disabled');
    const label = () => labelText() || b.name;
    const histDetail = () => fmt(b.get());

    // drag on the track: jump to the click, then follow; Shift slows down
    let alt = null;
    const setAlt = (on, e) => {
      if (!p.altPreview) return;
      const want = on && e && e.altKey;
      if (want === !!alt) return;
      alt = want ? { name: p.altPreview, label: labelText(), path: b.path } : null;
      m.store.set(['view', 'altPreview'], alt);
    };
    listen(m.scope, track, 'pointerdown', e => {
      if (e.button !== 0 || !enabled()) return;
      e.preventDefault(); track.focus();
      const r = track.getBoundingClientRect();
      const tAt = x => clamp((x - r.left) / r.width, 0, 1);
      const onKnob = Math.abs(e.clientX - (r.left + toT(cur) * r.width)) < 7;
      let x0 = e.clientX, v0 = cur;
      if (!onKnob) { const v = snap(fromT(tAt(e.clientX)), step); b.preview(v); v0 = v; }
      el.classList.add('is-dragging'); setAlt(true, e);
      drag(e, {
        move: ev => {
          setAlt(true, ev);
          const dt = (ev.clientX - x0) / r.width * (ev.shiftKey ? 0.1 : 1);
          const v = clamp(snap(fromT(clamp(toT(v0) + dt, 0, 1)), step), min, max);
          b.preview(v);
        },
        up: () => { el.classList.remove('is-dragging'); setAlt(false); b.commit(label(), { detail: histDetail() }); },
        cancel: () => { el.classList.remove('is-dragging'); setAlt(false); b.cancel(); },
      });
    });
    // keys on the focused track: arrows nudge (Shift ×10, Alt ×0.1), Home/End to the ends
    nudge(m.scope, track, { horizontal: true, get: () => b.get(), set: v => b.set(v, label(), { coalesce: 'nudge:' + b.name, detail: fmt(v) }), step, min, max, enabled });
    listen(m.scope, track, 'keydown', e => {
      if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); b.set(e.key === 'Home' ? min : max, label(), { detail: fmt(e.key === 'Home' ? min : max) }); }
    });
    // the value: scrub sideways, or click and type (arithmetic works: 0.5+0.25)
    scrub(m.scope, val, { get: () => b.get(), preview: v => b.preview(v), commit: () => b.commit(label(), { detail: histDetail() }), cancel: () => b.cancel(), step, min, max, pxPerStep: 2, enabled, click: () => { editing = true; val.focus(); val.select(); } });
    listen(m.scope, val, 'pointerdown', e => { if (document.activeElement === val) e.stopPropagation(); });
    listen(m.scope, val, 'blur', () => { if (!editing) return; editing = false; const r = parseValue(val.value, { current: cur, min, max }); if (r.ok && Math.abs(r.value - cur) > 1e-9) b.set(snap(r.value, step), label(), { detail: fmt(r.value) }); show(b.get()); });
    listen(m.scope, val, 'keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { val.blur(); } if (e.key === 'Escape') { editing = false; show(b.get()); val.blur(); } });
    // reset: double-click the label or the knob
    if (p.reset !== undefined) {
      const apply = () => { const v = typeof p.reset === 'function' ? p.reset(m.store.readonly()) : p.reset; b.set(v, `${label()}`, { detail: fmt(v) }); };
      reset(m.scope, lab, { apply }); reset(m.scope, knob, { apply });
    }
    // a slider is a member of its panel's slider ring: , and . move focus, = and - nudge
    track.dataset.ckSlider = '1';
    return el;
  },
});

// ── choices ───────────────────────────────────────────────────────────────
const optList = opts => (opts || []).map(o => (typeof o === 'object' ? o : { value: o, label: String(o) }));
defineForm('segmented', {
  slots: { bind: 'bind', options: 'β', icons: 'β', small: 'β', run: 'ρ', set: 'ρ', historyLabel: 'β' },
  mount(n, m) {
    const p = n.props, opts = optList(p.options);
    const b = p.bind ? m.binding(p.bind, n.at, { label: p.historyLabel || (typeof p.label === 'string' ? p.label : '') }) : null;
    const el = h('div', { class: ['ck-seg', p.small && 'is-small'], role: 'radiogroup' });
    const btns = opts.map(o => {
      const bt = h('button', { type: 'button', class: 'ck-seg-b', role: 'radio', 'data-value': String(o.value) });
      if (o.icon) bt.append(icon(o.icon, 13)); if (!o.icon || !p.icons) bt.append(h('span', { text: o.label }));
      if (o.icon && p.icons) bt.dataset.tip = o.tip || o.label;
      listen(m.scope, bt, 'click', () => { if (p.set) m.run(p.set, o.value); else if (b) b.set(o.value, `${b.label || 'Choose'}: ${o.label}`); if (p.run) m.run(p.run, o.value); });
      return bt;
    });
    el.append(...btns);
    if (b) b.watch(v => btns.forEach((bt, i) => { const on = opts[i].value === v; bt.classList.toggle('is-on', on); bt.setAttribute('aria-checked', on ? 'true' : 'false'); }));
    return el;
  },
});
defineForm('select', {
  slots: { bind: 'bind', options: 'τ', historyLabel: 'β', run: 'ρ', set: 'ρ', compact: 'β' },
  mount(n, m) {
    const p = n.props;
    const b = p.bind ? m.binding(p.bind, n.at, { label: p.historyLabel || (typeof p.label === 'string' ? p.label : '') }) : null;
    const el = h('label', { class: ['ck-field', 'ck-select', p.compact && 'is-compact'] });
    const lab = h('span', { class: 'ck-field-l' });
    const sel = h('select', { class: 'ck-field-i' });
    el.append(lab, sel, icon('chevd', 10, 'ck-select-ch'));
    m.val(p.label, v => { lab.textContent = v || ''; lab.hidden = !v; sel.setAttribute('aria-label', v || p.historyLabel || p.tip || (b ? b.name.split('.').pop().replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ') : 'Choose')); });
    let opts = [];
    m.val(p.options, v => {
      opts = optList(v);
      sel.replaceChildren(...opts.map((o, i) => o.group ? h('optgroup', { label: o.group }) : h('option', { value: String(i), text: o.label, disabled: o.disabled })));
      if (b) { const cur = b.get(); const i = opts.findIndex(o => o.value === cur); sel.value = String(i); }
    });
    if (b) b.watch(v => { const i = opts.findIndex(o => o.value === v); sel.value = String(i); });
    listen(m.scope, sel, 'change', () => { const o = opts[+sel.value]; if (!o) return; if (p.set) m.run(p.set, o.value); else if (b) b.set(o.value, `${b.label || 'Choose'}: ${o.label}`); if (p.run) m.run(p.run, o.value); });
    listen(m.scope, sel, 'keydown', e => e.stopPropagation());
    return el;
  },
});
defineForm('checkbox', {
  slots: { bind: 'bind', historyLabel: 'β', run: 'ρ', set: 'ρ', switch: 'β' },
  mount(n, m) {
    const p = n.props;
    const b = p.bind ? m.binding(p.bind, n.at, { label: p.historyLabel || (typeof p.label === 'string' ? p.label : '') }) : null;
    const el = h('label', { class: ['ck-check', p.switch && 'is-switch'] });
    const box = h('input', { type: 'checkbox' }); const lab = h('span', { class: 'ck-check-l' });
    el.append(box, lab);
    m.val(p.label, v => { lab.textContent = v || ''; });
    if (b) b.watch(v => { box.checked = !!v; });
    listen(m.scope, box, 'change', () => { if (p.set) m.run(p.set, box.checked); else if (b) b.set(box.checked, `${b.label || lab.textContent}: ${box.checked ? 'On' : 'Off'}`); if (p.run) m.run(p.run, box.checked); });
    return el;
  },
});
defineForm('stepper', {
  slots: { bind: 'bind', min: 'β', max: 'β', step: 'β', historyLabel: 'β' },
  mount(n, m) {
    const p = n.props, step = p.step || 1;
    const b = m.binding(p.bind, n.at, { label: p.historyLabel || (typeof p.label === 'string' ? p.label : '') });
    const el = h('div', { class: 'ck-stepper' });
    const lab = h('span', { class: 'ck-field-l' });
    const minus = h('button', { type: 'button', class: 'ck-btn is-icon is-small', 'aria-label': 'less' }, icon('minus', 11));
    const v = h('span', { class: 'ck-stepper-v' });
    const plus = h('button', { type: 'button', class: 'ck-btn is-icon is-small', 'aria-label': 'more' }, icon('plus', 11));
    el.append(lab, minus, v, plus);
    m.val(p.label, x => { lab.textContent = x || ''; lab.hidden = !x; });
    b.watch(x => { v.textContent = String(x); minus.disabled = p.min != null && x <= p.min; plus.disabled = p.max != null && x >= p.max; });
    const go = d => { const x = clamp((+b.get() || 0) + d * step, p.min ?? -Infinity, p.max ?? Infinity); b.set(x, `${b.label || lab.textContent}: ${x}`); };
    listen(m.scope, minus, 'click', () => go(-1)); listen(m.scope, plus, 'click', () => go(1));
    return el;
  },
});
defineForm('color', {
  slots: { bind: 'bind', historyLabel: 'β' },
  mount(n, m) {
    const p = n.props;
    const b = m.binding(p.bind, n.at, { label: p.historyLabel || (typeof p.label === 'string' ? p.label : '') });
    const el = h('label', { class: 'ck-field ck-colorfield' });
    const lab = h('span', { class: 'ck-field-l' }); const input = h('input', { type: 'color', class: 'ck-color-i' });
    el.append(lab, input);
    m.val(p.label, x => { lab.textContent = x || ''; lab.hidden = !x; });
    b.watch(x => { if (x) input.value = x; });
    listen(m.scope, input, 'input', () => b.preview(input.value));
    listen(m.scope, input, 'change', () => { b.preview(input.value); b.commit(`${b.label || 'Color'}: ${input.value}`); });
    return el;
  },
});

export { node };
