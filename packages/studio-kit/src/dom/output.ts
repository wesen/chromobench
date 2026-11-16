// The Output panel (CHB-047, OUT-1): his export settings — Format, Colour space, Size (Original size, Long edge,
// Percentage), JPEG quality, File name — and Export (this photo) / Export N selected, the progress with Cancel, and the
// results. File ▸ Export… shows the same form in a dialog (exportForm, a service the command uses). Every change goes
// through output.set (his preferences), every export through output.export, so a key, a menu, the panel and an agent
// do the same thing.
import { clear, h, listen, type MountCtx, type Renderer } from '@chromobench/shell/dom';
import type { Runtime } from '@chromobench/shell';
import { sel } from '../sel.ts';
import {
  bytesText, EXPORT_FORMATS, EXPORT_SIZES, EXPORT_SPACES, exportFileNames, exportPrefsOf, exportSummary,
  type ExportPrefs, type ExportRun,
} from '../model/export.ts';

const QUALITY_TIP = 'JPEG quality: 100 keeps the most detail in the largest file; 90 is hard to tell from it at half the size.';
const NAME_TIP = 'The file name: {name} is the photo’s file name (a frame of a strip adds its number), {n} its place in this export, {date} today.';

type Write = (patch: Partial<ExportPrefs>) => void;

/** The settings controls, written through `write`; `refresh(p)` shows settings changed elsewhere (a focused control keeps its text). */
function settingsForm(prefix: string, p0: ExportPrefs, write: Write, on: (el: HTMLElement, ev: string, f: () => void) => void, nameOf: () => string | null) {
  const opt = (id: string, label: string) => h('option', { value: id, text: label });
  const format = h('select', { id: `${prefix}format`, 'aria-label': 'Format' }, ...EXPORT_FORMATS.map((f) => opt(f.id, f.label))) as HTMLSelectElement;
  const space = h('select', { id: `${prefix}space`, 'aria-label': 'Colour space' }, ...EXPORT_SPACES.map((f) => opt(f.id, f.label))) as HTMLSelectElement;
  const size = h('select', { id: `${prefix}size`, 'aria-label': 'Size' }, ...EXPORT_SIZES.map((f) => opt(f.id, f.label))) as HTMLSelectElement;
  const long = h('input', { id: `${prefix}long`, type: 'number', min: '16', max: '100000', step: '1', 'aria-label': 'Long edge in pixels', class: 'cb-export-num' }) as HTMLInputElement;
  const pct = h('input', { id: `${prefix}pct`, type: 'number', min: '1', max: '100', step: '1', 'aria-label': 'Percentage of the original size', class: 'cb-export-num' }) as HTMLInputElement;
  const unit = h('span', { class: 'cb-dim cb-export-unit' });
  const quality = h('input', { id: `${prefix}quality`, type: 'range', min: '1', max: '100', step: '1', 'aria-label': 'JPEG quality', title: QUALITY_TIP }) as HTMLInputElement;
  const qv = h('input', { id: `${prefix}quality-n`, type: 'number', min: '1', max: '100', step: '1', 'aria-label': 'JPEG quality number', class: 'cb-export-num', title: QUALITY_TIP }) as HTMLInputElement;
  const name = h('input', { id: `${prefix}name`, type: 'text', 'aria-label': 'File name', title: NAME_TIP, spellcheck: 'false' }) as HTMLInputElement;
  const sample = h('div', { class: 'cb-dim cb-export-sample', id: `${prefix}sample` });
  const row = (label: string, ...c: (HTMLElement | string)[]) => h('label', { class: 'cb-export-row' }, h('span', { class: 'cb-export-l', text: label }), h('span', { class: 'cb-export-c' }, ...c));
  const qRow = row('JPEG quality', quality, qv);
  const sizeVal = row('', long, pct, unit);
  const el = h('div', { class: 'cb-export' }, row('Format', format), row('Colour space', space), row('Size', size), sizeVal, qRow, row('File name', name), sample);
  // keys typed in the form are the form's, not the studio's shortcuts
  el.addEventListener('keydown', (e) => e.stopPropagation());
  let p = p0;
  const refresh = (next: ExportPrefs): void => {
    p = next;
    const set = (c: HTMLInputElement | HTMLSelectElement, v: string) => {
      if (c.ownerDocument.activeElement !== c && c.value !== v) c.value = v;
    };
    set(format, p.format);
    set(space, p.space);
    set(size, p.size);
    set(long, String(p.longPx));
    set(pct, String(p.pct));
    set(quality, String(p.quality));
    set(qv, String(p.quality));
    set(name, p.name);
    long.hidden = p.size !== 'long';
    pct.hidden = p.size !== 'percent';
    unit.textContent = p.size === 'long' ? 'px, long edge' : p.size === 'percent' ? '% of original' : '';
    sizeVal.hidden = p.size === 'original';
    qRow.hidden = p.format !== 'jpeg';
    const n = nameOf();
    sample.textContent = n ? `${exportFileNames([{ name: n }], p)[0]} · ${exportSummary(p)}` : exportSummary(p);
  };
  const num = (c: HTMLInputElement, key: 'longPx' | 'pct' | 'quality', lo: number, hi: number, whole: boolean) => {
    const v = Number(c.value);
    if (!Number.isFinite(v)) return;
    const x = Math.min(hi, Math.max(lo, whole ? Math.round(v) : v));
    write({ [key]: x });
  };
  on(format, 'change', () => write({ format: format.value as ExportPrefs['format'] }));
  on(space, 'change', () => write({ space: space.value as ExportPrefs['space'] }));
  on(size, 'change', () => write({ size: size.value as ExportPrefs['size'] }));
  on(long, 'change', () => num(long, 'longPx', 16, 100000, true));
  on(pct, 'change', () => num(pct, 'pct', 1, 100, false));
  on(quality, 'input', () => num(quality, 'quality', 1, 100, true));
  on(qv, 'change', () => num(qv, 'quality', 1, 100, true));
  on(name, 'change', () => name.value.trim() && write({ name: name.value.trim() }));
  refresh(p);
  return { el, refresh };
}

/** File ▸ Export…'s body: the settings form, reading and writing his preferences (a service: services.exportForm). */
export function exportForm(ctx: { rt: Runtime; state: unknown }): HTMLElement {
  const rt = ctx.rt;
  const write: Write = (patch) => {
    void rt.runCommand('output.set', null, patch);
    f.refresh(exportPrefsOf(rt.store.readonly()));
  };
  const f = settingsForm('export-', exportPrefsOf(ctx.state), write, (el, ev, fn) => el.addEventListener(ev, fn), () => sel.name(rt.store.readonly()) || null);
  const n = sel.targets(rt.store.readonly() as never).length;
  f.el.append(h('p', { class: 'small cb-dim', text: n > 1 ? `${n} photos; you choose a folder for them next (or they are downloaded).` : 'You choose where the file goes next (or it is downloaded).' }));
  return f.el;
}

/** The progress line and the results of the last export. */
function progressView(m: MountCtx): HTMLElement {
  const el = h('div', { class: 'cb-export-run', id: 'output-run', 'aria-live': 'polite' });
  m.cell(
    (s: any) => s.ui?.export as ExportRun | undefined,
    (r) => {
      clear(el);
      if (!r) return;
      if (r.running) {
        const tiles = r.tilesTotal > 1 ? ` · ${r.tilesDone} of ${r.tilesTotal} parts` : '';
        const cancel = h('button', { type: 'button', class: 'ck-btn is-small', id: 'output-cancel', text: 'Cancel' });
        listen(m.scope, cancel, 'click', () => void m.rt.runCommand('output.cancel', null));
        const bar = h('progress', { max: String(Math.max(1, r.tilesTotal)), value: String(r.tilesDone) });
        el.append(h('div', { class: 'cb-export-now' }, h('span', { text: `Exporting ${r.total > 1 ? `${r.at} of ${r.total}: ` : ''}${r.file || '…'}${tiles}` }), cancel), bar);
      }
      if (!r.results.length) return;
      const ok = r.results.filter((x) => x.ok).length;
      const head = r.running ? '' : r.cancelled ? `Cancelled: ${ok} of ${r.total} exported` : ok === r.results.length ? `Exported ${ok === 1 ? r.results[0]!.file : `${ok} photos`}` : `Exported ${ok} of ${r.results.length}`;
      if (head) el.append(h('div', { class: 'cb-export-head', text: head }));
      const ul = h('ul', { class: 'cb-export-results', id: 'output-results' });
      for (const x of r.results) {
        ul.append(h('li', { class: ['cb-export-res', x.ok ? 'is-ok' : 'is-failed'], 'data-file': x.file },
          x.ok ? `✓ ${x.file} · ${x.width} × ${x.height} px · ${bytesText(x.bytes ?? 0)}${x.ms !== undefined ? ` · ${x.ms < 1000 ? `${x.ms} ms` : `${(x.ms / 1000).toFixed(1)} s`}` : ''}` : `✗ ${x.file || 'export'}: ${x.error ?? 'failed'}`));
      }
      el.append(ul);
    },
  );
  return el;
}

/** cb.output: the Output module's panel (simple: one "Save the print" button with his settings, and its progress). */
export const outputPanel: Renderer = (n, m) => {
  const st = () => m.rt.store.readonly() as any;
  const go = (frames: 'current' | 'selected') => void m.rt.runCommand('output.export', null, { frames });
  if (n.props['simple']) {
    const b = h('button', { type: 'button', class: 'ck-btn is-small cb-save is-primary', text: 'Save the print' });
    listen(m.scope, b, 'click', () => go('current'));
    return h('div', { class: 'cb-panel cb-output is-simple' }, b, progressView(m));
  }
  const write: Write = (patch) => void m.rt.runCommand('output.set', null, patch);
  const f = settingsForm('output-', exportPrefsOf(st()), write, (el, ev, fn) => listen(m.scope, el, ev, fn), () => sel.name(st()) || null);
  m.cell((s: any) => ({ p: s.prefs?.export, name: sel.name(s) }), () => f.refresh(exportPrefsOf(st())), { equals: (a: any, b: any) => a.p === b.p && a.name === b.name });
  const one = h('button', { type: 'button', class: 'ck-btn cb-save is-primary', id: 'output-export', text: 'Export' });
  const many = h('button', { type: 'button', class: 'ck-btn', id: 'output-export-selected' });
  listen(m.scope, one, 'click', () => go('current'));
  listen(m.scope, many, 'click', () => go('selected'));
  m.cell(
    (s: any) => ({ cur: sel.current(s), n: sel.targets(s).filter((id: string) => !!s.docs?.[id]).length, busy: !!s.ui?.export?.running }),
    (v) => {
      one.toggleAttribute('disabled', !v.cur || v.busy);
      one.title = v.cur ? 'Export the photo shown' : 'Open a photo first';
      many.hidden = v.n < 2;
      many.textContent = `Export ${v.n} selected`;
      many.toggleAttribute('disabled', v.busy);
    },
    { equals: (a: any, b: any) => a.cur === b.cur && a.n === b.n && a.busy === b.busy },
  );
  return h('div', { class: 'cb-panel cb-output' }, f.el, h('div', { class: 'cb-export-go' }, one, many), progressView(m));
};
