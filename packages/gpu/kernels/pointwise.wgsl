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
const OP_ADD: u32 = 4u;       // v.rgb += p0.rgb
const OP_DEVELOP: u32 = 5u;   // x → paper dyes by the paper curves
const OP_REFLECT: u32 = 6u;   // c_p → XYZ by the print table
const OP_FLARE: u32 = 7u;     // XYZ → (XYZ + p0) * p1.x
const OP_DISPLAY: u32 = 8u;   // XYZ → encoded RGB
const OP_GRAIN: u32 = 9u;     // c += amount √(c + 0.05) σ N(frame x, y, layer, seed)
const OP_DECODE: u32 = 10u;   // encoded source → linear (p0.x: 0 linear, 1 sRGB, 2 gamma 2.2)
const OP_ADAPT: u32 = 11u;    // XYZ → B⁻¹ · diag(p0.xyz) · B · XYZ (Bradford, view.adapt)

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
  outMap: vec4<f32>,
  frame: vec4<u32>,
  srcOrigin: vec4<i32>,
  misc: vec4<u32>,
  solver: vec4<f32>,
  disp: mat3x3<f32>,
};
// rangesA = (aLo, aHi, cLo, cHi); rangesB = (cpLo, cpHi, xLo, xHi)
// outMap  = (region.x, region.y, region.w / outW, region.h / outH): output pixel → full-res frame
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

fn srgbEnc(v: vec3<f32>) -> vec3<f32> {
  return select(1.055 * pow(max(v, vec3<f32>(0.0031308)), vec3<f32>(1.0 / 2.4)) - 0.055, 12.92 * v, v <= vec3<f32>(0.0031308));
}
fn srgbDec(v: vec3<f32>) -> vec3<f32> {
  return select(pow((max(v, vec3<f32>(0.04045)) + 0.055) / 1.055, vec3<f32>(2.4)), v / 12.92, v <= vec3<f32>(0.04045));
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
  let fp = vec2<u32>(U.outMap.xy + floor((vec2<f32>(p) + 0.5) * U.outMap.zw));
  // srcOrigin.z = 1: the source is the previous segment's output, read at p
  let sp = select(vec2<i32>(fp) - U.srcOrigin.xy, vec2<i32>(p), U.srcOrigin.z == 1);
  var v = textureLoad(src, sp, 0);
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
      case 4u: { v = vec4<f32>(v.rgb + p0.rgb, v.a); }
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
        // XYZ → linear RGB by U.disp (core: XYZ_TO_SRGB · Bradford(white → D65) · gain); op.y: knee 0 clip,
        // 1 tanh shoulder (core gamut.ts: identity to 0.82, then 0.82 + 0.18 tanh((v − 0.82)/0.18))
        var rgb = U.disp * v.rgb;
        // (the argument is capped at 20, where tanh is 1 in f32, so an exp-based tanh cannot overflow)
        if (op.y == 1u) { rgb = select(0.82 + 0.18 * tanh(min((rgb - vec3<f32>(0.82)) / 0.18, vec3<f32>(20.0))), rgb, rgb <= vec3<f32>(0.82)); }
        v = vec4<f32>(srgbEnc(clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0))), 0.0);
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
      default: {}
    }
  }
  textureStore(dst, vec2<i32>(p), v);
}
