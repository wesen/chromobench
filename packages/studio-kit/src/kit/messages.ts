// Messages for the photographer (CHB-027 F7, F8): errors in his words, and what the typed-value fields say.
// The contract's errors stay as they are for the DSL and the agents (`E_ARG_RANGE: print.enlarger.time_s = 0 is
// outside the allowed range [0.1, 600] (s).`); a toast shows "Time must be between 0.1 s and 600 s" and keeps the
// original as its detail (tooltip) for developers. Headless: plain strings, no DOM.
import { fieldPattern, fieldSpec, type ArgSpec } from '@chromobench/contract';
import type { Explained } from '@chromobench/shell';
import type { ControlModel } from '../model/controls.ts';
import { formatSeconds } from '../model/units.ts';
import { argModel, type ArgModel } from './args.ts';

const MINUS = '−';
const isTime = (m: ControlModel): boolean => m.storageUnit === 's' && m.scale === 'log2';

interface DiagLike {
  code: string;
  message: string;
  path?: string;
}

/** the code, message and path of a thrown value (a ChromobenchError carries them in .diag) */
function diagOf(err: unknown): DiagLike | null {
  const e = err as { diag?: DiagLike; code?: unknown; message?: unknown; diagnostic?: DiagLike } | null;
  if (!e || typeof e !== 'object') return null;
  const d = e.diag ?? e.diagnostic;
  if (d && typeof d.code === 'string') return { code: d.code, message: String(d.message ?? ''), ...(d.path ? { path: d.path } : {}) };
  if (typeof e.code === 'string') return { code: e.code, message: String(e.message ?? '') };
  return null;
}

/** what a person calls the value at a recipe path: the control's label ("Time", "Magenta"), else the last word */
function nameOf(path: string): { label: string; arg: ArgModel | null } {
  const a = argModel(path);
  if (a) {
    const comp = a.component !== null ? a.model.components?.[a.component] : undefined;
    return { label: comp ? `${a.model.label} ${comp}` : a.model.label, arg: a };
  }
  const ex = /^print\.exposures\.([^.]+)\.(\w+)$/.exec(path);
  if (ex) return { label: `Exposure ${ex[1]} ${ex[2] === 'time_s' ? 'time' : ex[2]!.replace(/_/g, ' ')}`, arg: null };
  const last = path.split('.').pop() ?? path;
  const word = last.replace(/_s$/, '').replace(/_/g, ' ');
  return { label: word.charAt(0).toUpperCase() + word.slice(1), arg: null };
}

/** a limit as a person says it: '0.1 s', '600 s' (not '600.0 s'), 'f/45', '+60 pt' as the control formats it */
function limitText(m: ControlModel, x: number, component: number | null): string {
  if (isTime(m) || (m.storageUnit === 's' && m.type === 'number')) return `${Number(x.toFixed(2))} s`;
  if (m.type === 'number') return m.format(x);
  return m.format(m.type === 'vec3' ? [x, x, x] : { c: x, m: x, y: x }, component ?? 0);
}

/** a bound in the units a person reads: '0.1 s', 'f/45', '−1.5 log H' as the control formats it */
function bound(x: number, spec: ArgSpec | undefined, a: ArgModel | null): string {
  if (a) {
    const m = a.model;
    if (m.type === 'number') return limitText(m, x, null);
    if (m.type === 'vec3' || m.type === 'cmy') return m.format(m.type === 'vec3' ? [x, x, x] : { c: x, m: x, y: x }, a.component ?? 0);
  }
  if (spec?.unit === 's') return `${formatSeconds(x)} s`;
  const n = String(Number(x.toFixed(4))).replace('-', MINUS);
  return spec?.unit && spec.unit !== 'none' ? `${n} ${spec.unit}` : n;
}

/** "Time must be between 0.1 s and 600 s" for a recipe path and its hard range; null when the path has no range */
export function rangeText(path: string): string | null {
  const { label, arg } = nameOf(path);
  const pat = fieldPattern(path);
  const spec = arg ? undefined : pat ? fieldSpec(pat) : undefined;
  const min = arg?.model.min ?? spec?.min;
  const max = arg?.model.max ?? spec?.max;
  if (min !== undefined && max !== undefined) return `${label} must be between ${bound(min, spec, arg)} and ${bound(max, spec, arg)}`;
  if (min !== undefined) return `${label} must be at least ${bound(min, spec, arg)}`;
  if (max !== undefined) return `${label} must be at most ${bound(max, spec, arg)}`;
  return null;
}

/**
 * An error in the photographer's words, or null to show it as it is. Wired as the shell's Runtime.explain by
 * Studio.attach, so refused edits and failing handlers toast this text; the original stays as the detail.
 */
export function explainError(err: unknown, o: { label?: string } = {}): Explained | null {
  const d = diagOf(err);
  if (!d) return null;
  const detail = d.message.startsWith(`${d.code}:`) ? d.message : `${d.code}: ${d.message}`;
  const path = d.path ?? /^(?:[A-Z_]+: )?([a-z][\w]*(?:\.[\w]+)+)\b/.exec(d.message)?.[1];
  const who = path ? nameOf(path).label : o.label;
  const text = ((): string | null => {
    switch (d.code) {
      case 'E_ARG_RANGE':
        if (path && / is not one of/.test(d.message)) return `${who}: that choice is not on the list`;
        if (path && / is not finite/.test(d.message)) return `${who} needs a number`;
        return (path && rangeText(path)) ?? (who ? `${who} is out of range` : 'That value is out of range');
      case 'E_ARG_TYPE':
        return who ? `${who} needs a ${path && argModel(path)?.model.type === 'number' ? 'number' : 'different kind of value'}` : 'That value has the wrong form';
      case 'E_STOCK_UNKNOWN':
        return 'That film or paper is not in the stock data';
      case 'E_STALE':
        return 'The picture changed after this change was prepared, so it was not applied';
      case 'E_PATH':
        return 'That setting does not exist for this picture';
      case 'E_READONLY':
        return 'The assistant may only look right now, not change anything';
      case 'E_FORMAT':
        return 'This file type cannot be opened';
      case 'E_CANCELLED':
        return 'Cancelled';
      case 'E_TIMEOUT':
        return 'That took too long and was stopped';
      case 'E_EVAL': case 'E_DEVICE_LOST': case 'E_GPU_OOM': case 'E_KERNEL_COMPILE':
        return 'The picture could not be computed (a problem with the graphics card)';
      case 'E_NO_FRAME':
        return 'Open or select a picture first';
      default:
        return /^E_/.test(d.code) ? `${who ? `${who}: ` : ''}this change could not be applied` : null;
    }
  })();
  if (!text) return null;
  // the transaction's label as the title, unless the text already starts with it
  return { text, ...(o.label && !text.startsWith(o.label) ? { title: o.label } : {}), detail };
}

// ── typed values (F8) ──

/** what a typed-value field accepts, as its tooltip and placeholder: "15, 12s or 7,5 — or +1/3 st, −2 to change by" */
export function entryHint(m: ControlModel): string {
  if (isTime(m)) return 'Type a time: 15, 12s or 7,5. A sign changes it: +1/3 st, −2 (seconds)';
  if (m.storageUnit === 'fstop') return 'Type an aperture: f/8 or 11. A sign changes it: +1/3 st';
  if (m.storageUnit === 'CC') return 'Type filtration in CC: 40 or 62,5. A sign changes it: +5, −10';
  if (m.displayUnit === 'point') return 'Type points: 4 or −2,5 sets it. A sign changes it: +2, −1';
  return 'Type a value (7,5 works). A sign changes it: +1, −1';
}
/** the shorter version for the empty box */
export function entryPlaceholder(m: ControlModel): string {
  if (isTime(m)) return '15, 12s, +1/3 st';
  if (m.storageUnit === 'fstop') return 'f/8, +1/3 st';
  if (m.storageUnit === 'CC') return '40, +5';
  if (m.displayUnit === 'point') return '+2, −1';
  return 'value';
}

/** a typed entry that moves from the current value (a leading + or −) */
export const isRelativeEntry = (text: string): boolean => /^\s*[+−-]/.test(text);

/** the toast after a relative entry: "Time −5 → 10.0 s" (the field read '−5' as "5 s less") */
export function relativeText(m: ControlModel, text: string, after: unknown, component: number | null): string {
  const shown = m.format(after, component ?? undefined);
  let t = text.trim().replace(/^-/, MINUS).replace(/^([+−])\s*/, '$1');
  // '−5' on a time is 5 seconds less: say the unit the number was read in
  const unit = / ([A-Za-z]+)$/.exec(shown)?.[1];
  if (unit && !/[A-Za-z%]/.test(t)) t = `${t} ${unit}`;
  const comp = component !== null ? m.components?.[component] : undefined;
  return `${m.label}${comp ? ` ${comp}` : ''} ${t} → ${shown}`;
}

/** the toast for a value that did not parse: "Time: “abc” is not a value. Type a time: …" */
export function badEntryText(m: ControlModel, text: string): string {
  const t = text.trim();
  return `${m.label}: ${t ? `“${t}” is not a value` : 'the box is empty'}. ${entryHint(m)}`;
}

export interface Clamped {
  value: unknown;
  /** which hard limit the entry ran into, or null when it was inside */
  hit: 'min' | 'max' | null;
}
/** a typed value held to the control's hard range (per component for vec3 / cmy) */
export function clampEntry(a: ArgModel, v: unknown, component: number | null): Clamped {
  const m = a.model;
  const lo = m.min ?? -Infinity;
  const hi = m.max ?? Infinity;
  let hit: Clamped['hit'] = null;
  const c = (x: number): number => {
    if (x < lo) {
      hit = 'min';
      return lo;
    }
    if (x > hi) {
      hit = 'max';
      return hi;
    }
    return x;
  };
  if (m.type === 'number' && typeof v === 'number') return { value: c(v), hit };
  if (m.type === 'vec3' && Array.isArray(v)) {
    const out = (v as number[]).map((x, i) => (component === null || i === component ? c(x) : x));
    return { value: out, hit };
  }
  if (m.type === 'cmy' && v && typeof v === 'object') {
    const keys = ['c', 'm', 'y'] as const;
    const out = { ...(v as Record<string, number>) };
    keys.forEach((k, i) => {
      if (component === null || i === component) out[k] = c(out[k]!);
    });
    return { value: out, hit };
  }
  return { value: v, hit };
}
/** the toast after a clamped entry: "Time can be at most 600 s: set to 600 s" */
export function clampedText(m: ControlModel, hit: 'min' | 'max', component: number | null): string {
  const comp = component !== null ? m.components?.[component] : undefined;
  const who = `${m.label}${comp ? ` ${comp}` : ''}`;
  const lim = hit === 'min' ? m.min! : m.max!;
  const shown = limitText(m, lim, component);
  return hit === 'min' ? `${who} can't go below ${shown}: set to ${shown}` : `${who} can be at most ${shown}: set to ${shown}`;
}

// ── tooltips in darkroom words (F9) ──

/**
 * What a control does, as a printer would say it. The contract's docs are written for developers and agents
 * ("Dichroic filtration as a shift on the database neutral pack for (paper, film)"); the labels' tooltips use
 * these, with the contract doc as the fallback for the controls not listed.
 */
const TIPS: Record<string, string> = {
  'print.enlarger.filtration': 'Colour filtration in the enlarger head, as a change from the neutral pack for this film and paper (0 = neutral). More yellow makes the print bluer, more magenta makes it greener.',
  'print.lights.logH': 'Printer lights: more red, green or blue light on the paper, in points (12 points = 1 stop). More light of a colour prints more of its opposite: more blue light makes the print yellower.',
  'print.enlarger.time_s': 'Exposure time under the enlarger. Longer prints darker; ⅓ stop is about 26 % more time.',
  'print.enlarger.fstop': 'Enlarger lens aperture. One stop down halves the light.',
  'print.grade': 'Contrast: 2 is the paper as made, higher is harder, lower is softer. The mid-grey stays where it is.',
  'print.paper': 'The colour paper the print is made on.',
  'print.preflash': 'A weak, even pre-exposure of the paper that tames the highlights.',
  'print.enlarger.mode': 'Normalised: the grey card prints at the aim with lights at 0. Real: a physical enlarger, with filtration and time doing all the work.',
  'scan.stock': 'The film the negative was shot on. It sets the orange mask and the film’s colour response.',
  'capture.stock': 'The film the photo is put on, as if it had been shot on it.',
  'capture.exposureEV': 'Exposure of the film, in stops from its rated speed.',
  'capture.development.push': 'Push (+) or pull (−) development, in stops.',
  'view.illuminant': 'The light the print is looked at under.',
  'view.flare': 'Stray light on the print where it is looked at; it softens the deepest blacks.',
  'scan.flare': 'Stray light in the scanner or camera scan, measured from the film holder; it is taken out.',
};
/** the tooltip of a control's label */
export const controlTip = (m: ControlModel): string => TIPS[m.path] ?? m.doc;
