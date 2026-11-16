//! include working.wgsl
//! include grid.wgsl
// Pointwise chain kernel (guide §5.5, decision D2 adapted): one compute kernel evaluates a *program*
// of up to 12 pointwise ops held in a uniform, so every run of pointwise ops between two
// neighbourhood operators is one dispatch, and stopping the program early gives any tap. Branches
// depend only on uniforms, so every invocation takes the same path (free on the GPU).
// Ports Studio GLSL FS_DYES / FS_PD (lookup part) / FS_PRINT (paper part) / FS_OUT (encode) with:
// exp2/log2 for powers of ten, half-texel table mapping, frame-coordinate grain (pcg4d) instead of
// the repeating noise tile, an exact per-pixel solve and manual tetrahedral lookups for export.

const LOG2_10: f32 = 3.321928094887362;
const LOG10_2: f32 = 0.3010299956639812;
const WG: u32 = 64u;
const MAXOPS: u32 = 12u;
var<workgroup> sh: array<f32, 896>;

// op codes (src/chain/program.ts OP)
const OP_DENSITY: u32 = 1u;   // T → −log10(T / Treb)
const OP_DYES: u32 = 2u;      // D → (c, residual) by solve table or exact solve
const OP_EXPOSE: u32 = 3u;    // c → x = clearL − PD(c) (table, or the exact integral on export)
const OP_LIGHT: u32 = 4u;     // print.combine fused (no texture terms): x′ = log10 max(p0·10^x + p1, 1e-8); op.y & 1: x′ = max(x + p0, −8)
const OP_DEVELOP: u32 = 5u;   // x → paper dyes by the paper curves
const OP_REFLECT: u32 = 6u;   // c_p → XYZ by the print table
const OP_FLARE: u32 = 7u;     // XYZ → (XYZ + p0) * p1.x
const OP_DISPLAY: u32 = 8u;   // XYZ → encoded RGB
const OP_GRAIN: u32 = 9u;     // c += amount √(c + 0.05) σ N(frame x, y, layer, seed)
const OP_DECODE: u32 = 10u;   // encoded source → linear (p0.x: 0 linear, 1 sRGB, 2 gamma 2.2)
const OP_ADAPT: u32 = 11u;    // XYZ → B⁻¹ · diag(p0.xyz) · B · XYZ (Bradford, view.adapt)
// masks (contract 1.0, design §25; core print/masks.ts): one value replicated in rgb, a = 1
const OP_MASK_LUM: u32 = 12u;      // mean rgb normalised to p1.xy, band p0 = (above, below, softness)
const OP_MASK_LINEAR: u32 = 13u;   // p0 = (from.x, from.y, to.x, to.y), at the frame pixel centre
const OP_MASK_ELLIPSE: u32 = 14u;  // p0 = (cx, cy, a, b), p1 = (cos, sin): antialiased tilted ellipse
const OP_MASK_INVERT: u32 = 15u;   // 1 − m
const OP_MASK_CONSTANT: u32 = 17u; // p0.x everywhere
const OP_AFFINE: u32 = 16u;        // v.rgb · p0.rgb + p1.rgb (scan.flare, contract 0.3)
// the composite stages' digital layers (contract 1.1; core composite/*.ts, src/engine/lower.ts). op.z: offset of the
// op's data in `opd`; op.w: a count or code; channel ops (curve, levels) act on L (flags 0) or on ∛ of R, G, B (1–3)
const OP_ENCODE: u32 = 18u;        // v = post · f(pre · v), f by flags: 0 identity, 1 cube root, 2 cube; opd: pre, post (row-major)
const OP_EXPOSURE: u32 = 19u;      // v · p0.x + p0.y
const OP_MIXER: u32 = 20u;         // M · v, opd: M row-major
const OP_CURVE: u32 = 21u;         // monotone cubic: opd x[n], y[n], m[n], n = op.w
const OP_LEVELS: u32 = 22u;        // p0 = (black, white, 1/γ, outBlack), p1.x = outWhite
const OP_HSL: u32 = 23u;           // opd per band (cx, cy, cos width, hue rad, sat, light), op.w bands; p0.x neutral chroma
const OP_VIBRANCE: u32 = 24u;      // p0 = (vibrance, saturation, C_ref)
const OP_GRADE: u32 = 25u;         // opd: tints (a, b) × 3, lightness × 3, exponent
const OP_VIGNETTE: u32 = 26u;      // p0 = (stops, size, e1): rgb · 2^(stops · smooth(size, e1, ρ)) on the frame
const OP_MASK_COLOUR: u32 = 27u;   // p0 = (L, a, b, tolerance), p1.x = softness
const OP_MASK_RADIAL: u32 = 28u;   // p0 = (cx, cy, a, b), p1 = (cos, sin, feather)
const OP_SAVE: u32 = 29u;          // the backdrop of a fused composite.mix: bk = v
const OP_MIX: u32 = 30u;           // v = wkMix(bk, v, p0.x, blend = flags, encoding = op.w)
const OP_MASK_RECT: u32 = 31u;     // p0 = (cx, cy, w/2, h/2), p1 = (cos, sin): antialiased tilted rectangle (contract 1.6)

// Bradford (core print/colour.ts BRADFORD) and its inverse, column by column (WGSL matrices are column-major)
const BRAD = mat3x3<f32>(vec3<f32>(0.8951, -0.7502, 0.0389), vec3<f32>(0.2664, 1.7135, -0.0685), vec3<f32>(-0.1614, 0.0367, 1.0296));
const BRAD_INV = mat3x3<f32>(
  vec3<f32>(0.9869929054667123, 0.43230526972339445, -0.008528664575177328),
  vec3<f32>(-0.1470542564209901, 0.5183602715367774, 0.04004282165408486),
  vec3<f32>(0.15996265166373122, 0.049291228212855594, 0.96848669578755));

struct Prog {
  ops: array<vec4<u32>, 12>,
  params: array<vec4<f32>, 24>,
  Kinv: mat3x3<f32>,
  K: mat3x3<f32>,
  Dbase: vec4<f32>,
  rangesA: vec4<f32>,
  rangesB: vec4<f32>,
  outMap: vec4<u32>,
  frame: vec4<u32>,
  srcOrigin: vec4<i32>,
  misc: vec4<u32>,
  solver: vec4<f32>,
  disp: mat3x3<f32>,
  okM1: mat3x3<f32>,
  okM1i: mat3x3<f32>,
};
// rangesA = (aLo, aHi, cLo, cHi); rangesB = (cpLo, cpHi, xLo, xHi)
// outMap  = (region.x, region.y, region.w, region.h): output pixel → full-res frame by the grid rule (grid.wgsl)
// frame   = (outW, outH, frameW, frameH); srcOrigin = full-res position of source texel (0,0)
// misc    = (nOps, lookup mode 0 hw-trilinear | 1 tetra | 2 manual trilinear | 3 no half-texel,
//            exact bits: 1 solve, 2 printing density, 4 print XYZ (export, CHB-017), n spectral samples)
// solver  = (tol, gtol, maxIt, dye hi)

@group(0) @binding(0) var<uniform> U: Prog;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba32float, write>;
@group(0) @binding(3) var solveT: texture_3d<f32>;
@group(0) @binding(4) var pdT: texture_3d<f32>;
@group(0) @binding(5) var printT: texture_3d<f32>;
@group(0) @binding(6) var curves: texture_2d<f32>;
@group(0) @binding(7) var samp: sampler;
// exact spectra, 7n each: [0, 7n) solve P0 P1 P2 E0 E1 E2 B; [7n, 14n) pd W0 W1 W2 E0 E1 E2 B;
// [14n, 21n) print W0 W1 W2 E0 E1 E2 B; [21n, 21n + 9) the print table's M, row-major
@group(0) @binding(8) var<storage, read> spec: array<f32>;
// the digital layers' data (matrices, curve segments, hue bands), each op's at op.z (src/chain/program.ts packOpData)
@group(0) @binding(9) var<storage, read> opd: array<f32>;

fn p10(x: vec3<f32>) -> vec3<f32> { return exp2(LOG2_10 * x); }
fn lg10(x: vec3<f32>) -> vec3<f32> { return log2(x) * LOG10_2; }

// ---- table lookups ----
fn tetra(T: texture_3d<f32>, u: vec3<f32>, N: u32) -> vec4<f32> {
  let i = min(vec3<u32>(floor(u)), vec3<u32>(N - 2u));
  let t = u - vec3<f32>(i);
  var e1: vec3<u32>; var e2: vec3<u32>; var f: vec3<f32>;
  if (t.x >= t.y && t.y >= t.z)      { e1 = vec3<u32>(1u, 0u, 0u); e2 = vec3<u32>(1u, 1u, 0u); f = t.xyz; }
  else if (t.x >= t.z && t.z >= t.y) { e1 = vec3<u32>(1u, 0u, 0u); e2 = vec3<u32>(1u, 0u, 1u); f = t.xzy; }
  else if (t.z >= t.x && t.x >= t.y) { e1 = vec3<u32>(0u, 0u, 1u); e2 = vec3<u32>(1u, 0u, 1u); f = t.zxy; }
  else if (t.y >= t.x && t.x >= t.z) { e1 = vec3<u32>(0u, 1u, 0u); e2 = vec3<u32>(1u, 1u, 0u); f = t.yxz; }
  else if (t.y >= t.z && t.z >= t.x) { e1 = vec3<u32>(0u, 1u, 0u); e2 = vec3<u32>(0u, 1u, 1u); f = t.yzx; }
  else                               { e1 = vec3<u32>(0u, 0u, 1u); e2 = vec3<u32>(0u, 1u, 1u); f = t.zyx; }
  let v000 = textureLoad(T, i, 0);
  let v1 = textureLoad(T, i + e1, 0);
  let v2 = textureLoad(T, i + e2, 0);
  let v111 = textureLoad(T, i + vec3<u32>(1u), 0);
  return (1.0 - f.x) * v000 + (f.x - f.y) * v1 + (f.y - f.z) * v2 + f.z * v111;
}

fn trilin(T: texture_3d<f32>, u: vec3<f32>, N: u32) -> vec4<f32> {
  let i = min(vec3<u32>(floor(u)), vec3<u32>(N - 2u));
  let t = u - vec3<f32>(i);
  var acc = vec4<f32>(0.0);
  for (var c = 0u; c < 8u; c++) {
    let d = vec3<u32>(c & 1u, (c >> 1u) & 1u, (c >> 2u) & 1u);
    let w = select(1.0 - t.x, t.x, d.x == 1u) * select(1.0 - t.y, t.y, d.y == 1u) * select(1.0 - t.z, t.z, d.z == 1u);
    acc += w * textureLoad(T, i + d, 0);
  }
  return acc;
}

fn lut3(T: texture_3d<f32>, v: vec3<f32>, lo: f32, hi: f32) -> vec4<f32> {
  let N = textureDimensions(T).x;
  let Nf = f32(N);
  let u = clamp((v - vec3<f32>(lo)) / (hi - lo), vec3<f32>(0.0), vec3<f32>(1.0));
  let mode = U.misc.y;
  if (mode == 1u) { return tetra(T, u * (Nf - 1.0), N); }
  if (mode == 2u) { return trilin(T, u * (Nf - 1.0), N); }
  if (mode == 3u) { return textureSampleLevel(T, samp, u, 0.0); }          // BROKEN on purpose: no half-texel mapping
  return textureSampleLevel(T, samp, (u * (Nf - 1.0) + 0.5) / Nf, 0.0);     // the Studio's (u·32 + 0.5)/33
}

// per-layer 1-D curve lookup: channel k of row `row` at v_k, linear between the N1 samples
fn lut1c(row: u32, v: vec3<f32>, lo: f32, hi: f32) -> vec3<f32> {
  let N = textureDimensions(curves).x;
  let u = clamp((v - vec3<f32>(lo)) / (hi - lo), vec3<f32>(0.0), vec3<f32>(1.0)) * f32(N - 1u);
  var out = vec3<f32>(0.0);
  for (var k = 0u; k < 3u; k++) {
    let i = min(u32(floor(u[k])), N - 2u);
    let t = u[k] - f32(i);
    let a = textureLoad(curves, vec2<u32>(i, row), 0)[k];
    let b = textureLoad(curves, vec2<u32>(i + 1u, row), 0)[k];
    out[k] = a + (b - a) * t;
  }
  return out;
}

// ---- exact spectral integrals of the export path: Σ W 10^−(B + c·E) at spec offset `off` ----
fn specSum(off: u32, c: vec3<f32>) -> vec3<f32> {
  let n = U.misc.w;
  var s = vec3<f32>(0.0);
  for (var i = 0u; i < n; i++) {
    let e = vec3<f32>(spec[off + 3u * n + i], spec[off + 4u * n + i], spec[off + 5u * n + i]);
    let t = exp2(-LOG2_10 * (spec[off + 6u * n + i] + dot(c, e)));
    s += vec3<f32>(spec[off + i], spec[off + n + i], spec[off + 2u * n + i]) * t;
  }
  return s;
}
fn printM() -> mat3x3<f32> {
  let o = 21u * U.misc.w;
  return mat3x3<f32>(vec3<f32>(spec[o], spec[o + 3u], spec[o + 6u]), vec3<f32>(spec[o + 1u], spec[o + 4u], spec[o + 7u]), vec3<f32>(spec[o + 2u], spec[o + 5u], spec[o + 8u]));
}

// ---- exact per-pixel solve (kernels/solve.wgsl, spectra staged in workgroup memory) ----
struct Ev { F: f32, r: vec3<f32>, J0: vec3<f32>, J1: vec3<f32>, J2: vec3<f32> };
fn evalF(c: vec3<f32>, d: vec3<f32>, withJ: bool) -> Ev {
  let n = U.misc.w;
  var s = vec3<f32>(0.0); var a0 = vec3<f32>(0.0); var a1 = vec3<f32>(0.0); var a2 = vec3<f32>(0.0);
  for (var i = 0u; i < n; i++) {
    let e = vec3<f32>(sh[3u * n + i], sh[4u * n + i], sh[5u * n + i]);
    let t = exp2(-LOG2_10 * (sh[6u * n + i] + dot(c, e)));
    let w = vec3<f32>(sh[i], sh[n + i], sh[2u * n + i]) * t;
    s += w;
    if (withJ) { a0 += w.x * e; a1 += w.y * e; a2 += w.z * e; }
  }
  var o: Ev;
  o.r = -log2(s) * LOG10_2 - d;
  o.F = dot(o.r, o.r);
  if (withJ) { o.J0 = a0 / s.x; o.J1 = a1 / s.y; o.J2 = a2 / s.z; }
  return o;
}
fn solve3(b: mat3x3<f32>, g: vec3<f32>, det: f32) -> vec3<f32> {
  let b00 = b[0][0]; let b01 = b[1][0]; let b02 = b[2][0]; let b11 = b[1][1]; let b12 = b[2][1]; let b22 = b[2][2];
  let i00 = (b11 * b22 - b12 * b12) / det; let i01 = (b02 * b12 - b01 * b22) / det; let i02 = (b01 * b12 - b02 * b11) / det;
  let i11 = (b00 * b22 - b02 * b02) / det; let i12 = (b01 * b02 - b00 * b12) / det; let i22 = (b00 * b11 - b01 * b01) / det;
  return vec3<f32>(i00 * g.x + i01 * g.y + i02 * g.z, i01 * g.x + i11 * g.y + i12 * g.z, i02 * g.x + i12 * g.y + i22 * g.z);
}
fn exactSolve(a: vec3<f32>, d: vec3<f32>) -> vec4<f32> {
  let lo = vec3<f32>(0.0); let hi = vec3<f32>(U.solver.w);
  var x = clamp(a, lo, hi);
  var ev = evalF(x, d, true);
  var F = ev.F;
  var mu: f32 = 1e-3;
  for (var it = 0u; it < u32(U.solver.z) && F > U.solver.x; it++) {
    let R = mat3x3<f32>(ev.J0, ev.J1, ev.J2);
    let A = R * transpose(R);
    var g = R * ev.r;
    let held = ((x <= lo) & (g > vec3<f32>(0.0))) | ((x >= hi) & (g < vec3<f32>(0.0)));
    g = select(g, vec3<f32>(0.0), held);
    if (max(abs(g.x), max(abs(g.y), abs(g.z))) < U.solver.y) { break; }
    let m = select(vec3<f32>(1.0), vec3<f32>(0.0), held);
    var improved = false;
    for (var tries = 0; tries < 12; tries++) {
      var b = A + mat3x3<f32>(vec3<f32>(mu * (1.0 + A[0][0]), 0.0, 0.0), vec3<f32>(0.0, mu * (1.0 + A[1][1]), 0.0), vec3<f32>(0.0, 0.0, mu * (1.0 + A[2][2])));
      b = mat3x3<f32>(b[0] * m * m.x, b[1] * m * m.y, b[2] * m * m.z) + mat3x3<f32>(vec3<f32>(1.0 - m.x, 0.0, 0.0), vec3<f32>(0.0, 1.0 - m.y, 0.0), vec3<f32>(0.0, 0.0, 1.0 - m.z));
      let det = determinant(b);
      if (!(abs(det) > 1e-30)) { mu *= 10.0; continue; }
      let y = clamp(x - solve3(b, g, det), lo, hi);
      let F1 = evalF(y, d, false).F;
      if (F1 < F) { x = y; mu = max(mu / 3.0, 1e-12); improved = true; ev = evalF(x, d, true); F = ev.F; break; }
      mu *= 4.0;
    }
    if (!improved) { break; }
  }
  return vec4<f32>(x, sqrt(F));
}

// ---- grain: pcg4d (Jarzynski & Olano 2020) keyed on full-resolution frame coordinates ----
fn pcg4d(v0: vec4<u32>) -> vec4<u32> {
  var v = v0 * 1664525u + 1013904223u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  v = v ^ (v >> vec4<u32>(16u));
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  return v;
}
fn normal1(px: vec2<u32>, k: u32, seed: u32) -> f32 {
  let r = pcg4d(vec4<u32>(px, k, seed));
  let u1 = (f32(r.x >> 8u) + 0.5) / 16777216.0;
  let u2 = f32(r.y >> 8u) / 16777216.0;
  return sqrt(-2.0 * log(u1)) * cos(6.283185307 * u2);
}

fn srgbDec(v: vec3<f32>) -> vec3<f32> {
  return select(pow((max(v, vec3<f32>(0.04045)) + 0.055) / 1.055, vec3<f32>(2.4)), v / 12.92, v <= vec3<f32>(0.04045));
}

// ---- output.display (CHB-011): the output space's TRC and the oklch knee (core print/gamut.ts) ----

// ICC parametric type 3, inverse (core encodeCurve): y < c·d → y/c, else max(d, (y^(1/g) − b)/a).
// p0 = (g, a, b, c), p1.x = d.
fn paraEnc(y: vec3<f32>, p0: vec4<f32>, d: f32) -> vec3<f32> {
  let pw = (pow(max(y, vec3<f32>(1e-30)), vec3<f32>(1.0 / p0.x)) - p0.z) / p0.y;
  return select(max(vec3<f32>(d), pw), y / p0.w, y < vec3<f32>(p0.w * d));
}

// OkLab: OK_M2 and OK_M2I (Ottosson's M2 and its f64 inverse, core M2_INV) come from src/chain/working.ts, which
// prepends kernels/working.wgsl with core's matrices; LMS = U.okM1 · rgb is the output space's own (core oklabFor)

fn cbrt3(v: vec3<f32>) -> vec3<f32> { return sign(v) * pow(abs(v), vec3<f32>(1.0 / 3.0)); }
fn okFwd(rgb: vec3<f32>) -> vec3<f32> { return OK_M2 * cbrt3(U.okM1 * rgb); }
fn okInv(lab: vec3<f32>) -> vec3<f32> { let l = OK_M2I * lab; return U.okM1i * (l * l * l); }
fn inCube(v: vec3<f32>) -> bool { return all(v >= vec3<f32>(-1e-7)) && all(v <= vec3<f32>(1.0 + 1e-7)); }

// Reinhard knee (core knee): identity below t, asymptotic to l; n^p overflows f32 for n > 1e5, where the
// fraction n/(1 + n^p)^(1/p) is 1 to f32 precision.
fn kneeR(d: f32, t: f32, l: f32, p: f32) -> f32 {
  if (d <= t) { return d; }
  let s = l - t;
  let n = (d - t) / s;
  let q = select(n / pow(1.0 + pow(n, p), 1.0 / p), 1.0, n > 1e5);
  return t + s * q;
}

// Largest OkLab chroma at (L, h) whose whole way from grey is in the gamut (core maxChromaOf): a march of
// CHROMA_MARCH steps over [0, 0.5] finds the first exit (the gamut along the ray need not be one interval), then 26
// halvings of that step reach f32 resolution; still inside at 0.5, the reach doubles (as before).
const CHROMA_MARCH: i32 = 64;
fn okMaxChroma(L: f32, ca: f32, sa: f32) -> f32 {
  var lo = 0.0;
  var hi = 0.5;
  var left = false;
  for (var k = 1; k <= CHROMA_MARCH; k++) {
    let c = f32(k) * (0.5 / f32(CHROMA_MARCH));
    if (!inCube(okInv(vec3<f32>(L, c * ca, c * sa)))) { hi = c; left = true; break; }
    lo = c;
  }
  for (var i = 0; i < 4; i++) {
    if (!left && inCube(okInv(vec3<f32>(L, hi * ca, hi * sa)))) { lo = hi; hi = 2.0 * hi; }
  }
  for (var i = 0; i < 26; i++) {
    let m = 0.5 * (lo + hi);
    if (inCube(okInv(vec3<f32>(L, m * ca, m * sa)))) { lo = m; } else { hi = m; }
  }
  return lo;
}

// core compressOutput, algorithm 'oklch': chroma knee (0, 1, 6); lightness knee (t, 1, 2.2) when
// lightOn (print-as-seen), else a clip at white (scan-of-print).
fn okKnee(rgb: vec3<f32>, lightOn: bool, lightT: f32) -> vec3<f32> {
  let lab = okFwd(rgb);
  let L0 = lab.x;
  if (!(L0 > 0.0)) { return vec3<f32>(0.0); }
  var L = min(L0, 1.0);
  if (lightOn) { L = min(kneeR(L0, lightT, 1.0, 2.2), 1.0); }
  if (L >= 1.0) { return vec3<f32>(1.0); }
  // the hue direction as a unit vector, not atan2/cos/sin: WGSL only requires 2^-11 absolute accuracy
  // of sin/cos, which moved the hue by up to 1.5e-4 in linear RGB on SwiftShader
  let C = length(lab.yz);
  var ca = 1.0;
  var sa = 0.0;
  if (C > 1e-12) { ca = lab.y / C; sa = lab.z / C; }
  let Cmax = okMaxChroma(L, ca, sa);
  var Cn = 0.0;
  if (Cmax > 0.0) { Cn = Cmax * kneeR(C / Cmax, 0.0, 1.0, 6.0); }
  return clamp(okInv(vec3<f32>(L, Cn * ca, Cn * sa)), vec3<f32>(0.0), vec3<f32>(1.0));
}

// ---- the CAM16-UCS knee (CHB-047 OUT-3; core gamut.ts perceptual('cam16-ucs'), compressOutput) ----
// spektrafilm's viewing conditions with D = 1 (core CAM16_VIEWING). U.okM1 = diag(D_RGB)·M16·(100·toXYZ): the output
// space's linear RGB to the adapted cone signals; U.okM1i its inverse (core cam16Knee). The op's data at o: F_L, A_w,
// N_bb, c·z, t_k, (50000/13)·N_c·N_cb, J′ of white, F_L^¼. The hue travels as a unit vector (ca, sa) = (cos h, sin h)
// (as the oklch knee: WGSL's sin and cos need only 2^-11 absolute accuracy), so cos(h + 2) = ca·cos 2 − sa·sin 2.
struct C16 { FL: f32, Aw: f32, Nbb: f32, cz: f32, tk: f32, ncb: f32, Jw: f32, FL4: f32 }
fn c16At(o: u32) -> C16 { return C16(opd[o], opd[o + 1u], opd[o + 2u], opd[o + 3u], opd[o + 4u], opd[o + 5u], opd[o + 6u], opd[o + 7u]); }
fn c16Et(ca: f32, sa: f32) -> f32 { return 0.25 * (ca * -0.4161468365471424 - sa * 0.9092974268256817 + 3.8); }
fn c16Post(x: vec3<f32>, FL: f32) -> vec3<f32> {
  let y = pow(FL * abs(x) / 100.0, vec3<f32>(0.42));
  return 400.0 * sign(x) * y / (27.13 + y) + 0.1;
}
// J′, M′ and the hue direction of linear RGB (core cam16 fwd, jmhToUcs)
fn c16Fwd(rgb: vec3<f32>, k: C16) -> vec4<f32> {
  let Ra = c16Post(U.okM1 * rgb, k.FL);
  let a = Ra.x - 12.0 * Ra.y / 11.0 + Ra.z / 11.0;
  let b = (Ra.x + Ra.y - 2.0 * Ra.z) / 9.0;
  let r = length(vec2<f32>(a, b));
  var ca = 1.0;
  var sa = 0.0;
  if (r > 1e-20) { ca = a / r; sa = b / r; }
  let A = (2.0 * Ra.x + Ra.y + 0.05 * Ra.z - 0.305) * k.Nbb;
  let J = 100.0 * sign(A) * pow(abs(A / k.Aw), k.cz);
  let t = k.ncb * c16Et(ca, sa) * r / (Ra.x + Ra.y + 1.05 * Ra.z);
  let M = pow(abs(t), 0.9) * sqrt(abs(J) / 100.0) * k.tk * k.FL4;
  return vec4<f32>(1.7 * J / (1.0 + 0.007 * J), log(1.0 + 0.0228 * M) / 0.0228, ca, sa);
}
// linear RGB of J′, M′ along (ca, sa) (core ucsToJmh, cam16 inv); not finite where the model has no answer
fn c16Inv(Jp: f32, Mp: f32, ca: f32, sa: f32, k: C16) -> vec3<f32> {
  let J = Jp / (1.7 - 0.007 * Jp);
  let M = (exp(0.0228 * Mp) - 1.0) / 0.0228;
  let C = M / k.FL4;
  var t = 0.0;
  if (J != 0.0) { t = pow(C / (sqrt(abs(J) / 100.0) * k.tk), 1.0 / 0.9); }
  let A = k.Aw * pow(abs(J / 100.0), 1.0 / k.cz);
  let p2 = A / k.Nbb + 0.305;
  let p3 = 21.0 / 20.0;
  var a = 0.0;
  var b = 0.0;
  if (t != 0.0) {
    let p1 = k.ncb * c16Et(ca, sa) / t;
    if (abs(sa) >= abs(ca)) {
      b = p2 * (2.0 + p3) * (460.0 / 1403.0) / (p1 / sa + (2.0 + p3) * (220.0 / 1403.0) * (ca / sa) - 27.0 / 1403.0 + p3 * (6300.0 / 1403.0));
      a = b * ca / sa;
    } else {
      a = p2 * (2.0 + p3) * (460.0 / 1403.0) / (p1 / ca + (2.0 + p3) * (220.0 / 1403.0) - (27.0 / 1403.0 - p3 * (6300.0 / 1403.0)) * (sa / ca));
      b = a * sa / ca;
    }
  }
  let Ra = vec3<f32>(460.0 * p2 + 451.0 * a + 288.0 * b, 460.0 * p2 - 891.0 * a - 261.0 * b, 460.0 * p2 - 220.0 * a - 6300.0 * b) / 1403.0;
  let d = abs(Ra - 0.1);
  let RGB = sign(Ra - 0.1) * (100.0 / k.FL) * pow(27.13 * d / (400.0 - d), vec3<f32>(1.0 / 0.42));
  return U.okM1i * RGB;
}
// inside the cube and finite (core inGamut: Number.isFinite and inCube); d < 400 keeps the post-adaptation invertible
fn c16Ok(Jp: f32, Mp: f32, ca: f32, sa: f32, k: C16) -> bool {
  let v = c16Inv(Jp, Mp, ca, sa, k);
  return all(v == v) && inCube(v);
}
// largest in-gamut M′ at (J′, h) by bisection (core maxChromaOf from cHi 150; 30 halvings reach f32 resolution)
fn c16MaxChroma(Jp: f32, ca: f32, sa: f32, k: C16) -> f32 {
  var lo = 0.0;
  var hi = 150.0;
  for (var i = 0; i < 8; i++) {
    if (c16Ok(Jp, hi, ca, sa, k)) { lo = hi; hi = 2.0 * hi; } else { break; }
  }
  for (var i = 0; i < 30; i++) {
    let m = 0.5 * (lo + hi);
    if (c16Ok(Jp, m, ca, sa, k)) { lo = m; } else { hi = m; }
  }
  return lo;
}
// core compressOutput, algorithm 'cam16-ucs': as okKnee with lightness J′ normalised by the white's J′
fn c16Knee(rgb: vec3<f32>, lightOn: bool, lightT: f32, o: u32) -> vec3<f32> {
  let k = c16At(o);
  let f = c16Fwd(rgb, k);
  let L0 = f.x;
  if (!(L0 > 0.0)) { return vec3<f32>(0.0); }
  var L = min(L0, k.Jw);
  if (lightOn) { L = min(k.Jw * kneeR(L0 / k.Jw, lightT, 1.0, 2.2), k.Jw); }
  if (L >= k.Jw) { return vec3<f32>(1.0); }
  let Cmax = c16MaxChroma(L, f.z, f.w, k);
  var Cn = 0.0;
  if (Cmax > 0.0) { Cn = Cmax * kneeR(f.y / Cmax, 0.0, 1.0, 6.0); }
  return clamp(c16Inv(L, Cn, f.z, f.w, k), vec3<f32>(0.0), vec3<f32>(1.0));
}

// ---- the digital layers (core composite/*.ts) ----

fn opMat(o: u32) -> mat3x3<f32> {
  return mat3x3<f32>(vec3<f32>(opd[o], opd[o + 3u], opd[o + 6u]), vec3<f32>(opd[o + 1u], opd[o + 4u], opd[o + 7u]), vec3<f32>(opd[o + 2u], opd[o + 5u], opd[o + 8u]));
}

// core evalCurve: the Hermite segment of v, or the end tangents beyond the points
fn curveAt(o: u32, n: u32, v: f32) -> f32 {
  let x0 = opd[o];
  let xn = opd[o + n - 1u];
  if (v <= x0) { return opd[o + n] + opd[o + 2u * n] * (v - x0); }
  if (v >= xn) { return opd[o + 2u * n - 1u] + opd[o + 3u * n - 1u] * (v - xn); }
  var k = 0u;
  while (k < n - 2u && v > opd[o + k + 1u]) { k++; }
  let xa = opd[o + k];
  let h = opd[o + k + 1u] - xa;
  let t = (v - xa) / h;
  let t2 = t * t;
  let t3 = t2 * t;
  return (2.0 * t3 - 3.0 * t2 + 1.0) * opd[o + n + k] + (t3 - 2.0 * t2 + t) * h * opd[o + 2u * n + k]
    + (-2.0 * t3 + 3.0 * t2) * opd[o + n + k + 1u] + (t3 - t2) * h * opd[o + 2u * n + k + 1u];
}

// core evalLevels
fn levelsAt(p0: vec4<f32>, outWhite: f32, v: f32) -> f32 {
  let t = (v - p0.x) / (p0.y - p0.x);
  var g = t;
  if (t > 0.0 && t < 1.0) { g = pow(t, p0.z); }
  return p0.w + (outWhite - p0.w) * g;
}

// sin and cos of |x| ≤ π/3 (hsl's hue shift) by their Taylor series to x¹¹ / x¹²: error below 1e-8, unlike WGSL's
// sin/cos (2^−11 absolute on SwiftShader, CHB-037 P3)
fn sinCosSmall(x: f32) -> vec2<f32> {
  let q = x * x;
  let s = x * (1.0 - q / 6.0 * (1.0 - q / 20.0 * (1.0 - q / 42.0 * (1.0 - q / 72.0 * (1.0 - q / 110.0)))));
  let c = 1.0 - q / 2.0 * (1.0 - q / 12.0 * (1.0 - q / 30.0 * (1.0 - q / 56.0 * (1.0 - q / 90.0 * (1.0 - q / 132.0)))));
  return vec2<f32>(s, c);
}

// core hslAt
fn hslAt(v: vec3<f32>, o: u32, n: u32, neutral: f32) -> vec3<f32> {
  let C = length(v.yz);
  if (!(C > 0.0)) { return v; }
  let ca = v.y / C;
  let sa = v.z / C;
  var sw = 0.0; var dh = 0.0; var ds = 0.0; var dl = 0.0;
  for (var i = 0u; i < n; i++) {
    let q = o + 6u * i;
    let w = wkSmooth(opd[q + 2u], 1.0, ca * opd[q] + sa * opd[q + 1u]);
    sw += w; dh += w * opd[q + 3u]; ds += w * opd[q + 4u]; dl += w * opd[q + 5u];
  }
  let k = wkSmooth(0.0, neutral, C) / max(1.0, sw);
  let r = sinCosSmall(k * dh);
  let C2 = C * max(0.0, 1.0 + k * ds);
  return vec3<f32>(v.x + 0.25 * k * dl, C2 * (ca * r.y - sa * r.x), C2 * (sa * r.y + ca * r.x));
}

// a tone function on L of an OkLab pixel (ch 0) or on ∛ of one linear RGB channel (1–3)
fn toneCh(v: vec3<f32>, ch: u32, op: vec4<u32>, p0: vec4<f32>, p1: vec4<f32>) -> vec3<f32> {
  var x = v.x;
  if (ch > 0u) { x = wkCbrt1(v[ch - 1u]); }
  var y = 0.0;
  if (op.x == 21u) { y = curveAt(op.z, op.w, x); } else { y = levelsAt(p0, p1.x, x); }
  var out = v;
  if (ch == 0u) { out.x = y; } else { out[ch - 1u] = y * y * y; }
  return out;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  // stage the solve spectra (only when the exact solve runs); barrier before any range check
  if ((U.misc.z & 1u) != 0u) {
    for (var i = li; i < 7u * U.misc.w; i += WG) { sh[i] = spec[i]; }
  }
  workgroupBarrier();
  let p = gid.xy;
  if (p.x >= U.frame.x || p.y >= U.frame.y) { return; }
  // output pixel → full-res frame pixel (nearest sample, like the mock engine) → source texel
  let fp = gridSample(p, U.outMap, U.frame.xy);
  // srcOrigin.z = 1: the source is the previous segment's output, read at p
  let sp = select(vec2<i32>(fp) - U.srcOrigin.xy, vec2<i32>(p), U.srcOrigin.z == 1);
  var v = textureLoad(src, sp, 0);
  var bk = v; // the backdrop register of a fused composite.mix (SAVE … MIX)
  for (var o = 0u; o < U.misc.x; o++) {
    let op = U.ops[o];
    let p0 = U.params[2u * o];
    let p1 = U.params[2u * o + 1u];
    switch (op.x) {
      case 1u: { v = vec4<f32>(-lg10(max(v.rgb, vec3<f32>(1e-8)) / p0.rgb), v.a); }
      case 2u: {
        let D = v.rgb;
        let a = U.Kinv * D;
        if ((U.misc.z & 1u) != 0u) { v = exactSolve(a, D + U.Dbase.xyz); }
        else { v = lut3(solveT, a, U.rangesA.x, U.rangesA.y); }
      }
      case 3u: {
        if ((U.misc.z & 2u) != 0u) { v = vec4<f32>(p0.rgb + lg10(specSum(7u * U.misc.w, v.rgb)), 0.0); }
        else { v = vec4<f32>(p0.rgb - lut3(pdT, v.rgb, U.rangesA.z, U.rangesA.w).xyz, 0.0); }
      }
      case 4u: {
        // the light law without texture terms (src/engine/light.ts lightPointwise; contract lightH)
        if ((op.y & 1u) != 0u) { v = vec4<f32>(max(v.rgb + p0.rgb, vec3<f32>(-8.0)), 0.0); }
        else { v = vec4<f32>(lg10(max(p0.rgb * p10(v.rgb) + p1.rgb, vec3<f32>(1e-8))), 0.0); }
      }
      case 5u: {
        // op.y & 1: the grade (CHB-010), x′ = pivot + γ·(x − pivot) with p0 = pivot (the aim grey), p1 = γ
        var x = v.rgb;
        if ((op.y & 1u) != 0u) { x = p0.rgb + p1.rgb * (x - p0.rgb); }
        v = vec4<f32>(lut1c(0u, x, U.rangesB.z, U.rangesB.w), 0.0);
      }
      case 6u: {
        if ((U.misc.z & 4u) != 0u) { v = vec4<f32>(printM() * specSum(14u * U.misc.w, v.rgb), 0.0); }
        else { v = vec4<f32>(lut3(printT, v.rgb, U.rangesB.x, U.rangesB.y).xyz, 0.0); }
      }
      case 7u: { v = vec4<f32>((v.rgb + p0.rgb) * p1.x, v.a); }
      case 8u: {
        // XYZ → linear RGB by U.disp (core displaySetup: fromXYZ(space) · Bradford(source white → space
        // white)); op.y: knee 0 clip, 1 tanh shoulder at p1.w (core tanhShoulder), 2 oklch, 3 cam16-ucs (core
        // compressOutput; its constants in opd at op.z); then the space's TRC (p0, p1.x). Nothing but the TRC follows the knee.
        var rgb = U.disp * v.rgb;
        // (the tanh argument is capped at 20, where tanh is 1 in f32, so an exp-based tanh cannot overflow)
        let s = p1.w;
        if (op.y == 1u) { rgb = select(s + (1.0 - s) * tanh(min((rgb - vec3<f32>(s)) / (1.0 - s), vec3<f32>(20.0))), rgb, rgb <= vec3<f32>(s)); }
        if (op.y == 2u) { rgb = okKnee(rgb, p1.z > 0.5, p1.y); }
        if (op.y == 3u) { rgb = c16Knee(rgb, p1.z > 0.5, p1.y, op.z); }
        v = vec4<f32>(paraEnc(clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0)), p0, p1.x), 0.0);
      }
      case 9u: {
        let seed = op.y;
        var c = v.rgb;
        for (var k = 0u; k < 3u; k++) { c[k] = max(c[k] + p0.x * p0.y * sqrt(max(c[k], 0.0) + 0.05) * normal1(fp, k, seed), 0.0); }
        v = vec4<f32>(c, v.a);
      }
      case 10u: {
        if (p0.x == 1.0) { v = vec4<f32>(srgbDec(v.rgb), v.a); }
        else if (p0.x == 2.0) { v = vec4<f32>(pow(max(v.rgb, vec3<f32>(0.0)), vec3<f32>(2.2)), v.a); }
      }
      case 11u: { v = vec4<f32>(BRAD_INV * (p0.xyz * (BRAD * v.rgb)), v.a); }
      case 12u: {
        // above ≤ 0 / below ≥ 1 leave that side open (core luminanceAt)
        let L = ((v.r + v.g + v.b) / 3.0 - p1.x) / (p1.y - p1.x);
        let s = max(p0.z, 1e-9);
        var up = 1.0;
        if (p0.x > 0.0) { up = clamp((L - p0.x) / s + 0.5, 0.0, 1.0); }
        var dn = 1.0;
        if (p0.y < 1.0) { dn = clamp((p0.y - L) / s + 0.5, 0.0, 1.0); }
        let m = min(up, dn);
        v = vec4<f32>(m, m, m, 1.0);
      }
      case 13u: {
        let X = vec2<f32>(fp) + 0.5;
        let d = p0.zw - p0.xy;
        let l2 = dot(d, d);
        var m = 1.0;
        if (l2 > 0.0) { m = clamp(1.0 - dot(X - p0.xy, d) / l2, 0.0, 1.0); }
        v = vec4<f32>(m, m, m, 1.0);
      }
      case 14u: {
        let d = vec2<f32>(fp) + 0.5 - p0.xy;
        let u = (p1.x * d.x + p1.y * d.y) / p0.z;
        let w = (-p1.y * d.x + p1.x * d.y) / p0.w;
        let rho = sqrt(u * u + w * w);
        var m = 1.0;
        if (rho >= 1e-6) {
          let g = vec2<f32>(u * p1.x / p0.z - w * p1.y / p0.w, u * p1.y / p0.z + w * p1.x / p0.w) / rho;
          m = clamp(0.5 - (rho - 1.0) / max(length(g), 1e-12), 0.0, 1.0);
        }
        v = vec4<f32>(m, m, m, 1.0);
      }
      case 15u: { let m = 1.0 - v.r; v = vec4<f32>(m, m, m, 1.0); }
      case 16u: { v = vec4<f32>(v.rgb * p0.rgb + p1.rgb, v.a); }
      case 17u: { v = vec4<f32>(p0.x, p0.x, p0.x, 1.0); }
      case 18u: {
        var q = opMat(op.z) * v.rgb;
        if (op.y == 1u) { q = wkCbrt(q); } else if (op.y == 2u) { q = q * q * q; }
        v = vec4<f32>(opMat(op.z + 9u) * q, v.a);
      }
      case 19u: { v = vec4<f32>(v.rgb * p0.x + p0.y, v.a); }
      case 20u: { v = vec4<f32>(opMat(op.z) * v.rgb, v.a); }
      case 21u, 22u: { v = vec4<f32>(toneCh(v.rgb, op.y, op, p0, p1), v.a); }
      case 23u: { v = vec4<f32>(hslAt(v.rgb, op.z, op.w, p0.x), v.a); }
      case 24u: {
        let C = length(v.yz);
        let u = 1.0 - C / p0.z;
        var g = 1.0 + p0.y;
        if (C < p0.z) { g = (1.0 + p0.x * u * u) * (1.0 + p0.y); }
        v = vec4<f32>(v.x, v.yz * g, v.a);
      }
      case 25u: {
        let L = v.x;
        let t = pow(clamp(L, 0.0, 1.0), opd[op.z + 9u]);
        let w = vec3<f32>((1.0 - t) * (1.0 - t), 2.0 * t * (1.0 - t), t * t);
        let g0 = op.z;
        let da = w.x * opd[g0] + w.y * opd[g0 + 2u] + w.z * opd[g0 + 4u];
        let db = w.x * opd[g0 + 1u] + w.y * opd[g0 + 3u] + w.z * opd[g0 + 5u];
        let dl = w.x * opd[g0 + 6u] + w.y * opd[g0 + 7u] + w.z * opd[g0 + 8u];
        let f = max(L, 0.0);
        v = vec4<f32>(L + 0.25 * dl, v.y + f * da, v.z + f * db, v.a);
      }
      case 26u: {
        // core vignetteGain at the full-resolution frame pixel's centre
        let W = f32(U.frame.z);
        let Hf = f32(U.frame.w);
        let d = (vec2<f32>(fp) + 0.5 - vec2<f32>(W, Hf) * 0.5) / (vec2<f32>(W, Hf) * 0.5);
        let rho = sqrt(dot(d, d) / 2.0);
        var t = select(0.0, 1.0, rho >= p0.y);
        if (p0.z - p0.y > 1e-6) { t = wkSmooth(p0.y, p0.z, rho); }
        v = vec4<f32>(v.rgb * exp2(p0.x * t), v.a);
      }
      case 27u: {
        // core colourAt
        let d = length(v.rgb - p0.xyz);
        var m = 1.0;
        if (d > p0.w) {
          m = 0.0;
          if (p1.x > 0.0) { let u = min(1.0, (d - p0.w) / p1.x); m = 1.0 - u * u * (3.0 - 2.0 * u); }
        }
        v = vec4<f32>(m, m, m, 1.0);
      }
      case 28u: {
        // core radialAt
        let e = vec2<f32>(fp) + 0.5 - p0.xy;
        let d = length(vec2<f32>((p1.x * e.x + p1.y * e.y) / p0.z, (-p1.y * e.x + p1.x * e.y) / p0.w));
        let inner = 1.0 - p1.z;
        var m = 1.0;
        if (d > inner) { let u = min(1.0, (d - inner) / max(1e-4, p1.z)); m = 1.0 - u * u * (3.0 - 2.0 * u); }
        v = vec4<f32>(m, m, m, 1.0);
      }
      case 31u: {
        // core rectAt: clamp(½ − d), d the signed distance outside the rotated box
        let e = vec2<f32>(fp) + 0.5 - p0.xy;
        let u = p1.x * e.x + p1.y * e.y;
        let w = -p1.y * e.x + p1.x * e.y;
        let m = clamp(0.5 - max(abs(u) - p0.z, abs(w) - p0.w), 0.0, 1.0);
        v = vec4<f32>(m, m, m, 1.0);
      }
      case 29u: { bk = v; }
      case 30u: { v = wkMix(bk, v, p0.x, op.y, op.w); }
      default: {}
    }
  }
  textureStore(dst, vec2<i32>(p), v);
}
