// The GPU engine's physics is @chromobench/core's (CHB-017, "one physics"): stocks, forward models,
// print chains (filtration shift, aim, aimView), viewings and the upstream rules (which film, which
// paper, which white) all come from core. This file only turns them into what the kernels consume:
// table arrays, uniforms and the 1-D paper-curve row.
import {
  BRADFORD, conventionsKey, D50, D65, DEFAULT_CONVENTIONS, developerAt, displaySetupAt, exposeSettings, filmOf, flareWhite,
  gradePivot, gradeToGamma, mulMV, paperDeveloper, paperOf, pdArrays, PhysicsEnv, printArrays, solveArrays, whiteAt,
  type ChainCtx, type Conventions, type DisplaySetup, type ExposeSettings, type PhysicsData, type UpNode,
} from '@chromobench/core';
import { A_RANGE, CP_RANGE, C_RANGE, N3, X_RANGE, type Mat3, type SolveInputs, type SpectralInputs, type Vec3 } from '../tables/inputs.ts';

/** Samples per paper-curve row (one rgba32float row, linear between samples on X_RANGE). */
export const N1 = 512;

export interface CurveRow { id: string; data: Float32Array }

export class CorePhysics {
  readonly env: PhysicsEnv;
  /** core's conventions id: EngineCaps.conventions and every TableKey.conventions. */
  readonly conventions: string;
  private readonly memo = new Map<string, unknown>();

  constructor(data: PhysicsData, conv: Conventions = DEFAULT_CONVENTIONS) {
    this.env = new PhysicsEnv(data, conv);
    this.conventions = conventionsKey(conv);
  }

  private cached<T>(key: string, make: () => T): T {
    if (!this.memo.has(key)) this.memo.set(key, make());
    return this.memo.get(key) as T;
  }

  /** invert.dyes: core's forward model (base-weighted start K) as solve-table inputs. */
  solveInputs(stock: string, scanner: string, N = N3): SolveInputs {
    return this.cached(`solve:${stock}:${scanner}:${N}`, () => ({ kind: 'solve', ...solveArrays(this.env.forward(stock, scanner)), range: A_RANGE, N }));
  }

  /** print.expose: the printing-density table and p0 = clear + aim lights, so x = p0 − pd(c) = core's xOfDyes(c). */
  expose(es: ExposeSettings, N = N3): { pd: SpectralInputs; offset: Vec3 } {
    return this.cached(`expose:${JSON.stringify(es)}:${N}`, () => {
      const ch = this.env.chain(es);
      return { pd: { kind: 'pd', ...pdArrays(ch.enlarger), range: C_RANGE, N }, offset: ch.aimLights.apply(ch.enlarger.clear()) };
    });
  }

  /** view.reflect: print XYZ under the viewing light (not adapted; Y of a perfect white = 1). */
  printInputs(paper: string, illuminant: string, N = N3): SpectralInputs {
    return this.cached(`print:${paper}:${illuminant}:${N}`, () => ({ kind: 'print', ...printArrays(this.env.viewing(paper, illuminant)), range: CP_RANGE, N }));
  }

  /**
   * print.develop: core's paper developer (3-CDF model) at grade 2, sampled on X_RANGE. The grade is
   * not baked into the row: the kernel applies core's x′ = pivot + γ·(x − pivot) first (`grade`), so a
   * steeper grade does not magnify the row's interpolation error.
   */
  developRow(paper: string): CurveRow {
    const { id, develop } = developerAt({ env: this.env, up: () => undefined }, paper, 2);
    return this.cached(`dev:${id}`, () => {
      const data = new Float32Array(N1 * 4);
      for (let i = 0; i < N1; i++) {
        const x = X_RANGE[0] + ((X_RANGE[1] - X_RANGE[0]) * i) / (N1 - 1);
        const c = develop([x, x, x]);
        data.set([c[0], c[1], c[2], 1], 4 * i);
      }
      return { id, data };
    });
  }

  /** print.develop's grade in context: γ (Filmbench GRADE) and the pivot, the upstream print.expose's aim grey (core `gradePivot`). */
  grade(ctx: ChainCtx, grade: number): { gamma: number; pivot: Vec3 } | null {
    const gamma = gradeToGamma(grade);
    return gamma === 1 ? null : { gamma, pivot: gradePivot(ctx) };
  }

  /** view.flare: X + f·W, W the paper white (adapted when a view.adapt is upstream). */
  flare(ctx: ChainCtx, percent: number): Vec3 {
    const W = flareWhite(ctx);
    return [0, 1, 2].map((k) => (percent / 100) * W[k]!) as Vec3;
  }

  /** view.adapt: Bradford cone-space gains d/s, applied as B⁻¹·diag(gains)·B in the kernel. */
  adaptGains(ctx: ChainCtx, to: unknown): Vec3 {
    const s = mulMV(BRADFORD, whiteAt(ctx));
    const d = mulMV(BRADFORD, to === 'D50' ? D50 : D65);
    return [d[0] / s[0], d[1] / s[1], d[2] / s[2]];
  }

  /**
   * output.display (CHB-011): core's display setup for the node — the matrix before the knee
   * (fromXYZ(space) · Bradford(rendering's source white → space white)), the knee and its lightness
   * rule, and the space's TRC.
   */
  display(ctx: ChainCtx, args: Readonly<Record<string, unknown>>): DisplaySetup {
    return displaySetupAt(ctx, args);
  }

  /** output.display's matrix before the knee (see display()). */
  displayMatrix(ctx: ChainCtx, rendering: unknown, space: unknown = 'srgb'): Mat3 {
    return displaySetupAt(ctx, { rendering, space, knee: 'clip' }).M;
  }

  /** The upstream context of node `i` of a receiver chain (core's ctx.up: nearest earlier node with that op). */
  ctx(chain: readonly { op: string; args: Readonly<Record<string, unknown>>; id: string; inputs: readonly string[] }[], i: number): ChainCtx {
    return {
      env: this.env,
      up: (op: string): UpNode | undefined => {
        for (let j = i - 1; j >= 0; j--) if (chain[j]!.op === op) return chain[j]!;
        return undefined;
      },
    };
  }

  /** print.expose settings of a node in context (film from the upstream invert.dyes). */
  exposeSettings(ctx: ChainCtx, args: Readonly<Record<string, unknown>>): ExposeSettings {
    return exposeSettings(args, filmOf(ctx));
  }

  paperOf(ctx: ChainCtx): string {
    return paperOf(ctx);
  }
}
