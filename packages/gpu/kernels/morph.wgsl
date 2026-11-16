// mask.grow (contract 1.6, CHB-049; core print/masks.ts growMask): one one-dimensional pass of the octagon — the
// maximum (grow) or the minimum (contract) over the pixels p + i·dir, |i| ≤ L, that lie inside the image (pixels
// outside are left out, not clamped: a clamped diagonal tap would leave the line). Four dispatches make the octagon.

struct Morph {
  dir: vec2<i32>,
  L: u32,
  grow: u32,
};
@group(0) @binding(0) var<uniform> M: Morph;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba32float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let size = vec2<i32>(textureDimensions(src));
  let p = vec2<i32>(g.xy);
  if (any(p >= size)) { return; }
  var v = textureLoad(src, p, 0).r;
  for (var i = 1; i <= i32(M.L); i++) {
    for (var s = -1; s <= 1; s += 2) {
      let q = p + M.dir * (i * s);
      if (any(q < vec2<i32>(0)) || any(q >= size)) { continue; }
      let u = textureLoad(src, q, 0).r;
      if (M.grow == 1u) { v = max(v, u); } else { v = min(v, u); }
    }
  }
  textureStore(dst, p, vec4<f32>(v, v, v, 1.0));
}
