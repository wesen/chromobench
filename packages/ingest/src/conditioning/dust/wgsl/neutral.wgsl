// Neutral plane and residual threshold for dust (guide §5.11):
//   neutral:   N = Σ_k D_k/σ_k² / Σ_k 1/σ_k²  (planar D: three planes of n samples)
//   threshold: res = L − bg − median; mask = res ≥ lo (1) else 0
struct P { n: u32, pad0: u32, pad1: u32, pad2: u32, w: vec4<f32> };   // w.xyz = 1/σ², w.w = Σ 1/σ²
@group(0) @binding(0) var<storage, read> D: array<f32>;
@group(0) @binding(1) var<storage, read_write> N: array<f32>;
@group(0) @binding(2) var<uniform> p: P;

@compute @workgroup_size(256)
fn neutral(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= p.n) { return; }
  N[i] = (p.w.x * D[i] + p.w.y * D[p.n + i] + p.w.z * D[2u * p.n + i]) / p.w.w;
}

struct T { n: u32, pad0: u32, pad1: u32, pad2: u32, med: f32, lo: f32, pad3: f32, pad4: f32 };
@group(0) @binding(0) var<storage, read> L: array<f32>;
@group(0) @binding(1) var<storage, read> BG: array<f32>;
@group(0) @binding(2) var<storage, read_write> mask: array<u32>;
@group(0) @binding(3) var<uniform> t: T;

@compute @workgroup_size(256)
fn threshold(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= t.n) { return; }
  mask[i] = select(0u, 1u, L[i] - BG[i] - t.med >= t.lo);
}
