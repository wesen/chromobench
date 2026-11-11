// 16-bit export precision path (CHB-011, moved from CHB-005 6bzj):
// `unpack` turns a 16-bit source tile uploaded as rgba16uint into the rgba32float texture the chain
// reads, code/max through a table `lut` (the correctly rounded f32 quotient, as the CPU f32 path):
// no f32 copy of the scan on the CPU, half the upload of rgba32float.
// `pack` turns the chain's rgba32float output into 16-bit codes with pack2x16unorm
// (floor(0.5 + 65535·clamp(v, 0, 1))): two u32 per pixel, half the read-back of rgba32float.

struct P { size: vec4<u32>, unused: vec4<f32> };  // size = (w, h, 0, 0)

@group(0) @binding(0) var<uniform> U: P;
@group(0) @binding(1) var srcU: texture_2d<u32>;
@group(0) @binding(2) var dstF: texture_storage_2d<rgba32float, write>;
@group(0) @binding(6) var<storage, read> lut: array<f32>;

@compute @workgroup_size(8, 8)
fn unpack(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= U.size.x || gid.y >= U.size.y) { return; }
  let v = textureLoad(srcU, vec2<i32>(gid.xy), 0);
  textureStore(dstF, vec2<i32>(gid.xy), vec4<f32>(lut[v.r], lut[v.g], lut[v.b], 1.0));
}

@group(0) @binding(3) var<uniform> V: P;
@group(0) @binding(4) var srcF: texture_2d<f32>;
@group(0) @binding(5) var<storage, read_write> dstU: array<u32>;

@compute @workgroup_size(8, 8)
fn pack(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= V.size.x || gid.y >= V.size.y) { return; }
  let v = textureLoad(srcF, vec2<i32>(gid.xy), 0);
  let i = 2u * (gid.y * V.size.x + gid.x);
  dstU[i] = pack2x16unorm(v.rg);
  dstU[i + 1u] = pack2x16unorm(vec2<f32>(v.b, 1.0));
}
