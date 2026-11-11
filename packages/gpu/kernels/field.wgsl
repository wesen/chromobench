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
