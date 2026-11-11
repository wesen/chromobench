/* ck-engine.js · CraftKit's execution engine. Runs in the sandbox worker, next to the recorder (ck-runtime.js).
 * It evaluates the recorded IR: every op has an implementation (ck-ops-*.js) that calls the Crafting Apps' own
 * algorithm crates compiled to wasm (ck_photo, ck_vector, ck_cad, ck_grid, ck_sound, ck_light), WebGPU for fused
 * pointwise kernels when the browser has it, or JS where the job is layout or glue. Results are cached by a signature
 * of (op, resolved params, input signatures, time when it matters), so a control re-runs only what reads it.
 * Values: images are straight-alpha RGBA Float32 (sRGB 0–1); masks 1 channel; fields n channels; vectors are SVG
 * path data in canvas units; audio is planar Float32. */
(function (root) {
  'use strict';
  const K = Symbol('ck.value');
  const E = { K, OPS: Object.create(null), base: '', userAssets: new Map(), stats: { wasmCalls: 0, gpuDispatches: 0 } };
  root.CK_ENGINE = E;

  // ── registry ───────────────────────────────────────────────────────────
  // def(ids, impl, meta): impl(n, I, P, X) → value. I = evaluated inputs, P = resolved params, X = context.
  // meta.lazy: inputs are not evaluated first (the op calls X.eval itself). meta.time: depends on time.
  function def(ids, impl, meta) { for (const id of [].concat(ids)) E.OPS[id] = Object.assign({ impl }, meta || {}); }
  E.def = def;

  // ── values ─────────────────────────────────────────────────────────────
  const mk = (t, o) => Object.assign({ [K]: true, t }, o);
  const is = (v, t) => !!(v && v[K] && (!t || v.t === t || (Array.isArray(t) && t.includes(v.t))));
  E.mk = mk; E.is = is;
  E.image = (w, h, d, o) => mk('image', Object.assign({ w, h, d: d || new Float32Array(w * h * 4), u: 1 }, o));
  E.mask = (w, h, d, o) => mk('mask', Object.assign({ w, h, d: d || new Float32Array(w * h), u: 1 }, o));
  E.field = (w, h, ch, d, names, o) => mk('field', Object.assign({ w, h, ch, d: d || new Float32Array(w * h * ch), names: names || null, u: 1 }, o));
  E.proc = (kind, gen, o) => mk('proc', Object.assign({ kind, gen }, o));     // a resolution-free generator: gen(w, h) → value
  E.shapes = (w, h, items, o) => mk('shapes', Object.assign({ w, h, items: items || [] }, o));
  E.path = (d, o) => mk('path', Object.assign({ d: d || '' }, o));
  E.list = (items, o) => mk('list', Object.assign({ items }, o));
  E.palette = (colors, o) => mk('palette', Object.assign({ colors }, o));
  E.audio = (sr, ch, o) => mk('audio', Object.assign({ sr, ch }, o));
  E.series = (frames, hop, o) => mk('series', Object.assign({ frames, hop }, o));  // a value over time: frames[i] at i*hop seconds
  const DEF_W = 640, DEF_H = 480, MAX_SIDE = 1024;
  E.DEF = [DEF_W, DEF_H]; E.MAX_SIDE = MAX_SIDE;

  // colour helpers
  function hex(c) {
    if (Array.isArray(c)) return c.length >= 3 ? c.slice(0, 4).map((x, i) => (i < 3 ? (x > 1 ? x / 255 : x) : x)) : [0, 0, 0, 1];
    if (c && typeof c === 'object' && c.rgb) return hex(c.rgb);
    let s = String(c == null ? '#000' : c).trim();
    const named = { black: '#000000', white: '#ffffff', red: '#e2001a', blue: '#0078bf', transparent: '#00000000', gray: '#808080', grey: '#808080', yellow: '#ffd400', green: '#00a651', pink: '#ff48b0', orange: '#ff6c2f', cream: '#f4efe6', paper: '#fbfaf6', ink: '#1d2733' };
    if (named[s.toLowerCase()]) s = named[s.toLowerCase()];
    if (s.startsWith('nearest:')) s = s.slice(8);
    if (s[0] !== '#') { const m = s.match(/rgba?\(([^)]+)\)/); if (m) { const p = m[1].split(',').map(Number); return [p[0] / 255, p[1] / 255, p[2] / 255, p.length > 3 ? p[3] : 1]; } return [0, 0, 0, 1]; }
    let h = s.slice(1); if (h.length <= 4) h = h.split('').map(x => x + x).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  }
  const toHex = c => '#' + c.slice(0, 3).map(x => Math.round(Math.max(0, Math.min(1, x > 1 ? x / 255 : x)) * 255).toString(16).padStart(2, '0')).join('');
  E.hex = hex; E.toHex = toHex;
  const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
  E.clamp01 = clamp01;
  const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  E.luma = luma;

  // ── canvases ───────────────────────────────────────────────────────────
  E.canvas = (w, h) => { const c = new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); return c; };
  E.toU8 = function (img) {
    const n = img.w * img.h, out = new Uint8ClampedArray(n * 4), d = img.d;
    if (img.t === 'image') for (let i = 0; i < n * 4; i++) out[i] = d[i] * 255 + 0.5;
    else if (img.t === 'mask') for (let i = 0; i < n; i++) { const v = d[i] * 255 + 0.5; out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v; out[i * 4 + 3] = 255; }
    else if (img.t === 'field') {
      const ch = img.ch;
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < n * ch; i++) { const v = d[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
      const norm = lo < -0.001 || hi > 1.001 ? (v => (v - lo) / (hi - lo || 1)) : (v => v);
      for (let i = 0; i < n; i++) {
        const a = norm(d[i * ch]), b = ch > 1 ? norm(d[i * ch + 1]) : a, c = ch > 2 ? norm(d[i * ch + 2]) : (ch > 1 ? 0.5 * (a + b) : a);
        out[i * 4] = a * 255; out[i * 4 + 1] = b * 255; out[i * 4 + 2] = c * 255; out[i * 4 + 3] = ch > 3 ? norm(d[i * ch + 3]) * 255 : 255;
      }
    }
    return out;
  };
  E.fromImageData = function (id, o) { const n = id.width * id.height, d = new Float32Array(n * 4), s = id.data; for (let i = 0; i < n * 4; i++) d[i] = s[i] / 255; return E.image(id.width, id.height, d, o); };
  E.toCanvas = function (img) { const c = E.canvas(img.w, img.h); c.getContext('2d').putImageData(new ImageData(E.toU8(img), img.w, img.h), 0, 0); return c; };
  E.fromCanvas = function (c, o) { return E.fromImageData(c.getContext('2d').getImageData(0, 0, c.width, c.height), o); };

  // resample: bilinear on floats (keeps precision; used for masks, fields and layer placement)
  E.resample = function (v, w, h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    if (v.w === w && v.h === h) return v;
    const ch = v.t === 'image' ? 4 : v.t === 'mask' ? 1 : v.ch, out = new Float32Array(w * h * ch), d = v.d, W = v.w, H = v.h;
    const sx = W / w, sy = H / h;
    if (sx > 2 || sy > 2) {   // shrinking a lot: box filter
      for (let y = 0; y < h; y++) {
        const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
        for (let x = 0; x < w; x++) {
          const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
          for (let c = 0; c < ch; c++) { let s = 0; for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) s += d[(yy * W + xx) * ch + c]; out[(y * w + x) * ch + c] = s / ((y1 - y0) * (x1 - x0)); }
        }
      }
    } else {
      for (let y = 0; y < h; y++) {
        const fy = Math.max(0, Math.min(H - 1, (y + 0.5) * sy - 0.5)), y0 = Math.floor(fy), y1 = Math.min(H - 1, y0 + 1), ty = fy - y0;
        for (let x = 0; x < w; x++) {
          const fx = Math.max(0, Math.min(W - 1, (x + 0.5) * sx - 0.5)), x0 = Math.floor(fx), x1 = Math.min(W - 1, x0 + 1), tx = fx - x0;
          for (let c = 0; c < ch; c++) {
            const a = d[(y0 * W + x0) * ch + c], b = d[(y0 * W + x1) * ch + c], cc = d[(y1 * W + x0) * ch + c], dd = d[(y1 * W + x1) * ch + c];
            out[(y * w + x) * ch + c] = (a + (b - a) * tx) + ((cc + (dd - cc) * tx) - (a + (b - a) * tx)) * ty;
          }
        }
      }
    }
    return Object.assign({}, v, { w, h, d: out, u: (v.u || 1) * (w / W) });
  };
  // fit a size inside MAX_SIDE, keeping units: returns [pxW, pxH, pxPerUnit]
  E.fitSize = function (w, h, max) { max = max || MAX_SIDE; const s = Math.min(1, max / Math.max(w, h)); return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)), s]; };

  // ── conversions between kinds (ops call need() so any visual value feeds any visual op) ──
  E.need = async function (v, want, w, h, X) {
    if (v == null) throw new Error(`expected ${want}, got nothing`);
    if (is(v, 'list') && v.items.length && want !== 'list') v = v.items[0];
    if (is(v, 'proc')) v = await v.gen(w || (X && X.env.size && X.env.size[0]) || 512, h || (X && X.env.size && X.env.size[1]) || 512);
    if (want === 'any') return v;
    if (want === 'image') {
      if (is(v, 'image')) return w && h && (v.w !== w || v.h !== h) ? E.resample(v, w, h) : v;
      if (is(v, 'mask')) { const o = E.image(v.w, v.h, null, { u: v.u }); for (let i = 0; i < v.w * v.h; i++) { const m = v.d[i]; o.d[i * 4] = o.d[i * 4 + 1] = o.d[i * 4 + 2] = m; o.d[i * 4 + 3] = 1; } return E.need(o, 'image', w, h); }
      if (is(v, 'field')) { const id = E.toU8(v); const o = E.image(v.w, v.h, null, { u: v.u }); for (let i = 0; i < id.length; i++) o.d[i] = id[i] / 255; return E.need(o, 'image', w, h); }
      if (is(v, ['shapes', 'path', 'text', 'pages'])) return E.rasterize(v, w, h, X);
      if (is(v, 'table')) return E.tableImage ? E.tableImage(v, w, h) : E.need(v.values ? JSON.stringify(v.values) : '#ffffff', 'image', w, h);
      if (is(v, 'audio')) return E.waveImage ? E.waveImage(v, w || 800, h || 200) : E.need('#000000', 'image', w, h);
      if (is(v, 'palette')) return E.paletteImage(v, w || 600, h || 120);
      if (typeof v === 'string' || Array.isArray(v)) { const c = hex(v); const o = E.image(w || DEF_W, h || DEF_H); for (let i = 0; i < o.w * o.h; i++) o.d.set(c, i * 4); return o; }
      throw new Error(`a ${v.t || typeof v} value cannot be shown as an image`);
    }
    if (want === 'mask') {
      if (is(v, 'mask')) return w && h && (v.w !== w || v.h !== h) ? E.resample(v, w, h) : v;
      if (is(v, 'image')) {
        const img = w && h ? await E.need(v, 'image', w, h) : v; const o = E.mask(img.w, img.h, null, { u: img.u });
        let opaque = true; for (let i = 0; i < img.w * img.h; i++) if (img.d[i * 4 + 3] < 0.999) { opaque = false; break; }
        for (let i = 0; i < img.w * img.h; i++) o.d[i] = opaque ? luma(img.d[i * 4], img.d[i * 4 + 1], img.d[i * 4 + 2]) : img.d[i * 4 + 3];
        return o;
      }
      if (is(v, 'field')) { const f = w && h ? E.resample(v, w, h) : v; const o = E.mask(f.w, f.h, null, { u: f.u }); for (let i = 0; i < f.w * f.h; i++) o.d[i] = clamp01(f.d[i * f.ch]); return o; }
      if (is(v, ['shapes', 'path', 'text'])) return E.need(await E.rasterize(v, w, h, X), 'mask', w, h);
      throw new Error(`a ${v.t || typeof v} value cannot be used as a mask`);
    }
    if (want === 'field') {
      if (is(v, 'field')) return w && h && (v.w !== w || v.h !== h) ? E.resample(v, w, h) : v;
      if (is(v, 'mask')) { const m = w && h ? E.resample(v, w, h) : v; return E.field(m.w, m.h, 1, Float32Array.from(m.d), null, { u: m.u }); }
      if (is(v, 'image')) { const img = w && h ? E.resample(v, w, h) : v; return E.field(img.w, img.h, 4, Float32Array.from(img.d), ['r', 'g', 'b', 'a'], { u: img.u }); }
      return E.need(await E.need(v, 'image', w, h, X), 'field');
    }
    if (want === 'number') {
      if (typeof v === 'number') return v;
      if (typeof v === 'string' && v.trim() !== '' && !isNaN(+v)) return +v;
      if (is(v, 'series')) return E.sampleSeries(v, X ? X.env.time : 0);
      if (Array.isArray(v)) return Number(v[0]) || 0;
      return Number(v) || 0;
    }
    return v;
  };
  E.sampleSeries = function (s, t) {
    if (!s.frames.length) return 0;
    const f = Math.max(0, Math.min(s.frames.length - 1, (t || 0) / s.hop)), i = Math.floor(f), j = Math.min(s.frames.length - 1, i + 1), k = f - i;
    const a = s.frames[i], b = s.frames[j];
    if (typeof a === 'number') return a + (b - a) * k;
    return a.map((x, m) => x + (b[m] - x) * k);
  };
  E.paletteImage = function (p, w, h) {
    const o = E.image(w, h); const cs = p.colors.length ? p.colors : [{ rgb: [0, 0, 0] }];
    const tot = cs.reduce((a, c) => a + (p.weighted ? (c.weight || 1) : 1), 0);
    let x0 = 0;
    cs.forEach(c => { const cw = Math.round(((p.weighted ? (c.weight || 1) : 1) / tot) * w); const col = hex(c.rgb || c.hex || c); for (let y = 0; y < h; y++) for (let x = x0; x < Math.min(w, x0 + cw + 1); x++) o.d.set(col, (y * w + x) * 4); x0 += cw; });
    return o;
  };

  // ── wasm modules (the Crafting Apps' crates) ───────────────────────────
  const WASM = new Map();
  const enc = new TextEncoder(), dec = new TextDecoder();
  async function loadWasm(name) {
    if (WASM.has(name)) return WASM.get(name);
    const p = (async () => {
      const res = await fetch(E.base + name + '.wasm');
      if (!res.ok) throw new Error(`${name}.wasm did not load (${res.status})`);
      const bin = await res.arrayBuffer();
      const mod = await WebAssembly.compile(bin);
      const st = { mod, inst: null };
      const fresh = async () => { st.inst = await WebAssembly.instantiate(mod, {}); };
      await fresh();
      st.call = function (op, args, data) {
        const X = st.inst.exports;
        const ob = enc.encode(op), ab = enc.encode(JSON.stringify(args || {}));
        const db = data ? (data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)) : new Uint8Array(0);
        const put = b => { const p2 = X.ck_alloc(b.length); new Uint8Array(X.memory.buffer, p2, b.length).set(b); return p2; };
        let rc, po, pa, pd;
        try {
          po = put(ob); pa = put(ab); pd = put(db);
          rc = X.ck_call(po, ob.length, pa, ab.length, pd, db.length);
          X.ck_free(po, ob.length); X.ck_free(pa, ab.length); X.ck_free(pd, db.length);
        } catch (e) {
          // a trap (panic, out of memory) leaves the instance unusable: start a fresh one for the next call
          st.inst = null; fresh().catch(() => {});
          throw new Error(`${name}: ${op} stopped inside wasm (${e && e.message || e})`);
        }
        E.stats.wasmCalls++;
        const msg = JSON.parse(dec.decode(new Uint8Array(X.memory.buffer, X.ck_msg_ptr(), X.ck_msg_len())) || 'null');
        const out = new Uint8Array(X.memory.buffer, X.ck_out_ptr(), X.ck_out_len()).slice();
        X.ck_release();
        if (rc !== 0) throw new Error(`${name}: ${(msg && msg.error) || 'failed'}`);
        return { msg, out, f32: () => new Float32Array(out.buffer, 0, out.byteLength >> 2) };
      };
      return st;
    })();
    WASM.set(name, p);
    p.catch(() => WASM.delete(name));
    return p;
  }
  E.wasm = loadWasm;
  E.wasmCall = async function (name, op, args, data) {
    const m = await loadWasm(name);
    if (!m.inst) await new Promise(r => setTimeout(r, 0));
    return m.call(op, args, data);
  };
  E.wasmLoaded = () => [...WASM.keys()];

  // ── keyframes and expressions (EffectCraft semantics, simplified) ──────
  const EASE = {
    linear: t => t, hold: () => 0,
    easeIn: t => t * t * t, easeOut: t => 1 - Math.pow(1 - t, 3), easeInOut: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2), easy: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    easeOutBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    easeOutElastic: t => (t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
    bounce: t => { const n1 = 7.5625, d1 = 2.75; if (t < 1 / d1) return n1 * t * t; if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75; if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375; return n1 * (t -= 2.625 / d1) * t + 0.984375; },
  };
  E.EASE = EASE;
  function lerpV(a, b, t) { if (Array.isArray(a)) return a.map((x, i) => lerpV(x, Array.isArray(b) ? b[i] : b, t)); if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t; if (typeof a === 'string' && typeof b === 'string' && a[0] === '#' && b[0] === '#') return toHex(hex(a).map((x, i) => x + (hex(b)[i] - x) * t)); return t < 1 ? a : b; }
  E.keysAt = function (keys, t) {
    if (!keys.length) return 0;
    const K2 = keys.map(k => (Array.isArray(k) ? { t: +k[0], v: k[1], ease: k[2] } : k)).sort((a, b) => a.t - b.t);
    if (t <= K2[0].t) return K2[0].v;
    for (let i = 1; i < K2.length; i++) {
      if (t <= K2[i].t) {
        const a = K2[i - 1], b = K2[i], span = b.t - a.t || 1, f = (t - a.t) / span;
        const e = EASE[b.ease || a.out || 'easeInOut'] || EASE.easeInOut;
        if (a.ease === 'hold') return a.v;
        return lerpV(a.v, b.v, e(f));
      }
    }
    return K2[K2.length - 1].v;
  };
  // deterministic value noise for wiggle()
  function hash1(n) { n = (n << 13) ^ n; return 1 - ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 1073741824; }
  function noise1(x, seed) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash1(i + seed * 101) * (1 - u) + hash1(i + 1 + seed * 101) * u; }
  E.noise1 = noise1;
  const EXPR_CACHE = new Map();
  E.evalExpr = function (text, refs, scope) {
    refs = refs.filter((r, i) => refs.indexOf(r) === i);   // the same control may appear twice in one expression
    const names = ['time', 'frame', 'index', 'textIndex', 'textTotal', 'value', 'seed'].concat(refs.map(r => '$' + r));
    const key = names.join(',') + '|' + text;
    let fn = EXPR_CACHE.get(key);
    if (!fn) {
      const helpers = 'const {wiggle, linear, ease, easeIn, easeOut, clamp, random, noise, sin, cos, abs, min, max, floor, round, pow, sqrt, PI, loopOut, degreesToRadians} = H;';
      fn = new Function('H', ...names, `"use strict"; ${helpers} return (${text});`);
      EXPR_CACHE.set(key, fn);
    }
    const t = scope.time || 0, s = (scope.seed || 1) + (scope.index || 0) * 17 + (scope.textIndex || 0) * 31;
    const lin = (x, a, b, c, d) => { if (c === undefined) { c = a; d = b; a = 0; b = 1; } const f = clamp01((x - a) / ((b - a) || 1)); return lerpV(c, d, f); };
    const H = {
      wiggle: (freq, amp) => { const v = scope.value; const w = k => noise1(t * freq + k * 13.7, s + k) * amp; return Array.isArray(v) ? v.map((x, k) => x + w(k)) : (typeof v === 'number' ? v : 0) + w(0); },
      linear: lin, ease: (x, a, b, c, d) => { if (c === undefined) { c = a; d = b; a = 0; b = 1; } return lerpV(c, d, EASE.easeInOut(clamp01((x - a) / ((b - a) || 1)))); },
      easeIn: (x, a, b, c, d) => lerpV(c, d, EASE.easeIn(clamp01((x - a) / ((b - a) || 1)))), easeOut: (x, a, b, c, d) => lerpV(c, d, EASE.easeOut(clamp01((x - a) / ((b - a) || 1)))),
      clamp: (x, a, b) => Math.max(a, Math.min(b, x)), random: (a, b) => { const r = (hash1(s * 7919 + Math.floor(t * 1000)) + 1) / 2; return a === undefined ? r : b === undefined ? r * a : a + r * (b - a); },
      noise: x => noise1(x, s), sin: Math.sin, cos: Math.cos, abs: Math.abs, min: Math.min, max: Math.max, floor: Math.floor, round: Math.round, pow: Math.pow, sqrt: Math.sqrt, PI: Math.PI,
      loopOut: () => scope.value, degreesToRadians: d => d * Math.PI / 180,
    };
    const vals = [t, Math.floor(t * (scope.fps || 30)), scope.index || 0, scope.textIndex || 0, scope.textTotal || 1, scope.value === undefined ? 0 : scope.value, scope.seed || 1].concat(refs.map(r => scope.refs ? scope.refs[r] : undefined));
    const v = fn(H, ...vals);
    return v;
  };

  // ── the program currently loaded ───────────────────────────────────────
  const P = { ir: null, fns: [], byId: new Map(), succ: new Map(), timeDep: new Map(), bindDeps: new Map(), kids: new Map() };
  E.P = P;
  const BIND_OPS = new Set(['each', 'stack.below', 'iterate.state', 'layout.cell']);
  const TIME_OPS = new Set(['source.video', 'source.camera', 'comp', 'comp.at', 'clip.map', 'clip.flow', 'clip.stabilize', 'clip.speed', 'clip.trim', 'source.mic', 'gen.stream']);
  E.load = function (out, fns) {
    P.ir = out.ir; P.fns = fns || []; P.byId = new Map(out.ir.nodes.map(n => [n.id, n]));
    P.succ = new Map(); P.timeDep = new Map(); P.bindDeps = new Map(); P.deps = new Map();
    for (const n of out.ir.nodes) P.deps.set(n.id, depsOf(n));
    for (const n of out.ir.nodes) for (const d of P.deps.get(n.id)) (P.succ.get(d) || P.succ.set(d, []).get(d)).push(n.id);
    P.controls = new Map(out.ir.controls.map(c => [c.id, c]));
    P.version = (P.version || 0) + 1;
  };
  function depsOf(n) {
    const out = new Set(Object.values(n.in || {}).filter(x => typeof x === 'string'));
    (function walk(v) {
      if (!v || typeof v !== 'object') return;
      if (Array.isArray(v)) return v.forEach(walk);
      if (v.$ref) out.add(v.$ref);
      if (v.refs) v.refs.forEach(r => out.add(r));
      for (const x of Object.values(v)) walk(x);
    })(n.params);
    if (n.op === 'list.map' || /\.map$/.test(n.op)) (n.params.template || []).forEach(t => out.add(t));
    return [...out].filter(x => P.byId.has(x) && x !== n.id);
  }
  function isTimeDep(id, seen) {
    if (P.timeDep.has(id)) return P.timeDep.get(id);
    seen = seen || new Set(); if (seen.has(id)) return false; seen.add(id);
    const n = P.byId.get(id); if (!n) return false;
    const s = JSON.stringify(n.params);
    let r = TIME_OPS.has(n.op) || s.includes('"$keys"') || s.includes('"$expr"') || (n.op === 'raster.px' && n.params.time) || (E.OPS[n.op] && E.OPS[n.op].time);
    if (!r) for (const d of P.deps.get(id) || []) if (isTimeDep(d, seen)) { r = true; break; }
    P.timeDep.set(id, !!r);
    return !!r;
  }
  E.isTimeDep = id => isTimeDep(id);
  function bindDepsOf(id, seen) {
    if (P.bindDeps.has(id)) return P.bindDeps.get(id);
    seen = seen || new Set(); if (seen.has(id)) return []; seen.add(id);
    const n = P.byId.get(id); if (!n) return [];
    const set = new Set(BIND_OPS.has(n.op) ? [id] : []);
    for (const d of P.deps.get(id) || []) for (const b of bindDepsOf(d, seen)) set.add(b);
    // a map/iterate/stack node binds its own template: those bindings are internal, not its dependencies
    if (n.op === 'list.map' || /\.map$/.test(n.op) || n.op === 'iterate' || n.op === 'stack' || n.op === 'comp' || n.op === 'shapes.grid') {
      const own = new Set((n.params.template || n.params.body || []).concat(n.params.cells || []));
      for (const l of n.params.layers || []) for (const b of l.body || []) own.add(b);
      for (const b of [...set]) if (own.has(b) || (P.byId.get(b) && ((P.byId.get(b).in || {}).stack === id || (P.byId.get(b).in || {}).of === n.in.src || P.byId.get(b).params.grid === id))) set.delete(b);
      if (n.op === 'iterate') for (const b of [...set]) if (P.byId.get(b) && P.byId.get(b).op === 'iterate.state') set.delete(b);
    }
    const r = [...set];
    P.bindDeps.set(id, r);
    return r;
  }

  // ── signatures and the cache ───────────────────────────────────────────
  const fnv = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  E.fnv = fnv;
  const CACHE = new Map(); let cacheBytes = 0; const CACHE_MAX = 600 * 1024 * 1024;
  function sizeOf(v) { if (!v || typeof v !== 'object') return 64; if (v.d && v.d.byteLength) return v.d.byteLength; if (v.ch && Array.isArray(v.ch)) return v.ch.reduce((a, c) => a + c.byteLength, 0); if (is(v, 'list')) return v.items.reduce((a, x) => a + sizeOf(x), 0); return 1024; }
  function cacheSet(sig, v) {
    const b = sizeOf(v);
    if (CACHE.has(sig)) cacheBytes -= CACHE.get(sig).b;
    CACHE.set(sig, { v, b, at: ++E.clock });
    cacheBytes += b;
    if (cacheBytes > CACHE_MAX) { const ents = [...CACHE.entries()].sort((a, b2) => a[1].at - b2[1].at); for (const [k, e] of ents) { if (cacheBytes < CACHE_MAX * 0.7) break; CACHE.delete(k); cacheBytes -= e.b; } }
  }
  E.clock = 0;
  E.clearCache = () => { CACHE.clear(); cacheBytes = 0; };

  function stable(v) {
    if (v === undefined) return 'u';
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    return '{' + Object.keys(v).sort().map(k => k + ':' + stable(v[k])).join(',') + '}';
  }
  function sigOf(id, env, memo) {
    const key = id;
    if (memo.has(key)) return memo.get(key);
    memo.set(key, 'cycle:' + id);
    const n = P.byId.get(id);
    let s;
    if (!n) s = 'missing:' + id;
    else if (env.bind && env.bind.has(id)) s = 'bound:' + env.bind.get(id).sig;
    else {
      const parts = [n.op];
      const pv = JSON.stringify(n.params, (k, v) => {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          if (v.$control) return { $c: stable(E.ctlValue(v.$control, env)) };
          if (v.$ref) return { $r: sigOf(v.$ref, env, memo) };
          if (v.$expr) return { $e: v.$expr, r: (v.refs || []).map(r => (/^c\d+$/.test(r) ? stable(E.ctlValue(r, env)) : sigOf(r, env, memo))) };
          if (v.$fn !== undefined) return { $f: v.$lambda };
        }
        return v;
      });
      parts.push(pv);
      for (const [k, d] of Object.entries(n.in || {})) if (typeof d === 'string') parts.push(k + '=' + sigOf(d, env, memo));
      if (n.op === 'list.map' || /\.map$/.test(n.op) || n.op === 'iterate') for (const t of n.params.template || n.params.body || []) parts.push(sigOf(t, env, memo));
      if (n.op === 'stack' || n.op === 'comp') for (const l of n.params.layers || []) for (const b of l.body || []) parts.push(sigOf(b, env, memo));
      if (n.op === 'layout.cell' && n.params.grid) parts.push('grid=' + stable(P.byId.get(n.params.grid) && P.byId.get(n.params.grid).params));
      if (/^(source\.sketch2d|sketch\.)/.test(n.op)) parts.push('node=' + id);   // sketch values carry node ids: never share them across programs
      if (n.op === 'source.sheet' && env.sheet && env.sheet[id]) parts.push('edits=' + stable(env.sheet[id]));
      if (env.strokes && env.strokes[id]) { const L = env.strokes[id].list || []; parts.push('strokes=' + L.length + ':' + (L.length ? L[L.length - 1].length : 0)); }
      if (n.op === 'board.items' || n.op === 'source.images' || n.op === 'source.image' || n.op === 'source.folder') parts.push('assets=' + E.assetVersion);
      if (isTimeDep(id)) parts.push('@' + (Math.round((env.time || 0) * 1000) / 1000));
      for (const b of bindDepsOf(id)) if (env.bind && env.bind.has(b)) parts.push('b' + b + '=' + env.bind.get(b).sig);
      if (env.target) parts.push(env.target === 'webgpu' && n.pointwise ? 'g' : '');
      s = fnv(parts.join('|'));
    }
    memo.set(key, s);
    return s;
  }
  E.assetVersion = 0;

  // ── control values ─────────────────────────────────────────────────────
  E.ctlValue = function (cid, env) {
    const c = P.controls && P.controls.get(cid);
    const st = env && env.controls || {};
    if (cid in st) return st[cid];
    if (!c) return undefined;
    if (c.value !== undefined && c.value !== null) return c.value;
    switch (c.type) {
      case 'slider': case 'knob': return typeof c.min === 'number' && typeof c.max === 'number' ? Number(((c.min + c.max) / 2).toPrecision(3)) : 0;
      case 'xy': return [0, 0];
      case 'wheel': return [0, 0, 0];
      case 'curve': return [[0, 0], [1, 1]];
      case 'gradient': return c.stops || ['#000000', '#ffffff'];
      case 'color': return '#e2001a';
      case 'select': return (c.options || [])[0];
      case 'toggle': return false;
      case 'prompt': return '';
      case 'seed': return 4021;
      default: return null;
    }
  };

  // ── evaluation ─────────────────────────────────────────────────────────
  class Ctx {
    constructor(env, run) { this.env = env; this.run = run; }
    eval(id, env2) { return evalNode(id, env2 || this.env, this.run); }
    with(patch) { return new Ctx(Object.assign({}, this.env, patch, patch.bind ? { bind: patch.bind } : {}), this.run); }
    bind(pairs) { const b = new Map(this.env.bind || []); for (const [k, v] of pairs) b.set(k, { v, sig: v && v.__sig ? v.__sig : fnv(String(Math.random())) }); return b; }
    warn(msg) { this.run.warnings.push({ node: this.node && this.node.id, message: msg }); }
    note(msg) { if (this.node) (this.run.notes[this.node.id] = this.run.notes[this.node.id] || []).push(msg); }
    resolve(v) { return resolveParams(v, this.env, this.run); }
    need(v, want, w, h) { return E.need(v, want, w, h, this); }
    async img(v, w, h) { return E.need(v, 'image', w, h, this); }
    get time() { return this.env.time || 0; }
    fn(p) { return p && p.$fn !== undefined ? P.fns[p.$fn] : typeof p === 'function' ? p : null; }
  }
  E.Ctx = Ctx;
  async function resolveParams(v, env, run, depth) {
    depth = depth || 0;
    if (v === null || typeof v !== 'object' || depth > 12) return v;
    if (Array.isArray(v)) { const o = []; for (const x of v) o.push(await resolveParams(x, env, run, depth + 1)); return o; }
    if (v.$control) return E.ctlValue(v.$control, env);
    if (v.$ref) return evalNode(v.$ref, env, run);
    if (v.$keys) return E.keysAt(await resolveParams(v.$keys, env, run, depth + 1), env.time || 0);
    if (v.$expr) {
      const refs = {};
      for (const r of v.refs || []) refs[r] = /^c\d+$/.test(r) ? E.ctlValue(r, env) : await evalNode(r, env, run);
      for (const r of Object.keys(refs)) { const x = refs[r]; if (is(x, 'series')) refs[r] = E.sampleSeries(x, env.time || 0); else if (x && x[K] && x.t === 'number') refs[r] = x.v; }
      try { return E.evalExpr(v.$expr, v.refs || [], Object.assign({ refs }, env.exprScope || {}, { time: env.time || 0, fps: env.fps })); }
      catch (e) { run.warnings.push({ message: `expression ${v.$expr}: ${e.message}` }); return 0; }
    }
    if (v.$fn !== undefined) { const f = P.fns[v.$fn]; return f || null; }
    if (v.$component) return v;
    if (v.$view) return v;
    const o = {};
    for (const k of Object.keys(v)) o[k] = await resolveParams(v[k], env, run, depth + 1);
    return o;
  }
  E.resolveParams = resolveParams;

  async function evalNode(id, env, run) {
    if (env.bind && env.bind.has(id)) return env.bind.get(id).v;
    const n = P.byId.get(id);
    if (!n) throw new Error(`no node ${id}`);
    const sig = sigOf(id, env, run.sigMemo(env));
    const hit = CACHE.get(sig);
    if (hit) { hit.at = ++E.clock; run.hits++; return hit.v; }
    if (run.pending.has(sig)) return run.pending.get(sig);
    const p = (async () => {
      const spec = E.OPS[n.op] || E.OPS[n.op.replace(/^[a-z]+\./, '*.')] || (n.op.startsWith('sink.') ? E.OPS['sink.*'] : null) || (n.op.startsWith('gen.') && !E.OPS[n.op] ? E.OPS['gen.*'] : null);
      if (!spec) throw new Error(`${n.op} has no implementation in this engine yet`);
      const X = new Ctx(env, run); X.node = n; X.sig = sig;
      const I = {};
      if (!spec.lazy) for (const [k, d] of Object.entries(n.in || {})) if (typeof d === 'string') I[k] = await evalNode(d, env, run);
      const Pr = spec.rawParams ? n.params : await resolveParams(n.params, env, run);
      const t0 = performance.now();
      let v = await spec.impl(n, I, Pr, X);
      const ms = performance.now() - t0;
      run.times[id] = (run.times[id] || 0) + ms;
      run.computed++;
      if (v && typeof v === 'object' && v[K]) v.__sig = sig;
      cacheSet(sig, v);
      return v;
    })();
    run.pending.set(sig, p);
    try { return await p; }
    catch (e) {
      if (!e.node) { e.node = id; e.op = n.op; }
      throw e;
    }
    finally { run.pending.delete(sig); }
  }
  E.evalNode = evalNode;

  function newRun() {
    const memos = new WeakMap();
    return {
      warnings: [], notes: {}, times: {}, errors: {}, computed: 0, hits: 0, pending: new Map(),
      sigMemo(env) { let m = memos.get(env); if (!m) { m = new Map(); memos.set(env, m); } return m; },
    };
  }
  E.newRun = newRun;
  E.ctx = (env) => new Ctx(env, newRun());

  // a value with its own clock: comps, clips, audio
  E.timing = function (id, env, run) {
    const n = P.byId.get(id); if (!n) return null;
    const seen = new Set(); let best = null;
    (function walk(x) {
      if (seen.has(x)) return; seen.add(x);
      const m = P.byId.get(x); if (!m) return;
      if ((m.op === 'comp' || m.op === 'source.video' || m.op === 'source.camera') && !best) best = { dur: (m.params.duration && typeof m.params.duration === 'number') ? m.params.duration : m.op === 'comp' ? 4 : 6, fps: m.params.fps || 30, node: x };
      for (const d of P.deps.get(x) || []) walk(d);
    })(id);
    if (!best && isTimeDep(id)) best = { dur: 4, fps: 30, node: id };
    return best;
  };

  // ── rendering a request: evaluate what the views need, present it ─────
  // controls read from inside runtime lambdas (curve.at(x), slider.value): the values of the render in progress
  E.liveEnv = null;
  E.liveControl = id => E.ctlValue(id, E.liveEnv || {});
  E.controlAt = function (id, x) {
    const v = E.liveControl(id);
    if (Array.isArray(v) && Array.isArray(v[0])) { const pts = v.slice().sort((a, b) => a[0] - b[0]); if (x <= pts[0][0]) return pts[0][1]; for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * ((x - a[0]) / ((b[0] - a[0]) || 1)); } return pts[pts.length - 1][1]; }
    return typeof v === 'number' ? v * x : x;
  };
  E.render = async function (req) {
    const env = { controls: req.controls || {}, time: req.time || 0, sheet: req.sheet || {}, target: req.target || 'wasm', fps: 30, bind: null };
    E.liveEnv = env; env.strokes = req.strokes || {};
    const run = newRun();
    const out = { views: {}, errors: {}, notes: run.notes, times: run.times, warnings: run.warnings, timing: {}, transfer: [] };
    const t0 = performance.now();
    for (const item of req.items || []) {
      const key = item.key;
      try {
        // a comp's or clip's own duration may come from its params, resolved here (e.g. track.duration())
        const tm = E.timing(item.ref, env, run);
        if (tm) {
          const cn = P.byId.get(tm.node);
          if (cn && cn.params && cn.params.duration && typeof cn.params.duration === 'object') { try { const d = await resolveParams(cn.params.duration, env, run); tm.dur = (await E.need(d, 'number')) || tm.dur; } catch (e) { /* keep default */ } }
          out.timing[key] = tm;
        }
        const v = await evalNode(item.ref, Object.assign({}, env, { fps: tm ? tm.fps : 30 }), run);
        out.views[key] = await E.present(v, item, run, env, out.transfer);
      } catch (e) {
        out.errors[key] = { message: String(e && e.message || e), node: e && e.node, op: e && e.op };
      }
    }
    out.ms = Math.round(performance.now() - t0);
    out.computed = run.computed; out.hits = run.hits; out.wasmCalls = E.stats.wasmCalls; out.gpu = E.stats.gpuDispatches;
    return out;
  };

  // evaluate one node for the agent or a test, returning a compact description
  E.inspect = async function (ref, req) {
    const env = { controls: (req && req.controls) || {}, time: (req && req.time) || 0, sheet: {}, target: 'wasm', bind: null };
    const run = newRun();
    const v = await evalNode(ref, env, run);
    return E.describe(v);
  };
  E.describe = function (v) {
    if (v == null) return null;
    if (typeof v !== 'object') return v;
    if (!v[K]) return Array.isArray(v) ? v.slice(0, 20) : v;
    switch (v.t) {
      case 'image': { let r = 0, g = 0, b = 0, a = 0; const n = v.w * v.h, st = Math.max(1, Math.floor(n / 4000)); let k = 0; for (let i = 0; i < n; i += st) { r += v.d[i * 4]; g += v.d[i * 4 + 1]; b += v.d[i * 4 + 2]; a += v.d[i * 4 + 3]; k++; } return { kind: 'image', size: [v.w, v.h], mean: toHex([r / k, g / k, b / k]), alpha: +(a / k).toFixed(3) }; }
      case 'mask': { let s = 0; for (let i = 0; i < v.d.length; i++) s += v.d[i]; return { kind: 'mask', size: [v.w, v.h], coverage: +(s / v.d.length).toFixed(3) }; }
      case 'field': return { kind: 'field', size: [v.w, v.h], channels: v.names || v.ch };
      case 'shapes': return { kind: 'shapes', size: [v.w, v.h], items: v.items.length };
      case 'path': return { kind: 'path', length: v.d.length };
      case 'palette': return { kind: 'palette', colors: v.colors.map(c => c.hex || toHex(c.rgb)) };
      case 'audio': return { kind: 'audio', seconds: +(v.ch[0].length / v.sr).toFixed(2), sr: v.sr, channels: v.ch.length };
      case 'list': return { kind: 'list', items: v.items.length, first: E.describe(v.items[0]) };
      case 'series': return { kind: 'series', frames: v.frames.length, hop: v.hop };
      case 'table': return { kind: 'table', values: v.values };
      default: return { kind: v.t };
    }
  };
})(typeof self !== 'undefined' ? self : this);
