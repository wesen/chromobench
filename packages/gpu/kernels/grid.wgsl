// The grid rule (contract gridSample, CHB-045; docs/patterns/gpu/03 "One grid rule"): output pixel p of an n-pixel grid
// over a region (x, w) of the full-resolution image reads image pixel x + ⌊(2p + 1)·w / 2n⌋, in u32, per axis. Exact at
// ties, as core's f64 and the mock compute it; an f32 ratio w/n (the rule before) picked the left pixel at some ties.
// The host refuses n·w ≥ 2³¹ (contract gridCheck), where (2p + 1)·w could wrap.

fn gridSample(p: vec2<u32>, region: vec4<u32>, n: vec2<u32>) -> vec2<u32> {
  return region.xy + ((2u * p + 1u) * region.zw) / (2u * n);
}
