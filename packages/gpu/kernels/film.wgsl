// The forward film path on the GPU (CHB-012 guide §5.6 kernel table): camera matrix, film exposure
// through the 2-D film table (Mitchell–Netravali cubic, as core's lookupCubic), characteristic curves,
// DIR inhibitor, linear/log conversions, weighted sums, and Poisson sublayer grain with pcg4d draws
// bit-identical to core's film/rng.ts. All on output-grid rgba32float textures; the f64 oracle is
// @chromobench/core's film/ modules.

const LOG2_10: f32 = 3.321928094887362;
const LOG10_2: f32 = 0.3010299956639812;

struct P {
  m0: vec4<f32>, m1: vec4<f32>, m2: vec4<f32>,   // 3 × 3 matrix rows (xyz)
  s: vec4<f32>,                                   // matrix/expose: s.x scale (2^EV); curves: s.x x0, s.y 1/dx; mix: s.x amount
  g: vec4<f32>,                                   // curves: gamma per channel; axpy/mix: weights per channel
  d: vec4<f32>,                                   // inhibitor: d_max per channel (positives); grain: density_min
  u: vec4<u32>,                                   // u.x n (table nodes / curve samples), u.y flags, u.z seed
  o: vec4<i32>,                                   // grain: print-grid origin of pixel (0, 0)
};
@group(0) @binding(0) var<uniform> U: P;
@group(0) @binding(1) var a: texture_2d<f32>;
@group(0) @binding(2) var b: texture_2d<f32>;
@group(0) @binding(3) var dst: texture_storage_2d<rgba32float, write>;
@group(0) @binding(4) var<storage, read> tab: array<f32>;

fn mat(v: vec3<f32>) -> vec3<f32> { return vec3<f32>(dot(U.m0.xyz, v), dot(U.m1.xyz, v), dot(U.m2.xyz, v)); }
// every entry point uses U and a (through inside()), so the auto layouts all have bindings 0, 1 and 3
fn inside(g: vec3<u32>) -> bool { _ = U.u.w; let s = textureDimensions(a); return g.x < s.x && g.y < s.y; }

// ---- source.xyz: camera RGB → scene XYZ --------------------------------------------------------------
@compute @workgroup_size(8, 8)
fn camMatrix(@builtin(global_invocation_id) g: vec3<u32>) {
  if (!inside(g)) { return; }
  let p = vec2<i32>(g.xy);
  textureStore(dst, p, vec4<f32>(mat(textureLoad(a, p, 0).rgb), 1.0));
}

// ---- capture.expose: XYZ → (CAT16) → b, (u, v) → cubic film table → log10(raw · 2^EV + 1e-10) ----------
fn mitchell(t: f32) -> f32 {
  let x = abs(t);
  let B = 1.0 / 3.0;
  let C = 1.0 / 3.0;
  if (x < 1.0) { return ((12.0 - 9.0 * B - 6.0 * C) * x * x * x + (-18.0 + 12.0 * B + 6.0 * C) * x * x + (6.0 - 2.0 * B)) / 6.0; }
  if (x < 2.0) { return ((-B - 6.0 * C) * x * x * x + (6.0 * B + 30.0 * C) * x * x + (-12.0 * B - 48.0 * C) * x + (8.0 * B + 24.0 * C)) / 6.0; }
  return 0.0;
}
fn reflectIdx(i: i32, n: i32) -> i32 { if (i < 0) { return -i; } if (i >= n) { return 2 * (n - 1) - i; } return i; }
fn tabAt(i: i32, j: i32, n: i32) -> vec3<f32> { let o = (i * n + j) * 3; return vec3<f32>(tab[o], tab[o + 1], tab[o + 2]); }

fn cubic(u: f32, v: f32, n: i32) -> vec3<f32> {
  let L = f32(n - 1);
  var cx = clamp(u * L, 0.0, L);
  var cy = clamp(v * L, 0.0, L);
  var xb = i32(floor(cx)); var xf = cx - f32(xb);
  var yb = i32(floor(cy)); var yf = cy - f32(yb);
  if (cx >= L) { xb = n - 2; xf = 1.0; }
  if (cy >= L) { yb = n - 2; yf = 1.0; }
  let wx = vec4<f32>(mitchell(xf + 1.0), mitchell(xf), mitchell(xf - 1.0), mitchell(xf - 2.0));
  let wy = vec4<f32>(mitchell(yf + 1.0), mitchell(yf), mitchell(yf - 1.0), mitchell(yf - 2.0));
  var acc = vec3<f32>(0.0);
  var ws = 0.0;
  for (var i = 0; i < 4; i++) {
    let xi = reflectIdx(xb - 1 + i, n);
    for (var j = 0; j < 4; j++) {
      let yj = reflectIdx(yb - 1 + j, n);
      let w = wx[i] * wy[j];
      ws += w;
      acc += w * tabAt(xi, yj, n);
    }
  }
  return select(acc, acc / ws, ws != 0.0);
}

@compute @workgroup_size(8, 8)
fn expose(@builtin(global_invocation_id) g: vec3<u32>) {
  if (!inside(g)) { return; }
  let p = vec2<i32>(g.xy);
  let X = mat(textureLoad(a, p, 0).rgb);
  let bsum = X.x + X.y + X.z;
  var raw = vec3<f32>(0.0);
  if (bsum > 0.0) {
    let x = X.x / bsum;
    let y = X.y / bsum;
    let uq = clamp((1.0 - x) * (1.0 - x), 0.0, 1.0);
    let vq = clamp(y / max(1.0 - x, 1e-10), 0.0, 1.0);
    raw = cubic(uq, vq, i32(U.u.x)) * bsum * U.s.x;
  }
  textureStore(dst, p, vec4<f32>(log2(max(raw, vec3<f32>(0.0)) + 1e-10) * LOG10_2, 1.0));
}

// ---- curves: d = f(g · (u − a)), three rows of n samples on x0 + i·dx, clamped ----------------------------
fn curveAt(k: u32, x: f32) -> f32 {
  let n = U.u.x;
  let t = (x - U.s.x) * U.s.y;
  if (t <= 0.0) { return tab[k * n]; }
  if (t >= f32(n - 1u)) { return tab[k * n + n - 1u]; }
  let i = u32(floor(t));
  let f = t - f32(i);
  return mix(tab[k * n + i], tab[k * n + i + 1u], f);
}
fn develop3(u: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(curveAt(0u, u.x * U.g.x), curveAt(1u, u.y * U.g.y), curveAt(2u, u.z * U.g.z));
}

/** film.develop; flags & 1: subtract b (the blurred inhibitor) first. */
@compute @workgroup_size(8, 8)
fn curves(@builtin(global_invocation_id) g: vec3<u32>) {
  if (!inside(g)) { return; }
  let p = vec2<i32>(g.xy);
  var u = textureLoad(a, p, 0).rgb;
  if ((U.u.y & 1u) != 0u) { u -= textureLoad(b, p, 0).rgb; }
  textureStore(dst, p, vec4<f32>(develop3(u), 1.0));
}

/** film.couple's inhibitor a_j = Σ_k M_kj silver_k(f(u)); m rows hold Mᵀ; flags & 2: positive (d_max − d). */
@compute @workgroup_size(8, 8)
fn inhibit(@builtin(global_invocation_id) g: vec3<u32>) {
  if (!inside(g)) { return; }
  let p = vec2<i32>(g.xy);
  var s = develop3(textureLoad(a, p, 0).rgb);
  if ((U.u.y & 2u) != 0u) { s = U.d.xyz - s; }
  textureStore(dst, p, vec4<f32>(mat(s), 1.0));
}

// ---- elementwise -------------------------------------------------------------------------------------------
/** E = 10^u − 1e-10 (film.halation's linear exposure). */
@compute @workgroup_size(8, 8)
fn exp10(@builtin(global_invocation_id) g: vec3<u32>) {
  if (!inside(g)) { return; }
  let p = vec2<i32>(g.xy);
  textureStore(dst, p, vec4<f32>(exp2(LOG2_10 * textureLoad(a, p, 0).rgb) - 1e-10, 1.0));
}
/** u = log10(max(E, 0) + 1e-10). */
@compute @workgroup_size(8, 8)
fn log10e(@builtin(global_invocation_id) g: vec3<u32>) {
  if (!inside(g)) { return; }
  let p = vec2<i32>(g.xy);
  textureStore(dst, p, vec4<f32>(log2(max(textureLoad(a, p, 0).rgb, vec3<f32>(0.0)) + 1e-10) * LOG10_2, 1.0));
}
/** out = s.x-scaled a + g ⊙ b: s.x multiplies a (per channel through m0.xyz when flags & 4), g weights b. */
@compute @workgroup_size(8, 8)
fn axpy(@builtin(global_invocation_id) g: vec3<u32>) {
  if (!inside(g)) { return; }
  let p = vec2<i32>(g.xy);
  var x = textureLoad(a, p, 0).rgb;
  if ((U.u.y & 4u) != 0u) { x *= U.m0.xyz; }
  textureStore(dst, p, vec4<f32>(x + U.g.xyz * textureLoad(b, p, 0).rgb, 1.0));
}

// ---- grain ---------------------------------------------------------------------------------------------------
fn pcg4d(v0: vec4<u32>) -> vec4<u32> {
  var v = v0 * 1664525u + 1013904223u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  v ^= v >> vec4<u32>(16u);
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  return v;
}
struct Stream { key: vec4<u32>, block: u32, j: u32, v: vec4<u32> };
fn nextU(st: ptr<function, Stream>) -> f32 {
  let b = (*st).j >> 2u;
  if (b != (*st).block) {
    (*st).v = pcg4d(vec4<u32>((*st).key.xyz, (*st).key.w + b * 0x9e3779b9u));
    (*st).block = b;
  }
  let w = (*st).v[(*st).j & 3u];
  (*st).j += 1u;
  return f32(w >> 8u) * 5.9604644775390625e-8;
}
fn logFact(k: f32) -> f32 {
  if (k < 10.0) {
    var s = 0.0;
    for (var i = 2.0; i <= k; i += 1.0) { s += log(i); }
    return s;
  }
  let x = k + 1.0;
  return (x - 0.5) * log(x) - x + 0.9189385332046727 + 1.0 / (12.0 * x) - 1.0 / (360.0 * x * x * x);
}
fn poisson(lam: f32, st: ptr<function, Stream>) -> f32 {
  if (!(lam > 0.0)) { return 0.0; }
  if (lam < 30.0) {
    let u = nextU(st);
    var p = exp(-lam);
    var F = p;
    var k = 0.0;
    let kmax = ceil(4.0 * lam + 40.0);
    loop {
      if (!(u >= F) || k >= kmax) { break; }
      k += 1.0;
      p *= lam / k;
      F += p;
    }
    return k;
  }
  let slam = sqrt(lam);
  let loglam = log(lam);
  let bb = 0.931 + 2.53 * slam;
  let aa = -0.059 + 0.02483 * bb;
  let invalpha = 1.1239 + 1.1328 / (bb - 3.4);
  let vr = 0.9277 - 3.6224 / (bb - 2.0);
  for (var it = 0; it < 1000; it++) {
    let u = nextU(st) - 0.5;
    let v = nextU(st);
    let us = 0.5 - abs(u);
    let k = floor((2.0 * aa / us + bb) * u + lam + 0.43);
    if (us >= 0.07 && v <= vr) { return k; }
    if (k < 0.0 || (us < 0.013 && v > us)) { continue; }
    if (log(v) + log(invalpha) - log(aa / (us * us) + bb) <= -lam + k * loglam - logFact(k)) { return k; }
  }
  return round(lam);
}

// tab layout for grain: [ch][sl][n] sublayer amount vs d on 0 … dmaxCh (uniform), then per (sl, ch):
// dmax, N, dminShare at offset 9n + (sl·3 + ch)·3; d axis span per channel in m0.xyz, uniformity in m1.xyz
@group(0) @binding(5) var dst1: texture_storage_2d<rgba32float, write>;
@group(0) @binding(6) var dst2: texture_storage_2d<rgba32float, write>;

fn subAt(ch: u32, sl: u32, d: f32) -> f32 {
  let n = U.u.x;
  let span = U.m0[ch];
  let t = clamp(d / span, 0.0, 1.0) * f32(n - 1u);
  let i = min(u32(floor(t)), n - 2u);
  let f = t - f32(i);
  let o = (ch * 3u + sl) * n;
  return mix(tab[o + i], tab[o + i + 1u], f);
}

@compute @workgroup_size(8, 8)
fn grainDraw(@builtin(global_invocation_id) g: vec3<u32>) {
  if (!inside(g)) { return; }
  let p = vec2<i32>(g.xy);
  let dye = textureLoad(a, p, 0).rgb;
  let n = U.u.x;
  var out: array<vec3<f32>, 3>;
  for (var ch = 0u; ch < 3u; ch++) {
    for (var sl = 0u; sl < 3u; sl++) {
      let q = 9u * n + (sl * 3u + ch) * 3u;
      let dmax = tab[q];
      let N = tab[q + 1u];
      let D = subAt(ch, sl, dye[ch]) + tab[q + 2u];
      var val = D;
      if (N > 0.0 && dmax > 0.0) {
        var st: Stream;
        st.key = vec4<u32>(u32(U.o.x + p.x), u32(U.o.y + p.y), ch * 4u + sl, U.u.z);
        st.block = 0xffffffffu;
        st.j = 0u;
        let pr = clamp(D / dmax, 1e-6, 1.0 - 1e-6);
        let sat = 1.0 - pr * U.m1[ch] * (1.0 - 1e-6);
        let k = poisson(pr * N / sat, &st);
        val = k * dmax * sat / N;
      }
      out[sl][ch] = val;
    }
  }
  textureStore(dst, p, vec4<f32>(out[0], 1.0));
  textureStore(dst1, p, vec4<f32>(out[1], 1.0));
  textureStore(dst2, p, vec4<f32>(out[2], 1.0));
}

/** rngProbe: the first uniform of key (x, y, 5, seed) per pixel, for the bit-identity test. */
@compute @workgroup_size(8, 8)
fn rngProbe(@builtin(global_invocation_id) g: vec3<u32>) {
  if (!inside(g)) { return; }
  let p = vec2<i32>(g.xy);
  var st: Stream;
  st.key = vec4<u32>(u32(p.x), u32(p.y), 5u, U.u.z);
  st.block = 0xffffffffu;
  st.j = 0u;
  let u0 = nextU(&st);
  let u1 = nextU(&st);
  let u2 = nextU(&st);
  let u3 = nextU(&st);
  textureStore(dst, p, vec4<f32>(u0, u1, u2, u3));
}
