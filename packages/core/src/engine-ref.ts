// The reference engine (guide §5.7): implements the contract's Engine with core's f64 physics.
// Slow but exact. Full-resolution results are cached per node id; previews and regions are sampled
// from them (nearest sample, as the mock), so a region is bit-identical to the crop of the full result.
// Modes 'exact' and 'tabulated' (f64 tables through look3, the GPU preview's reference).
import {
  ChromobenchError, fail, getOp, Graph, nodeArgs, quantizeScale, sha256Hex,
  type Box, type Diagnostic, type Domain, type Engine, type EngineCaps, type EvalTarget, type ImageInfo, type ImageResult,
  type Measurement, type MeasureSpec, type Node, type NodeDef, type NodeRef, type SourceInfo, type SourceRef, type TableKey,
} from '@chromobench/contract';
import { readTiff } from '@chromobench/engine-mock';
import { nodePhysicsData as interimData } from '@chromobench/data/node';
import type { PhysicsData } from './data/provider.ts';
import { IMAGE_OPS, newImg, PhysicsEnv, VALUE_OPS, type Img, type OpCtx, type UpNode } from './ops/ops.ts';
import { conventionsKey, DEFAULT_CONVENTIONS, type Conventions } from './spectral/conventions.ts';

export interface RefEngineOptions {
  data?: PhysicsData;
  conv?: Conventions;
  /** Restrict capabilities().ops. */
  ops?: string[];
  /**
   * 'exact' (default): every pixel through the physics. 'tabulated': invert.dyes, print.expose and
   * view.reflect read core's f64 N³ tables with the GPU's texel-centre trilinear lookup (look3), the
   * reference the GPU preview path is compared with (CHB-005 parity).
   */
  mode?: 'exact' | 'tabulated';
  /** Table size in tabulated mode (default 33). */
  N?: number;
}

/** Every op the reference engine implements. */
export const REFERENCE_OPS: readonly string[] = [...Object.keys(IMAGE_OPS), ...Object.keys(VALUE_OPS)].sort();

const cancelled = (): ChromobenchError => new ChromobenchError({ code: 'E_CANCELLED', message: 'evaluation cancelled' });

export class RefEngine implements Engine {
  readonly id = 'reference' as const;
  readonly graph = new Graph();
  private readonly ops: Set<string>;
  private readonly env: PhysicsEnv;
  private readonly conv: Conventions;
  private readonly sources = new Map<string, Img>();
  private readonly full = new Map<string, Img>();
  private readonly results = new Map<string, { data: Float64Array; width: number; height: number; region: Box; scale: number; warnings: Diagnostic[] }>();
  private disposed = false;

  constructor(o: RefEngineOptions = {}) {
    this.conv = o.conv ?? DEFAULT_CONVENTIONS;
    this.env = new PhysicsEnv(o.data ?? interimData(), this.conv, { mode: o.mode ?? 'exact', ...(o.N ? { N: o.N } : {}) });
    this.ops = new Set(o.ops ?? REFERENCE_OPS);
  }

  capabilities(): EngineCaps {
    return {
      ops: [...this.ops].sort(), maxSize: 8192, f16: false, timestamps: false, precision: ['preview', 'export'], available: true,
      adapter: { name: 'reference-f64', fallback: false }, conventions: conventionsKey(this.conv),
    };
  }

  async open(source: SourceRef): Promise<SourceInfo> {
    if (!source.bytes) fail('E_FORMAT', 'RefEngine.open needs source.bytes (decoding from paths is CHB-006)');
    const bytes = source.bytes instanceof Uint8Array ? source.bytes : new Uint8Array(source.bytes);
    const sha = sha256Hex(bytes);
    if (source.sha256 && source.sha256 !== sha) fail('E_DATA_HASH', `source bytes hash to ${sha.slice(0, 12)}…, not ${source.sha256.slice(0, 12)}…`);
    const raw = readTiff(bytes);
    const max = raw.bits === 16 ? 65535 : 255;
    const img = newImg(raw.width, raw.height, 3);
    let clipped = 0;
    for (let i = 0; i < raw.width * raw.height; i++) {
      for (let k = 0; k < 3; k++) {
        const v = raw.data[i * raw.samples + (raw.samples === 3 ? k : 0)]!;
        if (v >= max) clipped++;
        img.data[i * 3 + k] = v / max;
      }
    }
    this.sources.set(sha, img);
    const info: SourceInfo = {
      sha256: sha, format: 'tiff', width: raw.width, height: raw.height, channels: 3, bits: raw.bits, sample: 'uint',
      encoding: { value: 'linear', evidence: 'format' }, levels: { black: [0, 0, 0], white: [max, max, max], from: 'default' },
      cfa: 'none', clippedFraction: clipped / (raw.width * raw.height * 3), notes: [],
    };
    this.graph.registerSource(info);
    return info;
  }

  adopt(defs: readonly NodeDef[]): void {
    this.graph.adopt(defs);
  }

  async prepare(_keys: TableKey[]): Promise<void> {
    // Exact mode builds nothing ahead; tables/ builders serve CHB-005 parity directly.
  }

  dispose(): void {
    this.disposed = true;
    this.full.clear();
    this.results.clear();
  }

  private node(ref: NodeRef): Node {
    return this.graph.get(ref.id) ?? fail('E_NO_NODE', `RefEngine does not know node ${ref.id.slice(0, 12)}…`, { hint: 'engine.adopt(graph.closure(id)) first' });
  }

  private check(n: Node): void {
    if (this.disposed) fail('E_INTERNAL', 'engine disposed');
    if (!this.ops.has(n.op)) fail('E_NOT_IMPLEMENTED', `${n.op} is not implemented by the reference engine`, { valid: [...this.ops] });
  }

  private ctx(n: Node, image: boolean): OpCtx {
    const op = getOp(n.op);
    const nArgs = new Set(nodeArgs(op).flatMap((a) => {
      const v = n.args[a];
      return v === undefined ? [] : ((Array.isArray(v) ? v : [v]) as string[]);
    }));
    const recvId = op.on === 'none' ? undefined : n.inputs[0];
    const recvNode = recvId ? this.graph.get(recvId) : undefined;
    const up = (name: string): UpNode | undefined => {
      let id = recvId;
      for (let guard = 0; id && guard < 10000; guard++) {
        const m = this.graph.get(id);
        if (!m) return undefined;
        if (m.op === name) return { op: m.op, args: m.args, id: m.id, inputs: m.inputs };
        id = getOp(m.op).on === 'none' ? undefined : m.inputs[0];
      }
      return undefined;
    };
    return {
      args: n.args,
      recv: recvId ? this.compute(recvId) : undefined,
      recvDomain: recvNode && recvNode.info.kind === 'Image' ? (recvNode.info.domain as Domain) : undefined,
      extra: n.inputs.slice(recvId ? 1 : 0).filter((i) => nArgs.has(i)).map((i) => this.compute(i)),
      info: image && n.info.kind === 'Image' ? n.info : undefined,
      source: (sha) => this.sources.get(sha) ?? fail('E_NO_SOURCE', `source ${sha.slice(0, 12)}… is not open in the reference engine`),
      up,
      image: (id) => this.compute(id),
      env: this.env,
    };
  }

  private compute(id: string): Img {
    const hit = this.full.get(id);
    if (hit) return hit;
    const n = this.graph.get(id) ?? fail('E_NO_NODE', `unknown node ${id.slice(0, 12)}…`);
    this.check(n);
    const f = IMAGE_OPS[n.op] ?? fail('E_NOT_IMPLEMENTED', `${n.op} has no reference image implementation`);
    const img = f(this.ctx(n, true));
    this.full.set(id, img);
    return img;
  }

  async evaluate(ref: NodeRef, target: EvalTarget): Promise<ImageResult> {
    if (target.signal?.aborted) throw cancelled();
    const n = this.node(ref);
    if (n.info.kind !== 'Image') fail('E_WRONG_KIND', `${n.op} returns a value; use measure()`);
    this.check(n);
    const info = n.info as ImageInfo;
    const region = target.region ?? { x: 0, y: 0, w: info.width, h: info.height };
    if (region.x < 0 || region.y < 0 || region.w <= 0 || region.h <= 0 || region.x + region.w > info.width || region.y + region.h > info.height || ![region.x, region.y, region.w, region.h].every(Number.isInteger)) {
      fail('E_ARG_RANGE', 'region lies outside the image', { valid: [`{x: 0, y: 0, w: ${info.width}, h: ${info.height}}`] });
    }
    const scale = quantizeScale(target.scale);
    if (!(scale > 0 && scale <= 1)) fail('E_ARG_RANGE', `scale ${target.scale} must be in (0, 1] or 'full'`);
    const key = `${n.id}|${scale}|${region.x},${region.y},${region.w},${region.h}|${target.precision}`;
    let res = this.results.get(key);
    if (!res) {
      await Promise.resolve();
      if (target.signal?.aborted) throw cancelled();
      const img = this.compute(n.id);
      const width = Math.max(1, Math.round(region.w * scale));
      const height = Math.max(1, Math.round(region.h * scale));
      const data = new Float64Array(width * height * img.c);
      for (let y = 0; y < height; y++) {
        const sy = region.y + Math.min(region.h - 1, Math.floor(((y + 0.5) * region.h) / height));
        for (let x = 0; x < width; x++) {
          const sx = region.x + Math.min(region.w - 1, Math.floor(((x + 0.5) * region.w) / width));
          for (let k = 0; k < img.c; k++) data[(y * width + x) * img.c + k] = img.data[(sy * img.w + sx) * img.c + k]!;
        }
      }
      if (target.signal?.aborted) throw cancelled();
      res = { data, width, height, region, scale, warnings: [] };
      this.results.set(key, res);
    }
    const r = res;
    return {
      node: n.id, info, scale: r.scale, region: { ...r.region }, width: r.width, height: r.height, format: 'f64',
      read: async () => r.data.slice(), warnings: [...r.warnings],
    };
  }

  async measure(ref: NodeRef, spec: MeasureSpec = {}): Promise<Measurement> {
    if (spec.signal?.aborted) throw cancelled();
    const n = this.node(ref);
    if (n.info.kind !== 'Value') fail('E_WRONG_KIND', `${n.op} returns an image; use evaluate()`);
    this.check(n);
    const f = VALUE_OPS[n.op] ?? fail('E_NOT_IMPLEMENTED', `${n.op} has no reference value implementation`);
    await Promise.resolve();
    if (spec.signal?.aborted) throw cancelled();
    return { node: n.id, value: f(this.ctx(n, false)), warnings: [] };
  }
}
