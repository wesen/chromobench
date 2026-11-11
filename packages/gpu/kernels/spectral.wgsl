// SPECTRAL: Σλ W_k 10^−(B + Σ c_j ε_j) at one table node per invocation; mode 0 returns −log₁₀ of it
// (printing density), mode 1 a 3 × 3 matrix times it (adapted XYZ). Ported from Chromogen Studio
// gpu.js SPECTRAL (05-inline.js 3493–3516); also writes a 3-D storage texture.

const WG: u32 = 64u;
const LOG2_10: f32 = 3.321928094887362;
const LOG10_2: f32 = 0.3010299956639812;
var<workgroup> sh: array<f32, 896>;

fn nodeAt(q: u32, N: u32, lo: f32, hi: f32) -> vec3<f32> {
  let st = (hi - lo) / f32(N - 1u);
  return vec3<f32>(f32(q % N), f32((q / N) % N), f32(q / (N * N))) * st + vec3<f32>(lo);
}

struct Params {
  M: mat3x3<f32>,
  rng: vec4<f32>,
  N: u32,
  n: u32,
  total: u32,
  mode: u32,
};
@group(0) @binding(0) var<uniform> U: Params;
@group(0) @binding(1) var<storage, read> spec: array<f32>;             // E0 E1 E2 B W0 W1 W2
@group(0) @binding(2) var<storage, read_write> outT: array<vec4<f32>>;
@group(0) @binding(3) var outTex: texture_storage_3d<rgba32float, write>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  for (var i = li; i < 7u * U.n; i += WG) { sh[i] = spec[i]; }
  workgroupBarrier();
  let q = gid.x;
  if (q >= U.total) { return; }
  let c = nodeAt(q, U.N, U.rng.x, U.rng.y);
  let n = U.n;
  var s = vec3<f32>(0.0);
  for (var i = 0u; i < n; i++) {
    let t = exp2(-LOG2_10 * (sh[3u * n + i] + c.x * sh[i] + c.y * sh[n + i] + c.z * sh[2u * n + i]));
    s += vec3<f32>(sh[4u * n + i], sh[5u * n + i], sh[6u * n + i]) * t;
  }
  var res: vec4<f32>;
  if (U.mode == 0u) { res = vec4<f32>(-log2(s) * LOG10_2, 1.0); } else { res = vec4<f32>(U.M * s, 1.0); }
  outT[q] = res;
  textureStore(outTex, vec3<u32>(q % U.N, (q / U.N) % U.N, q / (U.N * U.N)), res);
}
