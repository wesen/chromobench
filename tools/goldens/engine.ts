// The engine the goldens are rendered on: core's f64 RefEngine (exact mode) alone. A case's document (format 3) is
// compiled by the contract's compile() into the engine's graph; the cuts `print` (view.adapt) and `display`
// (output.frame, which the reference engine implements since contract 1.0) are the compiler's named cuts. Nothing
// here evaluates a node itself.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, cutNode, fail, sha256Hex, type Document, type Graph, type SourceInfo } from '@chromobench/contract';
import { nodePacksData, RefEngine } from '../../packages/core/src/index.ts';

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
  engine: RefEngine;
  graph: Graph;
  open(f: FixtureRef): Promise<SourceInfo>;
  render(doc: Document): Promise<{ cuts: Rendered[]; ops: string[] }>;
  /** The compiled chain's ops (closure of the display node, inputs first), without evaluating. */
  ops(doc: Document): string[];
}

export function makeGoldenEngine(root: string): GoldenEngine {
  const engine = new RefEngine({ data: nodePacksData() });
  return {
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
        engine.openDecoded(info, data);
      } else info = await engine.open({ kind: 'file', sha256: sha256Hex(bytes), bytes });
      if (info.sha256 !== f.sha256) fail('E_DATA_HASH', `${f.path} hashes to ${info.sha256.slice(0, 12)}…, the case expects ${f.sha256.slice(0, 12)}…`);
      return info;
    },
    async render(doc) {
      const c = compile(doc, engine.graph);
      const ops = engine.graph.closure(c.display.id).map((d) => d.op);
      const cuts: Rendered[] = [];
      for (const cut of CUTS) {
        const n = cutNode(c, cut);
        if (n.op !== CUT_OP[cut]) fail('E_INTERNAL', `cut ${cut} is ${n.op}, not ${CUT_OP[cut]}`);
        const res = await engine.evaluate(n, { scale: 'full', precision: 'export' });
        const data = Float64Array.from(await res.read());
        cuts.push({ cut, op: n.op, width: res.width, height: res.height, channels: res.info.channels, domain: res.info.domain, data, warnings: res.warnings.map((w) => w.code) });
      }
      return { cuts, ops };
    },
    ops(doc) {
      return engine.graph.closure(compile(doc, engine.graph).display.id).map((d) => d.op);
    },
  };
}
