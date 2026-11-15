// Global fields (guide §5.3, decision D4): area-average down to a field computed once per frame, and
// read it back from any tile through *frame* coordinates (the WGSL form of the Studio's G()).
// Also the halation combine in spektrafilm's form with the 1 + a normalisation (guide §5.6).

struct F {
  tileOrigin: vec2<i32>,    // full-res frame position of dst texel (0,0)
  frameSize: vec2<f32>,
  s: u32,                    // downsample factor (down)
  mode: u32,                 // combine: 0 halation (E + a Σ w_k h_k)/(1 + a); 1 BROKEN: no normalisation
  pad: vec2<u32>,
  wts: vec4<f32>,            // halation bounce weights (w1, w2, w3, a)
};
@group(0) @binding(0) var<uniform> U: F;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba32float, write>;
@group(0) @binding(3) var field: texture_2d<f32>;
@group(0) @binding(4) var samp: sampler;

// s × s area average (edge blocks average what exists)
@compute @workgroup_size(8, 8)
fn down(@builtin(global_invocation_id) g: vec3<u32>) {
  let od = textureDimensions(dst);
  if (g.x >= od.x || g.y >= od.y) { return; }
  let sd = vec2<i32>(textureDimensions(src));
  var acc = vec4<f32>(0.0);
  var n = 0.0;
  for (var j = 0u; j < U.s; j++) {
    for (var i = 0u; i < U.s; i++) {
      let q = vec2<i32>(g.xy * U.s + vec2<u32>(i, j));
      if (q.x < sd.x && q.y < sd.y) { acc += textureLoad(src, q, 0); n += 1.0; }
    }
  }
  textureStore(dst, vec2<i32>(g.xy), acc / n);
}

// dst = the field sampled bilinearly at the frame position of each tile pixel
@compute @workgroup_size(8, 8)
fn sampleField(@builtin(global_invocation_id) g: vec3<u32>) {
  let od = textureDimensions(dst);
  if (g.x >= od.x || g.y >= od.y) { return; }
  let uv = (vec2<f32>(U.tileOrigin + vec2<i32>(g.xy)) + 0.5) / U.frameSize;
  textureStore(dst, vec2<i32>(g.xy), textureSampleLevel(field, samp, uv, 0.0));
}

// s × s area average of the image extended by clamping (every block counts s² pixels), on a field padded by
// tileOrigin.x cells on every side: field cell c covers pixels [(c − pad)s, (c − pad + 1)s). Blurring that field is
// blurring the clamp-extended image, so a Gaussian on it has core's clamp-to-edge rule (gaussianBlur1) at the frame's
// edge, not the field's (engine/textures.ts gaussianBlur).
@compute @workgroup_size(8, 8)
fn downPad(@builtin(global_invocation_id) g: vec3<u32>) {
  let od = textureDimensions(dst);
  if (g.x >= od.x || g.y >= od.y) { return; }
  let sd = vec2<i32>(textureDimensions(src));
  let s = i32(U.s);
  let o = (vec2<i32>(g.xy) - vec2<i32>(U.tileOrigin.x)) * s;
  var acc = vec4<f32>(0.0);
  for (var j = 0; j < s; j++) {
    for (var i = 0; i < s; i++) { acc += textureLoad(src, clamp(o + vec2<i32>(i, j), vec2<i32>(0), sd - 1), 0); }
  }
  textureStore(dst, vec2<i32>(g.xy), acc / f32(s * s));
}

// dst = the (padded) field read back bilinearly at every full-resolution pixel centre, with textureLoad (f32 weights:
// no float32-filterable feature needed, no 8-bit filter weights on real GPUs). Field cell c covers pixels
// [(c − pad)s, (c − pad + 1)s), so pixel p's centre is at field coordinate (p + ½)/s − ½ + pad.
@compute @workgroup_size(8, 8)
fn upsample(@builtin(global_invocation_id) g: vec3<u32>) {
  let od = textureDimensions(dst);
  if (g.x >= od.x || g.y >= od.y) { return; }
  let fd = vec2<i32>(textureDimensions(field));
  let u = (vec2<f32>(g.xy) + 0.5) / f32(U.s) - 0.5 + f32(U.tileOrigin.x);
  let f0 = floor(u);
  let t = u - f0;
  let i0 = clamp(vec2<i32>(f0), vec2<i32>(0), fd - 1);
  let i1 = clamp(vec2<i32>(f0) + 1, vec2<i32>(0), fd - 1);
  let a = textureLoad(field, vec2<i32>(i0.x, i0.y), 0);
  let b = textureLoad(field, vec2<i32>(i1.x, i0.y), 0);
  let c = textureLoad(field, vec2<i32>(i0.x, i1.y), 0);
  let d = textureLoad(field, vec2<i32>(i1.x, i1.y), 0);
  textureStore(dst, vec2<i32>(g.xy), mix(mix(a, b, t.x), mix(c, d, t.x), t.y));
}

// src: E in channel 0 (any channel layout), field: the three bounce blurs in x, y, z
@compute @workgroup_size(8, 8)
fn combine(@builtin(global_invocation_id) g: vec3<u32>) {
  let od = textureDimensions(dst);
  if (g.x >= od.x || g.y >= od.y) { return; }
  let E = textureLoad(src, vec2<i32>(g.xy), 0);
  let h = textureLoad(field, vec2<i32>(g.xy), 0);
  let a = U.wts.w;
  let halo = U.wts.x * h.x + U.wts.y * h.y + U.wts.z * h.z;
  var o = E.x + a * halo;
  if (U.mode == 0u) { o = o / (1.0 + a); }
  textureStore(dst, vec2<i32>(g.xy), vec4<f32>(o, E.yzw));
}
