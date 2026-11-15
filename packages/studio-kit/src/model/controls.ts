// Moved from apps/studio/src/core/controls.ts (CHB-009) for CHB-019 (the original was deleted in the apps/studio migration).
// Controls generated from the op registry (guide §5.7): one ControlModel per recipe path that an
// op argument with `ui` metadata owns. The model converts between the stored unit and the unit the
// photographer reads; widgets only ever see display values.
import { argPath, convert, type ArgSpec, type OpDef, type Unit } from '@chromobench/contract';
import {
  filtrationAside, formatFstop, formatSeconds, formatStops, FSTOPS_THIRD, fstopStops, num, signed, stopsBetween,
} from './units.ts';
import { ENUM_NAMES, valueName } from './names.ts';

export type Widget = 'slider' | 'wheel' | 'stepper' | 'segmented' | 'toggle' | 'select';
export type ValueType = 'number' | 'vec3' | 'cmy' | 'enum' | 'string';

export interface ControlModel {
  path: string;
  op: string;
  arg: string;
  label: string;
  group: string;
  doc: string;
  widget: Widget;
  type: ValueType;
  storageUnit: Unit;
  displayUnit: Unit;
  scale: 'linear' | 'log2';
  /** Hard range in storage units. */
  min?: number;
  max?: number;
  usual?: [number, number];
  usualHint?: string;
  /** Step in display units (for log2: in stops). */
  step: number;
  detents: number[];
  defaultValue: unknown;
  values?: string[];
  /** the contract list the values come from (stocks:print, illuminants, …): their ids read as names (names.ts) */
  valuesFrom?: string;
  /** a value as a person reads it: a stock's name for its id; other values as they are */
  valueLabel(v: unknown): string;
  components?: [string, string, string];
  toDisplay(v: number): number;
  fromDisplay(d: number): number;
  /** '62.5 CC', '15.12 s', '+4 pt', 'f/8'. Component index for vec3/cmy. */
  format(v: unknown, component?: number): string;
  /** Second readout relative to a base value: '+1/3 st', '≈ −4.0 pt B'. */
  aside?(v: unknown, base: unknown, component?: number): string;
  /** Spoken value for aria-valuetext. */
  valueText(v: unknown, component?: number): string;
}

/** valuesFrom lists: placeholders for the mock engine; the host replaces them from the data packs (setKnownValues). */
export const KNOWN_VALUES: Record<string, string[]> = {
  'stocks:film': ['kodak_portra_400', 'kodak_portra_160', 'kodak_gold_200', 'kodak_ektar_100', 'fuji_pro_400h'],
  'stocks:print': ['kodak_portra_endura', 'kodak_supra_endura', 'fujicolor_crystal_archive_typeII'],
  illuminants: ['D50', 'D65', 'A', 'F2'],
  scanners: ['xt5-rgb-led', 'epson-v850', 'frontier-sp3000'],
  lamps: ['TH-KG3', 'LED-RGB'],
};

/** Replaces valuesFrom lists before controls are generated (CHB-023: from CHB-004's packs; call before building a layout). */
export function setKnownValues(lists: Record<string, string[]>): void {
  for (const [k, v] of Object.entries(lists)) if (v.length) KNOWN_VALUES[k] = [...v];
}

const UNIT_TEXT: Partial<Record<Unit, string>> = {
  point: 'pt', CC: 'CC', s: 's', stop: 'st', logH: 'log H', percent: '%', fraction: '', um: 'µm', K: 'K', mired: 'mired', deg: '°', none: '', px: 'px',
};
const SPOKEN: Partial<Record<Unit, string>> = { point: 'points', CC: 'CC', s: 'seconds', stop: 'stops', percent: 'percent' };

function decimals(step: number): number {
  if (step >= 1) return 0;
  return Math.min(3, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
}

function componentKey(type: ValueType, k: number): string | number {
  return type === 'cmy' ? (['c', 'm', 'y'] as const)[k]! : k;
}

/** Reads one component of a vec3 / cmy value (or the number itself). */
export function componentOf(type: ValueType, v: unknown, k = 0): number {
  if (type === 'vec3') return (v as number[])[k]!;
  if (type === 'cmy') return (v as Record<string, number>)[componentKey(type, k) as string]!;
  // a per-channel number (scan.flare [r, g, b], contract 0.3) shows its mean; the slider writes one number
  if (Array.isArray(v)) return (v as number[]).reduce((s, x) => s + x, 0) / Math.max(1, v.length);
  return v as number;
}

/** Returns a copy of v with component k replaced. */
export function withComponent(type: ValueType, v: unknown, k: number, x: number): unknown {
  if (type === 'vec3') {
    const out = [...(v as number[])];
    out[k] = x;
    return out;
  }
  if (type === 'cmy') return { ...(v as Record<string, number>), [componentKey(type, k)]: x };
  return x;
}

function valueTypeOf(spec: ArgSpec): ValueType | null {
  switch (spec.type) {
    case 'number': return 'number';
    case 'vec3': return 'vec3';
    case 'cmy': return 'cmy';
    case 'enum': return 'enum';
    case 'stockId': case 'string': return 'string';
    default: return null;
  }
}

export function modelFor(op: OpDef, arg: string, spec: ArgSpec, path: string): ControlModel | null {
  const ui = spec.ui;
  if (!ui) return null;
  const type = valueTypeOf(spec);
  if (!type) return null; // box/point arguments are edited with tools, not generated controls
  const storageUnit = spec.unit ?? 'none';
  const displayUnit = ui.displayUnit ?? storageUnit;
  const scale = ui.scale ?? 'linear';
  const label = ui.label ?? arg;
  const group = ui.group ?? op.area;
  const values = spec.values ?? (spec.valuesFrom ? KNOWN_VALUES[spec.valuesFrom] : undefined);
  const widget: Widget = (ui.widget === 'box' || ui.widget === 'point' ? null : ui.widget) ?? (type === 'enum' || type === 'string' ? 'select' : 'slider');
  const toDisplay = (v: number): number => (displayUnit === storageUnit ? v : convert(v, storageUnit, displayUnit));
  const fromDisplay = (d: number): number => (displayUnit === storageUnit ? d : convert(d, displayUnit, storageUnit));
  const isTime = storageUnit === 's' && scale === 'log2';
  const isFstop = storageUnit === 'fstop';
  const step = isTime ? 1 / 6 : isFstop ? 1 / 3 : ui.step !== undefined ? toDisplay(ui.step) : 1;
  const dec = decimals(step);
  const unitText = UNIT_TEXT[displayUnit] ?? displayUnit;
  // Signed display for offsets: printer lights (points) and the filtration shift on the neutral pack (CC, contract 0.2).
  const shift = displayUnit === 'point' || (type === 'cmy' && storageUnit === 'CC');
  const fmtNum = (v: number): string => {
    if (isTime) return `${formatSeconds(v)} s`;
    if (isFstop) return formatFstop(v);
    const d = toDisplay(v);
    const s = shift ? signed(d, dec) : num(d, dec);
    return unitText ? `${s} ${unitText}` : s;
  };
  const valueLabel = (v: unknown): string => (spec.valuesFrom && typeof v === 'string' ? valueName(spec.valuesFrom, v) : (ENUM_NAMES[path]?.[String(v)] ?? String(v)));
  const format = (v: unknown, k?: number): string => {
    if (type === 'enum' || type === 'string') return valueLabel(v);
    if (type === 'number') return Array.isArray(v) ? `(${v.map((x) => fmtNum(x as number)).join(', ')})` : fmtNum(v as number);
    if (k !== undefined) return fmtNum(componentOf(type, v, k));
    const parts = [0, 1, 2].map((i) => {
      const d = toDisplay(componentOf(type, v, i));
      return shift ? signed(d, dec) : num(d, dec);
    });
    return `(${parts.join(', ')})${unitText ? ` ${unitText}` : ''}`;
  };
  let aside: ControlModel['aside'];
  if (isTime) aside = (v, base) => `${formatStops(stopsBetween(base as number, v as number))} st`;
  else if (isFstop) aside = (v, base) => `${formatStops(fstopStops(base as number, v as number))} st`;
  else if (type === 'cmy' && storageUnit === 'CC') {
    aside = (v, base, k = 0) => filtrationAside((['c', 'm', 'y'] as const)[k]!, componentOf(type, v, k) - componentOf(type, base, k));
  } else if (displayUnit === 'point') aside = (v, _b, k = 0) => `${signed(componentOf(type, v, k), 3)} log H`;
  const valueText = (v: unknown, k?: number): string => {
    const comp = k !== undefined && ui.components ? `${ui.components[k]} ` : '';
    if (type === 'enum' || type === 'string') return `${label} ${valueLabel(v)}`;
    const x = k !== undefined || Array.isArray(v) ? componentOf(type, v, k ?? 0) : (v as number);
    if (isTime) return `${label} ${formatSeconds(x)} seconds`;
    if (isFstop) return `${label} f ${Number(x.toFixed(1))}`;
    const d = toDisplay(x);
    return `${label} ${comp}${d < 0 ? 'minus ' : ''}${Math.abs(d).toFixed(dec)} ${SPOKEN[displayUnit] ?? unitText}`.trim();
  };
  const model: ControlModel = {
    path, op: op.name, arg, label, group, doc: spec.doc, widget, type, storageUnit, displayUnit, scale, step,
    detents: (ui.detents ?? []).map(toDisplay), defaultValue: spec.default, toDisplay, fromDisplay, format, valueText, valueLabel,
    ...(spec.valuesFrom ? { valuesFrom: spec.valuesFrom } : {}),
    ...(spec.min !== undefined ? { min: spec.min } : {}),
    ...(spec.max !== undefined ? { max: spec.max } : {}),
    ...(spec.usual ? { usual: spec.usual } : {}),
    ...(spec.usualHint ? { usualHint: spec.usualHint } : {}),
    ...(values ? { values } : {}),
    ...(ui.components ? { components: ui.components } : type === 'vec3' ? { components: ['R', 'G', 'B'] as [string, string, string] } : {}),
    ...(aside ? { aside } : {}),
  };
  if (isFstop) model.values = FSTOPS_THIRD.filter((n) => (spec.min === undefined || n >= spec.min - 1e-9) && (spec.max === undefined || n <= spec.max + 1e-9)).map(String);
  return model;
}

/** One control per recipe path owned by an argument with ui metadata (first owner wins). */
export function generateControls(ops: readonly OpDef[]): ControlModel[] {
  const out: ControlModel[] = [];
  const seen = new Set<string>();
  for (const op of ops) {
    if (op.internal) continue;
    for (const [arg, spec] of Object.entries(op.args)) {
      const path = argPath(op, arg, spec);
      if (!path || seen.has(path)) continue;
      const m = modelFor(op, arg, spec, path);
      if (!m) continue;
      seen.add(path);
      out.push(m);
    }
  }
  return out;
}

