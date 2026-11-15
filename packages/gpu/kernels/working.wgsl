// The working encodings and the blend modes of the composite law (contract 1.1), shared by kernels/pointwise.wgsl
// (fused layers) and kernels/combine.wgsl (masked mixes). src/chain/working.ts prepends the matrices from core
// (composite/working.ts): WK_M1, WK_M1I (working RGB ↔ OkLab LMS, rows normalised) and OK_M2, OK_M2I (Ottosson's M2
// and its f64 inverse), so the numbers are core's. The formulas are core's composite/blend.ts, branch for branch.

fn wkCbrt(v: vec3<f32>) -> vec3<f32> { return sign(v) * pow(abs(v), vec3<f32>(1.0 / 3.0)); }
fn wkCbrt1(v: f32) -> f32 { return sign(v) * pow(abs(v), 1.0 / 3.0); }
fn wkRgbToOk(v: vec3<f32>) -> vec3<f32> { return OK_M2 * wkCbrt(WK_M1 * v); }
fn wkOkToRgb(v: vec3<f32>) -> vec3<f32> { let l = OK_M2I * v; return WK_M1I * (l * l * l); }

// core smoothstep: t = clamp((x − e0)/(e1 − e0), 0, 1), t²(3 − 2t) (WGSL's builtin leaves e0 ≥ e1 undefined)
fn wkSmooth(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// blend codes: the index in contract BLEND_MODES
const BL_NORMAL: u32 = 0u;
const BL_FIRST_NONSEP: u32 = 12u; // hue, saturation, colour, luminosity

fn wkBlendCh(mode: u32, bd: f32, sr: f32) -> f32 {
  switch (mode) {
    case 1u: { return bd * sr; }
    case 2u: { return bd + sr - bd * sr; }
    case 3u: { return select(1.0 - 2.0 * (1.0 - bd) * (1.0 - sr), 2.0 * bd * sr, bd <= 0.5); }
    case 4u: { return min(bd, sr); }
    case 5u: { return max(bd, sr); }
    case 6u: {
      if (bd <= 0.0) { return 0.0; }
      if (sr >= 1.0) { return 1.0; }
      return min(1.0, bd / (1.0 - sr));
    }
    case 7u: {
      if (bd >= 1.0) { return 1.0; }
      if (sr <= 0.0) { return 0.0; }
      return 1.0 - min(1.0, (1.0 - bd) / sr);
    }
    case 8u: { return select(1.0 - 2.0 * (1.0 - bd) * (1.0 - sr), 2.0 * bd * sr, sr <= 0.5); }
    case 9u: {
      if (sr <= 0.5) { return bd - (1.0 - 2.0 * sr) * bd * (1.0 - bd); }
      var d = sqrt(max(bd, 0.0));
      if (bd <= 0.25) { d = ((16.0 * bd - 12.0) * bd + 4.0) * bd; }
      return bd + (2.0 * sr - 1.0) * (d - bd);
    }
    case 10u: { return abs(bd - sr); }
    case 11u: { return bd + sr - 2.0 * bd * sr; }
    default: { return sr; }
  }
}

// hue, saturation, colour, luminosity of two OkLab colours (core blendOklab)
fn wkBlendOk(mode: u32, bd: vec3<f32>, sr: vec3<f32>) -> vec3<f32> {
  let Cb = length(bd.yz);
  let Cs = length(sr.yz);
  switch (mode) {
    case 12u: { if (Cs > 0.0) { return vec3<f32>(bd.x, Cb * sr.yz / Cs); } return bd; }
    case 13u: { if (Cb > 0.0) { return vec3<f32>(bd.x, Cs * bd.yz / Cb); } return bd; }
    case 14u: { return vec3<f32>(bd.x, sr.yz); }
    case 15u: { return vec3<f32>(sr.x, bd.yz); }
    default: { return sr; }
  }
}

// B(back, source) in the entry's encoding enc (1 linear RGB, 2 OkLab; core blendPixel)
fn wkBlend(mode: u32, bd: vec3<f32>, sr: vec3<f32>, enc: u32) -> vec3<f32> {
  if (mode == BL_NORMAL) { return sr; }
  if (mode >= BL_FIRST_NONSEP) {
    if (enc == 2u) { return wkBlendOk(mode, bd, sr); }
    return wkOkToRgb(wkBlendOk(mode, wkRgbToOk(bd), wkRgbToOk(sr)));
  }
  var bl = bd;
  var sl = sr;
  if (enc == 2u) { bl = wkOkToRgb(bd); sl = wkOkToRgb(sr); }
  let r = vec3<f32>(wkBlendCh(mode, bl.x, sl.x), wkBlendCh(mode, bl.y, sl.y), wkBlendCh(mode, bl.z, sl.z));
  if (enc == 2u) { return wkRgbToOk(r); }
  return r;
}

// the composite law per entry: back + k·(B(back, top) − back), exact at k = 0 (back) and k = 1 (B) (contract mixPixel)
fn wkMix(back: vec4<f32>, top: vec4<f32>, k: f32, mode: u32, enc: u32) -> vec4<f32> {
  if (k == 0.0) { return back; }
  var B = top;
  if (mode != BL_NORMAL) { B = vec4<f32>(wkBlend(mode, back.rgb, top.rgb, enc), top.a); }
  if (k == 1.0) { return B; }
  return back + k * (B - back);
}
