//! include grid.wgsl
// heal and clone on the GPU (contract 1.0; CHB-022's per-pixel formula): spots composited in order on a grid.
// Each grid pixel is computed at the full-resolution pixel centre it samples (the grid rule, grid.wgsl), so a
// draft, a screen render and every tile of an export see the same spot. Sources are read from an atlas of
// full-resolution windows, one per spot, each the image as the spots before it left it (src/retouch.ts); the seam
// correction's Fourier coefficients come from core's healCoefficients() on the CPU (f64), so only the per-pixel
// sum runs here. The seam correction is a gain in a linear domain and an additive offset in a log (density) one.
//
// Spot record (22 × vec4, see src/retouch.ts):
//   v0  target x, y, r, inner = r(1 − feather)      v1  source x, y, opacity, heal (1) / clone (0)
//   v2  window x, y, w, h (frame px)                v3  atlas x, y, R = r + 1.5, additive seam (1: density)
//   v4 + 2n, v5 + 2n: a_n, b_n (xyz), n = 0 … 8

const M: u32 = 8u;
const STRIDE: u32 = 22u;

// outMap: the grid's region (x, y, w, h) of the frame; frame: (frameW, frameH, spots, 0)
struct U_ { outMap: vec4<u32>, frame: vec4<f32> };
@group(0) @binding(0) var<uniform> U: U_;
@group(0) @binding(1) var base: texture_2d<f32>;
@group(0) @binding(2) var atlas: texture_2d<f32>;
@group(0) @binding(3) var<storage, read> S: array<vec4<f32>>;
@group(0) @binding(4) var dst: texture_storage_2d<rgba32float, write>;

/** One texel of a spot's window at frame pixel (x, y) (integer, inside the frame). */
fn texel(s: u32, x: f32, y: f32) -> vec4<f32> {
  let win = S[s * STRIDE + 2u];
  let at = S[s * STRIDE + 3u];
  let lx = clamp(x - win.x, 0.0, win.z - 1.0);
  let ly = clamp(y - win.y, 0.0, win.w - 1.0);
  return textureLoad(atlas, vec2<i32>(i32(at.x + lx), i32(at.y + ly)), 0);
}

/** Bilinear at a continuous frame position, pixel centres at i + ½, clamped to the frame (core bilinearAt). */
fn bilinear(s: u32, q: vec2<f32>) -> vec4<f32> {
  let W = U.frame.x;
  let H = U.frame.y;
  let fx = clamp(q.x, 0.5, W - 0.5) - 0.5;
  let fy = clamp(q.y, 0.5, H - 0.5) - 0.5;
  let x0 = floor(fx);
  let y0 = floor(fy);
  let tx = fx - x0;
  let ty = fy - y0;
  let x1 = min(W - 1.0, x0 + 1.0);
  let y1 = min(H - 1.0, y0 + 1.0);
  return (1.0 - ty) * ((1.0 - tx) * texel(s, x0, y0) + tx * texel(s, x1, y0)) + ty * ((1.0 - tx) * texel(s, x0, y1) + tx * texel(s, x1, y1));
}

/** The seam correction u(d) per channel (core healOffset: the same angle-addition recurrence). */
fn offset(s: u32, d: vec2<f32>, R: f32) -> vec3<f32> {
  let o = s * STRIDE + 4u;
  var u = S[o].xyz;
  let rho = length(d);
  if (rho <= 0.0) { return u; }
  let t = min(rho / R, 1.0);
  let c1 = d.x / rho;
  let s1 = d.y / rho;
  var cn = c1;
  var sn = s1;
  var tn = t;
  for (var n = 1u; n <= M; n++) {
    u += tn * (S[o + 2u * n].xyz * cn + S[o + 2u * n + 1u].xyz * sn);
    let cn1 = cn * c1 - sn * s1;
    sn = sn * c1 + cn * s1;
    cn = cn1;
    tn *= t;
  }
  return u;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let size = textureDimensions(base);
  if (g.x >= size.x || g.y >= size.y) { return; }
  let p = vec2<i32>(g.xy);
  var out = textureLoad(base, p, 0);
  // the full-resolution pixel this grid pixel samples (the grid rule), at its centre
  let fp = gridSample(g.xy, U.outMap, size);
  let pos = vec2<f32>(fp) + 0.5;
  let n = u32(U.frame.z);
  for (var s = 0u; s < n; s++) {
    let v0 = S[s * STRIDE];
    let v1 = S[s * STRIDE + 1u];
    let d = pos - v0.xy;
    let dist = length(d);
    if (dist >= v0.z) { continue; }
    var a = v1.z;
    if (dist > v0.w) { a = v1.z * (1.0 - smoothstep(v0.w, v0.z, dist)); }
    var pv = bilinear(s, v1.xy + d);
    if (v1.w > 0.5) {
      let v3 = S[s * STRIDE + 3u];
      let u = offset(s, d, v3.z);
      if (v3.w > 0.5) { pv = vec4<f32>(pv.xyz + u, pv.w); } else { pv = vec4<f32>(pv.xyz * exp(u), pv.w); }
    }
    out = vec4<f32>(mix(out.xyz, pv.xyz, a), out.w);
  }
  textureStore(dst, p, out);
}
