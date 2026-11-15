// cb.kits.stack, the editors (headless): what the params panel's per-op editors read and write, and what they
// measure. An editor is data, `{ form, covers }`: the form the panel mounts for a layer of its op (props `entry` and
// `stage`) and the arguments it edits (the generic controls skip them). The built-in ones (curve, levels, hsl, grade,
// mixer) are `stack.editors`; a new op adds one with
// `stack.panels.params({ editors: { ...stack.editors, myOp: stack.editor('my.form', ['a', 'b']) } })`.
//
// The numbers are core's, never re-derived here (studio-kit does not import core): a host injects the service
// `editorMath` (core's `toneCurve`/`evalCurve`, `evalLevels`, `encodeTransform`/`applyEncode`), so the curve an
// editor draws is the one the engine applies and the eyedropper's OkLab is the one the colour mask measures.
import { Coll, indexOf, type Id, type Json } from '@chromobench/values';
import {
  compile, cutNode, documentKind, readableCuts, STAGES, type ArgSpec, type CutName, type Document, type Engine, type Graph, type ImageInfo, type LinkContext,
  type Node, type SampleData, type StageName,
} from '@chromobench/contract';
import { findEntry } from '../../../src/model/doc.ts';

// ---- the injected numbers ------------------------------------------------------------------------------------------

/** An op encoding inside a stage (contract `OpEncoding`): the stage's XYZ, linear working RGB, OkLab. */
export type Encoding = 'stage' | 'linear' | 'oklab';
export type White = 'D50' | 'D65';
export interface Levels {
  black: number;
  white: number;
  gamma: number;
  outBlack: number;
  outWhite: number;
}

/**
 * Core's functions an editor draws and measures with (the service `editorMath`; hosts build it from
 * @chromobench/core: studio-kit's dev host `demo/editor-math.ts`, the studio's `host/engines.ts`).
 */
export interface EditorMath {
  /** the curve op's function through its points (core `toneCurve` + `evalCurve`) */
  curve(points: readonly { x: number; y: number }[]): (x: number) => number;
  /** the levels op's function (core `evalLevels`) */
  levels(l: Levels): (x: number) => number;
  /** a pixel from one encoding of a stage to another (core `encodeTransform` + `applyEncode`) */
  encode(from: Encoding, to: Encoding, white: White): (v: ArrayLike<number>) => [number, number, number];
}

/** The service, or null when the host gives none. */
export const mathOf = (services: unknown): EditorMath | null => ((services as { editorMath?: EditorMath } | null)?.editorMath ?? null);

// ---- the editors mechanism -----------------------------------------------------------------------------------------

/**
 * An op's editor, as data (a layout built in a sandbox carries it across): the form whose node the params panel
 * mounts for a layer of the op (its props: `entry`, the layer id, and `stage`), and the op's arguments it edits (the
 * panel's generic controls leave them out).
 */
export interface Editor {
  form: string;
  covers: readonly string[];
}
/** Editors by op name. */
export type Editors = Readonly<Record<string, Editor>>;

/** The built-in editors: curve, levels, hsl, grade, mixer. */
export const EDITOR_FORMS: Editors = {
  curve: { form: 'stack.curve', covers: ['channel', 'points'] },
  levels: { form: 'stack.levels', covers: ['channel'] },
  hsl: { form: 'stack.hsl', covers: ['bands'] },
  grade: { form: 'stack.grade', covers: ['shadowsHue_deg', 'shadowsChroma', 'shadowsLightness', 'midtonesHue_deg', 'midtonesChroma', 'midtonesLightness', 'highlightsHue_deg', 'highlightsChroma', 'highlightsLightness'] },
  mixer: { form: 'stack.mixer', covers: ['red', 'green', 'blue', 'monochrome', 'grey'] },
};
/** An editor of a form for an op's layers. */
export const editorOf = (form: string, covers: readonly string[]): Editor => ({ form, covers: [...covers] });

// ---- lists as Colls with per-layer ids -----------------------------------------------------------------------------

/** The letter after the layer id in its list items' ids: `curve1p1`, `hsl1b3`. */
const LIST_LETTER: Record<string, string> = { points: 'p', bands: 'b' };
export const itemPrefix = (layer: Id, arg: string): string => `${layer}${LIST_LETTER[arg] ?? arg.charAt(0)}`;

/** A list argument's default as a Coll, its items named after the layer (`<id>p1`, `<id>p2`, …). */
export function listDefault(layer: Id, arg: string, spec: ArgSpec): Coll<Json> {
  const items = Array.isArray(spec.default) ? (spec.default as Json[]) : [];
  const pre = itemPrefix(layer, arg);
  return Coll.of(items.map((x, i) => [`${pre}${i + 1}`, (x && typeof x === 'object' ? { ...(x as object) } : x) as Json] as const));
}

/** A curve point as the editor holds it. */
export interface Point {
  id?: Id;
  x: number;
  y: number;
}

/** A curve layer's points in order (a stored list without a Coll: its items get no id). */
export function pointsOf(doc: Document | undefined, id: Id): Point[] {
  const e = doc ? findEntry(doc, id)?.entry : undefined;
  const v = e && e.kind === 'layer' ? (e.params as Record<string, unknown>)['points'] : undefined;
  if (Coll.is(v)) return Coll.entries(v as Coll<{ x: number; y: number }>).map(([pid, p]) => ({ id: pid, x: p.x, y: p.y }));
  if (Array.isArray(v)) return (v as { x: number; y: number }[]).map((p) => ({ x: p.x, y: p.y }));
  return [{ x: 0, y: 0 }, { x: 1, y: 1 }];
}

/** The smallest free point id of a layer: not in the document, not among `taken`. */
export function freeItemId(doc: Document, layer: Id, arg: string, taken: Iterable<Id | undefined> = []): Id {
  const idx = indexOf(doc);
  const t = new Set(taken);
  const pre = itemPrefix(layer, arg);
  let n = 1;
  while (idx.has(`${pre}${n}`) || t.has(`${pre}${n}`)) n++;
  return `${pre}${n}`;
}

/** Points → the Coll stored at `<id>.params.points` (ids kept; a point without one gets a free id; 4 decimals). */
export function pointsColl(doc: Document, layer: Id, pts: readonly Point[]): Coll<{ x: number; y: number }> {
  const taken: Id[] = pts.map((p) => p.id).filter((x): x is Id => !!x);
  const sorted = [...pts].sort((a, b) => a.x - b.x);
  return Coll.of(sorted.map((p) => {
    const pid = p.id ?? freeItemId(doc, layer, 'points', taken);
    if (!p.id) taken.push(pid);
    return [pid, { x: Number(p.x.toFixed(4)), y: Number(p.y.toFixed(4)) }] as const;
  }));
}

/** The words of an HSL band, by its centre hue (DEFAULT_HSL_BANDS: Lightroom's eight at OkLCh hues). */
const BAND_WORDS: [number, string][] = [[25, 'Red'], [55, 'Orange'], [105, 'Yellow'], [145, 'Green'], [195, 'Aqua'], [260, 'Blue'], [295, 'Purple'], [330, 'Magenta']];
export function bandWord(centre: number): string {
  let best = BAND_WORDS[0]!;
  const dist = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  for (const w of BAND_WORDS) if (dist(w[0], centre) < dist(best[0], centre)) best = w;
  return dist(best[0], centre) <= 10 ? best[1] : `${Math.round(centre)}°`;
}

// ---- levels' gamma handle ------------------------------------------------------------------------------------------

/** Where the gamma handle sits: the input whose output is half way (Photoshop's midtone slider). */
export const gammaAt = (black: number, white: number, gamma: number): number => black + (white - black) * 0.5 ** gamma;
/** The gamma a midtone handle at x means (held to the catalogue's 0.1–10). */
export function gammaOf(black: number, white: number, x: number): number {
  const t = (x - black) / (white - black);
  if (!(t > 0 && t < 1)) return t <= 0 ? 10 : 0.1;
  return Number(Math.min(10, Math.max(0.1, Math.log(t) / Math.log(0.5))).toFixed(3));
}

// ---- what the stage reads: the histogram of its input, the eyedropper's sample --------------------------------------

/** Where an editor measures: the studio's engine and the frame's graph. */
export interface MeasureHost {
  engine: Engine;
  frames: { get(f: string): { graph: Graph } | undefined };
  links(): LinkContext;
}

/** The XYZ white of a composite stage's images, as the compiler has it: the print's output.white, the scene's D65. */
export const whiteOf = (doc: Document, stage: StageName): White => (stage === 'print' ? doc.output.white : 'D65');

/** The cut a mask of an entry of `stage` reads (`stage-input`: the stage's input). */
export function cutRead(doc: Document, stage: StageName, reads: string | undefined): CutName {
  const r = !reads || reads === 'stage-input' ? STAGES[stage].input : (reads as CutName);
  return r;
}

/** The node of a cut of the frame's document (compiled in the frame's graph, links resolved as the viewer does). */
export function cutOfDoc(host: MeasureHost, f: string, doc: Document, cut: CutName): Node {
  const e = host.frames.get(f);
  if (!e) throw new Error(`frame ${f} is not open`);
  const c = compile(doc, e.graph, { links: host.links() });
  const n = cutNode(c, cut);
  host.engine.adopt(e.graph.closure(n.id));
  return n;
}

/** The channel's lightness of each pixel (L: OkLab L; R, G, B: the cube root of the linear channel), binned on 0–1. */
export function histogramOf(data: SampleData, channels: number, toLightness: (px: ArrayLike<number>) => number, bins = 128): number[] {
  const out = new Array<number>(bins).fill(0);
  const px = [0, 0, 0];
  for (let i = 0; i + 2 < data.length; i += channels) {
    px[0] = data[i]!;
    px[1] = data[i + 1]!;
    px[2] = data[i + 2]!;
    const v = toLightness(px);
    if (!Number.isFinite(v)) continue;
    out[Math.min(bins - 1, Math.max(0, Math.floor(v * bins)))]! += 1;
  }
  return out;
}

/** The lightness a tone layer's channel maps, from a pixel of the stage's XYZ (core's encodings via editorMath). */
export function lightnessOf(math: EditorMath, channel: string, white: White): (px: ArrayLike<number>) => number {
  if (channel === 'L') {
    const f = math.encode('stage', 'oklab', white);
    return (px) => f(px)[0];
  }
  const k = ['R', 'G', 'B'].indexOf(channel);
  const f = math.encode('stage', 'linear', white);
  return (px) => Math.cbrt(f(px)[Math.max(0, k)]!);
}

const HISTS = new Map<string, Promise<number[]>>();
/**
 * The histogram of a stage's input (`STAGES[stage].input`) in a tone channel, at ≤ 256 px on the long side; cached per
 * cut node (content-addressed: the same input, the same histogram) and channel.
 */
export function stageHistogram(host: MeasureHost, math: EditorMath, f: string, doc: Document, stage: StageName, channel: string, bins = 128): Promise<number[]> {
  const n = cutOfDoc(host, f, doc, STAGES[stage].input);
  const key = `${n.id}|${channel}|${whiteOf(doc, stage)}|${bins}`;
  let hit = HISTS.get(key);
  if (!hit) {
    const info = n.info as ImageInfo;
    const scale = Math.min(1, 256 / Math.max(info.width, info.height));
    hit = host.engine.evaluate(n, { scale: scale >= 1 ? 'full' : scale, precision: 'preview' }).then(async (r) => histogramOf(await r.read(), r.info.channels, lightnessOf(math, channel, whiteOf(doc, stage)), bins));
    hit.catch(() => HISTS.delete(key));
    if (HISTS.size > 64) HISTS.delete(HISTS.keys().next().value!);
    HISTS.set(key, hit);
  }
  return hit;
}

/** The mean of a cut over a small box around a document point (the eyedropper's sample), in the cut's encoding. */
export async function sampleCut(host: MeasureHost, f: string, doc: Document, cut: CutName, x: number, y: number, radius = 2): Promise<[number, number, number]> {
  const n = cutOfDoc(host, f, doc, cut);
  const info = n.info as ImageInfo;
  if (info.channels < 3) throw new Error(`the ${cut} cut has no colour`);
  const x0 = Math.max(0, Math.min(info.width - 1, Math.round(x) - radius));
  const y0 = Math.max(0, Math.min(info.height - 1, Math.round(y) - radius));
  const region = { x: x0, y: y0, w: Math.max(1, Math.min(info.width - x0, 2 * radius + 1)), h: Math.max(1, Math.min(info.height - y0, 2 * radius + 1)) };
  const r = await host.engine.evaluate(n, { scale: 'full', region, precision: 'preview' });
  const d = await r.read();
  const c = r.info.channels;
  let s0 = 0, s1 = 0, s2 = 0, k = 0;
  for (let i = 0; i + 2 < d.length; i += c) {
    s0 += d[i]!;
    s1 += d[i + 1]!;
    s2 += d[i + 2]!;
    k++;
  }
  return [s0 / k, s1 / k, s2 / k];
}

/**
 * The eyedropper: the OkLab colour under a document point of the cut a mask of an entry of `stage` reads, converted
 * as the compiler converts the colour component's receiver (`encode('stage', 'oklab', white)`).
 */
export async function sampleOklab(host: MeasureHost, math: EditorMath, f: string, doc: Document, stage: StageName, reads: string | undefined, x: number, y: number): Promise<[number, number, number]> {
  const cut = cutRead(doc, stage, reads);
  if (!readableCuts(stage, documentKind(doc), 'mask').includes(cut) && cut !== STAGES[stage].input) throw new Error(`a mask of the ${stage} stage cannot read ${cut}`);
  const xyz = await sampleCut(host, f, doc, cut, x, y);
  const lab = math.encode('stage', 'oklab', whiteOf(doc, stage))(xyz);
  return [Number(lab[0].toFixed(4)), Number(lab[1].toFixed(4)), Number(lab[2].toFixed(4))];
}

/** CSS for an OkLab colour (a swatch: the browser's oklab() is the same OkLab, white L = 1). */
export const oklabCss = (lab: readonly number[]): string => `oklab(${(Math.max(0, Math.min(1, lab[0] ?? 0)) * 100).toFixed(1)}% ${(lab[1] ?? 0).toFixed(4)} ${(lab[2] ?? 0).toFixed(4)})`;
/** CSS for an OkLCh hue at a fixed lightness and chroma (band swatches, wheel tracks). */
export const oklchCss = (hue: number, chroma = 0.12, l = 0.72): string => `oklch(${(l * 100).toFixed(1)}% ${chroma.toFixed(3)} ${hue.toFixed(1)})`;
