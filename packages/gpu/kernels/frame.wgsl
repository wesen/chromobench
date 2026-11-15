// output.frame on the GPU (contract 1.0 document geometry; CHB-037 P3b): the orientation of a texture rendered on
// the receiver's grid, and the straightened crop (contract frame.ts straighten: bilinear at the rotated pixel centre,
// 0 outside the frame) sampled at the output grid's nearest full-resolution pixels, as core's output.frame.

struct FrameU {
  o: u32,          // orientation: 0 none, 1 flipH, 2 flipV, 3 rot180, 4 cw90, 5 ccw90, 6 transpose, 7 transverse
  outW: u32,
  outH: u32,
  pad: u32,
  reg: vec4<f32>,  // straighten: the output region in oriented-crop px (x, y, w, h)
  crop: vec4<f32>, // straighten: the crop box in frame px
  fp: vec4<f32>,   // straighten: the source texture's origin in frame px (x, y), the frame's size (w, h)
  rot: vec4<f32>,  // straighten: cos θ, sin θ
};
@group(0) @binding(0) var<uniform> U: FrameU;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba32float, write>;

// the un-oriented pixel (w × h: the un-oriented size) that oriented pixel (x2, y2) shows (core geometry.ts orientPixels)
fn unorient(o: u32, x2: i32, y2: i32, w: i32, h: i32) -> vec2<i32> {
  switch o {
    case 1u: { return vec2<i32>(w - 1 - x2, y2); }
    case 2u: { return vec2<i32>(x2, h - 1 - y2); }
    case 3u: { return vec2<i32>(w - 1 - x2, h - 1 - y2); }
    case 4u: { return vec2<i32>(y2, h - 1 - x2); }
    case 5u: { return vec2<i32>(w - 1 - y2, x2); }
    case 6u: { return vec2<i32>(y2, x2); }
    case 7u: { return vec2<i32>(w - 1 - y2, h - 1 - x2); }
    default: { return vec2<i32>(x2, y2); }
  }
}

@compute @workgroup_size(8, 8)
fn orient(@builtin(global_invocation_id) g: vec3<u32>) {
  let od = textureDimensions(dst);
  if (g.x >= od.x || g.y >= od.y) { return; }
  let sd = vec2<i32>(textureDimensions(src));
  textureStore(dst, vec2<i32>(g.xy), textureLoad(src, unorient(U.o, i32(g.x), i32(g.y), sd.x, sd.y), 0));
}

fn at(x: i32, y: i32) -> vec4<f32> {
  let sd = vec2<i32>(textureDimensions(src));
  return textureLoad(src, clamp(vec2<i32>(x, y) - vec2<i32>(U.fp.xy), vec2<i32>(0), sd - 1), 0);
}

@compute @workgroup_size(8, 8)
fn straighten(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= U.outW || g.y >= U.outH) { return; }
  // the nearest full-resolution pixel of the oriented crop (the engines' grid rule), then the un-oriented crop pixel
  let X2 = i32(U.reg.x) + min(i32(U.reg.z) - 1, i32(floor((f32(g.x) + 0.5) * U.reg.z / f32(U.outW))));
  let Y2 = i32(U.reg.y) + min(i32(U.reg.w) - 1, i32(floor((f32(g.y) + 0.5) * U.reg.w / f32(U.outH))));
  let cw = i32(U.crop.z);
  let ch = i32(U.crop.w);
  let ij = unorient(U.o, X2, Y2, cw, ch);
  let u = f32(ij.x) + 0.5 - U.crop.z / 2.0;
  let v = f32(ij.y) + 0.5 - U.crop.w / 2.0;
  let cx = U.crop.x + U.crop.z / 2.0;
  let cy = U.crop.y + U.crop.w / 2.0;
  let px = cx + u * U.rot.x - v * U.rot.y;
  let py = cy + u * U.rot.y + v * U.rot.x;
  var o = vec4<f32>(0.0);
  if (!(px < 0.0 || py < 0.0 || px > U.fp.z || py > U.fp.w)) {
    let fx = px - 0.5;
    let fy = py - 0.5;
    let x0 = i32(floor(fx));
    let y0 = i32(floor(fy));
    let tx = fx - f32(x0);
    let ty = fy - f32(y0);
    let W = i32(U.fp.z);
    let H = i32(U.fp.w);
    let xa = max(0, x0);
    let xb = min(W - 1, x0 + 1);
    let ya = max(0, y0);
    let yb = min(H - 1, y0 + 1);
    o = (1.0 - ty) * ((1.0 - tx) * at(xa, ya) + tx * at(xb, ya)) + ty * ((1.0 - tx) * at(xa, yb) + tx * at(xb, yb));
  }
  textureStore(dst, vec2<i32>(g.xy), o);
}
