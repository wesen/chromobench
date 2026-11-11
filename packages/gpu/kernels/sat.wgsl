// SAT probe (guide §5.6, textbook §4.3): summed-area tables of x and x² in f32 and in wrapping u32
// fixed point, and per-box variances from them. Used only by the parity harness: f32 SATs must stay
// out of production kernels. A box sum computed modulo 2³² is exact whenever the true box sum fits
// in 32 bits, however large the table's entries grow (the wqul probe checked that runtime u32 wraps).

struct S { w: u32, h: u32, box: u32, scale: f32 };
@group(0) @binding(0) var<uniform> U: S;
@group(0) @binding(1) var<storage, read> x: array<f32>;
@group(0) @binding(2) var<storage, read_write> satF: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> satU: array<vec2<u32>>;
@group(0) @binding(4) var<storage, read_write> varOut: array<vec2<f32>>;   // per box: (var from f32 SAT, var from u32 SAT)

// pass 1: running sums along each row (one invocation per row)
@compute @workgroup_size(64)
fn rows(@builtin(global_invocation_id) g: vec3<u32>) {
  let y = g.x;
  if (y >= U.h) { return; }
  var sf = vec2<f32>(0.0);
  var su = vec2<u32>(0u);
  for (var i = 0u; i < U.w; i++) {
    let v = x[y * U.w + i];
    sf += vec2<f32>(v, v * v);
    let q = u32(round(v * U.scale));
    su += vec2<u32>(q, u32(round(v * v * U.scale)));   // wraps mod 2^32
    satF[y * U.w + i] = sf;
    satU[y * U.w + i] = su;
  }
}

// pass 2: running sums down each column
@compute @workgroup_size(64)
fn cols(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = g.x;
  if (c >= U.w) { return; }
  var sf = vec2<f32>(0.0);
  var su = vec2<u32>(0u);
  for (var j = 0u; j < U.h; j++) {
    sf += satF[j * U.w + c];
    su += satU[j * U.w + c];
    satF[j * U.w + c] = sf;
    satU[j * U.w + c] = su;
  }
}

fn at(i: i32, j: i32) -> u32 { return u32(j) * U.w + u32(i); }

// pass 3: variance of each box × box tile (four reads per table)
@compute @workgroup_size(64)
fn boxVar(@builtin(global_invocation_id) g: vec3<u32>) {
  let bw = U.w / U.box;
  let bh = U.h / U.box;
  let b = g.x;
  if (b >= bw * bh) { return; }
  let x0 = i32((b % bw) * U.box) - 1;
  let y0 = i32((b / bw) * U.box) - 1;
  let x1 = x0 + i32(U.box);
  let y1 = y0 + i32(U.box);
  var F = satF[at(x1, y1)];
  var Q = satU[at(x1, y1)];
  if (x0 >= 0) { F -= satF[at(x0, y1)]; Q -= satU[at(x0, y1)]; }
  if (y0 >= 0) { F -= satF[at(x1, y0)]; Q -= satU[at(x1, y0)]; }
  if (x0 >= 0 && y0 >= 0) { F += satF[at(x0, y0)]; Q += satU[at(x0, y0)]; }
  let n = f32(U.box * U.box);
  let mF = F.x / n;
  let vF = (F.y / n - mF * mF) * n / (n - 1.0);
  // u32 sums are exact; convert after the subtraction
  let mU = f32(Q.x) / U.scale / n;
  let vU = (f32(Q.y) / U.scale / n - mU * mU) * n / (n - 1.0);
  varOut[b] = vec2<f32>(vF, vU);
}
