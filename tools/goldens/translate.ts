// The one-off translation of the P0 golden recipes (recipe v2, stored as cases/<id>/recipe.json) into format-3
// documents (cases/<id>/document.json), CHB-037 P2b, by design §23's mapping and the plan's translation rules
// (design-doc 01, "Amendments after P2a"). The recipes are read as plain JSON: nothing of the deleted recipe model
// is imported. The pictures stay as they are (the oracle); only the compile step changes.
//
//   node tools/goldens/translate.ts        rewrite every document.json and the index (format chromobench-goldens/2)
//
// Rules:
//   - scan umPerPx 6 (the fixtures had none: today's DEFAULT_FILM_UM_PER_PX), darkroom magnification 8 (null was the
//     calibration's reference), a camera file's film format long edge from capture.format;
//   - main time, f-stop and filtration → main.params; lights → lights.params.logH, the AutoBalance record → lights.source;
//   - exposures → dodge / burn (split = a burn with its pack) / flash (with `through`); one without time or stops gets
//     the main time; density masks → densityMask layers (amount → gamma); preflash → a preflash layer;
//   - masks (node closures) → mask values: gradient → linear, or-ed shapes → `add` components, `mask.and` → an
//     `intersect` component (the product, design D4: the one legitimate change), not → invert, feather px → mm on the
//     print (px × paper µm/px / 1000: 48 µm/px for the scans, 3000 for the camera file); luminance of the scan reads
//     `source`, luminance of the main exposure reads `darkroom.main`;
//   - retouch spots → print-stage heal / clone layers in a group `retouch` (one layer per spot, natural id order);
//     scan dust spots → scan-stage heal layers in a group `dust` (sources chosen beside each speck: the recipe had none);
//   - finishing clarity (radius in preview px) → a print-stage clarity layer, radius px × 48 µm / 1000 mm;
//   - view.frame → geometry, view.output → output (export.recipe → export.document);
//   - the camera file's white balance (CHB-048, contract 3.0: a temperature and a tint in Lightroom's units, applied as
//     CAT16 to D65): P0's 'daylight' (no adaptation) → NO_CORRECTION (D65's white), 'as-shot' → the camera fixture's
//     as-shot white, 'custom' → the temperature and tint of P0's white (daylight locus ≥ 4000 K, its own tint scale).
import { readFileSync } from 'node:fs';
import { asShotWhiteBalance, assertDocument, NO_CORRECTION, nodeId, whiteBalanceOf, xyToXYZ, type Document, type Entry, type Mask, type MaskComponent, type SourceInfo, type WhiteBalance } from '@chromobench/contract';
import { canonicalJSON, Coll, type Json } from '@chromobench/values';
import { dataPath, FORMAT, openAll, readIndex, writeData, type GoldenIndex, type IndexCase } from './golden.ts';

/** The old recipe, read as data (its types are deleted). */
type R = Record<string, any>;

/** Film µm per document pixel of the scans (the fixtures' implicit pitch) and the darkroom magnification. */
export const SCAN_UM_PER_PX = 6;
export const MAGNIFICATION = 8;

/** Sources of the dust heal (the recipe's scan.dust.spots had none; the retouch case's spots use the same ones). */
const DUST_SOURCES: Record<string, { x: number; y: number }> = { d1: { x: 24.5, y: 31.5 }, d2: { x: 61.5, y: 56.5 }, d3: { x: 84.5, y: 15.5 } };

const natural = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });

/**
 * P0's custom white (core film/camera.ts before CHB-048): the CIE daylight locus from 4000 K, the Planckian locus (Kim
 * et al.) below, its tint 150 units = Δv' 0.02 in CIE 1976 u'v'. Only the translation of the P0 recipes uses it.
 */
function p0CustomWhite(T: number, tint: number): [number, number] {
  let x: number, y: number;
  if (T >= 4000) {
    const t = Math.min(T, 25000);
    x = t <= 7000 ? -4.607e9 / t ** 3 + 2.9678e6 / t ** 2 + 0.09911e3 / t + 0.244063 : -2.0064e9 / t ** 3 + 1.9018e6 / t ** 2 + 0.24748e3 / t + 0.23704;
    y = -3 * x * x + 2.87 * x - 0.275;
  } else {
    const t = Math.max(T, 1667);
    x = -0.2661239e9 / t ** 3 - 0.2343589e6 / t ** 2 + 0.8776956e3 / t + 0.17991;
    y = t <= 2222 ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683 : -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867;
  }
  if (tint !== 0) {
    const d = -2 * x + 12 * y + 3;
    const u = (4 * x) / d;
    const v = (9 * y) / d - (tint / 150) * 0.02;
    const e = 6 * u - 16 * v + 12;
    x = (9 * u) / e;
    y = (4 * v) / e;
  }
  return [x, y];
}

/** The camera fixture's colour (its as-shot neutral). */
const cameraFixture = (): SourceInfo['camera'] => (JSON.parse(readFileSync(dataPath('fixtures/camera-96x64.json'), 'utf8')) as SourceInfo).camera;

/** A P0 white balance ({ mode, temperature_K, tint }) as contract 3.0's temperature and tint. */
export function translateWhiteBalance(wb: R): WhiteBalance {
  if (wb['mode'] === 'daylight') return { ...NO_CORRECTION };
  if (wb['mode'] === 'as-shot') return asShotWhiteBalance(cameraFixture()) ?? fail('the camera fixture has no as-shot neutral');
  return whiteBalanceOf(xyToXYZ(...p0CustomWhite(wb['temperature_K'], wb['tint'])));
}

function entry(e: Partial<Entry> & Pick<Entry, 'kind' | 'name'>): Record<string, unknown> {
  return { enabled: true, amount: 1, mask: null, blend: e.kind === 'group' ? 'pass' : 'normal', source: { kind: 'user' }, ...e };
}
const layer = (op: string, name: string, params: Record<string, unknown>, over: Record<string, unknown> = {}): Record<string, unknown> => ({ kind: 'layer', op, ...entry({ kind: 'layer', name, ...over } as never), params });
const group = (name: string, stack: Coll<unknown>, over: Record<string, unknown> = {}): Record<string, unknown> => ({ ...entry({ kind: 'group', name, ...over } as never), kind: 'group', stack });

// ---- masks: node closures → mask values ---------------------------------------------------------

interface NodeRec { op: string; inputs: string[]; args: R }

/** A closure's root (its last def) and its defs by id: a def's id is not stored, so it is recomputed (nodeId). */
function closureTree(nodes: NodeRec[]): { root: NodeRec; byInput: (id: string) => NodeRec } {
  const ids = new Map<string, NodeRec>();
  for (const n of nodes) ids.set(nodeId({ op: n.op, inputs: n.inputs, args: n.args }), n);
  return { root: nodes[nodes.length - 1]!, byInput: (id) => ids.get(id) ?? fail(`mask closure: unknown input ${id.slice(0, 12)}`) };
}

function fail(msg: string): never {
  throw new Error(`translate: ${msg}`);
}

interface MaskParts { comps: { kind: MaskComponent['kind']; params: R; combine: MaskComponent['combine'] }[]; featherPx: number; invert: boolean; reads: Mask['reads'] }

function maskParts(n: NodeRec, at: (id: string) => NodeRec): MaskParts {
  const geom = (kind: MaskComponent['kind'], params: R): MaskParts => ({ comps: [{ kind, params, combine: 'add' }], featherPx: 0, invert: false, reads: 'stage-input' });
  switch (n.op) {
    case 'mask.gradient': return geom('linear', { from: n.args['from'], to: n.args['to'] });
    case 'mask.ellipse': return geom('ellipse', { box: n.args['box'], angle_deg: n.args['angle_deg'] ?? 0 });
    case 'mask.paint': {
      const strokes = (JSON.parse(n.args['strokes'] as string) as R[]).map((s) => ({ points: s['points'], radius: s['radius'], hardness: s['hardness'] ?? 0.5, mode: s['mode'] ?? 'add' }));
      return geom('paint', { strokes });
    }
    case 'mask.luminance': {
      const recv = at(n.inputs[0]!);
      const reads = recv.op === 'source.open' ? 'source' : recv.op === 'print.expose' ? 'darkroom.main' : fail(`luminance of ${recv.op}`);
      return { comps: [{ kind: 'luminance', params: { above: n.args['above'], below: n.args['below'], softness: n.args['softness'] }, combine: 'add' }], featherPx: 0, invert: false, reads };
    }
    case 'mask.or': case 'mask.and': {
      const a = maskParts(at(n.inputs[0]!), at), b = maskParts(at(n.args['other'] as string), at);
      if (a.featherPx || a.invert || b.featherPx || b.invert) fail(`${n.op} of a feathered or inverted mask`);
      if (n.op === 'mask.and' && b.comps.length !== 1) fail('mask.and of a compound mask');
      const reads = a.reads === b.reads || b.reads === 'stage-input' ? a.reads : a.reads === 'stage-input' ? b.reads : fail('masks read two cuts');
      const bc = b.comps.map((c) => ({ ...c, combine: n.op === 'mask.and' ? ('intersect' as const) : ('add' as const) }));
      return { comps: [...a.comps, ...bc], featherPx: 0, invert: false, reads };
    }
    case 'mask.feather': {
      const a = maskParts(at(n.inputs[0]!), at);
      if (a.featherPx || a.invert) fail('feather after feather or not');
      return { ...a, featherPx: n.args['radius_px'] as number };
    }
    case 'mask.not': return { ...maskParts(at(n.inputs[0]!), at), invert: true };
    default: return fail(`mask op ${n.op}`);
  }
}

function translateMask(id: string, name: string, spec: { nodes: NodeRec[] }, paperUmPerPx: number): Mask {
  const t = closureTree(spec.nodes);
  const p = maskParts(t.root, t.byInput);
  const components = Coll.of(p.comps.map((c, i) => [`${id}_c${i + 1}`, {
    kind: c.kind, combine: c.combine, amount: 1, enabled: true,
    params: c.kind === 'paint' ? { strokes: Coll.of((c.params['strokes'] as R[]).map((s, j) => [`${id}_c${i + 1}_s${j + 1}`, s] as const)) } : c.params,
  } as MaskComponent] as const));
  return { name, components, feather_mm: (p.featherPx * paperUmPerPx) / 1000, invert: p.invert, reads: p.reads };
}

// ---- the document -------------------------------------------------------------------------------

export function translate(r: R): Document {
  const neg = r['kind'] === 'negative-scan';
  const pr = r['print'], view = r['view'], e = pr['enlarger'];
  const magnification = (e['magnification'] as number | null) ?? MAGNIFICATION;
  const filmUmPerPx = neg ? SCAN_UM_PER_PX : (r['capture']['format']['longEdge_mm'] * 1000) / 96;
  const paper = filmUmPerPx * magnification;
  if (!neg && (r['capture']['adapt'] !== 'to-film-reference' || r['capture']['autoExposure']['method'] !== 'off')) fail('capture.adapt / autoExposure were never compiled but differ here');

  // darkroom
  const tMain = e['time_s'] as number;
  const dark: [string, unknown][] = [
    ['main', layer('expose', 'Main exposure', { time_s: tMain, fstop: e['fstop'], filtration: e['filtration'] })],
    ['lights', layer('filter', 'Printer lights', { logH: pr['lights']['logH'] }, pr['lights']['auto'] ? { source: { kind: 'auto', ...pr['lights']['auto'] } } : {})],
  ];
  for (const x of pr['exposures'] as R[]) {
    const timing = x['time_s'] !== null ? { time_s: x['time_s'] } : x['stops'] !== null ? { stops: x['stops'] } : { time_s: tMain };
    const over = { enabled: x['enabled'], mask: x['mask'] };
    const name = `${x['kind'][0].toUpperCase()}${x['kind'].slice(1)} ${x['id']}`;
    switch (x['kind']) {
      case 'dodge': dark.push([x['id'], layer('dodge', name, timing, over)]); break;
      case 'burn': case 'split': dark.push([x['id'], layer('burn', name, { ...timing, ...(x['filtration'] ? { filtration: x['filtration'] } : {}) }, over)]); break;
      case 'flash': dark.push([x['id'], layer('flash', name, { ...timing, ...(x['filtration'] ? { filtration: x['filtration'] } : {}), through: x['through'] ?? 'base' }, over)]); break;
      default: fail(`exposure kind ${x['kind']}`);
    }
  }
  for (const [id, d] of Object.entries(pr['densityMasks'] as Record<string, R>)) {
    dark.push([id, layer('densityMask', `${d['kind']} mask ${id}`, { gamma: d['amount'], radius_um: d['radius_um'], polarity: d['polarity'] }, { enabled: d['enabled'] })]);
  }
  if (pr['preflash']) dark.push(['preflash', layer('preflash', 'Preflash', { fraction: pr['preflash'] })]);

  // print: retouch spots (natural id order, as recipe v2 composited them), then clarity
  const printStack: [string, unknown][] = [];
  const spots = Object.entries(r['retouch']['spots'] as Record<string, R>).sort(([a], [b]) => natural(a, b));
  if (spots.length) {
    const layers = spots.map(([id, s]) => [id, layer(s['mode'], `${s['mode'] === 'heal' ? 'Heal' : 'Clone'} ${id}`, {
      spots: Coll.of([[`${id}_spot`, { x: s['x'], y: s['y'], r: s['r'], src: s['src'], feather: s['feather'], opacity: s['opacity'] }]]),
    }, { enabled: s['enabled'] })] as const);
    printStack.push(['retouch', group('Retouch', Coll.of(layers))]);
  }
  const fin = r['finishing']['values'];
  if (fin['clarity']) printStack.push(['clarity', layer('clarity', 'Clarity', { strength: fin['clarity'], radius_mm: (fin['clarity_radius_px'] * paper) / 1000 })]);

  const masks = Coll.of(Object.entries(r['masks'] as Record<string, { nodes: NodeRec[] }>).map(([id, m]) => [id, translateMask(id, id, m, paper)] as const));
  const out = view['output'];
  // CHB-047 (contract 1.6): the recipe's scale ('full' in every P0 recipe) is the export size; JPEG quality is new
  const { recipe: travel, scale: _scale, ...exp } = out['export'];
  const stages: R = {
    darkroom: { medium: { paper: pr['paper'], aim: pr['aim'], mode: e['mode'], lamp: e['lamp'], magnification, grade: pr['grade'] }, stack: Coll.of(dark) },
    print: { medium: { illuminant: view['illuminant'], flare: view['flare'] }, stack: Coll.of(printStack) },
  };
  if (neg) {
    const s = r['scan'];
    const dust = (s['dust']['spots'] as R[]).map((d) => [d['id'], layer('heal', `Dust ${d['id']}`, {
      spots: Coll.of([[`${d['id']}_spot`, { x: d['x'], y: d['y'], r: d['r'], src: DUST_SOURCES[d['id']] ?? fail(`no dust source for ${d['id']}`), feather: 0.3, opacity: 1 }]]),
    })] as const);
    stages['scan'] = {
      medium: { scanner: s['scanner'], stock: s['stock'], format: s['format'], umPerPx: SCAN_UM_PER_PX, rebate: s['rebate'], baseT: s['baseT'], flat: s['flat'], openGate: s['openGate'], flare: s['flare'] },
      stack: dust.length ? Coll.of([['dust', group('Dust', Coll.of(dust))]]) : Coll.empty(),
    };
  } else {
    const c = r['capture'], d = c['development'];
    stages['scene'] = { medium: { whiteBalance: translateWhiteBalance(c['whiteBalance']) }, stack: Coll.empty() };
    stages['film'] = { medium: { stock: c['stock'], exposureEV: c['exposureEV'], format: c['format'], push: d['push'], dir: d['dir'], halation: d['halation'], grain: d['grain'] }, stack: Coll.empty() };
  }
  const doc = {
    format: 3, frame: r['frame'], source: r['source'], data: r['data'], stages, masks, probes: Coll.empty(),
    geometry: view['frame'], output: { rendering: out['rendering'], white: out['white'], display: out['display'], export: { ...exp, size: { by: 'original' }, quality: 90, document: travel }, printer: out['printer'] },
  };
  const parsed = JSON.parse(canonicalJSON(doc as unknown as Json)) as Document;
  assertDocument(parsed);
  return parsed;
}

// ---- the run ------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const index = readIndex() as GoldenIndex & { skipped?: { id: string; title: string; exercises: string[]; fixture: string; recipe: string }[] };
  const ge = await openAll(index);
  const all = [...index.cases, ...(index.skipped ?? [])];
  const cases: IndexCase[] = [];
  for (const c of all) {
    const dir = `cases/${c.id}`;
    // the stacks (stacks.ts) have no recipe: they stay as they are
    if (!(c as { recipe?: string }).recipe) {
      cases.push(c as IndexCase);
      continue;
    }
    const recipe = JSON.parse(readFileSync(dataPath(`${dir}/recipe.json`), 'utf8')) as R;
    const doc = translate(recipe);
    writeData(`${dir}/document.json`, `${JSON.stringify(doc, null, 2)}\n`);
    const old = 'cuts' in c ? (c as IndexCase) : null;
    cases.push({ id: c.id, title: c.title, exercises: c.exercises, fixture: c.fixture, document: `${dir}/document.json`, recipe: `${dir}/recipe.json`, cuts: old?.cuts ?? null, ops: ge.ops(doc) });
    console.log(`${c.id.padEnd(30)} ${Coll.size(doc.stages.darkroom.stack)} darkroom entries, ${Coll.size(doc.masks)} masks${old ? '' : '  (new: render it)'}`);
  }
  const next: GoldenIndex = { ...index, format: FORMAT, cases };
  delete (next as { skipped?: unknown }).skipped;
  writeData('index.json', `${JSON.stringify(next, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
