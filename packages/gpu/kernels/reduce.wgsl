// GPU reductions for measure() (guide §5.5 "Reductions"): per-workgroup partial sums, minima and
// maxima over a box (optionally a circular aperture), and a workgroup-atomic histogram. The host sums
// the partials pairwise in f64, so the f32 error stays near log2(n) roundings.

struct R {
  box: vec4<i32>,      // x, y, w, h in the texture
  circle: vec4<f32>,   // cx, cy, r² (r² < 0: no aperture), channel for the histogram (3 = L)
  range: vec4<f32>,    // histogram lo, hi, bins, unused
};
@group(0) @binding(0) var<uniform> U: R;
@group(0) @binding(1) var img: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> partial: array<vec4<f32>>;   // per workgroup: sum, min, max, (count, 0, 0, 0)
@group(0) @binding(3) var<storage, read_write> bins: array<atomic<u32>>;

var<workgroup> sSum: array<vec4<f32>, 256>;
var<workgroup> sMin: array<vec4<f32>, 256>;
var<workgroup> sMax: array<vec4<f32>, 256>;
var<workgroup> sCnt: array<f32, 256>;
var<workgroup> hist: array<atomic<u32>, 4096>;

fn inside(p: vec2<i32>) -> bool {
  if (p.x >= U.box.z || p.y >= U.box.w) { return false; }
  if (U.circle.z >= 0.0) {
    let d = vec2<f32>(p + U.box.xy) - U.circle.xy;
    return dot(d, d) <= U.circle.z + 1e-6;
  }
  return true;
}

@compute @workgroup_size(16, 16)
fn moments(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let p = vec2<i32>(gid.xy);
  var s = vec4<f32>(0.0); var mn = vec4<f32>(3.0e38); var mx = vec4<f32>(-3.0e38); var c = 0.0;
  if (inside(p)) {
    let v = textureLoad(img, p + U.box.xy, 0);
    s = v; mn = v; mx = v; c = 1.0;
  }
  sSum[li] = s; sMin[li] = mn; sMax[li] = mx; sCnt[li] = c;
  workgroupBarrier();
  for (var stride = 128u; stride > 0u; stride = stride >> 1u) {
    if (li < stride) {
      sSum[li] += sSum[li + stride];
      sMin[li] = min(sMin[li], sMin[li + stride]);
      sMax[li] = max(sMax[li], sMax[li + stride]);
      sCnt[li] += sCnt[li + stride];
    }
    workgroupBarrier();
  }
  if (li == 0u) {
    let g = 4u * (wid.y * nw.x + wid.x);
    partial[g] = sSum[0]; partial[g + 1u] = sMin[0]; partial[g + 2u] = sMax[0]; partial[g + 3u] = vec4<f32>(sCnt[0], 0.0, 0.0, 0.0);
  }
}

@compute @workgroup_size(16, 16)
fn histogram(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let nb = u32(U.range.z);
  for (var i = li; i < nb; i += 256u) { atomicStore(&hist[i], 0u); }
  workgroupBarrier();
  let p = vec2<i32>(gid.xy);
  if (inside(p)) {
    let v = textureLoad(img, p + U.box.xy, 0);
    let ch = u32(U.circle.w);
    var x = 0.0;
    if (ch == 3u) { x = (v.x + v.y + v.z) / 3.0; } else { x = v[ch]; }
    let b = u32(clamp(floor((x - U.range.x) / (U.range.y - U.range.x) * f32(nb)), 0.0, f32(nb - 1u)));
    atomicAdd(&hist[b], 1u);
  }
  workgroupBarrier();
  for (var i = li; i < nb; i += 256u) {
    let h = atomicLoad(&hist[i]);
    if (h > 0u) { atomicAdd(&bins[i], h); }
  }
}
