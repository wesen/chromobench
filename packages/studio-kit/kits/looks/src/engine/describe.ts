// What a look does to a frame, in darkroom words (CHB-037 P7): the layers its link expands to, each with the value
// the law gives it at the link's Amount — a filter's printer points and stops scaled (the light law scales density),
// a preflash's fraction, a density mask's gamma, a burn's stops, a print layer's opacity. One line per layer:
//   "Warmth R −1.2 pt, B +1.2 pt", "Contrast mask γ 0.18 (300 µm)", "Edge burn +1/3 st under Edges", "Clarity 0.25 at 60 %"
import { Coll } from '@chromobench/values';
import { linksOf, keyOf, LOGH_PER_POINT, STAGES, type Document, type Entry, type Group, type LinkContext } from '@chromobench/contract';
import type { Id } from '@chromobench/values';
import { formatStops, signed } from '../../../../src/model/units.ts';
import { expansionOf } from './looks.ts';

const STOP = Math.log10(2);
const n2 = (x: number): string => {
  const s = Number(x.toFixed(2)).toString();
  return s.startsWith('-') ? `−${s.slice(1)}` : s;
};

/** One layer of an expanded look at an effective amount (`k`: the product of the link's and the groups' amounts). */
function layerLine(e: Entry, k: number, light: boolean, maskName: (id: Id) => string): string | null {
  if (e.kind === 'group') return null;
  if (e.kind !== 'layer' || !e.enabled) return null;
  const p = e.params as Record<string, unknown>;
  const under = e.mask ? ` under ${maskName(e.mask)}` : '';
  const at = !light && Math.abs(k - 1) > 1e-9 ? ` at ${Math.round(k * 100)} %` : '';
  const a = light ? k : 1;
  switch (e.op) {
    case 'filter': {
      const l = (p['logH'] as number[]).map((x) => x * a);
      const m = (l[0]! + l[1]! + l[2]!) / 3;
      const parts = l.map((x, i) => (Math.abs((x - m) / LOGH_PER_POINT) < 0.05 ? null : `${'RGB'[i]} ${signed((x - m) / LOGH_PER_POINT, 1)} pt`)).filter(Boolean) as string[];
      if (Math.abs(m / STOP) >= 0.01) parts.push(`${formatStops(Math.round((m / STOP) * 6) / 6)} st`);
      return `${e.name} ${parts.length ? parts.join(', ') : '±0'}${under}`;
    }
    case 'preflash': return `${e.name} ${n2(Number(p['fraction']) * a * 100)} %${under}`;
    case 'densityMask': return `${e.name} γ ${n2(Number(p['gamma']) * a)} (${Number(p['radius_um'])} µm, ${p['polarity'] === 'same' ? 'harder' : 'softer'})${under}`;
    case 'burn': case 'dodge': case 'flash': {
      if (p['stops'] !== undefined) return `${e.name} ${formatStops(Math.round(Number(p['stops']) * a * 6) / 6)} st${under}`;
      return `${e.name} ${(Number(p['time_s']) * a).toFixed(1)} s${under}`;
    }
    case 'clarity': return `${e.name} ${n2(Number(p['strength']))}${at}${under}`;
    default: return `${e.name}${at}${under}`;
  }
}

function groupLines(g: Group, k: number, light: boolean, maskName: (id: Id) => string): string[] {
  if (!g.enabled) return [];
  const out: string[] = [];
  for (const e of Coll.values(g.stack)) {
    if (e.kind === 'group') out.push(...groupLines(e, k * e.amount, light, maskName));
    else {
      const t = layerLine(e, k * e.amount, light, maskName);
      if (t) out.push(t);
    }
  }
  return out;
}

/** The lines of a frame's look (every stage of its key); its name alone when it cannot expand here (no image size). */
export function lookLines(doc: Document, key: Id, ctx: LinkContext = {}): string[] {
  const out: string[] = [];
  let parts: ReturnType<typeof expansionOf>;
  try {
    parts = expansionOf(doc, key, ctx);
  } catch {
    const l = linksOf(doc).find((x) => keyOf(x) === key);
    return l ? [l.entry.name] : [];
  }
  for (const { stage, group } of parts) {
    const light = STAGES[stage].law === 'light';
    const maskName = (id: Id): string => doc.masks.items[id]?.name ?? id.split('--').pop()!.replace(/^\w/, (c) => c.toUpperCase());
    out.push(...groupLines(group, group.amount, light, maskName));
  }
  return out;
}

/** The looks a frame holds (its link entries by key): name, Amount, stages. */
export function appliedLooks(doc: Document): { key: Id; name: string; amount: number; stages: string[]; ref: unknown }[] {
  const by = new Map<Id, { key: Id; name: string; amount: number; stages: string[]; ref: unknown }>();
  for (const l of linksOf(doc)) {
    const k = keyOf(l);
    const cur = by.get(k);
    if (cur) cur.stages.push(l.stage);
    else by.set(k, { key: k, name: l.entry.name, amount: l.entry.amount, stages: [l.stage], ref: l.entry.ref });
  }
  return [...by.values()];
}
