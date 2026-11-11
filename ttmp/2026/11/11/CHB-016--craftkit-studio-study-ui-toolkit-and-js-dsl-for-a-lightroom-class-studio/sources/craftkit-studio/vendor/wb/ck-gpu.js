/* ck-gpu.js · the WebGPU path. A px lambda's traced expression tree is compiled to a WGSL compute shader (one
 * thread per pixel, scalarized per channel, field channels by name); consecutive px nodes are fused into one
 * dispatch by substituting the inner tree for the outer's `c`; ck.iterate ping-pongs two storage buffers inside one
 * command stream. Runs in the worker; when the browser has no WebGPU adapter, the CPU loop in ck-ops-image.js runs. */
(function (root) {
  'use strict';
  const E = root.CK_ENGINE, is = E.is;
  const G = E.gpu = { dev: null, tried: false, info: null, pipes: new Map() };
  G.ready = async function () {
    if (G.tried) return !!G.dev;
    G.tried = true;
    try {
      const nav = root.navigator; if (!nav || !nav.gpu) return false;
      const a = await nav.gpu.requestAdapter(); if (!a) return false;
      G.dev = await a.requestDevice(); G.info = a.info ? { vendor: a.info.vendor, arch: a.info.architecture } : {};
      G.dev.lost.then(() => { G.dev = null; G.tried = false; G.pipes.clear(); });
      return true;
    } catch (e) { G.error = String(e && e.message || e); return false; }
  };
  G.status = () => (G.dev ? `WebGPU (${(G.info && (G.info.vendor || G.info.arch)) || 'adapter'})` : G.tried ? 'no WebGPU adapter' : 'not started');

  const num = v => { const s = String(+v); return /[.e]/.test(s) ? (s.includes('e') && !s.includes('.') ? (+v).toFixed(8) : s) : s + '.0'; };
  function wgslExprs(ast, names) {
    const SW = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3 };
    const dimIn = { c: 4, uv: 2, xy: 2, t: 1, n: 1, lap: 4, size: 2 };
    const uses = new Set(), unis = [];
    function g(a) {
      switch (a[0]) {
        case 'num': return [num(a[1])];
        case 'u': { let k = unis.indexOf(a[1]); if (k < 0) { unis.push(a[1]); k = unis.length - 1; } return [`U[${k}]`]; }
        case 'in': { uses.add(a[1]); const d = dimIn[a[1]] || 1; const pre = a[1] === 'lap' ? 'l' : a[1]; return d === 1 ? [a[1] === 't' ? 'p.t' : a[1]] : Array.from({ length: d }, (_, i) => `${pre}${i}`); }
        case 'vec': return a[1].flatMap(g);
        case 'sw': {
          const base = g(a[1]), key = a[2];
          if (names && a[1][0] === 'in' && (a[1][1] === 'c' || a[1][1] === 'lap') && names.includes(key)) return [base[names.indexOf(key)]];
          if (!/^[xyzwrgba]{1,4}$/.test(key)) { if (key.length === 1) return [base[0]]; throw new Error(`px lambda: '.${key}' is not a channel here`); }
          return key.split('').map(ch => base[Math.min(base.length - 1, SW[ch])] || '0.0');
        }
        case 'obj': return Object.values(a[1]).flatMap(g);
        case 'f': {
          const f = a[1], args = a.slice(2).map(g), n = Math.max(...args.map(x => x.length));
          const at = (x, i) => (x.length === 1 ? x[0] : x[Math.min(i, x.length - 1)]);
          const cw = fn => Array.from({ length: n }, (_, i) => fn(i));
          const bin = op => cw(i => `(${at(args[0], i)} ${op} ${at(args[1], i)})`);
          switch (f) {
            case 'add': return bin('+'); case 'sub': return bin('-'); case 'mul': return bin('*'); case 'div': return bin('/');
            case 'pow': return cw(i => `pow(max(0.0, ${at(args[0], i)}), ${at(args[1], i)})`);
            case 'min': case 'max': case 'atan2': return cw(i => `${f}(${at(args[0], i)}, ${at(args[1], i)})`);
            case 'mix': return cw(i => `mix(${at(args[0], i)}, ${at(args[1], i)}, ${at(args[2], i)})`);
            case 'clamp': return cw(i => `clamp(${at(args[0], i)}, ${at(args[1], i)}, ${at(args[2], i)})`);
            case 'smoothstep': return cw(i => `smoothstep(${at(args[1], i)}, ${at(args[2], i)}, ${at(args[0], i)})`);
            case 'step': return cw(i => `step(${at(args[1], i)}, ${at(args[0], i)})`);
            case 'dot': { const m = Math.min(args[0].length, args[1].length); return ['(' + Array.from({ length: m }, (_, i) => `${args[0][i]} * ${args[1][i]}`).join(' + ') + ')']; }
            case 'length': return ['sqrt(' + args[0].map(x => `${x} * ${x}`).join(' + ') + ')'];
            case 'distance': { const m = Math.max(args[0].length, args[1].length); return ['sqrt(' + Array.from({ length: m }, (_, i) => `(${at(args[0], i)} - ${at(args[1], i)}) * (${at(args[0], i)} - ${at(args[1], i)})`).join(' + ') + ')']; }
            case 'gray': { const c = args[0]; const y = `(0.2126 * ${c[0]} + 0.7152 * ${at(c, 1)} + 0.0722 * ${at(c, 2)})`; return [y, y, y, c.length > 3 ? c[3] : '1.0']; }
            case 'hsv': { const c = args[0]; return [0, 1, 2].map(k => `hsvk(${c[0]}, ${at(c, 1)}, ${at(c, 2)}, ${k}u)`).concat([c.length > 3 ? c[3] : '1.0']); }
            case 'oneMinus': return args[0].map(x => `(1.0 - ${x})`);
            case 'sqrt': return args[0].map(x => `sqrt(max(0.0, ${x}))`);
            case 'log': return args[0].map(x => `log(max(1e-9, ${x}))`);
            case 'sin': case 'cos': case 'abs': case 'fract': case 'floor': case 'exp': case 'tan': case 'sign': return args[0].map(x => `${f}(${x})`);
            default: throw new Error(`px lambda: no WGSL for '${f}'`);
          }
        }
      }
      throw new Error('px lambda: bad expression');
    }
    const comps = g(ast);
    return { comps, uses, unis, outNames: ast[0] === 'obj' ? Object.keys(ast[1]) : null };
  }
  function shader(ast, names, ch) {
    const { comps, uses, unis, outNames } = wgslExprs(ast, names);
    const outCh = outNames ? comps.length : (ch === 1 ? 1 : Math.min(4, comps.length));
    const useLap = uses.has('lap');
    const load = Array.from({ length: 4 }, (_, k) => `let c${k} = ${k < ch ? `src[i * ${ch}u + ${k}u]` : ch === 1 && k < 3 ? 'c0' : k === 3 ? '1.0' : '0.0'};`).join('\n  ');
    const lapOf = k => `0.05 * src[i00 * ${ch}u + ${k}u] + 0.2 * src[i01 * ${ch}u + ${k}u] + 0.05 * src[i02 * ${ch}u + ${k}u] + 0.2 * src[i10 * ${ch}u + ${k}u] - src[i * ${ch}u + ${k}u] + 0.2 * src[i12 * ${ch}u + ${k}u] + 0.05 * src[i20 * ${ch}u + ${k}u] + 0.2 * src[i21 * ${ch}u + ${k}u] + 0.05 * src[i22 * ${ch}u + ${k}u]`;
    const lap = useLap ? `let xm = select(x - 1u, p.W - 1u, x == 0u); let xp = select(x + 1u, 0u, x == p.W - 1u); let ym = select(y - 1u, p.H - 1u, y == 0u); let yp = select(y + 1u, 0u, y == p.H - 1u);
  let i00 = ym * p.W + xm; let i01 = ym * p.W + x; let i02 = ym * p.W + xp; let i10 = y * p.W + xm; let i12 = y * p.W + xp; let i20 = yp * p.W + xm; let i21 = yp * p.W + x; let i22 = yp * p.W + xp;
  ${Array.from({ length: 4 }, (_, k) => `let l${k} = ${k < ch ? lapOf(k) : '0.0'};`).join('\n  ')}` : '';
    const code = `struct Params { W: u32, H: u32, t: f32, pad: f32 };
@group(0) @binding(0) var<storage, read> src: array<f32>;
@group(0) @binding(1) var<storage, read_write> dst: array<f32>;
@group(0) @binding(2) var<storage, read> U: array<f32>;
@group(0) @binding(3) var<uniform> p: Params;
fn hsvk(h: f32, s: f32, v: f32, k: u32) -> f32 { let n = select(select(1.0, 3.0, k == 1u), 5.0, k == 0u); let kk = (n + h * 6.0) % 6.0; return v - v * s * max(0.0, min(min(kk, 4.0 - kk), 1.0)); }
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let x = id.x; let y = id.y;
  if (x >= p.W || y >= p.H) { return; }
  let i = y * p.W + x;
  let uv0 = (f32(x) + 0.5) / f32(p.W); let uv1 = (f32(y) + 0.5) / f32(p.H); let xy0 = f32(x); let xy1 = f32(y); let size0 = f32(p.W); let size1 = f32(p.H);
  ${load}
  let n = c0;
  ${lap}
  ${comps.slice(0, outCh).map((e, k) => `dst[i * ${outCh}u + ${k}u] = ${e};`).join('\n  ')}
}`;
    return { code, outCh, outNames, unis };
  }
  G.shader = shader;
  function pipeline(sh) {
    let pl = G.pipes.get(sh.code);
    if (!pl) { const mod = G.dev.createShaderModule({ code: sh.code }); pl = G.dev.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } }); G.pipes.set(sh.code, pl); if (G.pipes.size > 48) G.pipes.delete(G.pipes.keys().next().value); }
    return pl;
  }
  const buf = (size, usage, data) => { const b = G.dev.createBuffer({ size: Math.max(16, Math.ceil(size / 4) * 4), usage, mappedAtCreation: !!data }); if (data) { new Float32Array(b.getMappedRange()).set(data); b.unmap(); } return b; };
  async function readback(b, n) { const st = G.dev.createBuffer({ size: n * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }); const enc = G.dev.createCommandEncoder(); enc.copyBufferToBuffer(b, 0, st, 0, n * 4); G.dev.queue.submit([enc.finish()]); await st.mapAsync(GPUMapMode.READ); const out = new Float32Array(st.getMappedRange().slice(0)); st.unmap(); st.destroy(); return out; }
  async function uniformsOf(sh, P, X) { const U = new Float32Array(Math.max(4, sh.unis.length)); for (let k = 0; k < sh.unis.length; k++) { const v = (P.uniforms || {})[sh.unis[k]]; U[k] = typeof v === 'number' ? v : await E.need(v, 'number', 0, 0, X); } return U; }
  function wrap(src, data, sh, names) {
    if (sh.outCh === 4 && !sh.outNames && (is(src, 'image') || !src.names)) { for (let i = 0; i < data.length; i++) data[i] = data[i] < 0 ? 0 : data[i] > 1 ? 1 : data[i]; return E.image(src.w, src.h, data, { u: src.u }); }
    return E.field(src.w, src.h, sh.outCh, data, sh.outNames || names || null, { u: src.u });
  }
  // fuse a chain of px nodes: substitute the inner tree for the outer's c (images only; named fields stay separate)
  function substitute(ast, inner) {
    if (!Array.isArray(ast)) return ast;
    if (ast[0] === 'in' && ast[1] === 'c') return inner;
    if (ast[0] === 'in' && ast[1] === 'n') return ['sw', inner, 'r'];
    if (ast[0] === 'obj') { const o = {}; for (const [k, v] of Object.entries(ast[1])) o[k] = substitute(v, inner); return ['obj', o]; }
    if (ast[0] === 'vec') return ['vec', ast[1].map(x => substitute(x, inner))];
    return ast.map((x, i) => (i === 0 ? x : substitute(x, inner)));
  }
  G.px = async function (src, P, X) {
    if (!G.dev) return null;
    const ch = is(src, 'image') ? 4 : is(src, 'mask') ? 1 : src.ch, names = is(src, 'image') ? null : src.names;
    const sh = shader(P.ast, names, ch), pl = pipeline(sh), W = src.w, H = src.h;
    const U = await uniformsOf(sh, P, X);
    const a = buf(src.d.byteLength, GPUBufferUsage.STORAGE, src.d), b = buf(W * H * sh.outCh * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC), ub = buf(U.byteLength, GPUBufferUsage.STORAGE, U);
    const pb = G.dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); const pv = new ArrayBuffer(16); new Uint32Array(pv, 0, 2).set([W, H]); new Float32Array(pv, 8, 1)[0] = X.time || 0; G.dev.queue.writeBuffer(pb, 0, pv);
    const bg = G.dev.createBindGroup({ layout: pl.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: a } }, { binding: 1, resource: { buffer: b } }, { binding: 2, resource: { buffer: ub } }, { binding: 3, resource: { buffer: pb } }] });
    const enc = G.dev.createCommandEncoder(), pass = enc.beginComputePass(); pass.setPipeline(pl); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8)); pass.end(); G.dev.queue.submit([enc.finish()]);
    E.stats.gpuDispatches++;
    const out = await readback(b, W * H * sh.outCh);
    [a, b, ub, pb].forEach(x => x.destroy());
    X.note(`WebGPU: one dispatch of ${Math.ceil(W / 8) * Math.ceil(H / 8)} workgroups${P.fused ? `, ${P.fused} px ops fused` : ''}`);
    return wrap(src, out, sh, names);
  };
  G.fuse = function (n, P) {
    // walk up through px nodes that feed only this chain
    let ast = P.ast, id = n.in.src, count = 1;
    while (true) {
      const m = E.P.byId.get(id); if (!m || m.op !== 'raster.px' || (E.P.succ.get(id) || []).length !== 1) break;
      if (JSON.stringify(m.params.ast).includes('"lap"') || JSON.stringify(ast).includes('"lap"')) break;
      ast = substitute(ast, m.params.ast[0] === 'obj' ? ['vec', Object.values(m.params.ast[1])] : m.params.ast); id = m.in.src; count++;
    }
    return { ast, srcId: id, count };
  };
  G.iterate = async function (init, P, steps, X) {
    if (!G.dev) return null;
    const ch = is(init, 'image') ? 4 : is(init, 'mask') ? 1 : init.ch, names = is(init, 'image') ? null : init.names;
    const sh = shader(P.ast, names, ch); if (sh.outCh !== ch) throw new Error('a px lambda inside iterate must return the channels it reads');
    const pl = pipeline(sh), W = init.w, H = init.h, U = await uniformsOf(sh, P, X);
    const A = buf(init.d.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, init.d), B = buf(init.d.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC), ub = buf(U.byteLength, GPUBufferUsage.STORAGE, U);
    const pb = G.dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); const pv = new ArrayBuffer(16); new Uint32Array(pv, 0, 2).set([W, H]); new Float32Array(pv, 8, 1)[0] = X.time || 0; G.dev.queue.writeBuffer(pb, 0, pv);
    const mk = (s, d) => G.dev.createBindGroup({ layout: pl.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: s } }, { binding: 1, resource: { buffer: d } }, { binding: 2, resource: { buffer: ub } }, { binding: 3, resource: { buffer: pb } }] });
    const ab = mk(A, B), ba = mk(B, A), t0 = performance.now();
    for (let s = 0; s < steps;) {
      const enc = G.dev.createCommandEncoder(), pass = enc.beginComputePass(); pass.setPipeline(pl);
      const n = Math.min(250, steps - s);
      for (let k = 0; k < n; k++, s++) { pass.setBindGroup(0, s % 2 ? ba : ab); pass.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8)); }
      pass.end(); G.dev.queue.submit([enc.finish()]); E.stats.gpuDispatches += n;
      await G.dev.queue.onSubmittedWorkDone();
    }
    const out = await readback(steps % 2 ? B : A, W * H * ch);
    [A, B, ub, pb].forEach(x => x.destroy());
    X.note(`WebGPU: ${steps} ping-pong dispatches in ${Math.round(performance.now() - t0)} ms`);
    return wrap(init, out, sh, names);
  };
})(typeof self !== 'undefined' ? self : this);
