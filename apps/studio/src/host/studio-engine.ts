// The engine the studio talks to when it runs on real physics (CHB-023). It wraps one physics engine
// (GpuEngine, or RefEngine without WebGPU) and adds what neither implements yet, as plain image work
// on the physics engine's results:
//   output.frame    crop, straighten (contract 0.3) and orientation (CHB-011 owns the op; the display chain ends in it)
//   view.inspect    the Negative / Dyes / Base views as display RGB
//   invert.classes  and invert.classify when the physics engine lacks them (the GPU): the per-pixel
//                   classification is core's, injected by the host file (host/engines.ts)
//   output.display  in Display P3 when the engine encodes sRGB only (the GPU): the sRGB result,
//                   re-encoded (both D65, same transfer curve; colours outside sRGB stay clipped)
// Decoding is the host's too (packages/ingest, injected): open() hands the physics engine a decoded
// working image. Everything here speaks only the contract, so it is unit-tested with any engine.
import {
  ChromobenchError, fail, Graph, quantizeScale, sha256Hex, straighten, straightenFootprint,
  type Box, type Domain, type Engine, type EngineCaps, type EngineId, type EvalTarget, type ImageInfo, type ImageResult,
  type Measurement, type MeasureSpec, type Node, type NodeDef, type NodeRef, type Orientation, type SampleData, type SourceInfo,
  type SourceRef, type TableKey, type Vec3,
} from '@chromobench/contract';

/** A decoded scan, reduced to the working image the engines compute on. */
export interface Decoded {
  info: SourceInfo;
  /** Interleaved linear RGB, 0 = black level, 1 = white level, info.width × info.height × 3. */
  data: Float32Array;
  /** Size of the decoded file before reduction. */
  full: { width: number; height: number };
  /** One line per conditioning step taken on open (for the status line and the diary). */
  notes: string[];
  /** Rebate box in working-image px from the film layout (CHB-020), for the new recipe's scan.rebate; null = scan.density's own rule. */
  rebate?: Box | null;
  /** The holder's veil as scan.flare (percent per channel), and the base as scan.baseT (flare-corrected), from conditionScan (contract 0.3). */
  flare?: Vec3 | null;
  baseT?: Vec3 | null;
  /** 'digital-raw': opened as a photo (CHB-012): shot on film by the forward path, no negative conditioning. */
  kind?: 'negative-scan' | 'digital-raw';
  /** What the pixels look like (CHB-027: ingest's guessOpenMode on the working image), whatever the decode mode. */
  guess?: OpenGuess;
  /** A strip of several frames (CHB-027 WS-D, ingest's stripFrames): one box per frame, working-image px; null for one frame. */
  frames?: Box[] | null;
}

/** Photo or negative, guessed from the pixels (ingest's OpenModeGuess, structurally). */
export interface OpenGuess {
  kind: 'photo' | 'negative';
  /** false: ask the photographer, with `kind` preselected */
  confident: boolean;
  /** why, in a photographer's words */
  why: string;
}

/** The decode modes (contract DecodeOptions.mode): 'scan' for a negative, 'photo' for a digital photo. */
export type DecodeMode = 'scan' | 'photo';
/** How to open: guess (auto), or as the photographer says. */
export type OpenAs = 'auto' | 'photo' | 'negative';
/** Asks the photographer when the guess is unsure; resolves to his answer. */
export type AskOpenMode = (guess: OpenGuess, name: string) => Promise<'photo' | 'negative'>;

/** What the host file (engines.ts) provides: everything that needs core, gpu or ingest. */
export interface HostServices {
  /** Decodes in the mode asked (CHB-027: explicit, per file) and guesses photo or negative from the pixels. */
  decode(bytes: Uint8Array, sha256: string, name: string, mode: DecodeMode): Promise<Decoded>;
  /** The decode to try first when guessing (classifier hook: ingest's openPrior): a camera RAW is decoded as a photo. */
  prior?(name: string): 'photo' | 'negative' | null;
  /** Drops a source and everything computed from it in the physics engine (before the file is decoded another way). */
  forget?(engine: Engine, sha256: string): void;
  /** Registers a decoded source with the physics engine (openDecoded, CHB-023 glue in core and gpu). */
  register(engine: Engine, info: SourceInfo, data: Float32Array): void;
  /** Core's per-pixel scan class: density above the rebate, σ per channel, solve residual → 0 ok, 1 blank, 2 below base, 3 out of gamut. */
  classify(D: ArrayLike<number>, sigma: ArrayLike<number>, residual: number): number;
  defaultSigma: Vec3;
  /** Output spaces the physics engine encodes itself (default: all). The GPU encodes sRGB only. */
  nativeSpaces?: readonly string[];
}

/** Ops this wrapper computes itself when the physics engine does not. */
export const HOST_OPS = ['output.frame', 'view.inspect', 'invert.classes', 'invert.classify'] as const;

/** Linear sRGB → linear Display P3 (both D65). */
const SRGB_TO_P3 = [
  [0.8224621, 0.177538, 0], [0.0331941, 0.9668058, 0], [0.0170827, 0.0723974, 0.9105199],
] as const;
const srgbDecode = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** sRGB-encoded pixels → Display-P3-encoded pixels (c channels, the first three converted). */
export function srgbToP3(src: SampleData, n: number, c: number): Float32Array {
  const out = new Float32Array(n * c);
  const l = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) l[k] = srgbDecode(src[i * c + Math.min(k, c - 1)]!);
    for (let k = 0; k < 3; k++) {
      const m = SRGB_TO_P3[k]!;
      out[i * c + k] = srgb(m[0] * l[0]! + m[1] * l[1]! + m[2] * l[2]!);
    }
    for (let k = 3; k < c; k++) out[i * c + k] = src[i * c + k]!;
  }
  return out;
}

const srgb = (v: number): number => {
  const x = Math.min(1, Math.max(0, v));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
};

/** Class colours for the Base view: ok dim grey, blank film blue, below base yellow, out of gamut magenta. */
export const CLASS_RGB: Vec3[] = [[0.32, 0.32, 0.32], [0.25, 0.55, 1], [1, 0.85, 0.1], [1, 0.2, 0.75]];

/** Oriented box → box in the receiver's grid (receiver size w × h). */
export function unorientBox(o: Orientation, b: Box, w: number, h: number): Box {
  const un = (x: number, y: number): [number, number] => {
    switch (o) {
      case 'none': return [x, y];
      case 'flipH': return [w - x, y];
      case 'flipV': return [x, h - y];
      case 'rot180': return [w - x, h - y];
      case 'cw90': return [y, h - x];
      case 'ccw90': return [w - y, x];
      case 'transpose': return [y, x];
      case 'transverse': return [w - y, h - x];
    }
  };
  const a = un(b.x, b.y);
  const c = un(b.x + b.w, b.y + b.h);
  return { x: Math.min(a[0], c[0]), y: Math.min(a[1], c[1]), w: Math.abs(a[0] - c[0]), h: Math.abs(a[1] - c[1]) };
}

const swaps = (o: Orientation): boolean => o === 'cw90' || o === 'ccw90' || o === 'transpose' || o === 'transverse';

/** Reorients interleaved pixels (w × h, c channels) for display: output pixel (x′, y′) reads input (x, y). */
export function orientPixels(o: Orientation, src: SampleData, w: number, h: number, c: number): { data: Float32Array | Float64Array; width: number; height: number } {
  const [W, H] = swaps(o) ? [h, w] : [w, h];
  // the engine's sample type, so a reoriented pixel is bit-identical
  const out = src instanceof Float64Array ? new Float64Array(W * H * c) : new Float32Array(W * H * c);
  for (let y2 = 0; y2 < H; y2++) {
    for (let x2 = 0; x2 < W; x2++) {
      let x = x2, y = y2;
      switch (o) {
        case 'none': break;
        case 'flipH': x = w - 1 - x2; break;
        case 'flipV': y = h - 1 - y2; break;
        case 'rot180': x = w - 1 - x2; y = h - 1 - y2; break;
        case 'cw90': x = y2; y = h - 1 - x2; break;
        case 'ccw90': x = w - 1 - y2; y = x2; break;
        case 'transpose': x = y2; y = x2; break;
        case 'transverse': x = w - 1 - y2; y = h - 1 - x2; break;
      }
      const i = (y * w + x) * c, j = (y2 * W + x2) * c;
      for (let k = 0; k < c; k++) out[j + k] = src[i + k]!;
    }
  }
  return { data: out, width: W, height: H };
}

/** Display RGB for an inspection view of `domain` data (c channels per pixel). */
export function inspectPixels(mode: string, domain: Domain, src: SampleData, n: number, c: number): Float32Array {
  const out = new Float32Array(n * 3);
  const ch = (i: number, k: number): number => src[i * c + Math.min(k, c - 1)]!;
  if (mode === 'classes' || domain === 'scan-classes') {
    for (let i = 0; i < n; i++) {
      const rgb = CLASS_RGB[Math.max(0, Math.min(3, Math.round(ch(i, 0))))]!;
      out.set(rgb, i * 3);
    }
    return out;
  }
  if (domain === 'film-dyes' || domain === 'paper-dyes' || domain === 'scanner-density') {
    // Transmittance of each layer alone: the negative without its orange mask (dyes), or above base (density).
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) out[i * 3 + k] = srgb(10 ** -ch(i, k));
    return out;
  }
  // camera-linear (the negative as scanned) and anything else: scaled so the brightest 0.1 % sits at white.
  const g: number[] = [];
  const step = Math.max(1, Math.floor(n / 20000));
  for (let i = 0; i < n; i += step) g.push(Math.max(ch(i, 0), ch(i, 1), ch(i, 2)));
  g.sort((a, b) => a - b);
  const top = g.length ? g[Math.min(g.length - 1, Math.floor(g.length * 0.999))]! : 1;
  const s = top > 1e-6 ? 1 / top : 1;
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) out[i * 3 + k] = srgb(ch(i, k) * s);
  return out;
}

const result = (n: Node, info: ImageInfo, base: { region: Box; scale: number; warnings: ImageResult['warnings'] }, data: SampleData, width: number, height: number): ImageResult => ({
  node: n.id, info, scale: base.scale, region: { ...base.region }, width, height, format: data instanceof Float64Array ? 'f64' : 'f32',
  read: async () => data.slice(), warnings: [...base.warnings],
});

export class StudioEngine implements Engine {
  readonly id: EngineId;
  /** Replaced when a source is decoded another way (re-open as photo / negative). */
  graph = new Graph();
  readonly primary: Engine;
  /** What the status line shows: engine, adapter, working size. */
  readonly label: string;
  private readonly host: HostServices;
  private readonly ops: Set<string>;
  private readonly supported = new Map<string, boolean>();
  /** Notes of the last open() per source (conditioning steps). */
  readonly notes = new Map<string, Decoded>();

  constructor(primary: Engine, host: HostServices, label: string) {
    this.primary = primary;
    this.id = primary.id;
    this.host = host;
    this.label = label;
    this.ops = new Set(primary.capabilities().ops);
  }

  capabilities(): EngineCaps {
    const c = this.primary.capabilities();
    return { ...c, ops: [...new Set([...c.ops, ...HOST_OPS])].sort() };
  }

  /** Engine.open: decodes as the pixels suggest (a guess that is unsure stays with the first decode). */
  async open(source: SourceRef): Promise<SourceInfo> {
    return (await this.openAs(source, 'auto')).info;
  }

  /**
   * Opens a source as a photo, as a negative, or as the pixels suggest (CHB-027, F1). 'auto' decodes in the
   * file type's likely mode first (a camera RAW as a photo, everything else as a scan), reads the guess, asks
   * when it is unsure and `ask` is given, and decodes again in the other mode when the answer differs.
   */
  async openAs(source: SourceRef, as: OpenAs, ask?: AskOpenMode): Promise<{ info: SourceInfo; kind: 'negative-scan' | 'digital-raw'; guess: OpenGuess | null; frames: Box[] | null }> {
    if (!source.bytes) fail('E_FORMAT', 'open needs source.bytes');
    const bytes = source.bytes instanceof Uint8Array ? source.bytes : new Uint8Array(source.bytes);
    const sha = source.sha256 || sha256Hex(bytes);
    const name = source.name ?? source.path ?? 'scan';
    let mode: DecodeMode = as === 'photo' ? 'photo' : as === 'negative' ? 'scan' : this.host.prior?.(name) === 'photo' ? 'photo' : 'scan';
    // the decoder may transfer the bytes to its worker (LibRaw): keep a copy for a second decode
    const again = as === 'auto' ? bytes.slice() : null;
    let d = await this.host.decode(bytes, sha, name, mode);
    if (again && d.guess) {
      const want = d.guess.confident || !ask ? d.guess.kind : await ask(d.guess, name);
      const m2: DecodeMode = want === 'photo' ? 'photo' : 'scan';
      if (m2 !== mode) {
        mode = m2;
        d = await this.host.decode(again, sha, name, mode);
      }
    }
    const kind = d.kind ?? (mode === 'photo' ? 'digital-raw' : 'negative-scan');
    const before = this.notes.get(sha);
    if (before && (before.kind ?? 'negative-scan') !== kind) this.forget(sha);
    this.host.register(this.primary, d.info, d.data);
    this.graph.registerSource(d.info);
    this.notes.set(sha, { ...d, kind });
    return { info: d.info, kind, guess: d.guess ?? null, frames: d.frames ?? null };
  }

  /** The file is decoded another way now: drop what the engines computed from the old decode. */
  private forget(sha: string): void {
    this.host.forget?.(this.primary, sha);
    const old = this.graph;
    this.graph = new Graph();
    for (const k of this.notes.keys()) {
      const info = k === sha ? undefined : old.source(k);
      if (info) this.graph.registerSource(info);
    }
    this.supported.clear();
    this.notes.delete(sha);
  }

  adopt(defs: readonly NodeDef[]): void {
    this.graph.adopt(defs);
    this.primary.adopt(defs);
  }

  async prepare(keys: TableKey[]): Promise<void> {
    await this.primary.prepare(keys);
  }

  dispose(): void {
    this.primary.dispose();
  }

  private node(ref: NodeRef): Node {
    return this.graph.get(ref.id) ?? fail('E_NO_NODE', `unknown node ${ref.id.slice(0, 12)}…`, { hint: 'engine.adopt(graph.closure(id)) first' });
  }

  /** True when the physics engine computes the node's whole closure. */
  private native(n: Node): boolean {
    let ok = this.supported.get(n.id);
    if (ok === undefined) {
      const spaces = this.host.nativeSpaces;
      ok = this.graph.closure(n.id).every((d) => this.ops.has(d.op) && (!spaces || d.op !== 'output.display' || spaces.includes(d.args['space'] as string)));
      this.supported.set(n.id, ok);
    }
    return ok;
  }

  async evaluate(ref: NodeRef, target: EvalTarget): Promise<ImageResult> {
    const n = this.node(ref);
    if (this.native(n)) return this.primary.evaluate(n, target);
    switch (n.op) {
      case 'output.frame': return this.frame(n, target);
      case 'view.inspect': return this.inspect(n, target);
      case 'output.display': {
        if (n.args['space'] !== 'display-p3') break;
        const twin = this.graph.intern('output.display', n.inputs, { ...n.args, space: 'srgb' }).node;
        this.primary.adopt(this.graph.closure(twin.id));
        const r = await this.evaluate(twin, target);
        return result(n, n.info as ImageInfo, r, srgbToP3(await r.read(), r.width * r.height, r.info.channels), r.width, r.height);
      }
      case 'invert.classes': {
        const c = await this.classes(this.node({ id: n.inputs[0]!, info: n.info }), n.args['sigma'] as Vec3 | undefined, target);
        return result(n, n.info as ImageInfo, c.base, c.codes, c.width, c.height);
      }
      default: break;
    }
    const missing = [...new Set(this.graph.closure(n.id).map((d) => d.op).filter((op) => !this.ops.has(op)))];
    return fail('E_NOT_IMPLEMENTED', `${missing.join(', ') || n.op} ${missing.length === 1 ? 'is' : 'are'} not implemented on the ${this.primary.id} engine yet`, { valid: [...this.ops] });
  }

  async measure(ref: NodeRef, spec: MeasureSpec = {}): Promise<Measurement> {
    const n = this.node(ref);
    if (this.native(n)) return this.primary.measure(n, spec);
    if (n.op === 'invert.classify') {
      const dyes = this.node({ id: n.inputs[0]!, info: n.info });
      const info = dyes.info as ImageInfo;
      // An analysis-size classification (≈ 0.25 MP), as the reference engine counts at full resolution.
      const scale = Math.min(1, Math.sqrt(250_000 / (info.width * info.height)));
      const c = await this.classes(dyes, n.args['sigma'] as Vec3 | undefined, { scale: quantizeScale(scale), precision: spec.precision ?? 'preview', ...(spec.signal ? { signal: spec.signal } : {}) });
      const count = [0, 0, 0, 0];
      for (const v of c.codes) count[v]!++;
      const N = c.codes.length || 1;
      return { node: n.id, value: { reachable: count[0]! / N, blank: count[1]! / N, belowBase: count[2]! / N, unreachable: count[3]! / N }, warnings: [] };
    }
    const missing = [...new Set(this.graph.closure(n.id).map((d) => d.op).filter((op) => !this.ops.has(op)))];
    return fail('E_NOT_IMPLEMENTED', `${missing.join(', ')} not implemented on the ${this.primary.id} engine yet`);
  }

  // ---- host ops -------------------------------------------------------------------------------

  private async frame(n: Node, target: EvalTarget): Promise<ImageResult> {
    const info = n.info as ImageInfo;
    const inner = this.node({ id: n.inputs[0]!, info: n.info });
    const inInfo = inner.info as ImageInfo;
    const o = (n.args['orientation'] as Orientation | undefined) ?? 'none';
    const crop = (n.args['crop'] as Box | undefined) ?? { x: 0, y: 0, w: inInfo.width, h: inInfo.height };
    const region = target.region ?? { x: 0, y: 0, w: info.width, h: info.height };
    const angle = (n.args['angle_deg'] as number | undefined) ?? 0;
    if (angle !== 0) return this.straightened(n, inner, o, crop, angle, region, target);
    const b = unorientBox(o, region, crop.w, crop.h);
    const inRegion = { x: b.x + crop.x, y: b.y + crop.y, w: b.w, h: b.h };
    const full = inRegion.x === 0 && inRegion.y === 0 && inRegion.w === inInfo.width && inRegion.h === inInfo.height;
    const t: EvalTarget = { scale: target.scale, precision: target.precision, ...(target.signal ? { signal: target.signal } : {}), ...(full ? {} : { region: inRegion }) };
    const r = await this.evaluate(inner, t);
    if (o === 'none') {
      return { ...r, node: n.id, info, region: { ...region }, read: r.read };
    }
    const px = orientPixels(o, await r.read(), r.width, r.height, r.info.channels);
    return result(n, info, { region, scale: r.scale, warnings: r.warnings }, px.data, px.width, px.height);
  }

  /**
   * A straightened crop: the footprint at full resolution, the contract's reference sampling (straighten), the
   * orientation, then the region at the target scale by nearest sampling (as the mock engine scales).
   */
  private async straightened(n: Node, inner: Node, o: Orientation, crop: Box, angle: number, region: Box, target: EvalTarget): Promise<ImageResult> {
    const info = n.info as ImageInfo;
    const inInfo = inner.info as ImageInfo;
    const fp = straightenFootprint(crop, angle, inInfo.width, inInfo.height);
    const whole = fp.x === 0 && fp.y === 0 && fp.w === inInfo.width && fp.h === inInfo.height;
    const r = await this.evaluate(inner, { scale: 'full', precision: target.precision, ...(target.signal ? { signal: target.signal } : {}), ...(whole ? {} : { region: fp }) });
    const c = r.info.channels;
    const st = straighten(await r.read(), r.width, r.height, c, { x: fp.x, y: fp.y }, inInfo.width, inInfo.height, crop, angle, o);
    const px = orientPixels(o, st, crop.w, crop.h, c);
    const scale = quantizeScale(target.scale);
    const width = Math.max(1, Math.round(region.w * scale)), height = Math.max(1, Math.round(region.h * scale));
    const out = new Float64Array(width * height * c);
    for (let y = 0; y < height; y++) {
      const sy = region.y + Math.min(region.h - 1, Math.floor(((y + 0.5) * region.h) / height));
      for (let x = 0; x < width; x++) {
        const sx = region.x + Math.min(region.w - 1, Math.floor(((x + 0.5) * region.w) / width));
        for (let k = 0; k < c; k++) out[(y * width + x) * c + k] = px.data[(sy * px.width + sx) * c + k]!;
      }
    }
    return result(n, info, { region, scale, warnings: r.warnings }, out, width, height);
  }

  private async inspect(n: Node, target: EvalTarget): Promise<ImageResult> {
    const inner = this.node({ id: n.inputs[0]!, info: n.info });
    const r = await this.evaluate(inner, target);
    const src = await r.read();
    const data = inspectPixels(n.args['mode'] as string, r.info.domain, src, r.width * r.height, r.info.channels);
    return result(n, n.info as ImageInfo, r, data, r.width, r.height);
  }

  /** Class codes of a dyes node (invert.dyes ← scan.density …) through the injected core classifier. */
  private async classes(dyes: Node, sigmaArg: Vec3 | undefined, target: EvalTarget): Promise<{ codes: Float32Array; width: number; height: number; base: ImageResult }> {
    if (dyes.op !== 'invert.dyes') throw new ChromobenchError({ code: 'E_NOT_IMPLEMENTED', message: `classes need an invert.dyes receiver, not ${dyes.op}` });
    const scanNode = this.node({ id: dyes.inputs[0]!, info: dyes.info });
    const [rd, rs] = [await this.evaluate(dyes, target), await this.evaluate(scanNode, target)];
    const [d, s] = [await rd.read(), await rs.read()];
    const sigma = sigmaArg ?? this.host.defaultSigma;
    const cd = rd.info.channels, cs = rs.info.channels;
    const N = rd.width * rd.height;
    const codes = new Float32Array(N);
    const D = [0, 0, 0];
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < 3; k++) D[k] = s[i * cs + Math.min(k, cs - 1)]!;
      codes[i] = this.host.classify(D, sigma, cd >= 4 ? d[i * cd + 3]! : 0);
    }
    return { codes, width: rd.width, height: rd.height, base: rd };
  }
}
