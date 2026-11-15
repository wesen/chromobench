// The engine the goldens are rendered on: core's f64 RefEngine (exact mode), wrapped in the studio's StudioEngine,
// which adds output.frame (crop, straighten, orientation) as the studio computes it on real physics. The recipe is
// compiled by the contract's compile() into the wrapper's graph, as the studio does; nothing here evaluates a node
// itself. The cut `print` is the view.adapt node of the compiled chain, the cut `display` its output.frame node.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, fail, sha256Hex, type FrameRecipe, type Graph, type Node, type SourceInfo, type Vec3 } from '@chromobench/contract';
import { CLASS_CODE, classify, DEFAULT_SIGMA_D, integrateToGrey, Lights, nodePacksData, RefEngine } from '../../packages/core/src/index.ts';
import { StudioEngine, type HostServices } from '../../apps/studio/src/host/studio-engine.ts';
import { firstPrint } from '../../apps/studio/src/host/first-print.ts';

export const CUTS = ['print', 'display'] as const;
export type Cut = (typeof CUTS)[number];
/** The op whose result each cut is. */
export const CUT_OP: Readonly<Record<Cut, string>> = { print: 'view.adapt', display: 'output.frame' };

/** A fixture as stored under packages/conformance/goldens/fixtures/. */
export interface FixtureRef {
  /** 'negative': a 16-bit TIFF opened by RefEngine.open; 'camera': linear camera RGB f32 + SourceInfo, openDecoded. */
  kind: 'negative' | 'camera' | 'tiff';
  /** Path of the pixels, relative to the repository root. */
  path: string;
  /** Path of the SourceInfo JSON (camera only). */
  info?: string;
  sha256: string;
}

export interface Rendered {
  cut: Cut;
  op: string;
  width: number;
  height: number;
  channels: number;
  domain: string;
  data: Float64Array;
  warnings: string[];
}

export interface GoldenEngine {
  engine: StudioEngine;
  graph: Graph;
  open(f: FixtureRef): Promise<SourceInfo>;
  render(r: FrameRecipe): Promise<{ cuts: Rendered[]; ops: string[] }>;
  /** The compiled chain's ops (closure of the display node, inputs first), without evaluating. */
  ops(r: FrameRecipe): string[];
  /** The studio's automatic first print (integrate to grey; apps/studio/src/host/first-print.ts), as the host injects core. */
  firstPrint(r: FrameRecipe): Promise<FrameRecipe>;
}

export const integrate = (latd: Vec3, alpha: number): Vec3 => [...integrateToGrey(latd, { latd: [0, 0, 0], lights: Lights.zero() }, alpha).logH] as Vec3;

/** Walks the receiver chain (first inputs) up from `n` to the first node of `op`. */
export function upstream(g: Graph, n: Node, op: string): Node {
  let cur: Node | undefined = n;
  while (cur && cur.op !== op) cur = cur.inputs[0] ? g.get(cur.inputs[0]) : undefined;
  return cur ?? fail('E_INTERNAL', `no ${op} node above ${n.op}`);
}

export function makeGoldenEngine(root: string): GoldenEngine {
  const ref = new RefEngine({ data: nodePacksData() });
  const host: HostServices = {
    decode: () => fail('E_INTERNAL', 'the goldens open their fixtures directly'),
    register: () => undefined,
    classify: (D, sigma, res) => CLASS_CODE[classify(D, sigma, res).cls],
    defaultSigma: DEFAULT_SIGMA_D,
  };
  const engine = new StudioEngine(ref, host, 'goldens: reference-f64');
  const ge: GoldenEngine = {
    engine,
    get graph() {
      return engine.graph;
    },
    async open(f) {
      const bytes = new Uint8Array(readFileSync(join(root, f.path)));
      let info: SourceInfo;
      if (f.kind === 'camera') {
        info = JSON.parse(readFileSync(join(root, f.info!), 'utf8')) as SourceInfo;
        const data = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
        if (sha256Hex(bytes) !== info.sha256) fail('E_DATA_HASH', `${f.path} does not hash to its info's sha256`);
        ref.openDecoded(info, data);
      } else info = await ref.open({ kind: 'file', sha256: sha256Hex(bytes), bytes });
      if (info.sha256 !== f.sha256) fail('E_DATA_HASH', `${f.path} hashes to ${info.sha256.slice(0, 12)}…, the case expects ${f.sha256.slice(0, 12)}…`);
      engine.graph.registerSource(info);
      return info;
    },
    async render(r) {
      const g = engine.graph;
      const display = compile(r, g);
      engine.adopt(g.closure(display.id));
      const ops = g.closure(display.id).map((d) => d.op);
      const cuts: Rendered[] = [];
      for (const cut of CUTS) {
        const n = upstream(g, display, CUT_OP[cut]);
        const res = await engine.evaluate(n, { scale: 'full', precision: 'export' });
        const data = Float64Array.from(await res.read());
        cuts.push({ cut, op: n.op, width: res.width, height: res.height, channels: res.info.channels, domain: res.info.domain, data, warnings: res.warnings.map((w) => w.code) });
      }
      return { cuts, ops };
    },
    ops(r) {
      return engine.graph.closure(compile(r, engine.graph).id).map((d) => d.op);
    },
    firstPrint: (r) => firstPrint(engine, engine.graph, r, { integrate }),
  };
  return ge;
}
