// Lowering (split from engine-gpu.ts, CHB-032): a chain of single-receiver pointwise nodes → program segments of
// kernels/pointwise.wgsl. Every parameter comes from core (physics/core.ts).
import { DOMAINS, fail, type Box, type Diagnostic, type Graph, type Node } from '@chromobench/contract';
import { lowerDisplay, OP, type PwOp, type Segment, type SegmentTables } from '../chain/program.ts';
import type { CorePhysics } from '../physics/core.ts';
import type { Mat3, Vec3 } from '../tables/inputs.ts';
import type { Lowered } from './defs.ts';

/** Lowers nodes[from…] to segments; nodes[0…from) are upstream context only (ctx.up). */
export function lowerChain(P: CorePhysics, graph: Graph, nodes: Node[], treb: Map<string, Vec3>, from = 0): Lowered {
  // Every parameter comes from core (physics/core.ts): the same chain settings, aim, tables, flare
  // white, adaptation and display matrix the reference engine uses for the same nodes.
  const segments: Segment[] = [];
  const warnings: Diagnostic[] = [];
  let cur: Segment = { ops: [], tables: {} };
  const push = (op: PwOp, need: Partial<SegmentTables> = {}, disp?: Mat3, ok?: [Mat3, Mat3]) => {
    const clash = (Object.keys(need) as (keyof SegmentTables)[]).some((k) => cur.tables[k] && cur.tables[k] !== need[k]);
    if (cur.ops.length >= 12 || clash || (disp && cur.disp)) {
      segments.push(cur);
      cur = { ops: [], tables: {} };
    }
    Object.assign(cur.tables, need);
    if (disp) cur.disp = disp;
    if (ok) cur.ok = ok;
    cur.ops.push(op);
  };
  for (let i = from; i < nodes.length; i++) {
    const n = nodes[i]!;
    const a = n.args as Record<string, unknown>;
    const ctx = P.ctx(nodes, i);
    switch (n.op) {
      case 'source.open': {
        const enc = a['encoding'];
        if (enc === 'srgb' || enc === 'gamma22') push({ code: OP.DECODE, p0: [enc === 'srgb' ? 1 : 2], node: n.id });
        break;
      }
      case 'source.pattern': break;
      case 'scan.flare': {
        // T = T′(1 + f) − f per channel (contract 0.3; core and ingest removeFlareValue)
        const fl = a['flare'] as number | number[];
        const f = [0, 1, 2].map((k) => (Array.isArray(fl) ? fl[k]! : fl) / 100);
        push({ code: OP.AFFINE, p0: f.map((x) => 1 + x), p1: f.map((x) => -x), node: n.id });
        break;
      }
      case 'scan.density': push({ code: OP.DENSITY, p0: [...(treb.get(n.id) ?? [1, 1, 1])], node: n.id }); break;
      case 'invert.dyes': push({ code: OP.DYES, node: n.id }, { solve: P.solveInputs(a['stock'] as string, a['scanner'] as string) }); break;
      case 'print.expose': {
        // filtration is a shift on the database neutral pack; the aim lights are core's (aim, aimView)
        const { pd, offset } = P.expose(P.exposeSettings(ctx, a));
        push({ code: OP.EXPOSE, p0: [...offset], node: n.id }, { pd });
        break;
      }
      case 'print.lights': push({ code: OP.ADD, p0: [...(a['logH'] as number[])], node: n.id }); break;
      case 'print.develop': {
        // the grade as x′ = pivot + γ(x − pivot) before the paper row (flag 1), as core's developerAt
        const gr = P.grade(ctx, a['grade'] as number);
        const curves = P.developRow(a['paper'] as string);
        push(gr ? { code: OP.DEVELOP, flags: 1, p0: [...gr.pivot], p1: [gr.gamma, gr.gamma, gr.gamma], node: n.id } : { code: OP.DEVELOP, node: n.id }, { curves });
        break;
      }
      case 'view.reflect': push({ code: OP.REFLECT, node: n.id }, { print: P.printInputs(P.paperOf(ctx), a['illuminant'] as string) }); break;
      case 'view.flare': push({ code: OP.FLARE, p0: P.flare(ctx, a['flare'] as number), p1: [1], node: n.id }); break;
      case 'view.adapt': push({ code: OP.ADAPT, p0: P.adaptGains(ctx, a['to']), node: n.id }); break;
      case 'output.display': {
        // core's display setup (CHB-011): every space, both renderings, clip / tanh / oklch knees
        const d = lowerDisplay(P.display(ctx, a), n.id);
        if (d.approx) warnings.push({ code: 'W_PREVIEW_APPROX', message: 'the cam16-ucs knee has no GPU kernel yet; the oklch knee is used instead' });
        push(d.op, {}, d.disp, d.ok);
        break;
      }
      case 'film.grain': {
        push({ code: OP.GRAIN, flags: (a['seed'] as number) >>> 0, p0: [a['amount'] as number, 0], node: n.id });
        break;
      }
      // CHB-010 masks (core print/masks.ts on the grid)
      case 'mask.luminance': {
        const rd = graph.get(n.inputs[0]!)?.info;
        const [lo, hi] = DOMAINS[rd && rd.kind === 'Image' ? rd.domain : 'mask'].range;
        push({ code: OP.MASK_LUM, p0: [a['above'] as number, a['below'] as number, a['softness'] as number], p1: [lo, hi], node: n.id });
        break;
      }
      case 'mask.gradient': {
        const f = a['from'] as { x: number; y: number }, t = a['to'] as { x: number; y: number };
        push({ code: OP.MASK_GRADIENT, p0: [f.x, f.y, t.x, t.y], node: n.id });
        break;
      }
      case 'mask.ellipse': {
        const b = a['box'] as Box;
        const th = (((a['angle_deg'] as number | undefined) ?? 0) * Math.PI) / 180;
        push({ code: OP.MASK_ELLIPSE, p0: [b.x + b.w / 2, b.y + b.h / 2, Math.max(b.w / 2, 1e-9), Math.max(b.h / 2, 1e-9)], p1: [Math.cos(th), Math.sin(th)], node: n.id });
        break;
      }
      case 'mask.not': push({ code: OP.MASK_NOT, node: n.id }); break;
      default: fail('E_INTERNAL', `${n.op} has no pointwise GPU lowering (barrier ops are materialised)`);
    }
  }
  if (cur.ops.length || !segments.length) segments.push(cur);
  return { root: nodes[0]!, segments, warnings };
}

/** Grain σ per output pixel from size_um (Selwyn: σ²·A constant), filled per target. */
export function fillGrain(segs: Segment[], nodes: Node[], umPerPxOut: number): void {
  for (const s of segs) for (const o of s.ops) {
    if (o.code !== OP.GRAIN) continue;
    const n = nodes.find((x) => x.id === o.node)!;
    const size = n.args['size_um'] as number;
    // σ at a pixel of area p² = 0.012 · size/p (0.012: the Studio's grain scale at p = size)
    o.p0 = [o.p0![0]!, 0.012 * (size / umPerPxOut)];
  }
}
