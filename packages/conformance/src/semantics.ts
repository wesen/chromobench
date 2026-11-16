// Semantic cases (CHB-010, contract 0.3, contract 1.0, 1.1): the digital ops of the composite stages and the blend
// modes (identity at identity params, closed forms, the blend identities of design §37), and what print.combine (the light law), composite.mix, heal and
// clone, the mask algebra, output.frame, scan.flare and scan.density's baseT must compute, in any engine, on seeded
// synthetic inputs. Values are read back from the engine under test (masks included), so the cases hold for f64 and
// f32 engines alike; the tolerance is the f32 one. The expected values come from the contract's per-pixel formulas
// (lightH, mixPixel, maskCombine) or from closed forms, never from an engine.
import { lightH, maskCombine, mixPixel, type Node } from '@chromobench/contract';
import type { Case, Env } from './generate.ts';

const TOL = 2e-5;

class SemanticFailure extends Error {}
const check = (cond: boolean, msg: string): void => {
  if (!cond) throw new SemanticFailure(msg);
};

async function read(env: Env, n: Node): Promise<ArrayLike<number>> {
  return (await env.engine.evaluate(n, { scale: 'full', precision: 'export' })).read();
}

/** Max |a_i − f(i)| over the first three channels of a c-channel image. */
function worst(a: ArrayLike<number>, c: number, f: (pixel: number, k: number) => number): number {
  let w = 0;
  for (let i = 0; i < a.length / c; i++) for (let k = 0; k < Math.min(3, c); k++) w = Math.max(w, Math.abs(a[i * c + k]! - f(i, k)));
  return w;
}

/** The worst |Δ| of the first channel of a 3-channel image (OkLab L). */
function worstL(a: ArrayLike<number>, f: (pixel: number) => number): number {
  let w = 0;
  for (let i = 0; i < a.length / 3; i++) w = Math.max(w, Math.abs(a[3 * i]! - f(i)));
  return w;
}

const widthOf = (n: Node): number => (n.info as { width: number }).width;
const px3 = (a: ArrayLike<number>, i: number): number[] => [a[3 * i]!, a[3 * i + 1]!, a[3 * i + 2]!];

interface SemanticCase { id: string; op: string; needs: string[]; run(env: Env): Promise<void> }

/** Identity params of every digital layer op (design §37: a layer at identity params changes nothing). */
const IDENTITY: [op: string, domain: 'print-rgb' | 'print-oklab' | 'print-xyz', params: Record<string, unknown>][] = [
  ['exposure', 'print-rgb', {}], ['curve', 'print-oklab', {}], ['curve', 'print-rgb', { channel: 'G' }], ['levels', 'print-oklab', {}],
  ['levels', 'print-rgb', { channel: 'B' }], ['hsl', 'print-oklab', {}], ['vibrance', 'print-oklab', { vibrance: 0 }], ['grade', 'print-oklab', {}],
  ['mixer', 'print-rgb', {}], ['vignette', 'print-rgb', { stops: 0 }],
];
const smooth = (e0: number, e1: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

const COMPOSITE_CASES: SemanticCase[] = [
  ...IDENTITY.map(([op, domain, params]): SemanticCase => ({
    id: `${op} semantics: identity params change nothing (${domain}${Object.keys(params).length ? ` ${JSON.stringify(params)}` : ''})`, op, needs: [op],
    async run(env) {
      const x = env.input(domain);
      const [a, b] = [await read(env, x), await read(env, env.build(op, [x.id], params))];
      check(worst(b, 3, (i, k) => a[3 * i + k]!) <= TOL, `${op} at identity params changed the image`);
    },
  })),
  {
    id: 'composite.encode semantics: xyz → oklab → rgb → xyz is the identity; D50 and D65 whites', op: 'composite.encode', needs: ['composite.encode'],
    async run(env) {
      for (const white of ['D50', 'D65']) {
        const x = env.input('print-xyz');
        const ok = env.build('composite.encode', [x.id], { to: 'print-oklab', white });
        const back = env.build('composite.encode', [env.build('composite.encode', [ok.id], { to: 'print-rgb', white }).id], { to: 'print-xyz', white });
        const [a, b] = [await read(env, x), await read(env, back)];
        check(worst(b, 3, (i, k) => a[3 * i + k]!) <= TOL, `${white}: the round trip through OkLab and RGB is not the identity`);
      }
    },
  },
  {
    id: 'exposure semantics: rgb · 2^stops + offset', op: 'exposure', needs: ['exposure'],
    async run(env) {
      const x = env.input('print-rgb');
      const [a, b] = [await read(env, x), await read(env, env.build('exposure', [x.id], { stops: 1, offset: 0.01 }))];
      check(worst(b, 3, (i, k) => 2 * a[3 * i + k]! + 0.01) <= TOL, 'exposure is not rgb · 2^stops + offset');
    },
  },
  {
    id: 'curve and levels semantics: a straight two-point curve and a linear levels are affine in L; a channel acts on its cube root', op: 'curve', needs: ['curve', 'levels'],
    async run(env) {
      const ok = env.input('print-oklab');
      const pts = [{ x: 0, y: 0.1 }, { x: 1, y: 0.9 }];
      const [a, c, l] = [await read(env, ok), await read(env, env.build('curve', [ok.id], { points: pts })), await read(env, env.build('levels', [ok.id], { black: 0.2, white: 0.8, gamma: 2 }))];
      check(worst(c, 3, (i, k) => (k === 0 ? 0.1 + 0.8 * a[3 * i]! : a[3 * i + k]!)) <= TOL, 'curve on L is not the straight line through its points');
      const lv = (v: number): number => { const t = (v - 0.2) / 0.6; return t <= 0 || t >= 1 ? t : t ** 0.5; };
      check(worst(l, 3, (i, k) => (k === 0 ? lv(a[3 * i]!) : a[3 * i + k]!)) <= TOL, 'levels on L is not outBlack + (outWhite − outBlack)·t^(1/γ)');
      const rgb = env.input('print-rgb');
      const [ra, rc] = [await read(env, rgb), await read(env, env.build('curve', [rgb.id], { channel: 'R', points: pts }))];
      check(worst(rc, 3, (i, k) => (k === 0 ? (0.1 + 0.8 * Math.cbrt(ra[3 * i]!)) ** 3 : ra[3 * i + k]!)) <= TOL, 'curve on R does not act on the cube root of R alone');
    },
  },
  {
    id: 'mixer and vignette semantics: the matrix; 2^stops at the corners, 1 at the centre', op: 'mixer', needs: ['mixer', 'vignette'],
    async run(env) {
      const x = env.input('print-rgb');
      const xa = await read(env, x);
      const M = [[0.8, 0.2, 0], [0.1, 0.7, 0.2], [0, 0.3, 0.7]];
      const m = await read(env, env.build('mixer', [x.id], { red: M[0], green: M[1], blue: M[2] }));
      check(worst(m, 3, (i, k) => M[k]![0]! * xa[3 * i]! + M[k]![1]! * xa[3 * i + 1]! + M[k]![2]! * xa[3 * i + 2]!) <= TOL, 'mixer is not the matrix product');
      const mono = await read(env, env.build('mixer', [x.id], { monochrome: true }));
      check(worst(mono, 3, (i) => mono[3 * i]!) <= 1e-6, 'monochrome is not neutral');
      const W = widthOf(x), H = (x.info as { height: number }).height;
      const v = await read(env, env.build('vignette', [x.id], { stops: -1, size: 0.3, feather: 0.6 }));
      const gain = (i: number): number => {
        const dx = (((i % W) + 0.5) - W / 2) / (W / 2), dy = ((Math.floor(i / W) + 0.5) - H / 2) / (H / 2);
        return 2 ** (-smooth(0.3, 0.3 + 0.6 * 0.7, Math.sqrt((dx * dx + dy * dy) / 2)));
      };
      check(worst(v, 3, (i, k) => xa[3 * i + k]! * gain(i)) <= TOL, 'vignette is not rgb · 2^(stops · smoothstep(size, size + feather·(1 − size), ρ)) on the frame');
    },
  },
  {
    id: 'composite.mix semantics: the blend identities (screen and lighten by black, difference with itself, multiply by itself)', op: 'composite.mix', needs: ['composite.mix', 'mixer'],
    async run(env) {
      const b = env.input('print-rgb');
      const black = env.build('mixer', [b.id], { red: [0, 0, 0], green: [0, 0, 0], blue: [0, 0, 0] });
      const ba = await read(env, b);
      const mix = async (top: string, blend: string, amount = 1): Promise<ArrayLike<number>> => read(env, env.build('composite.mix', [b.id], { top, blend, amount }));
      check(worst(await mix(black.id, 'screen'), 3, (i, k) => ba[3 * i + k]!) <= TOL, 'screen by black is not the backdrop');
      check(worst(await mix(black.id, 'lighten'), 3, (i, k) => Math.max(ba[3 * i + k]!, 0)) <= TOL, 'lighten by black is not max(b, 0)');
      check(worst(await mix(b.id, 'difference'), 3, () => 0) <= TOL, 'difference with itself is not 0');
      check(worst(await mix(b.id, 'multiply', 0.5), 3, (i, k) => { const v = ba[3 * i + k]!; return v + 0.5 * (v * v - v); }) <= TOL, 'multiply by itself at 0.5 is not b + 0.5·(b² − b)');
    },
  },
  {
    id: 'composite.mix semantics: luminosity and colour in OkLCh (lightness of one, colour of the other, the chroma kept in the gamut)', op: 'composite.mix', needs: ['composite.mix', 'vibrance', 'curve'],
    async run(env) {
      const b = env.input('print-oklab');
      const s = env.build('curve', [env.build('vibrance', [b.id], { vibrance: 0, saturation: 0.5 }).id], { points: [{ x: 0, y: 0.1 }, { x: 1, y: 0.9 }] });
      const ba = await read(env, b);
      // the lightness is the one blended exactly; the colour is the other's, its chroma reduced (never raised, the hue
      // kept) where it would leave the gamut (ClipColor in OkLCh, contract 1.6)
      const chromaOf = (out: ArrayLike<number>, want: (i: number, k: number) => number, what: string): void => {
        let bad = 0;
        for (let i = 0; i < out.length / 3; i++) {
          const a = out[3 * i + 1]!, c = out[3 * i + 2]!, wa = want(i, 1), wc = want(i, 2);
          const off = Math.abs(a * wc - c * wa), over = Math.hypot(a, c) - Math.hypot(wa, wc), back = -(a * wa + c * wc);
          bad = Math.max(bad, off, over, back > TOL ? back : 0);
        }
        check(bad <= TOL, `${what}: chroma raised or hue moved (${bad})`);
      };
      const lum = await read(env, env.build('composite.mix', [b.id], { top: s.id, blend: 'luminosity' }));
      check(worstL(lum, (i) => 0.1 + 0.8 * ba[3 * i]!) <= TOL, 'luminosity is not L_s');
      chromaOf(lum, (i, k) => ba[3 * i + k]!, 'luminosity is not (L_s, a_b, b_b) within the gamut');
      const col = await read(env, env.build('composite.mix', [b.id], { top: s.id, blend: 'colour' }));
      check(worstL(col, (i) => ba[3 * i]!) <= TOL, 'colour is not L_b');
      chromaOf(col, (i, k) => 1.5 * ba[3 * i + k]!, 'colour is not (L_b, a_s, b_s) within the gamut');
    },
  },
  {
    id: 'mask semantics: radial is 1 at its centre and 0 outside; colour is 1 at its own sample', op: 'mask.radial', needs: ['mask.radial', 'mask.colour'],
    async run(env) {
      const r = env.input('camera-linear');
      const m = await read(env, env.build('mask.radial', [r.id], { box: { x: 2, y: 1, w: 8, h: 7 }, angle_deg: 20, feather: 0.5 }));
      check(m[4 * 12 + 6]! === 1 && m[0]! === 0, `mask.radial: centre ${m[4 * 12 + 6]}, corner ${m[0]}`);
      const ok = env.input('print-oklab');
      const oa = await read(env, ok);
      const c = await read(env, env.build('mask.colour', [ok.id], { colour: px3(oa, 7), tolerance: 0.01, softness: 0 }));
      check(Math.abs(c[7]! - 1) <= 1e-6, `mask.colour at its own sample: ${c[7]}`);
    },
  },
];

const CASES: SemanticCase[] = [
  ...COMPOSITE_CASES,
  {
    id: 'print.combine semantics: no terms is the receiver', op: 'print.combine', needs: ['print.combine'],
    async run(env) {
      const x = env.input('paper-logH');
      const [a, b] = [await read(env, x), await read(env, env.build('print.combine', [x.id], {}))];
      check(worst(b, 3, (i, k) => a[3 * i + k]!) <= TOL, 'print.combine without terms changed the image');
    },
  },
  {
    id: 'print.combine semantics: a burn adds in linear H (x + log10(1 + a·m) for the same exposure)', op: 'print.combine', needs: ['print.combine', 'mask.linear'],
    async run(env) {
      const x = env.input('paper-logH');
      const m = env.build('mask.linear', [x.id], { from: { x: 0, y: 0 }, to: { x: 12, y: 10 } });
      const out = env.build('print.combine', [x.id], { terms: [{ role: 'burn', image: x.id, amount: 0.5, mask: m.id }] });
      const [xa, ma, oa] = [await read(env, x), await read(env, m), await read(env, out)];
      check(worst(oa, 3, (i, k) => xa[3 * i + k]! + Math.log10(1 + 0.5 * ma[i]!)) <= TOL, 'burn is not log10(1 + a·m) above the main exposure (summed in log H?)');
      check(Math.abs(ma[0]! - (1 - (0.5 * 12 + 0.5 * 10) / 244)) <= 1e-6, `mask.linear at the first pixel centre: ${ma[0]}`);
    },
  },
  {
    id: 'print.combine semantics: dodge and burn of one exposure and mask cancel', op: 'print.combine', needs: ['print.combine', 'print.expose', 'mask.ellipse'],
    async run(env) {
      const dyes = env.input('film-dyes');
      const x = env.build('print.expose', [dyes.id], {});
      const e = env.build('print.expose', [dyes.id], { time_s: 4 });
      const m = env.build('mask.ellipse', [x.id], { box: { x: 2, y: 1, w: 8, h: 7 }, angle_deg: 30 });
      const t = { image: e.id, amount: 1, mask: m.id };
      const out = env.build('print.combine', [x.id], { terms: [{ role: 'dodge', ...t }, { role: 'burn', ...t }] });
      const [xa, oa] = [await read(env, x), await read(env, out)];
      check(worst(oa, 3, (i, k) => xa[3 * i + k]!) <= TOL, 'dodge and burn of the same exposure do not cancel');
    },
  },
  {
    id: 'print.combine semantics: an unmasked flash adds the same H to every pixel and is not held back by density masks', op: 'print.combine', needs: ['print.combine', 'print.expose', 'print.densityMask'],
    async run(env) {
      const x = env.pitched('paper-logH');
      const f = env.build('print.expose', [env.pitched('film-dyes').id], { time_s: 1 });
      const d = env.build('print.densityMask', [x.id], { gamma: 0.5, radius_um: 30 });
      for (const role of ['flash-base', 'flash-open']) {
        const out = env.build('print.combine', [x.id], { terms: [{ role, image: f.id, amount: 1 }], densities: [{ image: d.id, amount: 1 }] });
        const [xa, da, oa] = [await read(env, x), await read(env, d), await read(env, out)];
        const added = (i: number, k: number): number => 10 ** oa[3 * i + k]! - 10 ** (xa[3 * i + k]! - da[i]!);
        let spread = 0;
        for (let i = 0; i < xa.length / 3; i++) for (let k = 0; k < 3; k++) spread = Math.max(spread, Math.abs(added(i, k) - added(0, k)) / Math.max(added(0, k), 1e-12));
        check(added(0, 0) > 0 && spread <= 1e-3, `${role}: the flash is not a uniform H outside the density masks (relative spread ${spread})`);
      }
    },
  },
  {
    id: 'print.combine semantics: density masks hold back the exposures through the negative (x − Σ a·d_m)', op: 'print.combine', needs: ['print.combine', 'print.densityMask'],
    async run(env) {
      const x = env.pitched('paper-logH');
      const d1 = env.build('print.densityMask', [x.id], { gamma: 0.5, radius_um: 30 });
      const d2 = env.build('print.densityMask', [x.id], { gamma: 0.2, radius_um: 30, polarity: 'same' });
      const out = env.build('print.combine', [x.id], { densities: [{ image: d1.id, amount: 1 }, { image: d2.id, amount: 0.5 }] });
      const [xa, oa] = [await read(env, x), await read(env, out)];
      const [da, db] = [Array.from(await read(env, d1)), Array.from(await read(env, d2))];
      check(da.every((v) => v >= -1e-6) && db.every((v) => v >= -1e-6), 'a density mask is negative somewhere');
      check(Math.min(...da) <= 1e-6, 'a positive mask is not 0 at the densest area');
      check(worst(oa, 3, (i, k) => xa[3 * i + k]! - da[i]! - 0.5 * db[i]!) <= TOL, 'print.combine with density masks is not x − Σ a·d_m');
    },
  },
  {
    id: 'print.combine semantics: filters multiply H by 10^(a·m·logH), the preflash adds a·φ after them, the main amount scales the main', op: 'print.combine', needs: ['print.combine', 'mask.linear'],
    async run(env) {
      const x = env.input('paper-logH');
      const m = env.build('mask.linear', [x.id], { from: { x: 0, y: 0 }, to: { x: 12, y: 0 } });
      const logH = [0.1, -0.05, 0.02];
      const out = env.build('print.combine', [x.id], {
        mainAmount: 0.8, filters: [{ logH, amount: 0.5 }, { logH: [0, 0.2, 0], amount: 1, mask: m.id }], preflash: [{ fraction: 0.03, amount: 2 }],
      });
      const [xa, ma, oa] = [await read(env, x), await read(env, m), await read(env, out)];
      const want = [0, 0, 0];
      check(worst(oa, 3, (i, k) => {
        lightH({ xMain: px3(xa, i), wMain: 0.8, terms: [], densities: [], filters: [{ logH, w: 0.5 }, { logH: [0, 0.2, 0], w: ma[i]! }], preflash: [{ fraction: 0.03, w: 2 }] }, want);
        return want[k]!;
      }) <= TOL, 'filters, preflash or the main amount are not the light law (lightH)');
    },
  },
  {
    id: 'composite.mix semantics: back + a·m·(top − back); amount 1 without a mask is top, amount 0 is back', op: 'composite.mix', needs: ['composite.mix', 'mask.linear'],
    async run(env) {
      const back = env.input('print-xyz');
      const top = env.build('source.pattern', [], { domain: 'print-xyz', width: 12, height: 10, seed: 99 });
      const m = env.build('mask.linear', [back.id], { from: { x: 0, y: 0 }, to: { x: 12, y: 0 } });
      const [ba, ta, ma] = [await read(env, back), await read(env, top), await read(env, m)];
      const mixed = await read(env, env.build('composite.mix', [back.id], { top: top.id, amount: 0.6, mask: m.id }));
      check(worst(mixed, 3, (i, k) => mixPixel(ba[3 * i + k]!, ta[3 * i + k]!, 0.6 * ma[i]!)) <= TOL, 'composite.mix is not back + a·m·(top − back)');
      const one = await read(env, env.build('composite.mix', [back.id], { top: top.id, amount: 1 }));
      check(worst(one, 3, (i, k) => ta[3 * i + k]!) === 0, 'composite.mix at amount 1 is not exactly top');
      const zero = await read(env, env.build('composite.mix', [back.id], { top: top.id, amount: 0 }));
      check(worst(zero, 3, (i, k) => ba[3 * i + k]!) === 0, 'composite.mix at amount 0 is not exactly the backdrop');
    },
  },
  {
    id: 'clone semantics: clone copies the source disc, nothing else changes, a region is the crop, opacity 0 is the identity', op: 'clone', needs: ['clone'],
    async run(env) {
      const x = env.input('print-xyz');
      const spot = { x: 3, y: 5, r: 2, src: { x: 8, y: 5 }, feather: 0, opacity: 1 };
      const out = env.build('clone', [x.id], { spots: [spot] });
      const [xa, oa] = [await read(env, x), await read(env, out)];
      const W = widthOf(x);
      let inside = 0;
      check(worst(oa, 3, (i, k) => {
        const px = i % W, py = Math.floor(i / W);
        const d = Math.hypot(px + 0.5 - spot.x, py + 0.5 - spot.y);
        if (d < spot.r) inside++;
        return d < spot.r ? xa[3 * (i + 5) + k]! : xa[3 * i + k]!;
      }) <= TOL, 'clone: the disc is not the source disc moved, or pixels outside it changed');
      check(inside === 12 * 3, `clone: ${inside / 3} pixel centres in the disc, expected 12`);
      const reg = { x: 1, y: 3, w: 5, h: 4 };
      const part = await (await env.engine.evaluate(out, { scale: 'full', precision: 'export', region: reg })).read();
      let off = 0;
      for (let y = 0; y < reg.h; y++) for (let i = 0; i < reg.w; i++) for (let k = 0; k < 3; k++) off = Math.max(off, Math.abs(part[3 * (y * reg.w + i) + k]! - oa[3 * ((reg.y + y) * W + reg.x + i) + k]!));
      check(off <= TOL, `clone: a region differs from the crop of the full result by ${off}`);
      const none = env.build('clone', [x.id], { spots: [{ ...spot, opacity: 0 }] });
      check(worst(await read(env, none), 3, (i, k) => xa[3 * i + k]!) <= TOL, 'opacity 0 changed the image');
    },
  },
  {
    id: 'heal and clone semantics: heal from the target itself is the identity; spots apply in order, a later one reading what an earlier one left (contract 1.0)', op: 'heal', needs: ['heal', 'clone'],
    async run(env) {
      const x = env.input('print-xyz');
      const xa = await read(env, x);
      const self = env.build('heal', [x.id], { spots: [{ x: 6, y: 5, r: 3, src: { x: 6, y: 5 }, feather: 0.5, opacity: 1 }] });
      check(worst(await read(env, self), 3, (i, k) => xa[3 * i + k]!) <= 1e-4 * 2, 'heal with the source on the target changed the image');
      const W = widthOf(x);
      // a moves (8, 4) onto (4, 4); b then copies (4, 4) onto (4, 8): b reads a's result
      const a = { x: 4, y: 4, r: 1.5, src: { x: 8, y: 4 }, feather: 0, opacity: 1 };
      const b = { x: 4, y: 8, r: 1.5, src: { x: 4, y: 4 }, feather: 0, opacity: 1 };
      const two = await read(env, env.build('clone', [x.id], { spots: [a, b] }));
      const i = 8 * W + 4; // pixel (4, 8): centre (4.5, 8.5), in b's disc
      check(worst(px3(two, i), 3, (_, k) => xa[3 * (4 * W + 8) + k]!) <= TOL, 'the later spot did not read the image as the earlier spot left it');
    },
  },
  {
    id: 'mask semantics: combine is the one algebra (add = max, subtract = v·(1 − c), intersect = v·c, faded by amount); invert is 1 − m; constant is uniform', op: 'mask.combine', needs: ['mask.combine', 'mask.invert', 'mask.constant', 'mask.linear', 'mask.ellipse'],
    async run(env) {
      const r = env.input('camera-linear');
      const a = env.build('mask.linear', [r.id], { from: { x: 0, y: 0 }, to: { x: 12, y: 0 } });
      const b = env.build('mask.ellipse', [r.id], { box: { x: 1, y: 1, w: 9, h: 8 } });
      const [ma, mb] = [await read(env, a), await read(env, b)];
      for (const mode of ['add', 'subtract', 'intersect'] as const) {
        for (const amount of [1, 0.4]) {
          const mc = await read(env, env.build('mask.combine', [a.id], { other: b.id, mode, amount }));
          check(worst(mc, 1, (i) => maskCombine(mode, ma[i]!, mb[i]!, amount)) <= 1e-6, `mask.combine ${mode} at amount ${amount} is not the algebra`);
        }
      }
      check(worst(await read(env, env.build('mask.invert', [a.id], {})), 1, (i) => 1 - ma[i]!) <= 1e-6, 'mask.invert is not 1 − m');
      check(worst(await read(env, env.build('mask.constant', [r.id], { value: 0.3 })), 1, () => 0.3) <= 1e-6, 'mask.constant is not uniform');
      check(mb[4 * 12 + 5]! === 1 && mb[0]! === 0, 'mask.ellipse: centre not 1 or corner not 0');
    },
  },
  {
    id: 'mask semantics: a painted stroke covers its path and nothing far from it; erase removes', op: 'mask.paint', needs: ['mask.paint'],
    async run(env) {
      const r = env.input('camera-linear');
      const add = { points: [[1, 5, 0.5], [11, 5, 0.5]], radius: 2, hardness: 0.5, mode: 'add' };
      const m = await read(env, env.build('mask.paint', [r.id], { strokes: [add] }));
      check(m[4 * 12 + 6]! === 1, `mask.paint on the path: ${m[4 * 12 + 6]}`);
      check(m[0]! === 0 && m[9 * 12 + 6]! === 0, 'mask.paint covers pixels far from the stroke');
      const erased = await read(env, env.build('mask.paint', [r.id], { strokes: [add, { points: [[6.5, 0, 0.5], [6.5, 10, 0.5]], radius: 1, hardness: 1, mode: 'erase' }] }));
      check(erased[4 * 12 + 6]! === 0 && erased[4 * 12 + 2]! === 1, 'mask.paint erase does not remove coverage');
    },
  },
  {
    id: 'mask semantics: feather keeps a flat mask flat', op: 'mask.feather', needs: ['mask.feather', 'mask.constant'],
    async run(env) {
      const r = env.input('camera-linear');
      const all = env.build('mask.constant', [r.id], { value: 1 });
      const f = await read(env, env.build('mask.feather', [all.id], { radius_px: 6 }));
      check(worst(f, 1, () => 1) <= 1e-6, 'mask.feather of the whole-frame mask is not 1 everywhere');
    },
  },
  {
    id: 'output.frame semantics: the crop box, then the orientation (cw90: output (x′, y′) reads (y′, h − 1 − x′))', op: 'output.frame', needs: ['output.frame'],
    async run(env) {
      const d = env.input('display-rgb');
      const da = await read(env, d);
      const W = widthOf(d);
      const crop = { x: 2, y: 1, w: 6, h: 5 };
      const c = env.build('output.frame', [d.id], { crop });
      const ca = await read(env, c);
      check(widthOf(c) === 6 && worst(ca, 3, (i, k) => da[3 * ((crop.y + Math.floor(i / 6)) * W + crop.x + (i % 6)) + k]!) === 0, 'output.frame crop is not the box');
      const o = env.build('output.frame', [d.id], { crop, orientation: 'cw90' });
      const oa = await read(env, o);
      check(widthOf(o) === 5, `cw90 of a 6 × 5 crop is ${widthOf(o)} wide`);
      check(worst(oa, 3, (i, k) => {
        const x2 = i % 5, y2 = Math.floor(i / 5);
        return ca[3 * ((5 - 1 - x2) * 6 + y2) + k]!;
      }) === 0, 'output.frame cw90 is not the rotated crop');
    },
  },
  {
    id: 'scan.flare semantics: T = T′(1 + f) − f per channel, f a number or [r, g, b] (contract 0.3)', op: 'scan.flare', needs: ['scan.flare'],
    async run(env) {
      const r = env.input('camera-linear');
      const one = await read(env, env.build('scan.flare', [r.id], { flare: 2 }));
      const per = await read(env, env.build('scan.flare', [r.id], { flare: [1, 2, 4] }));
      const ra = await read(env, r);
      const f = [0.01, 0.02, 0.04];
      check(worst(one, 3, (i, k) => ra[3 * i + k]! * 1.02 - 0.02) <= TOL, 'scan.flare (number) is not T′(1 + f) − f');
      check(worst(per, 3, (i, k) => ra[3 * i + k]! * (1 + f[k]!) - f[k]!) <= TOL, 'scan.flare (per channel) is not T′(1 + f_k) − f_k');
    },
  },
  {
    id: 'scan.density semantics: baseT is the zero of density and wins over the rebate (contract 0.3)', op: 'scan.density', needs: ['scan.density'],
    async run(env) {
      const r = env.input('camera-linear');
      const baseT = [0.8, 0.6, 0.5];
      const d = await read(env, env.build('scan.density', [r.id], { baseT, rebate: { x: 0, y: 0, w: 2, h: 2 } }));
      const ra = await read(env, r);
      check(worst(d, 3, (i, k) => -Math.log10(Math.max(ra[3 * i + k]!, 1e-8) / baseT[k]!)) <= 1e-4, 'scan.density with baseT is not −log10(T / baseT)');
    },
  },
];

/** The semantic cases whose ops the engine implements. */
export function semanticCases(impl: ReadonlySet<string>): Case[] {
  return CASES.filter((c) => c.needs.every((o) => impl.has(o))).map((c) => ({ id: c.id, op: c.op, kind: 'semantics' as const, run: c.run }));
}
