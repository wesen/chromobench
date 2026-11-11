// Square min/max filters for the speck background (guide §5.11, DR-10): one 1-D pass per dispatch,
// horizontal or vertical, window [i − r, i + r] clipped to the plane, exactly as the JS reference
// squareMinMax (packages/ingest/src/conditioning/dust/kernels.ts). The plane is already padded by odd
// reflection on the JS side (or by CHB-005's runtime), so clipping only touches padding.
struct P { w: u32, h: u32, r: u32, isMax: u32 };
@group(0) @binding(0) var<storage, read> src: array<f32>;
@group(0) @binding(1) var<storage, read_write> dst: array<f32>;
@group(0) @binding(2) var<uniform> p: P;

fn pick(a: f32, b: f32) -> f32 {
  if (p.isMax == 1u) { return max(a, b); }
  return min(a, b);
}

@compute @workgroup_size(64, 4)
fn passH(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= p.w || id.y >= p.h) { return; }
  let lo = select(0u, id.x - p.r, id.x >= p.r);
  let hi = min(p.w - 1u, id.x + p.r);
  var m = src[id.y * p.w + id.x];
  for (var x = lo; x <= hi; x++) { m = pick(m, src[id.y * p.w + x]); }
  dst[id.y * p.w + id.x] = m;
}

@compute @workgroup_size(64, 4)
fn passV(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= p.w || id.y >= p.h) { return; }
  let lo = select(0u, id.y - p.r, id.y >= p.r);
  let hi = min(p.h - 1u, id.y + p.r);
  var m = src[id.y * p.w + id.x];
  for (var y = lo; y <= hi; y++) { m = pick(m, src[y * p.w + id.x]); }
  dst[id.y * p.w + id.x] = m;
}
