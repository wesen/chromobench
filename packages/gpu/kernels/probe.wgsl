// Probe kernel (task wqul): does WGSL integer arithmetic on *runtime* values wrap, and how accurate
// are exp2/log2 on this adapter? Inputs come from a buffer so the compiler cannot constant-fold
// (constant expressions that overflow are compile errors; runtime ones are defined to wrap).

@group(0) @binding(0) var<storage, read> ints: array<u32>;      // [0xFFFFFFFF, 1, 0x7FFFFFFF, 0x10000, 3]
@group(0) @binding(1) var<storage, read> xs: array<f32>;        // sweep of arguments
@group(0) @binding(2) var<storage, read_write> outInt: array<u32>;
@group(0) @binding(3) var<storage, read_write> outF: array<vec4<f32>>;  // exp2(x), log2(x), 10^x via exp2, log10 via log2

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i == 0u) {
    outInt[0] = ints[0] + ints[1];                          // u32 add wraps → 0
    outInt[1] = bitcast<u32>(bitcast<i32>(ints[2]) + 1i);   // i32 add wraps → 0x80000000
    outInt[2] = ints[3] * ints[3];                          // u32 mul wraps → 0
    outInt[3] = ints[1] - ints[4];                          // u32 sub wraps → 0xFFFFFFFE
    outInt[4] = bitcast<u32>(-bitcast<i32>(ints[2] + ints[1])); // i32 negation of INT_MIN → INT_MIN
    outInt[5] = (ints[0] * 3u) + 7u;                         // 0xFFFFFFFD + 7 → 4
  }
  if (i < arrayLength(&xs)) {
    let x = xs[i];
    outF[i] = vec4<f32>(exp2(x), log2(abs(x) + 1e-30), exp2(3.321928094887362 * x), log2(abs(x) + 1e-30) * 0.3010299956639812);
  }
}
