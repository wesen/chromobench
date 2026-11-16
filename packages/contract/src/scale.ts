// A document on a source of another size (contract 1.6, CHB-047): every stored coordinate is a document pixel, so a
// document made on one decode of a file (the studio's working image) describes the same print on a decode of another
// size once its pixel quantities are scaled. Which quantities are pixels the catalogue says (unit 'px', the types box,
// point and polyline), so a new op with pixel arguments is scaled without a change here; the fixed parts with pixels
// are the crop, the probes and the scan medium (rebate, open gate, and its µm per pixel, which divides). Physical sizes
// (µm on the film, mm on the print) are converted with the pitch and need nothing; a camera file's pitch is its film
// format over the source's long side, so it follows the source by itself.
//
// x scales by kx, y by ky, a length by √(kx·ky); a box keeps its edges on whole pixels (an edge at the source's border
// stays there, as kx = W′ / W). Bindings are left as they are (a bound value is not a stored coordinate).
import { Coll, isPlainObject } from '@chromobench/values';
import { isBindingRef } from './bindings.ts';
import type { Document, Entry, Mask, MaskComponent, Probe, ScanMedium, Stage, Stages } from './document.ts';
import { isLinked } from './document.ts';
import { fail } from './errors.ts';
import { getOp } from './registry.ts';
import type { ArgSpec, Box } from './spec.ts';

interface K { x: number; y: number; len: number }

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A box scaled with its edges on whole pixels (at least one pixel wide and high). */
export function scaleBox(b: Box, kx: number, ky: number): Box {
  const x0 = Math.round(b.x * kx), y0 = Math.round(b.y * ky);
  const x1 = Math.round((b.x + b.w) * kx), y1 = Math.round((b.y + b.h) * ky);
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

const isBox = (v: unknown): v is Box => isPlainObject(v) && ['x', 'y', 'w', 'h'].every((k) => num(v[k]));
const isPoint = (v: unknown): v is { x: number; y: number } => isPlainObject(v) && num(v['x']) && num(v['y']);

/** One value of an argument with spec s (a list's items through `of`; in a document a list is a Coll). */
function scaleArg(s: ArgSpec, v: unknown, k: K, key: string): unknown {
  if (v === null || v === undefined || isBindingRef(v)) return v;
  switch (s.type) {
    case 'box':
      return isBox(v) ? scaleBox(v, k.x, k.y) : v;
    case 'point':
      return isPoint(v) ? { ...v, x: v.x * k.x, y: v.y * k.y } : v;
    case 'polyline':
      return Array.isArray(v) ? v.map((p) => (Array.isArray(p) && p.length >= 2 ? [p[0] * k.x, p[1] * k.y, ...p.slice(2)] : p)) : v;
    case 'number':
      if (s.unit !== 'px' || !num(v)) return v;
      return v * (key === 'x' ? k.x : key === 'y' ? k.y : k.len);
    case 'list': {
      const of = s.of;
      if (!of) return v;
      const item = (it: unknown): unknown => (isPlainObject(it) ? scaleParams(of, it, k) : it);
      if (Coll.is(v)) return Coll.map(v as Coll<unknown>, (it) => item(it));
      return Array.isArray(v) ? v.map(item) : v;
    }
    default:
      return v;
  }
}

function scaleParams(specs: Readonly<Record<string, ArgSpec>>, p: Readonly<Record<string, unknown>>, k: K): Record<string, unknown> {
  const out: Record<string, unknown> = { ...p };
  for (const [name, v] of Object.entries(p)) {
    const s = specs[name];
    if (s) out[name] = scaleArg(s, v, k, name);
  }
  return out;
}

function scaleEntry(e: Entry, k: K): Entry {
  if (e.kind === 'group') return { ...e, stack: Coll.map(e.stack, (x) => scaleEntry(x, k)) };
  if (e.kind === 'link') return fail('E_DOCUMENT', `link ${JSON.stringify(e.ref)} must be resolved before the document is scaled`, { hint: 'resolveLinks(doc, links) first' });
  return { ...e, params: scaleParams(getOp(e.op).args, e.params as Record<string, unknown>, k) as typeof e.params };
}

function scaleStage<M>(st: Stage<M>, k: K, medium: (m: M) => M = (m) => m): Stage<M> {
  if (isLinked(st.medium)) return fail('E_DOCUMENT', 'a linked medium must be resolved before the document is scaled', { hint: 'resolveLinks(doc, links) first' });
  return { ...st, medium: medium(st.medium as M), stack: Coll.map(st.stack, (e) => scaleEntry(e, k)) };
}

function scaleComponent(c: MaskComponent, k: K): MaskComponent {
  return { ...c, params: scaleParams(getOp(`mask.${c.kind}`).args, c.params as Record<string, unknown>, k) as typeof c.params };
}

/**
 * The document on a source kx × ky the size of the one it was made on (kx = W′/W, ky = H′/H of the two decodes): the
 * same print, its pixel quantities scaled. Expects a link-resolved document (a link left is refused).
 */
export function scaleDocument(doc: Document, kx: number, ky: number): Document {
  if (!(kx > 0 && ky > 0 && Number.isFinite(kx) && Number.isFinite(ky))) fail('E_ARG_RANGE', `scaleDocument: scales ${kx}, ${ky} must be positive`);
  if (kx === 1 && ky === 1) return doc;
  const k: K = { x: kx, y: ky, len: Math.sqrt(kx * ky) };
  const st = doc.stages;
  const stages: Record<string, unknown> = {};
  for (const [name, s] of Object.entries(st) as [keyof Stages, Stage<unknown> | undefined][]) {
    if (!s) continue;
    if (name === 'scan') {
      stages[name] = scaleStage(s as Stage<ScanMedium>, k, (m) => ({
        ...m,
        umPerPx: m.umPerPx / k.len,
        rebate: m.rebate ? scaleBox(m.rebate, kx, ky) : m.rebate,
        openGate: m.openGate && m.openGate !== 'flat' ? scaleBox(m.openGate, kx, ky) : m.openGate,
      }));
    } else stages[name] = scaleStage(s, k);
  }
  const masks = Coll.map(doc.masks, (m: Mask) => ({ ...m, components: Coll.map(m.components, (c) => scaleComponent(c, k)) }));
  const probes = Coll.map(doc.probes, (p: Probe) => ({ ...p, x: p.x * kx, y: p.y * ky, r: p.r * k.len }));
  const crop = doc.geometry.crop;
  return {
    ...doc,
    stages: stages as unknown as Stages,
    masks,
    probes,
    geometry: { ...doc.geometry, crop: crop ? scaleBox(crop, kx, ky) : crop },
  };
}
