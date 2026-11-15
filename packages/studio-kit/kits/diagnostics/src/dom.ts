// The DOM half of the diagnostics kit (CHB-038): the journal view (the Diagnostics panel and Help ▸ Diagnostics…),
// the report dialog's body (what happened; what to include, with sizes) and a report read back (for the owner).
// Plain words for the photographer; the codes and the data are one click further.
//
//   mount(app, el, { ...services, renderers: { ...DIAGNOSTICS_RENDERERS } })

/* eslint-disable @typescript-eslint/no-explicit-any */
import { clear, h, listen, type MountCtx, type Renderer } from '@chromobench/shell/dom';
import { JOURNAL_SOURCES, rowText, type Journal, type JournalLevel, type JournalRow } from '@chromobench/shell';
import { diagnosticsOf } from './kit.ts';
import { CHOICES, sizeText, type Report, type ReportPart } from './report.ts';

const btn = (text: string, cls = '', attrs: Record<string, unknown> = {}) => h('button', { type: 'button', class: `ck-btn is-small ${cls}`, text, ...attrs });
const LEVELS: { id: JournalLevel; label: string }[] = [
  { id: 'debug', label: 'Everything' },
  { id: 'info', label: 'Events' },
  { id: 'warn', label: 'Problems' },
  { id: 'error', label: 'Errors' },
];
const WORD: Record<JournalLevel, string> = { debug: 'debug', info: 'info', warn: 'warning', error: 'error' };
const time = (t: number): string => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** One row of the table: when, what, how often; the code and the data under a click. */
function rowEl(r: JournalRow, current: string): HTMLElement {
  const more = h('pre', { class: 'cb-diag-data', hidden: true, text: [r.code ? `code ${r.code}` : '', r.frame ? `frame ${r.frame}` : '', r.count > 1 ? `first ${new Date(r.first).toLocaleString()}` : '', r.session !== current ? `earlier session ${r.session}` : '', r.data !== undefined ? JSON.stringify(r.data, null, 1) : ''].filter(Boolean).join('\n') });
  const tr = h(
    'li',
    { class: ['cb-diag-row', `is-${r.level}`, r.session !== current && 'is-earlier'], 'data-level': r.level, 'data-source': r.source, 'data-count': String(r.count), title: rowText(r) },
    h('span', { class: 'cb-diag-t', text: time(r.last) }),
    h('span', { class: 'cb-diag-l', text: WORD[r.level] }),
    h('span', { class: 'cb-diag-s', text: r.source }),
    h('span', { class: 'cb-diag-m', text: r.message }),
    r.count > 1 ? h('span', { class: 'cb-diag-n', text: `×${r.count}` }) : '',
    more,
  );
  tr.addEventListener('click', () => void (more.hidden = !more.hidden));
  return tr;
}

/**
 * The journal: a filter (level, source), the rows newest first, Copy, Clear and (when given) Report a Problem….
 * Updates while open; `dispose` stops it (a panel's scope, or a dialog's close).
 */
export function journalView(journal: Journal, o: { report?: () => void; copy?: (text: string) => void; level?: JournalLevel } = {}): { el: HTMLElement; dispose(): void } {
  let level: JournalLevel = o.level ?? 'info';
  let source = '';
  const lv = h('select', { class: 'cb-diag-level', 'aria-label': 'Show' }, ...LEVELS.map((l) => h('option', { value: l.id, text: l.label })));
  lv.value = level;
  const src = h('select', { class: 'cb-diag-source', 'aria-label': 'From' }, h('option', { value: '', text: 'Everywhere' }), ...JOURNAL_SOURCES.map((s) => h('option', { value: s, text: s })));
  const head = h('p', { class: 'cb-diag-head' });
  const list = h('ol', { class: 'cb-diag-list', id: 'diagnostics-rows' });
  const copy = btn('Copy', 'cb-diag-copy', { title: 'The rows shown, as text, on the clipboard' });
  const clr = btn('Clear', 'cb-diag-clear', { title: 'Forget the rows (a report made later will not have them)' });
  const rep = o.report ? btn('Report a Problem…', 'cb-diag-report is-primary') : null;
  const draw = (): void => {
    const rows = journal.rows({ level, ...(source ? { source: source as JournalRow['source'] } : {}) });
    const t = journal.totals();
    head.textContent = `This session: ${t.error} error${t.error === 1 ? '' : 's'}, ${t.warn} warning${t.warn === 1 ? '' : 's'}${journal.size > rows.length ? ` · showing ${rows.length} of ${journal.size} rows` : ''}${journal.debugOn ? ' · debug on' : ''}`;
    clear(list);
    if (!rows.length) list.append(h('li', { class: 'cb-empty', text: level === 'error' || level === 'warn' ? 'No problems recorded.' : 'Nothing recorded yet.' }));
    for (const r of rows.slice(-400).reverse()) list.append(rowEl(r, journal.session));
  };
  lv.addEventListener('change', () => {
    level = lv.value as JournalLevel;
    draw();
  });
  src.addEventListener('change', () => {
    source = src.value;
    draw();
  });
  copy.addEventListener('click', () => {
    const text = journal.text({ level, ...(source ? { source: source as JournalRow['source'] } : {}) });
    if (o.copy) o.copy(text);
    else void navigator.clipboard?.writeText(text).catch(() => undefined);
  });
  clr.addEventListener('click', () => journal.clear());
  if (rep) rep.addEventListener('click', () => o.report!());
  let pending = false;
  const off = journal.subscribe(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      draw();
    });
  });
  draw();
  const el = h('div', { class: 'cb-diag' }, h('div', { class: 'cb-diag-bar' }, lv, src, copy, clr, ...(rep ? [rep] : [])), head, list);
  return { el, dispose: off };
}

/** The Diagnostics panel: the journal of `services.diagnostics`. */
const panel: Renderer = (_n, m: MountCtx) => {
  const d = diagnosticsOf(m.rt.services);
  if (!d) return h('div', { class: 'cb-panel cb-empty', text: 'Diagnostics are not available in this window.' });
  const v = journalView(d.journal, { report: () => void m.rt.runCommand('diagnostics.report', null) });
  m.scope.onDispose(() => v.dispose());
  listen(m.scope, v.el, 'pointerdown', () => d.journal.markSeen());
  return h('div', { class: 'cb-panel cb-diag-panel' }, v.el);
};

export const DIAGNOSTICS_RENDERERS: Record<string, Renderer> = { 'cb.diagnostics': panel };

/** What the report dialog shows about each choice: its size (bytes, or a text when only known roughly). */
export type PartSizes = Partial<Record<ReportPart, { bytes?: number; about?: string; none?: string }>>;

/**
 * The report dialog's body: what happened (his words), what is always in it, the choices with what each means and
 * its size, and where the file goes. `value()` reads the form.
 */
export function reportForm(o: { sizes: PartSizes; frames: number; problems: { errors: number; warnings: number }; base: number }): { el: HTMLElement; value(): { description: string; parts: ReportPart[] } } {
  const text = h('textarea', { id: 'report-description', rows: '4', placeholder: 'For example: after moving the Time slider, the picture went black and an error appeared.' });
  const boxes = new Map<ReportPart, HTMLInputElement>();
  const size = (p: ReportPart): string => {
    const s = o.sizes[p];
    if (!s) return '';
    if (s.none) return s.none;
    return s.bytes !== undefined ? sizeText(s.bytes) : (s.about ?? '');
  };
  const choice = (c: (typeof CHOICES)[number]) => {
    const none = !!o.sizes[c.part]?.none;
    const box = h('input', { type: 'checkbox', id: `report-${c.part}`, 'data-part': c.part });
    box.checked = c.on && !none;
    box.disabled = none;
    boxes.set(c.part, box);
    return h('label', { class: 'cb-report-choice' }, box, h('span', {}, h('strong', { text: c.label }), h('span', { class: 'cb-report-size', text: ` · ${size(c.part)}` }), h('br'), h('span', { class: 'cb-dim', text: c.says })));
  };
  const el = h(
    'div',
    { class: 'cb-report' },
    h('p', { text: 'This makes one file you can send to whoever helps you with the studio. Nothing is sent by the studio itself.' }),
    h('label', { class: 'cb-report-what', for: 'report-description', text: 'What happened? (optional)' }),
    text,
    h('p', { class: 'cb-report-always', text: `Always in it: what the studio recorded (${o.problems.errors} error${o.problems.errors === 1 ? '' : 's'}, ${o.problems.warnings} warning${o.problems.warnings === 1 ? '' : 's'}), this computer's browser and graphics card, and the studio's settings · ${sizeText(o.base)}` }),
    o.frames ? h('p', { class: 'cb-dim', text: `You have ${o.frames} photo${o.frames === 1 ? '' : 's'} open. You can also include:` }) : h('p', { class: 'cb-dim', text: 'No photos are open, so there are no edits or pictures to include.' }),
    ...CHOICES.map(choice),
  );
  return {
    el,
    value: () => ({ description: text.value, parts: [...boxes].filter(([, b]) => b.checked && !b.disabled).map(([p]) => p) }),
  };
}

/**
 * A report read back (File ▸ Open Report…): who made it with what, what he wrote, the journal's problems, each frame
 * with its picture, its steps and whether its original is in the report. `open` reopens the frames whose originals
 * are included, with their documents and history.
 */
export function reportView(r: Report, o: { open?: () => void; url: (bytes: Uint8Array, type: string) => string }): HTMLElement {
  const m = r.manifest;
  const env = (r.environment ?? {}) as Record<string, any>;
  const rows = r.journal?.rows ?? [];
  const problems = rows.filter((x) => x.level === 'error' || x.level === 'warn');
  const facts: [string, string][] = [
    ['Made', `${new Date(m.created).toLocaleString()} with ${m.app.version} (${m.app.commit})`],
    ['Browser', String(env['browser']?.['summary'] ?? env['browser']?.['userAgent'] ?? '?')],
    ['Graphics', String(env['gpu']?.['engine']?.['name'] ?? 'no WebGPU device for the engine')],
    ['Engine', String(env['engine']?.['label'] ?? '?')],
    ['Layout', String(env['layout']?.['id'] ?? '?')],
    ['Inside', m.parts.join(', ')],
  ];
  const frames = r.frames.map((f) =>
    h(
      'li',
      { class: 'cb-report-frame', 'data-frame': f.id },
      f.preview ? h('img', { src: o.url(f.preview, 'image/png'), alt: f.name }) : h('div', { class: 'cb-report-nopic', text: 'no picture' }),
      h(
        'div',
        {},
        h('strong', { text: f.name }),
        h('span', { class: 'cb-dim', text: ` · ${f.kind === 'digital-raw' ? 'photo' : 'negative'} · ${f.steps} step${f.steps === 1 ? '' : 's'} · ${f.original ? 'original included' : f.preview ? 'picture only (the original was not included)' : 'no picture'}` }),
        f.entries.length ? h('ol', { class: 'cb-report-steps' }, ...f.entries.slice(-12).map((e) => h('li', { text: `${e.label}${e.by !== 'user' ? ` (${e.by})` : ''}${e.status !== 'applied' ? ` · ${e.status}` : ''}` }))) : '',
      ),
    ),
  );
  const openable = r.frames.filter((f) => f.original && f.save).length;
  return h(
    'div',
    { class: 'cb-report cb-report-view', id: 'report-view' },
    h('dl', { class: 'cb-report-facts' }, ...facts.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])),
    h('p', { class: 'cb-report-description', text: m.description.trim() ? `“${m.description.trim()}”` : '(no description)' }),
    h('h4', { text: `Journal: ${m.summary.errors} errors, ${m.summary.warnings} warnings` }),
    problems.length ? h('ol', { class: 'cb-diag-list' }, ...problems.slice(-60).reverse().map((x) => rowEl(x, r.journal?.session ?? ''))) : h('p', { class: 'cb-dim', text: 'No problems in the journal.' }),
    h('h4', { text: `Photos (${r.frames.length})` }),
    r.frames.length ? h('ol', { class: 'cb-report-frames' }, ...frames) : h('p', { class: 'cb-dim', text: 'No photos were open.' }),
    r.screenshot ? h('details', {}, h('summary', { text: 'The viewer when the report was made' }), h('img', { class: 'cb-report-shot', src: o.url(r.screenshot, 'image/png'), alt: 'viewer' })) : '',
    o.open && openable ? h('p', {}, btn(`Open ${openable === 1 ? 'the photo' : `the ${openable} photos`} with their edits`, 'is-primary cb-report-open', { id: 'report-open' })) : h('p', { class: 'cb-dim', text: 'The original files are not in this report: the photos cannot be opened again, only looked at.' }),
  );
}
