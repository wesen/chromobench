// SOLVE: the bounded Levenberg–Marquardt dye solve of one table node per invocation.
// Ported nearly verbatim from Chromogen Studio gpu.js SOLVE (05-inline.js 3409–3492); the measured
// kernel of textbook §4.5. Changes: the result is also written to a 3-D storage texture, and the
// uniform struct is generated from src/tables/build-gpu.ts SOLVE_PARAMS (a test checks they agree).
// Rules: stage the spectra in workgroup memory, barrier, *then* range-check (uniform control flow);
// held dyes via select masks; gtol ≥ 1e-6 (the host enforces it); no identifiers `active`/`filter`/`target`.

const WG: u32 = 64u;
const LOG2_10: f32 = 3.321928094887362;
const LOG10_2: f32 = 0.3010299956639812;
var<workgroup> sh: array<f32, 896>;   // 7 spectra × MAXN 128

// node q of an N³ table, x fastest
fn nodeAt(q: u32, N: u32, lo: f32, hi: f32) -> vec3<f32> {
  let st = (hi - lo) / f32(N - 1u);
  return vec3<f32>(f32(q % N), f32((q / N) % N), f32(q / (N * N))) * st + vec3<f32>(lo);
}

struct Params {
  K: mat3x3<f32>,
  Dbase: vec4<f32>,
  rng: vec4<f32>,
  N: u32,
  n: u32,
  total: u32,
  maxIt: u32,
  tol: f32,
  gtol: f32,
  activeSet: u32,
  p2: f32,
};
@group(0) @binding(0) var<uniform> U: Params;
@group(0) @binding(1) var<storage, read> spec: array<f32>;             // P0 P1 P2 E0 E1 E2 B, n samples each
@group(0) @binding(2) var<storage, read_write> outT: array<vec4<f32>>;  // c, residual
@group(0) @binding(3) var outTex: texture_storage_3d<rgba32float, write>;

struct Ev { F: f32, r: vec3<f32>, J0: vec3<f32>, J1: vec3<f32>, J2: vec3<f32> };   // J row k: ∂D_k/∂c

fn evalF(c: vec3<f32>, d: vec3<f32>, withJ: bool) -> Ev {
  let n = U.n;
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

// the inverse of a symmetric 3 × 3 matrix by its adjugate, applied to g
fn solve3(b: mat3x3<f32>, g: vec3<f32>, det: f32) -> vec3<f32> {
  let b00 = b[0][0]; let b01 = b[1][0]; let b02 = b[2][0]; let b11 = b[1][1]; let b12 = b[2][1]; let b22 = b[2][2];
  let i00 = (b11 * b22 - b12 * b12) / det; let i01 = (b02 * b12 - b01 * b22) / det; let i02 = (b01 * b12 - b02 * b11) / det;
  let i11 = (b00 * b22 - b02 * b02) / det; let i12 = (b01 * b02 - b00 * b12) / det; let i22 = (b00 * b11 - b01 * b01) / det;
  return vec3<f32>(i00 * g.x + i01 * g.y + i02 * g.z, i01 * g.x + i11 * g.y + i12 * g.z, i02 * g.x + i12 * g.y + i22 * g.z);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  // every invocation copies a share of the spectra, then all wait: the barrier must be reached by the
  // whole group, so the range check comes after it
  for (var i = li; i < 7u * U.n; i += WG) { sh[i] = spec[i]; }
  workgroupBarrier();
  let q = gid.x;
  if (q >= U.total) { return; }
  let a = nodeAt(q, U.N, U.rng.x, U.rng.y);
  let d = U.K * a + U.Dbase.xyz;
  let lo = vec3<f32>(U.rng.z); let hi = vec3<f32>(U.rng.w);
  var x = clamp(a, lo, hi);                       // the analytical start K⁻¹(d − D_base) is the key itself
  var ev = evalF(x, d, true);
  var F = ev.F;
  var mu: f32 = 1e-3;
  for (var it = 0u; it < U.maxIt && F > U.tol; it++) {
    let R = mat3x3<f32>(ev.J0, ev.J1, ev.J2);     // columns are the rows of J: R = Jᵀ
    let A = R * transpose(R);                       // JᵀJ
    var g = R * ev.r;                               // Jᵀr
    // the active set: a dye at a bound whose gradient points out of the box is held there
    var held = vec3<bool>(false);
    if (U.activeSet == 1u) {
      held = ((x <= lo) & (g > vec3<f32>(0.0))) | ((x >= hi) & (g < vec3<f32>(0.0)));
      g = select(g, vec3<f32>(0.0), held);
      if (max(abs(g.x), max(abs(g.y), abs(g.z))) < U.gtol) { break; }
    }
    let m = select(vec3<f32>(1.0), vec3<f32>(0.0), held);   // 1 for a free dye, 0 for a held one
    var improved = false;
    for (var tries = 0; tries < 12; tries++) {
      var b = A + mat3x3<f32>(vec3<f32>(mu * (1.0 + A[0][0]), 0.0, 0.0), vec3<f32>(0.0, mu * (1.0 + A[1][1]), 0.0), vec3<f32>(0.0, 0.0, mu * (1.0 + A[2][2])));
      // held dyes: their rows and columns become the identity, so the step leaves them where they are
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
  let res = vec4<f32>(x, sqrt(F));
  outT[q] = res;
  textureStore(outTex, vec3<u32>(q % U.N, (q / U.N) % U.N, q / (U.N * U.N)), res);
}
