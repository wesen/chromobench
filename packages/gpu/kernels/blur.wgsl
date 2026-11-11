// Separable blur (guide §5.6): one kernel, two dispatches (dir = (1,0) then (0,1)); one weight per
// channel per tap from a uniform array (so four channels can carry four different Gaussians, which
// removes the Studio's xxyy halation-packing bug), looping only to the kernel's own radius, with
// clamp-to-edge reads in both tiled and one-pass renders.

struct Blur {
  dir: vec2<i32>,
  R: u32,
  pad: u32,
  w: array<vec4<f32>, 97>,   // w[i]: weight of taps ±i per channel; w[0] + 2 Σ w[i] = 1 per channel
};
@group(0) @binding(0) var<uniform> B: Blur;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba32float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let size = vec2<i32>(textureDimensions(src));
  let p = vec2<i32>(g.xy);
  if (any(p >= size)) { return; }   // no barrier in this kernel, so an early return is fine
  var acc = textureLoad(src, p, 0) * B.w[0];
  for (var i = 1u; i <= B.R; i++) {
    let d = B.dir * i32(i);
    let a = textureLoad(src, clamp(p + d, vec2<i32>(0), size - 1), 0);
    let b = textureLoad(src, clamp(p - d, vec2<i32>(0), size - 1), 0);
    acc += (a + b) * B.w[i];
  }
  textureStore(dst, p, acc);
}
