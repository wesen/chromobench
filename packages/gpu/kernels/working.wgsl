//! include working-constants
//! include blend-codes
// The working encodings and the blend modes of the composite law (contract 1.1), shared by kernels/pointwise.wgsl
// (fused layers) and kernels/combine.wgsl (masked mixes), which include it. The generated module working-constants holds the matrices from core
// (composite/working.ts): WK_M1, WK_M1I (working RGB ↔ OkLab LMS, rows normalised) and OK_M2, OK_M2I (Ottosson's M2
// and its f64 inverse), so the numbers are core's. The formulas are the contract's (pixel.ts blendChannel, blendSeparable,
// displayEncode) and core's composite/blend.ts, branch for branch; blend-codes (generated) names the modes by their
// index in the contract's BLEND_MODES.

fn wkCbrt(v: vec3<f32>) -> vec3<f32> { return sign(v) * pow(abs(v), vec3<f32>(1.0 / 3.0)); }
fn wkCbrt1(v: f32) -> f32 { return sign(v) * pow(abs(v), 1.0 / 3.0); }
fn wkRgbToOk(v: vec3<f32>) -> vec3<f32> { return OK_M2 * wkCbrt(WK_M1 * v); }
fn wkOkToRgb(v: vec3<f32>) -> vec3<f32> { let l = OK_M2I * v; return WK_M1I * (l * l * l); }

// core smoothstep: t = clamp((x − e0)/(e1 − e0), 0, 1), t²(3 − 2t) (WGSL's builtin leaves e0 ≥ e1 undefined)
fn wkSmooth(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn wkDodge(bd: f32, sr: f32) -> f32 {
  if (bd <= 0.0) { return 0.0; }
  if (sr >= 1.0) { return 1.0; }
  return min(1.0, bd / (1.0 - sr));
}
fn wkBurn(bd: f32, sr: f32) -> f32 {
  if (bd >= 1.0) { return 1.0; }
  if (sr <= 0.0) { return 0.0; }
  return 1.0 - min(1.0, (1.0 - bd) / sr);
}

// contract blendChannel: B(b, s) of one channel as written
fn wkBlendCh(mode: u32, bd: f32, sr: f32) -> f32 {
  switch (mode) {
    case BL_MULTIPLY: { return bd * sr; }
    case BL_SCREEN: { return bd + sr - bd * sr; }
    case BL_OVERLAY: { return select(1.0 - 2.0 * (1.0 - bd) * (1.0 - sr), 2.0 * bd * sr, bd <= 0.5); }
    case BL_DARKEN: { return min(bd, sr); }
    case BL_LIGHTEN: { return max(bd, sr); }
    case BL_COLOUR_DODGE: { return wkDodge(bd, sr); }
    case BL_COLOUR_BURN: { return wkBurn(bd, sr); }
    case BL_HARD_LIGHT: { return select(1.0 - 2.0 * (1.0 - bd) * (1.0 - sr), 2.0 * bd * sr, sr <= 0.5); }
    case BL_SOFT_LIGHT: {
      if (sr <= 0.5) { return bd - (1.0 - 2.0 * sr) * bd * (1.0 - bd); }
      var d = sqrt(max(bd, 0.0));
      if (bd <= 0.25) { d = ((16.0 * bd - 12.0) * bd + 4.0) * bd; }
      return bd + (2.0 * sr - 1.0) * (d - bd);
    }
    case BL_VIVID_LIGHT: { if (sr <= 0.5) { return wkBurn(bd, 2.0 * sr); } return wkDodge(bd, 2.0 * sr - 1.0); }
    case BL_LINEAR_LIGHT: { return clamp(bd + 2.0 * sr - 1.0, 0.0, 1.0); }
    case BL_PIN_LIGHT: { if (sr <= 0.5) { return min(bd, 2.0 * sr); } return max(bd, 2.0 * sr - 1.0); }
    case BL_HARD_MIX: { return select(0.0, 1.0, bd + sr >= 1.0); }
    case BL_DIFFERENCE: { return abs(bd - sr); }
    case BL_EXCLUSION: { return bd + sr - 2.0 * bd * sr; }
    default: { return sr; }
  }
}

// contract displayEncode / displayDecode: the sRGB curve, odd below 0 (the contrast modes' encoding, D7)
fn wkEnc(v: vec3<f32>) -> vec3<f32> {
  let a = abs(v);
  let e = select(1.055 * pow(a, vec3<f32>(1.0 / 2.4)) - 0.055, 12.92 * a, a <= vec3<f32>(0.0031308));
  return sign(v) * e;
}
fn wkDec(e: vec3<f32>) -> vec3<f32> {
  let a = abs(e);
  let v = select(pow((a + 0.055) / 1.055, vec3<f32>(2.4)), a / 12.92, a <= vec3<f32>(0.04045));
  return sign(e) * v;
}

// hue, saturation, colour, luminosity of two OkLab colours (core blendOklab)
fn wkBlendOk(mode: u32, bd: vec3<f32>, sr: vec3<f32>) -> vec3<f32> {
  let Cb = length(bd.yz);
  let Cs = length(sr.yz);
  switch (mode) {
    case BL_HUE: { if (Cs > 0.0) { return vec3<f32>(bd.x, Cb * sr.yz / Cs); } return bd; }
    case BL_SATURATION: { if (Cb > 0.0) { return vec3<f32>(bd.x, Cs * bd.yz / Cb); } return bd; }
    case BL_COLOUR: { return vec3<f32>(bd.x, sr.yz); }
    case BL_LUMINOSITY: { return vec3<f32>(sr.x, bd.yz); }
    default: { return sr; }
  }
}

// contract clipColour (LAY-2): W3C ClipColor in OkLCh. A result whose RGB leaves [0, top] keeps its L and hue and
// takes the chroma factor of the first exit from grey (CLIP_MARCH steps, then CLIP_STEPS halvings, the in-gamut end kept); in the
// gamut it is returned as it is; a grey outside the gamut is returned as the grey
fn wkInGamut(c: vec3<f32>, top: f32) -> bool { return all(c >= vec3<f32>(-CLIP_EPS * top)) && all(c <= vec3<f32>(top * (1.0 + CLIP_EPS))); }
fn wkClipColour(lab: vec3<f32>, top: f32) -> vec3<f32> {
  if (wkInGamut(wkOkToRgb(lab), top)) { return lab; }
  let g = lab.x * lab.x * lab.x;
  if (!(g >= 0.0 && g <= top)) { return vec3<f32>(lab.x, 0.0, 0.0); }
  var lo = 0.0;
  var hi = 1.0;
  // the first exit from grey (the gamut along the ray need not be one interval): march, then halve the step
  for (var k = 1; k <= CLIP_MARCH; k++) {
    let t = f32(k) / f32(CLIP_MARCH);
    if (!wkInGamut(wkOkToRgb(vec3<f32>(lab.x, t * lab.yz)), top)) { hi = t; break; }
    lo = t;
  }
  for (var i = 0; i < CLIP_STEPS; i++) {
    let m = 0.5 * (lo + hi);
    if (wkInGamut(wkOkToRgb(vec3<f32>(lab.x, m * lab.yz)), top)) { lo = m; } else { hi = m; }
  }
  return vec3<f32>(lab.x, lo * lab.yz);
}

// B(back, source) in the entry's encoding enc (1 linear RGB, 2 OkLab; core blendPixel)
fn wkBlend(mode: u32, bd: vec3<f32>, sr: vec3<f32>, enc: u32) -> vec3<f32> {
  if (mode == BL_NORMAL) { return sr; }
  if (mode >= BL_FIRST_NONSEP) {
    // OkLCh, kept in the gamut: the top is the brighter of white and the inputs' brightest channel (contract gamutTop)
    var lb = bd; var ls = sr; var rb = bd; var rs = sr;
    if (enc == 2u) { rb = wkOkToRgb(bd); rs = wkOkToRgb(sr); } else { lb = wkRgbToOk(bd); ls = wkRgbToOk(sr); }
    let top = max(1.0, max(max(max(rb.x, rb.y), rb.z), max(max(rs.x, rs.y), rs.z)));
    let r = wkClipColour(wkBlendOk(mode, lb, ls), top);
    if (enc == 2u) { return r; }
    return wkOkToRgb(r);
  }
  var bl = bd;
  var sl = sr;
  if (enc == 2u) { bl = wkOkToRgb(bd); sl = wkOkToRgb(sr); }
  // the contrast modes blend the display-encoded channels (contract blendSeparable, D7)
  let contrast = blContrast(mode);
  if (contrast) { bl = wkEnc(bl); sl = wkEnc(sl); }
  var r = vec3<f32>(wkBlendCh(mode, bl.x, sl.x), wkBlendCh(mode, bl.y, sl.y), wkBlendCh(mode, bl.z, sl.z));
  if (contrast) { r = wkDec(r); }
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
