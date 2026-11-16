// Lowering (split from engine-gpu.ts, CHB-032): a chain of single-receiver pointwise nodes → program segments of
// kernels/pointwise.wgsl. Every parameter comes from core (physics/core.ts).
import { DOMAINS, fail, type Box, type Diagnostic, type Domain, type Graph, type ImageInfo, type Node } from '@chromobench/contract';
import {
  channelIndex, combineRatio, encodeTransformOf, filmUmPerPx, flashExposure, gradeWheels, HSL_NEUTRAL_CHROMA, hslBands, mixerMatrix, toneCurve, VIBRANCE_CHROMA,
  type UpNode,
} from '@chromobench/core';
import { lowerDisplay, MAXOPS, OP, type PwOp, type Segment, type SegmentTables } from '../chain/program.ts';
import { blendCode, encodingCode, flat3 } from '../chain/working.ts';
import { fusedMixTop } from './dag.ts';
import type { CorePhysics } from '../physics/core.ts';
import type { Mat3, Vec3 } from '../tables/inputs.ts';
import type { Lowered } from './defs.ts';
import { combineArgs, lightPointwise, type LightContext } from './light.ts';

/** Lowers nodes[from…] to segments; nodes[0…from) are upstream context only (ctx.up). */
export function lowerChain(P: CorePhysics, graph: Graph, nodes: Node[], treb: Map<string, Vec3>, from = 0): Lowered {
  // Every parameter comes from core (physics/core.ts): the same chain settings, aim, tables, flare
  // white, adaptation and display matrix the reference engine uses for the same nodes.
  const segments: Segment[] = [];
  const warnings: Diagnostic[] = [];
  let cur: Segment = { ops: [], tables: {} };
  const push = (op: PwOp, need: Partial<SegmentTables> = {}, disp?: Mat3, ok?: [Mat3, Mat3]) => {
    const clash = (Object.keys(need) as (keyof SegmentTables)[]).some((k) => cur.tables[k] && cur.tables[k] !== need[k]);
    if (cur.ops.length >= MAXOPS || clash || (disp && cur.disp)) {
      segments.push(cur);
      cur = { ops: [], tables: {} };
    }
    Object.assign(cur.tables, need);
    if (disp) cur.disp = disp;
    if (ok) cur.ok = ok;
    cur.ops.push(op);
  };
  /** Ops that must share one program (a fused mix: the backdrop register lives only within one dispatch). */
  const pushSpan = (ops: PwOp[]) => {
    if (cur.ops.length + ops.length > MAXOPS) {
      segments.push(cur);
      cur = { ops: [], tables: {} };
    }
    cur.ops.push(...ops);
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
      case 'print.combine': {
        // only the texture-free form reaches the pointwise kernel (engine/dag.ts: a combine with texture terms is a barrier)
        const lp = lightPointwise(combineArgs(a), lightContext(P, graph, nodes, i));
        push(lp.additive ? { code: OP.LIGHT, flags: 1, p0: lp.logGain, node: n.id } : { code: OP.LIGHT, p0: lp.gain, p1: lp.offset, node: n.id });
        break;
      }
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
        // core's display setup (CHB-011): every space, both renderings, clip / tanh / oklch / cam16-ucs knees
        const d = lowerDisplay(P.display(ctx, a), n.id);
        push(d.op, {}, d.disp, d.ok);
        break;
      }
      case 'film.grain': {
        push({ code: OP.GRAIN, flags: (a['seed'] as number) >>> 0, p0: [a['amount'] as number, 0], node: n.id });
        break;
      }
      // masks (design §25; core print/masks.ts on the grid)
      case 'mask.luminance': {
        const rd = graph.get(n.inputs[0]!)?.info;
        const [lo, hi] = DOMAINS[rd && rd.kind === 'Image' ? rd.domain : 'mask'].range;
        push({ code: OP.MASK_LUM, p0: [a['above'] as number, a['below'] as number, a['softness'] as number], p1: [lo, hi], node: n.id });
        break;
      }
      case 'mask.linear': {
        const f = a['from'] as { x: number; y: number }, t = a['to'] as { x: number; y: number };
        push({ code: OP.MASK_LINEAR, p0: [f.x, f.y, t.x, t.y], node: n.id });
        break;
      }
      case 'mask.ellipse': {
        const b = a['box'] as Box;
        const th = (((a['angle_deg'] as number | undefined) ?? 0) * Math.PI) / 180;
        push({ code: OP.MASK_ELLIPSE, p0: [b.x + b.w / 2, b.y + b.h / 2, Math.max(b.w / 2, 1e-9), Math.max(b.h / 2, 1e-9)], p1: [Math.cos(th), Math.sin(th)], node: n.id });
        break;
      }
      case 'mask.invert': push({ code: OP.MASK_INVERT, node: n.id }); break;
      case 'mask.constant': push({ code: OP.MASK_CONSTANT, p0: [a['value'] as number], node: n.id }); break;
      case 'composite.mix': {
        // fused (engine/dag.ts fusedMixTop): SAVE the backdrop, the top's ops on it, MIX with the amount and blend
        const top = fusedMixTop(graph, n) ?? fail('E_INTERNAL', 'composite.mix reached the pointwise lowering unfused');
        const back = graph.get(n.inputs[0]!)!.info as ImageInfo;
        pushSpan([
          { code: OP.SAVE, node: n.id },
          ...top.map((m) => lowerDigital(graph, m)),
          { code: OP.MIX, flags: blendCode(a['blend']), aux: encodingCode(back.domain), p0: [a['amount'] as number], node: n.id },
        ]);
        break;
      }
      default: {
        if (!DIGITAL_OPS.has(n.op)) fail('E_INTERNAL', `${n.op} has no pointwise GPU lowering (barrier ops are materialised)`);
        push(lowerDigital(graph, n));
      }
    }
  }
  if (cur.ops.length || !segments.length) segments.push(cur);
  return { root: nodes[0]!, segments, warnings };
}

/** The digital layers and their mask components: one program op each, parameters prepared by core. */
const DIGITAL_OPS: ReadonlySet<string> = new Set(['composite.encode', 'exposure', 'curve', 'levels', 'hsl', 'vibrance', 'grade', 'mixer', 'vignette', 'mask.colour', 'mask.radial']);

/**
 * One digital op (contract 1.1) as a program op, with core's preparation of its parameters (composite/*.ts): the
 * encoding transform, the curve's Hermite segments, the hue bands, the grading wheels, the mixer matrix.
 */
export function lowerDigital(graph: Pick<Graph, 'get'>, n: Node): PwOp {
  const a = n.args as Record<string, unknown>;
  const num = (k: string): number => a[k] as number;
  switch (n.op) {
    case 'composite.encode': {
      const from = (graph.get(n.inputs[0]!)!.info as ImageInfo).domain;
      const t = encodeTransformOf(from, a['to'] as Domain, a['white'] as 'D50' | 'D65');
      return { code: OP.ENCODE, flags: t.f, data: [...flat3(t.pre), ...flat3(t.post)], node: n.id };
    }
    case 'exposure': return { code: OP.EXPOSURE, p0: [2 ** num('stops'), num('offset')], node: n.id };
    case 'mixer': return { code: OP.MIXER, data: flat3(mixerMatrix(a)), node: n.id };
    case 'curve': {
      const c = toneCurve(a['points'] as { x: number; y: number }[]);
      return { code: OP.CURVE, flags: channelIndex(a['channel']), aux: c.x.length, data: [...c.x, ...c.y, ...c.m], node: n.id };
    }
    case 'levels': return { code: OP.LEVELS, flags: channelIndex(a['channel']), p0: [num('black'), num('white'), 1 / num('gamma'), num('outBlack')], p1: [num('outWhite')], node: n.id };
    case 'hsl': {
      const bands = hslBands(a['bands'] as Record<string, number>[]);
      return { code: OP.HSL, aux: bands.length, p0: [HSL_NEUTRAL_CHROMA], data: bands.flatMap((b) => [b.cx, b.cy, b.cosW, b.hue, b.sat, b.light]), node: n.id };
    }
    case 'vibrance': return { code: OP.VIBRANCE, p0: [num('vibrance'), num('saturation'), VIBRANCE_CHROMA], node: n.id };
    case 'grade': {
      const g = gradeWheels(a);
      return { code: OP.GRADE, data: [...g.tint.flat(), ...g.light, g.exponent], node: n.id };
    }
    case 'vignette': return { code: OP.VIGNETTE, p0: [num('stops'), num('size'), num('size') + num('feather') * (1 - num('size'))], node: n.id };
    case 'mask.colour': {
      const c = a['colour'] as number[];
      return { code: OP.MASK_COLOUR, p0: [c[0]!, c[1]!, c[2]!, num('tolerance')], p1: [num('softness')], node: n.id };
    }
    case 'mask.radial': {
      const b = a['box'] as Box;
      const th = (num('angle_deg') * Math.PI) / 180;
      return { code: OP.MASK_RADIAL, p0: [b.x + b.w / 2, b.y + b.h / 2, Math.max(b.w / 2, 1e-9), Math.max(b.h / 2, 1e-9)], p1: [Math.cos(th), Math.sin(th), num('feather')], node: n.id };
    }
    default: return fail('E_INTERNAL', `${n.op} is not a digital layer op`);
  }
}

/** Grain σ per output pixel from size_um (Selwyn: σ²·A constant), filled per target; `pxPerOut` frame px per output px. */
export function fillGrain(segs: Segment[], nodes: Node[], pxPerOut: number): void {
  for (const s of segs) for (const o of s.ops) {
    if (o.code !== OP.GRAIN) continue;
    const n = nodes.find((x) => x.id === o.node)!;
    const size = n.args['size_um'] as number;
    const umPerPxOut = filmUmPerPx(n.info as ImageInfo) * pxPerOut;
    // σ at a pixel of area p² = 0.012 · size/p (0.012: the Studio's grain scale at p = size)
    o.p0 = [o.p0![0]!, 0.012 * (size / umPerPxOut)];
  }
}

/**
 * The light law's context for print.combine node nodes[i]: the receiver is the main print.expose, so a term's seconds
 * ratio compares its print.expose with it (core combineRatio); a flash's uniform x is core's (flashExposure).
 */
export function lightContext(P: CorePhysics, graph: Graph, nodes: readonly Node[], i: number): LightContext {
  const ctx = P.ctx(nodes, i);
  const main = graph.get(nodes[i]!.inputs[0]!);
  const node = (id: string): UpNode | undefined => graph.get(id) as UpNode | undefined;
  return {
    ratio: (id) => {
      const e = graph.get(id);
      return combineRatio(main?.op === 'print.expose' ? main.args : undefined, e?.op === 'print.expose' ? e.args : undefined);
    },
    flashX: (id, role) => flashExposure({ up: ctx.up, env: ctx.env, node }, id, role) ?? fail('E_INTERNAL', `print.combine: the ${role} term ${id.slice(0, 12)}… is not a print.expose`),
  };
}
