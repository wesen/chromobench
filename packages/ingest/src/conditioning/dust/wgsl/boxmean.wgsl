// Box mean over a (2r+1)² window clipped to the plane, as two 1-D clipped means (the clipped count
// factorises, so this equals the JS reference boxMean from an integral image).
struct P { w: u32, h: u32, r: u32, pad: u32 };
@group(0) @binding(0) var<storage, read> src: array<f32>;
@group(0) @binding(1) var<storage, read_write> dst: array<f32>;
@group(0) @binding(2) var<uniform> p: P;

@compute @workgroup_size(64, 4)
fn meanH(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= p.w || id.y >= p.h) { return; }
  let lo = select(0u, id.x - p.r, id.x >= p.r);
  let hi = min(p.w - 1u, id.x + p.r);
  var s = 0.0;
  for (var x = lo; x <= hi; x++) { s += src[id.y * p.w + x]; }
  dst[id.y * p.w + id.x] = s / f32(hi - lo + 1u);
}

@compute @workgroup_size(64, 4)
fn meanV(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= p.w || id.y >= p.h) { return; }
  let lo = select(0u, id.y - p.r, id.y >= p.r);
  let hi = min(p.h - 1u, id.y + p.r);
  var s = 0.0;
  for (var y = lo; y <= hi; y++) { s += src[y * p.w + id.x]; }
  dst[id.y * p.w + id.x] = s / f32(hi - lo + 1u);
}
