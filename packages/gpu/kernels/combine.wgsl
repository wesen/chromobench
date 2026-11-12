// Multi-input steps of the GPU engine (CHB-010 guide §6.5–6.6): print.combine's sum in linear H,
// mask.and / mask.or, and print.densityMask's transmittance and mask density. One pass per step on
// output-grid textures (a, b, m); the f64 reference is core's combinePixel / maskDensity.
//
// mode 0: H = 10^a                                   (the main exposure in linear H)
// mode 1: H = (flags & 1 ? max(a, 0) : a) + w.x · m · 10^b   (one extra exposure; w.x = ±seconds ratio)
// mode 2: x = log10(max(flags & 1 ? max(a, 0) : a, 1e-8))   (back to paper log H, H_FLOOR)
// mode 3: min(a, b) (mask.and)      mode 4: max(a, b) (mask.or)
// mode 5: T = mean_k 10^(−a_k)       (the mask film's exposure before the blur)
// mode 6: d = w.x · (log10 b − w.y)   (density mask d_m, contract 0.3: w.x = ±strength, w.y = log10 of the
//                                       smallest (positive) or largest (same) blurred T; w.x = 0 gives 0)
// mode 7: copy a
// mode 8: H = (flags & 1 ? max(a, 0) : a) + m · w.xyz  (a uniform flash, w.xyz = ratio · 10^x_flash; contract 0.3)
// mode 9: H = (flags & 1 ? max(a, 0) : a) · 10^(−b.r)  (a density mask holds back the exposures through the negative)
// mode 10: T = mean_k 10^(a_k − w_k)  (the mask film's exposure from paper log H: PD = w − x, w = x_clear)

const LOG2_10: f32 = 3.321928094887362;
const LOG10_2: f32 = 0.3010299956639812;

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
  var out = va;
  switch (U.mode) {
    case 0u: { out = vec4<f32>(p10(va.rgb), 0.0); }
    case 1u: {
      var base = va.rgb;
      if ((U.flags & 1u) != 0u) { base = max(base, vec3<f32>(0.0)); }
      out = vec4<f32>(base + U.w.x * textureLoad(m, p, 0).r * p10(textureLoad(b, p, 0).rgb), 0.0);
    }
    case 2u: {
      var base = va.rgb;
      if ((U.flags & 1u) != 0u) { base = max(base, vec3<f32>(0.0)); }
      out = vec4<f32>(lg10(max(base, vec3<f32>(1e-8))), 0.0);
    }
    case 3u: { let v = min(va.r, textureLoad(b, p, 0).r); out = vec4<f32>(v, v, v, 1.0); }
    case 4u: { let v = max(va.r, textureLoad(b, p, 0).r); out = vec4<f32>(v, v, v, 1.0); }
    case 5u: { let t = dot(p10(-va.rgb), vec3<f32>(1.0 / 3.0)); out = vec4<f32>(t, t, t, 1.0); }
    case 6u: {
      var d = 0.0;
      if (U.w.x != 0.0) { d = U.w.x * (log2(textureLoad(b, p, 0).r) * LOG10_2 - U.w.y); }
      out = vec4<f32>(d, d, d, 1.0);
    }
    case 8u: {
      var base = va.rgb;
      if ((U.flags & 1u) != 0u) { base = max(base, vec3<f32>(0.0)); }
      out = vec4<f32>(base + textureLoad(m, p, 0).r * U.w.xyz, 0.0);
    }
    case 9u: {
      var base = va.rgb;
      if ((U.flags & 1u) != 0u) { base = max(base, vec3<f32>(0.0)); }
      out = vec4<f32>(base * exp2(-LOG2_10 * textureLoad(b, p, 0).r), 0.0);
    }
    case 10u: { let t = dot(p10(va.rgb - U.w.xyz), vec3<f32>(1.0 / 3.0)); out = vec4<f32>(t, t, t, 1.0); }
    default: {}
  }
  textureStore(dst, p, out);
}
