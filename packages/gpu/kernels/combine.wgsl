// Multi-input steps of the GPU engine (contract 1.0), one pass each on output-grid textures a, b and a mask m:
// the light law of print.combine as passes in linear H (src/engine/light.ts plans them; the formula is the
// contract's lightH), print.densityMask's transmittance and density, composite.mix (mixPixel), mask.combine
// (maskCombine) and clarity's gain. Every mode reads its own pixel only.
//
// flags: bit 0 (CLAMP) the running H is clamped at 0 before the step (after the dodges); bit 1 (MASK) the pass
// reads the coverage m.r, else m = 1. A = flags & CLAMP ? max(a, 0) : a.
//
// mode 0  MAIN:          H = w.x · m · 10^a                     (the main exposure, w.x = its amount)
// mode 1  TERM:          H = A + w.x · m · 10^b                 (a burn w.x = a·r; a dodge w.x = −a·r)
// mode 2  LOG:           x = log10 max(A, 1e-8)                 (H_FLOOR)
// mode 3  HOLD:          H = A · 10^(−w.x · m · b.r)            (a density mask d = b.r, w.x = its amount)
// mode 4  UNIFORM:       H = A + m · w.xyz                      (a flash w = a·r·10^x_flash; a preflash w = a·φ)
// mode 5  FILTER:        H = A · 10^(m · w.xyz)                 (w = a·logH)
// mode 6  TRANSMITTANCE: T = mean_k 10^(a_k − w_k)              (the mask film's exposure: PD = w − x, w = x_clear)
// mode 7  DENSITY:       d = w.x · (log10 b − w.y)              (w.x = ±γ, w.y = log10 of the smallest (positive) or
//                                                               largest (same) blurred T; w.x = 0 gives 0)
// mode 8  COPY:          a
// mode 9  MIX:           k = w.x · m; out = wkMix(a, b, k, blend w.y, encoding w.z) (kernels/working.wgsl): k = 0 → a,
//                        k = 1 → B(a, b), else a + k·(B − a); a the backdrop, b the top (contract mixPixel, core blendPixel)
// mode 10 MASK:          v = a.r, c = b.r; r = max(v, c) | v·(1 − c) | v·c for w.y = 0 | 1 | 2;
//                        w.x = 1 → r, else v + w.x·(r − v)       (add, subtract, intersect faded by the amount)
// mode 11 CLARITY:       a.rgb · (L′ / L)³, L = (Y / Y_w)^⅓, L̄ = (Y_b / Y_w)^⅓, L′ = max(0, L + w.x·w·(L − L̄)),
//                        w = max(0, 1 − (2L − 1)²) (clarity, w.z = 1) or 1 (sharpen, w.z = 0); Y = a.g, Y_b = b.g (the
//                        low-pass), Y_w = w.y; Y ≤ 0 unchanged (core print/clarity.ts)

const LOG2_10: f32 = 3.321928094887362;
const LOG10_2: f32 = 0.3010299956639812;
const CLAMP: u32 = 1u;
const MASK: u32 = 2u;

struct C { mode: u32, flags: u32, pad0: u32, pad1: u32, w: vec4<f32> };
@group(0) @binding(0) var<uniform> U: C;
@group(0) @binding(1) var a: texture_2d<f32>;
@group(0) @binding(2) var b: texture_2d<f32>;
@group(0) @binding(3) var m: texture_2d<f32>;
@group(0) @binding(4) var dst: texture_storage_2d<rgba32float, write>;

fn p10(x: vec3<f32>) -> vec3<f32> { return exp2(LOG2_10 * x); }
fn lg10(x: vec3<f32>) -> vec3<f32> { return log2(x) * LOG10_2; }

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let size = textureDimensions(a);
  let p = vec2<i32>(g.xy);
  if (g.x >= size.x || g.y >= size.y) { return; }
  let va = textureLoad(a, p, 0);
  var cov = 1.0;
  if ((U.flags & MASK) != 0u) { cov = textureLoad(m, p, 0).r; }
  var A = va.rgb;
  if ((U.flags & CLAMP) != 0u) { A = max(A, vec3<f32>(0.0)); }
  var out = va;
  switch (U.mode) {
    case 0u: { out = vec4<f32>(U.w.x * cov * p10(va.rgb), 0.0); }
    case 1u: { out = vec4<f32>(A + U.w.x * cov * p10(textureLoad(b, p, 0).rgb), 0.0); }
    case 2u: { out = vec4<f32>(lg10(max(A, vec3<f32>(1e-8))), 0.0); }
    case 3u: { out = vec4<f32>(A * exp2(-LOG2_10 * U.w.x * cov * textureLoad(b, p, 0).r), 0.0); }
    case 4u: { out = vec4<f32>(A + cov * U.w.xyz, 0.0); }
    case 5u: { out = vec4<f32>(A * p10(cov * U.w.xyz), 0.0); }
    case 6u: { let t = dot(p10(va.rgb - U.w.xyz), vec3<f32>(1.0 / 3.0)); out = vec4<f32>(t, t, t, 1.0); }
    case 7u: {
      var d = 0.0;
      if (U.w.x != 0.0) { d = U.w.x * (log2(textureLoad(b, p, 0).r) * LOG10_2 - U.w.y); }
      out = vec4<f32>(d, d, d, 1.0);
    }
    case 9u: {
      // exact at both ends (mixPixel): full coverage is B (the top itself for normal), none the backdrop itself
      out = wkMix(va, textureLoad(b, p, 0), U.w.x * cov, u32(U.w.y), u32(U.w.z));
    }
    case 10u: {
      let v = va.r;
      let c = textureLoad(b, p, 0).r;
      var r = max(v, c);
      if (U.w.y == 1.0) { r = v * (1.0 - c); } else if (U.w.y == 2.0) { r = v * c; }
      if (U.w.x != 1.0) { r = v + U.w.x * (r - v); }
      out = vec4<f32>(r, r, r, 1.0);
    }
    case 11u: {
      // core print/clarity.ts clarityGain: L = (Y / Y_w)^⅓, w = max(0, 1 − (2L − 1)²), L′ = max(0, L + s·w·(L − L̄))
      let Y = va.g;
      if (Y > 0.0) {
        let L = pow(Y / U.w.y, 1.0 / 3.0);
        let Lb = pow(max(textureLoad(b, p, 0).g, 1e-30) / U.w.y, 1.0 / 3.0);
        var w = 1.0;
        if (U.w.z > 0.5) { w = max(0.0, 1.0 - (2.0 * L - 1.0) * (2.0 * L - 1.0)); }
        let q = max(0.0, L + U.w.x * w * (L - Lb)) / L;
        out = vec4<f32>(va.rgb * (q * q * q), va.a);
      }
    }
    default: {}
  }
  textureStore(dst, p, out);
}
