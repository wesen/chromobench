
/* Filmbench engine — a JS port of the spektrafilm spectral pipeline (film exposure → development →
   enlarger print → paper development → scan). Per-pixel work is table lookups; the spectral maths
   happens when a table is (re)built. Runs in a browser or in node. */
(function (root) {
'use strict';

const NW = 81, NLE = 256, LE0 = -3, LE1 = 4, DLE = (LE1 - LE0) / (NLE - 1);
const LN10 = Math.LN10;
const LOG10_2 = Math.log10(2);
const LUMA = [0.2126729, 0.7151522, 0.0721750];

/* ---------- small numerics ---------- */
function erf(x) {
  const ax = Math.abs(x);
  let r;
  if (ax < 2.5) {
    let term = ax, sum = ax; const x2 = ax * ax;
    for (let n = 1; n < 90; n++) { term *= -x2 / n; const t = term / (2 * n + 1); sum += t; if (Math.abs(t) < 1e-17) break; }
    r = 1.1283791670955126 * sum;
  } else {
    const t = 1 / (1 + 0.5 * ax);
    const erfc = t * Math.exp(-ax * ax - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    r = 1 - erfc;
  }
  return x < 0 ? -r : r;
}
const Phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
const srgbDecode = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const ENC_N = 8192; const ENC = new Float32Array(ENC_N + 2);
for (let i = 0; i < ENC.length; i++) { const v = i / ENC_N; ENC[i] = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; }
function encLut(v) { if (!(v > 0)) return 0; if (v >= 1) return 1; const f = v * ENC_N, i = f | 0, t = f - i; return ENC[i] + (ENC[i + 1] - ENC[i]) * t; }
const srgbEncode = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

/* np.interp semantics: xp increasing, clamped */
function npInterp(x, xp, fp) {
  const n = xp.length;
  if (x <= xp[0]) return fp[0];
  if (x >= xp[n - 1]) return fp[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xp[m] <= x) lo = m; else hi = m; }
  const t = (x - xp[lo]) / (xp[hi] - xp[lo]);
  return fp[lo] + t * (fp[hi] - fp[lo]);
}

/* ---------- data handling ---------- */
const cache = new WeakMap();
function store(data) {
  let s = cache.get(data);
  if (!s) { s = { prof: {}, ill: {}, lutF: {} }; cache.set(data, s); }
  return s;
}
function flat(a) { // nested [[..],[..]] → Float64Array row-major
  const rows = a.length, cols = Array.isArray(a[0]) ? a[0].length : 1;
  const out = new Float64Array(rows * cols);
  for (let i = 0; i < rows; i++) if (cols === 1) out[i] = a[i]; else for (let j = 0; j < cols; j++) out[i * cols + j] = a[i][j];
  return out;
}
function prof(data, stock) {
  const s = store(data);
  if (s.prof[stock]) return s.prof[stock];
  const r = data.profiles[stock];
  if (!r) throw new Error('unknown stock: ' + stock);
  const p = {
    stock, info: r, positive: r.type === 'positive',
    sens: (() => { const l = flat(r.logSens); const o = new Float64Array(l.length); for (let i = 0; i < l.length; i++) o[i] = Math.pow(10, l[i]); return o; })(),
    logSens: flat(r.logSens),
    chan: flat(r.chan), base: flat(r.base), curves: flat(r.curves),
    model: r.model,
  };
  p.curvesMin = [0, 0, 0]; p.curvesMax = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    let mn = Infinity, mx = -Infinity;
    for (let k = 0; k < NLE; k++) { const v = p.curves[k * 3 + c]; if (v < mn) mn = v; if (v > mx) mx = v; }
    p.curvesMin[c] = mn; p.curvesMax[c] = mx;
  }
  s.prof[stock] = p;
  return p;
}
function illum(data, name) {
  const s = store(data);
  if (!s.ill[name]) s.ill[name] = Float64Array.from(data.illuminant[name]);
  return s.ill[name];
}
/* film raw LUT (64×64×3 log2 values) — decoded by decodeLuts() or directly if lutQ already set */
function filmLut(data, stock) {
  const s = store(data);
  if (s.lutF[stock]) return s.lutF[stock];
  const r = data.profiles[stock];
  if (!r.lutQ) throw new Error('LUT for ' + stock + ' not decoded; call await FB.decodeLuts(data, inflate) first');
  const f = new Float32Array(r.lutQ.length);
  for (let i = 0; i < f.length; i++) f[i] = r.lutQ[i] / 1024;
  s.lutF[stock] = f;
  return f;
}
async function decodeLuts(data, inflate) { // inflate(Uint8Array) → Uint8Array | Promise
  for (const k of Object.keys(data.profiles)) {
    const r = data.profiles[k];
    if (r.lut && !r.lutQ) {
      const bin = typeof atob === 'function' ? Uint8Array.from(atob(r.lut), (c) => c.charCodeAt(0)) : Uint8Array.from(Buffer.from(r.lut, 'base64'));
      const raw = await inflate(bin);
      r.lutQ = new Int16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    }
  }
}

/* ---------- parameters ---------- */
function defaultParams(film, print) {
  return {
    film: film || 'kodak_portra_400', print: print || 'kodak_portra_endura',
    camera: { auto: true, method: 'center_weighted', ev: 0 },
    film_render: {
      gamma: 1, gamma_rgb: [1, 1, 1], speed_ev: [0, 0, 0], dye_scale: [1, 1, 1],
      dir: { active: true, amount: 1, same: 1, inter: 1, diffusion_um: 20 },
      grain: { active: true, amount: 1, size_um: 12, seed: 1 },
      halation: { active: true, amount: 1 },
      format_mm: 36,
    },
    enlarger: {
      illuminant: 'TH-KG3', c_neutral: null, m_neutral: null, y_neutral: null,
      c_shift: 0, m_shift: 0, y_shift: 0, print_exposure: 1, comp: true, normalize: true,
    },
    print_render: { morph: { active: false, gamma: 1, fast: 1, slow: 1, r: 1, g: 1, b: 1, exhaustion: 0 }, glare: 0.03 },
    output: { gamut: 'soft' }, // 'off' | 'clip' | 'soft'
  };
}
function mergeDeep(a, b) {
  if (b === undefined || b === null) return a;
  if (Array.isArray(b) || typeof b !== 'object') return b;
  const o = Array.isArray(a) ? a.slice() : Object.assign({}, a);
  for (const k of Object.keys(b)) o[k] = mergeDeep(a ? a[k] : undefined, b[k]);
  return o;
}
function withParams(base, patch) { return mergeDeep(base, patch); }

/* ---------- spectral helpers ---------- */
function enlargerIlluminant(data, name, cc) {
  const src = illum(data, name), F = data.dichroic;
  const t = cc.map((v) => Math.pow(10, -v / 100));
  const out = new Float64Array(NW);
  for (let i = 0; i < NW; i++) {
    let tot = 1;
    for (let k = 0; k < 3; k++) tot *= 1 - (1 - F[i][k]) * (1 - t[k]);
    out[i] = src[i] * tot;
  }
  return out;
}
function densitySpectral(chan, scale, cmy, base, out) {
  for (let i = 0; i < NW; i++) out[i] = chan[i * 3] * scale[0] * cmy[0] + chan[i * 3 + 1] * scale[1] * cmy[1] + chan[i * 3 + 2] * scale[2] * cmy[2] + base[i];
  return out;
}

/* ---------- film exposure: rgb → raw ---------- */
function rgbToRawFn(data, p, params) {
  const f = prof(data, params.film);
  const lut = filmLut(data, params.film);
  const M = data.rgb2xyz_cat16[f.info.ref];
  const sp = params.film_render.speed_ev.map((e) => Math.pow(2, e));
  return function (r, g, b, out, o) {
    const X = M[0][0] * r + M[0][1] * g + M[0][2] * b;
    const Y = M[1][0] * r + M[1][1] * g + M[1][2] * b;
    const Z = M[2][0] * r + M[2][1] * g + M[2][2] * b;
    let bs = X + Y + Z; if (!(bs > 0)) bs = 0;
    const d = bs > 1e-10 ? bs : 1e-10;
    const tx = X / d, ty = Y / d;
    let u = (1 - tx) * (1 - tx), v = ty / Math.max(1 - tx, 1e-10);
    u = u < 0 ? 0 : u > 1 ? 1 : u; v = v < 0 ? 0 : v > 1 ? 1 : v;
    const fu = u * 63, fv = v * 63;
    let i0 = Math.floor(fu), j0 = Math.floor(fv);
    if (i0 > 62) i0 = 62; if (j0 > 62) j0 = 62;
    const a = fu - i0, bb = fv - j0;
    const k00 = (i0 * 64 + j0) * 3, k01 = k00 + 3, k10 = k00 + 192, k11 = k10 + 3;
    for (let c = 0; c < 3; c++) {
      const l2 = lut[k00 + c] * (1 - a) * (1 - bb) + lut[k01 + c] * (1 - a) * bb + lut[k10 + c] * a * (1 - bb) + lut[k11 + c] * a * bb;
      out[o + c] = Math.pow(2, l2) * bs * sp[c];
    }
  };
}

/* ---------- development: density curves ---------- */
function filmCurveTables(data, params) {
  const f = prof(data, params.film);
  const dc = f.curves, n = NLE;
  const norm = new Float64Array(n * 3);
  for (let c = 0; c < 3; c++) for (let k = 0; k < n; k++) norm[k * 3 + c] = dc[k * 3 + c] - f.curvesMin[c];
  const fr = params.film_render;
  const gam = [0, 1, 2].map((c) => fr.gamma * fr.gamma_rgb[c]);
  const d = fr.dir;
  const positive = f.positive;
  // DIR matrix (donor row → receiver column)
  let M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let dirActive = !!d.active;
  if (dirActive) {
    let same, r2gb, g2rb, b2rg;
    if (positive) {
      same = [0.12, 0.08, 0.06]; r2gb = [0.12, 0.06]; g2rb = [0.08, 0.06]; b2rg = [0.06, 0.06];
      if (params.film === 'fujifilm_velvia_100') { same = [0.108, 0.072, 0.054]; r2gb = [0.108, 0.054]; g2rb = [0.072, 0.054]; b2rg = [0.054, 0.054]; }
      if (params.film === 'fujifilm_provia_100f') { same = [0.156, 0.104, 0.078]; r2gb = [0.156, 0.078]; g2rb = [0.104, 0.078]; b2rg = [0.078, 0.078]; }
    } else {
      same = [0.336, 0.319, 0.273]; r2gb = [0.353, 0.302]; g2rb = [0.154, 0.353]; b2rg = [0.168, 0.226];
    }
    M = [[same[0] * d.same, r2gb[0] * d.inter, r2gb[1] * d.inter], [g2rb[0] * d.inter, same[1] * d.same, g2rb[1] * d.inter], [b2rg[0] * d.inter, b2rg[1] * d.inter, same[2] * d.same]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] *= d.amount;
  }
  const dmax = [0, 0, 0];
  for (let c = 0; c < 3; c++) { let mx = -Infinity; for (let k = 0; k < n; k++) mx = Math.max(mx, norm[k * 3 + c]); dmax[c] = mx; }
  // curves before DIR
  const dc0 = new Float64Array(n * 3);
  if (dirActive) {
    const silver = new Float64Array(n * 3);
    for (let k = 0; k < n; k++) for (let c = 0; c < 3; c++) silver[k * 3 + c] = positive ? dmax[c] - norm[k * 3 + c] : norm[k * 3 + c];
    // NB: python uses nanmax of the *normalized* curves here
    const le0 = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
    for (let k = 0; k < n; k++) {
      const x = LE0 + k * DLE;
      for (let m = 0; m < 3; m++) le0[m][k] = x - (silver[k * 3] * M[0][m] + silver[k * 3 + 1] * M[1][m] + silver[k * 3 + 2] * M[2][m]);
    }
    const LEarr = new Float64Array(n); for (let k = 0; k < n; k++) LEarr[k] = LE0 + k * DLE;
    for (let m = 0; m < 3; m++) {
      const col = new Float64Array(n); for (let k = 0; k < n; k++) col[k] = norm[k * 3 + m];
      const ncol = positive ? col.map((v) => -v) : col;
      for (let k = 0; k < n; k++) { const v = npInterp(LEarr[k], le0[m], ncol); dc0[k * 3 + m] = positive ? -v : v; }
    }
  } else dc0.set(norm);
  return { norm, dc0, gam, M, dirActive, positive, dmax, raw: dc, rawMin: f.curvesMin, rawMax: f.curvesMax };
}
/* clamped linear lookup into a (NLE×3) table with x_k = LE_k/gamma */
function curveEval(tab, c, g, v) {
  const idx = (v * g - LE0) / DLE;
  if (!(idx > 0)) return tab[c];
  if (idx >= NLE - 1) return tab[(NLE - 1) * 3 + c];
  const i = Math.floor(idx), t = idx - i;
  return tab[i * 3 + c] * (1 - t) + tab[(i + 1) * 3 + c] * t;
}

/* ---------- paper curves (cdf model + coupled-gamma morph) ---------- */
function layerCdf(z, positive, mix) {
  const s = positive ? -z : z;
  let c = Phi(s);
  if (mix > 0) {
    const W = 0.5 * Math.LN2 * Math.sqrt(2 * Math.PI), L = -Math.log(Math.log(2));
    c = (1 - mix) * c + mix * Math.exp(-Math.exp(-(s / W + L)));
  }
  return c;
}
function channelDensity(x, cen, amp, sig, positive, mix) {
  let t = 0;
  for (let i = 0; i < cen.length; i++) t += amp[i] * layerCdf((x - cen[i]) / sig[i], positive, mix ? mix[i] : 0);
  return t;
}
function paperCurves(prf, morph) {
  const m = prf.model, positive = prf.positive, out = new Float64Array(NLE * 3);
  for (let c = 0; c < 3; c++) {
    let cen = m.centers[c].slice(), amp = m.amps[c].slice(), sig = m.sigmas[c].slice();
    let mix = null;
    if (morph && morph.active) {
      const order = cen.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).map((e) => e[1]);
      const iF = order[0], iM = order[order.length >> 1], iS = order[order.length - 1];
      const gch = [morph.r, morph.g, morph.b][c];
      const gF = morph.gamma * gch * morph.fast, gM = morph.gamma * gch * morph.slow, gS = gM;
      if (!(gF > 0 && gM > 0)) throw new Error('print morph: effective gamma must be > 0');
      const apply = (i, g) => { sig[i] = Math.max(sig[i] / g, 0.05); cen[i] = cen[i] / g; };
      apply(iF, gF); apply(iM, gM); apply(iS, gS);
      mix = cen.map(() => morph.exhaustion);
      if (morph.exhaustion > 0) {
        const tgt = channelDensity(0, cen, amp, sig, positive, null);
        const res = (off) => channelDensity(0, cen.map((v) => v + off), amp, sig, positive, mix) - tgt;
        let lo = -0.25, hi = 0.25, rl = res(lo), rh = res(hi), found = false;
        for (let it = 0; it < 12 && !found; it++) {
          if (rl * rh < 0) { found = true; break; }
          lo *= 2; hi *= 2; rl = res(lo); rh = res(hi);
        }
        let off = 0;
        if (found) { for (let it = 0; it < 70; it++) { const mid = 0.5 * (lo + hi), rm = res(mid); if (rl * rm <= 0) { hi = mid; rh = rm; } else { lo = mid; rl = rm; } } off = 0.5 * (lo + hi); }
        cen = cen.map((v) => v + off);
      }
    }
    for (let k = 0; k < NLE; k++) out[k * 3 + c] = channelDensity(LE0 + k * DLE, cen, amp, sig, positive, mix);
  }
  return out;
}

/* ---------- 3D LUT ---------- */
function lerpIdx(v, lo, hi, N) {
  let t = (v - lo) / (hi - lo) * (N - 1);
  if (!(t > 0)) t = 0; else if (t > N - 1 - 1e-9) t = N - 1 - 1e-9;
  return t;
}
function lut3(lut, N, nc, fx, fy, fz, out, o) {
  const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
  const a = fx - i, b = fy - j, c = fz - k;
  const sj = N * nc, si = N * N * nc;
  const p000 = i * si + j * sj + k * nc;
  const w000 = (1 - a) * (1 - b) * (1 - c), w001 = (1 - a) * (1 - b) * c, w010 = (1 - a) * b * (1 - c), w011 = (1 - a) * b * c;
  const w100 = a * (1 - b) * (1 - c), w101 = a * (1 - b) * c, w110 = a * b * (1 - c), w111 = a * b * c;
  for (let q = 0; q < nc; q++) {
    const p = p000 + q;
    out[o + q] = lut[p] * w000 + lut[p + nc] * w001 + lut[p + sj] * w010 + lut[p + sj + nc] * w011 +
                 lut[p + si] * w100 + lut[p + si + nc] * w101 + lut[p + si + sj] * w110 + lut[p + si + sj + nc] * w111;
  }
}

/* transmittance tables for a grid: T[k][n][λ] = 10^(-chan[λ][k]·scale_k·cmy_n) */
function transTables(chan, scale, lo, hi, N) {
  const T = [0, 1, 2].map(() => new Float64Array(N * NW));
  for (let k = 0; k < 3; k++) for (let n = 0; n < N; n++) {
    const cmy = lo[k] + (hi[k] - lo[k]) * n / (N - 1);
    for (let i = 0; i < NW; i++) T[k][n * NW + i] = Math.exp(-LN10 * chan[i * 3 + k] * scale[k] * cmy);
  }
  return T;
}

/* ---------- plan (compiled params) ---------- */
function neutralFilters(data, params) {
  const e = params.enlarger;
  let db = null;
  try { db = data.neutral_filters[params.print][params.film]; } catch (_) { /* none */ }
  const d = db || [0, 65, 55];
  return [e.c_neutral != null ? e.c_neutral : d[0], e.m_neutral != null ? e.m_neutral : d[1], e.y_neutral != null ? e.y_neutral : d[2]];
}
function isPositive(data, params) { return prof(data, params.film).positive; }

const LUT1_N = 25, LUT2_N = 33;

function buildPlan(data, params, prev) {
  const f = prof(data, params.film);
  const scan = f.positive;                    // positive film is scanned directly, negatives are printed
  const pr = scan ? null : prof(data, params.print);
  const fr = params.film_render, en = params.enlarger;
  const key = (o) => JSON.stringify(o);
  const plan = { params, scan, film: f, print: pr, keys: {} };
  const memo = (name, k, build) => {
    if (prev && prev.keys[name] === k) { plan[name] = prev[name]; plan.keys[name] = k; return; }
    plan[name] = build(); plan.keys[name] = k;
  };
  memo('tabs', key([params.film, fr.gamma, fr.gamma_rgb, fr.dir]), () => filmCurveTables(data, params));
  plan.rawFn = rgbToRawFn(data, plan, params);
  plan.rawM = data.rgb2xyz_cat16[f.info.ref]; plan.rawLut = filmLut(data, params.film);
  plan.speedLog = fr.speed_ev.map((e) => e * LOG10_2);

  const nf = neutralFilters(data, params);
  const cc = [nf[0] + en.c_shift, nf[1] + en.m_shift, nf[2] + en.y_shift];
  plan.cc = cc;
  // midgray densities for print exposure normalisation (unnormalised curves, as in spektrafilm)
  const midDensity = (rgb) => {
    const raw = new Float64Array(3); plan.rawFn(rgb, rgb, rgb, raw, 0);
    const cmy = [0, 0, 0];
    for (let c = 0; c < 3; c++) cmy[c] = curveEval(plan.tabs.raw, c, plan.tabs.gam[c], Math.log10(raw[c] + 1e-10));
    const d = new Float64Array(NW); densitySpectral(f.chan, fr.dye_scale, cmy, f.base, d); return d;
  };
  plan.midgray = null;
  if (!scan) {
    const printSens = pr.sens;
    const pk = key([params.film, params.print, fr.gamma, fr.gamma_rgb, fr.speed_ev, fr.dye_scale, fr.dir, params.camera.ev, en.illuminant, cc, en.comp, en.normalize]);
    memo('lut1', pk, () => {
      const lights = enlargerIlluminant(data, en.illuminant, cc);
      const factorFor = (dens) => {
        let g = 0;
        const raw = [0, 0, 0];
        for (let c = 0; c < 3; c++) { let s = 0; for (let i = 0; i < NW; i++) s += Math.pow(10, -dens[i]) * lights[i] * printSens[i * 3 + c]; raw[c] = Math.max(s, 1e-10); g += Math.log(raw[c]); }
        return 1 / Math.exp(g / 3);
      };
      const fM = factorFor(midDensity(0.184));
      const fC = en.comp ? factorFor(midDensity(0.184 * Math.pow(2, params.camera.ev))) : 1;
      let factor = 1;
      if (en.comp && !en.normalize) factor = fC / fM; else if (en.normalize && en.comp) factor = fC; else if (en.normalize && !en.comp) factor = fM;
      const N = LUT1_N, lo = [-0.03, -0.03, -0.03], hi = f.curvesMax.slice();
      const T = transTables(f.chan, fr.dye_scale, lo, hi, N);
      const lut = new Float32Array(N * N * N * 3);
      const bl = new Float64Array(NW); for (let i = 0; i < NW; i++) bl[i] = Math.pow(10, -f.base[i]) * lights[i];
      let o = 0;
      for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) for (let c = 0; c < N; c++) {
        const r = [0, 0, 0];
        for (let i = 0; i < NW; i++) {
          const L = bl[i] * T[0][a * NW + i] * T[1][b * NW + i] * T[2][c * NW + i];
          r[0] += L * printSens[i * 3]; r[1] += L * printSens[i * 3 + 1]; r[2] += L * printSens[i * 3 + 2];
        }
        for (let q = 0; q < 3; q++) lut[o++] = Math.log10(Math.max(r[q] * factor, 0) + 1e-10);
      }
      return { lut, N, lo, hi };
    });
    memo('paper', key([params.print, params.print_render.morph]), () => paperCurves(pr, params.print_render.morph));
  }
  // scan LUT: dye cmy → log10 XYZ
  const sf = scan ? f : pr;
  const view = sf.info.view;
  const N2 = params.lut2_n || LUT2_N;
  const sk = key([scan ? params.film : params.print, scan ? fr.dye_scale : null, N2]);
  memo('lut2', sk, () => {
    const N = N2;
    const scale = scan ? fr.dye_scale : [1, 1, 1];
    const lo = scan ? [-0.03, -0.03, -0.03] : pr.curvesMin.slice();
    const hi = scan ? f.curvesMax.slice() : pr.curvesMax.slice();
    const il = illum(data, view), cmf = data.cmf;
    let norm = 0; for (let i = 0; i < NW; i++) norm += il[i] * cmf[i][1];
    const T = transTables(sf.chan, scale, lo, hi, N);
    const bl = new Float64Array(NW); for (let i = 0; i < NW; i++) bl[i] = Math.pow(10, -sf.base[i]) * il[i] / norm;
    const lut = new Float32Array(N * N * N * 3);
    let o = 0;
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) for (let c = 0; c < N; c++) {
      let X = 0, Y = 0, Z = 0;
      for (let i = 0; i < NW; i++) { const L = bl[i] * T[0][a * NW + i] * T[1][b * NW + i] * T[2][c * NW + i]; X += L * cmf[i][0]; Y += L * cmf[i][1]; Z += L * cmf[i][2]; }
      lut[o++] = Math.log10(Math.max(X, 0) + 1e-10); lut[o++] = Math.log10(Math.max(Y, 0) + 1e-10); lut[o++] = Math.log10(Math.max(Z, 0) + 1e-10);
    }
    return { lut, N, lo, hi };
  });
  plan.view = view;
  plan.xyz2rgb = data.xyz2rgb[view];
  plan.illXYZ = data.illuminant_xyz[view];
  plan.glare = scan ? 0 : params.print_render.glare / 100;
  return plan;
}

/* ---------- gamut handling ---------- */
function gamutPixel(rgb, o, mode) {
  let r = rgb[o], g = rgb[o + 1], b = rgb[o + 2];
  if (mode === 'soft') {
    const Y = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b;
    const mn = Math.min(r, g, b);
    if (mn < 0) {
      if (Y <= 0) { r = g = b = 0; } else { const k = Y / (Y - mn); r = Y + (r - Y) * k; g = Y + (g - Y) * k; b = Y + (b - Y) * k; }
    }
    const mx = Math.max(r, g, b), t = 0.8;
    if (mx > t) {
      const s = (mx - t) / (1 - t), p = 3;
      const m2 = t + (1 - t) * s / Math.pow(1 + Math.pow(s, p), 1 / p);
      const k = m2 / mx; r *= k; g *= k; b *= k;
    }
  }
  rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b;
}

/* ---------- spatial helpers ---------- */
function gaussBlurPlane(src, w, h, nc, sigma) {
  if (!(sigma > 0.25)) return src;
  const rad = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(2 * rad + 1); let s = 0;
  for (let i = -rad; i <= rad; i++) { k[i + rad] = Math.exp(-0.5 * i * i / (sigma * sigma)); s += k[i + rad]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const row = y * w * nc;
    for (let x = 0; x < w; x++) {
      const interior = x >= rad && x < w - rad;
      for (let c = 0; c < nc; c++) {
        let a = 0;
        if (interior) { let p = row + (x - rad) * nc + c; for (let i = 0; i <= 2 * rad; i++, p += nc) a += src[p] * k[i]; }
        else for (let i = -rad; i <= rad; i++) { let xx = x + i; xx = xx < 0 ? 0 : xx >= w ? w - 1 : xx; a += src[row + xx * nc + c] * k[i + rad]; }
        tmp[row + x * nc + c] = a;
      }
    }
  }
  const stride = w * nc;
  for (let y = 0; y < h; y++) {
    const interior = y >= rad && y < h - rad;
    for (let x = 0; x < w; x++) for (let c = 0; c < nc; c++) {
      let a = 0;
      if (interior) { let p = (y - rad) * stride + x * nc + c; for (let i = 0; i <= 2 * rad; i++, p += stride) a += tmp[p] * k[i]; }
      else for (let i = -rad; i <= rad; i++) { let yy = y + i; yy = yy < 0 ? 0 : yy >= h ? h - 1 : yy; a += tmp[yy * stride + x * nc + c] * k[i + rad]; }
      out[y * stride + x * nc + c] = a;
    }
  }
  return out;
}
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* ---------- auto exposure ---------- */
function autoExposureEv(src, w, h, method) {
  const n = w * h, Y = new Float32Array(n);
  for (let i = 0; i < n; i++) Y[i] = LUMA[0] * src[i * 3] + LUMA[1] * src[i * 3 + 1] + LUMA[2] * src[i * 3 + 2];
  const mx = Math.max(w, h), nw = w / mx, nh = h / mx;
  const coord = (x, y) => [(x / w - 0.5) * nw, (y / h - 0.5) * nh];
  let e = 1;
  if (method === 'average') { let s = 0; for (let i = 0; i < n; i++) s += Y[i]; e = s / n / 0.184; }
  else if (method === 'median') { const a = Float32Array.from(Y).sort(); e = ((n % 2) ? a[n >> 1] : 0.5 * (a[n / 2 - 1] + a[n / 2])) / 0.184; }
  else if (method === 'highlight_weighted') { let sw = 0, s = 0; for (let i = 0; i < n; i++) { sw += Y[i] * Y[i]; s += Y[i] * Y[i] * Y[i]; } e = (sw < 1e-12 ? 1 : s / sw) / 0.184; }
  else if (method === 'partial') {
    let s = 0, c = 0; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [cx, cy] = coord(x, y); if (Math.hypot(cx, cy) < 0.15) { s += Y[y * w + x]; c++; } }
    if (!c) { for (let i = 0; i < n; i++) s += Y[i]; c = n; } e = s / c / 0.184;
  } else { // center_weighted
    let s = 0, ws = 0; const sg = 0.2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [cx, cy] = coord(x, y); const m = Math.exp(-(cx * cx + cy * cy) / (2 * sg * sg)); s += Y[y * w + x] * m; ws += m; }
    e = s / ws / 0.184;
  }
  const ev = -Math.log2(e);
  return Number.isFinite(ev) ? ev : 0;
}


/* fast path: no spatial effects, no taps → one fused per-pixel loop */
function renderFused(plan, src, w, h, gain) {
  const P = plan.params, n = w * h, T = plan.tabs, f = plan.film;
  const M = plan.rawM, lut = plan.rawLut, sp = plan.speedLog, gm = T.gam, positive = T.positive;
  const norm = T.norm, dc0 = T.dc0, dmax = T.dmax, DM = T.M, dir = T.dirActive;
  const out = new Float32Array(n * 3), mode = P.output.gamut;
  const L2 = plan.lut2, glare = plan.glare, ix = plan.illXYZ, M2 = plan.xyz2rgb;
  const L1 = plan.lut1, paper = plan.paper, pe = plan.scan ? 0 : Math.log10(P.enlarger.print_exposure);
  const xyz = [0, 0, 0], v1 = [0, 0, 0], lr = [0, 0, 0], d = [0, 0, 0], d2 = [0, 0, 0];
  const rgbTmp = new Float32Array(3);
  const m00 = M[0][0], m01 = M[0][1], m02 = M[0][2], m10 = M[1][0], m11 = M[1][1], m12 = M[1][2], m20 = M[2][0], m21 = M[2][1], m22 = M[2][2];
  for (let i = 0; i < n; i++) {
    const r = src[i * 3] * gain, g = src[i * 3 + 1] * gain, b = src[i * 3 + 2] * gain;
    const X = m00 * r + m01 * g + m02 * b, Y = m10 * r + m11 * g + m12 * b, Z = m20 * r + m21 * g + m22 * b;
    let bs = X + Y + Z; if (!(bs > 0)) bs = 0;
    const dd = bs > 1e-10 ? bs : 1e-10;
    const tx = X / dd, ty = Y / dd;
    let u = (1 - tx) * (1 - tx), v = ty / Math.max(1 - tx, 1e-10);
    u = u < 0 ? 0 : u > 1 ? 1 : u; v = v < 0 ? 0 : v > 1 ? 1 : v;
    const fu = u * 63, fv = v * 63;
    let i0 = fu | 0, j0 = fv | 0; if (i0 > 62) i0 = 62; if (j0 > 62) j0 = 62;
    const a = fu - i0, bb = fv - j0;
    const k00 = (i0 * 64 + j0) * 3, k01 = k00 + 3, k10 = k00 + 192, k11 = k10 + 3;
    const w00 = (1 - a) * (1 - bb), w01 = (1 - a) * bb, w10 = a * (1 - bb), w11 = a * bb;
    const lb = Math.log10(dd);
    for (let c = 0; c < 3; c++) {
      const l2 = lut[k00 + c] * w00 + lut[k01 + c] * w01 + lut[k10 + c] * w10 + lut[k11 + c] * w11;
      let l = l2 * LOG10_2 + lb + sp[c];
      if (l < -7) l = Math.log10(Math.pow(10, l) * (bs > 0 ? 1 : 0) + 1e-10);
      lr[c] = l;
    }
    // develop
    for (let c = 0; c < 3; c++) d[c] = curveEval(norm, c, gm[c], lr[c]);
    if (dir) {
      const s0 = positive ? dmax[0] - d[0] : d[0], s1 = positive ? dmax[1] - d[1] : d[1], s2 = positive ? dmax[2] - d[2] : d[2];
      for (let c = 0; c < 3; c++) d2[c] = curveEval(dc0, c, gm[c], lr[c] - (s0 * DM[0][c] + s1 * DM[1][c] + s2 * DM[2][c]));
    } else { d2[0] = d[0]; d2[1] = d[1]; d2[2] = d[2]; }
    let c0, c1, c2;
    if (plan.scan) { c0 = d2[0]; c1 = d2[1]; c2 = d2[2]; }
    else {
      lut3(L1.lut, L1.N, 3, lerpIdx(d2[0], L1.lo[0], L1.hi[0], L1.N), lerpIdx(d2[1], L1.lo[1], L1.hi[1], L1.N), lerpIdx(d2[2], L1.lo[2], L1.hi[2], L1.N), v1, 0);
      c0 = curveEval(paper, 0, 1, v1[0] + pe); c1 = curveEval(paper, 1, 1, v1[1] + pe); c2 = curveEval(paper, 2, 1, v1[2] + pe);
    }
    lut3(L2.lut, L2.N, 3, lerpIdx(c0, L2.lo[0], L2.hi[0], L2.N), lerpIdx(c1, L2.lo[1], L2.hi[1], L2.N), lerpIdx(c2, L2.lo[2], L2.hi[2], L2.N), xyz, 0);
    const XX = Math.exp(xyz[0] * LN10) + glare * ix[0], YY = Math.exp(xyz[1] * LN10) + glare * ix[1], ZZ = Math.exp(xyz[2] * LN10) + glare * ix[2];
    rgbTmp[0] = M2[0][0] * XX + M2[0][1] * YY + M2[0][2] * ZZ;
    rgbTmp[1] = M2[1][0] * XX + M2[1][1] * YY + M2[1][2] * ZZ;
    rgbTmp[2] = M2[2][0] * XX + M2[2][1] * YY + M2[2][2] * ZZ;
    gamutPixel(rgbTmp, 0, mode);
    out[i * 3] = encLut(rgbTmp[0]); out[i * 3 + 1] = encLut(rgbTmp[1]); out[i * 3 + 2] = encLut(rgbTmp[2]);
  }
  return out;
}

/* ---------- render, split into stages ---------- */
/* Each stage takes the previous stage's array and returns a new one, so the v2 runtime can cache and share them.
   src: Float32Array linear sRGB (w*h*3). */
function pixelUmOf(plan, w, h) { return (plan.params.film_render.format_mm * 1000) / Math.max(w, h); }
function needsSpatial(plan, w, h) {
  const fr = plan.params.film_render, T = plan.tabs, pixelUm = pixelUmOf(plan, w, h);
  return (fr.halation.active && fr.halation.amount > 0 && pixelUm < 65 / 0.25) || (fr.grain.active && fr.grain.amount > 0) || (T.dirActive && fr.dir.diffusion_um / pixelUm > 0.25);
}
/* scene → log10 raw exposure (the log_e_film tap) */
function stageExpose(plan, src, w, h, spatial) {
  const P = plan.params, n = w * h, fr = P.film_render;
  const pixelUm = pixelUmOf(plan, w, h);
  const autoEv = P.camera.auto ? autoExposureEv(src, w, h, P.camera.method) : 0;
  const gain = Math.pow(2, autoEv + P.camera.ev);
  const raw = new Float32Array(n * 3), tmp = new Float64Array(3);
  for (let i = 0; i < n; i++) {
    plan.rawFn(src[i * 3] * gain, src[i * 3 + 1] * gain, src[i * 3 + 2] * gain, tmp, 0);
    raw[i * 3] = tmp[0]; raw[i * 3 + 1] = tmp[1]; raw[i * 3 + 2] = tmp[2];
  }
  // halation (simplified): bright areas bleed back through the base; red-biased by the antihalation preset
  if (spatial && fr.halation.active) {
    const info = plan.film.info;
    const strength = { 'still:strong': [0.015, 0.005, 0], 'still:weak': [0.08, 0.02, 0], 'still:no': [0.3, 0.1, 0.015], 'cine:strong': [0.015, 0.005, 0], 'cine:weak': [0.08, 0.02, 0], 'cine:no': [0.3, 0.1, 0.015] }[info.use + ':' + info.antihalation] || [0.015, 0.005, 0];
    const sig = (info.use === 'cine' ? 50 : 65) / pixelUm;
    if (sig > 0.25 && fr.halation.amount > 0) {
      const bl = gaussBlurPlane(raw, w, h, 3, sig);
      for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { const s = Math.min(strength[c] * fr.halation.amount, 0.95); raw[i * 3 + c] = (1 - s) * raw[i * 3 + c] + s * bl[i * 3 + c]; }
    }
  }
  const logRaw = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) logRaw[i] = Math.log10(Math.max(raw[i], 0) + 1e-10);
  return { data: logRaw, ev: autoEv + P.camera.ev, autoEv };
}
/* log raw → dye density (the cmy_film tap): DIR couplers, then grain */
function stageDevelop(plan, logRaw, w, h, spatial) {
  const P = plan.params, n = w * h, fr = P.film_render, T = plan.tabs, pixelUm = pixelUmOf(plan, w, h);
  const cmy = new Float32Array(n * 3), gm = T.gam;
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) cmy[i * 3 + c] = curveEval(T.norm, c, gm[c], logRaw[i * 3 + c]);
  let dens = cmy;
  if (T.dirActive) {
    const M = T.M;
    let corr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const d0 = cmy[i * 3], d1 = cmy[i * 3 + 1], d2 = cmy[i * 3 + 2];
      const s0 = T.positive ? T.dmax[0] - d0 : d0, s1 = T.positive ? T.dmax[1] - d1 : d1, s2 = T.positive ? T.dmax[2] - d2 : d2;
      for (let m = 0; m < 3; m++) corr[i * 3 + m] = s0 * M[0][m] + s1 * M[1][m] + s2 * M[2][m];
    }
    const dsig = fr.dir.diffusion_um / pixelUm;
    if (spatial && dsig > 0.25) corr = gaussBlurPlane(corr, w, h, 3, dsig);
    dens = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) dens[i * 3 + c] = curveEval(T.dc0, c, gm[c], logRaw[i * 3 + c] - corr[i * 3 + c]);
  }
  if (spatial && fr.grain.active && fr.grain.amount > 0) {
    const rnd = mulberry32(fr.grain.seed | 0);
    const rms48 = 0.0045 * fr.grain.amount; // RMS granularity at a 48 µm aperture, mid density
    const sigN = rms48 * 48 / pixelUm;
    let noise = new Float32Array(n * 3);
    for (let i = 0; i < noise.length; i += 2) { const u = Math.max(rnd(), 1e-12), v = rnd(), r = Math.sqrt(-2 * Math.log(u)); noise[i] = r * Math.cos(2 * Math.PI * v); if (i + 1 < noise.length) noise[i + 1] = r * Math.sin(2 * Math.PI * v); }
    const gs = fr.grain.size_um / pixelUm;
    if (gs > 0.4) { noise = gaussBlurPlane(noise, w, h, 3, gs * 0.5); let s2 = 0; for (let i = 0; i < noise.length; i++) s2 += noise[i] * noise[i]; const k = 1 / Math.sqrt(s2 / noise.length); for (let i = 0; i < noise.length; i++) noise[i] *= k; }
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) {
      const d = dens[i * 3 + c], dm = T.dmax[c];
      const q = Math.sqrt(Math.max((d + 0.04) * (1 - Math.min(d / dm, 1)), 0) / 0.5);
      out[i * 3 + c] = d + noise[i * 3 + c] * sigN * 1.6 * q;
    }
    dens = out;
  }
  return dens;
}
/* film density → print log exposure (the log_e_print tap). pe10: log10 of the print exposure; default is the param. */
function stageEnlarge(plan, dens, n, pe10) {
  const L1 = plan.lut1, pe = pe10 === undefined ? Math.log10(plan.params.enlarger.print_exposure) : pe10;
  const lp = new Float32Array(n * 3), v = new Float64Array(3);
  for (let i = 0; i < n; i++) {
    const fx = lerpIdx(dens[i * 3], L1.lo[0], L1.hi[0], L1.N), fy = lerpIdx(dens[i * 3 + 1], L1.lo[1], L1.hi[1], L1.N), fz = lerpIdx(dens[i * 3 + 2], L1.lo[2], L1.hi[2], L1.N);
    lut3(L1.lut, L1.N, 3, fx, fy, fz, v, 0);
    for (let c = 0; c < 3; c++) lp[i * 3 + c] = Math.log10(Math.pow(10, v[c] + pe) + 1e-10);
  }
  return lp;
}
/* print log exposure → paper dye density (the cmy_print tap) */
function stagePaper(plan, lp, n) {
  const paper = plan.paper, cp = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) cp[i * 3 + c] = curveEval(paper, c, 1, lp[i * 3 + c]);
  return cp;
}
/* dye density → display sRGB, encoded 0..1 (the out tap) */
function stageScan(plan, dens, n) {
  const rgbOut = new Float32Array(n * 3), xyz = new Float64Array(3), mode = plan.params.output.gamut;
  const L2 = plan.lut2, glare = plan.glare, ix = plan.illXYZ, M2 = plan.xyz2rgb;
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const fx = lerpIdx(dens[o], L2.lo[0], L2.hi[0], L2.N), fy = lerpIdx(dens[o + 1], L2.lo[1], L2.hi[1], L2.N), fz = lerpIdx(dens[o + 2], L2.lo[2], L2.hi[2], L2.N);
    lut3(L2.lut, L2.N, 3, fx, fy, fz, xyz, 0);
    const X = Math.pow(10, xyz[0]) + glare * ix[0], Y = Math.pow(10, xyz[1]) + glare * ix[1], Z = Math.pow(10, xyz[2]) + glare * ix[2];
    rgbOut[o] = M2[0][0] * X + M2[0][1] * Y + M2[0][2] * Z;
    rgbOut[o + 1] = M2[1][0] * X + M2[1][1] * Y + M2[1][2] * Z;
    rgbOut[o + 2] = M2[2][0] * X + M2[2][1] * Y + M2[2][2] * Z;
  }
  for (let i = 0; i < n; i++) {
    gamutPixel(rgbOut, i * 3, mode);
    for (let c = 0; c < 3; c++) { let x = rgbOut[i * 3 + c]; x = x < 0 ? 0 : x > 1 ? 1 : x; rgbOut[i * 3 + c] = srgbEncode(x); }
  }
  return rgbOut;
}

/* render: the stages in a row. Returns { rgb, ev, autoEv, taps }. */
function render(plan, src, w, h, opts) {
  opts = opts || {};
  const P = plan.params, n = w * h, taps = {};
  const want = (t) => opts.taps && opts.taps.indexOf(t) >= 0;
  const spatial = opts.spatial !== false;
  if (!opts.taps && !(spatial && needsSpatial(plan, w, h))) {
    const autoEv = P.camera.auto ? autoExposureEv(src, w, h, P.camera.method) : 0;
    const rgb = renderFused(plan, src, w, h, Math.pow(2, autoEv + P.camera.ev));
    return { rgb, ev: autoEv + P.camera.ev, autoEv, taps };
  }
  const ex = stageExpose(plan, src, w, h, spatial);
  if (want('log_e_film')) taps.log_e_film = ex.data;
  const dens = stageDevelop(plan, ex.data, w, h, spatial);
  if (want('cmy_film')) taps.cmy_film = dens;
  let rgb;
  if (plan.scan) rgb = stageScan(plan, dens, n);
  else {
    const lp = stageEnlarge(plan, dens, n);
    if (want('log_e_print')) taps.log_e_print = lp;
    const cp = stagePaper(plan, lp, n);
    if (want('cmy_print')) taps.cmy_print = cp;
    rgb = stageScan(plan, cp, n);
  }
  return { rgb, ev: ex.ev, autoEv: ex.autoEv, taps };
}

/* ---------- utilities used by the UI ---------- */
function toRGBA8(rgb, n) {
  const o = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) { o[i * 4] = rgb[i * 3] * 255 + 0.5; o[i * 4 + 1] = rgb[i * 3 + 1] * 255 + 0.5; o[i * 4 + 2] = rgb[i * 3 + 2] * 255 + 0.5; o[i * 4 + 3] = 255; }
  return o;
}
function fromRGBA8(px, n) {
  const o = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { o[i * 3] = srgbDecode(px[i * 4] / 255); o[i * 3 + 1] = srgbDecode(px[i * 4 + 1] / 255); o[i * 3 + 2] = srgbDecode(px[i * 4 + 2] / 255); }
  return o;
}
/* curve tables for plotting */
function curvesFor(plan) {
  const out = { le: Array.from({ length: NLE }, (_, k) => LE0 + k * DLE) };
  const T = plan.tabs;
  out.film = { norm: T.norm, dir: T.dc0, gam: T.gam };
  if (plan.paper) out.paper = plan.paper;
  return out;
}

const FB = { NW, NLE, LE0, LE1, DLE, erf, Phi, srgbDecode, srgbEncode, defaultParams, withParams, mergeDeep, prof, illum, filmLut, decodeLuts,
  buildPlan, render, stageExpose, stageDevelop, stageEnlarge, stagePaper, stageScan, needsSpatial, renderFused, autoExposureEv, toRGBA8, fromRGBA8, curvesFor, paperCurves, enlargerIlluminant, neutralFilters, isPositive, gaussBlurPlane, npInterp };
if (typeof module !== 'undefined' && module.exports) module.exports = FB; else root.FB = FB;
})(typeof self !== 'undefined' ? self : this);

/* Filmbench CV kit — image objects and operations the agent can chain.
   All images are w×h×3 Float32 in sRGB-encoded 0..1 unless meta.space says otherwise. */
(function (root) {
'use strict';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const DEC = new Float32Array(4096); for (let i = 0; i < 4096; i++) { const v = i / 4095; DEC[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
const dec = (v) => DEC[(clamp01(v) * 4095 + 0.5) | 0];
const enc = (v) => { v = v < 0 ? 0 : v > 1 ? 1 : v; return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; };
const M2X = [0.4124564, 0.3575761, 0.1804375, 0.2126729, 0.7151522, 0.0721750, 0.0193339, 0.1191920, 0.9503041];
const WP = [0.95047, 1, 1.08883];
const fLab = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
function lab(r, g, b) { // encoded rgb → [L,a,b]
  const R = dec(r), G = dec(g), B = dec(b);
  const x = (M2X[0] * R + M2X[1] * G + M2X[2] * B) / WP[0], y = M2X[3] * R + M2X[4] * G + M2X[5] * B, z = (M2X[6] * R + M2X[7] * G + M2X[8] * B) / WP[2];
  const fx = fLab(x), fy = fLab(y), fz = fLab(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const luma = (r, g, b) => 0.2126729 * dec(r) + 0.7151522 * dec(g) + 0.0721750 * dec(b); // linear Y
const lumaE = (r, g, b) => enc(luma(r, g, b));                                         // encoded luma
const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('');
const R5 = (v) => (Number.isFinite(v) ? Math.round(v * 1e5) / 1e5 : v);

class Img {
  constructor(w, h, data, meta) { this.w = w; this.h = h; this.data = data || new Float32Array(w * h * 3); this.meta = Object.assign({ space: 'srgb' }, meta || {}); }
  static from(w, h, data, meta) { return new Img(w, h, data, meta); }
  clone(meta) { return new Img(this.w, this.h, Float32Array.from(this.data), Object.assign({}, this.meta, meta || {})); }
  _new(w, h, meta) { return new Img(w, h, new Float32Array(w * h * 3), Object.assign({}, this.meta, meta || {})); }
  toString() { return `Img ${this.w}×${this.h}` + (this.meta.note ? ' ' + this.meta.note : ''); }
  summary() { return { img: `${this.w}x${this.h}`, space: this.meta.space, note: this.meta.note || undefined, region: this.meta.region ? this.meta.region.map(R5) : undefined }; }

  /* ----- geometry ----- */
  crop(x, y, w, h) {
    x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
    w = Math.max(1, Math.min(this.w - x, Math.round(w))); h = Math.max(1, Math.min(this.h - y, Math.round(h)));
    const o = this._new(w, h);
    for (let j = 0; j < h; j++) o.data.set(this.data.subarray(((y + j) * this.w + x) * 3, ((y + j) * this.w + x + w) * 3), j * w * 3);
    const r0 = this.meta.region || [0, 0, 1, 1], rw = r0[2] - r0[0], rh = r0[3] - r0[1];
    o.meta.region = [r0[0] + rw * x / this.w, r0[1] + rh * y / this.h, r0[0] + rw * (x + w) / this.w, r0[1] + rh * (y + h) / this.h];
    o.meta.note = `crop ${x},${y} ${w}x${h}`;
    return o;
  }
  cropN(x0, y0, x1, y1) { return this.crop(x0 * this.w, y0 * this.h, (x1 - x0) * this.w, (y1 - y0) * this.h); }
  resize(w, h, smooth) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    const o = this._new(w, h), sx = this.w / w, sy = this.h / h;
    if (smooth === false || (sx <= 1 && sy <= 1 && smooth !== true)) { // nearest when enlarging
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const sxi = Math.min(this.w - 1, (x * sx) | 0), syi = Math.min(this.h - 1, (y * sy) | 0), si = (syi * this.w + sxi) * 3, di = (y * w + x) * 3; o.data[di] = this.data[si]; o.data[di + 1] = this.data[si + 1]; o.data[di + 2] = this.data[si + 2]; }
      return o;
    }
    for (let y = 0; y < h; y++) { // area average for shrinking, bilinear for enlarging
      const y0 = y * sy, y1 = Math.min(this.h, (y + 1) * sy);
      for (let x = 0; x < w; x++) {
        const x0 = x * sx, x1 = Math.min(this.w, (x + 1) * sx);
        let r = 0, g = 0, b = 0, ws = 0;
        for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
          const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
          for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) { const wx = Math.min(xx + 1, x1) - Math.max(xx, x0), ww = wx * wy, i = (Math.min(yy, this.h - 1) * this.w + Math.min(xx, this.w - 1)) * 3; r += this.data[i] * ww; g += this.data[i + 1] * ww; b += this.data[i + 2] * ww; ws += ww; }
        }
        const di = (y * w + x) * 3; o.data[di] = r / ws; o.data[di + 1] = g / ws; o.data[di + 2] = b / ws;
      }
    }
    return o;
  }
  zoom(k) { k = Math.max(1, Math.min(16, k)); const maxE = 1536; const f = Math.min(k, maxE / Math.max(this.w, this.h)); return this.resize(this.w * f, this.h * f, false); }
  fit(maxEdge) { const f = maxEdge / Math.max(this.w, this.h); return f >= 1 ? this : this.resize(this.w * f, this.h * f, true); }
  flip(axis) { const o = this._new(this.w, this.h); for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) { const sx = axis === 'h' ? this.w - 1 - x : x, sy = axis === 'v' ? this.h - 1 - y : y; for (let c = 0; c < 3; c++) o.data[(y * this.w + x) * 3 + c] = this.data[(sy * this.w + sx) * 3 + c]; } return o; }

  /* ----- pointwise ----- */
  map(fn) { const o = this._new(this.w, this.h); const d = this.data; for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) { const i = (y * this.w + x) * 3; const r = fn(d[i], d[i + 1], d[i + 2], x, y); o.data[i] = r[0]; o.data[i + 1] = r[1]; o.data[i + 2] = r[2]; } return o; }
  channel(ch, opts) {
    opts = opts || {};
    const o = this._new(this.w, this.h, { note: 'channel ' + ch }), d = this.data, n = this.w * this.h;
    const f = {
      r: (r) => r, g: (r, g) => g, b: (r, g, b) => b, y: lumaE,
      L: (r, g, b) => lab(r, g, b)[0] / 100, a: (r, g, b) => 0.5 + lab(r, g, b)[1] / (opts.range || 100), bs: (r, g, b) => 0.5 + lab(r, g, b)[2] / (opts.range || 100),
      chroma: (r, g, b) => { const l = lab(r, g, b); return Math.hypot(l[1], l[2]) / (opts.range || 100); },
      sat: (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx > 0 ? (mx - mn) / mx : 0; },
      hue: (r, g, b) => { const l = lab(r, g, b); return (Math.atan2(l[2], l[1]) / (2 * Math.PI) + 1) % 1; },
    }[ch === 'b*' ? 'bs' : ch === 'a*' ? 'a' : ch];
    if (!f) throw new Error("channel: use 'r','g','b','y','L','a*','b*','chroma','sat','hue'");
    for (let i = 0; i < n; i++) { const v = clamp01(f(d[i * 3], d[i * 3 + 1], d[i * 3 + 2])); o.data[i * 3] = o.data[i * 3 + 1] = o.data[i * 3 + 2] = v; }
    o.meta.scale = ch === 'a*' || ch === 'b*' ? { lo: -(opts.range || 100) / 2, hi: (opts.range || 100) / 2, unit: 'CIELAB ' + ch } : ch === 'chroma' ? { lo: 0, hi: opts.range || 100, unit: 'CIELAB C*' } : undefined;
    return o;
  }
  levels(black, white, gamma) { black = black || 0; white = white == null ? 1 : white; gamma = gamma || 1; const s = 1 / Math.max(white - black, 1e-6); return this.map((r, g, b) => [Math.pow(clamp01((r - black) * s), 1 / gamma), Math.pow(clamp01((g - black) * s), 1 / gamma), Math.pow(clamp01((b - black) * s), 1 / gamma)]); }
  gamma(g) { return this.levels(0, 1, g); }
  expose(ev) { const k = Math.pow(2, ev); return this.map((r, g, b) => [enc(dec(r) * k), enc(dec(g) * k), enc(dec(b) * k)]); }
  contrast(c) { return this.map((r, g, b) => [clamp01(0.5 + (r - 0.5) * c), clamp01(0.5 + (g - 0.5) * c), clamp01(0.5 + (b - 0.5) * c)]); }
  autolevels(p) { p = p == null ? 0.5 : p; const a = this.percentile(p / 100), b = this.percentile(1 - p / 100); return this.levels(a, b, 1); }
  percentile(q, ch) { const h = new Uint32Array(1024); const d = this.data, n = this.w * this.h; for (let i = 0; i < n; i++) { const v = ch === undefined ? lumaE(d[i * 3], d[i * 3 + 1], d[i * 3 + 2]) : d[i * 3 + ch]; h[Math.min(1023, (clamp01(v) * 1023) | 0)]++; } let acc = 0; const t = q * n; for (let i = 0; i < 1024; i++) { acc += h[i]; if (acc >= t) return i / 1023; } return 1; }
  threshold(t, ch) {
    const src = this.channel(ch || 'y'); const n = this.w * this.h;
    if (t === 'otsu' || t == null) { const h = new Float64Array(256); for (let i = 0; i < n; i++) h[Math.min(255, (src.data[i * 3] * 255) | 0)]++; let tot = n, sum = 0; for (let i = 0; i < 256; i++) sum += i * h[i]; let wB = 0, sB = 0, best = 0, bt = 128; for (let i = 0; i < 256; i++) { wB += h[i]; if (!wB) continue; const wF = tot - wB; if (!wF) break; sB += i * h[i]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; bt = i; } } t = bt / 255; }
    const o = this._new(this.w, this.h, { note: 'threshold ' + R5(t) }); for (let i = 0; i < n; i++) { const v = src.data[i * 3] >= t ? 1 : 0; o.data[i * 3] = o.data[i * 3 + 1] = o.data[i * 3 + 2] = v; } o.meta.threshold = t; return o;
  }
  equalize() {
    const n = this.w * this.h, h = new Float64Array(256), d = this.data; for (let i = 0; i < n; i++) h[Math.min(255, (lumaE(d[i * 3], d[i * 3 + 1], d[i * 3 + 2]) * 255) | 0)]++;
    const cdf = new Float64Array(256); let a = 0; for (let i = 0; i < 256; i++) { a += h[i]; cdf[i] = a / n; }
    return this.map((r, g, b) => { const y = lumaE(r, g, b), t = cdf[Math.min(255, (y * 255) | 0)], k = y > 1e-4 ? t / y : 1; return [clamp01(r * k), clamp01(g * k), clamp01(b * k)]; });
  }
  falseColor(opts) {
    opts = opts || {}; const ch = opts.ch || 'y'; const src = this.channel(ch, opts); const lo = opts.lo == null ? 0 : opts.lo, hi = opts.hi == null ? 1 : opts.hi;
    const o = this._new(this.w, this.h, { note: `falsecolor ${ch} ${lo}..${hi}` }), n = this.w * this.h;
    for (let i = 0; i < n; i++) { const t = clamp01((src.data[i * 3] - lo) / Math.max(hi - lo, 1e-9)); const c = turbo(t); o.data[i * 3] = c[0]; o.data[i * 3 + 1] = c[1]; o.data[i * 3 + 2] = c[2]; }
    o.meta.scale = { lo, hi, unit: 'turbo ' + ch }; return o;
  }
  clipMask(opts) {
    opts = opts || {}; const lo = opts.lo == null ? 0.02 : opts.lo, hi = opts.hi == null ? 0.988 : opts.hi; const o = this._new(this.w, this.h, { note: 'clip mask' });
    const d = this.data, n = this.w * this.h; let nl = 0, nh = 0;
    for (let i = 0; i < n; i++) { const r = d[i * 3], g = d[i * 3 + 1], b = d[i * 3 + 2], y = lumaE(r, g, b) * 0.35 + 0.35; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let c = [y, y, y]; if (mx >= hi) { c = [1, 0.1, 0.1]; nh++; } else if (mx <= lo) { c = [0.1, 0.35, 1]; nl++; } o.data[i * 3] = c[0]; o.data[i * 3 + 1] = c[1]; o.data[i * 3 + 2] = c[2]; }
    o.meta.clip = { shadows_pct: R5(100 * nl / n), highlights_pct: R5(100 * nh / n) }; return o;
  }

  /* ----- filters ----- */
  blur(sigma) { if (!(sigma > 0.1)) return this.clone(); const o = this._new(this.w, this.h, { note: 'blur ' + sigma }); o.data = root.FB ? root.FB.gaussBlurPlane(this.data, this.w, this.h, 3, sigma) : gauss(this.data, this.w, this.h, sigma); if (o.data === this.data) o.data = Float32Array.from(this.data); return o; }
  sharpen(amount, sigma) { amount = amount == null ? 1 : amount; const b = this.blur(sigma || 1); const o = this._new(this.w, this.h, { note: `sharpen ${amount}` }); for (let i = 0; i < o.data.length; i++) o.data[i] = clamp01(this.data[i] + amount * (this.data[i] - b.data[i])); return o; }
  edges(kind) {
    const y = this.channel('y'), w = this.w, h = this.h, s = y.data, o = this._new(w, h, { note: 'edges ' + (kind || 'sobel') });
    let mx = 1e-9; const g = new Float32Array(w * h);
    const at = (x, yy) => s[(Math.min(h - 1, Math.max(0, yy)) * w + Math.min(w - 1, Math.max(0, x))) * 3];
    for (let yy = 0; yy < h; yy++) for (let x = 0; x < w; x++) {
      let v;
      if (kind === 'laplacian') v = Math.abs(4 * at(x, yy) - at(x - 1, yy) - at(x + 1, yy) - at(x, yy - 1) - at(x, yy + 1));
      else { const gx = -at(x - 1, yy - 1) - 2 * at(x - 1, yy) - at(x - 1, yy + 1) + at(x + 1, yy - 1) + 2 * at(x + 1, yy) + at(x + 1, yy + 1); const gy = -at(x - 1, yy - 1) - 2 * at(x, yy - 1) - at(x + 1, yy - 1) + at(x - 1, yy + 1) + 2 * at(x, yy + 1) + at(x + 1, yy + 1); v = Math.hypot(gx, gy); }
      g[yy * w + x] = v; if (v > mx) mx = v;
    }
    const gain = 1 / Math.min(mx, 4 * mean(g) + 1e-9); for (let i = 0; i < w * h; i++) { const v = clamp01(g[i] * gain); o.data[i * 3] = o.data[i * 3 + 1] = o.data[i * 3 + 2] = v; }
    o.meta.edge_mean = R5(mean(g)); return o;
  }
  diff(other, opts) {
    opts = opts || {}; const b = other.w === this.w && other.h === this.h ? other : other.resize(this.w, this.h, true); const gain = opts.gain || 4; const o = this._new(this.w, this.h, { note: 'diff x' + gain + ' ' + (opts.mode || 'abs') });
    let sum = 0, mx = 0; const n = this.w * this.h;
    for (let i = 0; i < n; i++) {
      const dr = this.data[i * 3] - b.data[i * 3], dg = this.data[i * 3 + 1] - b.data[i * 3 + 1], db = this.data[i * 3 + 2] - b.data[i * 3 + 2];
      const m = Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db)); sum += (Math.abs(dr) + Math.abs(dg) + Math.abs(db)) / 3; if (m > mx) mx = m;
      if (opts.mode === 'signed') { const l = (dr + dg + db) / 3 * gain; o.data[i * 3] = clamp01(0.5 + l); o.data[i * 3 + 1] = clamp01(0.5 - Math.abs(l) * 0.2); o.data[i * 3 + 2] = clamp01(0.5 - l); }
      else { const c = turbo(clamp01(m * gain)); o.data[i * 3] = c[0]; o.data[i * 3 + 1] = c[1]; o.data[i * 3 + 2] = c[2]; }
    }
    o.meta.diff = { mean_abs: R5(sum / n), max_abs: R5(mx) }; return o;
  }

  /* ----- analysis ----- */
  region(x, y, w, h) { return x === undefined ? this : this.crop(x, y, w, h); }
  stats(x, y, w, h) {
    const im = x === undefined ? this : this.crop(x, y, w, h), d = im.data, n = im.w * im.h;
    const mean3 = [0, 0, 0], sq = [0, 0, 0], mn = [1, 1, 1], mx = [0, 0, 0];
    const hist = [new Uint32Array(1024), new Uint32Array(1024), new Uint32Array(1024), new Uint32Array(1024)];
    let Ls = 0, As = 0, Bs = 0, lin = [0, 0, 0], clipLo = 0, clipHi = 0;
    for (let i = 0; i < n; i++) {
      const r = d[i * 3], g = d[i * 3 + 1], b = d[i * 3 + 2];
      mean3[0] += r; mean3[1] += g; mean3[2] += b; sq[0] += r * r; sq[1] += g * g; sq[2] += b * b;
      if (r < mn[0]) mn[0] = r; if (g < mn[1]) mn[1] = g; if (b < mn[2]) mn[2] = b; if (r > mx[0]) mx[0] = r; if (g > mx[1]) mx[1] = g; if (b > mx[2]) mx[2] = b;
      const y = lumaE(r, g, b); hist[0][Math.min(1023, (clamp01(r) * 1023) | 0)]++; hist[1][Math.min(1023, (clamp01(g) * 1023) | 0)]++; hist[2][Math.min(1023, (clamp01(b) * 1023) | 0)]++; hist[3][Math.min(1023, (clamp01(y) * 1023) | 0)]++;
      const l = lab(r, g, b); Ls += l[0]; As += l[1]; Bs += l[2]; lin[0] += dec(r); lin[1] += dec(g); lin[2] += dec(b);
      const m1 = Math.max(r, g, b), m0 = Math.min(r, g, b); if (m1 >= 0.988) clipHi++; else if (m1 <= 0.02) clipLo++;
    }
    const pct = (hh, q) => { let a = 0; const t = q * n; for (let i = 0; i < 1024; i++) { a += hh[i]; if (a >= t) return i / 1023; } return 1; };
    const mean_ = mean3.map((v) => v / n);
    const o = {
      px: n, mean: mean_.map(R5), std: sq.map((v, i) => R5(Math.sqrt(Math.max(v / n - mean_[i] * mean_[i], 0)))), min: mn.map(R5), max: mx.map(R5),
      hex: hex(mean_[0], mean_[1], mean_[2]), mean_linear: lin.map((v) => R5(v / n)),
      luma: { p1: R5(pct(hist[3], 0.01)), p5: R5(pct(hist[3], 0.05)), p25: R5(pct(hist[3], 0.25)), p50: R5(pct(hist[3], 0.5)), p75: R5(pct(hist[3], 0.75)), p95: R5(pct(hist[3], 0.95)), p99: R5(pct(hist[3], 0.99)) },
      lab_mean: { L: R5(Ls / n), a: R5(As / n), b: R5(Bs / n) }, clip_pct: { shadows: R5(100 * clipLo / n), highlights: R5(100 * clipHi / n) },
    };
    return o;
  }
  hist(bins, ch) {
    bins = bins || 32; const d = this.data, n = this.w * this.h, h = new Float64Array(bins);
    for (let i = 0; i < n; i++) { const v = ch === 'r' ? d[i * 3] : ch === 'g' ? d[i * 3 + 1] : ch === 'b' ? d[i * 3 + 2] : lumaE(d[i * 3], d[i * 3 + 1], d[i * 3 + 2]); h[Math.min(bins - 1, (clamp01(v) * bins) | 0)]++; }
    return { channel: ch || 'y', bins, pct: Array.from(h, (v) => R5(100 * v / n)) };
  }
  profile(x0, y0, x1, y1, n) {
    n = Math.min(256, n || 64); const out = { y: [], r: [], g: [], b: [], x: [] };
    for (let i = 0; i < n; i++) { const t = n === 1 ? 0 : i / (n - 1), x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t; const xi = Math.min(this.w - 1, Math.max(0, Math.round(x))), yi = Math.min(this.h - 1, Math.max(0, Math.round(y))); const k = (yi * this.w + xi) * 3; out.x.push(Math.round(x)); out.r.push(R5(this.data[k])); out.g.push(R5(this.data[k + 1])); out.b.push(R5(this.data[k + 2])); out.y.push(R5(lumaE(this.data[k], this.data[k + 1], this.data[k + 2]))); }
    return out;
  }
  kmeans(k, seed) {
    k = Math.max(2, Math.min(12, k || 5)); const n = this.w * this.h, step = Math.max(1, Math.floor(n / 6000)), pts = [];
    for (let i = 0; i < n; i += step) pts.push(lab(this.data[i * 3], this.data[i * 3 + 1], this.data[i * 3 + 2]).concat([i]));
    let s = (seed || 7) >>> 0; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const cen = [pts[(rnd() * pts.length) | 0].slice(0, 3)];
    while (cen.length < k) { const dist = pts.map((p) => Math.min(...cen.map((c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2))); const tot = dist.reduce((a, b) => a + b, 0); let t = rnd() * tot, j = 0; while (j < dist.length - 1 && (t -= dist[j]) > 0) j++; cen.push(pts[j].slice(0, 3)); }
    const asg = new Int32Array(pts.length);
    for (let it = 0; it < 12; it++) {
      for (let i = 0; i < pts.length; i++) { let b = 0, bd = 1e18; for (let c = 0; c < k; c++) { const dd = (pts[i][0] - cen[c][0]) ** 2 + (pts[i][1] - cen[c][1]) ** 2 + (pts[i][2] - cen[c][2]) ** 2; if (dd < bd) { bd = dd; b = c; } } asg[i] = b; }
      const sum = Array.from({ length: k }, () => [0, 0, 0, 0]); for (let i = 0; i < pts.length; i++) { const s_ = sum[asg[i]]; s_[0] += pts[i][0]; s_[1] += pts[i][1]; s_[2] += pts[i][2]; s_[3]++; }
      for (let c = 0; c < k; c++) if (sum[c][3]) cen[c] = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]];
    }
    const cnt = new Array(k).fill(0), rgb = Array.from({ length: k }, () => [0, 0, 0]);
    for (let i = 0; i < pts.length; i++) { const c = asg[i], idx = pts[i][3]; cnt[c]++; rgb[c][0] += this.data[idx * 3]; rgb[c][1] += this.data[idx * 3 + 1]; rgb[c][2] += this.data[idx * 3 + 2]; }
    return cen.map((c, i) => ({ pct: R5(100 * cnt[i] / pts.length), hex: cnt[i] ? hex(rgb[i][0] / cnt[i], rgb[i][1] / cnt[i], rgb[i][2] / cnt[i]) : '#000000', L: R5(c[0]), a: R5(c[1]), b: R5(c[2]) })).sort((a, b) => b.pct - a.pct);
  }
  cast() {
    const n = this.w * this.h, d = this.data, bands = { shadows: [0, 0, 0], mids: [0, 0, 0], highlights: [0, 0, 0] }, all = [0, 0, 0];
    let gw = [0, 0, 0], gwn = 0;
    for (let i = 0; i < n; i++) {
      const r = d[i * 3], g = d[i * 3 + 1], b = d[i * 3 + 2], l = lab(r, g, b); all[0] += l[1]; all[1] += l[2]; all[2]++;
      const band = l[0] < 30 ? 'shadows' : l[0] < 70 ? 'mids' : 'highlights'; bands[band][0] += l[1]; bands[band][1] += l[2]; bands[band][2]++;
      const wgt = Math.exp(-(l[1] * l[1] + l[2] * l[2]) / 200); gw[0] += dec(r) * wgt; gw[1] += dec(g) * wgt; gw[2] += dec(b) * wgt; gwn += wgt;
    }
    const f = (a) => (a[2] ? { a: R5(a[0] / a[2]), b: R5(a[1] / a[2]), px_pct: R5(100 * a[2] / n) } : null);
    const gwm = gw.map((v) => v / Math.max(gwn, 1e-9));
    return { overall: f(all), shadows: f(bands.shadows), mids: f(bands.mids), highlights: f(bands.highlights), neutral_weighted_rgb_linear: gwm.map(R5), grayworld_gain_rb: [R5(gwm[1] / gwm[0]), R5(gwm[1] / gwm[2])], hint: 'a*>0 magenta/red, a*<0 green; b*>0 yellow, b*<0 blue' };
  }
  grain() {
    const y = this.channel('y'), b = y.blur(1.2), w = this.w, h = this.h; const diffs = [];
    const e = this.edges('sobel');
    for (let j = 2; j < h - 2; j += 2) for (let i = 2; i < w - 2; i += 2) { const k = (j * w + i) * 3; if (e.data[k] < 0.1) diffs.push(y.data[k] - b.data[k]); }
    if (diffs.length < 50) return { flat_px: diffs.length, note: 'too little flat area' };
    const mad = (() => { const a = diffs.map(Math.abs).sort((p, q) => p - q); return a[a.length >> 1] / 0.6745; })();
    return { flat_px: diffs.length, noise_sigma: R5(mad), noise_sigma_8bit: R5(mad * 255), note: 'robust std of luma minus gaussian(1.2) in low-gradient areas' };
  }
  sharpness() { const e = this.edges('laplacian'); const y = this.channel('y'); let s = 0, s2 = 0; const n = this.w * this.h; const w = this.w, h = this.h; const L = new Float32Array(n); for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) { const k = j * w + i; const v = 4 * y.data[k * 3] - y.data[(k - 1) * 3] - y.data[(k + 1) * 3] - y.data[(k - w) * 3] - y.data[(k + w) * 3]; L[k] = v; s += v; s2 += v * v; } const m = s / n; return { laplacian_var: R5(s2 / n - m * m), edge_mean: e.meta.edge_mean }; }
  blobs(opts) {
    opts = opts || {}; const mask = opts.mask || this.threshold(opts.t == null ? 'otsu' : opts.t, opts.ch); const w = this.w, h = this.h, lab_ = new Int32Array(w * h), out = []; let id = 0;
    const stack = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i; if (lab_[k] || mask.data[k * 3] < 0.5) continue; id++; let area = 0, sx = 0, sy = 0, x0 = i, x1 = i, y0 = j, y1 = j; stack.push(k); lab_[k] = id;
      while (stack.length) { const p = stack.pop(), px = p % w, py = (p / w) | 0; area++; sx += px; sy += py; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; for (const q of [p - 1, p + 1, p - w, p + w]) { if (q < 0 || q >= w * h) continue; if ((q === p - 1 && px === 0) || (q === p + 1 && px === w - 1)) continue; if (!lab_[q] && mask.data[q * 3] >= 0.5) { lab_[q] = id; stack.push(q); } } }
      if (area >= (opts.min_area || 4)) out.push({ area, cx: R5(sx / area), cy: R5(sy / area), bbox: [x0, y0, x1 - x0 + 1, y1 - y0 + 1] });
    }
    out.sort((a, b) => b.area - a.area); return { count: out.length, top: out.slice(0, opts.top || 10) };
  }

  /* ----- scopes (images about the image) ----- */
  histImg(w, h) {
    w = w || 384; h = h || 160; const o = new Img(w, h, new Float32Array(w * h * 3).fill(1), { note: 'histogram r/g/b/luma', space: 'srgb' });
    const bins = w, H = [0, 1, 2].map((c) => new Float64Array(bins)), n = this.w * this.h; for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) H[c][Math.min(bins - 1, (clamp01(this.data[i * 3 + c]) * bins) | 0)]++;
    let mx = 0; for (const a of H) for (let i = 1; i < bins - 1; i++) mx = Math.max(mx, a[i]); mx = Math.max(mx, 1);
    const col = [[0.85, 0.1, 0.1], [0.1, 0.6, 0.15], [0.15, 0.3, 0.9]];
    for (let c = 0; c < 3; c++) for (let x = 0; x < w; x++) { const hh = Math.round((Math.min(H[c][x], mx) / mx) * (h - 4)); for (let y = h - 1; y > h - 1 - hh; y--) { const k = (y * w + x) * 3; for (let q = 0; q < 3; q++) o.data[k + q] = o.data[k + q] * 0.55 + col[c][q] * 0.45; } }
    for (let x = 0; x < w; x += w / 4) for (let y = 0; y < h; y++) { const k = (y * w + Math.floor(x)) * 3; o.data[k] = o.data[k + 1] = o.data[k + 2] = 0.8; }
    return o;
  }
  waveform(w, h) {
    w = w || 384; h = h || 192; const acc = new Float32Array(w * h), n = this.w * this.h; const o = new Img(w, h, new Float32Array(w * h * 3), { note: 'luma waveform (x = image column, y = luma 0 bottom..1 top)' });
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) { const k = (j * this.w + i) * 3, y = lumaE(this.data[k], this.data[k + 1], this.data[k + 2]); const px = Math.min(w - 1, ((i / this.w) * w) | 0), py = h - 1 - Math.min(h - 1, (y * (h - 1)) | 0); acc[py * w + px]++; }
    const gain = 6 * w / Math.max(this.w, 1) * h / Math.max(this.h, 1) * 8; for (let i = 0; i < w * h; i++) { const v = 1 - Math.min(1, Math.sqrt(acc[i] * gain / Math.max(1, this.h)) * 0.6); o.data[i * 3] = o.data[i * 3 + 1] = o.data[i * 3 + 2] = v; }
    return o;
  }
  vectorscope(size) {
    size = size || 256; const o = new Img(size, size, new Float32Array(size * size * 3).fill(1), { note: 'CIELAB a*(x) b*(y up) density, range ±80' }); const acc = new Float32Array(size * size), n = this.w * this.h, step = Math.max(1, Math.floor(n / 80000));
    for (let i = 0; i < n; i += step) { const l = lab(this.data[i * 3], this.data[i * 3 + 1], this.data[i * 3 + 2]); const x = Math.round(size / 2 + l[1] / 80 * (size / 2)), y = Math.round(size / 2 - l[2] / 80 * (size / 2)); if (x >= 0 && x < size && y >= 0 && y < size) acc[y * size + x]++; }
    let mx = 1; for (let i = 0; i < acc.length; i++) mx = Math.max(mx, acc[i]);
    for (let i = 0; i < size * size; i++) { const v = acc[i] ? 1 - Math.min(1, 0.25 + 0.75 * Math.log1p(acc[i]) / Math.log1p(mx)) : 1; o.data[i * 3] = o.data[i * 3 + 1] = o.data[i * 3 + 2] = v; }
    for (let t = 0; t < size; t++) for (const [x, y] of [[t, size >> 1], [size >> 1, t]]) { const k = (y * size + x) * 3; o.data[k] = Math.min(o.data[k], 0.75); o.data[k + 1] = Math.min(o.data[k + 1], 0.75); o.data[k + 2] = Math.min(o.data[k + 2], 0.75); }
    return o;
  }
  /* side-by-side or stacked comparison (images are fit to the same height) */
  static sbs(list, gap) {
    gap = gap == null ? 4 : gap; const h = Math.min(...list.map((i) => i.h)); const rs = list.map((i) => (i.h === h ? i : i.resize(Math.round(i.w * h / i.h), h, true)));
    const w = rs.reduce((a, i) => a + i.w, 0) + gap * (rs.length - 1); const o = new Img(w, h, new Float32Array(w * h * 3).fill(0.5), { note: 'side by side' }); let x0 = 0;
    for (const im of rs) { for (let j = 0; j < h; j++) o.data.set(im.data.subarray(j * im.w * 3, (j + 1) * im.w * 3), (j * w + x0) * 3); x0 += im.w + gap; } return o;
  }
}

function mean(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
function gauss(src, w, h, sigma) { const rad = Math.max(1, Math.ceil(sigma * 3)); const k = []; let s = 0; for (let i = -rad; i <= rad; i++) { const v = Math.exp(-0.5 * i * i / (sigma * sigma)); k.push(v); s += v; } const tmp = new Float32Array(src.length), out = new Float32Array(src.length); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) { let a = 0; for (let i = -rad; i <= rad; i++) a += src[(y * w + Math.min(w - 1, Math.max(0, x + i))) * 3 + c] * k[i + rad]; tmp[(y * w + x) * 3 + c] = a / s; } for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) { let a = 0; for (let i = -rad; i <= rad; i++) a += tmp[(Math.min(h - 1, Math.max(0, y + i)) * w + x) * 3 + c] * k[i + rad]; out[(y * w + x) * 3 + c] = a / s; } return out; }
function turbo(t) { // compact turbo-like colour map
  const r = clamp01(0.13572138 + t * (4.6153926 + t * (-42.66032258 + t * (132.13108234 + t * (-152.94239396 + t * 59.28637943)))));
  const g = clamp01(0.09140261 + t * (2.19418839 + t * (4.84296658 + t * (-14.18503333 + t * (4.27729857 + t * 2.82956604)))));
  const b = clamp01(0.1066733 + t * (12.64194608 + t * (-60.58204836 + t * (110.36276771 + t * (-89.90310912 + t * 27.34824973)))));
  return [r, g, b];
}

/* ---------- YAML-ish result formatting (numbers 5 decimals; number lists one line ≤64; ≤80 keys; depth ≤5) ---------- */
function fmtNum(v) { if (!Number.isFinite(v)) return String(v); const r = Math.round(v * 1e5) / 1e5; return Object.is(r, -0) ? '0' : String(r); }
function fmtScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'boolean') return String(v);
  const s = String(v);
  return /^[A-Za-z0-9_\-./%+][^:#\n"']*$/.test(s) && !/^(true|false|null|-?\d+(\.\d+)?)$/.test(s) && s.length < 90 ? s : JSON.stringify(s.length > 400 ? s.slice(0, 400) + '…' : s);
}
function toYaml(v, ind, depth, st) {
  ind = ind || 0; depth = depth || 0; st = st || { keys: 0 };
  const pad = ' '.repeat(ind);
  if (v instanceof Img) v = v.summary();
  if (v === null || typeof v !== 'object') return pad + fmtScalar(v);
  if (typeof v.toJSON === 'function') v = v.toJSON();
  if (ArrayBuffer.isView(v)) v = Array.from(v);
  if (Array.isArray(v)) {
    if (!v.length) return pad + '[]';
    if (v.every((x) => typeof x === 'number')) return pad + '[' + v.slice(0, 64).map(fmtNum).join(', ') + (v.length > 64 ? `, … (+${v.length - 64})` : '') + ']';
    if (depth >= 5) return pad + '[…]';
    const lines = [];
    for (const x of v.slice(0, 40)) {
      if (x instanceof Img) { lines.push(pad + '- ' + toYaml(x.summary(), 0, depth + 1, st).trim()); continue; }
      if (x !== null && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length <= 6 && Object.values(x).every((q) => q === null || typeof q !== 'object')) { lines.push(pad + '- {' + Object.entries(x).map(([k, q]) => k + ': ' + fmtScalar(q)).join(', ') + '}'); continue; }
      if (x !== null && typeof x === 'object') { const inner = toYaml(x, ind + 2, depth + 1, st).split('\n'); inner[0] = pad + '- ' + inner[0].slice(ind + 2); lines.push(inner.join('\n')); } else lines.push(pad + '- ' + fmtScalar(x));
    }
    if (v.length > 40) lines.push(pad + `# … ${v.length - 40} more items`);
    return lines.join('\n');
  }
  const keys = Object.keys(v);
  if (!keys.length) return pad + '{}';
  if (depth >= 5) return pad + '{…}';
  const lines = [];
  for (const k of keys) {
    if (st.keys++ >= 80) { lines.push(pad + '# … more keys'); break; }
    const x = v[k];
    if (x === undefined) continue;
    if (x instanceof Img) lines.push(pad + k + ': ' + toYaml(x.summary(), 0, depth + 1, st).trim());
    else if (x !== null && typeof x === 'object' && !(Array.isArray(x) && (!x.length || x.every((q) => typeof q === 'number')))) lines.push(pad + k + ':\n' + toYaml(x, ind + 2, depth + 1, st));
    else lines.push(pad + k + ': ' + toYaml(x, 0, depth + 1, st).trim());
  }
  return lines.join('\n');
}

/* ---------- 16-bit PNG encoder (deflate supplied by the caller: Uint8Array → Promise<Uint8Array> zlib stream) ---------- */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf, init) { let c = init === undefined ? 0xffffffff : init; for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 255] ^ (c >>> 8); return c >>> 0; }
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length); for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i); out.set(data, 8);
  dv.setUint32(8 + data.length, (crc32(out.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0); return out;
}
async function encodePng16(rgb, w, h, deflate, meta) {
  const raw = new Uint8Array((w * 6 + 1) * h);
  for (let y = 0; y < h; y++) { let o = y * (w * 6 + 1); raw[o++] = 0; for (let x = 0; x < w * 3; x++) { const v = Math.round(clamp01(rgb[y * w * 3 + x]) * 65535); raw[o++] = v >> 8; raw[o++] = v & 255; } }
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer); dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 16; ihdr[9] = 2;
  const idat = await deflate(raw);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('sRGB', new Uint8Array([0]))];
  if (meta) { const txt = new TextEncoder().encode('Comment\0' + meta); parts.push(chunk('tEXt', txt)); }
  parts.push(chunk('IDAT', idat), chunk('IEND', new Uint8Array(0)));
  const total = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(total); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}

root.CV = { Img, toYaml, fmtNum, lab, hex, lumaE, dec, enc, turbo, encodePng16, crc32, R5, clamp01 };
if (typeof module !== 'undefined' && module.exports) module.exports = root.CV;
})(typeof self !== 'undefined' ? self : globalThis);

/* Filmbench plots — drawing-sheet style SVG: ink on paper, dash/mark shapes instead of hue. */
(function (root) {
'use strict';
const FONT = "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace";
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const f2 = (v) => (Math.round(v * 100) / 100).toString();
function niceTicks(lo, hi, n) {
  const span = hi - lo, raw = span / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
  const step = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p, out = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v / step * 1e6) / 1e6 * step);
  return out;
}
const DASH = { solid: '', dash: '6 3', dot: '1.5 3', dashdot: '8 3 1.5 3', long: '12 4' };
function markShape(kind, x, y, c) {
  const r = 2.6;
  if (kind === 'o') return `<circle cx="${f2(x)}" cy="${f2(y)}" r="${r}" fill="none" stroke="${c}" stroke-width="1"/>`;
  if (kind === 's') return `<rect x="${f2(x - r)}" y="${f2(y - r)}" width="${2 * r}" height="${2 * r}" fill="none" stroke="${c}" stroke-width="1"/>`;
  if (kind === '^') return `<path d="M${f2(x)} ${f2(y - r - 0.5)}L${f2(x + r + 0.5)} ${f2(y + r)}L${f2(x - r - 0.5)} ${f2(y + r)}Z" fill="none" stroke="${c}" stroke-width="1"/>`;
  if (kind === '+') return `<path d="M${f2(x - r)} ${f2(y)}H${f2(x + r)}M${f2(x)} ${f2(y - r)}V${f2(y + r)}" stroke="${c}" stroke-width="1"/>`;
  return '';
}
/* opts: {w,h,theme,title,x:{lim,label,ticks,fmt},y:{...},series:[{xs,ys,dash,width,label,mark,color,opacity}],hlines,vlines,notes} */
let PID = 0;
function plot(o) {
  const cid = 'pc' + (++PID);
  const T = o.theme, w = o.w || 560, h = o.h || 300, L = o.left || 48, R = o.right || 16, Tm = o.top || 26, B = o.bottom || 36;
  const pw = w - L - R, ph = h - Tm - B, xl = o.x.lim, yl = o.y.lim;
  const sx = (v) => L + (v - xl[0]) / (xl[1] - xl[0]) * pw, sy = (v) => Tm + ph - (v - yl[0]) / (yl[1] - yl[0]) * ph;
  const xt = o.x.ticks || niceTicks(xl[0], xl[1], Math.max(3, Math.round(pw / 70))), yt = o.y.ticks || niceTicks(yl[0], yl[1], Math.max(3, Math.round(ph / 42)));
  const s = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="${FONT}" font-size="9.5">`, `<rect width="${w}" height="${h}" fill="${T.bg}"/>`];
  for (const t of xt) s.push(`<line x1="${f2(sx(t))}" x2="${f2(sx(t))}" y1="${Tm}" y2="${Tm + ph}" stroke="${T.rule}" stroke-width="0.6"/>`);
  for (const t of yt) s.push(`<line x1="${L}" x2="${L + pw}" y1="${f2(sy(t))}" y2="${f2(sy(t))}" stroke="${T.rule}" stroke-width="0.6"/>`);
  s.push(`<rect x="${L}" y="${Tm}" width="${pw}" height="${ph}" fill="none" stroke="${T.ink}" stroke-width="1"/>`);
  const xf = o.x.fmt || ((v) => String(+v.toFixed(3))), yf = o.y.fmt || ((v) => String(+v.toFixed(3)));
  for (const t of xt) s.push(`<text x="${f2(sx(t))}" y="${Tm + ph + 13}" text-anchor="middle" fill="${T.ink2}">${esc(xf(t))}</text>`);
  for (const t of yt) s.push(`<text x="${L - 6}" y="${f2(sy(t) + 3)}" text-anchor="end" fill="${T.ink2}">${esc(yf(t))}</text>`);
  if (o.x.label) s.push(`<text x="${L + pw / 2}" y="${h - 6}" text-anchor="middle" fill="${T.ink2}">${esc(o.x.label)}</text>`);
  if (o.y.label) s.push(`<text transform="translate(11 ${Tm + ph / 2}) rotate(-90)" text-anchor="middle" fill="${T.ink2}">${esc(o.y.label)}</text>`);
  if (o.title) s.push(`<text x="${L}" y="14" fill="${T.ink}" font-weight="600" letter-spacing="0.06em">${esc(o.title.toUpperCase())}</text>`);
  s.push(`<clipPath id="${cid}"><rect x="${L}" y="${Tm}" width="${pw}" height="${ph}"/></clipPath><g clip-path="url(#${cid})">`);
  for (const l of o.hlines || []) { s.push(`<line x1="${L}" x2="${L + pw}" y1="${f2(sy(l.y))}" y2="${f2(sy(l.y))}" stroke="${l.accent ? T.accent : T.ink2}" stroke-width="0.8" stroke-dasharray="${DASH[l.dash || 'dash']}"/>`); }
  for (const l of o.vlines || []) { s.push(`<line y1="${Tm}" y2="${Tm + ph}" x1="${f2(sx(l.x))}" x2="${f2(sx(l.x))}" stroke="${l.accent ? T.accent : T.ink2}" stroke-width="0.8" stroke-dasharray="${DASH[l.dash || 'dash']}"/>`); }
  for (const ser of o.series) {
    const c = ser.color === 'ink2' ? T.ink2 : T.ink; let d = '', pen = false;
    for (let i = 0; i < ser.xs.length; i++) { const y = ser.ys[i]; if (!Number.isFinite(y)) { pen = false; continue; } d += (pen ? 'L' : 'M') + f2(sx(ser.xs[i])) + ' ' + f2(sy(y)); pen = true; }
    s.push(`<path d="${d}" fill="none" stroke="${c}" stroke-width="${ser.width || 1.4}" stroke-dasharray="${DASH[ser.dash || 'solid']}" ${ser.opacity ? `opacity="${ser.opacity}"` : ''} stroke-linejoin="round"/>`);
    if (ser.mark) { const every = ser.markEvery || Math.max(1, Math.round(ser.xs.length / 9)); for (let i = Math.floor(every / 2); i < ser.xs.length; i += every) if (Number.isFinite(ser.ys[i])) s.push(markShape(ser.mark, sx(ser.xs[i]), sy(ser.ys[i]), c)); }
  }
  s.push('</g>');
  for (const l of o.hlines || []) if (l.label) s.push(`<text x="${L + pw - 4}" y="${f2(sy(l.y) - 3)}" text-anchor="end" fill="${l.accent ? T.accent : T.ink2}" font-size="8.5">${esc(l.label)}</text>`);
  for (const l of o.vlines || []) if (l.label) s.push(`<text x="${f2(sx(l.x) + 3)}" y="${Tm + 10}" fill="${l.accent ? T.accent : T.ink2}" font-size="8.5">${esc(l.label)}</text>`);
  // legend
  let lx = L + pw, items = o.series.filter((q) => q.label);
  for (let i = items.length - 1; i >= 0; i--) {
    const q = items[i], tw = q.label.length * 5.6 + 30; lx -= tw; const c = q.color === 'ink2' ? T.ink2 : T.ink;
    s.push(`<line x1="${f2(lx)}" x2="${f2(lx + 20)}" y1="${Tm - 9}" y2="${Tm - 9}" stroke="${c}" stroke-width="${q.width || 1.4}" stroke-dasharray="${DASH[q.dash || 'solid']}"/>`);
    if (q.mark) s.push(markShape(q.mark, lx + 10, Tm - 9, c));
    s.push(`<text x="${f2(lx + 24)}" y="${Tm - 6}" fill="${T.ink}" font-size="8.5">${esc(q.label)}</text>`);
  }
  for (const n of o.notes || []) s.push(`<text x="${L + 6}" y="${Tm + ph - 6 - (n.row || 0) * 11}" fill="${T.ink2}" font-size="8.5">${esc(n.text)}</text>`);
  s.push('</svg>');
  return s.join('');
}
const CH = [{ dash: 'solid', mark: 'o' }, { dash: 'dash', mark: 's' }, { dash: 'dot', mark: '^' }];
root.PLOTS = { plot, niceTicks, CH, FONT, esc, DASH };
if (typeof module !== 'undefined' && module.exports) module.exports = root.PLOTS;
})(typeof self !== 'undefined' ? self : globalThis);

const CC24=[[0.1736, 0.0787, 0.0533], [0.5595, 0.2773, 0.2119], [0.1051, 0.1896, 0.3269], [0.1051, 0.1502, 0.0522], [0.2289, 0.2135, 0.4235], [0.1145, 0.5066, 0.4123], [0.745, 0.2017, 0.0325], [0.0606, 0.1026, 0.3837], [0.5606, 0.0807, 0.1143], [0.1098, 0.0425, 0.1368], [0.3297, 0.495, 0.0489], [0.769, 0.3566, 0.0253], [0.0225, 0.0487, 0.2808], [0.0444, 0.2907, 0.0646], [0.4464, 0.0368, 0.0407], [0.838, 0.5718, 0.0127], [0.5239, 0.0792, 0.2866], [0.0, 0.2342, 0.3751], [0.8792, 0.8848, 0.835], [0.5844, 0.5921, 0.5846], [0.3577, 0.3671, 0.3653], [0.1901, 0.1909, 0.1898], [0.0859, 0.0887, 0.0898], [0.0314, 0.0315, 0.0323]];
const CC24N=["dark skin", "light skin", "blue sky", "foliage", "blue flower", "bluish green", "orange", "purplish blue", "moderate red", "purple", "yellow green", "orange yellow", "blue", "green", "red", "yellow", "magenta", "cyan", "white 9.5 (.05 D)", "neutral 8 (.23 D)", "neutral 6.5 (.44 D)", "neutral 5 (.70 D)", "neutral 3.5 (1.05 D)", "black 2 (1.5 D)"];

/* Filmbench v2 runtime, part A: diagnostics, units, ops, the parameter table, scenes, image helpers. */
(function (g) {
'use strict';
const V2 = (g.V2 = g.V2 || {});
const { Img } = CV;
const RAW = Symbol('raw');
V2.RAW = RAW;

/* ---------- small helpers ---------- */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const get = (o, p) => String(p).split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setPath(o, p, v) { const ks = String(p).split('.'); let a = o; for (let i = 0; i < ks.length - 1; i++) { if (a[ks[i]] == null || typeof a[ks[i]] !== 'object') a[ks[i]] = {}; a = a[ks[i]]; } a[ks[ks.length - 1]] = v; }
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
function stable(v) { return JSON.stringify(v, (k, x) => (isObj(x) ? Object.keys(x).sort().reduce((o, q) => ((o[q] = x[q]), o), {}) : typeof x === 'function' ? x.toString() : x)); }
function hashStr(s) { // cyrb53
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}
const hash = (v) => hashStr(typeof v === 'string' ? v : stable(v));
const short = (h) => String(h).slice(0, 4) + '…';
function lev(a, b) {
  a = String(a).toLowerCase(); b = String(b).toLowerCase();
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}
function nearest(s, list, n) {
  s = String(s); n = n || 3;
  const sc = list.map((x) => { const xs = String(x), l = s.toLowerCase(), r = xs.toLowerCase(); const last = r.split(/[./]/).pop(); let d = Math.min(lev(s, xs), lev(s, last) + 1); if (r.includes(l) || l.includes(r)) d = Math.min(d, 1); return [x, d]; });
  const lim = Math.max(2, Math.ceil(s.length / 3));
  return sc.filter((e) => e[1] <= lim).sort((a, b) => a[1] - b[1]).slice(0, n).map((e) => e[0]);
}
function diag(code, msg, o) {
  o = o || {};
  const lines = [];
  if (o.mean && o.mean.length) lines.push(['did you mean', o.mean.join(' · ')]);
  for (const k of Object.keys(o.list || {})) { const v = o.list[k]; lines.push([k, Array.isArray(v) ? v.join(' · ') : String(v)]); }
  if (o.fix) lines.push(['fix', o.fix]);
  const pad = Math.max(0, ...lines.map((l) => l[0].length + 1));
  const text = `✗ ${code.padEnd(11)} ${msg}` + lines.map(([k, v]) => `\n  ${(k + ':').padEnd(pad + 1)} ${v}`).join('');
  const e = new Error(text); e.code = code; e.diag = { code, msg, lines }; return e;
}
V2.diag = diag; V2.nearest = nearest; V2.lev = lev;
const warnings = [];
V2.warnings = warnings;
function warn(code, msg, o) {
  const lines = []; if (o && o.fix) lines.push(['fix', o.fix]);
  const w = { code, msg, lines, text: `⚠ ${code.padEnd(11)} ${msg}` + lines.map(([k, v]) => `\n  ${k}: ${v}`).join('') };
  warnings.push(w); if (warnings.length > 200) warnings.shift();
  if (V2.onWarn) V2.onWarn(w); return w;
}
V2.warn = warn;
/* a proxy that turns a typo into a diagnosis */
const PASS = new Set(['then', 'toJSON', 'inspect', 'constructor', 'nodeType', 'asymmetricMatch', 'length', 'prototype', '$$typeof', 'tagName', 'valueOf', 'toString', 'toStringTag']);
function guard(obj, name) {
  return new Proxy(obj, {
    get(t, k, r) {
      if (k === RAW) return t;
      if (typeof k === 'symbol' || k in t || PASS.has(k) || k[0] === '_') return Reflect.get(t, k, r);
      const keys = []; for (let o = t; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) for (const q of Object.getOwnPropertyNames(o)) if (q !== 'constructor' && q[0] !== '_') keys.push(q);
      throw diag('E_MEMBER', `${name} has no member "${k}"`, { mean: nearest(k, keys) });
    },
  });
}
V2.guard = guard;
const raw = (o) => (o && o[RAW]) || o;
V2.raw = raw;

/* ---------- units, param constructors, ops, numerics ---------- */
function mkUnit(name) { const f = (v) => ({ v, unit: name, valueOf: () => v, toString: () => `${v} ${name}` }); f.unit = name; f.toString = () => name; return f; }
const units = { CC: mkUnit('CC'), EV: mkUnit('EV'), STOPS: mkUnit('stops'), PCT: mkUnit('%'), UM: mkUnit('µm'), DE: mkUnit('ΔE'), X: mkUnit('×') };
const unitName = (u) => (typeof u === 'function' ? u.unit : u == null ? '' : String(u));
const p = {
  slider: (o) => Object.assign({ kind: 'num', widget: 'slider', step: 0.01 }, o),
  stepper: (o) => Object.assign({ kind: 'num', widget: 'stepper', step: 1 }, o),
  toggle: (o) => Object.assign({ kind: 'bool', widget: 'toggle' }, o),
  choice: (o) => Object.assign({ kind: 'enum', widget: 'select' }, o),
  text: (o) => Object.assign({ kind: 'text', widget: 'text' }, o),
};
const op = {
  set: (v) => ({ k: 'set', v }), add: (v) => ({ k: 'add', v }), mul: (v) => ({ k: 'mul', v }), stops: (v) => ({ k: 'stops', v }),
  keep: { k: 'keep' },
  rgb: (path, vals, fn) => { const o = {}; vals.forEach((v, i) => { o[path + '.' + i] = fn(v); }); return o; },
};
const isOp = (x) => x && typeof x === 'object' && typeof x.k === 'string';
function interp(pts, x) {
  if (x <= pts[0][0]) return pts[0][1]; const n = pts.length; if (x >= pts[n - 1][0]) return pts[n - 1][1];
  for (let i = 1; i < n; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + ((y1 - y0) * (x - x0)) / ((x1 - x0) || 1); }
  return pts[n - 1][1];
}
interp.inverse = (pts, y) => interp(pts.map(([a, b]) => [b, a]).sort((u, v) => u[0] - v[0]), y);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / ((b - a) || 1), 0, 1); return t * t * (3 - 2 * t); };
const luma = (px) => CV.lumaE(px[0], px[1], px[2]);
const zoneOf = (L) => { const Y = Math.pow((L + 16) / 116, 3); return 5 + Math.log2(Math.max(Y, 1e-6) / 0.184); };
function curve1D(n, f, o) {
  o = o || {}; const lo = o.lo == null ? 0 : o.lo, hi = o.hi == null ? 4 : o.hi, t = new Float32Array(n);
  for (let i = 0; i < n; i++) t[i] = f(lo + ((hi - lo) * i) / (n - 1));
  const fn = (x) => { const f0 = clamp((x - lo) / (hi - lo), 0, 1) * (n - 1), i = Math.min(n - 2, f0 | 0), a = f0 - i; return t[i] + (t[i + 1] - t[i]) * a; };
  fn.table = t; return fn;
}
Object.assign(V2, { units, unitName, p, op, isOp, interp, smoothstep, luma, zoneOf, curve1D, clamp, get, setPath, clone, stable, hash, short, isObj });

/* ---------- the parameter table ---------- */
const N = (path, label, min, max, step, o) => Object.assign({ path, label, kind: 'num', min, max, step }, o);
const T = (path, label, o) => Object.assign({ path, label, kind: 'bool' }, o);
const SEL = (path, label, opts, o) => Object.assign({ path, label, kind: 'enum', opts, widget: 'select' }, o);
const SEG = (path, label, opts, o) => Object.assign({ path, label, kind: 'enum', opts, widget: 'segmented' }, o);
const RGB3 = ['R', 'G', 'B'];
const GROUPS = [
  { id: 'stock', title: 'Stock', sub: 'film and paper', rows: [
    { path: 'film', label: 'Film', kind: 'id', role: 'film' },
    { path: 'print', label: 'Paper', kind: 'id', role: 'print' },
  ] },
  { id: 'exposure', title: 'Exposure', sub: 'camera', rows: [
    T('camera.auto', 'Auto exposure'),
    SEL('camera.method', 'Metering', [['center_weighted', 'Centre-weighted'], ['average', 'Average'], ['median', 'Median'], ['highlight_weighted', 'Highlights'], ['partial', 'Partial spot']], { dis: (P) => P.camera.auto === false }),
    N('camera.ev', 'Offset', -5, 5, 0.05, { unit: 'EV' }),
  ] },
  { id: 'film', title: 'Film response', sub: 'density curves', rows: [
    N('film_render.gamma', 'Contrast γ', 0.4, 2.5, 0.01),
    ...RGB3.map((c, i) => N('film_render.gamma_rgb.' + i, 'γ ' + c, 0.5, 1.6, 0.01)),
    ...RGB3.map((c, i) => N('film_render.speed_ev.' + i, 'Speed ' + c, -2, 2, 0.05, { unit: 'EV' })),
    ...RGB3.map((c, i) => N('film_render.dye_scale.' + i, 'Dye ' + c, 0.4, 1.6, 0.01)),
    N('film_render.format_mm', 'Frame width', 8, 120, 1, { unit: 'mm' }),
  ] },
  { id: 'dir', title: 'DIR couplers', sub: 'inter-layer inhibition', rows: [
    T('film_render.dir.active', 'Active'),
    N('film_render.dir.amount', 'Amount', 0, 2.5, 0.01),
    N('film_render.dir.same', 'Same-layer', 0, 3, 0.01),
    N('film_render.dir.inter', 'Inter-layer', 0, 3, 0.01),
    N('film_render.dir.diffusion_um', 'Diffusion', 0, 150, 1, { unit: 'µm' }),
  ] },
  { id: 'grain', title: 'Grain and halation', sub: 'spatial', rows: [
    T('film_render.grain.active', 'Grain'),
    N('film_render.grain.amount', 'Grain amount', 0, 4, 0.05),
    N('film_render.grain.size_um', 'Grain size', 3, 45, 0.5, { unit: 'µm' }),
    N('film_render.grain.seed', 'Grain seed', 1, 99, 1),
    T('film_render.halation.active', 'Halation'),
    N('film_render.halation.amount', 'Halation amount', 0, 4, 0.05),
  ] },
  { id: 'enlarger', title: 'Enlarger', sub: 'colour head and exposure', rows: [
    SEL('enlarger.illuminant', 'Light source', [['TH-KG3', 'Halogen (TH-KG3)'], ['T', 'Tungsten'], ['K75P', 'K75P'], ['D50', 'D50'], ['D55', 'D55'], ['D65', 'D65']]),
    N('enlarger.c_shift', 'Cyan filter', -60, 60, 0.5, { unit: 'CC' }),
    N('enlarger.m_shift', 'Magenta filter', -60, 60, 0.5, { unit: 'CC' }),
    N('enlarger.y_shift', 'Yellow filter', -60, 60, 0.5, { unit: 'CC' }),
    N('enlarger.print_exposure', 'Print exposure', 0.25, 4, 0.01, { log: true, unit: '×' }),
    T('enlarger.comp', 'Compensate EV'),
    T('enlarger.normalize', 'Normalise midgray'),
  ] },
  { id: 'paper', title: 'Paper development', sub: 'print contrast', rows: [
    T('print_render.morph.active', 'Reshape curves'),
    N('print_render.morph.gamma', 'Gamma', 0.5, 2.2, 0.01),
    N('print_render.morph.fast', 'Fast layer', 0.5, 2, 0.01),
    N('print_render.morph.slow', 'Slow layer', 0.5, 2, 0.01),
    ...['r', 'g', 'b'].map((c, i) => N('print_render.morph.' + c, 'Gamma ' + RGB3[i], 0.5, 1.6, 0.01)),
    N('print_render.morph.exhaustion', 'Exhaustion', 0, 1, 0.01),
    N('print_render.glare', 'Surface glare', 0, 4, 0.01, { unit: '%' }),
  ] },
  { id: 'output', title: 'Output', sub: 'display', rows: [
    SEG('output.gamut', 'Gamut', [['off', 'Off'], ['clip', 'Clip'], ['soft', 'Soft']]),
  ] },
];
class ParamTable {
  constructor() {
    this.rows = new Map(); this.groups = [];
    const def = FB.defaultParams();
    for (const gr of GROUPS) { const G = { id: gr.id, title: gr.title, sub: gr.sub, rows: [] }; this.groups.push(G); for (const r of gr.rows) { const row = Object.assign({}, r, { group: gr.id, def: get(def, r.path) }); this.rows.set(row.path, row); G.rows.push(row); } }
    // leaves of the default tree that have no row (null neutrals, seed...) are still legal paths
    this.extra = new Set(); (function w(o, pre, self) { for (const k of Object.keys(o)) { const q = pre ? pre + '.' + k : k, v = o[k]; if (isObj(v)) w(v, q, self); else if (Array.isArray(v)) v.forEach((_, i) => { if (!self.rows.has(q + '.' + i)) self.extra.add(q + '.' + i); }); else if (!self.rows.has(q)) self.extra.add(q); } })(def, '', this);
  }
  has(path) { return this.rows.has(path) || this.extra.has(path); }
  row(path) { return this.rows.get(path) || null; }
  paths() { return [...this.rows.keys(), ...this.extra]; }
  add(spec) {
    const row = Object.assign({ label: spec.path.split('.').pop(), group: spec.group || 'custom' }, spec);
    if (row.kind === 'num' && row.value !== undefined && row.def === undefined) row.def = row.value;
    if (row.def === undefined && row.value !== undefined) row.def = row.value;
    this.rows.set(row.path, row);
    let G = this.groups.find((x) => x.id === row.group); if (!G) { G = { id: row.group, title: row.group, sub: 'added by a script', rows: [] }; this.groups.push(G); }
    const i = G.rows.findIndex((r) => r.path === row.path); if (i >= 0) G.rows[i] = row; else G.rows.push(row);
    return row;
  }
  check(path) {
    if (this.has(path)) return this.rows.get(path) || { path, kind: 'num', label: path.split('.').pop() };
    const all = this.paths(); const pre = path.split('.').slice(0, -1).join('.');
    const sib = pre ? all.filter((q) => q.startsWith(pre + '.') && q.split('.').length === path.split('.').length).map((q) => q.split('.').pop()) : [];
    throw diag('E_PATH', `no parameter "${path}"`, { mean: nearest(path, all), list: sib.length ? { siblings: sib } : {} });
  }
}
V2.ParamTable = ParamTable; V2.GROUPS = GROUPS;
/* validate and coerce a value for a path; returns {v, clamped} */
function coerce(row, path, value) {
  if (!row) return { v: value };
  if (row.kind === 'num') {
    const v = Number(value); if (!Number.isFinite(v)) throw diag('E_VALUE', `"${path}" needs a number, got ${JSON.stringify(value)}`);
    let c = v; if (row.min !== undefined) c = Math.max(row.min, c); if (row.max !== undefined) c = Math.min(row.max, c);
    return { v: c, clamped: c !== v };
  }
  if (row.kind === 'bool') { if (typeof value !== 'boolean') throw diag('E_VALUE', `"${path}" is on/off; use true or false`); return { v: value }; }
  if (row.kind === 'enum' && row.opts) {
    const ids = row.opts.map((o) => (Array.isArray(o) ? o[0] : o));
    if (!ids.includes(value)) throw diag('E_VALUE', `"${value}" is not an option of "${path}"`, { mean: nearest(value, ids), list: { options: ids } });
  }
  return { v: value };
}
V2.coerce = coerce;

/* ---------- scenes ---------- */
function mulb(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
V2.makeScenes = function (CC24) {
  function sceneChart() {
    const W = 960, H = 640, d = new Float32Array(W * H * 3); d.fill(0.05);
    const put = (x0, y0, x1, y1, c) => { for (let y = Math.max(0, y0 | 0); y < Math.min(H, y1 | 0); y++) for (let x = Math.max(0, x0 | 0); x < Math.min(W, x1 | 0); x++) { const k = (y * W + x) * 3; d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; } };
    const pw = 134, ph = 96, gx = 12, ox = (W - (6 * pw + 5 * gx)) / 2, oy = 28;
    for (let i = 0; i < 24; i++) { const cx = i % 6, cy = (i / 6) | 0; put(ox + cx * (pw + gx), oy + cy * (ph + gx), ox + cx * (pw + gx) + pw, oy + cy * (ph + gx) + ph, CC24[i]); }
    const wy = oy + 4 * (ph + gx) + 6, ww = (W - 2 * ox) / 12;
    for (let i = 0; i < 12; i++) { const v = 0.184 * Math.pow(2, i - 7); put(ox + i * ww, wy, ox + (i + 1) * ww, wy + 58, [v, v, v]); }
    for (let x = Math.round(ox); x < W - ox; x++) { const t = (x - ox) / (W - 2 * ox), v = 0.0015 * Math.pow(2, t * 13); for (let y = wy + 66; y < wy + 92; y++) { const k = (y * W + x) * 3; d[k] = d[k + 1] = d[k + 2] = v; } }
    const prim = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 1, 1], [1, 0, 1], [1, 1, 0]];
    for (let r = 0; r < 2; r++) for (let i = 0; i < 6; i++) { const lv = r ? 0.06 : 0.35; put(ox + i * (pw + gx), wy + 98 + r * 24, ox + i * (pw + gx) + pw, wy + 98 + r * 24 + 20, prim[i].map((v) => v * lv + 0.004)); }
    const mx = ox + 2 * (pw + gx), my = oy + 3 * (ph + gx);
    return { name: 'Test chart', w: W, h: H, lin: d, midgray: [(mx + 30) / W, (my + 20) / H, (pw - 60) / W, (ph - 40) / H] };
  }
  function sceneStill() {
    const W = 960, H = 640, d = new Float32Array(W * H * 3), rnd = mulb(11);
    const L = [-0.55, -0.62, 0.56], ln = Math.hypot(...L); L[0] /= ln; L[1] /= ln; L[2] /= ln;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = (y * W + x) * 3, tbl = y > 410; let r, gg, b;
      if (tbl) { const t = (y - 410) / 230; r = 0.16 - 0.09 * t; gg = 0.09 - 0.05 * t; b = 0.05 - 0.03 * t; const lin = 1 + 0.18 * Math.sin(x * 0.9 + Math.sin(y * 0.2) * 3) * Math.sin(y * 0.05); r *= lin; gg *= lin; b *= lin; }
      else { const t = y / 410; r = 0.34 - 0.12 * t; gg = 0.29 - 0.11 * t; b = 0.22 - 0.09 * t; const v = 1 - 0.55 * Math.pow(Math.hypot((x - 480) / 700, (y - 260) / 520), 2); r *= v; gg *= v; b *= v; const tex = 1 + 0.05 * (rnd() - 0.5) + 0.025 * Math.sin(x * 1.7 + y * 0.4); r *= tex; gg *= tex; b *= tex; }
      d[k] = r; d[k + 1] = gg; d[k + 2] = b;
    }
    for (let y = 60; y < 330; y++) for (let x = 70; x < 310; x++) {
      const k = (y * W + x) * 3, mull = (Math.abs(x - 190) < 5) || (Math.abs(y - 195) < 5), t = (y - 60) / 270;
      if (mull) { d[k] = 0.25; d[k + 1] = 0.22; d[k + 2] = 0.18; continue; }
      const s = 5.5 * (1 - 0.45 * t); d[k] = s * 0.85; d[k + 1] = s * 0.97; d[k + 2] = s * 1.2;
      const sd = Math.hypot(x - 245, y - 125); if (sd < 22) { const q = 40 * Math.exp(-sd * sd / 160); d[k] += q; d[k + 1] += q * 0.95; d[k + 2] += q * 0.85; }
    }
    const blobShadow = (cx, cy, rx, ry, a) => { for (let y = Math.max(0, cy - ry * 2 | 0); y < Math.min(H, cy + ry * 2); y++) for (let x = Math.max(0, cx - rx * 2 | 0); x < Math.min(W, cx + rx * 2); x++) { const q = Math.exp(-(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2)); const k = (y * W + x) * 3, f = 1 - a * q; d[k] *= f; d[k + 1] *= f; d[k + 2] *= f; } };
    const spheres = [
      [250, 470, 46, [0.184, 0.184, 0.184], 0.04], [350, 430, 62, [0.05, 0.1, 0.62], 0.08], [480, 380, 92, [0.62, 0.05, 0.05], 0.1], [560, 475, 42, [0.8, 0.8, 0.8], 0.08],
      [650, 420, 72, [0.07, 0.5, 0.1], 0.1], [780, 385, 86, [0.46, 0.27, 0.2], 0.03], [885, 478, 40, [0.03, 0.03, 0.03], 0.15],
    ];
    for (const s of spheres) blobShadow(s[0] + s[2] * 0.75, s[1] + s[2] * 0.82, s[2] * 1.15, s[2] * 0.34, 0.55);
    for (const [cx, cy, R, alb, spec] of spheres) for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) {
      const dx = (x - cx) / R, dy = (y - cy) / R, q = dx * dx + dy * dy; if (q > 1) continue;
      const nz = Math.sqrt(1 - q), dl = Math.max(0, dx * L[0] + dy * L[1] + nz * L[2]);
      const hx = L[0], hy = L[1], hz = L[2] + 1, hn = Math.hypot(hx, hy, hz), sp = Math.pow(Math.max(0, (dx * hx + dy * hy + nz * hz) / hn), 60) * spec * 14;
      const edge = Math.min(1, (1 - Math.sqrt(q)) * R * 0.8), k = ((y | 0) * W + (x | 0)) * 3, ls = 1.6 * dl + 0.1;
      for (let c = 0; c < 3; c++) d[k + c] = (d[k + c] * (1 - edge) + (alb[c] * ls + sp * (0.9 + 0.1 * c)) * edge);
    }
    for (let y = 40; y < 180; y++) for (let x = 800; x < 940; x++) { const dx = x - 870, dy = y - 110, r = Math.hypot(dx, dy); if (r > 66) continue; const on = Math.sin(Math.atan2(dy, dx) * 18) > 0, v = on ? 0.9 : 0.03; const k = (y * W + x) * 3; d[k] = d[k + 1] = d[k + 2] = v; }
    return { name: 'Still life (HDR)', w: W, h: H, lin: d, midgray: [230 / W, 450 / H, 40 / W, 40 / H] };
  }
  return { chart: sceneChart, still: sceneStill };
};

/* ---------- image helpers: Lab, means, percentiles, rect crops ---------- */
const WP = [0.95047, 1, 1.08883];
function labToRgb(L, a, b) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200, f3 = (t) => (t > 6 / 29 ? t * t * t : 3 * (6 / 29) * (6 / 29) * (t - 4 / 29));
  const X = WP[0] * f3(fx), Y = f3(fy), Z = WP[2] * f3(fz);
  return [3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z, -0.969266 * X + 1.8760108 * Y + 0.041556 * Z, 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z].map((v) => CV.enc(v));
}
class LabImg {
  constructor(w, h, data) { this.w = w; this.h = h; this.data = data; }
  mean() { const d = this.data, n = this.w * this.h; let a = 0, b = 0, c = 0; for (let i = 0; i < n; i++) { a += d[i * 3]; b += d[i * 3 + 1]; c += d[i * 3 + 2]; } return [a / n, b / n, c / n]; }
  std() { const m = this.mean(), d = this.data, n = this.w * this.h; let a = 0, b = 0, c = 0; for (let i = 0; i < n; i++) { a += (d[i * 3] - m[0]) ** 2; b += (d[i * 3 + 1] - m[1]) ** 2; c += (d[i * 3 + 2] - m[2]) ** 2; } return [Math.sqrt(a / n), Math.sqrt(b / n), Math.sqrt(c / n)]; }
  map(fn) { const o = new Float32Array(this.data.length), d = this.data, n = this.w * this.h; for (let i = 0; i < n; i++) { const r = fn([d[i * 3], d[i * 3 + 1], d[i * 3 + 2]], i % this.w, (i / this.w) | 0); o[i * 3] = r[0]; o[i * 3 + 1] = r[1]; o[i * 3 + 2] = r[2]; } return new LabImg(this.w, this.h, o); }
  toRGB() { const o = new Float32Array(this.data.length), d = this.data, n = this.w * this.h; for (let i = 0; i < n; i++) { const c = labToRgb(d[i * 3], d[i * 3 + 1], d[i * 3 + 2]); o[i * 3] = c[0]; o[i * 3 + 1] = c[1]; o[i * 3 + 2] = c[2]; } return new Img(this.w, this.h, o, { space: 'srgb' }); }
  toString() { return `LabImg ${this.w}×${this.h}`; }
}
V2.LabImg = LabImg; V2.labToRgb = labToRgb;
const origCrop = Img.prototype.crop;
Img.prototype.crop = function (x, y, w, h) {
  if (Array.isArray(x)) { const r = x; return origCrop.call(this, r[0] * this.w, r[1] * this.h, r[2] * this.w, r[3] * this.h); }
  return origCrop.call(this, x, y, w, h);
};
Img.prototype.lab = function () {
  const n = this.w * this.h, o = new Float32Array(n * 3), d = this.data, lin = this.meta.space === 'linear';
  for (let i = 0; i < n; i++) { let r = d[i * 3], gg = d[i * 3 + 1], b = d[i * 3 + 2]; if (lin) { r = CV.enc(r); gg = CV.enc(gg); b = CV.enc(b); } const l = CV.lab(r, gg, b); o[i * 3] = l[0]; o[i * 3 + 1] = l[1]; o[i * 3 + 2] = l[2]; }
  return new LabImg(this.w, this.h, o);
};
Img.prototype.mean = function () { const d = this.data, n = this.w * this.h; let a = 0, b = 0, c = 0; for (let i = 0; i < n; i++) { a += d[i * 3]; b += d[i * 3 + 1]; c += d[i * 3 + 2]; } return [a / n, b / n, c / n]; };
Img.prototype.percentiles = function (ps, ch) {
  const n = this.w * this.h, step = Math.max(1, Math.floor(n / 40000)), s = [], d = this.data;
  for (let i = 0; i < n; i += step) s.push(ch === undefined ? (d[i * 3] + d[i * 3 + 1] + d[i * 3 + 2]) / 3 : d[i * 3 + ch]);
  s.sort((a, b) => a - b); return ps.map((q) => s[Math.min(s.length - 1, Math.max(0, Math.round((q / 100) * (s.length - 1))))]);
};
function dE2000(l1, l2) {
  const [L1, a1, b1] = l1, [L2, a2, b2] = l2, rad = Math.PI / 180, deg = 180 / Math.PI;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2, G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2, C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h1p = C1p === 0 ? 0 : (Math.atan2(b1, a1p) * deg + 360) % 360, h2p = C2p === 0 ? 0 : (Math.atan2(b2, a2p) * deg + 360) % 360;
  const dLp = L2 - L1, dCp = C2p - C1p; let dhp = 0;
  if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2), Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p; if (C1p * C2p !== 0) { if (Math.abs(h1p - h2p) > 180) hbp += h1p + h2p < 360 ? 360 : -360; hbp /= 2; }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const dth = 30 * Math.exp(-(((hbp - 275) / 25) ** 2)), Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2), Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T, Rt = -Math.sin(2 * dth * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}
V2.dE2000 = dE2000;
/* mean ΔE2000 between two srgb Imgs of the same size */
V2.meanDE = function (a, b, gainOnly) {
  const la = a.lab().data, lb = (b.w === a.w && b.h === a.h ? b : b.resize(a.w, a.h, true)).lab().data, n = a.w * a.h; let s = 0;
  for (let i = 0; i < n; i++) s += dE2000([la[i * 3], la[i * 3 + 1], la[i * 3 + 2]], [lb[i * 3], lb[i * 3 + 1], lb[i * 3 + 2]]);
  return s / n;
};
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* Filmbench v2 runtime, part B: the pipeline network (chain and graph), evaluation with a shared cache, forks, compare sets. */
(function (g) {
'use strict';
const V2 = g.V2;
const { diag, nearest, hash, clamp, get, setPath, clone, guard, raw, stable, isObj } = V2;
const { Img } = CV;
const TAP_TYPE = { src: 'Scene', log_e_film: 'LogExposure', cmy_film: 'Density', log_e_print: 'LogExposure', cmy_print: 'Density', out: 'RGB' };
const CORE_KEYS = ['film', 'print', 'camera', 'film_render', 'enlarger', 'print_render', 'output', 'lut2_n'];
const engines = {
  film: { fused: { slot: 'film', name: 'fused' }, staged: { slot: 'film', name: 'staged' }, auto: { slot: 'film', name: 'auto' } },
  paper: { cdf: { slot: 'paper', name: 'cdf' }, measured: { slot: 'paper', name: 'measured' } },
  scan: { lut33: { slot: 'scan', name: 'lut33' }, spectral: { slot: 'scan', name: 'spectral' } },
  dag: { slot: 'graph', name: 'dag' },
};
const SLOTS = { film: ['fused', 'staged'], paper: ['cdf', 'measured'], scan: ['lut33', 'spectral'] };
V2.engines = engines; V2.TAP_TYPE = TAP_TYPE;

const fmtMs = (ms) => (ms < 10 ? ms.toFixed(1) : Math.round(ms)) + ' ms';
class Report { // a result that prints as the lines the docs show
  constructor(lines, data) { this.lines = lines; if (data) Object.assign(this, data); }
  toString() { return this.lines.join('\n'); }
}
V2.Report = Report;

/* ---------- the shared cache ---------- */
class Cache {
  constructor(limit) { this.m = new Map(); this.bytes = 0; this.limit = limit || 360e6; this.hits = 0; this.misses = 0; }
  get(k) { const e = this.m.get(k); if (!e) { this.misses++; return null; } this.m.delete(k); this.m.set(k, e); this.hits++; return e; }
  set(k, e) { if (this.m.has(k)) return; e.bytes = (e.frame.data ? e.frame.data.byteLength : 0) + 64; this.m.set(k, e); this.bytes += e.bytes; while (this.bytes > this.limit && this.m.size > 1) { const [kk, ee] = this.m.entries().next().value; this.m.delete(kk); this.bytes -= ee.bytes; } }
  clear() { this.m.clear(); this.bytes = 0; }
}
V2.Cache = Cache;

/* ---------- the network ---------- */
class Net {
  constructor(wb, name, kind) {
    this.wb = wb; this.name = name; this.kind = kind || 'pipe';
    this.stages = []; this.ids = { film: null, print: null }; this.overlay = {}; this.engines = { film: 'auto', paper: 'cdf', scan: 'lut33' }; this.pinned = { film: false, paper: false, scan: false };
    this.parent = null; this.out = null; this.root = true; this.nodeSeq = {};
  }
  /* ----- reading ----- */
  get taps() { return this.stages.map((s) => s.tap); }
  get stageNames() { return this.stages.map((s) => s.id); }
  get params() { return Object.assign({ groups: ['camera', 'film_render', 'enlarger', 'print_render', 'output'], ids: ['film', 'print'] }); }
  get slots() { return new Report(Object.keys(SLOTS).map((k) => `${k.padEnd(6)} [${SLOTS[k].join(', ')}]`), { film: SLOTS.film, paper: SLOTS.paper, scan: SLOTS.scan }); }
  stage(id) { return this.stages.find((s) => s.id === id) || null; }
  byTap(tap) { return this.stages.find((s) => s.tap === tap) || null; }
  tapType(tap) { const s = this.byTap(tap); return s ? s.type : TAP_TYPE[tap]; }
  checkTap(tap) {
    if (!this.byTap(tap)) throw diag('E_TAP', `no tap "${tap}" on ${this.kind === 'graph' ? 'graph' : 'pipeline'} "${this.name}"`, { mean: nearest(tap, this.taps), list: { taps: this.taps } });
    return this.byTap(tap);
  }
  outStage() { return this.stages.find((s) => s.id === this.out) || this.stages[this.stages.length - 1]; }
  capabilities() { const c = ['taps']; if (this.stages.some((s) => s.kind === 'mask')) c.push('mask'); if (this.kind === 'graph') c.push('dag'); c.push('spatial'); return c; }
  isPlain() {
    const k = this.stages.map((s) => s.kind).join(',');
    return k === 'scene,film.expose,film.develop,enlarger,paper,scan' && !this.stages.some((s) => s.mask || (s.opts && Object.keys(s.opts).some((o) => o !== 'scene')));
  }
  /* ----- builder (chain) ----- */
  _push(st) { st.node = st.node || st.id; this.stages.push(st); return st; }
  _needScene(what) { if (!this.stages.length) throw diag('E_ORDER', `${what}() needs a scene first`, { fix: `start with .scene("chart")` }); }
  scene(id) {
    const sc = this.wb.scenes; if (!sc[id]) throw diag('E_SCENE', `no scene "${id}"`, { mean: nearest(id, Object.keys(sc)), list: { scenes: Object.keys(sc) } });
    const s = this.stage('scene'); if (s) s.opts.scene = id; else this._push({ id: 'scene', tap: 'src', kind: 'scene', in: [], opts: { scene: id }, type: 'Scene' });
    this.out = this.out || 'scene'; return this;
  }
  _stock(slot, id) {
    const role = slot, st = this.wb.stock(id);
    if (!st) throw diag('E_VALUE', `"${id}" is not a ${role === 'film' ? 'film' : 'print'} stock`, { mean: nearest(id, this.wb.stockIds(role)) });
    if (st.role !== role) throw diag('E_VALUE', `"${id}" is a ${st.role}; ${role === 'film' ? 'film' : 'paper'}() needs a ${role}`, { mean: nearest(id, this.wb.stockIds(role)) });
    if (this.root && this.kind === 'pipe') this.wb.params._setBase(slot, id, 'script'); else this.ids[slot] = id;
  }
  film(id) {
    this._needScene('film'); this._stock('film', id);
    if (!this.stage('film.expose')) { this._push({ id: 'film.expose', node: 'film', tap: 'log_e_film', kind: 'film.expose', in: ['scene'], opts: {}, type: 'LogExposure' }); this._push({ id: 'film.develop', node: 'film', tap: 'cmy_film', kind: 'film.develop', in: ['film.expose'], opts: {}, type: 'Density' }); }
    return this;
  }
  enlarger(opts) {
    if (!this.stage('film.develop')) throw diag('E_ORDER', 'enlarger() needs a film first', { fix: 'chain .film("…") before .enlarger()' });
    if (!this.stage('enlarger')) this._push({ id: 'enlarger', tap: 'log_e_print', kind: 'enlarger', in: ['film.develop'], opts: opts || {}, type: 'LogExposure' });
    else Object.assign(this.stage('enlarger').opts, opts || {});
    return this;
  }
  paper(id) {
    if (!this.stage('enlarger')) throw diag('E_ORDER', 'paper() needs an enlarger first', { fix: 'chain .enlarger() before .paper("…")' });
    this._stock('print', id);
    if (!this.stage('paper')) this._push({ id: 'paper', tap: 'cmy_print', kind: 'paper', in: ['enlarger'], opts: {}, type: 'Density' });
    return this;
  }
  scan() {
    const last = this.stage('paper') || this.stage('film.develop'); if (!last) throw diag('E_ORDER', 'scan() needs a paper or a film first');
    if (!this.stage('scan')) this._push({ id: 'scan', tap: 'out', kind: 'scan', in: [last.id], opts: {}, type: 'RGB' });
    this.out = 'scan'; return this;
  }
  /* ----- engines ----- */
  swap(slot, eng) { if (eng && eng.slot) { if (eng.slot !== slot) throw diag('E_ENGINE', `engine "${eng.name}" belongs to slot "${eng.slot}", not "${slot}"`); return this.engine(slot, eng.name); } return this.engine(slot, eng); }
  engine(slot, name) {
    if (!SLOTS[slot]) throw diag('E_SLOT', `no slot "${slot}"`, { mean: nearest(slot, Object.keys(SLOTS)), list: { slots: Object.keys(SLOTS) } });
    if (slot === 'film' && name === 'auto') { this.engines.film = 'auto'; this.pinned.film = false; this.wb._touch(); return this; }
    if (!SLOTS[slot].includes(name)) throw diag('E_ENGINE', `slot "${slot}" has no engine "${name}"`, { mean: nearest(name, SLOTS[slot]), list: { engines: SLOTS[slot].concat(slot === 'film' ? ['auto'] : []) } });
    this.engines[slot] = name; this.pinned[slot] = true; this.wb._touch(); return this;
  }
  explain() {
    const dem = this.wb.demand(this), mid = dem.filter((d) => d.tap !== 'out' && d.tap !== 'src');
    const out = {};
    if (this.engines.film !== 'auto') out.film = { engine: this.engines.film, why: '(pinned)', pinned: true };
    else if (mid.length) out.film = { engine: 'staged', why: `because ${mid[0].by} reads ${mid[0].tap}` + (mid.length > 1 ? ` (+${mid.length - 1} more)` : ''), pinned: false };
    else out.film = { engine: 'fused', why: 'nobody reads a mid tap', pinned: false };
    out.paper = { engine: this.engines.paper, why: this.pinned.paper ? '(pinned)' : 'default', pinned: this.pinned.paper };
    out.scan = { engine: this.engines.scan === 'spectral' ? 'spectral' : 'lut33', why: this.pinned.scan ? '(pinned)' : 'default', pinned: this.pinned.scan };
    const lines = Object.keys(out).map((k) => `${k.padEnd(6)} ${out[k].engine.padEnd(8)} ${out[k].why}`);
    return new Report(lines, out);
  }
  /* ----- insert a custom stage at a tap ----- */
  insert(def, o) {
    o = o || {}; const after = o.after;
    if (!def || def.__stage !== true) throw diag('E_ARG', 'insert() needs a stage made with wb.stage(name, {…})', { fix: 'const s = wb.stage("name", { from, to, eval })' });
    if (!after) throw diag('E_ARG', 'insert() needs { after: "<tap>" }', { list: { taps: this.taps } });
    const at = this.checkTap(after);
    if (at.type !== def.from) {
      const legal = this.stages.filter((s) => s.type === def.from).map((s) => s.tap);
      throw diag('E_PORT_TYPE', `${def.name} takes ${def.from} but tap "${after}" carries ${at.type}`, { list: { 'legal after': legal } });
    }
    if (this.stage(def.name)) throw diag('E_DUPLICATE', `${this.kind === 'graph' ? 'graph' : 'pipeline'} "${this.name}" already has a stage named "${def.name}"`, { fix: `rig.remove("${def.name}") first, or give the stage another name` });
    const rec = { id: def.name, tap: def.name, kind: 'custom', in: [at.id], opts: {}, type: def.to, def, node: def.name };
    const i = this.stages.indexOf(at);
    for (const s of this.stages) { s.in = s.in.map((x) => (x === at.id ? def.name : x)); if (s.mask === at.id) s.mask = def.name; }
    rec.in = [at.id]; this.stages.splice(i + 1, 0, rec);
    if (this.out === at.id) this.out = def.name;
    this.wb._touch(); return this;
  }
  remove(name) {
    const s = this.stage(name); if (!s) throw diag('E_STAGE', `no stage "${name}"`, { mean: nearest(name, this.stageNames) });
    for (const t of this.stages) t.in = t.in.map((x) => (x === s.id ? s.in[0] : x));
    if (this.out === s.id) this.out = s.in[0]; this.stages.splice(this.stages.indexOf(s), 1); this.wb._touch(); return this;
  }
  drop(...names) {
    for (const n of names) { const s = this.stage(n); if (!s) throw diag('E_STAGE', `no stage "${n}"`, { mean: nearest(n, this.stageNames) }); }
    for (const n of names) { const s = this.stage(n); const prev = s.in[0]; for (const t of this.stages) t.in = t.in.map((x) => (x === n ? prev : x)); this.stages.splice(this.stages.indexOf(s), 1); if (this.out === n) this.out = prev; }
    this.wb._touch(); return this;
  }
  /* ----- forks ----- */
  fork(name) {
    const f = new Net(this.wb, name || this.name + ' fork', this.kind);
    f.stages = this.stages.map((s) => ({ ...s, in: s.in.slice(), opts: clone(s.opts || {}) })); f.out = this.out;
    f.ids = Object.assign({}, this.ids); f.overlay = clone(this.overlay); f.engines = Object.assign({}, this.engines); f.pinned = Object.assign({}, this.pinned);
    f.parent = this.name; f.root = false; this.wb._register(f); return f;
  }
  set(patch) { for (const k of Object.keys(patch)) { if (k !== 'film' && k !== 'print') this.wb.table.check(k); this.overlay[k] = patch[k]; } this.wb._touch(); return this; }
  /* ----- evaluation ----- */
  at(tap) { const st = this.checkTap(tap), net = this; return { tap, type: st.type, eval: (o) => net.eval(tap, o).img }; }
  ctxFor(o) {
    o = o || {}; const wb = this.wb, scope = o.scope || {};
    let R;
    const mk = Object.keys(scope).filter((k) => k.startsWith('macro.'));
    if (o.params) R = clone(o.params);
    else if (mk.length) { const map = {}; for (const k of mk) map[k.slice(6)] = scope[k]; R = clone(wb.params.withMacros(map)); }
    else R = clone(wb.params.effective());
    if (this.ids.film) R.film = this.ids.film; if (this.ids.print) R.print = this.ids.print;
    for (const k of Object.keys(this.overlay)) setPath(R, k, this.overlay[k]);
    let sceneId = (this.stage('scene') || { opts: {} }).opts.scene || 'chart';
    for (const k of Object.keys(scope)) { if (k === 'scene') sceneId = scope[k]; else if (!k.startsWith('macro.')) setPath(R, k, scope[k]); }
    if (this.engines.paper === 'measured') R.print_render = Object.assign({}, R.print_render, { morph: Object.assign({}, R.print_render.morph, { active: false }) });
    if (this.engines.scan === 'spectral') R.lut2_n = 65;
    const sc = wb.scenes[sceneId]; if (!sc) throw diag('E_SCENE', `no scene "${sceneId}"`, { mean: nearest(sceneId, Object.keys(wb.scenes)) });
    const base = wb.sceneBase(sceneId);
    let w = o.w, h = o.h; const max = o.max || 640;
    if (!w && !h) { w = base.w; h = base.h; const f = Math.min(1, max / Math.max(w, h)); w = Math.round(w * f); h = Math.round(h * f); }
    else if (w && !h) h = Math.max(1, Math.round((w * base.h) / base.w)); else if (h && !w) w = Math.max(1, Math.round((h * base.w) / base.h));
    return { wb, net: this, P: R, sceneId, w, h, notes: o.notes || [], log: [], memo: new Map(), demand: o.demand || null, mids: o.mids || false, scene: sc, forceStaged: !!o.staged };
  }
  plan(ctx) { return this.wb.plan(ctx.P); }
  keyOf(st, ctx) {
    if (ctx.memo.has(st.id)) return ctx.memo.get(st.id);
    const P = ctx.P, fr = P.film_render; let sl;
    const ins = st.in.map((i) => this.keyOf(this.stage(i), ctx)); if (st.mask) ins.push(this.keyOf(this.stage(st.mask), ctx));
    switch (st.kind) {
      case 'scene': sl = [ctx.sceneId, this.wb.sceneRev(ctx.sceneId)]; break;
      case 'film.expose': sl = [P.film, P.camera, fr.speed_ev, fr.halation, fr.format_mm]; break;
      case 'film.develop': sl = [P.film, fr]; break;
      case 'enlarger': sl = [P.film, P.print, fr, P.camera.ev, Object.assign({}, P.enlarger, st.opts)]; break;
      case 'paper': sl = [P.film, P.print, P.print_render.morph, this.engines.paper]; break;
      case 'scan': sl = [P.film, P.print, P.print_render.glare, fr.dye_scale, P.output, P.enlarger.illuminant, P.lut2_n || 0]; break;
      case 'mask': sl = [st.fnSrc]; break;
      case 'sum': sl = [st.id]; break;
      case 'custom': sl = [st.def.name, st.def.rev, this._stageP(st.def, P)]; break;
      default: sl = [];
    }
    const k = hash([st.kind, st.id, sl, ins, ctx.w, ctx.h]); ctx.memo.set(st.id, k); return k;
  }
  _stageP(def, P) { const o = {}; for (const key of Object.keys(def.params)) { const v = get(P, def.params[key].path); o[key] = v === undefined ? def.params[key].value : v; } return o; }
  /* evaluate one stage (recursively), through the cache */
  frame(st, ctx) {
    const key = this.keyOf(st, ctx), cache = this.wb.cache, hit = cache.get(key);
    if (hit) { ctx.log.push({ stage: st.id, hit: true, ms: 0 }); if (hit.notes) for (const n of hit.notes) if (!ctx.notes.includes(n)) ctx.notes.push(n); return hit.frame; }
    const ins = st.in.map((i) => this.frame(this.stage(i), ctx)), mask = st.mask ? this.frame(this.stage(st.mask), ctx) : null;
    const t0 = performance.now(), notes = [];
    const fr = this._run(st, ctx, ins, mask, notes);
    const ms = performance.now() - t0;
    cache.set(key, { frame: fr, ms, notes, stage: st.id }); for (const n of notes) ctx.notes.push(n);
    ctx.log.push({ stage: st.id, hit: false, ms }); this.wb.stats.runs[st.kind] = (this.wb.stats.runs[st.kind] || 0) + 1; this.wb.stats.ms[st.id] = ms;
    return fr;
  }
  _run(st, ctx, ins, mask, notes) {
    const w = ctx.w, h = ctx.h, n = w * h, wb = this.wb;
    switch (st.kind) {
      case 'scene': { const f = wb.sceneFrame(ctx.sceneId, w, h); return { w, h, nc: 3, data: f.lin, space: 'linear' }; }
      case 'film.expose': { const plan = this.plan(ctx), r = FB.stageExpose(plan, ins[0].data, w, h, true); return { w, h, nc: 3, data: r.data, space: 'logE', ev: r.ev }; }
      case 'film.develop': { const plan = this.plan(ctx); return { w, h, nc: 3, data: FB.stageDevelop(plan, ins[0].data, w, h, true), space: 'density' }; }
      case 'enlarger': {
        const plan = this.plan(ctx); if (plan.scan) return Object.assign({}, ins[0]);
        const over = st.opts && Object.keys(st.opts).filter((k) => k !== 'scene' && k !== 'name'); const o = {}; for (const k of over || []) o[k] = st.opts[k];
        const pl = over && over.length ? wb.plan(Object.assign({}, ctx.P, { enlarger: Object.assign({}, ctx.P.enlarger, o) })) : plan;
        let lp = FB.stageEnlarge(pl, ins[0].data, n, Math.log10(o.print_exposure !== undefined ? o.print_exposure : ctx.P.enlarger.print_exposure));
        if (mask) { const m = mask.data; for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) lp[i * 3 + c] = Math.log10(Math.pow(10, lp[i * 3 + c]) * m[i] + 1e-10); }
        return { w, h, nc: 3, data: lp, space: 'logE' };
      }
      case 'paper': { const plan = this.plan(ctx); if (plan.scan) return Object.assign({}, ins[0]); return { w, h, nc: 3, data: FB.stagePaper(plan, ins[0].data, n), space: 'density' }; }
      case 'scan': { const plan = this.plan(ctx); return { w, h, nc: 3, data: FB.stageScan(plan, ins[0].data, n), space: 'srgb' }; }
      case 'mask': {
        const src = ins[0].data, o = new Float32Array(n), fn = st.fn;
        for (let i = 0; i < n; i++) o[i] = clamp(fn([CV.enc(src[i * 3]), CV.enc(src[i * 3 + 1]), CV.enc(src[i * 3 + 2])]), 0, 1);
        return { w, h, nc: 1, data: o, space: 'mask' };
      }
      case 'sum': {
        const o = new Float32Array(n * 3);
        for (let i = 0; i < n * 3; i++) { let s = 0; for (const f of ins) s += Math.pow(10, f.data[i]); o[i] = Math.log10(s + 1e-10); }
        return { w, h, nc: 3, data: o, space: 'logE' };
      }
      case 'custom': return this._runCustom(st, ctx, ins[0], notes);
      default: throw diag('E_STAGE', `unknown stage kind "${st.kind}"`);
    }
  }
  _runCustom(st, ctx, input, notes) {
    const def = st.def, P = this._stageP(def, ctx.P), n = ctx.w * ctx.h;
    const B = def.bake(P);
    const o = new Float32Array(n * 3), d = input.data, ev = def.eval;
    V2.phase.push('eval');
    try { for (let i = 0; i < n; i++) { const r = ev([d[i * 3], d[i * 3 + 1], d[i * 3 + 2]], P, B); o[i * 3] = r[0]; o[i * 3 + 1] = r[1]; o[i * 3 + 2] = r[2]; } } finally { V2.phase.pop(); }
    if (def.run) { V2.phase.push('run'); try { def.run({ P, B, w: ctx.w, h: ctx.h, wb: this.wb, note: (m) => notes.push(String(m)) }); } finally { V2.phase.pop(); } }
    return { w: ctx.w, h: ctx.h, nc: 3, data: o, space: input.space };
  }
  /* ----- eval a tap → EvalResult ----- */
  eval(tap, o) {
    o = o || {}; tap = tap || 'out'; const st = this.checkTap(tap);
    const ctx = this.ctxFor(o), t0 = performance.now(); let img;
    const dem = this.wb.demand(this), mid = dem.some((d) => d.tap !== 'out' && d.tap !== 'src');
    const fusedOk = tap === 'out' && this.isPlain() && this.engines.film !== 'staged' && !mid && !ctx.forceStaged && !o.staged;
    if (fusedOk) {
      const plan = this.plan(ctx);
      if (!FB.needsSpatial(plan, ctx.w, ctx.h)) {
        const key = hash(['fused', this.stages.map((s) => this.keyOf(s, ctx)), this.engines.paper, this.engines.scan]), hit = this.wb.cache.get(key);
        let fr;
        if (hit) { fr = hit.frame; ctx.log.push({ stage: 'fused', hit: true, ms: 0 }); }
        else { const sc = this.wb.sceneFrame(ctx.sceneId, ctx.w, ctx.h), r = FB.render(plan, sc.lin, ctx.w, ctx.h, {}); fr = { w: ctx.w, h: ctx.h, nc: 3, data: r.rgb, space: 'srgb', ev: r.ev }; const ms = performance.now() - t0; this.wb.cache.set(key, { frame: fr, ms, notes: [] }); ctx.log.push({ stage: 'fused', hit: false, ms }); }
        img = this._img(fr, 'out');
        return new EvalResult(this, ctx, tap, img, performance.now() - t0);
      }
    }
    const fr = this.frame(st, ctx); img = this._img(fr, tap);
    return new EvalResult(this, ctx, tap, img, performance.now() - t0);
  }
  _img(fr, tap) {
    let data = fr.data; if (fr.nc === 1) { data = new Float32Array(fr.w * fr.h * 3); for (let i = 0; i < fr.w * fr.h; i++) data[i * 3] = data[i * 3 + 1] = data[i * 3 + 2] = fr.data[i]; }
    const im = new Img(fr.w, fr.h, data, { space: fr.space === 'srgb' ? 'srgb' : fr.space || 'srgb', tap }); if (fr.ev !== undefined) im.meta.ev = fr.ev; return im;
  }
  /* ----- cache keys without running anything ----- */
  keys(o) { const ctx = this.ctxFor(Object.assign({ w: 64 }, o || {})); const k = {}; for (const s of this.stages) k[s.id] = this.keyOf(s, ctx); return k; }
  diff(other) {
    other = raw(other); const A = this.ctxFor({ w: 64 }), B = other.ctxFor({ w: 64 });
    const flat = (o) => { const out = {}; (function w(v, pre) { for (const k of Object.keys(v)) { const q = pre ? pre + '.' + k : k; if (isObj(v[k])) w(v[k], q); else out[q] = v[k]; } })(Object.assign({}, o), ''); return out; };
    const fa = flat(A.P), fb = flat(B.P), params = [];
    for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)])) if (stable(fa[k]) !== stable(fb[k])) params.push({ path: k, from: fa[k], to: fb[k] });
    const sa = this.stages.map((s) => s.id), sb = other.stages.map((s) => s.id);
    const added = sb.filter((x) => !sa.includes(x)), removed = sa.filter((x) => !sb.includes(x));
    const ka = this.keys(), kb = other.keys(), affects = this.stages.filter((s) => kb[s.id] && ka[s.id] !== kb[s.id] && s.kind !== 'scene').map((s) => s.id);
    const shared = this.stages.filter((s) => kb[s.id] && ka[s.id] === kb[s.id]).map((s) => s.id);
    const lines = [];
    for (const d of params.slice(0, 12)) lines.push(`params   ${d.path.padEnd(26)} ${fmtV(d.from)} → ${fmtV(d.to)}`);
    lines.push(added.length || removed.length ? `stages   ${added.map((x) => '+' + x).concat(removed.map((x) => '−' + x)).join(' ')}` : 'stages   unchanged');
    lines.push(`affects  ${affects.join(' · ') || 'nothing'}` + (shared.length ? `        (${shared.filter((x) => x !== 'scene').join(' · ')} shared)` : ''));
    return new Report(lines, { params, added, removed, affects, shared });
  }
  /* ----- IR ----- */
  nodes() { const seen = new Map(); for (const s of this.stages) { if (!seen.has(s.node)) seen.set(s.node, { id: s.node, kind: s.kind.split('.')[0], stages: [], source: s.src || null }); seen.get(s.node).stages.push(s.id); } return [...seen.values()]; }
  edges() {
    const e = [], byStage = {}; for (const s of this.stages) byStage[s.id] = s;
    for (const s of this.stages) {
      for (const i of s.in) { const a = byStage[i]; if (a && a.node !== s.node) e.push([a.node, s.node, 'in']); }
      if (s.mask) { const a = byStage[s.mask]; if (a) e.push([a.node, s.node, 'through']); }
    }
    return e;
  }
  hashIR() { return hash(this.stages.map((s) => [s.id, s.kind, s.in, s.mask || null, s.opts, s.fnSrc || null, s.def ? s.def.rev : null])); }
  summary() {
    const nodes = this.nodes(), edges = this.edges();
    return new Report([`${nodes.length} nodes · ${edges.length} edges · hash ${V2.short(this.hashIR())} · taps: ${this.taps.join(', ')}`], { nodes: nodes.length, edges: edges.length, hash: this.hashIR(), taps: this.taps });
  }
  toDot() {
    const L = ['digraph "' + this.name.replace(/"/g, '') + '" {', '  rankdir=LR;', '  node [shape=box, fontname="Arial", fontsize=11];'];
    for (const n of this.nodes()) L.push(`  "${n.id}" [label="${n.id}\\n${n.kind}"${n.kind === 'mask' ? ', style=dashed' : ''}];`);
    for (const [a, b, k] of this.edges()) L.push(`  "${a}" -> "${b}"${k === 'through' ? ' [style=dashed, label="through"]' : ''};`);
    L.push('}'); return L.join('\n');
  }
  node(id) {
    const n = this.nodes().find((x) => x.id === id); if (!n) throw diag('E_NODE', `no node "${id}"`, { mean: nearest(id, this.nodes().map((x) => x.id)) });
    const st = this.stage(n.stages[0]); return { id, kind: n.kind, stages: n.stages, source: st.fnSrc || (st.def && st.def.eval ? st.def.eval.toString() : null), inputs: st.in, opts: st.opts };
  }
  compile() { return this; }
  irDiff(other) {
    other = raw(other); const A = this.nodes().map((n) => n.id), B = other.nodes().map((n) => n.id);
    const plus = A.filter((x) => !B.includes(x)), minus = B.filter((x) => !A.includes(x));
    const rewired = []; for (const s of this.stages) { const o = other.stage(s.id); if (o && stable(o.in) !== stable(s.in)) rewired.push(`${s.id}.in rewired to ${s.in.join(', ')}`); }
    return new Report([plus.map((x) => '+ ' + x).concat(minus.map((x) => '− ' + x)).join('   ') + (rewired.length ? '      ' + rewired.join('; ') : '')], { plus, minus, rewired });
  }
}
const fmtV = (v) => (typeof v === 'number' ? String(Math.round(v * 1e4) / 1e4) : JSON.stringify(v));
V2.fmtV = fmtV;

class EvalResult {
  constructor(net, ctx, tap, img, ms) { this.net = net; this.ctx = ctx; this.tap = tap; this.img = img; this.ms = ms; this.notes = ctx.notes; this.log = ctx.log; this.w = img.w; this.h = img.h; }
  at(tap) { const st = this.net.checkTap(tap); return this.net._img(this.net.frame(st, this.ctx), tap); }
  toString() { return `EvalResult ${this.tap} ${this.w}×${this.h} · ${fmtMs(this.ms)} · ${this.log.filter((l) => !l.hit).length} stages run, ${this.log.filter((l) => l.hit).length} cached`; }
}
V2.EvalResult = EvalResult;

/* tap proxies: lambdas ({ out, cmy_film }) => … read taps lazily, and the reads are recorded so the pipeline knows what to keep */
V2.tapProxy = function (net, o, reads) {
  net = raw(net); const memo = {};
  return new Proxy({}, {
    get(t, k) {
      if (typeof k === 'symbol') return undefined;
      if (!net.byTap(k)) { if (k === 'then') return undefined; net.checkTap(k); }
      if (reads) reads.add(k);
      if (!memo[k]) memo[k] = net.eval(k, o).img; return memo[k];
    },
    has(t, k) { return !!net.byTap(k); },
    ownKeys() { return net.taps; }, getOwnPropertyDescriptor(t, k) { return net.byTap(k) ? { enumerable: true, configurable: true, value: undefined } : undefined; },
  });
};
V2.phase = [];
V2.phase.cur = () => V2.phase[V2.phase.length - 1] || null;

/* ---------- compare sets ---------- */
class CompareSet {
  constructor(wb, variants) { this.wb = wb; this.variants = variants; }
  plan(o) {
    const names = Object.keys(this.variants), kinds = ['film.expose', 'film.develop', 'enlarger', 'paper', 'scan'], uniq = {}, total = {}; let runs = 0, all = 0;
    for (const k of kinds) { uniq[k] = new Set(); total[k] = 0; }
    for (const nm of names) { const net = raw(this.variants[nm]), ctx = net.ctxFor(Object.assign({ w: 64 }, o || {})); for (const s of net.stages) if (uniq[s.kind]) { uniq[s.kind].add(net.keyOf(s, ctx)); total[s.kind]++; } }
    for (const k of kinds) { runs += uniq[k].size; all += total[k]; }
    const line = kinds.map((k) => `${k} ×${uniq[k].size}`).join('   ') + `        ${runs} stage runs, not ${all}`;
    return new Report([line], { runs, total: all, per: Object.fromEntries(kinds.map((k) => [k, uniq[k].size])) });
  }
  eval(tap, o) {
    const out = {}; for (const nm of Object.keys(this.variants)) out[nm] = raw(this.variants[nm]).eval(tap || 'out', o).img;
    return new ResultSet(out);
  }
}
class ResultSet {
  constructor(imgs) { this.imgs = imgs; Object.assign(this, imgs); }
  table(metric, o) {
    o = o || {}; const names = Object.keys(this.imgs), ref = o.ref || names[0]; if (!this.imgs[ref]) throw diag('E_ARG', `no variant "${ref}" to compare against`, { mean: nearest(ref, names) });
    if (metric !== 'dE2000') throw diag('E_METRIC', `no metric "${metric}"`, { list: { metrics: ['dE2000'] }, mean: nearest(metric, ['dE2000']) });
    const r = {}; for (const nm of names) if (nm !== ref) r[nm] = Math.round(V2.meanDE(this.imgs[nm], this.imgs[ref]) * 100) / 100;
    return r;
  }
}
V2.CompareSet = CompareSet; V2.Net = Net;
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* Filmbench v2 runtime, part C: parameter store with layers, macros, controls, schemes, presets. */
(function (g) {
'use strict';
const V2 = g.V2;
const { diag, warn, nearest, hash, clamp, get, setPath, clone, interp, unitName, isOp, op, Report, isObj, stable } = V2;
const LAYERS = ['look', 'macros', 'agent', 'pin'];
const sgn = (x) => (x < 0 ? '−' : '+');
const num = (v) => (typeof v === 'number' ? String(Math.round(v * 1e4) / 1e4) : String(v));
const signed = (v) => (typeof v === 'number' ? (v < 0 ? '−' : '+') + num(Math.abs(v)) : String(v));
const normOp = (o) => (isOp(o) ? o : o === undefined ? { k: 'keep' } : { k: 'set', v: o });

function applyOp(cur, o, opac) {
  if (o.k === 'keep') return cur;
  if (typeof cur === 'number' && typeof o.v === 'number') {
    if (o.k === 'set') return cur + (o.v - cur) * opac;
    if (o.k === 'add') return cur + o.v * opac;
    if (o.k === 'mul') return cur * Math.pow(o.v, opac);
    if (o.k === 'stops') return cur * Math.pow(2, o.v * opac);
  }
  if (o.k === 'set') return opac >= 0.5 ? o.v : cur;
  return cur;
}
const opText = (o) => (o.k === 'set' ? 'set ' + signed(o.v) : o.k === 'add' ? 'add ' + signed(o.v) : o.k === 'mul' ? 'mul ×' + num(o.v) : o.k === 'stops' ? 'mul ×' + num(Math.pow(2, o.v)) + ' (' + signed(o.v) + ' st)' : 'keep');

/* ---------- parameter store: base value plus ordered layers ---------- */
class ParamStore {
  constructor(wb) {
    this.wb = wb; this.base = FB.defaultParams(); this.rev = 0; this._eff = null; this._effRev = -1; this.clamped = [];
    this.layers = {}; for (const l of LAYERS) this.layers[l] = { name: l, on: true, opacity: 1, contrib: new Map(), preset: null };
    this.macroVals = {};
  }
  _bump() { this.rev++; this._eff = null; }
  _setBase(path, v) { setPath(this.base, path, v); this._bump(); }
  declare(spec) { // an extension parameter from a stage, lens or fragment
    const row = this.wb.table.add(spec);
    if (get(this.base, row.path) === undefined && row.def !== undefined) setPath(this.base, row.path, clone(row.def));
    this._bump(); return row;
  }
  get(path) { return get(this.base, path); }
  _compute(lay) {
    const P = clone(this.base);
    for (const ln of LAYERS) { const L = lay[ln]; if (!L.on) continue; for (const ops of L.contrib.values()) for (const [path, o] of Object.entries(ops)) setPath(P, path, applyOp(get(P, path), o, L.opacity)); }
    return P;
  }
  effective(path) {
    if (this._eff === null) this._eff = this._compute(this.layers);
    return path === undefined ? this._eff : get(this._eff, path);
  }
  /* effective as seen below the macros layer: what a macro's read() looks at */
  below() {
    const P = clone(this.base); const L = this.layers.look;
    if (L.on) for (const ops of L.contrib.values()) for (const [path, o] of Object.entries(ops)) setPath(P, path, applyOp(get(P, path), o, L.opacity));
    return P;
  }
  withMacros(map) { // effective params as if some macros stood at other values; nothing is changed
    const lay = {}; for (const ln of LAYERS) { const L = this.layers[ln]; lay[ln] = { on: L.on, opacity: L.opacity, contrib: new Map(L.contrib) }; }
    for (const name of Object.keys(map)) {
      const m = this.wb.macros[name]; if (!m) throw diag('E_MACRO', `no macro "${name}"`, { mean: nearest(name, Object.keys(this.wb.macros)) });
      const L = lay[m.layer]; for (const k of [...L.contrib.keys()]) if (k.startsWith(name + '(')) L.contrib.delete(k);
      L.contrib.set(name + '(' + map[name] + ')', m.contribution(map[name]));
    }
    return this._compute(lay);
  }
  withMacro(name, value) { return this.withMacros({ [name]: value }); }
  set(path, value, by) { this.wb.table.check(path); const co = V2.coerce(this.wb.table.row(path), path, value); if (co.clamped) warn('W_CLAMP', `"${path}" range is [${this.wb.table.row(path).min}, ${this.wb.table.row(path).max}]; ${value} → ${co.v}`); this.wb.apply({ op: 'param.set', path, value: co.v }, by); return this.wb; }
  reset(path) { this.wb.table.check(path); this.wb.apply({ op: 'param.reset', path }); return this.wb; }
  effectiveOf(path) { return this.effective(path); }
  why(path) {
    const wb = this.wb, row = wb.table.check(path), U = row.unit ? ' ' + unitName(row.unit) : '';
    const lines = []; let cur = get(this.base, path);
    const baseDef = get(FB.defaultParams(), path);
    lines.push(`base      ${(cur === baseDef ? 'default' : 'set').padEnd(8)} ${''.padEnd(24)} ${num(cur)}`);
    let pinned = false;
    for (const ln of LAYERS) {
      const L = this.layers[ln]; if (!L.on) { if ([...L.contrib.values()].some((o) => o[path])) lines.push(`${ln.padEnd(9)} off`); continue; }
      for (const [src, ops] of L.contrib.entries()) { const o = ops[path]; if (!o || o.k === 'keep') continue; cur = applyOp(cur, o, L.opacity); if (ln === 'pin') pinned = true; lines.push(`${ln.padEnd(9)} ${opText(o).padEnd(22)} ${('"' + src + '"').padEnd(16)} ${num(cur)}`); }
      if (L.opacity !== 1 && [...L.contrib.values()].some((o) => o[path])) lines.push(`${''.padEnd(9)} layer opacity ${L.opacity}`);
    }
    const range = row.min !== undefined ? `range ${row.min}…${row.max}` + (typeof cur === 'number' && (cur < row.min || cur > row.max) ? ', outside' : ', no clamp') : '';
    lines.push(`effective ${num(this.effective(path))}${U}${pinned ? ' (pinned)' : ''}     ${range}`.trimEnd());
    return new Report(lines, { path, value: this.effective(path), pinned });
  }
}
V2.ParamStore = ParamStore;

/* ---------- presets ---------- */
class Preset {
  constructor(wb, name, def) { this.wb = wb; this.name = name; this.desc = def.desc || ''; this.kind = def.kind || 'adjust'; this.ops = {}; for (const k of Object.keys(def.ops || {})) this.ops[k] = normOp(def.ops[k]); this.user = !!def.user; this.builtin = !!def.builtin; }
  toString() { return `preset "${this.name}"`; }
  apply() { this.wb.ctl.layer('look').use(this); return this.wb; }
  toJSON() { return { name: this.name, desc: this.desc, kind: this.kind, ops: this.ops, user: this.user, builtin: this.builtin }; }
}
V2.Preset = Preset;

/* ---------- macros ---------- */
class Macro {
  constructor(wb, name, o) {
    o = o || {}; this.wb = wb; this.name = name; this.range = o.range || [0, 1]; this.step = o.step || 0.01; this.unit = unitName(o.unit); this.layer = o.layer || 'macros';
    this.rest = o.value !== undefined ? o.value : (this.range[0] < 0 && this.range[1] > 0 ? 0 : this.range[0]); this.drivesList = []; this.applyFn = null; this.readFn = null; this.applyPhase = 'sync'; this.shape = null; this.calib = null; this.from = o.from || null;
    wb.params.macroVals[name] = this.rest; this.label = o.label || name; this.pending = null;
  }
  srcKey() { return this.name + '(' + num(this.value) + ')'; }
  get value() { return this.wb.params.macroVals[this.name]; }
  set value(v) { this.wb.apply({ op: 'macro.set', name: this.name, value: v }); }
  get stale() { return !!(this.calib && this.calib.key !== this.calib.keyNow()); }
  drives(path, spec) {
    this.wb.table.check(path); spec = spec || {}; this.drivesList.push(Object.assign({ path }, spec)); this.wb._macroDirty(this); return this;
  }
  apply(fn, o) {
    const phase = (o && o.phase) || 'sync';
    if (phase === 'sync') { // E_CONFLICT is found when the λ is attached, not when it runs
      let ops; try { ops = fn(this.value, this.wb.params.below(), {}); } catch (e) { ops = null; }
      if (ops && !(ops.then)) for (const other of Object.values(this.wb.macros)) if (other !== this && other.layer === this.layer && other.applyFn && other.applyPhase === 'sync') {
        let oo; try { oo = other.applyFn(other.value, this.wb.params.below(), {}); } catch (e) { oo = null; }
        if (oo) for (const k of Object.keys(ops)) if (oo[k] && ops[k] && ops[k].k === 'set' && oo[k].k === 'set') throw diag('E_CONFLICT', `macros "${other.name}" and "${this.name}" both op.set ${k} in layer "${this.layer}"`, { fix: 'use op.mul or op.add in one of them, or put one in another layer' });
      }
    }
    this.applyFn = fn; this.applyPhase = phase; this.wb._macroDirty(this); return this;
  }
  read(fn) { this.readFn = fn; return this; }
  setShape(pts) { this.shape = pts; this.wb._macroDirty(this); return this; }
  slider() { return this.wb.ctl.slider(this); }
  shaped(v) {
    if (!this.shape) return v; const pts = this.shape; return interp(pts, v);
  }
  contribution(v, P) {
    const ops = {}; const x = this.shaped(v), lo = this.range[0], hi = this.range[1], maxabs = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    for (const d of this.drivesList) {
      if (d.stops !== undefined) { ops[d.path] = { k: 'stops', v: d.stops * x }; continue; }
      if (d.map) {
        const f0 = interp(d.map, this.rest), fv = interp(d.map, x);
        ops[d.path] = Math.abs(f0) < 1e-9 && d.as !== 'set' ? { k: 'add', v: fv } : { k: 'set', v: fv }; continue;
      }
      let t = x;
      if (d.curve) { const a = Math.abs(x) / maxabs, c = d.curve === 'easeIn' ? a * a : d.curve === 'easeOut' ? 1 - (1 - a) * (1 - a) : d.curve === 'smooth' ? a * a * (3 - 2 * a) : a; t = Math.sign(x) * c * maxabs; }
      ops[d.path] = { k: 'add', v: (d.gain === undefined ? 1 : d.gain) * t };
    }
    if (this.applyFn && this.applyPhase === 'sync') {
      const r = this.applyFn(x, P || this.wb.params.below(), {});
      if (r && typeof r === 'object' && !r.then) for (const k of Object.keys(r)) { this.wb.table.check(k); ops[k] = normOp(r[k]); }
    }
    return ops;
  }
  async calibrate(o) {
    o = o || {}; const wb = this.wb, n = o.samples || 9, [lo, hi] = this.range, ys = [], vs = [];
    const net = wb.pipes.get('default') || [...wb.pipes.values()][0]; if (!net) throw diag('E_PIPE', 'calibrate() needs a pipeline');
    const pr = o.probe ? wb.ws.probeRect(o.probe) : undefined;
    for (let i = 0; i < n; i++) {
      const v = lo + ((hi - lo) * i) / (n - 1), P = wb.params.withMacro(this.name, v);
      const taps = V2.tapProxy(net, { params: P, w: o.size || 160, scope: o.scene ? { scene: o.scene } : {} });
      vs.push(v); ys.push(await o.measure(taps, pr));
      if (i % 3 === 2) await new Promise((r) => setTimeout(r, 0));
    }
    const mono = ys.every((y, i) => i === 0 || y >= ys[i - 1]) || ys.every((y, i) => i === 0 || y <= ys[i - 1]);
    const key = () => stable([wb.params.effective('film'), wb.params.effective('print'), o.scene || 'chart']);
    const k0 = key(); const self = this;
    const first = ys[0], last = ys[n - 1], steps = ys.slice(1).map((y, i) => Math.abs(y - ys[i]));
    const cal = {
      raw: vs.map((v, i) => [v, ys[i]]), monotone: mono, key: k0, keyNow: key,
      report() {
        const f = (x) => (Math.round(x * 10) / 10).toFixed(1);
        return new Report([`raw      ${f(first)} … ${f(last)}      step ${f(Math.max(...steps))} at the widest, ${f(Math.min(...steps))} at the narrowest${mono ? '' : '  (not monotone: the remap is skipped)'}`, 'target   linear in the measure'], { steps });
      },
      apply() {
        if (!mono) { warn('W_CALIBRATE', `"${self.name}" is not monotone in the measure; no remap applied`); return self; }
        const pts = ys.map((y, i) => [y, vs[i]]).sort((a, b) => a[0] - b[0]); // measure → macro value
        const sh = []; for (let i = 0; i < n; i++) { const t = first + ((last - first) * i) / (n - 1); sh.push([lo + ((hi - lo) * i) / (n - 1), interp(pts, t)]); }
        self.shape = sh; self.calib = cal; wb._macroDirty(self); return self;
      },
    };
    self.calib = cal; return cal;
  }
}
V2.Macro = Macro;

/* ---------- controls ---------- */
const WIDGETS = ['slider', 'dial', 'stepper', 'toggle', 'select', 'segmented', 'wheel', 'button', 'choice', 'text'];
class Control {
  constructor(wb, kind, target, o) {
    this.wb = wb; this.kind = kind; this.widgetName = kind; this.macro = target instanceof Macro ? target : null; this.path = typeof target === 'string' ? target : null;
    this.from = (o && o.from) || null; this.labelText = null; this.unitName = ''; this.min = undefined; this.max = undefined; this.stepV = undefined; this.detentList = []; this.fmtFn = null; this.reqs = []; this.opensName = null; this.applyFn = null; this.choices = null; this.drivesPath = null; this.disFn = null; this.log = false; this.def = undefined; this.optList = null; this.name = o && o.name || null; this.hidden = false;
    if (this.macro) { this.labelText = this.macro.label; this.unitName = this.macro.unit; this.min = this.macro.range[0]; this.max = this.macro.range[1]; this.stepV = this.macro.step; this.def = this.macro.rest; }
    else if (this.path) {
      const r = wb.table.check(this.path); this.row = r; this.labelText = r.label; this.unitName = unitName(r.unit); this.min = r.min; this.max = r.max; this.stepV = r.step; this.log = !!r.log; this.def = r.def; this.optList = r.opts || null; this.disFn = r.dis || null;
      if (kind === 'slider' && r.kind === 'bool') this.kind = this.widgetName = 'toggle';
    }
  }
  get id() { return this.macro ? this.macro.name : this.path || this.name; }
  toString() { return this.id; }
  label(t) { this.labelText = t; return this; }
  unit(u) { this.unitName = unitName(u); return this; }
  range(lo, hi) {
    if (this.row && this.row.min !== undefined && (lo < this.row.min - 1e-9 || hi > this.row.max + 1e-9)) throw diag('E_RANGE', `range ${lo}…${hi} is wider than the path's ${this.row.min}…${this.row.max}`, { fix: 'a control may narrow the range of its path, never widen it' });
    this.min = lo; this.max = hi; return this;
  }
  step(s) { this.stepV = s; return this; }
  detents(d) { this.detentList = d; return this; }
  fmt(f) { this.fmtFn = f; return this; }
  widget(w) { if (!WIDGETS.includes(w)) throw diag('E_WIDGET', `no widget "${w}"`, { mean: nearest(w, WIDGETS), list: { widgets: WIDGETS } }); this.widgetName = w; return this; }
  requires(cap) { this.reqs.push(cap); return this; }
  opens(name) { this.opensName = name; return this; }
  apply(fn) { this.applyFn = fn; return this; }
  disabledWhen(fn) { this.disFn = fn; return this; }
  drives(path) { this.wb.table.check(path); this.drivesPath = path; return this; }
  bind(net) { net = V2.raw(net); const caps = net.capabilities(); for (const r of this.reqs) if (!caps.includes(r)) throw diag('E_CAPABILITY', `"${this.labelText}" requires "${r}"; pipeline "${net.name}" provides [${caps.join(', ')}]`, { fix: 'wb.graph (example 05) or engines.dag' }); return this; }
  /* value access */
  get() {
    if (this.macro) return this.macro.value;
    if (this.kind === 'choice') return this.choiceKey !== undefined ? this.choiceKey : this._guessChoice();
    return this.wb.params.effective(this.path);
  }
  _guessChoice() { const cur = this.wb.params.effective(this.drivesPath); const k = Object.keys(this.choices || {}).find((x) => Math.abs(this.choices[x] - cur) < 1e-6); return k || Object.keys(this.choices || {})[0]; }
  set(v, by) {
    if (this.macro) { this.wb.apply({ op: 'macro.set', name: this.macro.name, value: v }, by); return; }
    if (this.kind === 'choice') { this.choiceKey = v; this.wb.apply({ op: 'param.set', path: this.drivesPath, value: this.choices[v] }, by); return; }
    if (this.kind === 'wheel') { this.wheelVal = v; this.wb.apply({ op: 'wheel.set', control: this.id, value: v }, by); return; }
    this.wb.apply({ op: 'param.set', path: this.path, value: this.min !== undefined && typeof v === 'number' ? clamp(v, this.min, this.max) : v }, by);
  }
  get changed() {
    if (this.macro) return Math.abs(this.macro.value - this.macro.rest) > 1e-9;
    if (!this.path) return false; const v = this.wb.params.get(this.path), d = get(FB.defaultParams(), this.path); return stable(v) !== stable(d === undefined ? this.def : d);
  }
  reset() { if (this.macro) this.macro.value = this.macro.rest; else if (this.kind === 'choice') this.set(Object.keys(this.choices)[0]); else if (this.path) this.wb.params.reset(this.path); }
  format(v) {
    if (this.fmtFn) return this.fmtFn(v);
    if (typeof v === 'boolean') return v ? 'on' : 'off';
    if (typeof v !== 'number') return String(v);
    const st = this.stepV || 0.01, dp = Math.max(0, Math.min(4, Math.ceil(-Math.log10(st) - 1e-9))); const s = v.toFixed(dp);
    return this.unitName ? (this.unitName === '×' ? s + ' ×' : s + ' ' + this.unitName) : s;
  }
  disabled() { try { return !!(this.disFn && this.disFn(this.wb.params.effective())); } catch (e) { return false; } }
}
V2.Control = Control;

/* ---------- schemes ---------- */
class Scheme {
  constructor(wb, name) { this.wb = wb; this.name = name; this.groups = []; }
  group(title) { const G = { title, items: [], add(c) { this.items.push(c); return this; } }; this.groups.push(G); return G; }
  controls() { return this.groups.flatMap((G) => G.items); }
  audit() {
    const cs = this.controls(), paths = new Set(), lines = []; let bad = 0;
    for (const c of cs) { if (c.path) paths.add(c.path); if (c.macro) for (const d of c.macro.drivesList) paths.add(d.path); if (c.drivesPath) paths.add(c.drivesPath); }
    const net = this.wb.mainNet(), caps = net ? net.capabilities() : [];
    const dis = [];
    for (const c of cs) for (const r of c.reqs) if (!caps.includes(r)) dis.push(`"${c.labelText}" requires "${r}"; engines [${net ? ['film', 'paper', 'scan'].map((k) => k + ':' + net.engines[k]).join(', ') : ''}] provide [${caps.join(', ')}]`);
    // every mapped value inside its range
    for (const c of cs) if (c.macro) for (const d of c.macro.drivesList) { const row = this.wb.table.row(d.path); if (row && row.min !== undefined && d.map) for (const [, y] of d.map) { const abs = Math.abs(interp(d.map, c.macro.rest)) < 1e-9 ? null : y; if (abs !== null && (abs < row.min || abs > row.max)) { bad++; lines.push(`⚠ ${c.labelText}: map value ${y} is outside ${d.path} ${row.min}…${row.max}`); } } }
    lines.unshift(bad ? `⚠ ${bad} mapped values outside their range` : `ok        ${cs.length} controls bound to ${paths.size} paths, every mapped value inside its range`);
    if (dis.length) { lines.push(`disabled  ${dis[0]}`); lines.push(`          fix: wb.graph (example 05) or engines.dag`); }
    return new Report(lines, { ok: !bad, controls: cs.length, paths: paths.size, disabled: dis });
  }
}
V2.Scheme = Scheme;

/* ---------- the control plane ---------- */
class LayerHandle {
  constructor(wb, name) { this.wb = wb; this.name = name; }
  use(preset) { this.wb.apply({ op: 'layer.use', layer: this.name, preset: typeof preset === 'string' ? this.wb.preset(preset).name : preset.name }); return this; }
  off() { this.wb.apply({ op: 'layer.on', layer: this.name, on: false }); return this; }
  on() { this.wb.apply({ op: 'layer.on', layer: this.name, on: true }); return this; }
  opacity(x) { this.wb.apply({ op: 'layer.opacity', layer: this.name, value: clamp(x, 0, 1) }); return this; }
  clear() { this.wb.apply({ op: 'layer.clear', layer: this.name }); return this; }
  bake() { this.wb.apply({ op: 'layer.bake', layer: this.name }); return this; }
  get state() { const L = this.wb.params.layers[this.name]; return { on: L.on, opacity: L.opacity, sources: [...L.contrib.keys()] }; }
}
class Ctl {
  constructor(wb) { this.wb = wb; this.controls = []; this.schemeMap = new Map(); this.active = null; this.builder = null; this.fragmentTag = null; }
  _reg(c) {
    c.from = this.fragmentTag;
    if (this.builder) return c; // inside a scheme: a fresh presentation of the same thing
    const ex = this.controls.find((x) => x.id === c.id && x.kind === c.kind); if (ex) return ex;
    this.controls.push(c); this.wb._touch(); return c;
  }
  _make(kind, target) {
    if (target instanceof Macro) return this._reg(new Control(this.wb, kind, target));
    if (typeof target !== 'string') throw diag('E_ARG', `ctl.${kind}() needs a parameter path or a macro`, { fix: `ctl.${kind}("camera.ev")` });
    return this._reg(new Control(this.wb, kind, target));
  }
  slider(t) { return this._make('slider', t); } toggle(t) { return this._make('toggle', t); } select(t) { return this._make('select', t); } segmented(t) { return this._make('segmented', t); } stepper(t) { return this._make('stepper', t); }
  macro(name, o) {
    const wb = this.wb; if (wb.macros[name]) { const m = wb.macros[name]; if (o && o.range) m.range = o.range; return m; }
    const m = new Macro(wb, name, Object.assign({ from: this.fragmentTag }, o)); m.from = this.fragmentTag; wb.macros[name] = m; wb._macroDirty(m); return m;
  }
  choice(name, map) { const c = new Control(this.wb, 'choice', null, { name }); c.choices = map; c.labelText = name; c.kind = c.widgetName = 'choice'; return this._reg(c); }
  button(name) { const c = new Control(this.wb, 'button', null, { name }); c.labelText = name; return this._reg(c); }
  wheel(name) { const c = new Control(this.wb, 'wheel', null, { name }); c.labelText = name; c.wheelVal = [0, 0]; return this._reg(c); }
  list() { return this.controls.slice(); }
  byPath(path) { const all = this.controls.concat(...[...this.schemeMap.values()].map((s) => s.controls())); return all.filter((c) => c.path === path); }
  layers() { return new Report(['base → ' + LAYERS.join(' → ') + '       resolution order'], { order: ['base'].concat(LAYERS) }); }
  layer(name) {
    if (!LAYERS.includes(name)) throw diag('E_LAYER', `no layer "${name}"`, { mean: nearest(name, LAYERS), list: { layers: ['base'].concat(LAYERS) } });
    return new LayerHandle(this.wb, name);
  }
  pin(path, v) { this.wb.table.check(path); this.wb.apply({ op: 'pin.set', path, value: v }); return this; }
  unpin(path) { this.wb.apply({ op: 'pin.clear', path }); return this; }
  why(path) { return this.wb.params.why(path); }
  scheme(name, build) {
    if (typeof build !== 'function') { if (!this.schemeMap.has(name)) throw diag('E_SCHEME', `no scheme "${name}"`, { mean: nearest(name, [...this.schemeMap.keys()]), list: { schemes: [...this.schemeMap.keys()] } }); return this.schemeMap.get(name); }
    const s = new Scheme(this.wb, name); this.builder = s; s.fromSpec = !!build.__fromSpec; try { build(s); } finally { this.builder = null; }
    this.schemeMap.set(name, s); if (!this.active) this.active = name; this.wb._touch(); return s;
  }
  use(name) { this.scheme(name); this.active = name; this.wb._touch(); return this; }
  schemes() { return [...this.schemeMap.keys()]; }
  current() { return this.active ? this.schemeMap.get(this.active) : null; }
  fromSpec() {
    const wb = this.wb;
    const fn = (s) => {
      for (const G of wb.table.groups) {
        if (!G.rows.length || G.id === 'custom') continue; const grp = s.group(G.title);
        for (const r of G.rows) {
          if (r.kind === 'id') { const c = new Control(wb, 'select', r.path); c.optList = wb.stockIds(r.role).map((id) => [id, wb.stock(id).name]); c.labelText = r.label; grp.add(c); continue; }
          const k = r.kind === 'bool' ? 'toggle' : r.kind === 'enum' ? (r.widget === 'segmented' ? 'segmented' : 'select') : 'slider';
          grp.add(new Control(wb, k, r.path));
        }
      }
      for (const G of wb.table.groups) if (G.id === 'custom' || !['stock', 'exposure', 'film', 'dir', 'grain', 'enlarger', 'paper', 'output'].includes(G.id)) { if (!G.rows.length) continue; const grp = s.group(G.title); for (const r of G.rows) grp.add(new Control(wb, r.kind === 'bool' ? 'toggle' : r.kind === 'enum' ? 'select' : 'slider', r.path)); }
    };
    fn.__fromSpec = true; return fn;
  }
  wheelOps(c, v) { return c.applyFn ? c.applyFn(v) : {}; }
}
V2.Ctl = Ctl; V2.LAYERS = LAYERS; V2.applyOp = applyOp; V2.normOp = normOp; V2.opText = opText;
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* Filmbench v2 runtime, part D: the bench — mutations, undo, graph builder, stage definitions, fragments, axes, script and save. */
(function (g) {
'use strict';
const V2 = g.V2;
const { diag, warn, nearest, hash, clamp, get, setPath, clone, guard, raw, stable, Net, Report, Control, isObj, LAYERS, normOp, applyOp } = V2;
const TYPES = ['Scene', 'LogExposure', 'Density', 'RGB', 'Mask'];
V2.by = 'script';

/* ---------- graph builder ---------- */
class NodeRef {
  constructor(gb, node, first, last, type) { this.gb = gb; this.node = node; this.first = first; this.last = last; this.type = type; this.inputsSet = false; }
  from(ref) {
    const st = this.gb.net.stage(this.first), want = { 'film.expose': 'Scene', enlarger: 'Density', paper: 'LogExposure', scan: 'Density', mask: 'Scene' }[st.kind];
    if (!ref || !(ref instanceof NodeRef)) throw diag('E_ARG', `${this.node}.from() needs a node made by the same graph`, { fix: 'const src = g.scene("still"); g.film("…").from(src)' });
    if (want && ref.type !== want) throw diag('E_PORT_TYPE', `${this.node} takes ${want} but "${ref.node}" carries ${ref.type}`);
    st.in = [ref.last]; this.inputsSet = true; return this;
  }
  through(mask) {
    if (!(mask instanceof NodeRef) || mask.type !== 'Mask') throw diag('E_PORT_TYPE', `${this.node}.through() needs a mask node`, { fix: 'const sky = g.mask("sky", (px) => …).from(src)' });
    this.gb.net.stage(this.first).mask = mask.last; return this;
  }
}
class GraphBuilder {
  constructor(wb, name) { this.wb = wb; this.net = new Net(wb, name, 'graph'); this.net.root = false; this.count = {}; }
  _id(base, name) { if (name) return name; this.count[base] = (this.count[base] || 0) + 1; return this.count[base] === 1 ? base : base + '#' + this.count[base]; }
  scene(id) { const sc = this.wb.scenes; if (!sc[id]) throw diag('E_SCENE', `no scene "${id}"`, { mean: nearest(id, Object.keys(sc)) }); const nid = this._id('scene'); this.net._push({ id: nid, tap: nid === 'scene' ? 'src' : nid, kind: 'scene', in: [], opts: { scene: id }, type: 'Scene' }); const r = new NodeRef(this, nid, nid, nid, 'Scene'); r.inputsSet = true; return r; }
  film(id) {
    this.net._stock('film', id); const nid = this._id('film'), a = nid + '.expose', b = nid + '.develop';
    this.net._push({ id: a, node: nid, tap: nid === 'film' ? 'log_e_film' : a, kind: 'film.expose', in: [], opts: {}, type: 'LogExposure' });
    this.net._push({ id: b, node: nid, tap: nid === 'film' ? 'cmy_film' : b, kind: 'film.develop', in: [a], opts: {}, type: 'Density' });
    return new NodeRef(this, nid, a, b, 'Density');
  }
  enlarger(o) { o = Object.assign({}, o); const nid = this._id('enlarger', o.name); delete o.name; this.net._push({ id: nid, tap: nid === 'enlarger' ? 'log_e_print' : nid, kind: 'enlarger', in: [], opts: o, type: 'LogExposure' }); return new NodeRef(this, nid, nid, nid, 'LogExposure'); }
  mask(name, fn) {
    if (typeof fn !== 'function') throw diag('E_ARG', 'g.mask(name, fn) needs a function from a scene pixel to 0…1');
    this.net._push({ id: name, tap: name, kind: 'mask', in: [], opts: {}, type: 'Mask', fn, fnSrc: fn.toString() }); return new NodeRef(this, name, name, name, 'Mask');
  }
  sum(name, ...refs) {
    for (const r of refs) if (!(r instanceof NodeRef) || r.type !== 'LogExposure') throw diag('E_PORT_TYPE', `sum "${name}" adds LogExposure nodes; "${r && r.node}" carries ${r && r.type}`);
    this.net._push({ id: name, tap: name, kind: 'sum', in: refs.map((r) => r.last), opts: {}, type: 'LogExposure' }); const r = new NodeRef(this, name, name, name, 'LogExposure'); r.inputsSet = true; return r;
  }
  paper(id) { this.net._stock('print', id); const nid = this._id('paper'); this.net._push({ id: nid, tap: nid === 'paper' ? 'cmy_print' : nid, kind: 'paper', in: [], opts: {}, type: 'Density' }); return new NodeRef(this, nid, nid, nid, 'Density'); }
  scan() { const nid = this._id('scan'); this.net._push({ id: nid, tap: nid === 'scan' ? 'out' : nid, kind: 'scan', in: [], opts: {}, type: 'RGB' }); return new NodeRef(this, nid, nid, nid, 'RGB'); }
  compile(outRef) {
    const net = this.net;
    if (!(outRef instanceof NodeRef)) throw diag('E_ARG', 'g.compile(out) needs the output node', { fix: 'const out = g.scan().from(paper); g.compile(out)' });
    for (const s of net.stages) if (s.kind !== 'scene' && !s.in.length) throw diag('E_DANGLING', `node "${s.node}" has no input`, { fix: `call .from(…) on ${s.node}` });
    // keep what the output reaches, in dependency order
    const order = [], seen = new Set();
    const visit = (id) => { if (seen.has(id)) return; seen.add(id); const s = net.stage(id); if (!s) throw diag('E_NODE', `no stage "${id}"`); for (const i of s.in) visit(i); if (s.mask) visit(s.mask); order.push(s); };
    visit(outRef.last); net.stages = order; net.out = outRef.last; net.compiled = true;
    this.wb._register(net); return net;
  }
}

/* ---------- stage definitions ---------- */
function makeStage(wb, name, def) {
  def = def || {};
  if (!def.from || !TYPES.includes(def.from)) throw diag('E_PORT_TYPE', `stage "${name}": from must be one of ${TYPES.join(', ')}`, { mean: nearest(def.from || '', TYPES) });
  if (!def.to || !TYPES.includes(def.to)) throw diag('E_PORT_TYPE', `stage "${name}": to must be one of ${TYPES.join(', ')}`, { mean: nearest(def.to || '', TYPES) });
  if (typeof def.eval !== 'function') throw diag('E_ARG', `stage "${name}" needs an eval λ: (px, P, B) => px`);
  const params = {};
  for (const k of Object.keys(def.params || {})) { const spec = Object.assign({}, def.params[k]); spec.path = spec.path || name + '.' + k; if (spec.value === undefined && spec.def !== undefined) spec.value = spec.def; spec.group = name; wb.params.declare(spec); params[k] = spec; }
  const rev = hash([name, def.from, def.to, String(def.build || ''), String(def.eval), String(def.run || '')]);
  const st = { __stage: true, name, from: def.from, to: def.to, params, build: def.build, eval: def.eval, run: def.run, rev, src: def, baked: null };
  st.bake = function (P) {
    if (!def.build) return {};
    if (st.baked) { let same = true; for (const k of st.baked.reads) if (stable(P[k]) !== stable(st.baked.vals[k])) { same = false; break; } if (same) return st.baked.B; }
    const reads = new Set(), vals = {}, prox = new Proxy(P, { get(t, k) { if (typeof k === 'string') { reads.add(k); vals[k] = t[k]; } return t[k]; } });
    V2.phase.push('build'); let B; try { B = def.build(prox); } finally { V2.phase.pop(); }
    st.baked = { B, reads, vals }; return B;
  };
  wb.stageDefs.set(name, st); return st;
}

/* ---------- axes ---------- */
class Axis {
  constructor(path, values) { this.path = path; this.values = values; }
  get first() { return this.values[0]; }
  apply(scope, v) { scope[this.path] = v; return scope; }
}
V2.Axis = Axis;

/* ---------- the bench ---------- */
class Bench {
  constructor(name, opts) {
    this.name = name || 'bench'; this.data = V2.data; this.table = new V2.ParamTable(); this.params = new V2.ParamStore(this); this.ctl = new V2.Ctl(this);
    this.scenes = Object.create(null); Object.defineProperties(this.scenes, Object.getOwnPropertyDescriptors(V2.scenes)); this._sceneRev = {}; this._base = {}; this._sceneCache = new Map();
    this.pipes = new Map(); this.macros = {}; this.presets = new Map(); this.stageDefs = new Map(); this.lensDefs = new Map(); this.fragmentList = []; this.briefs = []; this.decorators = [];
    this.cache = V2.cache; this.stats = { runs: {}, ms: {} }; this._plans = new Map(); this._lastPlan = null;
    this.rev = 0; this.listeners = []; this._tx = null; this.undoStack = []; this.redoStack = []; this._inUndo = false; this.agentCfg = { mode: 'ask', brief: '' }; this.pending = []; this.pendingSeq = 0; this.fragMethods = {};
    this.log = []; Object.defineProperty(this.log, 'hash', { get: () => hash(this.log.map((e) => [e.op, e.by, e.path || e.name || e.tile || e.id || '', e.value === undefined ? null : e.value])), enumerable: false });
    this.ws = new V2.Workspace(this); this.graph = Object.assign((nm) => new GraphBuilder(this, nm || 'graph'), { of: (pipe) => this._graphOf(pipe) });
    this.id = ++Bench.seq;
  }
  /* ----- registry and queries ----- */
  on(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((x) => x !== fn); }; }
  _touch() { this.rev++; for (const fn of this.listeners) { try { fn(this); } catch (e) { console.error(e); } } }
  _register(net) { this.pipes.set(net.name, net); this._touch(); }
  mainNet() { return this.pipes.get('default') || [...this.pipes.values()][0] || null; }
  pipe(name) {
    name = name || 'default'; let n = this.pipes.get(name);
    if (!n) { n = new Net(this, name, 'pipe'); this.pipes.set(name, n); this._touch(); }
    return guard(n, `pipeline "${name}"`);
  }
  _graphOf(pipe) { const p = raw(pipe), f = p.fork('graph of ' + p.name); f.kind = 'graph'; this.pipes.delete(f.name); return f; }
  stock(id) { const p = this.data.profiles[id]; return p ? { id, role: p.role, name: p.name || id, positive: !!p.positive, raw: p } : null; }
  stockIds(role) { return Object.keys(this.data.profiles).filter((k) => !role || this.data.profiles[k].role === role); }
  sceneBase(id) { if (!this._base[id]) { const s = this.scenes[id]; this._base[id] = { w: s.w, h: s.h }; } return this._base[id]; }
  sceneRev(id) { return this._sceneRev[id] || 0; }
  addScene(id, sc) { Object.defineProperty(this.scenes, id, { value: sc, enumerable: true, configurable: true, writable: true }); this._sceneRev[id] = (this._sceneRev[id] || 0) + 1; delete this._base[id]; for (const k of [...this._sceneCache.keys()]) if (k.startsWith(id + '|')) this._sceneCache.delete(k); this._touch(); }
  sceneFrame(id, w, h) {
    const k = `${id}|${this.sceneRev(id)}|${w}x${h}`, hit = this._sceneCache.get(k); if (hit) return hit;
    const s = this.scenes[id]; let r;
    if (w === s.w && h === s.h) r = { w, h, lin: s.lin };
    else { const im = new CV.Img(s.w, s.h, s.lin, { space: 'linear' }).resize(w, h, true); r = { w, h, lin: im.data }; }
    this._sceneCache.set(k, r); if (this._sceneCache.size > 40) this._sceneCache.delete(this._sceneCache.keys().next().value); return r;
  }
  plan(P) {
    const core = {}; for (const k of V2.CORE_KEYS) if (P[k] !== undefined) core[k] = P[k];
    const key = stable(core), hit = this._plans.get(key); if (hit) { this._plans.delete(key); this._plans.set(key, hit); return hit; }
    const pl = FB.buildPlan(this.data, core, this._lastPlan); this._lastPlan = pl; this._plans.set(key, pl); if (this._plans.size > 10) this._plans.delete(this._plans.keys().next().value); return pl;
  }
  demand(net) {
    const d = this.ws.demandFor ? this.ws.demandFor(net) : [];
    for (const s of net.stages) if (s.kind === 'custom') { const inp = net.stage(s.in[0]); if (inp && inp.tap !== 'src' && inp.tap !== 'out') d.push({ tap: inp.tap, by: 'stage ' + s.id }); }
    return d;
  }
  stage(name, def) { return makeStage(this, name, def); }
  preset(name, def) {
    if (!def) { const p = this.presets.get(name); if (!p) throw diag('E_PRESET', `no preset "${name}"`, { mean: nearest(name, [...this.presets.keys()]), list: { presets: [...this.presets.keys()].slice(0, 12) } }); return p; }
    const p = new V2.Preset(this, name, def); this.presets.set(name, p); this._touch(); return p;
  }
  axis(path, values) {
    if (!Array.isArray(values) || !values.length) throw diag('E_ARG', 'wb.axis(path, values) needs a list of values');
    const alias = { paper: 'print', stock: 'print', ev: 'camera.ev', exposure: 'camera.ev' };
    if (path === 'scene') { for (const v of values) if (!this.scenes[v]) throw diag('E_VALUE', `"${v}" is not a scene`, { mean: nearest(v, Object.keys(this.scenes)) }); }
    else if (path === 'print' || path === 'film') { for (const v of values) { const st = this.stock(v); if (!st || st.role !== path) throw diag('E_VALUE', `"${v}" is not a ${path} stock`, { mean: nearest(v, this.stockIds(path)) }); } }
    else if (path.startsWith('macro.')) { const nm = path.slice(6); if (!this.macros[nm]) throw diag('E_AXIS', `no macro "${nm}"`, { mean: nearest(nm, Object.keys(this.macros)).map((x) => 'macro.' + x) }); }
    else if (!this.table.has(path)) { throw diag('E_AXIS', `"${path}" is not a parameter path or a scene axis`, { mean: alias[path] ? [alias[path] + (path === 'paper' ? '        (the paper stock id)' : '')] : nearest(path, this.table.paths().concat(['scene'])) }); }
    return new Axis(path, values);
  }
  compare(variants) { return new V2.CompareSet(this, variants); }
  use(...frags) { for (const f of frags) this._useFragment(f); return this; }
  set(path, v) { this.params.set(path, v); return this; }
  fragments() {
    return new Report(this.fragmentList.map((f) => {
      const parts = []; if (f.counts.macros) parts.push(`${f.counts.macros} macro${f.counts.macros > 1 ? 's' : ''}`); if (f.counts.controls) parts.push(`${f.counts.controls} control${f.counts.controls > 1 ? 's' : ''}`); if (f.counts.lenses) parts.push(`${f.counts.lenses} lens${f.counts.lenses > 1 ? 'es' : ''}`); if (f.counts.tiles) parts.push(`${f.counts.tiles} tile${f.counts.tiles > 1 ? 's' : ''}`); if (f.counts.params) parts.push(`${f.counts.params} param${f.counts.params > 1 ? 's' : ''}`); if (f.counts.briefs) parts.push(`${f.counts.briefs} brief`);
      return `${(f.name + '@' + (f.version || 1)).padEnd(16)} ${parts.join(' · ')}`;
    }));
  }
  _useFragment(f) {
    if (this.fragmentList.some((x) => x.name === f.name)) return;
    const counts = { macros: 0, controls: 0, lenses: 0, tiles: 0, params: 0, briefs: 0 }; const d = f.def || {};
    this.ctl.fragmentTag = f.name;
    try {
      for (const k of Object.keys(d.params || {})) { const spec = Object.assign({}, d.params[k]); spec.path = spec.path || f.name + '.' + k; if (spec.value === undefined) spec.value = spec.def; spec.group = f.name; this.params.declare(spec); counts.params++; }
      for (const k of Object.keys(d.macros || {})) { const m = this.ctl.macro(k, { from: f.name }); d.macros[k](m); this.ctl.slider(m); counts.macros++; }
      for (const k of Object.keys(d.controls || {})) { d.controls[k](this.ctl); counts.controls++; }
      for (const k of Object.keys(d.lenses || {})) { this.lensDefs.set(k, d.lenses[k]); counts.lenses++; }
      for (const k of Object.keys(d.tiles || {})) { this.ws.templates.set(k, { name: k, build: d.tiles[k], from: f.name }); counts.tiles++; }
      for (const sel of Object.keys(d.decorate || {})) this.decorators.push({ sel, fn: d.decorate[sel], from: f.name });
      if (d.methods) { const ns = {}; for (const k of Object.keys(d.methods)) ns[k] = d.methods[k].bind(this); this.fragMethods[f.name] = ns; this[f.name] = ns; }
      if (d.agent && d.agent.brief) { this.briefs.push({ from: f.name, text: d.agent.brief }); counts.briefs++; }
      if (d.install) d.install(this);
    } finally { this.ctl.fragmentTag = null; }
    f.counts = counts; this.fragmentList.push(f); this._applyDecorators(); this._touch();
  }
  _applyDecorators() {
    for (const dec of this.decorators) {
      const [plane, selector] = dec.sel.split(/:(.*)/);
      if (plane === 'ctl') for (const c of this.ctl.controls.concat(...[...this.ctl.schemeMap.values()].map((s) => s.controls()))) if (c.id === selector || c.path === selector) { if (c.__dec !== dec) { dec.fn(c); c.__dec = dec; } }
    }
  }
  _macroDirty(m) {
    const P = this.params; P.layers[m.layer].contrib.set(m.srcKey(), m.contribution(m.value));
    // keep one entry per macro (remove stale keys of an earlier value)
    for (const [k] of [...P.layers[m.layer].contrib]) if (k.startsWith(m.name + '(') && k !== m.srcKey()) P.layers[m.layer].contrib.delete(k);
    P._bump();
  }
  _macrosFollow() { // macros with a read() follow the parameters back
    let any = false;
    for (const m of Object.values(this.macros)) if (m.readFn) {
      const v = clamp(m.readFn(this.params.below()), m.range[0], m.range[1]);
      if (Number.isFinite(v) && Math.abs(v - m.value) > 1e-9) { this.params.macroVals[m.name] = v; any = true; }
    }
    for (const m of Object.values(this.macros)) this._macroDirty(m);
    return any;
  }
  /* ----- mutations ----- */
  _snap() {
    const P = this.params, L = {}; for (const k of LAYERS) { const l = P.layers[k]; L[k] = { on: l.on, opacity: l.opacity, preset: l.preset, contrib: [...l.contrib.entries()].map(([a, b]) => [a, clone(b)]) }; }
    const nets = {}; for (const [k, n] of this.pipes) nets[k] = { engines: Object.assign({}, n.engines), pinned: Object.assign({}, n.pinned), ids: Object.assign({}, n.ids), overlay: clone(n.overlay), scene: (n.stage('scene') || { opts: {} }).opts.scene };
    return { base: clone(P.base), layers: L, macroVals: Object.assign({}, P.macroVals), nets, ws: this.ws.snap(), active: this.ctl.active, wheel: this.ctl.controls.map((c) => c.wheelVal), presets: new Map(this.presets) };
  }
  _restore(s) {
    const P = this.params; P.base = clone(s.base); P.macroVals = Object.assign({}, s.macroVals);
    for (const k of LAYERS) { const l = P.layers[k], r = s.layers[k]; l.on = r.on; l.opacity = r.opacity; l.preset = r.preset; l.contrib = new Map(r.contrib.map(([a, b]) => [a, clone(b)])); }
    for (const [k, n] of this.pipes) if (s.nets[k]) { Object.assign(n.engines, s.nets[k].engines); Object.assign(n.pinned, s.nets[k].pinned); n.ids = Object.assign({}, s.nets[k].ids); n.overlay = clone(s.nets[k].overlay); const ss = n.stage('scene'); if (ss && s.nets[k].scene) ss.opts.scene = s.nets[k].scene; }
    this.ws.restore(s.ws); this.ctl.active = s.active; if (s.presets) this.presets = new Map(s.presets);
    for (const m of Object.values(this.macros)) this._macroDirty(m);
    P._bump(); this._touch();
  }
  _pushUndo(label) { this.undoStack.push({ snap: this._snap(), label }); if (this.undoStack.length > 150) this.undoStack.shift(); this.redoStack = []; }
  apply(m, by) {
    by = by || V2.by || 'script';
    if (by === 'agent') {
      if (this.agentCfg.mode === 'read-only') throw diag('E_READONLY', `the agent is read-only; "${m.op}" was not applied`, { fix: 'switch the agent to Ask or Auto' });
      if (this.agentCfg.mode === 'ask' && !this._approving) { const id = 'p' + ++this.pendingSeq; this.pending.push({ id, op: m.op, m, by: 'agent', desc: describeOp(m), t: Date.now(), fn: () => this.apply(m, 'agent') }); this._touch(); return null; }
    }
    const last = this.log[this.log.length - 1], now = Date.now();
    const coalesce = !this._tx && !this._inUndo && m.op === 'param.set' && last && last.op === 'param.set' && last.path === m.path && last.by === by && now - last.t < 900 && this.undoStack.length && this.undoStack[this.undoStack.length - 1].coalesce === last.id;
    if (!coalesce && !this._inUndo && !this._tx) this._pushUndo(m.op);
    const entry = Object.assign({ id: this.log.length ? this.log[this.log.length - 1].id + 1 : 1, by, t: now, tx: this._tx ? this._tx.name : undefined }, m);
    if (coalesce) { last.value = m.value; last.t = now; this.params._bump(); this._exec(m, true); this._touch(); return last; }
    const info = this._exec(m, false); if (info && info.prev !== undefined) entry.prev = info.prev;
    if (m.op === 'param.set' && !this._tx && this.undoStack.length) this.undoStack[this.undoStack.length - 1].coalesce = entry.id;
    this.log.push(entry); if (this.log.length > 600) this.log.splice(0, this.log.length - 600);
    this._touch(); return entry;
  }
  _exec(m, quiet) {
    const P = this.params, op = m.op;
    switch (op) {
      case 'param.set': { const prev = P.base_get ? null : get(P.base, m.path); P._setBase(m.path, m.value); this._macrosFollow(); return { prev }; }
      case 'param.reset': { const prev = get(P.base, m.path); const d = get(FB.defaultParams(), m.path); const row = this.table.row(m.path); P._setBase(m.path, clone(d !== undefined ? d : row && row.def)); this._macrosFollow(); return { prev }; }
      case 'macro.set': {
        const mac = this.macros[m.name]; if (!mac) throw diag('E_MACRO', `no macro "${m.name}"`, { mean: nearest(m.name, Object.keys(this.macros)) });
        let v = Number(m.value); if (!Number.isFinite(v)) throw diag('E_VALUE', `macro "${m.name}" needs a number`);
        if (v < mac.range[0] || v > mac.range[1]) { const c = clamp(v, mac.range[0], mac.range[1]); warn('W_CLAMP', `macro "${m.name}" range is [${mac.range[0]}, ${mac.range[1]}]; ${v} → ${c}`); v = c; }
        const prev = P.macroVals[m.name]; P.macroVals[m.name] = v;
        for (const [k] of [...P.layers[mac.layer].contrib]) if (k.startsWith(mac.name + '(')) P.layers[mac.layer].contrib.delete(k);
        if (mac.applyFn && mac.applyPhase === 'run') { Promise.resolve(mac.applyFn(v, P.below(), this.ctlContext())).then((ops) => { const o = {}; for (const k of Object.keys(ops || {})) o[k] = normOp(ops[k]); P.layers[mac.layer].contrib.set(mac.srcKey(), o); P._bump(); this._touch(); }); }
        else P.layers[mac.layer].contrib.set(mac.srcKey(), mac.contribution(v));
        P._bump(); return { prev };
      }
      case 'wheel.set': { const c = this.ctl.controls.concat(...[...this.ctl.schemeMap.values()].map((s) => s.controls())).filter((x) => x.id === m.control); for (const x of c) x.wheelVal = m.value; const ctl = c[0]; if (ctl && ctl.applyFn) { const ops = {}; for (const [k, o] of Object.entries(ctl.applyFn(m.value) || {})) ops[k] = normOp(o); P.layers.macros.contrib.set('wheel ' + ctl.id, ops); P._bump(); } return {}; }
      case 'layer.use': { const pr = this.preset(m.preset), L = P.layers.look; if (m.layer !== 'look') { P.layers[m.layer].contrib.set(pr.name, clone(pr.ops)); P.layers[m.layer].preset = pr.name; } else { L.contrib.clear(); L.contrib.set(pr.name, clone(pr.ops)); L.preset = pr.name; } P._bump(); return {}; }
      case 'layer.on': P.layers[m.layer].on = m.on; P._bump(); return {};
      case 'layer.opacity': P.layers[m.layer].opacity = m.value; P._bump(); return {};
      case 'layer.clear': P.layers[m.layer].contrib.clear(); P.layers[m.layer].preset = null; if (m.layer === 'macros') for (const k of Object.keys(P.macroVals)) if (this.macros[k]) P.macroVals[k] = this.macros[k].rest; P._bump(); return {};
      case 'layer.bake': {
        const L = P.layers[m.layer]; for (const ops of L.contrib.values()) for (const [path, o] of Object.entries(ops)) P._setBase(path, applyOp(get(P.base, path), o, L.opacity));
        L.contrib.clear(); L.preset = null; L.opacity = 1; if (m.layer === 'macros') for (const k of Object.keys(P.macroVals)) if (this.macros[k]) P.macroVals[k] = this.macros[k].rest; this._macrosFollow(); P._bump(); return {};
      }
      case 'pin.set': { const c = P.layers.pin.contrib; let ops = c.get('pin'); if (!ops) { ops = {}; c.set('pin', ops); } ops[m.path] = { k: 'set', v: m.value }; P._bump(); return {}; }
      case 'pin.clear': { const ops = P.layers.pin.contrib.get('pin'); if (ops) { delete ops[m.path]; if (!Object.keys(ops).length) P.layers.pin.contrib.delete('pin'); } P._bump(); return {}; }
      case 'pipe.swap': { const n = m.pipe ? raw(this.pipe(m.pipe)) : this.mainNet(); n.engine(m.slot, m.engine); return {}; }
      case 'ctl.use': this.ctl.use(m.scheme); return {};
      case 'pipe.scene': { const n = m.pipe ? raw(this.pipe(m.pipe)) : this.mainNet(); const prev = (n.stage('scene') || { opts: {} }).opts.scene; n.scene(m.scene); return { prev }; }
      case 'preset.remove': this.presets.delete(m.name); return {};
      case 'preset.add': { const prev = this.presets.get(m.name); if (prev && prev.builtin) throw diag('E_PRESET', `"${m.name}" is a built-in preset and cannot be replaced`, { fix: 'save it under another name' }); this.presets.set(m.name, new V2.Preset(this, m.name, Object.assign({}, m.def, { user: true }))); return { prev: prev ? prev.name : undefined }; }
      case 'pipe.scene': return `use the scene "${m.scene}"`;
    case 'layer.stack': { const L = P.layers[m.layer]; if (!L) throw diag('E_LAYER', `no layer "${m.layer}"`); if (m.on === false) L.contrib.delete(m.preset); else { const pr = this.preset(m.preset); L.contrib.set(pr.name, clone(pr.ops)); } P._bump(); return {}; }
      default:
        if (/^(tile|dock|scope|lens|probe|link|layout|zoom)\./.test(op)) return this.ws.exec(m, quiet);
        throw diag('E_OP', `unknown operation "${op}"`, { mean: nearest(op, ['param.set', 'macro.set', 'layer.use', 'tile.add', 'tile.remove', 'dock.move', 'pipe.swap', 'scope.set', 'lens.add']) });
    }
  }
  ctlContext() {
    const wb = this; return { measure: async (probe, fn) => { const net = wb.mainNet(); const pr = typeof probe === 'string' ? wb.ws.probeRect(probe) : probe; return fn(V2.tapProxy(net, { w: 192 }), pr); } };
  }
  tx(name, fn) {
    if (this._tx) { fn({ apply: (m) => this.apply(m) }); return this; }
    this._pushUndo(name); this._tx = { name };
    try { fn({ apply: (m, by) => this.apply(m, by) }); } finally { this._tx = null; }
    this.log.push({ id: this.log.length ? this.log[this.log.length - 1].id + 1 : 1, op: 'tx', name, by: V2.by || 'script', t: Date.now() }); this._touch(); return this;
  }
  undo() { const e = this.undoStack.pop(); if (!e) return false; this.redoStack.push({ snap: this._snap(), label: e.label }); this._inUndo = true; try { this._restore(e.snap); } finally { this._inUndo = false; } this.log.push({ id: this.log.length ? this.log[this.log.length - 1].id + 1 : 1, op: 'undo', by: V2.by || 'ui', t: Date.now(), name: e.label }); return true; }
  redo() { const e = this.redoStack.pop(); if (!e) return false; this.undoStack.push({ snap: this._snap(), label: e.label }); this._inUndo = true; try { this._restore(e.snap); } finally { this._inUndo = false; } this.log.push({ id: this.log.length ? this.log[this.log.length - 1].id + 1 : 1, op: 'redo', by: V2.by || 'ui', t: Date.now(), name: e.label }); return true; }
  approve(id) { const i = this.pending.findIndex((p) => p.id === id); if (i < 0) return; const p = this.pending.splice(i, 1)[0]; this._approving = true; try { p.fn(); } finally { this._approving = false; } }
  skip(id) { this.pending = this.pending.filter((p) => p.id !== id); this._touch(); }
  approveAll() { for (const p of this.pending.slice()) this.approve(p.id); }
  agent(o) { Object.assign(this.agentCfg, o || {}); if (o && o.brief) this.briefs.push({ from: 'agent', text: o.brief }); return this; }
  ask(prompt) { if (!V2.askAgent) throw diag('E_AGENT', 'no agent is connected to this bench'); return V2.askAgent(this, prompt); }
  /* ----- state, hash, script ----- */
  get state() {
    const nets = [...this.pipes.values()].map((n) => [n.name, n.hashIR(), n.engines, n.ids, n.overlay]);
    const lay = {}; for (const k of LAYERS) { const l = this.params.layers[k]; lay[k] = [l.on, l.opacity, [...l.contrib.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))]; }
    const h = hash({ nets, base: this.params.base, lay, macros: this.params.macroVals, ws: this.ws.hashState() });
    return { hash: h, toString: () => h };
  }
  script() { return V2.scriptOf(this); }
  save() { return { v: 2, name: this.name, hash: this.state.hash, script: this.script() }; }
}
Bench.seq = 0;
function describeOp(m) {
  switch (m.op) {
    case 'param.set': return `set ${m.path} to ${V2.fmtV(m.value)}`;
    case 'macro.set': return `move macro ${m.name} to ${V2.fmtV(m.value)}`;
    case 'tile.add': return `add tile "${m.id}" (${m.kind || 'tile'})`;
    case 'tile.remove': return `remove tile "${m.id}"`;
    case 'layer.use': return `use preset "${m.preset}" in ${m.layer}`;
    case 'layer.stack': return `${m.on === false ? 'remove' : 'stack'} preset "${m.preset}" ${m.on === false ? 'from' : 'on'} ${m.layer}`;
    case 'preset.add': return `save preset "${m.name}"`;
    case 'preset.remove': return `remove preset "${m.name}"`;
    case 'ctl.use': return `use control scheme "${m.scheme}"`;
    case 'pin.set': return `pin ${m.path} at ${V2.fmtV(m.value)}`;
    case 'pipe.swap': return `swap ${m.slot} engine to ${m.engine}`;
    case 'scope.set': return `set the scope of tile "${m.tile}"`;
    default: return m.op + (m.id ? ' ' + m.id : m.tile ? ' ' + m.tile : m.path ? ' ' + m.path : '');
  }
}
V2.describeOp = describeOp; V2.CORE_KEYS = ['film', 'print', 'camera', 'film_render', 'enlarger', 'print_render', 'output', 'lut2_n'];

/* ---------- fragments ---------- */
function fragment(name, def) { return { __fragment: true, name, def: def || {}, version: (def && def.version) || 1, counts: null }; }

/* ---------- script generation ---------- */
const q = (s) => JSON.stringify(s);
const js = (v) => (v === undefined ? 'undefined' : JSON.stringify(v));
V2.scriptOf = function (wb) {
  const L = [`const wb = bench(${q(wb.name)});`, 'const { ctl, ws } = wb;', 'const { row, col, tabs } = ws.dock;', ''];
  const ident = (s) => 'm_' + String(s).replace(/\W+/g, '_');
  for (const m of Object.values(wb.macros)) {
    if (m.from) continue;
    let s = `const ${ident(m.name)} = ctl.macro(${q(m.name)}, { range: ${js(m.range)}, step: ${m.step}, value: ${m.rest}${m.unit ? ', unit: ' + q(m.unit) : ''} })`;
    for (const d of m.drivesList) { const o = Object.assign({}, d); delete o.path; s += `.drives(${q(d.path)}, ${js(o)})`; }
    if (m.applyFn) s += `.apply(${m.applyFn.toString()}${m.applyPhase === 'run' ? ', { phase: "run" }' : ''})`; if (m.readFn) s += `.read(${m.readFn.toString()})`;
    L.push(s + ';'); if (m.shape) L.push(`${ident(m.name)}.setShape(${js(m.shape)});`);
  }
  const ctlCode = (c) => {
    let s;
    if (c.macro) s = `ctl.${c.kind === 'toggle' ? 'slider' : c.kind}(${ident(c.macro.name)})`;
    else if (c.kind === 'choice') s = `ctl.choice(${q(c.name)}, ${js(c.choices)}).drives(${q(c.drivesPath)})`;
    else if (c.kind === 'button') s = `ctl.button(${q(c.name)})` + (c.opensName ? `.opens(${q(c.opensName)})` : '') + c.reqs.map((r) => `.requires(${q(r)})`).join('');
    else if (c.kind === 'wheel') s = `ctl.wheel(${q(c.name)})` + (c.applyFn ? `.apply(${c.applyFn.toString()})` : '');
    else s = `ctl.${c.kind}(${q(c.path)})`;
    if (c.widgetName !== c.kind && c.kind !== 'choice' && c.kind !== 'button' && c.kind !== 'wheel') s += `.widget(${q(c.widgetName)})`;
    const def = c.macro ? c.macro.label : c.row ? c.row.label : c.name; if (c.labelText !== def && c.labelText) s += `.label(${q(c.labelText)})`;
    if (c.fmtFn) s += `.fmt(${c.fmtFn.toString()})`; if (c.detentList && c.detentList.length) s += `.detents(${js(c.detentList)})`;
    return s;
  };
  for (const [nm, sch] of wb.ctl.schemeMap) {
    if (sch.fromSpec) { L.push(`ctl.scheme(${q(nm)}, ctl.fromSpec());`); continue; }
    L.push(`ctl.scheme(${q(nm)}, (s) => {`); for (const G of sch.groups) L.push(`  s.group(${q(G.title)})` + G.items.map((c) => `\n    .add(${ctlCode(c)})`).join('') + ';'); L.push('});');
  }
  if (wb.ctl.active) L.push(`ctl.use(${q(wb.ctl.active)});`);
  const defs = FB.defaultParams(), flat = [];
  (function w(o, pre) { for (const k of Object.keys(o)) { const p = pre ? pre + '.' + k : k, v = o[k]; if (isObj(v)) w(v, p); else if (Array.isArray(v)) v.forEach((x, i) => flat.push([p + '.' + i, x])); else flat.push([p, v]); } })(wb.params.base, '');
  for (const [d, def] of wb.stageDefs) { const s = def.src; L.push(`const ${d.replace(/\W/g, '_')} = wb.stage(${q(d)}, { from: ${q(def.from)}, to: ${q(def.to)}, params: ${js(def.params).replace(/"([a-z_]+)":/gi, '$1:')}${s.build ? ', build: ' + s.build.toString() : ''}, eval: ${s.eval.toString()}${s.run ? ', run: ' + s.run.toString() : ''} });`); }
  for (const [nm, net] of wb.pipes) {
    if (net.kind === 'graph' || net.compiled) { L.push(`// graph ${nm}: build it with wb.graph(…) in your own script`); continue; }
    const base = net.parent ? `${net.parentVar || 'base'}.fork(${q(nm)})` : `wb.pipe(${q(nm)})`;
    const parts = []; const scn = net.stage('scene'); if (scn) parts.push(`.scene(${q(scn.opts.scene)})`);
    const film = net.ids.film || wb.params.base.film, print = net.ids.print || wb.params.base.print;
    if (net.stage('film.expose')) parts.push(`.film(${q(film)})`); if (net.stage('enlarger')) parts.push(`.enlarger(${Object.keys(net.stage('enlarger').opts).length ? js(net.stage('enlarger').opts) : ''})`); if (net.stage('paper')) parts.push(`.paper(${q(print)})`); if (net.stage('scan')) parts.push('.scan()');
    L.push(`const ${net.parent ? 'fork_' + nm.replace(/\W/g, '_') : 'rig' + (nm === 'default' ? '' : '_' + nm.replace(/\W/g, '_'))} = ${base}${net.parent ? '' : parts.join('')};`);
    for (const s of net.stages) if (s.kind === 'custom') L.push(`rig.insert(${s.id.replace(/\W/g, '_')}, { after: ${q(net.stage(s.in[0]).tap)} });`);
    for (const slot of Object.keys(net.pinned)) if (net.pinned[slot]) L.push(`rig.engine(${q(slot)}, ${q(net.engines[slot])});`);
  }
  L.push('');
  const late = [];
  for (const [p, v] of flat) { const d = get(defs, p), ext = d === undefined; if (p === 'film' || p === 'print') continue; if (ext) late.push(`wb.params.set(${q(p)}, ${js(v)});`); else if (stable(d) !== stable(v)) L.push(`wb.params.set(${q(p)}, ${js(v)});`); }
  for (const k of LAYERS) { const l = wb.params.layers[k]; if (k === 'look' && l.preset && wb.presets.has(l.preset)) { const pr = wb.presets.get(l.preset); if (!pr.builtin) L.push(`wb.preset(${q(pr.name)}, ${js({ desc: pr.desc, ops: pr.ops })});`); L.push(`ctl.layer("look").use(wb.preset(${q(l.preset)}));`); } if (!l.on) L.push(`ctl.layer(${q(k)}).off();`); if (l.opacity !== 1) L.push(`ctl.layer(${q(k)}).opacity(${l.opacity});`); }
  for (const [n, m] of Object.entries(wb.macros)) if (Math.abs(m.value - m.rest) > 1e-9) L.push(`ctl.macro(${q(n)}).value = ${m.value};`);
  const pins = wb.params.layers.pin.contrib.get('pin'); if (pins) for (const [p, o] of Object.entries(pins)) L.push(`ctl.pin(${q(p)}, ${js(o.v)});`);
  L.push(...wb.ws.scriptLines()); L.push(...late);
  return L.join('\n') + '\n';
};

/* ---------- running a script ---------- */
V2.api = function () { return { bench: V2.bench, p: V2.p, fragment, units: V2.units, engines: V2.engines, lens: V2.lens, op: V2.op, curve1D: V2.curve1D, interp: V2.interp, smoothstep: V2.smoothstep, luma: V2.luma, zoneOf: V2.zoneOf }; };
V2.bench = function bench(name) { const b = new Bench(name); V2.lastBench = b; return V2.guardBench(b); };
V2.guardBench = function (b) {
  const cg = guard(b.ctl, 'ctl'), wsg = guard(b.ws, 'ws');
  const wbp = new Proxy(b, { get(t, k, r) { if (k === V2.RAW) return t; if (k === 'ctl') return cg; if (k === 'ws') return wsg; if (typeof k === 'symbol' || k in t || ['then', 'toJSON', 'inspect', 'length', 'nodeType', 'constructor', 'tagName'].includes(k) || k[0] === '_') return Reflect.get(t, k, r === wbp ? t : r); const keys = []; for (let o = t; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) for (const n of Object.getOwnPropertyNames(o)) if (n !== 'constructor' && n[0] !== '_') keys.push(n); throw diag('E_MEMBER', `wb has no member "${k}"`, { mean: nearest(k, keys) }); } });
  b.proxy = wbp; b.ctlp = cg; b.wsp = wsg; return wbp;
};
/* names a script declares at its own top level; a scope entry of the same name would clash with the declaration */
function declaredNames(src) {
  const out = new Set(); const re = /^(?:const|let|var)\s+(\{[^=]*\}|\[[^=]*\]|[A-Za-z_$][\w$]*)\s*=|^(?:async\s+)?(?:function\*?|class)\s+([A-Za-z_$][\w$]*)/gm; let m;
  while ((m = re.exec(src))) {
    if (m[2]) { out.add(m[2]); continue; }
    const lhs = m[1]; if (/^[\w$]+$/.test(lhs)) { out.add(lhs); continue; }
    for (const part of lhs.slice(1, -1).split(',')) { const t = part.split('=')[0].split(':').pop().trim().replace(/^\.\.\./, ''); if (/^[A-Za-z_$][\w$]*$/.test(t)) out.add(t); }
  }
  return out;
}
V2.runScript = function (src, extra) {
  const api = Object.assign(V2.api(), extra || {}), mine = declaredNames(src), names = Object.keys(api).filter((n) => !mine.has(n));
  const fn = new Function(...names, '"use strict";\n' + src + '\n;return typeof wb !== "undefined" ? wb : undefined;');
  return fn(...names.map((n) => api[n]));
};
V2.bench.load = function (saved, scope) { const wb = V2.runScript(saved.script, scope); return wb; };
V2.bench.run = function (script) { return V2.runScript(script); };
Bench.prototype.toString = function () { return 'bench "' + this.name + '" · ' + this.state.hash + ' · ' + this.pipes.size + ' pipeline' + (this.pipes.size === 1 ? '' : 's'); };
Object.assign(V2, { Bench, GraphBuilder, NodeRef, fragment, TYPES });
V2.init = function (data, CC24) {
  V2.data = data; V2.cache = new V2.Cache(); const gens = V2.makeScenes(CC24); V2.sceneStore = {}; V2.scenes = {};
  for (const k of Object.keys(gens)) Object.defineProperty(V2.scenes, k, { enumerable: true, configurable: true, get() { return V2.sceneStore[k] || (V2.sceneStore[k] = gens[k]()); } });
};
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* Filmbench v2 runtime, part E: the workspace plane — tiles, dock, probes, lenses, layouts, links, and the data each tile shows. */
(function (g) {
'use strict';
const V2 = g.V2;
const { diag, warn, nearest, hash, clamp, get, clone, raw, stable, Report, isObj, interp, zoneOf, dE2000, labToRgb } = V2;
const { Img } = CV;

/* ---------- dock combinators: plain data, shared with the IDE's own dock ---------- */
const mkKid = (k) => (Array.isArray(k) && typeof k[0] === 'number' ? { f: k[0], n: k[1] } : { f: null, n: k });
const asNode = (n) => (typeof n === 'string' ? { t: 'tile', views: [n], active: 0 } : n && n.t ? n : (() => { throw diag('E_DOCK', 'a dock node is a tile id, row(…), col(…) or tabs(…)'); })());
function split(dir, kids) {
  const ks = kids.map(mkKid), nodes = ks.map((k) => asNode(k.n)), fixed = ks.reduce((a, k) => a + (k.f || 0), 0), free = ks.filter((k) => k.f === null).length;
  const sizes = ks.map((k) => (k.f !== null ? k.f : free ? Math.max(0, 1 - fixed) / free : 1 / ks.length)); const s = sizes.reduce((a, b) => a + b, 0) || 1;
  return { t: 'split', dir, kids: nodes, sizes: sizes.map((x) => Math.round((x / s) * 1e4) / 1e4) };
}
const row = (...k) => split('row', k), col = (...k) => split('col', k), tabs = (...ids) => ({ t: 'tile', views: ids.slice(), active: 0 });
V2.dock = { row, col, tabs };
const treeIds = (n, out) => { out = out || []; if (n.t === 'tile') out.push(...n.views); else for (const k of n.kids) treeIds(k, out); return out; };
V2.treeIds = treeIds;
function descTree(n, pre, last, lines, tiles) {
  const br = pre === '' ? '' : last ? '└ ' : '├ ';
  if (n.t === 'tile') {
    if (n.views.length === 1) { const t = tiles.get(n.views[0]); lines.push(pre + br + n.views[0].padEnd(Math.max(9, n.views[0].length + 1)) + ' ' + (t ? t.summary() : '')); }
    else { lines.push(pre + br + 'tabs     [ ' + n.views.map((v) => { const t = tiles.get(v); return v + (t && t.short() ? ' ' + t.short() : ''); }).join(',  ') + ' ]'); }
    return;
  }
  lines.push(pre + br + n.dir + ' ' + n.sizes.map((s) => Math.round(s * 100) + '%').join(' / '));
  const np = pre + (pre === '' ? '' : last ? '  ' : '│ ');
  n.kids.forEach((k, i) => descTree(k, np, i === n.kids.length - 1, lines, tiles));
}

/* ---------- lenses ---------- */
const turbo = CV.turbo;
function mkLens(name, spec) {
  spec = spec || {}; const params = {};
  for (const k of Object.keys(spec.params || {})) { const s = Object.assign({}, spec.params[k]); s.path = s.path || `lens.${name}.${k}`; if (s.value === undefined) s.value = s.def; params[k] = s; }
  const code = `lens(${JSON.stringify(name)}, { params: ${JSON.stringify(spec.params || {})}${spec.eval ? ', eval: ' + String(spec.eval) : ''}${spec.overlay ? ', overlay: ' + String(spec.overlay) : ''} })`;
  return { __lens: true, name, params, evalFn: spec.eval, overlayFn: spec.overlay, off: false, spec, code, rev: hash([name, String(spec.eval || ''), String(spec.overlay || '')]) };
}
function lens(name, spec) { return mkLens(name, spec); }
const argCode = (a) => { try { return a === undefined || (a && typeof a === 'object' && !Object.keys(a).length) ? '' : JSON.stringify(a); } catch (e) { return ''; } };
const builtin = (name, args, run, code) => Object.assign(mkLens(name, {}), { builtin: true, args, runFn: run, code: code || `lens.${name}(${name === 'falseDensity' ? (args && args.tap ? JSON.stringify(args.tap) : '') : argCode(args)})` });
lens.clip = (o) => builtin('clip', o || {}, (img) => {
  const hi = 0.988, lo = 0.02, out = img.clone(), d = out.data, n = img.w * img.h; let nh = 0, nl = 0;
  for (let i = 0; i < n; i++) {
    const r = d[i * 3], gg = d[i * 3 + 1], b = d[i * 3 + 2], x = i % img.w, y = (i / img.w) | 0, hatch = ((x + y) % 6) < 3;
    if (r >= hi || gg >= hi || b >= hi) { nh++; if (hatch) { d[i * 3] = 0.86; d[i * 3 + 1] = 0.1; d[i * 3 + 2] = 0.1; } }
    else if (r <= lo && gg <= lo && b <= lo) { nl++; if (hatch) { d[i * 3] = 0.1; d[i * 3 + 1] = 0.3; d[i * 3 + 2] = 0.85; } }
  }
  return { img: out, overlay: { legend: `clip: ${(100 * nh / n).toFixed(1)} % highlights · ${(100 * nl / n).toFixed(1)} % shadows` } };
}, 'lens.clip()');
lens.zones = (o) => builtin('zones', o || {}, (img) => {
  const n = (o && o.n) || 11, L = img.lab().data, out = img.clone(), N = img.w * img.h;
  for (let i = 0; i < N; i++) { const z = clamp(Math.round(zoneOf(L[i * 3]) ), 0, n - 1), c = turbo(z / (n - 1)); out.data[i * 3] = c[0]; out.data[i * 3 + 1] = c[1]; out.data[i * 3 + 2] = c[2]; }
  return { img: out, overlay: { legend: `zones 0…${n - 1} from L*` } };
}, 'lens.zones(' + (o ? JSON.stringify(o) : '') + ')');
lens.diff = (o) => builtin('diff', o || {}, (img, ctx) => {
  const other = ctx.other(o.vs), gain = o.gain || 4, A = img.lab().data, Bimg = other.w === img.w && other.h === img.h ? other : other.resize(img.w, img.h, true), B = Bimg.lab().data, out = img.clone(), N = img.w * img.h;
  const f = o.metric === 'dE76' ? (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : dE2000; let sum = 0;
  for (let i = 0; i < N; i++) { const e = f([A[i * 3], A[i * 3 + 1], A[i * 3 + 2]], [B[i * 3], B[i * 3 + 1], B[i * 3 + 2]]); sum += e; const c = turbo(clamp((e * gain) / 20, 0, 1)); out.data[i * 3] = c[0]; out.data[i * 3 + 1] = c[1]; out.data[i * 3 + 2] = c[2]; }
  return { img: out, overlay: { legend: `ΔE ${o.metric === 'dE76' ? '76' : '2000'} × ${gain} · mean ${(sum / N).toFixed(2)}` }, value: sum / N };
});
lens.split = (o) => builtin('split', o || {}, (img, ctx) => {
  const other = ctx.other(o.with), at = o.at === undefined ? 0.5 : o.at, out = img.clone(), B = other.w === img.w && other.h === img.h ? other : other.resize(img.w, img.h, true), x0 = Math.round(img.w * at);
  for (let y = 0; y < img.h; y++) for (let x = x0; x < img.w; x++) { const i = (y * img.w + x) * 3; out.data[i] = B.data[i]; out.data[i + 1] = B.data[i + 1]; out.data[i + 2] = B.data[i + 2]; }
  for (let y = 0; y < img.h; y++) { const i = (y * img.w + Math.min(img.w - 1, x0)) * 3; out.data[i] = out.data[i + 1] = out.data[i + 2] = 1; }
  return { img: out, overlay: { legend: 'A | B', split: at } };
});
lens.falseDensity = (tap) => builtin('falseDensity', { tap }, (img, ctx) => {
  const t = ctx.tap(tap), out = new Img(t.w, t.h, new Float32Array(t.w * t.h * 3), { space: 'srgb' }), N = t.w * t.h; let mx = 0.01;
  for (let i = 0; i < N * 3; i++) if (t.data[i] > mx) mx = t.data[i];
  for (let i = 0; i < N; i++) { const d = (t.data[i * 3] + t.data[i * 3 + 1] + t.data[i * 3 + 2]) / 3, c = turbo(clamp(d / mx, 0, 1)); out.data[i * 3] = c[0]; out.data[i * 3 + 1] = c[1]; out.data[i * 3 + 2] = c[2]; }
  return { img: out, overlay: { legend: `density of ${tap}, 0…${mx.toFixed(2)}` } };
}, `lens.falseDensity(${JSON.stringify(tap)})`);
V2.lens = lens;
/* run one lens on an image; custom lenses get their params as P */
function runLens(wb, l, img, ctx) {
  if (l.off) return { img };
  if (l.runFn) return l.runFn(img, ctx);
  const P = {}; for (const k of Object.keys(l.params)) { const v = get(wb.params.effective(), l.params[k].path); P[k] = v === undefined ? l.params[k].value : v; }
  V2.phase.push('eval'); let r; try { r = l.evalFn(img, P); } finally { V2.phase.pop(); }
  const ov = l.overlayFn ? l.overlayFn(img, P) : null;
  if (r && r.toRGB) r = r.toRGB();
  return { img: r, overlay: ov };
}

/* ---------- the displayable form of a tap image ---------- */
V2.displayImg = function (img) {
  const sp = img.meta.space;
  if (sp === 'srgb' || sp === undefined) return img;
  const n = img.w * img.h, o = new Float32Array(n * 3), d = img.data;
  if (sp === 'linear') { for (let i = 0; i < n * 3; i++) o[i] = CV.enc(d[i]); }
  else if (sp === 'density') { for (let i = 0; i < n * 3; i++) o[i] = CV.enc(Math.pow(10, -d[i])); } // what the transparency looks like on a light table
  else if (sp === 'logE') { for (let i = 0; i < n * 3; i++) o[i] = clamp((d[i] + 3) / 5, 0, 1); }
  else return img;
  return new Img(img.w, img.h, o, { space: 'srgb' });
};

/* ---------- tile records ---------- */
class TileRec {
  constructor(id, kind, spec) { this.id = id; this.kind = kind; this.spec = spec || {}; this.scope = {}; this.lenses = []; this.crop = null; this.zoom = null; this.match = null; this.ephemeral = false; this.by = 'script'; this.pipe = null; this.handlers = {}; this.code = ''; this.title = null; }
  copy() { const t = Object.assign(new TileRec(this.id, this.kind, this.spec), this); t.scope = clone(this.scope); t.lenses = this.lenses.slice(); t.handlers = this.handlers; return t; }
  taps() {
    const s = this.spec, k = this.kind; const t = [];
    if (k === 'render' || k === 'hist' || k === 'parade') t.push(s.tap);
    if (k === 'line' && s.taps) t.push(...s.taps);
    if (k === 'mosaic') t.push('out');
    if (k === 'table') t.push('out');
    for (const l of this.lenses) if (l.args && l.args.tap) t.push(l.args.tap);
    return t.filter(Boolean);
  }
  ref() { const k = this.kind; return k === 'render' || k === 'hist' || k === 'parade' ? '← ' + this.spec.tap : k === 'curves' ? '← ' + (this.spec.of || 'paper') : k === 'line' ? '← ' + (this.spec.taps || ['out']).join(', ') : k === 'mosaic' || k === 'table' ? '← out' : ''; }
  short() { return (this.ref() ? this.ref() : this.kind === 'text' ? '' : '').replace(/^← /, '← '); }
  summary() { const k = this.kind; return k === 'controls' ? 'controls(' + JSON.stringify(this.spec.scheme) + ')' : k === 'text' ? 'text' : k + ' ' + this.ref(); }
}
V2.TileRec = TileRec;

class Workspace {
  constructor(wb) {
    this.wb = wb; this.tiles = new Map(); this.dockTree = null; this.probes = new Map(); this.linkList = []; this.layouts = new Map(); this.layoutName = 'default'; this.templates = new Map(); this.shelf = []; this.pipeName = null;
    this.dock = Object.assign({ row, col, tabs }, { set: (tree) => { this.wb.apply({ op: 'dock.set', tree: this._check(tree) }); return this.wb; }, get: () => clone(this.dockTree), move: (spec) => { this.wb.apply(Object.assign({ op: 'dock.move' }, spec)); return this.wb; } });
    const self = this;
    this.layout = Object.assign((name, fn) => { self.layouts.set(name, { fn }); if (fn) { const keep = self.layoutName; self.layoutName = name; const before = self.dockTree; fn(); self.layouts.get(name).tree = clone(self.dockTree); self.layoutName = keep; self.dockTree = before; } self.wb._touch(); return self.wb; }, {
      list: () => ['default'].concat([...self.layouts.keys()].filter((k) => k !== 'default')),
      use: (name) => { self.wb.apply({ op: 'layout.use', name }); return self.wb; },
      json: () => self.layoutJson(),
      current: () => self.layoutName,
    });
    this.link = Object.assign((tiles, kind) => { self.wb.apply({ op: 'link.add', tiles, kind }); return self.wb; }, { list: () => self.linkList.map((l) => ({ tiles: l.tiles === '*' ? '*' : l.tiles.length, kind: l.kind })) });
    this.refresh = { policy: { drag: 'draft', release: 'full', plots: 'idle' } };
  }
  /* ----- tile builders ----- */
  tile(id) {
    if (typeof id !== 'string' || !id) throw diag('E_ARG', 'ws.tile(id) needs a name', { fix: 'ws.tile("print").render("out")' });
    return V2.guard(new TileBuilder(this, id), `tile "${id}"`);
  }
  has(id) { return this.tiles.has(id); }
  get(id) { const t = this.tiles.get(id); if (!t) throw diag('E_TILE', `no tile "${id}"`, { mean: nearest(id, [...this.tiles.keys()]), list: { tiles: [...this.tiles.keys()] } }); return t; }
  probe(name, rect) {
    if (rect === undefined) return this.probeRect(name);
    if (!Array.isArray(rect) || rect.length !== 4 || rect.some((x) => typeof x !== 'number')) throw diag('E_ARG', 'a probe is [u, v, w, h] in 0…1', { fix: 'ws.probe("skin", [0.38, 0.30, 0.08, 0.10])' });
    this.wb.apply({ op: 'probe.set', name, rect }); return this.wb;
  }
  probeRect(name) { const r = this.probes.get(name); if (!r) throw diag('E_PROBE', `no probe "${name}"`, { mean: nearest(name, [...this.probes.keys()]), list: { probes: [...this.probes.keys()] } }); const a = r.slice(); a.name = name; return a; }
  pipe(net) { if (net) { this.pipeName = raw(net).name; this.wb._touch(); const a = this.audit(); if (a.dangling.length) warn('W_DANGLING', `${a.dangling.length} tiles read taps that "${this.pipeName}" lacks: ${a.dangling.map((d) => d.tile + ' ← ' + d.tap).join(' · ')}`, { fix: 'they show a placeholder and come back with the pipeline; ws.audit() lists them' }); return this.wb; } return this.net(); }
  net() { const w = this.wb; return (this.pipeName && w.pipes.get(this.pipeName)) || w.mainNet(); }
  audit() { const net = this.net(), dangling = []; if (net) for (const t of this.tiles.values()) for (const tap of t.taps()) if (!net.byTap(tap)) dangling.push({ tile: t.id, tap }); return new Report(dangling.map((d) => `${d.tile} ← ${d.tap}`), { dangling }); }
  demandFor(net) { const d = []; if ((this.net() === net) || !this.pipeName) for (const t of this.tiles.values()) { if (this.shelf.includes(t.id)) continue; for (const tap of t.taps()) d.push({ tap, by: `tile "${t.id}"` }); } return d; }
  _check(tree) {
    const n = asNode(tree), ids = treeIds(n);
    for (const id of ids) if (!this.tiles.has(id)) throw diag('E_TILE', `dock names tile "${id}", which does not exist`, { mean: nearest(id, [...this.tiles.keys()]), list: { tiles: [...this.tiles.keys()] }, fix: `ws.tile("${id}").render("out") before ws.dock.set(…)` });
    const dup = ids.find((x, i) => ids.indexOf(x) !== i); if (dup) throw diag('E_DOCK', `tile "${dup}" appears twice in the dock`);
    return clone(n);
  }
  describe() { const lines = []; if (!this.dockTree) lines.push('(no dock set)'); else descTree(this.dockTree, '', true, lines, this.tiles); if (this.shelf.length) lines.push('shelf: ' + this.shelf.join(' · ')); return new Report(lines, { tree: this.dockTree }); }
  snapshot() { return { layout: this.layoutName, tiles: [...this.tiles.values()].map((t) => ({ id: t.id, kind: t.kind, tap: t.spec.tap, scope: t.scope, lenses: t.lenses.map((l) => l.name), ephemeral: t.ephemeral })), dock: this.dockTree, links: this.linkList.map((l) => ({ tiles: l.tiles, kind: l.kind })), probes: Object.fromEntries(this.probes) }; }
  layoutJson() { const tiles = {}; for (const t of this.tiles.values()) tiles[t.id] = { [t.kind]: t.kind === 'controls' ? t.spec.scheme : t.kind === 'render' ? t.spec.tap : t.spec.of || t.spec.tap || {} }; const enc = (n) => (n.t === 'tile' ? (n.views.length === 1 ? n.views[0] : { tabs: n.views }) : { [n.dir]: n.kids.map((k, i) => (n.sizes ? [Math.round(n.sizes[i] * 100) / 100, enc(k)] : enc(k))) }); return { v: 2, dock: this.dockTree ? enc(this.dockTree) : null, tiles, links: this.linkList.map((l) => ({ tiles: l.tiles, kind: l.kind })) }; }
  /* ----- snapshots, hash and script ----- */
  snap() { return { tiles: [...this.tiles.entries()].map(([k, t]) => [k, t.copy()]), dock: clone(this.dockTree), probes: [...this.probes.entries()].map(([k, v]) => [k, v.slice()]), links: clone(this.linkList), layoutName: this.layoutName, shelf: this.shelf.slice(), pipeName: this.pipeName }; }
  restore(s) { this.tiles = new Map(s.tiles.map(([k, t]) => [k, t.copy()])); this.dockTree = clone(s.dock); this.probes = new Map(s.probes.map(([k, v]) => [k, v.slice()])); this.linkList = clone(s.links); this.layoutName = s.layoutName; this.shelf = s.shelf.slice(); this.pipeName = s.pipeName; }
  tileCode(t) {   /* the record is the truth for scope and lenses set by raw mutations; the code string keeps the chain */
    const lensCode = (l) => `.lens(${l.code || (l.builtin ? 'lens.' + l.name + '()' : JSON.stringify(l.name))})`;
    let c = t.code; if (!c) return null;
    if (t.scope && Object.keys(t.scope).length && !/\.scope\(/.test(c)) c += `.scope(${JSON.stringify(t.scope)})`;
    const have = (c.match(/\.lens\(/g) || []).length; for (const l of t.lenses.slice(have)) c += lensCode(l);
    for (const l of t.lenses) if (l.off) c += `.lens(${JSON.stringify(l.name)}).off()`;
    return c;
  }
  hashState() { const rt = (n) => (n && n.t === 'split' ? { t: 'split', dir: n.dir, kids: n.kids.map(rt), sizes: n.sizes.map((x) => Math.round(x * 1e4) / 1e4) } : n); return [[...this.tiles.values()].map((t) => [t.id, t.kind, t.spec.tap, t.spec.of, t.spec.scheme, t.spec.text, t.scope, t.lenses.map((l) => l.rev + l.name), t.crop, t.zoom, t.match]), rt(this.dockTree), [...this.probes.entries()], this.linkList.map((l) => [l.tiles, l.kind])]; }
  scriptLines() {
    const L = [], pre = [];
    for (const [k, r] of this.probes) L.push(`ws.probe(${JSON.stringify(k)}, ${JSON.stringify(r)});`);
    for (const t of this.tiles.values()) if (!t.ephemeral) L.push(this.tileCode(t) || `// tile "${t.id}" (${t.kind})`);
    const enc = (n) => (n.t === 'tile' ? (n.views.length === 1 ? JSON.stringify(n.views[0]) : `tabs(${n.views.map((v) => JSON.stringify(v)).join(', ')})`) : `${n.dir}(${n.kids.map((k, i) => `[${Math.round(n.sizes[i] * 1e4) / 1e4}, ${enc(k)}]`).join(', ')})`);
    if (this.dockTree) L.push(`ws.dock.set(${enc(this.dockTree)});`);
    for (const l of this.linkList) L.push(`ws.link(${l.tiles === '*' ? '"*"' : JSON.stringify(l.tiles)}, ${JSON.stringify(l.kind)});`);
    return L;
  }
  /* ----- mutations ----- */
  exec(m) {
    switch (m.op) {
      case 'tile.add': { const prev = this.tiles.get(m.rec.id); const rec = m.rec; if (prev && !m.keepState) { rec.scope = rec.scope && Object.keys(rec.scope).length ? rec.scope : prev.scope; rec.lenses = rec.lenses.length ? rec.lenses : prev.lenses.slice(); } this.tiles.set(rec.id, rec); if (!this.dockTree && !rec.ephemeral) { this.dockTree = { t: 'tile', views: [rec.id], active: 0 }; } else if (this.dockTree && !treeIds(this.dockTree).includes(rec.id) && !this.shelf.includes(rec.id)) this._place(rec.id); return { prev: prev ? prev.id : undefined }; }
      case 'tile.remove': { this.tiles.delete(m.id); this._unplace(m.id); return {}; }
      case 'tile.patch': { const t = this.get(m.id).copy(); Object.assign(t, m.patch); if (m.patch.lenses) t.lenses = m.patch.lenses; this.tiles.set(m.id, t); return {}; }
      case 'scope.set': { const t = this.get(m.tile).copy(); t.scope = Object.assign(m.replace ? {} : clone(t.scope), m.scope); this.tiles.set(m.tile, t); return {}; }
      case 'lens.add': { const t = this.get(m.tile).copy(); t.lenses = t.lenses.concat([m.lens]); this.tiles.set(m.tile, t); return {}; }
      case 'lens.off': { const t = this.get(m.tile).copy(); t.lenses = t.lenses.map((l) => (l.name === m.name ? Object.assign(Object.create(Object.getPrototypeOf(l)), l, { off: m.off !== false }) : l)); this.tiles.set(m.tile, t); return {}; }
      case 'lens.remove': { const t = this.get(m.tile).copy(); t.lenses = t.lenses.filter((l) => l.name !== m.name); this.tiles.set(m.tile, t); return {}; }
      case 'dock.set': this.dockTree = clone(m.tree); this.shelf = [...this.tiles.keys()].filter((k) => !treeIds(this.dockTree).includes(k) && !this.tiles.get(k).ephemeral); return {};
      case 'dock.move': { // move tile `tile` into the tile holding `into`, as a tab or a split
        if (!this.dockTree) return {}; this._unplace(m.tile, true); const tgt = (function f(n) { if (n.t === 'tile') return n.views.includes(m.into) ? n : null; for (const k of n.kids) { const r = f(k); if (r) return r; } return null; })(this.dockTree);
        if (!tgt) { this._place(m.tile); return {}; }
        if (m.as === 'tab' || !m.as) { tgt.views.push(m.tile); tgt.active = tgt.views.length - 1; } else this._splitAt(tgt, m.tile, m.as);
        return {};
      }
      case 'probe.set': this.probes.set(m.name, m.rect.slice()); return {};
      case 'probe.remove': this.probes.delete(m.name); return {};
      case 'link.add': { const tiles = m.tiles === '*' ? '*' : [].concat(m.tiles); if (tiles !== '*') for (const t of tiles) this.get(t); this.linkList.push({ tiles, kind: m.kind }); return {}; }
      case 'layout.use': {
        if (m.name === 'default' && !this.layouts.has('default')) return {};
        const l = this.layouts.get(m.name); if (!l) throw diag('E_LAYOUT', `no layout "${m.name}"`, { mean: nearest(m.name, this.layout.list()), list: { layouts: this.layout.list() } });
        if (l.tree) this.dockTree = clone(l.tree); else if (l.fn) l.fn(); this.layoutName = m.name; this.shelf = [...this.tiles.keys()].filter((k) => !treeIds(this.dockTree).includes(k) && !this.tiles.get(k).ephemeral); return {};
      }
      default: throw diag('E_OP', `unknown workspace operation "${m.op}"`);
    }
  }
  _place(id) { // add a tile to the dock beside the others
    if (!this.dockTree) { this.dockTree = { t: 'tile', views: [id], active: 0 }; return; }
    const root = this.dockTree; if (root.t === 'split' && root.dir === 'row') { const n = root.kids.length; root.kids.push({ t: 'tile', views: [id], active: 0 }); root.sizes = root.sizes.map((s) => (s * n) / (n + 1)); root.sizes.push(1 / (n + 1)); }
    else this.dockTree = { t: 'split', dir: 'row', kids: [root, { t: 'tile', views: [id], active: 0 }], sizes: [0.66, 0.34] };
  }
  _splitAt(tgt, id, side) { const dir = side === 'left' || side === 'right' ? 'row' : 'col', first = side === 'left' || side === 'top'; const nt = { t: 'tile', views: [id], active: 0 }, copy = clone(tgt); const par = { t: 'split', dir, kids: first ? [nt, copy] : [copy, nt], sizes: [0.5, 0.5] }; for (const k of Object.keys(tgt)) delete tgt[k]; Object.assign(tgt, par); }
  _unplace(id, keep) {
    const rm = (n) => { if (n.t === 'tile') { const i = n.views.indexOf(id); if (i >= 0) { n.views.splice(i, 1); n.active = Math.min(n.active, Math.max(0, n.views.length - 1)); } return n.views.length === 0 ? null : n; } const ks = [], sz = []; n.kids.forEach((k, i) => { const r = rm(k); if (r) { ks.push(r); sz.push(n.sizes[i]); } }); if (!ks.length) return null; if (ks.length === 1) return ks[0]; const s = sz.reduce((a, b) => a + b, 0); return { t: 'split', dir: n.dir, kids: ks, sizes: sz.map((x) => x / s) }; };
    if (this.dockTree) this.dockTree = rm(this.dockTree); this.shelf = this.shelf.filter((x) => x !== id); if (!keep && this.dockTree === null) this.dockTree = null;
  }
  keep(id) { const t = this.get(id).copy(); t.ephemeral = false; this.tiles.set(id, t); if (this.dockTree && !treeIds(this.dockTree).includes(id)) this._place(id); this.wb._touch(); return this.wb; }
  drop(id) { this.wb.apply({ op: 'tile.remove', id }); return this.wb; }
  attach(name, fn) {
    const w = this, b = new TileBuilder(this, name); b.ephemeral = true; b.by = 'agent';
    fn(V2.guard(b, `tile "${name}"`)); return this.wb;
  }
  /* agent-facing helpers */
  snapshotJson() { return this.snapshot(); }
  /* ----- data for tiles ----- */
  scopeOf(t, extra) { return Object.assign({}, t.scope, extra || {}); }
  netFor(t) { const n = t.pipe ? this.wb.pipes.get(t.pipe) : this.net(); return n; }
  /* an Img for a tile: eval tap in its scope, then match / crop / zoom / lenses */
  renderImg(t, o) {
    o = o || {}; const net = this.netFor(t), wb = this.wb, spec = t.spec, tap = spec.tap || 'out';
    if (!net) throw diag('E_PIPE', 'the workspace has no pipeline', { fix: 'wb.pipe("default").scene("chart")…' });
    if (!net.byTap(tap)) return { missing: tap, placeholder: true };
    let scope = this.scopeOf(t, o.scope); const size = o.w ? { w: o.w } : { max: o.max || 640 };
    if (t.match) scope = this.matchScope(net, scope, t.match, size);
    const ev = net.eval(tap, Object.assign({ scope }, size)); let img = ev.img;
    const ctx = { other: (patch) => net.eval(tap, Object.assign({ scope: Object.assign({}, scope, patch) }, size)).img, tap: (tp) => ev.at(tp), net, tile: t };
    const overlays = [];
    let shown = V2.displayImg(img);
    for (const l of t.lenses) { const r = runLens(wb, l, shown, ctx); if (r.img) shown = r.img; if (r.overlay) overlays.push(r.overlay); }
    if (t.crop) { const rect = typeof t.crop === 'string' ? this.probeRect(t.crop) : t.crop; shown = shown.crop(rect); }
    if (t.zoom) { const rect = t.zoom.at ? this.probeRect(t.zoom.at) : [0.4, 0.4, 0.2, 0.2]; shown = shown.crop(rect).resize(shown.w, shown.h, false); }
    return { img: shown, raw: img, overlays, notes: ev.notes, ms: ev.ms };
  }
  /* hold a metered mid-tone: adjust print exposure until the mid-grey patch lands at a fixed L* */
  matchScope(net, scope, what, size) {
    const sc = scope.scene || (net.stage('scene') || { opts: {} }).opts.scene || 'chart', reg = this.wb.scenes[sc].midgray; if (!reg || what !== 'midgray') return scope;
    const target = 50, meas = (pe) => { const s2 = Object.assign({}, scope, { 'enlarger.print_exposure': pe }); return net.eval('out', { scope: s2, w: 96 }).img.crop(reg).lab().mean()[0]; };
    const base = scope['enlarger.print_exposure'] !== undefined ? scope['enlarger.print_exposure'] : this.wb.params.effective('enlarger.print_exposure');
    let x0 = Math.log2(base), y0 = meas(base), x1 = x0 + (y0 < target ? 0.5 : -0.5), y1 = meas(Math.pow(2, x1));
    for (let i = 0; i < 3 && Math.abs(y1 - target) > 0.4; i++) { const slope = (y1 - y0) / (x1 - x0 || 1); if (!Number.isFinite(slope) || Math.abs(slope) < 1e-3) break; const x2 = clamp(x1 + (target - y1) / slope, -2.5, 2.5); x0 = x1; y0 = y1; x1 = x2; y1 = meas(Math.pow(2, x1)); }
    return Object.assign({}, scope, { 'enlarger.print_exposure': clamp(Math.pow(2, x1), 0.25, 4) });
  }
  mosaicGrid(t) {
    const s = t.spec, cols = s.cols.values, rows = s.rows.values, cells = [];
    for (let r = 0; r < rows.length; r++) for (let c = 0; c < cols.length; c++) {
      const scope = Object.assign({}, t.scope); s.cols.apply(scope, cols[c]); s.rows.apply(scope, rows[r]);
      const cb = new CellBuilder(scope); const spec = s.cell ? s.cell(cb) : cb; cells.push({ col: c, row: r, colValue: cols[c], rowValue: rows[r], scope, spec: spec && spec.cell ? spec : cb });
    }
    return { cols, rows, cells, colAxis: s.cols, rowAxis: s.rows };
  }
  mosaicPlan(t) {
    const net = this.netFor(t), g = this.mosaicGrid(t), per = {}; const uniq = {}; for (const k of ['film.expose', 'film.develop', 'enlarger', 'paper', 'scan']) uniq[k] = new Set();
    for (const c of g.cells) { const ctx = net.ctxFor({ w: t.spec.size || 150, scope: c.scope }); for (const st of net.stages) if (uniq[st.kind]) uniq[st.kind].add(net.keyOf(st, ctx)); }
    const parts = Object.keys(uniq).map((k) => `${k} ×${uniq[k].size}`);
    return new Report([`cells ${g.cells.length}   ${parts.join('   ')}`, 'a column shares its paper, a row shares its negative'], { cells: g.cells.length, per: Object.fromEntries(Object.keys(uniq).map((k) => [k, uniq[k].size])) });
  }
  cellImg(t, cell, o) {
    o = o || {}; const net = this.netFor(t), size = (o.draft ? 0.5 : 1) * (t.spec.size || 150), sp = cell.spec; let scope = cell.scope;
    if (sp.matchWhat) scope = this.matchScope(net, scope, sp.matchWhat, { w: size });
    const ev = net.eval(sp.tap || 'out', { scope, w: Math.round(size) }); let shown = V2.displayImg(ev.img); const overlays = [];
    const lenses = (sp.lenses || []).concat(t.lenses);
    const ctx = { other: (patch) => net.eval(sp.tap || 'out', { scope: Object.assign({}, scope, patch), w: Math.round(size) }).img, tap: (tp) => ev.at(tp), net, tile: t };
    for (const l of lenses) { const r = runLens(this.wb, l, shown, ctx); if (r.img) shown = r.img; if (r.overlay) overlays.push(r.overlay); }
    return { img: shown, overlays };
  }
  /* numbers behind a plot tile */
  curvesData(t) {
    const net = this.netFor(t), s = t.spec, of = s.of || 'paper'; const out = { of, series: [] };
    const planFor = (patch) => { const ctx = net.ctxFor({ w: 64, scope: patch || {} }); return { plan: net.plan(ctx), P: ctx.P }; };
    if (s.over) { const ax = s.over; for (const v of ax.values) { const sc = {}; ax.apply(sc, v); const { plan } = planFor(sc); out.series.push({ label: String(v), curves: FB.curvesFor(plan), plan }); } }
    else { const { plan, P } = planFor(t.scope); out.series.push({ label: 'current', curves: FB.curvesFor(plan), plan, P }); }
    out.le = out.series[0].curves.le; return out;
  }
  histData(t) {
    const s = t.spec, net = this.netFor(t), img = net.eval(s.tap, { scope: this.scopeOf(t), max: 320 }).img, bins = s.bins || 64, d = img.data, n = img.w * img.h;
    let lo = s.range ? s.range[0] : Infinity, hi = s.range ? s.range[1] : -Infinity;
    const chan = s.channel === 'L*' ? 'L*' : s.channels || 'rgb';
    let data = d, nc = 3; if (chan === 'L*') { data = img.lab().data; nc = 1; }
    if (!s.range) { for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) { const v = data[i * 3 + c]; if (v < lo) lo = v; if (v > hi) hi = v; } if (img.meta.space === 'srgb' && chan !== 'L*') { lo = 0; hi = 1; } if (chan === 'L*') { lo = 0; hi = 100; } }
    if (!(hi > lo)) hi = lo + 1;
    const H = Array.from({ length: nc }, () => new Float32Array(bins));
    for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) { const v = data[i * 3 + c], b = Math.min(bins - 1, Math.max(0, ((v - lo) / (hi - lo)) * bins | 0)); H[c][b]++; }
    return { lo, hi, bins, series: H, channel: chan, space: img.meta.space };
  }
  paradeImg(t) {
    const s = t.spec, net = this.netFor(t), img = V2.displayImg(net.eval(s.tap, { scope: this.scopeOf(t), max: 256 }).img), W = 300, Hh = 160, pw = W / 3;
    let src = img; if (t.crop) src = img.crop(typeof t.crop === 'string' ? this.probeRect(t.crop) : t.crop);
    const acc = new Float32Array(W * Hh * 3); const cx = (x) => Math.min(pw - 1, (x / src.w) * pw | 0);
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) for (let c = 0; c < 3; c++) { const v = clamp(src.data[(y * src.w + x) * 3 + c], 0, 1), yy = Hh - 1 - Math.min(Hh - 1, (v * (Hh - 1)) | 0), xx = c * pw + cx(x); acc[(yy * W + xx) * 3 + c] += 1; }
    const out = new Float32Array(W * Hh * 3); let mx = 1; for (let i = 0; i < acc.length; i++) if (acc[i] > mx) mx = acc[i];
    for (let i = 0; i < W * Hh; i++) for (let c = 0; c < 3; c++) { const a = Math.min(1, Math.sqrt(acc[i * 3 + c] / mx) * 1.6); out[i * 3 + c] = 0.08 + (c === 0 ? 0.9 : 0.2) * a * (c === 0 ? 1 : 0.4); }
    // plain ink-on-ground parade: density of each channel's values, drawn dark on a light ground
    for (let i = 0; i < W * Hh; i++) { const a = Math.min(1, Math.sqrt(Math.max(acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2]) / mx) * 1.4); out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = 1 - a * 0.9; }
    return new Img(W, Hh, out, { space: 'srgb' });
  }
  lineData(t) {
    const s = t.spec, net = this.netFor(t), ax = s.x, pts = [];
    for (const v of ax.values) { const sc = Object.assign({}, t.scope); ax.apply(sc, v); const taps = V2.tapProxy(net, { scope: sc, w: s.size || 96 }); pts.push([v, s.y(taps)]); }
    return { pts, axis: ax.path };
  }
  tableData(t) {
    const s = t.spec, net = this.netFor(t), taps = V2.tapProxy(net, { scope: this.scopeOf(t), w: 192 }), rows = s.rows, cols = Object.keys(s.cols), out = [];
    for (const r of rows) { const pr = this.probeRect(r); out.push({ row: r, vals: cols.map((c) => { try { return s.cols[c](taps, pr); } catch (e) { return NaN; } }) }); }
    return { cols, rows: out };
  }
}
V2.Workspace = Workspace;

/* ---------- mosaic cell builder ---------- */
class CellBuilder {
  constructor(scope) { this.scope = scope; this.cell = true; this.tap = 'out'; this.lenses = []; this.matchWhat = null; }
  render(tap) { this.tap = tap; return this; }
  match(w) { this.matchWhat = w; return this; }
  lens(l) { this.lenses.push(typeof l === 'string' ? V2.lensByName(l) : l); return this; }
}

/* ---------- the tile builder: ws.tile("id").render("out")… ---------- */
const srcOf = (f) => (typeof f === 'function' ? f.toString() : JSON.stringify(f));
class TileBuilder {
  constructor(ws, id) { this.ws = ws; this.id = id; this.ephemeral = false; this.by = 'script'; }
  _make(kind, spec, code) {
    V2.phaseCheck('ws.tile');
    const ws = this.ws, t = new TileRec(this.id, kind, spec); t.ephemeral = this.ephemeral; t.by = this.by; t.code = `ws.tile(${JSON.stringify(this.id)})${code}`;
    ws.wb.apply({ op: 'tile.add', rec: t, id: this.id, kind }, this.by === 'agent' ? 'agent' : undefined); return this;
  }
  _rec() { return this.ws.get(this.id); }
  _patch(patch, codeAdd) { V2.phaseCheck('ws.tile'); const t = this._rec(); const p = Object.assign({}, patch); p.code = t.code + codeAdd; this.ws.wb.apply({ op: 'tile.patch', id: this.id, patch: p }, this.by === 'agent' ? 'agent' : undefined); return this; }
  render(tap) {
    const net = this.ws.net(); if (net) net.checkTap(tap);
    return this._make('render', { tap: tap || 'out' }, `.render(${JSON.stringify(tap || 'out')})`);
  }
  hist(tap, o) { const net = this.ws.net(); if (net) net.checkTap(tap); return this._make('hist', Object.assign({ tap }, o || {}), `.hist(${JSON.stringify(tap)}${o ? ', ' + JSON.stringify(o) : ''})`); }
  text(str) { return this._make('text', { text: str }, `.text(${JSON.stringify(str)})`); }
  controls(scheme) { return this._make('controls', { scheme }, `.controls(${JSON.stringify(scheme)})`); }
  table(o) { for (const r of o.rows || []) this.ws.probeRect(r); return this._make('table', o, `.table({ rows: ${JSON.stringify(o.rows)}, cols: {${Object.keys(o.cols).map((k) => ` ${JSON.stringify(k)}: ${srcOf(o.cols[k])}`).join(',')} } })`); }
  mosaic(o) {
    if (!o || !o.cols || !o.rows) throw diag('E_ARG', 'mosaic needs { cols, rows, cell }', { fix: 'cols and rows are wb.axis(path, values)' });
    for (const k of ['cols', 'rows']) if (!(o[k] instanceof V2.Axis)) throw diag('E_ARG', `mosaic ${k} must be an axis made with wb.axis(path, values)`);
    const spec = { cols: o.cols, rows: o.rows, cell: o.cell, size: o.size || 150 };
    return this._make('mosaic', spec, `.mosaic({ cols: ${o.cols.code()}, rows: ${o.rows.code()}, cell: ${o.cell ? srcOf(o.cell) : '(c) => c.render("out")'}, size: ${spec.size} })`);
  }
  get plot() {
    const self = this;
    return {
      curves: (of) => { const o = typeof of === 'string' || of === undefined ? { of: of || 'paper' } : of; return self._make('curves', { of: o.of || 'paper', over: o.over }, `.plot.curves(${typeof of === 'string' ? JSON.stringify(of) : '{ of: ' + JSON.stringify(o.of) + (o.over ? ', over: ' + o.over.code() : '') + ' }'})`); },
      line: (o) => { if (!(o.x instanceof V2.Axis)) throw diag('E_ARG', 'plot.line needs x: wb.axis(path, values)'); return self._make('line', { x: o.x, y: o.y, taps: o.taps || ['out'], size: o.size }, `.plot.line({ x: ${o.x.code()}, y: ${srcOf(o.y)}, taps: ${JSON.stringify(o.taps || ['out'])} })`); },
    };
  }
  get scope() {
    const self = this; const f = (s) => { if (s === undefined) return clone(self._rec().scope); self.ws.wb.apply({ op: 'scope.set', tile: self.id, scope: s }, self.by === 'agent' ? 'agent' : undefined); return self; };
    f.parade = (tap) => { const net = self.ws.net(); if (net) net.checkTap(tap); return self._make('parade', { tap }, `.scope.parade(${JSON.stringify(tap)})`); };
    return f;
  }
  lens(l) {
    V2.phaseCheck('ws.tile');
    if (typeof l === 'string') { const t = this._rec(); const ex = t.lenses.find((x) => x.name === l); if (ex) return V2.lensHandle(this, ex); l = V2.lensByName(l, this.ws.wb); }
    this.ws.wb.registerLens(l);
    this.ws.wb.apply({ op: 'lens.add', tile: this.id, lens: l }, this.by === 'agent' ? 'agent' : undefined);
    this.ws.wb.apply({ op: 'tile.patch', id: this.id, patch: { code: this._rec().code + `.lens(${l.code || (l.builtin ? 'lens.' + l.name + '()' : JSON.stringify(l.name))})` } }, this.by === 'agent' ? 'agent' : undefined);
    return V2.lensHandle(this, l);
  }
  crop(probe) { return this._patch({ crop: typeof probe === 'string' ? (this.ws.probeRect(probe), probe) : probe }, `.crop(${JSON.stringify(probe)})`); }
  zoom(k, o) { if (o && o.at) this.ws.probeRect(o.at); return this._patch({ zoom: { k, at: o && o.at } }, `.zoom(${k}${o ? ', ' + JSON.stringify(o) : ''})`); }
  match(what) { return this._patch({ match: what }, `.match(${JSON.stringify(what)})`); }
  pipe(net) { return this._patch({ pipe: raw(net).name }, ''); }
  on(ev, fn) { const t = this._rec(); (t.handlers[ev] = t.handlers[ev] || []).push(fn); return this; }
  plan() { return this.ws.mosaicPlan(this._rec()); }
  remove() { this.ws.wb.apply({ op: 'tile.remove', id: this.id }, this.by === 'agent' ? 'agent' : undefined); return this.ws.wb; }
  describe() { return this._rec().summary(); }
}
V2.lensHandle = (tb, l) => ({ off: () => { tb.ws.wb.apply({ op: 'lens.off', tile: tb.id, name: l.name, off: true }); return tb; }, on: () => { tb.ws.wb.apply({ op: 'lens.off', tile: tb.id, name: l.name, off: false }); return tb; }, remove: () => { tb.ws.wb.apply({ op: 'lens.remove', tile: tb.id, name: l.name }); return tb; }, lens: (x) => tb.lens(x), scope: tb.scope, name: l.name, tile: tb });
V2.lensByName = function (name, wb) {
  wb = wb || V2.lastBench; const l = wb && wb.lensDefs.get(name); if (l) return l;
  const names = wb ? [...wb.lensDefs.keys()].concat(['clip', 'zones', 'diff', 'split', 'falseDensity']) : [];
  if (lens[name] && ['clip', 'zones'].includes(name)) return lens[name]();
  throw diag('E_LENS', `no lens "${name}"`, { mean: nearest(name, names), list: { lenses: names } });
};
V2.phaseCheck = function (what) { const ph = V2.phase.cur(); if (ph === 'eval' || ph === 'build') throw diag('E_PHASE', `${what} is not available inside ${ph === 'eval' ? 'an eval λ (it runs per pixel)' : 'a build λ'}`, { fix: 'move it to a run λ, or create the tile outside' }); };
V2.Axis.prototype.code = function () { return `wb.axis(${JSON.stringify(this.path)}, ${JSON.stringify(this.values)})`; };
/* a numeric axis may be given as [from, to, step] */
const origAxis = V2.Bench.prototype.axis;
V2.Bench.prototype.axis = function (path, values) {
  if (Array.isArray(values) && values.length === 3 && values.every((x) => typeof x === 'number') && values[0] < values[1] && values[2] > 0 && values[2] <= (values[1] - values[0]) / 2 + 1e-9) {
    const [a, b, s] = values, n = Math.round((b - a) / s); values = Array.from({ length: n + 1 }, (_, i) => Math.round((a + i * s) * 1e6) / 1e6);
  }
  const ax = origAxis.call(this, path, values);
  ax.apply = path.startsWith('macro.') ? function (scope, v) { scope[this.path] = v; return scope; } : ax.apply; return ax;
};
V2.Bench.prototype.registerLens = function (l) {
  if (!l.builtin) { for (const k of Object.keys(l.params)) { const s = l.params[k]; if (!this.table.has(s.path)) this.params.declare(Object.assign({ group: 'lens ' + l.name }, s)); } this.lensDefs.set(l.name, l); }
};
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* Filmbench IDE — part 0: helpers, events, markdown, virtual file system, module loader, syntax scan, highlighter. */
(function () {
'use strict';
const IDE = (window.IDE = { views: {}, state: { theme: 'light' }, caps: { sample: null, downloads: null, limits: null } });
const V2 = window.V2;

/* ---------- small helpers ---------- */
function el(tag, props) {
  const e = document.createElement(tag);
  if (props) for (const k of Object.keys(props)) {
    const v = props[k];
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(e.dataset, v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (let i = 2; i < arguments.length; i++) { const c = arguments[i]; if (c === null || c === undefined || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return e;
}
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clone = (o) => JSON.parse(JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
const idle = () => new Promise((r) => setTimeout(r, 0));
Object.assign(IDE, { el, $, $$, clamp, clone, sleep, esc, raf, idle });
const store = {
  get(k, d) { try { const v = localStorage.getItem('fb2.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('fb2.' + k, JSON.stringify(v)); } catch (e) { /* storage may be unavailable */ } },
  del(k) { try { localStorage.removeItem('fb2.' + k); } catch (e) { /* ignore */ } },
};
IDE.store = store;

/* ---------- events ---------- */
const handlers = {};
IDE.on = (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); return () => { handlers[ev] = handlers[ev].filter((x) => x !== fn); }; };
IDE.emit = (ev, a) => { for (const fn of (handlers[ev] || []).slice()) { try { fn(a); } catch (e) { console.error(e); } } };

/* ---------- toasts ---------- */
IDE.toast = function (msg, bad, act) {
  let box = $('.toasts'); if (!box) { box = el('div', { class: 'toasts' }); document.body.append(box); }
  const t = el('div', { class: 'toast' + (bad ? ' bad' : ''), text: msg }); box.append(t);
  if (act) t.append(el('button', { class: 'act', text: act.label, onclick: () => { t.remove(); act.run(); } }));
  setTimeout(() => t.remove(), act ? 7000 : bad ? 5200 : 2600);
};

/* ---------- dialogs (window.prompt/confirm are blocked in embedded frames) ---------- */
IDE.ask = function (o) {
  return new Promise((resolve) => {
    const prev = document.activeElement, fields = o.fields || [], inputs = {};
    const form = el('form', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title || 'Dialog' }, el('h3', { text: o.title || '' }), o.note ? el('p', { class: 'note', text: o.note }) : null);
    for (const f of fields) { const inp = el('input', { type: 'text', value: f.value || '', placeholder: f.placeholder || '', 'aria-label': f.label, spellcheck: 'false' }); inputs[f.key] = inp; form.append(el('label', { class: 'mrow' }, el('span', { text: f.label }), inp)); }
    const scrim = el('div', { class: 'scrim' }, form);
    const done = (v) => { document.removeEventListener('keydown', key, true); scrim.remove(); if (prev && prev.focus) try { prev.focus(); } catch (e) { /* gone */ } resolve(v); };
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } };
    form.append(el('div', { class: 'mact' }, el('button', { type: 'button', class: 'btn', text: o.cancel || 'Cancel', onclick: () => done(null) }), el('button', { type: 'submit', class: 'btn ' + (o.danger ? 'danger' : 'primary'), text: o.ok || 'OK' })));
    form.addEventListener('submit', (e) => { e.preventDefault(); const out = {}; for (const f of fields) out[f.key] = inputs[f.key].value.trim(); if (fields.length && fields[0].required !== false && !out[fields[0].key]) { inputs[fields[0].key].focus(); return; } done(fields.length ? out : true); });
    scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) done(null); });
    document.addEventListener('keydown', key, true); document.body.append(scrim);
    const first = fields.length ? inputs[fields[0].key] : form.querySelector('[type=submit]'); setTimeout(() => { first.focus(); if (first.select) first.select(); }, 0);
  });
};
IDE.confirm = (title, o) => IDE.ask(Object.assign({ title, ok: 'Delete', danger: true }, o || {})).then((r) => !!r);

/* ---------- markdown (small) ---------- */
function mdInline(s) {
  const stash = [];
  s = s.replace(/`([^`]+)`/g, (m, c) => { stash.push('<code>' + esc(c) + '</code>'); return '\u0000' + (stash.length - 1) + '\u0000'; });
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => {
    u = u.replace(/&quot;/g, '%22');
    if (u.startsWith('ide:')) return '<a class="lablink" href="#" data-ide="' + u + '">' + t + '</a>';
    if (/^https?:\/\//.test(u)) return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + t + '</a>';
    return t;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => stash[+i]);
}
IDE.md = function (src, o) {
  o = o || {}; const L = String(src).replace(/\r/g, '').split('\n'), out = []; let i = 0;
  const startsBlock = (ln) => /^```/.test(ln) || /^#{1,4}\s/.test(ln) || /^\s*([-*]|\d+\.)\s+/.test(ln) || /^---+$/.test(ln) || (ln.includes('|') && /^\s*\|/.test(ln));
  while (i < L.length) {
    const ln = L[i]; let m;
    if (!ln.trim()) { i++; continue; }
    if (/^```/.test(ln)) { const buf = []; const lang = ln.slice(3).trim(); i++; while (i < L.length && !/^```/.test(L[i])) buf.push(L[i++]); i++; out.push('<pre class="src"' + (lang ? ' data-lang="' + esc(lang) + '"' : '') + '>' + (o.doc && (lang === 'js' || lang === 'javascript') ? IDE.highlight(buf.join('\n')) : esc(buf.join('\n'))) + '</pre>'); continue; }
    if ((m = /^(#{1,4})\s+(.*)$/.exec(ln))) { out.push(o.doc ? `<h${m[1].length}>${mdInline(m[2])}</h${m[1].length}>` : `<div class="mh">${mdInline(m[2])}</div>`); i++; continue; }
    if (/^---+$/.test(ln)) { out.push('<hr>'); i++; continue; }
    if (ln.includes('|') && i + 1 < L.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(L[i + 1])) {
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const hd = cells(ln); i += 2; const rows = [];
      while (i < L.length && L[i].includes('|') && L[i].trim()) rows.push(cells(L[i++]));
      out.push(`<table class="rt${o.doc ? ' doc-t' : ''}"><thead><tr>${hd.map((c) => '<th>' + mdInline(c) + '</th>').join('')}</tr></thead><tbody>${rows.map((r) => '<tr>' + r.map((c) => '<td>' + mdInline(c) + '</td>').join('') + '</tr>').join('')}</tbody></table>`); continue;
    }
    if ((m = /^\s*([-*]|\d+\.)\s+/.exec(ln))) {
      const ol = /\d/.test(m[1]), items = [];
      while (i < L.length && (m = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(L[i]))) { items.push(m[2]); i++; }
      out.push(`<${ol ? 'ol' : 'ul'}>${items.map((t) => '<li>' + mdInline(t) + '</li>').join('')}</${ol ? 'ol' : 'ul'}>`); continue;
    }
    const buf = [ln]; i++;
    while (i < L.length && L[i].trim() && !startsBlock(L[i])) buf.push(L[i++]);
    out.push('<p>' + mdInline(buf.join(' ')) + '</p>');
  }
  return out.join('');
};
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[data-ide]');
  if (a) { e.preventDefault(); try { IDE.link(a.dataset.ide); } catch (err) { IDE.toast(String(err.message || err), true); } }
});

/* ---------- syntax highlighting ---------- */
const KW = new Set('const let var function return if else for while do break continue new typeof instanceof in of async await import export from default class extends throw try catch finally switch case yield delete void this null true false undefined'.split(' '));
const DSL = new Set('wb ws ctl rig bench fragment lens op p units pipe film paper enlarger scene scan tile render hist mosaic dock layout probe macro slider preset axis stage'.split(' '));
IDE.highlight = function (src) {
  const out = []; let i = 0; const n = src.length;
  const push = (cls, t) => { if (cls && t.indexOf('\n') >= 0) out.push(t.split('\n').map((x) => (x ? '<span class="' + cls + '">' + esc(x) + '</span>' : '')).join('\n')); else out.push(cls ? '<span class="' + cls + '">' + esc(t) + '</span>' : esc(t)); };
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (c === '/' && c2 === '/') { let j = src.indexOf('\n', i); if (j < 0) j = n; push('tk-c', src.slice(i, j)); i = j; continue; }
    if (c === '/' && c2 === '*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; push('tk-c', src.slice(i, j)); i = j; continue; }
    if (c === '"' || c === "'") { let j = i + 1; while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; } j = Math.min(n, j + 1); push('tk-s', src.slice(i, j)); i = j; continue; }
    if (c === '`') { let j = i + 1, depth = 0; while (j < n) { if (src[j] === '\\') { j += 2; continue; } if (src[j] === '$' && src[j + 1] === '{') { depth++; j += 2; continue; } if (src[j] === '}' && depth) { depth--; j++; continue; } if (src[j] === '`' && !depth) { j++; break; } j++; } j = Math.min(n, j); push('tk-s', src.slice(i, j)); i = j; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(c2 || ''))) { let j = i + 1; while (j < n && /[0-9a-fA-Fxe._]/.test(src[j])) j++; push('tk-n', src.slice(i, j)); i = j; continue; }
    if (/[A-Za-z_$]/.test(c)) { let j = i + 1; while (j < n && /[\w$]/.test(src[j])) j++; const w = src.slice(i, j); push(KW.has(w) ? 'tk-k' : DSL.has(w) && src[i - 1] !== '.' ? 'tk-e' : '', w); i = j; continue; }
    if (/[{}()[\];,.:<>=+\-*/%&|!?^~]/.test(c)) { let j = i + 1; while (j < n && /[{}()[\];,.:<>=+\-*/%&|!?^~]/.test(src[j]) && !(src[j] === '/' && (src[j + 1] === '/' || src[j + 1] === '*'))) j++; push('tk-p', src.slice(i, j)); i = j; continue; }
    push('', c); i++;
  }
  return out.join('');
};

/* ---------- virtual file system ---------- */
const FS_KEY = 'vfs.v1';
class VFS {
  constructor() { this.builtin = new Map(); this.user = new Map(); this.deleted = new Set(); this.listeners = []; const saved = store.get(FS_KEY, null); if (saved) { for (const [k, v] of Object.entries(saved.files || {})) this.user.set(k, v); for (const k of saved.deleted || []) this.deleted.add(k); } }
  define(files) { for (const [k, v] of Object.entries(files)) this.builtin.set(k, v); }
  on(fn) { this.listeners.push(fn); }
  _save() { store.set(FS_KEY, { files: Object.fromEntries(this.user), deleted: [...this.deleted] }); for (const fn of this.listeners) fn(); }
  list() { const s = new Set([...this.builtin.keys(), ...this.user.keys()]); for (const d of this.deleted) s.delete(d); return [...s].sort((a, b) => cmpPath(a, b)); }
  exists(p) { return !this.deleted.has(p) && (this.user.has(p) || this.builtin.has(p)); }
  read(p) { if (this.deleted.has(p)) return null; if (this.user.has(p)) return this.user.get(p); return this.builtin.has(p) ? this.builtin.get(p) : null; }
  write(p, text) { this.deleted.delete(p); if (this.builtin.get(p) === text) this.user.delete(p); else this.user.set(p, text); this._save(); }
  isBuiltin(p) { return this.builtin.has(p); }
  modified(p) { return this.user.has(p) && this.builtin.has(p); }
  isNew(p) { return this.user.has(p) && !this.builtin.has(p); }
  revert(p) { if (this.builtin.has(p)) { this.user.delete(p); this.deleted.delete(p); this._save(); } }
  remove(p) { this.user.delete(p); if (this.builtin.has(p)) this.deleted.add(p); this._save(); }
  rename(a, b) { if (!this.exists(a) || this.exists(b)) return false; const t = this.read(a); this.remove(a); this.write(b, t); return true; }
  resolve(from, rel) {
    if (!rel.startsWith('.')) return rel;
    const base = from.split('/').slice(0, -1), parts = rel.split('/'); for (const q of parts) { if (q === '.' || q === '') continue; if (q === '..') base.pop(); else base.push(q); } let p = base.join('/');
    if (!this.exists(p) && this.exists(p + '.js')) p += '.js'; return p;
  }
  reset() { this.user.clear(); this.deleted.clear(); this._save(); }
}
function cmpPath(a, b) { const da = a.includes('/'), db = b.includes('/'); if (da !== db) return da ? 1 : -1; return a < b ? -1 : a > b ? 1 : 0; }
IDE.vfs = new VFS();

/* ---------- module rewrite: import/export → require/exports (line count preserved) ---------- */
const nl = (s) => (s.match(/\n/g) || []).length;
IDE.rewrite = function (src) {
  const exp = [];
  let out = src;
  out = out.replace(/^[ \t]*import\s+([\s\S]*?)\s+from\s+(['"])([^'"\n]+)\2\s*;?/gm, (m, what, q, mod) => {
    what = what.trim(); const pad = '\n'.repeat(nl(m)); let r;
    const rq = `__require(${JSON.stringify(mod)})`;
    if (what.startsWith('*')) r = `const ${what.replace(/^\*\s*as\s+/, '')} = ${rq};`;
    else if (what.startsWith('{')) r = `const ${what.replace(/\s+as\s+/g, ': ')} = ${rq};`;
    else { const mm = /^([\w$]+)\s*,\s*(\{[\s\S]*\})$/.exec(what); if (mm) r = `const __m${mod.length} = ${rq}; const ${mm[1]} = __m${mod.length}.default; const ${mm[2].replace(/\s+as\s+/g, ': ')} = __m${mod.length};`; else r = `const ${what} = ${rq}.default;`; }
    return r + pad;
  });
  out = out.replace(/^[ \t]*import\s+(['"])([^'"\n]+)\1\s*;?/gm, (m, q, mod) => `__require(${JSON.stringify(mod)});` + '\n'.repeat(nl(m)));
  out = out.replace(/^[ \t]*export\s+default\s+/gm, () => 'exports.default = ');
  out = out.replace(/^[ \t]*export\s+(const|let|var)\s+([\w$]+)/gm, (m, k, name) => { exp.push(name); return `${k} ${name}`; });
  out = out.replace(/^[ \t]*export\s+(const|let|var)\s*(\{[^}]*\}|\[[^\]]*\])/gm, (m, k, pat) => { for (const n of pat.replace(/[{}[\]]/g, '').split(',')) { const nm = n.split(':').pop().split('=')[0].trim(); if (nm) exp.push(nm); } return `${k} ${pat}`; });
  out = out.replace(/^[ \t]*export\s+(async\s+function\*?|function\*?|class)\s+([\w$]+)/gm, (m, k, name) => { exp.push(name); return `${k} ${name}`; });
  out = out.replace(/^[ \t]*export\s*\{([^}]*)\}\s*(;?)/gm, (m, list) => { for (const it of list.split(',')) { const [a, b] = it.split(/\s+as\s+/).map((x) => x.trim()); if (a) exp.push(b ? [a, b] : a); } return '\n'.repeat(nl(m)); });
  const epi = exp.map((e) => (Array.isArray(e) ? `exports[${JSON.stringify(e[1])}] = ${e[0]};` : `exports[${JSON.stringify(e)}] = ${e};`)).join(' ');
  return { code: out, epilogue: epi };
};
/* top-level names declared in a snippet (column 0), so a REPL line can keep them in the session */
IDE.topNames = function (src) {
  const names = new Set();
  for (const m of src.matchAll(/^(?:const|let|var)\s+([\w$]+)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^(?:const|let|var)\s*\{([^}]*)\}/gm)) for (const n of m[1].split(',')) { const nm = n.split(':').pop().split('=')[0].trim(); if (nm) names.add(nm); }
  for (const m of src.matchAll(/^(?:const|let|var)\s*\[([^\]]*)\]/gm)) for (const n of m[1].split(',')) { const nm = n.split('=')[0].trim(); if (nm && /^[\w$]+$/.test(nm)) names.add(nm); }
  for (const m of src.matchAll(/^(?:async\s+)?function\*?\s+([\w$]+)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^class\s+([\w$]+)/gm)) names.add(m[1]);
  return [...names];
};

/* ---------- syntax scan: brackets and strings, then the first chunk that does not compile ---------- */
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
IDE.AsyncFunction = AsyncFunction;
function scanBrackets(src) {
  const st = []; let line = 1, col = 0, i = 0; const n = src.length; const pairs = { ')': '(', ']': '[', '}': '{' };
  const lineAt = []; // depth at start of each line
  let depthAtLine = [0];
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; col = 0; depthAtLine[line - 1] = st.length; i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); const end = j < 0 ? n : j + 2; for (let k = i; k < end; k++) if (src[k] === '\n') { line++; depthAtLine[line - 1] = st.length; } i = end; continue; }
    if (c === '"' || c === "'") { const q = c; i++; while (i < n && src[i] !== q && src[i] !== '\n') { if (src[i] === '\\') i++; i++; } if (src[i] === '\n') return { line, msg: 'unterminated string' }; i++; continue; }
    if (c === '`') { const startLine = line; i++; let depth = 0; while (i < n) { if (src[i] === '\n') { line++; depthAtLine[line - 1] = st.length; } if (src[i] === '\\') { i += 2; continue; } if (src[i] === '$' && src[i + 1] === '{') { depth++; i += 2; continue; } if (src[i] === '}' && depth) { depth--; i++; continue; } if (src[i] === '`' && !depth) break; i++; } if (i >= n) return { line: startLine, msg: 'unterminated template string' }; i++; continue; }
    if (c === '(' || c === '[' || c === '{') st.push({ c, line }); else if (c === ')' || c === ']' || c === '}') { const top = st.pop(); if (!top) return { line, msg: `unexpected "${c}"` }; if (top.c !== pairs[c]) return { line, msg: `"${c}" does not match "${top.c}" opened on line ${top.line}` }; }
    i++; col++;
  }
  if (st.length) { const top = st[st.length - 1]; return { line: top.line, msg: `"${top.c}" opened here is never closed` }; }
  return { depth: depthAtLine };
}
IDE.syntaxCheck = function (src) {
  const { code } = IDE.rewrite(src);
  try { new AsyncFunction('__require', 'exports', 'module', code); return null; } catch (e) {
    const sb = scanBrackets(src); if (sb.msg) return { line: sb.line, msg: sb.msg };
    // find the first chunk (ending where bracket depth is back to zero) that fails
    const lines = code.split('\n'), depth = sb.depth || []; let start = 0, prev = 0;
    for (let l = 0; l < lines.length; l++) {
      const atEnd = l === lines.length - 1 || (depth[l + 1] === 0 && lines[l].trim() && !/[,(\[{=+\-*/&|?:]\s*$/.test(lines[l].trim()));
      if (!atEnd) continue;
      const head = lines.slice(0, l + 1).join('\n');
      try { new AsyncFunction('__require', 'exports', 'module', head); prev = l + 1; } catch (e2) { return { line: Math.max(prev, start) + 1, msg: String(e2.message).replace(/^SyntaxError:\s*/, '') + (l > prev ? ` (somewhere in lines ${prev + 1}–${l + 1})` : '') }; }
    }
    return { line: 1, msg: String(e.message).replace(/^SyntaxError:\s*/, '') };
  }
};
IDE.errLine = function (e, file) {
  const st = (e && e.stack) || ''; const rx = new RegExp('fbfs/' + file.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + ':(\\d+):(\\d+)'); const m = rx.exec(st); if (!m) return null;
  return { line: Math.max(1, parseInt(m[1], 10) - 2), col: parseInt(m[2], 10) };
};
})();

/* Filmbench IDE — part 1: the session (bench + scope), module loader, runner, console model and value formatting. */
(function () {
'use strict';
const { el, $, esc, clamp, vfs, store } = IDE;
const V2 = window.V2, raw = V2.raw, AsyncFunction = IDE.AsyncFunction;

/* ---------- pictures → canvas ---------- */
IDE.drawImg = function (canvas, img, o) {
  o = o || {}; const w = img.w, h = img.h; canvas.width = w; canvas.height = h; const x = canvas.getContext('2d'), id = x.createImageData(w, h), d = img.data, lin = img.meta && img.meta.space === 'linear', ch = o.channels || 3;
  const enc = CV.enc;
  for (let i = 0, n = w * h; i < n; i++) {
    for (let k = 0; k < 3; k++) { let v = d[i * 3 + k]; if (lin) v = enc(v); id.data[i * 4 + k] = v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0; }
    id.data[i * 4 + 3] = 255;
  }
  x.putImageData(id, 0, 0); return canvas;
};
IDE.imgCanvas = function (img, maxEdge) {
  const c = document.createElement('canvas'); let im = img;
  if (maxEdge && Math.max(img.w, img.h) > maxEdge) { const k = maxEdge / Math.max(img.w, img.h); im = img.resize(Math.max(1, Math.round(img.w * k)), Math.max(1, Math.round(img.h * k)), true); }
  return IDE.drawImg(c, V2.displayImg ? V2.displayImg(im) : im);
};
const isImg = (x) => x && typeof x === 'object' && x.data && x.w > 0 && x.h > 0 && typeof x.crop === 'function';

/* ---------- console model ---------- */
const con = (IDE.con = { lines: [], max: 500, seq: 0, hist: store.get('hist', []) });
function addLine(kind, nodes, meta) {
  const ln = Object.assign({ id: ++con.seq, kind, nodes, t: Date.now() }, meta || {});
  con.lines.push(ln); if (con.lines.length > con.max) con.lines.splice(0, con.lines.length - con.max);
  IDE.emit('console', ln); return ln;
}
IDE.print = (kind, ...vals) => addLine(kind, vals.map((v) => fmt(v)));
IDE.clearConsole = () => { con.lines.length = 0; IDE.emit('console', null); };
V2.onWarn = (w) => addLine('warn', [fmt(w.text)]);

/* ---------- formatting values ---------- */
function inspect(x, depth, seen) {
  depth = depth === undefined ? 2 : depth; seen = seen || new Set();
  if (x === null) return 'null'; if (x === undefined) return 'undefined';
  const t = typeof x; if (t === 'string') return depth < 2 ? JSON.stringify(x) : x; if (t === 'number') return Number.isInteger(x) ? String(x) : String(+x.toPrecision(5)); if (t === 'boolean') return String(x);
  if (t === 'function') return 'ƒ ' + (x.name || '(anonymous)'); if (t === 'symbol') return String(x); if (t === 'bigint') return x + 'n';
  if (seen.has(x)) return '[circular]'; seen.add(x);
  try {
    if (x instanceof Error) return x.message;
    if (ArrayBuffer.isView(x)) return `${x.constructor.name}(${x.length})`;
    if (Array.isArray(x)) { if (depth < 0) return `[${x.length}]`; const items = x.slice(0, 24).map((v) => inspect(v, depth - 1, seen)); const s = '[' + items.join(', ') + (x.length > 24 ? ', … ' + (x.length - 24) + ' more' : '') + ']'; return s; }
    if (x instanceof Map) return `Map(${x.size}) {` + [...x.entries()].slice(0, 8).map(([k, v]) => inspect(k, 0, seen) + ' → ' + inspect(v, depth - 1, seen)).join(', ') + '}';
    if (x instanceof Set) return `Set(${x.size}) {` + [...x].slice(0, 12).map((v) => inspect(v, 0, seen)).join(', ') + '}';
    if (x.toString !== Object.prototype.toString && typeof x.toString === 'function') { const s = String(x); if (s !== '[object Object]') return s; }
    const keys = Object.keys(x); if (depth < 0) return '{…}';
    { const cn = x.constructor && x.constructor.name; if (cn && cn !== 'Object') return cn + ' { ' + keys.slice(0, 10).join(', ') + (keys.length > 10 ? ', …' : '') + ' }'; }
    return '{ ' + keys.slice(0, 20).map((k) => (/^[\w$]+$/.test(k) ? k : JSON.stringify(k)) + ': ' + inspect(x[k], depth - 1, seen)).join(', ') + (keys.length > 20 ? ', …' : '') + ' }';
  } finally { seen.delete(x); }
}
IDE.inspect = inspect;
function fmt(x) {
  if (x && x.nodeType) return x;
  if (x && typeof x === 'object' && x.__node) return x.__node;
  let src = x; try { src = raw(x); } catch (e) { /* not a proxy */ }
  if (isImg(src)) return imgNode(src, src.meta && src.meta.note ? `${src.meta.note} · ${src.w}×${src.h}` : `${src.w}×${src.h}`);
  if (src && typeof src === 'object' && isImg(src.img) && typeof src.at === 'function') { const box = el('div', { class: 'cimg' }); box.append(imgNode(src.img, `${src.tap || 'out'} · ${src.img.w}×${src.img.h}${src.ms !== undefined ? ' · ' + Math.round(src.ms) + ' ms' : ''}`)); return box; }
  if (Array.isArray(src) && src.length && src.length <= 8 && src.every(isImg)) { const row = el('div', { class: 'crow' }); for (const im of src) row.append(imgNode(im, `${im.w}×${im.h}`)); return row; }
  if (src && typeof src === 'object' && src.constructor && src.constructor.name === 'ResultSet' && src.imgs) { const row = el('div', { class: 'crow' }); for (const [k, im] of Object.entries(src.imgs)) row.append(imgNode(im, k)); return row; }
  if (typeof src === 'string') return document.createTextNode(src);
  const s = inspect(src, 2);
  const pre = document.createElement('span'); pre.textContent = s; return pre;
}
function imgNode(img, cap) {
  const f = el('figure', { class: 'cfig' }); const c = IDE.imgCanvas(img, 360); f.append(c, el('figcaption', { text: cap })); c.addEventListener('click', () => f.classList.toggle('big')); return f;
}
IDE.fmt = fmt;

/* ---------- the session scope ---------- */
const S = (IDE.session = { wb: null, rb: null, G: null, mods: new Map(), running: false, runId: 0, stats: { runs: 0 }, off: null });
function makeScope() {
  const G = Object.create(null), api = V2.api();
  Object.assign(G, api);
  G.bench = function bench(name, o) {
    const b = V2.bench(name, o);
    if (S.mainRun && !S.wb) adopt(b);
    return b;
  };
  G.bench.load = (saved, scope) => { const sc = Object.assign({}, G, scope || {}); for (const k of ['wb', 'ws', 'ctl', 'rig']) delete sc[k]; return V2.bench.load(saved, sc); };
  G.use = (b) => { adopt(b); log_info(b); return b; };
  G.log = (...a) => { addLine('log', a.map(fmt)); return a.length === 1 ? a[0] : undefined; };
  G.warn = (...a) => { addLine('warn', a.map(fmt)); };
  G.show = (...a) => { addLine('log', a.map(fmt)); return a[0]; };
  G.table = (rows, cols) => { addLine('log', [tableNode(rows, cols)]); };
  G.clear = IDE.clearConsole; G.sleep = IDE.sleep; G.FB = FB; G.CV = CV; G.PLOTS = PLOTS; G.ide = IDE; G.V2 = V2; G.Img = CV.Img;
  G.sample = (...a) => (IDE.caps.sample ? IDE.caps.sample(...a) : Promise.reject(new Error('sampling is not available in this view')));
  return G;
}
function log_info(b) { if (!S.mainRun) { const rb = raw(b); addLine('info', [fmt('now showing bench "' + rb.name + '" in every view · Run main.js to go back to the studio')]); } }
function tableNode(rows, cols) {
  rows = Array.isArray(rows) ? rows : Object.entries(rows).map(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.assign({ key: k }, v) : { key: k, value: v }));
  cols = cols || [...new Set(rows.flatMap((r) => (r && typeof r === 'object' ? Object.keys(r) : [])))].slice(0, 12);
  const t = el('table', { class: 'rt' }); t.append(el('thead', {}, el('tr', {}, ...cols.map((c) => el('th', { text: c })))));
  const tb = el('tbody'); for (const r of rows.slice(0, 60)) tb.append(el('tr', {}, ...cols.map((c) => el('td', { text: inspect(r == null ? '' : r[c], 1) })))); t.append(tb); return t;
}
const scopeProxy = (G) => new Proxy(G, { has: (t, k) => typeof k === 'string' && k in t, get: (t, k) => (k === Symbol.unscopables ? undefined : t[k]) });

function adopt(b) {
  const rb = raw(b); if (S.rb === rb) return;
  if (S.off) S.off();
  S.rb = rb; S.wb = rb.proxy || b; const G = S.G;
  G.wb = S.wb; G.ws = rb.ws && rb.wsp ? rb.wsp : rb.ws; G.ctl = rb.ctlp || rb.ctl;
  if (!S.mainRun) { if (rb.pipes.has('default')) G.rig = rb.pipe('default'); else delete G.rig; }
  S.off = rb.on(() => IDE.scheduleChange());
  V2.askAgent = (bench, prompt) => IDE.agentAsk(prompt);
  IDE.emit('bench', rb); IDE.scheduleChange();
}
let changeQ = false;
IDE.scheduleChange = function () { if (changeQ) return; changeQ = true; queueMicrotask(() => { changeQ = false; IDE.emit('change', S.rb); }); };
IDE.bench = () => S.rb;

/* ---------- running modules ---------- */
const FILE_TOP = new Set(['wb', 'ws', 'ctl']);
function execute(path, src, exportsObj, module, o) {
  o = o || {};
  const { code, epilogue } = IDE.rewrite(src);
  const names = o.session ? IDE.topNames(code).filter((n) => !(FILE_TOP.has(n) && path !== 'main.js')) : [];
  const toG = names.map((n) => `try { __g.${n} = ${n}; } catch (e) {}`).join(' ');
  const body = `with(__scope){ try {${code}\n;${epilogue} ${toG}\n} catch (e) { __module.error = e; } }\n//# sourceURL=fbfs/${path}`;
  let fn;
  try { fn = new AsyncFunction('__scope', '__g', '__require', 'exports', '__module', body); } catch (e) { const se = IDE.syntaxCheck(src); const err = new Error((se ? `syntax error on line ${se.line}: ${se.msg}` : 'syntax error: ' + e.message)); err.syntax = se || { line: 1, msg: e.message }; err.file = path; throw err; }
  const p = fn(scopeProxy(S.G), S.G, makeRequire(path), exportsObj, module);
  return p;
}
function makeRequire(from) {
  return (spec) => {
    if (spec === 'filmbench' || spec === 'filmbench/v2') return Object.assign({}, S.G);
    const p = vfs.resolve(from, spec);
    if (!vfs.exists(p)) throw V2.diag('E_FILE', `cannot import "${spec}" from ${from}`, { mean: V2.nearest ? V2.nearest(spec.replace(/^\.\//, ''), vfs.list()) : [], list: { files: vfs.list() } });
    return loadModule(p);
  };
}
function loadModule(p) {
  const hit = S.mods.get(p); if (hit) return hit.exports;
  const m = { exports: {}, error: null, path: p }; S.mods.set(p, m);
  execute(p, vfs.read(p), m.exports, m, {});
  if (m.error) { S.mods.delete(p); throw m.error; }
  return m.exports;
}
function reportError(e, path, lineOffset) {
  const where = e && e.syntax ? { line: e.syntax.line } : IDE.errLine(e, path);
  const line = where ? where.line + (lineOffset || 0) : null;
  const text = (e && e.message) ? e.message : String(e);
  const ln = addLine('err', [fmt(text + (line && !/line \d+/.test(text) ? `\n  at ${path}:${line}` : ''))], { file: e && e.file || path, line });
  IDE.emit('diag', { file: e && e.file || path, line, msg: text.split('\n')[0], code: e && e.code });
  return ln;
}

/* reset the session: a new scope, no bench, no modules */
IDE.resetSession = function () {
  if (S.off) { S.off(); S.off = null; }
  S.G = makeScope(); S.mods.clear(); S.wb = null; S.rb = null;
};
IDE.resetSession();

/* run main.js from scratch */
IDE.runMain = async function (o) {
  o = o || {}; if (S.running) return false;
  const prevSaved = (() => { try { return S.rb ? S.rb.save() : null; } catch (e) { return null; } })(); const prevChanged = S.rb && S.rb.log.length;
  S.running = true; IDE.emit('running', true); const t0 = performance.now(); let ok = true;
  const keepScene = S.rb && S.rb.scenes && S.rb.scenes.user ? S.rb.scenes.user : null;
  try {
    IDE.resetSession(); S.mainRun = true; IDE.emit('diag', { clear: true });
    const m = { exports: {}, error: null, path: 'main.js' }; S.mods.set('main.js', m);
    await execute('main.js', vfs.read('main.js'), m.exports, m, { session: true });
    if (m.error) throw m.error;
    if (!S.rb) throw V2.diag('E_SESSION', 'main.js did not create a bench', { fix: 'const wb = bench("studio")' });
    if (!('rig' in S.G) && S.rb.pipes.has('default')) S.G.rig = S.rb.pipe('default');
    if (keepScene) { try { S.rb.addScene('user', keepScene); } catch (e) { /* ignore */ } }
    const ms = Math.round(performance.now() - t0);
    if (!o.quiet) addLine('info', [fmt(`ran main.js in ${ms} ms · ${S.rb.pipes.size} pipeline${S.rb.pipes.size === 1 ? '' : 's'} · ${S.rb.ctl.list().length} controls · ${S.rb.ws.tiles.size} tiles · state ${S.rb.state.hash}`)]);
    if (prevSaved && prevChanged > 2 && !o.quiet) { IDE.prevSaved = prevSaved; addLine('info', [fmt('the previous session had ' + prevChanged + ' changes; '), restoreLink()]); }
  } catch (e) { ok = false; reportError(e, 'main.js'); }
  finally { S.mainRun = false; S.running = false; IDE.emit('running', false); IDE.scheduleChange(); IDE.emit('bench', S.rb); }
  return ok;
};
function restoreLink() { const a = el('a', { href: '#', class: 'lablink', text: 'restore it', onclick: (e) => { e.preventDefault(); IDE.restorePrev(); } }); return a; }
IDE.restorePrev = function () {
  const saved = IDE.prevSaved; if (!saved) return;
  try { IDE.resetSession(); S.mainRun = true; const scope = Object.assign({}, S.G); const wb = V2.bench.load(saved, scope); adopt(wb); S.mainRun = false; addLine('info', [fmt('restored the previous session (' + saved.hash + ')')]); } catch (e) { S.mainRun = false; reportError(e, 'saved script'); }
};

/* run a file or a piece of one in the current session */
IDE.runFile = async function (path, o) {
  o = o || {};
  if (path === 'main.js' && !o.code) return IDE.runMain();
  if (S.running) return false;
  if (!S.rb) { const ok = await IDE.runMain({ quiet: true }); if (!ok) return false; }
  const src = o.code != null ? o.code : vfs.read(path); if (src == null) return false;
  S.running = true; IDE.emit('running', true); const t0 = performance.now(); let ok = true;
  try {
    IDE.emit('diag', { clear: true, file: path });
    const m = { exports: {}, error: null, path };
    const lib = !o.code && /^lib\//.test(path);
    const pr = execute(o.code != null ? path : path, src, m.exports, m, { session: true });
    const res = await pr; if (m.error) throw m.error;
    const ex = Object.keys(m.exports); const ms = Math.round(performance.now() - t0);
    if (!o.quiet) addLine('info', [fmt(`${o.code != null ? 'ran selection of ' : 'ran '}${path} in ${ms} ms${ex.length ? ' · exports ' + ex.join(', ') : ''}`)]);
  } catch (e) { ok = false; reportError(e, path, o.line0 || 0); }
  finally { S.running = false; IDE.emit('running', false); IDE.scheduleChange(); }
  return ok;
};

/* the console's input line */
IDE.repl = async function (code) {
  code = code.trim(); if (!code) return;
  con.hist = con.hist.filter((h) => h !== code); con.hist.push(code); if (con.hist.length > 80) con.hist.shift(); store.set('hist', con.hist);
  const n = addLine('in', [document.createTextNode(code)]);
  if (!S.rb) { const ok = await IDE.runMain({ quiet: true }); if (!ok) return; }
  const names = IDE.topNames(code).filter((x) => !FILE_TOP.has(x)), toG = names.map((x) => `try { __g.${x} = ${x}; } catch (e) {}`).join(' ');
  let fn, asExpr = false;
  try { fn = new AsyncFunction('__scope', '__g', `with(__scope){ return (\n${code}\n) }\n//# sourceURL=fbfs/console`); asExpr = true; } catch (e) { /* statements */ }
  if (!fn) {   /* statements, then perhaps a final expression whose value is shown (const q = 5; q * 2) */
    for (let i = code.length - 1; i > 0 && !fn; i--) {
      const ch = code[i]; if (ch !== ';' && ch !== '\n') continue; const head = code.slice(0, i + 1), tail = code.slice(i + 1).trim(); if (!tail) continue;
      try { new AsyncFunction('return (\n' + tail + '\n)'); new AsyncFunction(head); fn = new AsyncFunction('__scope', '__g', `with(__scope){ ${head}\n${toG}\nreturn (\n${tail}\n) }\n//# sourceURL=fbfs/console`); asExpr = true; } catch (e) { fn = null; }
    }
  }
  if (!fn) {
    try { fn = new AsyncFunction('__scope', '__g', `with(__scope){ ${code}\n;${toG}\n}\n//# sourceURL=fbfs/console`); } catch (e) { const se = IDE.syntaxCheck(code); addLine('err', [fmt(se ? `syntax error: ${se.msg}` : e.message)]); return; }
  }
  try { const r = await fn(scopeProxy(S.G), S.G); if (r !== undefined || asExpr) addLine('out', [fmt(r)]); } catch (e) { addLine('err', [fmt(e && e.message ? e.message : String(e))]); }
  IDE.scheduleChange();
};

/* file helpers for tiles and the agent */
IDE.scope = () => S.G;
IDE.link = function (u) {
  const m = /^ide:(\w+)\/?(.*)$/.exec(u); if (!m) return;
  const [, kind, rest] = m, arg = decodeURIComponent(rest);
  if (kind === 'view') IDE.focusView(arg);
  else if (kind === 'file') { IDE.openFile(arg.split('#')[0], +(arg.split('#')[1] || 0) || undefined); }
  else if (kind === 'tile') { IDE.focusView('workspace'); IDE.emit('focus-tile', arg); }
  else if (kind === 'param') { const [k, v] = arg.split('='); if (S.rb) S.rb.apply({ op: 'param.set', path: k, value: isNaN(+v) ? (v === 'true' ? true : v === 'false' ? false : v) : +v }, 'user'); }
  else if (kind === 'preset') { if (S.rb) S.rb.apply({ op: 'layer.use', preset: arg, layer: 'look' }, 'user'); }
  else if (kind === 'layout') IDE.layoutUse && IDE.layoutUse(arg);
};
})();

/* Filmbench IDE — part 2: the generic Dock (tiles, tabs, splits, drag to move/split/tab, gutters, picker, plus menu). */
(function () {
'use strict';
const { el, $, $$, clamp, clone } = IDE;
const MIN = 0.06;

/* ---------- tree operations (pure, on clones) ---------- */
const T = (IDE.Tree = {
  tile: (views, active) => ({ t: 'tile', views: views.slice(), active: active || 0 }),
  views(n, out) { out = out || []; if (n.t === 'tile') out.push(...n.views); else for (const k of n.kids) T.views(k, out); return out; },
  tag(n, ctr) { ctr = ctr || { i: 0 }; if (n.t === 'tile') n._k = ++ctr.i; else for (const k of n.kids) T.tag(k, ctr); return n; },
  untag(n) { delete n._k; if (n.kids) for (const k of n.kids) T.untag(k); return n; },
  byKey(n, k) { if (n.t === 'tile') return n._k === k ? n : null; for (const c of n.kids) { const r = T.byKey(c, k); if (r) return r; } return null; },
  holder(n, id) { if (n.t === 'tile') return n.views.includes(id) ? n : null; for (const c of n.kids) { const r = T.holder(c, id); if (r) return r; } return null; },
  /* clean: drop duplicates and unknown views, empty tiles (unless keepRoot), single-child splits; merge same-direction splits; renormalise sizes */
  norm(n, o) {
    o = o || {}; const seen = new Set(), known = o.known;
    const walk = (x, root) => {
      if (x.t === 'tile') {
        const vs = x.views.filter((v) => !seen.has(v) && (!known || known(v))); vs.forEach((v) => seen.add(v)); x.views = vs; x.active = clamp(x.active | 0, 0, Math.max(0, vs.length - 1));
        return vs.length || (root && o.keepRoot) || o.keepEmpty ? x : null;
      }
      const ks = [], sz = [];
      x.kids.forEach((k, i) => { const r = walk(k, false); if (r) { if (r.t === 'split' && r.dir === x.dir) { const s = x.sizes[i] || 1 / x.kids.length, tot = r.sizes.reduce((a, b) => a + b, 0) || 1; r.kids.forEach((kk, j) => { ks.push(kk); sz.push(s * (r.sizes[j] / tot)); }); } else { ks.push(r); sz.push(x.sizes[i] || 1 / x.kids.length); } } });
      if (!ks.length) return null; if (ks.length === 1) return ks[0];
      const tot = sz.reduce((a, b) => a + b, 0); let s2 = sz.map((v) => Math.max(MIN, v / tot)); const t2 = s2.reduce((a, b) => a + b, 0); s2 = s2.map((v) => Math.round((v / t2) * 1e4) / 1e4);
      return { t: 'split', dir: x.dir, kids: ks, sizes: s2 };
    };
    const r = walk(n, true); return r || (o.keepRoot ? T.tile([], 0) : null);
  },
  remove(tree, id, o) { const c = T.tag(clone(tree)); const h = T.holder(c, id); if (h) { const i = h.views.indexOf(id); h.views.splice(i, 1); h.active = Math.min(h.active, Math.max(0, h.views.length - 1)); } return T.untag(T.norm(c, Object.assign({ keepRoot: true }, o)) || T.tile([], 0)); },
  add(tree, id, key, index) { const c = T.tag(clone(tree)); const tgt = T.byKey(c, key) || T.firstTile(c); const i = index === undefined || index > tgt.views.length ? tgt.views.length : index; tgt.views.splice(i, 0, id); tgt.active = i; return T.untag(c); },
  firstTile(n) { return n.t === 'tile' ? n : T.firstTile(n.kids[0]); },
  /* move view `id` into the tile keyed `key`: zone 'tab' (at index), or split on a side */
  move(tree, id, key, zone, index, o) {
    const c = T.tag(clone(tree)); const tgt0 = T.byKey(c, key); if (!tgt0) return tree;
    const src = T.holder(c, id);
    if (zone === 'tab') {
      if (src === tgt0) { const cur = src.views.indexOf(id); src.views.splice(cur, 1); let i = index === undefined ? src.views.length : index; if (index !== undefined && index > cur) i--; src.views.splice(clamp(i, 0, src.views.length), 0, id); src.active = src.views.indexOf(id); return T.untag(c); }
      if (src) src.views.splice(src.views.indexOf(id), 1); tgt0.views.splice(index === undefined ? tgt0.views.length : index, 0, id); tgt0.active = tgt0.views.indexOf(id);
    } else {
      if (src === tgt0 && src.views.length === 1) return tree;
      if (src) { src.views.splice(src.views.indexOf(id), 1); src.active = Math.min(src.active, Math.max(0, src.views.length - 1)); }
      const nt = T.tile([id], 0), dir = zone === 'left' || zone === 'right' ? 'row' : 'col', first = zone === 'left' || zone === 'top';
      const copy = Object.assign({}, tgt0); const par = { t: 'split', dir, kids: first ? [nt, copy] : [copy, nt], sizes: [0.5, 0.5] };
      for (const k of Object.keys(tgt0)) delete tgt0[k]; Object.assign(tgt0, par);
    }
    return T.untag(T.norm(c, Object.assign({ keepRoot: true }, o)));
  },
});

/* ---------- the Dock ---------- */
class Dock {
  /* o: { items(id)→{title, about?, make()}, all():ids, getTree(), setTree(tree), badge?(id), narrow?:px, keepEmpty? } */
  constructor(o) {
    this.o = o; this.root = el('div', { class: 'dock' }); this.views = new Map(); this.sig = ''; this.single = false; this.sid = null; this.drag = null; this.onTabs = [];
    this.ro = new ResizeObserver(() => { const w = this.root.clientWidth, s = w > 0 && w < (o.narrow || 640); if (s !== this.single) { this.single = s; this.sig = ''; this.render(); } this.onResize(); }); this.ro.observe(this.root);
  }
  onResize() { for (const v of this.views.values()) if (v.visible && v.resize) v.resize(); }
  tree() { let t = this.o.getTree(); if (!t) t = T.tile([], 0); if (this.single) { const vs = T.views(t); const act = vs.includes(this.sid) ? this.sid : (T.firstTile(t).views[T.firstTile(t).active] || vs[0]); this.sid = act; return { t: 'tile', views: vs, active: Math.max(0, vs.indexOf(act)) }; } return t; }
  view(id) {
    let v = this.views.get(id); if (v) return v; const it = this.o.items(id); if (!it) return null;
    v = it.make(); v.id = id; v.visible = false; v.stale = true; v.el.classList.add('view'); this.views.set(id, v); return v;
  }
  closed() { const open = new Set(T.views(this.o.getTree() || T.tile([], 0))); return this.o.all().filter((id) => !open.has(id)); }
  render() {
    const t = this.tree(), sig = JSON.stringify(t);
    if (sig === this.sig) { this.updateTabs(); return; }
    this.sig = sig; this.tiles = []; const shown = new Set();
    const body = this.build(t, []); this.root.replaceChildren(body);
    for (const tl of this.tiles) { const holder = tl.body; tl.node.views.forEach((id, i) => { const v = this.view(id); if (!v) return; shown.add(id); holder.append(v.el); const on = i === tl.node.active; v.el.classList.toggle('on', on); this.setVisible(v, on); }); }
    for (const [id, v] of this.views) if (!shown.has(id)) { this.setVisible(v, false); v.el.remove(); }
    this.updateTabs();
  }
  setVisible(v, on) { if (on === v.visible) return; v.visible = on; if (on) { if (v.onShow) v.onShow(); if (v.stale && v.update) { v.stale = false; v.update(); } if (v.resize) v.resize(); } else if (v.onHide) v.onHide(); }
  build(n, path) {
    if (n.t === 'tile') return this.buildTile(n, path);
    const sp = el('div', { class: 'dsplit ' + n.dir }); const cells = [];
    n.kids.forEach((k, i) => {
      if (i) sp.append(this.gutter(n, path, i, sp, cells));
      const cell = el('div', { class: 'dcell', style: { flex: `${n.sizes[i]} 1 0` } }); cell.append(this.build(k, path.concat(i))); cells.push(cell); sp.append(cell);
    });
    return sp;
  }
  buildTile(n, path) {
    const tile = el('section', { class: 'tile', 'data-path': path.join('.') }), strip = el('div', { class: 'dstrip' }), tabs = el('div', { class: 'dtabs', role: 'tablist' }), body = el('div', { class: 'tilebody' });
    const plus = el('div', { class: 'rel' }, el('button', { class: 'tabact plus', title: 'Open a view in this tile', 'aria-label': 'Open a view in this tile', text: '+', onclick: (e) => { e.stopPropagation(); this.plusMenu(plus, path); } }));
    n.views.forEach((id, i) => {
      const it = this.o.items(id); if (!it) return;
      const lbl = el('button', { class: 'lbl', role: 'tab', 'aria-selected': i === n.active ? 'true' : 'false', 'data-id': id }, el('span', { class: 't', text: it.title }));
      const x = el('button', { class: 'x', 'aria-label': 'Close ' + it.title, text: '×', onclick: (e) => { e.stopPropagation(); this.close(id); } });
      const tab = el('div', { class: 'dtab' + (i === n.active ? ' on' : ''), 'data-id': id }, lbl, x);
      lbl.addEventListener('click', () => { if (this.drag && this.drag.moved) return; this.activate(path, i); });
      lbl.addEventListener('pointerdown', (e) => this.dragStart(e, id, it.title));
      tabs.append(tab);
    });
    strip.append(tabs, el('div', { style: { flex: 1 } }), plus);
    if (this.o.stripExtra) { const ex = this.o.stripExtra(n); if (ex) strip.insertBefore(ex, plus); }
    tile.append(strip, body); this.tiles.push({ node: n, path, body, tile, tabs });
    if (!n.views.length) body.append(this.picker(path));
    tile._rec = { node: n, path }; return tile;
  }
  picker(path) {
    const ids = this.closed(), grid = el('div', { class: 'pgrid' });
    for (const id of ids) { const it = this.o.items(id); grid.append(el('button', { onclick: () => this.addTo(path, id) }, el('b', { text: it.title }), el('small', { text: it.about || '' }))); }
    return el('div', { class: 'picker' }, el('p', { class: 'lead', text: ids.length ? 'An empty tile. Open a view:' : 'An empty tile. Every view is open elsewhere; drag one here by its tab.' }), ids.length ? grid : null);
  }
  updateTabs() {
    for (const tl of this.tiles || []) {
      $$('.dtab', tl.tabs).forEach((tab) => {
        const id = tab.dataset.id, it = this.o.items(id); if (!it) return; const lbl = $('.lbl', tab); let c = $('.count', lbl); const b = this.o.badge ? this.o.badge(id) : null;
        if (b) { if (!c) { c = el('span', { class: 'count' }); lbl.append(c); } c.textContent = b.n; c.className = 'count' + (b.bad ? ' bad' : ''); } else if (c) c.remove();
        const tt = $('.t', lbl); if (tt && tt.textContent !== it.title) tt.textContent = it.title;
      });
    }
  }
  activate(path, i) {
    const t = this.single ? null : clone(this.o.getTree()); if (this.single) { const ids = T.views(this.o.getTree()); this.sid = ids[i]; this.sig = ''; this.render(); this.focused && this.focused(this.sid); return; }
    const n = this.nodeAt(t, path); if (n && n.t === 'tile') { n.active = i; this.commit(t); this.focused && this.focused(n.views[i]); }
  }
  nodeAt(t, path) { let n = t; for (const i of path) n = n.kids[i]; return n; }
  commit(t) { this.o.setTree(t); this.sig = ''; this.render(); }
  close(id) { if (this.single) return; this.commit(T.remove(this.o.getTree(), id, { keepEmpty: !!this.o.keepEmpty })); }
  addTo(path, id) { const t = clone(this.o.getTree()); const n = this.nodeAt(t, path); n.views.push(id); n.active = n.views.length - 1; this.commit(this.single ? T.add(this.o.getTree(), id, 1) : t); if (this.single) { this.sid = id; this.sig = ''; this.render(); } }
  plusMenu(host, path) {
    $$('.menu', this.root).forEach((m) => m.remove()); const ids = this.closed(), m = el('div', { class: 'menu right' });
    if (!ids.length) m.append(el('div', { class: 'grp', text: 'every view is open' }));
    for (const id of ids) { const it = this.o.items(id); m.append(el('button', { onclick: () => { m.remove(); this.addTo(path, id); } }, el('span', { text: it.title }), it.about ? el('small', { text: it.about }) : null)); }
    host.append(m); { const r = m.getBoundingClientRect(), hr = host.getBoundingClientRect(); if (r.left < 4) { m.style.right = 'auto'; m.style.left = (4 - hr.left) + 'px'; } if (r.bottom > innerHeight - 4 && hr.top > r.height) { m.style.top = 'auto'; m.style.bottom = '100%'; } } const off = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', off, true); } }; setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  }
  /* bring a view forward: activate it where it is, or add it to the first tile */
  focus(id) {
    const t = this.o.getTree(); if (!t) return;
    if (this.single) { this.sid = id; this.sig = ''; this.render(); return; }
    const c = clone(t), h = T.holder(T.tag(c), id);
    if (h) { h.active = h.views.indexOf(id); T.untag(c); this.commit(c); }
    else { const keyTarget = this.o.near ? this.o.near(id, c) : null; const tgt = keyTarget || T.firstTile(c); tgt.views.push(id); tgt.active = tgt.views.length - 1; T.untag(c); this.commit(c); }
  }
  /* ---------- gutters ---------- */
  gutter(n, path, i, sp, cells) {
    const g = el('div', { class: 'gutter ' + n.dir, role: 'separator', tabindex: '0', 'aria-orientation': n.dir === 'row' ? 'vertical' : 'horizontal', 'aria-label': 'Resize' });
    let st = null;
    const apply = (a, b, sizes) => { cells[a].style.flex = `${sizes[a]} 1 0`; cells[b].style.flex = `${sizes[b]} 1 0`; };
    g.addEventListener('pointerdown', (e) => { e.preventDefault(); const r = sp.getBoundingClientRect(); st = { x: e.clientX, y: e.clientY, total: n.dir === 'row' ? r.width : r.height, sizes: n.sizes.slice() }; g.setPointerCapture(e.pointerId); document.body.classList.add(n.dir === 'row' ? 'resizing-x' : 'resizing-y'); });
    g.addEventListener('pointermove', (e) => { if (!st) return; const d = ((n.dir === 'row' ? e.clientX - st.x : e.clientY - st.y) / (st.total || 1)); const a = i - 1, b = i, pair = st.sizes[a] + st.sizes[b]; let na = clamp(st.sizes[a] + d, MIN, pair - MIN); const s = st.sizes.slice(); s[a] = na; s[b] = pair - na; apply(a, b, s); st.cur = s; this.onResize(); });
    const end = (e) => { if (!st) return; document.body.classList.remove('resizing-x', 'resizing-y'); if (st.cur) { const t = clone(this.o.getTree()), node = this.nodeAt(t, path); node.sizes = st.cur.map((v) => Math.round(v * 1e4) / 1e4); this.o.setTree(t); this.sig = JSON.stringify(this.tree()); } st = null; };
    g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
    g.addEventListener('keydown', (e) => { const k = e.key, f = n.dir === 'row' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']; if (k !== f[0] && k !== f[1]) return; e.preventDefault(); const t = clone(this.o.getTree()), node = this.nodeAt(t, path), a = i - 1, b = i, d = k === f[0] ? -0.02 : 0.02, pair = node.sizes[a] + node.sizes[b]; const na = clamp(node.sizes[a] + d, MIN, pair - MIN); node.sizes[a] = Math.round(na * 1e4) / 1e4; node.sizes[b] = Math.round((pair - na) * 1e4) / 1e4; this.o.setTree(t); this.sig = ''; this.render(); const g2 = $$('.gutter', this.root).find((x) => x === g || false); });
    return g;
  }
  /* ---------- tab drag ---------- */
  dragStart(e, id, title) {
    if (this.single || e.button !== 0) return; const sx = e.clientX, sy = e.clientY; const st = (this.drag = { id, title, moved: false }); const target = e.currentTarget;
    const move = (ev) => {
      if (!st.moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      if (!st.moved) { st.moved = true; st.ghost = el('div', { class: 'drag-ghost' }); st.hint = el('div', { class: 'drop-hint' }, el('span')); document.body.append(st.ghost, st.hint); document.body.classList.add('dragging-tab'); }
      st.ghost.style.left = ev.clientX + 12 + 'px'; st.ghost.style.top = ev.clientY + 10 + 'px';
      const d = this.dropAt(ev.clientX, ev.clientY, id); st.drop = d;
      st.ghost.innerHTML = ''; st.ghost.append(document.createTextNode(title + ' '), el('small', { text: d ? d.label : 'drop on a tile' }));
      if (!d) { st.hint.style.display = 'none'; return; }
      st.hint.style.display = ''; st.hint.className = 'drop-hint' + (d.marker ? ' marker' : ''); Object.assign(st.hint.style, { left: d.rect.x + 'px', top: d.rect.y + 'px', width: d.rect.w + 'px', height: d.rect.h + 'px' }); const sp = st.hint.firstChild; if (sp) sp.textContent = d.marker ? '' : d.label;
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      document.body.classList.remove('dragging-tab'); if (st.ghost) st.ghost.remove(); if (st.hint) st.hint.remove();
      const d = st.drop; setTimeout(() => { this.drag = null; }, 0);
      if (st.moved && d) { const t = this.o.getTree(), c = T.tag(clone(t)); const tl = (this.tiles || []).find((x) => x.path.join('.') === d.path); const keyOf = (path) => { let n = c; for (const i of path) n = n.kids[i]; return n._k; }; const key = keyOf(tl.path); T.untag(c); this.commit(T.move(t, id, key, d.zone, d.index, { keepEmpty: !!this.o.keepEmpty })); }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }
  dropAt(x, y, id) {
    const e = document.elementFromPoint(x, y); const tile = e && e.closest && e.closest('.tile'); if (!tile || !this.root.contains(tile)) return null;
    const r = tile.getBoundingClientRect(), strip = $('.dstrip', tile).getBoundingClientRect(), path = tile.dataset.path;
    const tl = (this.tiles || []).find((q) => q.path.join('.') === path); const only = tl && tl.node.views.length === 1 && tl.node.views[0] === id;
    if (y <= strip.bottom) {
      const tabs = $$('.dtab', tile); let idx = tabs.length, mx = strip.left + 4;
      for (let i = 0; i < tabs.length; i++) { const b = tabs[i].getBoundingClientRect(); if (x < b.left + b.width / 2) { idx = i; mx = b.left; break; } mx = b.right; }
      return { zone: 'tab', index: idx, path, label: 'move here', marker: true, rect: { x: mx - 1, y: strip.top + 4, w: 2, h: strip.height - 8 } };
    }
    if (only) return { zone: 'tab', path, label: 'already here', rect: { x: r.left, y: r.top, w: r.width, h: r.height } };
    const bx = (x - r.left) / r.width, by = (y - strip.bottom) / Math.max(1, r.bottom - strip.bottom);
    if (bx < 0.22) return { zone: 'left', path, label: 'split left', rect: { x: r.left, y: r.top, w: r.width / 2, h: r.height } };
    if (bx > 0.78) return { zone: 'right', path, label: 'split right', rect: { x: r.left + r.width / 2, y: r.top, w: r.width / 2, h: r.height } };
    if (by < 0.22) return { zone: 'top', path, label: 'split above', rect: { x: r.left, y: r.top, w: r.width, h: r.height / 2 } };
    if (by > 0.78) return { zone: 'bottom', path, label: 'split below', rect: { x: r.left, y: r.top + r.height / 2, w: r.width, h: r.height / 2 } };
    return { zone: 'tab', path, label: 'add as a tab', rect: { x: r.left, y: r.top, w: r.width, h: r.height } };
  }
}
IDE.Dock = Dock;

/* ---------- views: base helper ---------- */
IDE.makeView = function (build, o) {
  const v = Object.assign({ el: el('div', { class: 'view' }), visible: false, stale: true, update() {}, touch() { this.stale = true; if (this.visible && !this._q) { this._q = true; requestAnimationFrame(() => { this._q = false; if (this.visible) { this.stale = false; this.update(); } }); } } }, o || {});
  build(v); return v;
};
})();

/* Filmbench IDE — part 3: Files, Code (editor with diagnostics, completion), Console. */
(function () {
'use strict';
const { el, $, $$, esc, clamp, vfs, store } = IDE, V2 = window.V2, raw = V2.raw;

/* ---------- editor state ---------- */
const ED = (IDE.editor = { open: store.get('open', ['main.js']), active: store.get('active', 'main.js'), diags: new Map(), pos: new Map() });
ED.open = ED.open.filter((p) => vfs.exists(p)); if (!ED.open.length) ED.open = ['main.js']; if (!ED.open.includes(ED.active)) ED.active = ED.open[0];
const saveEd = () => { store.set('open', ED.open); store.set('active', ED.active); };
IDE.openFile = function (path, line) {
  if (!vfs.exists(path)) { IDE.toast('no file ' + path, true); return; }
  if (!ED.open.includes(path)) ED.open.push(path); ED.active = path; saveEd(); IDE.emit('editor'); IDE.focusView('code'); if (line) setTimeout(() => IDE.emit('goto', { path, line }), 30);
};
IDE.closeFile = function (path) { ED.open = ED.open.filter((p) => p !== path); if (!ED.open.length) ED.open = ['main.js']; if (ED.active === path) ED.active = ED.open[Math.max(0, ED.open.length - 1)]; saveEd(); IDE.emit('editor'); };
IDE.on('diag', (d) => {
  if (d.clear) { if (d.file) ED.diags.delete(d.file); else ED.diags.clear(); IDE.emit('diags'); return; }
  const arr = ED.diags.get(d.file) || []; arr.push({ line: d.line, msg: d.msg, code: d.code, sev: 'err' }); ED.diags.set(d.file, arr); IDE.emit('diags');
  if (d.line && d.file) IDE.emit('goto', { path: d.file, line: d.line, open: true });
});

/* ---------- the Files view ---------- */
IDE.views.files = () => IDE.makeView((v) => {
  v.el.classList.add('v-files'); const tools = el('div', { class: 'toolbar' }), list = el('div', { class: 'scroll ftree' });
  const filter = el('input', { class: 'filter', placeholder: 'Filter files', 'aria-label': 'Filter files', oninput: () => v.update() });
  const newBtn = el('button', { class: 'btn sm', text: 'New file…', onclick: () => newFile() });
  const resetBtn = el('button', { class: 'btn sm', text: 'Reset…', title: 'Restore the built-in scripts', onclick: async () => { if (await IDE.confirm('Restore every built-in script to its original and delete the files you created?', { ok: 'Restore' })) { vfs.reset(); IDE.toast('Scripts restored. Run main.js to reload.'); } } });
  tools.append(filter, el('span', { class: 'sp' }), newBtn, resetBtn);
  const open = new Set(store.get('folders', ['lib', 'examples']));
  v.el.append(tools, list);
  function newFile() {
    const row = el('div', { class: 'frow edit' }), inp = el('input', { class: 'filter', placeholder: 'examples/my-look.js', value: 'scratch.js', 'aria-label': 'New file name' });
    row.append(inp, el('button', { class: 'btn sm primary', text: 'Create', onclick: go }), el('button', { class: 'btn sm', text: 'Cancel', onclick: () => row.remove() })); list.prepend(row); inp.focus(); inp.select();
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); if (e.key === 'Escape') row.remove(); });
    function go() { let p = inp.value.trim().replace(/^\/+/, ''); if (!p) return; if (!/\.\w+$/.test(p)) p += '.js'; if (vfs.exists(p)) { IDE.toast(p + ' already exists', true); return; } vfs.write(p, /\.md$/.test(p) ? '# ' + p + '\n' : '// ' + p + '\n'); IDE.openFile(p); }
  }
  v.update = () => {
    const q = filter.value.trim().toLowerCase(), files = vfs.list().filter((p) => !q || p.toLowerCase().includes(q)); list.innerHTML = '';
    const groups = new Map(); for (const p of files) { const d = p.includes('/') ? p.split('/')[0] : ''; if (!groups.has(d)) groups.set(d, []); groups.get(d).push(p); }
    const order = ['', ...[...groups.keys()].filter((k) => k).sort()];
    for (const d of order) {
      const items = groups.get(d); if (!items) continue;
      if (d) { const isOpen = open.has(d) || !!q; list.append(el('button', { class: 'fdir' + (isOpen ? ' on' : ''), onclick: () => { if (open.has(d)) open.delete(d); else open.add(d); store.set('folders', [...open]); v.update(); } }, el('span', { class: 'car', text: isOpen ? '▾' : '▸' }), el('span', { text: d + '/' }), el('small', { text: String(items.length) }))); if (!isOpen) continue; }
      for (const p of items) {
        const name = d ? p.slice(d.length + 1) : p, isDirty = vfs.modified(p), isNew = vfs.isNew(p), diag = ED.diags.get(p);
        const row = el('div', { class: 'frow' + (p === ED.active ? ' on' : '') + (d ? ' in' : ''), title: p });
        row.append(el('button', { class: 'fname', onclick: () => IDE.openFile(p) }, el('span', { class: 'nm', text: name }), isDirty ? el('em', { text: 'edited' }) : null, isNew ? el('em', { text: 'new' }) : null, diag && diag.length ? el('em', { class: 'bad', text: String(diag.length) }) : null),
          el('span', { class: 'fact' },
            isDirty ? el('button', { class: 'x', title: 'Revert to the built-in version', 'aria-label': 'Revert ' + p, text: '↺', onclick: () => { vfs.revert(p); IDE.emit('editor-reload', p); } }) : null,
            el('button', { class: 'x', title: 'Rename', 'aria-label': 'Rename ' + p, text: '✎', onclick: async () => { const r = await IDE.ask({ title: 'Rename ' + p, ok: 'Rename', fields: [{ key: 'n', label: 'New name', value: p }] }); const nn = r && r.n; if (nn && nn !== p) { if (vfs.rename(p, nn)) { ED.open = ED.open.map((x) => (x === p ? nn : x)); if (ED.active === p) ED.active = nn; saveEd(); IDE.emit('editor'); } else IDE.toast('could not rename (name taken?)', true); } } }),
            p === 'main.js' ? null : el('button', { class: 'x', title: vfs.isBuiltin(p) ? 'Hide (Reset… brings it back)' : 'Delete', 'aria-label': 'Delete ' + p, text: '×', onclick: async () => { if (await IDE.confirm('Delete ' + p + '?')) { vfs.remove(p); IDE.closeFile(p); } } })));
        list.append(row);
      }
    }
    if (!files.length) list.append(el('p', { class: 'empty pad', text: 'No file matches.' }));
  };
  vfs.on(() => v.touch()); IDE.on('editor', () => v.touch()); IDE.on('diags', () => v.touch());
});

/* ---------- completion vocabulary ---------- */
const WORDS = {
  ws: () => ['tile', 'dock', 'layout', 'probe', 'link', 'attach', 'keep', 'drop', 'pipe', 'audit', 'describe', 'snapshot', 'has', 'get', 'tiles', 'renderImg'],
  wb: () => ['pipe', 'preset', 'axis', 'compare', 'use', 'set', 'stage', 'tx', 'undo', 'redo', 'apply', 'approve', 'approveAll', 'skip', 'agent', 'ask', 'script', 'save', 'state', 'ctl', 'ws', 'log', 'params', 'macros', 'presets', 'pending', 'fragments', 'graph', 'scenes', 'addScene', 'stock', 'stockIds', 'on', 'registerLens'],
  ctl: () => ['slider', 'toggle', 'stepper', 'select', 'macro', 'choice', 'button', 'wheel', 'list', 'byPath', 'layers', 'layer', 'pin', 'unpin', 'why', 'scheme', 'use', 'schemes', 'current', 'fromSpec'],
  rig: () => ['scene', 'film', 'enlarger', 'paper', 'scan', 'mask', 'sum', 'compile', 'swap', 'engine', 'explain', 'insert', 'remove', 'drop', 'fork', 'set', 'at', 'eval', 'diff', 'keys', 'nodes', 'edges', 'toDot', 'summary', 'capabilities'],
};
function stringKind(before) {
  // before: the text before the opening quote
  const m = /(\.?[\w$]+)\s*\(\s*(?:[^()]*,\s*)?$/.exec(before) || /([\w$]+)\s*:\s*$/.exec(before); if (!m) return null; const f = m[1].replace(/^\./, '');
  if (['render', 'hist', 'parade', 'checkTap', 'at', 'eval', 'tap', 'taps'].includes(f)) return 'taps';
  if (['set', 'get', 'reset', 'effective', 'pin', 'unpin', 'why', 'slider', 'toggle', 'stepper', 'select', 'drives', 'apply', 'axis', 'path'].includes(f)) return 'paths';
  if (f === 'film') return 'films'; if (f === 'paper') return 'papers'; if (f === 'scene') return 'scenes';
  if (['crop', 'probe', 'zoom', 'measure', 'at'].includes(f)) return 'probes'; if (f === 'preset') return 'presets'; if (f === 'use') return 'uses';
  return null;
}
IDE.vocab = function (kind) {
  const rb = IDE.session.rb; if (!rb) return [];
  switch (kind) {
    case 'taps': return ['src', 'log_e_film', 'cmy_film', 'log_e_print', 'cmy_print', 'out'].concat([...(rb.mainNet() ? rb.mainNet().stages.map((s) => s.tap).filter(Boolean) : [])]).filter((x, i, a) => a.indexOf(x) === i);
    case 'paths': return rb.table.paths();
    case 'films': return rb.stockIds('film'); case 'papers': return rb.stockIds('paper'); case 'scenes': return Object.keys(rb.scenes);
    case 'probes': return [...rb.ws.probes.keys()]; case 'presets': return [...rb.presets.keys()]; case 'uses': return [...rb.presets.keys(), ...rb.ctl.schemes ? [].concat(rb.ctl.schemes()) : []];
    default: return [];
  }
};

/* ---------- the Code view ---------- */
IDE.views.code = () => IDE.makeView((v) => {
  v.el.classList.add('v-code');
  const tabs = el('div', { class: 'filetabs', role: 'tablist' });
  const runBtn = el('button', { class: 'btn sm primary', title: 'Run this file (Ctrl+Enter). With a selection, runs the selection.', onclick: () => run() }, 'Run'), restartBtn = el('button', { class: 'btn sm', title: 'Reset the session and run main.js (Ctrl+Shift+Enter)', onclick: () => IDE.runMain() }, 'Run main');
  const bar = el('div', { class: 'toolbar filebar' }, tabs, el('span', { class: 'sp' }), restartBtn, runBtn);
  const gutterIn = el('div', { class: 'gutter-in' }), gutter = el('div', { class: 'egutter' }, gutterIn), pre = el('pre', { 'aria-hidden': 'true' }), ta = el('textarea', { spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', 'aria-label': 'Code editor', wrap: 'off' });
  const code = el('div', { class: 'code' }, pre, ta), ed = el('div', { class: 'ed' }, gutter, code), diags = el('div', { class: 'diags', hidden: true }), foot = el('div', { class: 'ed-foot' });
  const pop = el('div', { class: 'menu comp', hidden: true }); code.append(pop);
  v.el.append(bar, ed, diags, foot);
  let cur = null, saveT = 0, synT = 0, errLines = new Set(), lastText = '', syn = null;
  const lineH = 18;
  const diagsFor = () => (ED.diags.get(ED.active) || []).concat(syn && cur ? [{ line: syn.line, msg: syn.msg, sev: 'err', syntax: true }] : []);
  function paintTabs() {
    tabs.innerHTML = '';
    for (const p of ED.open) { const dirty = vfs.modified(p) || vfs.isNew(p); tabs.append(el('div', { class: 'ftab' + (p === ED.active ? ' on' : ''), role: 'tab', 'aria-selected': p === ED.active ? 'true' : 'false' }, el('button', { title: p, onclick: () => { ED.active = p; saveEd(); IDE.emit('editor'); } }, p.split('/').pop() + (dirty ? ' •' : '')), el('button', { class: 'x', 'aria-label': 'Close ' + p, text: '×', onclick: () => IDE.closeFile(p) }))); }
  }
  function load(path) {
    flush(); cur = path; const t = vfs.read(path); ta.value = t == null ? '' : t; lastText = ta.value; syn = null; paint(); const pos = ED.pos.get(path); if (pos) { ta.scrollTop = pos.top; ta.scrollLeft = pos.left; syncScroll(); }
    runBtn.textContent = path === 'main.js' ? 'Run main' : 'Run'; restartBtn.hidden = path === 'main.js'; runBtn.disabled = !/\.js$/.test(path); checkSyntax();
  }
  function paint() {
    const text = ta.value, isJs = /\.js$/.test(cur || ''), lines = text.split('\n'), dg = diagsFor(); errLines = new Set(dg.filter((d) => d.line).map((d) => d.line));
    const html = isJs ? IDE.highlight(text).split('\n') : lines.map(esc);
    pre.innerHTML = html.map((h, i) => `<div${errLines.has(i + 1) ? ' class="ln-err"' : ''}>${h || '&#8203;'}</div>`).join('');
    gutterIn.innerHTML = lines.map((_, i) => `<div${errLines.has(i + 1) ? ' class="err"' : ''}>${i + 1}</div>`).join('');
    paintFoot(); paintDiags();
  }
  function syncScroll() { pre.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`; gutterIn.style.transform = `translateY(${-ta.scrollTop}px)`; if (!pop.hidden) pop.hidden = true; }
  function caret() { const i = ta.selectionStart, before = ta.value.slice(0, i), line = before.split('\n').length, col = i - before.lastIndexOf('\n'); return { i, line, col }; }
  function paintFoot() {
    const c = caret(), dg = diagsFor(); foot.innerHTML = '';
    foot.append(el('span', {}, 'Ln ', el('b', { text: c.line }), ', col ', el('b', { text: c.col })), el('span', { text: cur === 'main.js' ? 'Ctrl+Enter reloads the whole session' : 'Ctrl+Enter runs · selection runs alone' }), el('span', { class: 'sp' }));
    foot.append(dg.length ? el('span', { class: 'bad', text: dg.length + (dg.length > 1 ? ' problems' : ' problem') }) : el('span', { text: vfs.modified(cur) ? 'edited' : vfs.isNew(cur) ? 'new file' : 'built-in' }));
  }
  function paintDiags() {
    const dg = diagsFor(); diags.hidden = !dg.length; diags.innerHTML = '';
    for (const d of dg.slice(0, 20)) diags.append(el('button', { class: 'diag bad', onclick: () => goto(d.line) }, el('b', { text: '✗' }), el('span', { class: 'ln', text: d.line ? 'line ' + d.line : '' }), el('span', { text: d.msg })));
  }
  function goto(line) { if (!line) return; const lines = ta.value.split('\n'); let off = 0; for (let i = 0; i < line - 1 && i < lines.length; i++) off += lines[i].length + 1; ta.focus(); ta.setSelectionRange(off, off + (lines[line - 1] || '').length); ta.scrollTop = Math.max(0, (line - 4) * lineH); syncScroll(); paintFoot(); }
  function flush() { if (saveT) { clearTimeout(saveT); saveT = 0; } if (cur && ta.value !== (vfs.read(cur) || '') && vfs.exists(cur)) { vfs.write(cur, ta.value); } if (cur) ED.pos.set(cur, { top: ta.scrollTop, left: ta.scrollLeft }); }
  function checkSyntax() { clearTimeout(synT); synT = setTimeout(() => { if (!/\.js$/.test(cur || '')) { syn = null; return; } const s = IDE.syntaxCheck(ta.value); const changed = JSON.stringify(s) !== JSON.stringify(syn); syn = s; if (changed) paint(); }, 350); }
  function onInput() { if (ta.value === lastText) return; lastText = ta.value; ED.diags.delete(cur); paint(); clearTimeout(saveT); saveT = setTimeout(() => { if (cur) vfs.write(cur, ta.value); }, 300); checkSyntax(); }
  async function run() {
    flush(); if (!/\.js$/.test(cur)) return; const a = ta.selectionStart, b = ta.selectionEnd;
    if (b > a) { const text = ta.value.slice(a, b); const line0 = ta.value.slice(0, a).split('\n').length - 1; await IDE.runFile(cur, { code: text, line0 }); } else await IDE.runFile(cur);
  }
  v.run = run;
  /* editing helpers: insertText keeps the native undo stack */
  const ins = (text) => { ta.focus(); if (!document.execCommand('insertText', false, text)) ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end'); onInput(); };
  function lineRange() { const a = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1; let b = ta.value.indexOf('\n', ta.selectionEnd); if (b < 0) b = ta.value.length; if (ta.selectionEnd > ta.selectionStart && ta.value[ta.selectionEnd - 1] === '\n') b = ta.selectionEnd - 1; return [a, b]; }
  function replaceRange(a, b, text, selA, selB) { ta.focus(); ta.setSelectionRange(a, b); if (!document.execCommand('insertText', false, text)) ta.setRangeText(text, a, b, 'end'); ta.setSelectionRange(selA, selB); onInput(); }
  function indentSel(out) {
    const [a, b] = lineRange(), block = ta.value.slice(a, b), ls = block.split('\n'), s0 = ta.selectionStart, e0 = ta.selectionEnd; let dFirst = 0, dAll = 0;
    const nl = ls.map((l, i) => { if (out) { const m = /^( {1,2}|\t)/.exec(l); if (!m) return l; if (i === 0) dFirst = -m[0].length; dAll -= m[0].length; return l.slice(m[0].length); } if (i === 0) dFirst = 2; dAll += 2; return '  ' + l; });
    replaceRange(a, b, nl.join('\n'), Math.max(a, s0 + dFirst), e0 + dAll);
  }
  function toggleComment() {
    const [a, b] = lineRange(), ls = ta.value.slice(a, b).split('\n'), all = ls.every((l) => !l.trim() || /^\s*\/\//.test(l)), s0 = ta.selectionStart, e0 = ta.selectionEnd; let d = 0;
    const nl = ls.map((l) => { if (!l.trim()) return l; if (all) { const m = /^(\s*)\/\/ ?/.exec(l); d -= l.length - l.replace(/^(\s*)\/\/ ?/, '$1').length; return l.replace(/^(\s*)\/\/ ?/, '$1'); } d += 3; return l.replace(/^(\s*)/, '$1// '); });
    replaceRange(a, b, nl.join('\n'), s0, e0 + d);
  }
  function enter(e) {
    const i = ta.selectionStart; if (ta.selectionEnd !== i) return; const before = ta.value.slice(0, i), ls = before.lastIndexOf('\n') + 1, line = before.slice(ls), ind = /^\s*/.exec(line)[0], prev = line.trimEnd().slice(-1), next = ta.value[i];
    e.preventDefault();
    if ('{(['.includes(prev) && ((prev === '{' && next === '}') || (prev === '(' && next === ')') || (prev === '[' && next === ']'))) { ta.focus(); const t = '\n' + ind + '  \n' + ind; if (!document.execCommand('insertText', false, t)) ta.setRangeText(t, i, i, 'end'); ta.setSelectionRange(i + 1 + ind.length + 2, i + 1 + ind.length + 2); onInput(); return; }
    ins('\n' + ind + ('{(['.includes(prev) || /=>\s*$/.test(line) ? '  ' : ''));
  }
  /* completion */
  let comp = null;
  function wordBefore() { const i = ta.selectionStart, b = ta.value.slice(0, i), m = /([\w$]*)$/.exec(b); return { word: m[1], start: i - m[1].length, before: b.slice(0, i - m[1].length), i }; }
  function showComp(force) {
    const { word, start, before } = wordBefore(); let list = null, kind = null;
    const q = /(["'`])([^"'`\n]*)$/.exec(ta.value.slice(0, ta.selectionStart));
    if (q) { const k = stringKind(ta.value.slice(0, ta.selectionStart - q[2].length - 1)); if (k) { list = IDE.vocab(k); const w = q[2]; comp = { start: ta.selectionStart - w.length, word: w }; list = list.filter((x) => x.toLowerCase().includes(w.toLowerCase()) && x !== w).slice(0, 14); kind = k; } }
    else {
      const m = /([\w$]+)\.$/.exec(before); if (m && WORDS[m[1]]) { list = WORDS[m[1]]().filter((x) => x.startsWith(word) && x !== word); comp = { start, word }; kind = m[1]; }
      else if (force && word) { const all = ['wb', 'ws', 'ctl', 'rig', 'bench', 'fragment', 'lens', 'op', 'p', 'units', 'log', 'show', 'table', 'sleep', 'const', 'await', 'async', 'function', 'return']; list = all.filter((x) => x.startsWith(word) && x !== word); comp = { start, word }; kind = 'name'; }
    }
    if (!list || !list.length) { pop.hidden = true; comp = null; return; }
    comp.list = list; comp.sel = 0; renderComp();
  }
  function renderComp() {
    pop.innerHTML = ''; comp.list.forEach((x, i) => pop.append(el('button', { class: i === comp.sel ? 'on' : '', onmousedown: (e) => { e.preventDefault(); accept(i); } }, el('span', { text: x }))));
    const c = ta.value.slice(0, comp.start).split('\n'), row = c.length - 1, col = c[c.length - 1].length; const cw = measureChar();
    pop.style.left = Math.min(code.clientWidth - 200, 12 + col * cw - ta.scrollLeft) + 'px'; pop.style.top = 10 + (row + 1) * lineH - ta.scrollTop + 'px'; pop.hidden = false;
  }
  let _cw = 0; function measureChar() { if (_cw) return _cw; const s = el('span', { text: 'xxxxxxxxxx', style: { font: '400 12px/18px var(--font-code)', position: 'absolute', visibility: 'hidden' } }); document.body.append(s); _cw = s.getBoundingClientRect().width / 10 || 7.2; s.remove(); return _cw; }
  function accept(i) { const x = comp.list[i], a = comp.start, b = ta.selectionStart; ta.setSelectionRange(a, b); ins(x); pop.hidden = true; comp = null; }
  ta.addEventListener('input', () => { onInput(); const ch = ta.value[ta.selectionStart - 1]; if (ch === '.' || ch === '"' || ch === "'" || (comp && !pop.hidden)) showComp(false); else pop.hidden = true; });
  ta.addEventListener('keyup', () => { const c = ta.selectionStart; if (ta.scrollLeft && (c === 0 || ta.value[c - 1] === '\n')) { ta.scrollLeft = 0; syncScroll(); } });
  ta.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!pop.hidden && comp) { if (e.key === 'ArrowDown') { e.preventDefault(); comp.sel = (comp.sel + 1) % comp.list.length; renderComp(); return; } if (e.key === 'ArrowUp') { e.preventDefault(); comp.sel = (comp.sel + comp.list.length - 1) % comp.list.length; renderComp(); return; } if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); accept(comp.sel); return; } if (e.key === 'Escape') { e.preventDefault(); pop.hidden = true; return; } }
    if (mod && e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) IDE.runMain(); else run(); return; }
    if (mod && e.key === ' ') { e.preventDefault(); showComp(true); return; }
    if (mod && e.key === '/') { e.preventDefault(); toggleComment(); return; }
    if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); flush(); IDE.toast('Saved ' + cur + ' in this browser'); return; }
    if (e.key === 'Tab') { e.preventDefault(); if (ta.selectionStart !== ta.selectionEnd && ta.value.slice(ta.selectionStart, ta.selectionEnd).includes('\n')) indentSel(e.shiftKey); else if (e.shiftKey) indentSel(true); else ins('  '); return; }
    if (e.key === 'Enter' && !mod && !e.shiftKey) { enter(e); return; }
  });
  ta.addEventListener('scroll', syncScroll); ta.addEventListener('keyup', paintFoot); ta.addEventListener('click', () => { paintFoot(); pop.hidden = true; }); ta.addEventListener('blur', () => { flush(); setTimeout(() => { pop.hidden = true; }, 120); });
  IDE.on('editor', () => { paintTabs(); if (cur !== ED.active) load(ED.active); });
  IDE.on('editor-reload', (p) => { if (p === cur) { cur = null; load(p); } paintTabs(); });
  IDE.on('diags', () => { if (cur) paint(); });
  IDE.on('goto', (g) => { if (g.path !== cur) { if (g.open !== false) { if (!ED.open.includes(g.path)) ED.open.push(g.path); ED.active = g.path; saveEd(); IDE.emit('editor'); } } setTimeout(() => goto(g.line), 20); });
  vfs.on(() => paintTabs());
  v.onShow = () => { paintTabs(); if (cur !== ED.active) load(ED.active); else paint(); };
  v.resize = () => syncScroll();
  paintTabs(); load(ED.active);
  v.flush = flush; IDE.codeView = v;
});

/* ---------- the Console view ---------- */
IDE.views.console = () => IDE.makeView((v) => {
  v.el.classList.add('v-console'); const con = IDE.con;
  const log = el('div', { class: 'conlog', role: 'log', 'aria-live': 'polite' });
  const filt = { all: true }; let only = 'all';
  const seg = el('div', { class: 'seg sm' }, ...[['all', 'All'], ['err', 'Problems']].map(([k, t]) => el('button', { text: t, 'aria-pressed': k === only ? 'true' : 'false', onclick: (e) => { only = k; $$('button', seg).forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); repaint(); } })));
  const tools = el('div', { class: 'toolbar' }, seg, el('span', { class: 'sp' }), el('button', { class: 'btn sm', text: 'Clear', onclick: () => IDE.clearConsole() }));
  const inp = el('textarea', { class: 'conin', rows: 1, placeholder: 'wb.set("camera.ev", 1)   ·   ws.describe()   ·   rig.eval("out")', spellcheck: 'false', 'aria-label': 'Console input' });
  const prompt = el('div', { class: 'conprompt' }, el('span', { text: '›' }), inp);
  v.el.append(tools, log, prompt);
  const mark = { in: '›', out: '←', err: '✗', warn: '⚠', info: '' };
  function lineEl(ln) {
    const row = el('div', { class: 'cl ' + ln.kind }, el('span', { class: 'mk', text: mark[ln.kind] || '' })), body = el('div', { class: 'cb' });
    for (const n of ln.nodes) body.append(n.nodeType ? n : document.createTextNode(String(n)));
    row.append(body);
    if (ln.file && ln.line) row.append(el('button', { class: 'cgo', text: ln.file + ':' + ln.line, onclick: () => IDE.emit('goto', { path: ln.file, line: ln.line, open: true }) }));
    return row;
  }
  function repaint() { log.innerHTML = ''; for (const ln of con.lines) if (only === 'all' || ln.kind === 'err' || ln.kind === 'warn') log.append(lineEl(ln)); log.scrollTop = log.scrollHeight; }
  IDE.on('console', (ln) => {
    if (!ln) { repaint(); return; }
    const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
    if (only === 'all' || ln.kind === 'err' || ln.kind === 'warn') log.append(lineEl(ln));
    while (log.childElementCount > con.max) log.firstChild.remove();
    if (stick) requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  });
  let hi = -1;
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); const t = inp.value; inp.value = ''; hi = -1; grow(); IDE.repl(t); return; }
    if (e.key === 'ArrowUp' && (!inp.value.includes('\n') || inp.selectionStart === 0)) { if (con.hist.length) { e.preventDefault(); hi = hi < 0 ? con.hist.length - 1 : Math.max(0, hi - 1); inp.value = con.hist[hi]; grow(); } }
    if (e.key === 'ArrowDown' && hi >= 0) { e.preventDefault(); hi++; inp.value = hi >= con.hist.length ? ((hi = -1), '') : con.hist[hi]; grow(); }
  });
  const grow = () => { inp.style.height = 'auto'; inp.style.height = Math.min(120, inp.scrollHeight) + 'px'; };
  inp.addEventListener('input', grow);
  v.onShow = () => { repaint(); }; v.focusInput = () => inp.focus();
  repaint();
});
})();

/* Filmbench IDE — part 4: scheduler, the Workspace view (tile renderers) and the plots behind it. */
(function () {
'use strict';
const { el, $, $$, esc, clamp, idle, store } = IDE, V2 = window.V2, raw = V2.raw;
const S = IDE.session;

/* ---------- theme colours for drawn figures ---------- */
IDE.theme = function () { const cs = getComputedStyle(document.documentElement), g = (n) => cs.getPropertyValue(n).trim(); return { bg: g('--bg'), ink: g('--ink'), ink2: g('--ink-2'), rule: g('--rule'), accent: g('--accent'), hair: g('--hair'), fill: g('--fill') }; };

/* ---------- state key and the paint scheduler ---------- */
let kc = { rev: -1, key: '' };
IDE.stateKey = function () { const rb = S.rb; if (!rb) return 'none'; if (kc.rb === rb && kc.rev === rb.rev && kc.theme === IDE.state.theme) return kc.key; const key = rb.state.hash + '|' + Object.keys(rb._sceneRev).map((k) => k + rb._sceneRev[k]).join(',') + '|' + IDE.state.theme; kc = { rb, rev: rb.rev, key, theme: IDE.state.theme }; return key; };
IDE.dragging = false;
const sched = (IDE.sched = {
  dirty: false, running: false, views: new Set(), busy: 0,
  request() { this.dirty = true; if (!this.running) this.loop(); },
  async loop() {
    this.running = true; IDE.emit('busy', true);
    try {
      while (this.dirty) {
        this.dirty = false; await idle();
        for (const tv of [...this.views]) {
          if (this.dirty) break; if (!tv.visible || !tv.paint) continue;
          try { await tv.paint({ draft: IDE.dragging }); tv.err = null; } catch (e) { tv.fail(e); }
          await idle();
        }
      }
    } finally { this.running = false; IDE.emit('busy', false); }
  },
});
IDE.on('change', () => sched.request());
/* range sliders mark the picture "draft" while held */
document.addEventListener('pointerdown', (e) => { if (e.target && e.target.matches && e.target.matches('input[type=range], .ruler, .wheel, .fader')) { IDE.dragging = true; } }, true);
const endDrag = () => { if (IDE.dragging) { IDE.dragging = false; sched.request(); } };
document.addEventListener('pointerup', endDrag, true); document.addEventListener('pointercancel', endDrag, true);

/* ---------- little formatters ---------- */
const lastSeg = (p) => String(p || '').split('.').pop();
function valueLabel(path, v) {
  if (typeof v === 'string') { const rb = S.rb, st = rb && rb.stock(v); if (st) return st.name.replace(/^(Kodak|Fujifilm|Fuji|Ilford)\s+/, ''); return v; }
  if (typeof v === 'number') return String(+v.toFixed(3)); return String(v);
}
IDE.valueLabel = valueLabel;

/* ---------- plots ---------- */
const CHSTYLE = [{ dash: 'solid', mark: 'o' }, { dash: 'dash', mark: 's' }, { dash: 'dot', mark: '^' }];
function plotSvg(spec, w, h) {
  const T = IDE.theme(); return PLOTS.plot(Object.assign({ w: Math.max(240, w), h: Math.max(160, h), theme: T, left: 44, right: 12, top: 30, bottom: 32 }, spec));
}
function paintCurves(tv, rec, ws) {
  const d = ws.curvesData(rec), body = tv.body, w = body.clientWidth, h = body.clientHeight;
  const le = d.le, multi = d.series.length > 1, of = d.of || 'paper';
  const pick = (c, ch) => { const arr = of === 'film' ? c.film.norm : c.paper; if (!arr) return null; return le.map((_, k) => arr[k * 3 + ch]); };
  const series = []; let ymax = 0;
  d.series.forEach((s, si) => {
    const chans = multi ? [1] : [0, 1, 2];
    for (const ch of chans) {
      const ys = pick(s.curves, ch); if (!ys) continue; ymax = Math.max(ymax, ...ys);
      const sty = multi ? { dash: ['solid', 'dash', 'dot', 'dashdot', 'long'][si % 5], mark: ['o', 's', '^', '+', ''][si % 5] } : CHSTYLE[ch];
      series.push({ xs: le, ys, dash: sty.dash, mark: sty.mark, width: 1.4, label: multi ? s.label : ['R', 'G', 'B'][ch].replace(/./, (c) => (of === 'film' ? c : ['C', 'M', 'Y'][ch])), color: ch === 1 && !multi ? 'ink' : 'ink' });
    }
  });
  if (!series.length) { tv.msg(`No curves for "${of}" in this pipeline.`); return; }
  const lo = Math.min(...le), hi = Math.max(...le), xl = of === 'film' ? [Math.max(lo, -4), Math.min(hi, 1.5)] : [Math.max(lo, -2.5), Math.min(hi, 2.5)];
  tv.svg(plotSvg({ title: (of === 'film' ? 'Film characteristic' : 'Paper characteristic') + (multi ? ' · green channel' : ''), x: { lim: xl, label: 'log₁₀ exposure' }, y: { lim: [0, Math.max(0.5, Math.ceil(ymax * 5) / 5 + 0.1)], label: 'density' }, series }, w, h));
}
function paintHist(tv, rec, ws) {
  const d = ws.histData(rec), body = tv.body, w = body.clientWidth, h = body.clientHeight, bins = d.bins, xs = Array.from({ length: bins }, (_, i) => d.lo + ((i + 0.5) / bins) * (d.hi - d.lo));
  let mx = 1; for (const s of d.series) for (const v of s) if (v > mx) mx = v;
  const series = d.series.map((s, i) => ({ xs, ys: Array.from(s, (v) => v / mx), dash: d.series.length === 1 ? 'solid' : CHSTYLE[i].dash, width: 1.3, label: d.series.length === 1 ? d.channel : ['R', 'G', 'B'][i] }));
  const vlines = []; if (rec.spec.bands === 'zones' && d.channel === 'L*') { let prev = -1; for (let L = 0; L <= 100; L += 0.5) { const z = Math.round(V2.zoneOf(L)); if (z !== prev && prev >= 0) vlines.push({ x: L, dash: 'dot', label: String(z) }); prev = z; } }
  tv.svg(plotSvg({ title: 'Histogram · ' + (rec.spec.tap || 'out'), x: { lim: [d.lo, d.hi], label: d.channel === 'L*' ? 'L*' : d.space === 'srgb' ? 'encoded value' : d.space }, y: { lim: [0, 1.05], ticks: [0, 0.5, 1], fmt: (v) => (v ? Math.round(v * 100) + '%' : '0') }, series, vlines }, w, h));
}
function paintLine(tv, rec, ws) {
  const d = ws.lineData(rec), body = tv.body, w = body.clientWidth, h = body.clientHeight, num = d.pts.every((p) => typeof p[0] === 'number');
  const xs = d.pts.map((p, i) => (num ? p[0] : i)), ys = d.pts.map((p) => (Array.isArray(p[1]) ? p[1][0] : p[1]));
  const lo = Math.min(...xs), hi = Math.max(...xs), yl = [Math.min(...ys.filter(Number.isFinite)), Math.max(...ys.filter(Number.isFinite))]; const pad = (yl[1] - yl[0]) * 0.1 || 1;
  tv.svg(plotSvg({ title: lastSeg(d.axis) + ' →', x: Object.assign({ lim: [lo - (hi === lo ? 1 : 0), hi + (hi === lo ? 1 : 0)], label: d.axis }, num ? {} : { ticks: xs, fmt: (v) => valueLabel(d.axis, d.pts[Math.round(v)] && d.pts[Math.round(v)][0]) }), y: { lim: [yl[0] - pad, yl[1] + pad] }, series: [{ xs, ys, dash: 'solid', mark: 'o', width: 1.5 }] }, w, h));
}

IDE.paintPlot = function (tv, rec) {
  const ws = S.rb.ws, k = rec.kind;
  if (k === 'curves') paintCurves(tv, rec, ws); else if (k === 'hist') paintHist(tv, rec, ws); else if (k === 'line') paintLine(tv, rec, ws);
  else tv.msg('No plot for tile kind "' + k + '".');
};

/* ---------- the tile view ---------- */
function makeTileView(dockOwner, id) {
  const rb = S.rb, ws = rb.ws;
  const tv = IDE.makeView((tv) => {
    tv.el.classList.add('tv');
    tv.bar = el('div', { class: 'tbar' }); tv.body = el('div', { class: 'tbody' }); tv.codeBox = el('pre', { class: 'src tcode', hidden: true }); tv.foot = el('div', { class: 'tfoot', hidden: true });
    tv.el.append(tv.bar, tv.codeBox, tv.body, tv.foot);
  });
  tv.tileId = id; tv.key = ''; tv.showCode = false; tv.showProbes = true;
  const rec = () => S.rb && S.rb.ws.tiles.get(id);
  tv.msg = (t, cls) => { tv.body.innerHTML = ''; tv.body.append(el('p', { class: 'empty pad ' + (cls || ''), text: t })); };
  tv.svg = (s) => { tv.body.innerHTML = '<div class="plot">' + s + '</div>'; };
  tv.fail = (e) => { tv.err = e; tv.key = ''; tv.body.innerHTML = ''; tv.body.append(el('div', { class: 'fail' }, el('b', { text: 'This tile could not draw. ' }), el('span', { text: String(e && e.message || e) }))); };
  tv.paintBar = () => {
    const r = rec(); tv.bar.innerHTML = ''; if (!r) return;
    tv.bar.append(el('span', { class: 'tref', text: r.ref() || r.kind }));
    for (const [k, v] of Object.entries(r.scope || {})) tv.bar.append(el('span', { class: 'tchip', title: k + ' = ' + JSON.stringify(v) }, el('i', { text: lastSeg(k) }), document.createTextNode(' ' + valueLabel(k, v))));
    if (r.match) tv.bar.append(el('span', { class: 'tchip', text: 'match ' + r.match }));
    if (r.crop) tv.bar.append(el('span', { class: 'tchip', text: 'crop ' + (typeof r.crop === 'string' ? r.crop : 'rect') }));
    for (const l of r.lenses) tv.bar.append(el('button', { class: 'tchip btnlike' + (l.off ? '' : ' on'), title: l.off ? 'Lens off. Click to turn it on.' : 'Lens on. Click to turn it off.', onclick: () => { withBy(() => S.rb.apply({ op: 'lens.off', tile: id, name: l.name, off: !l.off }, 'user')); } }, 'lens ' + l.name));
    tv.bar.append(el('span', { class: 'sp' }));
    if (r.ephemeral) tv.bar.append(el('span', { class: 'tchip', text: 'by agent' }), el('button', { class: 'btn sm', text: 'Keep', onclick: () => withBy(() => S.rb.ws.keep(id)) }), el('button', { class: 'btn sm', text: 'Drop', onclick: () => withBy(() => S.rb.ws.drop(id)) }));
    if (r.kind === 'render') tv.bar.append(el('button', { class: 'tchip btnlike' + (tv.showProbes ? ' on' : ''), title: 'Show the probes', text: 'probes', onclick: () => { tv.showProbes = !tv.showProbes; tv.key = ''; tv.paintBar(); sched.request(); } }));
    tv.bar.append(el('button', { class: 'tchip btnlike' + (tv.showCode ? ' on' : ''), title: 'Show the script that made this tile', text: '{ }', 'aria-label': 'Show the code of this tile', onclick: () => { tv.showCode = !tv.showCode; tv.paintCode(); } }));
  };
  tv.paintCode = () => { const r = rec(); tv.codeBox.hidden = !tv.showCode || !r; if (r) tv.codeBox.innerHTML = IDE.highlight(r.code || `// tile "${id}" has no recorded code`); };
  tv.update = () => { tv.paintBar(); tv.paintCode(); tv.key = ''; sched.request(); };
  tv.onShow = () => { sched.views.add(tv); tv.update(); }; tv.onHide = () => { };
  tv.resize = () => { clearTimeout(tv._rt); tv._rt = setTimeout(() => { tv.key = ''; sched.request(); }, 120); };
  tv.ro = new ResizeObserver(() => { if (tv.visible) tv.resize(); }); tv.ro.observe(tv.body);
  let lastStamp = '';
  tv.paint = async (o) => {
    const r = rec(); if (!r) { tv.msg('This tile no longer exists.'); return; }
    const w = tv.body.clientWidth, h = tv.body.clientHeight; if (!w || !h) return;
    const stamp = IDE.stateKey() + '|' + w + 'x' + h + '|' + (o.draft ? 'd' : 'f') + '|' + tv.showProbes;
    if (tv.key === stamp) return;
    if (tv.stamp !== IDE.stateKey()) { tv.paintBar(); tv.paintCode(); tv.stamp = IDE.stateKey(); }
    tv.foot.hidden = true; const net = ws.netFor ? ws.netFor(r) : null; const t0 = performance.now();
    const k = r.kind;
    if (o.draft && (k === 'curves' || k === 'hist' || k === 'line' || k === 'table' || k === 'parade')) { tv.body.classList.add('stale'); return; }
    tv.body.classList.remove('stale');
    if (k === 'render') await paintRender(tv, r, o);
    else if (k === 'mosaic') await paintMosaic(tv, r, o);
    else if (k === 'curves') paintCurves(tv, r, S.rb.ws);
    else if (k === 'hist') paintHist(tv, r, S.rb.ws);
    else if (k === 'line') paintLine(tv, r, S.rb.ws);
    else if (k === 'parade') { const img = S.rb.ws.paradeImg(r); tv.body.innerHTML = ''; const c = IDE.imgCanvas(img); c.className = 'tcanvas'; tv.body.append(c); }
    else if (k === 'table') paintTable(tv, r);
    else if (k === 'text') { tv.body.innerHTML = ''; tv.body.append(el('div', { class: 'md pad', html: IDE.md(r.spec.text || '') })); }
    else if (k === 'controls') { tv.body.innerHTML = ''; tv.body.append(IDE.controlsPanel(r.spec.scheme, { compact: true })); }
    else tv.msg(`No renderer for tile kind "${k}".`);
    tv.ms = Math.round(performance.now() - t0); if (!o.draft) tv.key = stamp;
  };
  return tv;
}
function withBy(fn) { const keep = V2.by; V2.by = 'user'; try { return fn(); } catch (e) { IDE.toast(String(e.message || e).split('\n')[0], true); IDE.print('err', e.message || String(e)); } finally { V2.by = keep; } }
IDE.withBy = withBy;

/* a picture tile: canvas + legends + probes */
async function paintRender(tv, rec, o) {
  const ws = S.rb.ws, w = tv.body.clientWidth, h = tv.body.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
  let max = Math.round(Math.min(960, Math.max(160, Math.max(w, h) * dpr))); if (o.draft) max = Math.min(max, 256);
  const r = ws.renderImg(rec, { max });
  if (r.placeholder) { tv.msg(`This tile reads "${r.missing}", which the pipeline does not have. It comes back with the pipeline.`, 'bad'); return; }
  let box = tv.body.querySelector('.rbox');
  if (!box) { tv.body.innerHTML = ''; box = el('div', { class: 'rbox' }, el('canvas', { class: 'tcanvas' }), el('div', { class: 'tlegend' })); tv.body.append(box); }
  const cv = $('canvas', box); IDE.drawImg(cv, r.img); tv.last = r;
  const img = r.img, s = Math.min(w / img.w, h / img.h), iw = img.w * s, ih = img.h * s, ox = (w - iw) / 2, oy = (h - ih) / 2;
  Object.assign(cv.style, { position: 'absolute', left: ox + 'px', top: oy + 'px', width: iw + 'px', height: ih + 'px' });
  const lg = $('.tlegend', box); lg.innerHTML = ''; for (const ov of r.overlays || []) if (ov && ov.legend) lg.append(el('span', { text: ov.legend }));
  if (o.draft) lg.append(el('span', { text: 'draft' }));
  $$('.plab', box).forEach((n) => n.remove()); const old = $('svg.probes', box); if (old) old.remove();
  if (tv.showProbes && !rec.crop && !rec.zoom && ws.probes.size) {
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'probes'); Object.assign(svg.style, { position: 'absolute', left: ox + 'px', top: oy + 'px', width: iw + 'px', height: ih + 'px' });
    svg.setAttribute('viewBox', '0 0 1 1'); svg.setAttribute('preserveAspectRatio', 'none');
    for (const [name, rc] of ws.probes) {
      const rect = document.createElementNS(NS, 'rect'); rect.setAttribute('x', rc[0]); rect.setAttribute('y', rc[1]); rect.setAttribute('width', rc[2]); rect.setAttribute('height', rc[3]); rect.setAttribute('vector-effect', 'non-scaling-stroke'); rect.setAttribute('class', 'probe'); svg.append(rect);
      box.append(el('button', { class: 'plab', text: name, style: { left: ox + rc[0] * iw + 'px', top: oy + rc[1] * ih + 'px' }, onclick: () => probeReadout(tv, name, rc) }));
    }
    box.append(svg);
  }
}
function probeReadout(tv, name, rc) {
  const r = tv.last; if (!r) return; const src = r.raw && r.raw.meta && r.raw.meta.space !== 'srgb' ? r.img : r.img; const c = src.crop(rc), lab = c.lab().mean ? c.lab().mean() : [0, 0, 0];
  tv.foot.hidden = false; tv.foot.innerHTML = ''; tv.foot.append(el('b', { text: name }), document.createTextNode(`  L* ${lab[0].toFixed(1)}  a* ${lab[1].toFixed(1)}  b* ${lab[2].toFixed(1)}   ${c.w}×${c.h} px`));
}

/* a grid of pictures */
async function paintMosaic(tv, rec, o) {
  const ws = S.rb.ws, g = ws.mosaicGrid(rec), cols = g.cols.length, rows = g.rows.length, body = tv.body;
  let grid = body.querySelector('.mgrid'); const sigStruct = [cols, rows, rec.id, g.colAxis.path, g.rowAxis.path].join('|');
  if (!grid || grid.dataset.sig !== sigStruct) {
    body.innerHTML = ''; grid = el('div', { class: 'mgrid', 'data-sig': sigStruct, style: { gridTemplateColumns: `minmax(46px, 12%) repeat(${cols}, minmax(0, 1fr))` } }); grid.append(el('div', { class: 'mcorner', text: lastSeg(g.rowAxis.path) + ' ↓  ' + lastSeg(g.colAxis.path) + ' →' }));
    g.cols.forEach((c) => grid.append(el('div', { class: 'mcol', text: valueLabel(g.colAxis.path, c), title: String(c) })));
    g.rows.forEach((r, ri) => { grid.append(el('div', { class: 'mrow', text: valueLabel(g.rowAxis.path, r), title: String(r) })); g.cols.forEach((c, ci) => { const cell = el('div', { class: 'mcell', 'data-c': ci, 'data-r': ri }, el('canvas'), el('span', { class: 'mq' })); cell.addEventListener('click', () => pick(tv, rec, g, ci, ri, cell)); grid.append(cell); }); });
    body.append(grid);
  }
  const t0 = performance.now(); let done = 0;
  for (const cell of g.cells) {
    if (sched.dirty && !o.once) { tv.partial = true; break; }
    const node = grid.querySelector(`.mcell[data-c="${cell.col}"][data-r="${cell.row}"]`); if (!node) continue;
    try { const r = ws.cellImg(rec, cell, { draft: o.draft }); const cv = $('canvas', node); IDE.drawImg(cv, r.img); node.classList.remove('bad'); node.title = ''; } catch (e) { node.classList.add('bad'); node.title = String(e.message || e); }
    done++; await idle();
  }
  if (done === g.cells.length) { tv.partial = false; }
  tv.foot.hidden = false; tv.foot.textContent = `${g.cells.length} cells · ${Math.round(performance.now() - t0)} ms${o.draft ? ' · draft' : ''}${tv.sel ? ' · ' + tv.sel : ''}`;
}
function pick(tv, rec, g, ci, ri, node) {
  $$('.mcell.sel', tv.body).forEach((n) => n.classList.remove('sel')); node.classList.add('sel');
  const cell = g.cells.find((c) => c.col === ci && c.row === ri); tv.sel = `${valueLabel(g.rowAxis.path, g.rows[ri])} × ${valueLabel(g.colAxis.path, g.cols[ci])}`; tv.foot.hidden = false; tv.foot.textContent = tv.sel;
  const hs = (rec.handlers && rec.handlers.pick) || []; for (const fn of hs) withBy(() => fn({ col: g.cols[ci], row: g.rows[ri], colValue: g.cols[ci], rowValue: g.rows[ri], scope: cell.scope, apply: () => S.rb.apply({ op: 'scope.set', tile: rec.id, scope: cell.scope }, 'user') }));
}
function paintTable(tv, rec) {
  const d = S.rb.ws.tableData(rec), t = el('table', { class: 'rt' }); t.append(el('thead', {}, el('tr', {}, el('th', { text: 'probe' }), ...d.cols.map((c) => el('th', { class: 'num', text: c })))));
  const tb = el('tbody'); for (const r of d.rows) tb.append(el('tr', {}, el('td', { class: 'nm', text: r.row }), ...r.vals.map((v) => el('td', { class: 'num', text: Number.isFinite(v) ? (+v.toFixed(2)).toString() : '—' })))); t.append(tb);
  tv.body.innerHTML = ''; tv.body.append(el('div', { class: 'pad' }, t));
}

/* ---------- the Workspace view ---------- */
IDE.views.workspace = () => IDE.makeView((v) => {
  v.el.classList.add('v-ws');
  const tools = el('div', { class: 'toolbar' }), host = el('div', { class: 'wsdock' }), empty = el('div', { class: 'picker', hidden: true });
  const layoutBtn = el('button', { class: 'btn sm', onclick: (e) => layoutMenu(e) }, 'Layout ▾'), addBtn = el('button', { class: 'btn sm', onclick: (e) => addMenu(e) }, 'Add tile ▾');
  const note = el('span', { class: 'note', text: '' }); const auditBtn = el('button', { class: 'btn sm bad', hidden: true });
  tools.append(layoutBtn, addBtn, el('span', { class: 'sp' }), auditBtn, note); v.el.append(tools, host, empty);
  let dock = null;
  function build() {
    if (dock) { for (const tv of dock.views.values()) { sched.views.delete(tv); if (tv.ro) tv.ro.disconnect(); } dock.ro.disconnect(); host.innerHTML = ''; }
    dock = new IDE.Dock({
      narrow: 520, keepEmpty: false,
      items: (id) => { const r = S.rb && S.rb.ws.tiles.get(id); if (!r) return null; return { title: id, about: r.ref().replace('← ', 'reads ') || r.kind, make: () => makeTileView(dock, id) }; },
      all: () => (S.rb ? [...S.rb.ws.tiles.keys()] : []),
      getTree: () => (S.rb ? S.rb.ws.dockTree : null),
      setTree: (t) => { withBy(() => S.rb.apply({ op: 'dock.set', tree: t }, 'user')); },
      badge: (id) => { const r = S.rb && S.rb.ws.tiles.get(id); return r && r.ephemeral ? { n: 'agent' } : null; },
    });
    host.append(dock.root); v.dock = dock; paint();
  }
  function paint() {
    const rb = S.rb; if (!rb) return; const has = rb.ws.tiles.size > 0;
    empty.hidden = has; host.hidden = !has;
    if (!has) { empty.innerHTML = ''; empty.append(el('p', { class: 'lead', text: 'The workspace has no tiles yet. Attach one in the console or in a script:' }), el('pre', { class: 'src', html: IDE.highlight("ws.tile('print').render('out')\nws.tile('curves').plot.curves('paper')") })); }
    const a = rb.ws.audit(); auditBtn.hidden = !a.dangling.length; if (a.dangling.length) { auditBtn.textContent = a.dangling.length + ' dangling'; auditBtn.title = a.dangling.map((d) => d.tile + ' ← ' + d.tap).join('\n'); }
    layoutBtn.firstChild.textContent = 'Layout · ' + rb.ws.layoutName + ' ▾'; note.textContent = rb.ws.tiles.size + ' tiles · ' + rb.ws.probes.size + ' probes';
    if (dock) dock.render();
  }
  function closeMenus() { $$('.menu', tools).forEach((m) => m.remove()); }
  function menuAt(anchor, items) {
    closeMenus(); const m = el('div', { class: 'menu', style: { left: anchor.offsetLeft + 'px', top: anchor.offsetTop + anchor.offsetHeight + 4 + 'px' } }); for (const it of items) m.append(it);
    tools.style.position = 'relative'; tools.append(m); setTimeout(() => { const off = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', off, true); } }; document.addEventListener('pointerdown', off, true); }, 0); return m;
  }
  function layoutMenu(e) {
    const ws = S.rb.ws; const items = ws.layout.list().map((n) => el('button', { class: n === ws.layoutName ? 'on' : '', onclick: () => { closeMenus(); withBy(() => ws.layout.use(n)); } }, el('span', { text: n })));
    if (!items.length) items.push(el('div', { class: 'grp', text: 'no layouts' })); menuAt(e.currentTarget, items);
  }
  function addMenu(e) {
    const rb = S.rb, net = rb.ws.net(), taps = net ? net.stages.map((s) => s.tap).filter(Boolean).concat(['src', 'out']).filter((x, i, a) => a.indexOf(x) === i) : ['out'];
    const mk = (title, fn) => el('button', { onclick: () => { closeMenus(); withBy(fn); } }, el('span', { text: title }));
    const uniq = (base) => { let n = base, i = 2; while (rb.ws.tiles.has(n)) n = base + ' ' + i++; return n; };
    const items = [el('div', { class: 'grp', text: 'pictures' }), ...taps.slice(0, 8).map((t) => mk('render ← ' + t, () => rb.ws.tile(uniq(t)).render(t))),
      el('div', { class: 'grp', text: 'plots' }), mk('histogram of out', () => rb.ws.tile(uniq('histogram')).hist('out', { bins: 64 })), mk('curves of paper', () => rb.ws.tile(uniq('paper curves')).plot.curves('paper')), mk('curves of film', () => rb.ws.tile(uniq('film curves')).plot.curves('film')), mk('RGB parade of out', () => rb.ws.tile(uniq('parade')).scope.parade('out')),
      el('div', { class: 'grp', text: 'controls' }), ...[...rb.ctl.schemeMap.keys()].map((s) => mk('controls · ' + s, () => rb.ws.tile(uniq(s)).controls(s)))];
    menuAt(e.currentTarget, items);
  }
  auditBtn.addEventListener('click', () => { IDE.print('log', S.rb.ws.audit()); IDE.focusView('console'); });
  v.onShow = () => { if (!dock) build(); paint(); };
  IDE.on('bench', () => { if (S.rb) build(); });
  IDE.on('change', () => { if (!S.rb) return; if (!dock) build(); else { paint(); for (const tv of dock.views.values()) tv.stale = true; } });
  IDE.on('focus-tile', (id) => { if (dock) dock.focus(id); });
  v.update = () => paint();
  v.resize = () => { if (dock) dock.onResize(); };
  if (S.rb) build();
});
})();

/* Filmbench IDE — part 5: controls (hairline sliders, tick-ruler dial, stepper, pad), Layers, presets. */
(function () {
'use strict';
const { el, $, $$, esc, clamp, store } = IDE, V2 = window.V2;
const S = IDE.session;

/* ---------- the hairline slider fill (see the slider spec) ---------- */
function fill(r) { const lo = +r.min || 0, hi = r.max === '' ? 100 : +r.max, span = hi - lo || 1; r.style.setProperty('--p', Math.max(0, Math.min(100, ((+r.value - lo) / span) * 100)).toFixed(2) + '%'); }
IDE.fill = fill;
document.addEventListener('input', (e) => { if (e.target && e.target.type === 'range') fill(e.target); }, true);

const dp = (st) => Math.max(0, Math.min(4, Math.ceil(-Math.log10(st || 0.01) - 1e-9)));
function byUser(fn) { return IDE.withBy(fn); }

/* ---------- widgets: each returns { el, set(value), get() } ---------- */
function sliderWidget(c, onInput) {
  const log = c.log && c.min > 0, min = c.min === undefined ? 0 : c.min, max = c.max === undefined ? 1 : c.max;
  const r = el('input', { type: 'range', class: 'hs', 'aria-label': c.labelText || c.id });
  if (log) { r.min = 0; r.max = 1000; r.step = 1; } else { r.min = min; r.max = max; r.step = c.stepV || (max - min) / 200; }
  const toVal = (pos) => (log ? min * Math.pow(max / min, pos / 1000) : +pos), toPos = (v) => (log ? (Math.log(Math.max(v, min) / min) / Math.log(max / min)) * 1000 : v);
  const wrap = el('div', { class: 'hswrap' }, r);
  for (const d of c.detentList || []) { const p = ((toPos(d) - +r.min) / (+r.max - +r.min)) * 100; wrap.append(el('i', { class: 'det', style: { left: `calc(${p}% )` }, title: String(d) })); }
  r.addEventListener('input', () => { let v = toVal(+r.value); if (!log && c.stepV) v = Math.round(v / c.stepV) * c.stepV; onInput(+v.toFixed(6), true); });
  r.addEventListener('change', () => { let v = toVal(+r.value); for (const d of c.detentList || []) if (Math.abs(v - d) <= (max - min) * 0.015) { v = d; r.value = toPos(d); fill(r); onInput(d, false); return; } });
  r.addEventListener('dblclick', () => c.reset());
  return { el: wrap, input: r, set(v) { if (document.activeElement !== r || !IDE.dragging) { r.value = toPos(+v); fill(r); } }, disable(d) { r.disabled = d; } };
}
/* the dial: a tick ruler under a fixed marker; drag sideways to turn it (no round shapes) */
function dialWidget(c, onInput) {
  const min = c.min === undefined ? 0 : c.min, max = c.max === undefined ? 1 : c.max, step = c.stepV || (max - min) / 100, PX = 5, ns = (() => { const raw = step * 8, e = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / e; return (f <= 1.5 ? 1 : f <= 3.5 ? 2 : f <= 7.5 ? 5 : 10) * e; })(); let val = min;
  const ruler = el('div', { class: 'ruler', tabindex: '0', role: 'slider', 'aria-valuemin': min, 'aria-valuemax': max, 'aria-label': c.labelText || c.id }), tk = el('div', { class: 'ticks' }), mark = el('i', { class: 'mark' });
  ruler.append(tk, mark);
  function paint() {
    ruler.setAttribute('aria-valuenow', val); const w = ruler.clientWidth || 200, half = w / 2, n = Math.ceil(w / PX) + 2, v0 = val / step; let h = '';
    for (let i = -Math.ceil(half / PX) - 1; i <= Math.ceil(half / PX) + 1; i++) { const idx = Math.round(v0) + i, x = half + (idx - v0) * PX, tv = idx * step; if (tv < min - 1e-9 || tv > max + 1e-9) continue; const major = Math.abs(tv / ns - Math.round(tv / ns)) < 1e-6, mid = Math.abs(tv / (ns / 2) - Math.round(tv / (ns / 2))) < 1e-6; h += `<i style="left:${x.toFixed(1)}px;height:${major ? 12 : mid ? 8 : 5}px"></i>`; if (major) h += `<b style="left:${x.toFixed(1)}px">${+tv.toFixed(dp(step))}</b>`; }
    tk.innerHTML = h;
  }
  let st = null;
  ruler.addEventListener('pointerdown', (e) => { st = { x: e.clientX, v: val }; ruler.setPointerCapture(e.pointerId); IDE.dragging = true; e.preventDefault(); });
  ruler.addEventListener('pointermove', (e) => { if (!st) return; const d = (st.x - e.clientX) / PX; let nv = clamp(Math.round(st.v / step + d) * step, min, max); nv = +nv.toFixed(6); if (nv !== val) { val = nv; paint(); onInput(val, true); } });
  const end = () => { if (st) { st = null; } }; ruler.addEventListener('pointerup', end); ruler.addEventListener('pointercancel', end);
  ruler.addEventListener('wheel', (e) => { e.preventDefault(); const nv = clamp(+(val + (e.deltaY > 0 ? -step : step)).toFixed(6), min, max); if (nv !== val) { val = nv; paint(); onInput(val, false); } }, { passive: false });
  ruler.addEventListener('keydown', (e) => { const k = e.key; if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'ArrowDown' && k !== 'ArrowUp') return; e.preventDefault(); const nv = clamp(+(val + (k === 'ArrowLeft' || k === 'ArrowDown' ? -step : step) * (e.shiftKey ? 10 : 1)).toFixed(6), min, max); val = nv; paint(); onInput(val, false); });
  ruler.addEventListener('dblclick', () => c.reset());
  new ResizeObserver(paint).observe(ruler);
  return { el: ruler, set(v) { val = +v; paint(); }, disable(d) { ruler.classList.toggle('dis', d); ruler.tabIndex = d ? -1 : 0; } };
}
function stepperWidget(c, onInput) {
  const min = c.min === undefined ? -Infinity : c.min, max = c.max === undefined ? Infinity : c.max, step = c.stepV || 1; let val = 0; const out = el('output', { class: 'stv' });
  const mk = (t, d) => el('button', { class: 'btn sm', text: t, 'aria-label': (d < 0 ? 'Decrease ' : 'Increase ') + (c.labelText || ''), onclick: () => { const nv = clamp(+(val + d * step).toFixed(6), min, max); if (nv !== val) { val = nv; out.textContent = c.format(val); onInput(val, false); } } });
  const box = el('div', { class: 'stepper' }, mk('−', -1), out, mk('+', 1));
  return { el: box, set(v) { val = +v; out.textContent = c.format(val); }, disable(d) { $$('button', box).forEach((b) => { b.disabled = d; }); } };
}
function toggleWidget(c, onInput) {
  let val = false; const b = el('button', { class: 'tog', role: 'switch', 'aria-checked': 'false', onclick: () => { val = !val; paint(); onInput(val, false); } }, el('span', { text: c.labelText || c.id }));
  const paint = () => { b.classList.toggle('on', !!val); b.setAttribute('aria-checked', String(!!val)); };
  return { el: b, set(v) { val = !!v; paint(); }, disable(d) { b.disabled = d; }, bare: true };
}
function optionsOf(c) {
  if (c.optList) return c.optList.map((o) => (Array.isArray(o) ? o : [o, o])); if (c.row && c.row.opts) return c.row.opts.map((o) => (Array.isArray(o) ? o : [o, o]));
  if (c.row && c.row.kind === 'id' && S.rb) return S.rb.stockIds(c.row.role).map((id) => [id, S.rb.stock(id).name]); return [];
}
function selectWidget(c, onInput) {
  const sel = el('select', { class: 'sel', 'aria-label': c.labelText || c.id }); const opts = optionsOf(c); for (const [v, t] of opts) sel.append(el('option', { value: String(v), text: t }));
  sel.addEventListener('change', () => { const o = opts.find(([v]) => String(v) === sel.value); onInput(o ? o[0] : sel.value, false); });
  return { el: sel, set(v) { sel.value = String(v); }, disable(d) { sel.disabled = d; } };
}
function segWidget(c, onInput) {
  const opts = optionsOf(c), box = el('div', { class: 'seg sm wrap' }); opts.forEach(([v, t]) => box.append(el('button', { 'data-v': String(v), text: t, onclick: () => onInput(v, false) })));
  return { el: box, set(v) { $$('button', box).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v)))); }, disable(d) { box.classList.toggle('dis', d); $$('button', box).forEach((b) => { b.disabled = d; }); } };
}
function choiceWidget(c, onInput) {
  const keys = Object.keys(c.choices || {}), box = el('div', { class: 'seg sm wrap' }); keys.forEach((k) => box.append(el('button', { 'data-v': k, text: k, onclick: () => onInput(k, false) })));
  return { el: box, set(v) { $$('button', box).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v)))); }, disable() { } };
}
/* a square pad for a two-axis control (colour balance); a square marker, no round shapes */
function padWidget(c, onInput) {
  const pad = el('div', { class: 'pad2d', tabindex: '0', role: 'application', 'aria-label': (c.labelText || c.id) + ' pad' }), dot = el('i', { class: 'pdot' }); pad.append(el('b', { class: 'cx' }), el('b', { class: 'cy' }), dot);
  let v = [0, 0], st = false; const put = () => { dot.style.left = ((v[0] + 1) / 2) * 100 + '%'; dot.style.top = ((1 - v[1]) / 2) * 100 + '%'; };
  const at = (e) => { const r = pad.getBoundingClientRect(); const x = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1), y = clamp(1 - ((e.clientY - r.top) / r.height) * 2, -1, 1); v = [+x.toFixed(3), +y.toFixed(3)]; put(); onInput(v, true); };
  pad.addEventListener('pointerdown', (e) => { st = true; pad.setPointerCapture(e.pointerId); IDE.dragging = true; at(e); }); pad.addEventListener('pointermove', (e) => { if (st) at(e); }); pad.addEventListener('pointerup', () => { st = false; }); pad.addEventListener('dblclick', () => { v = [0, 0]; put(); onInput(v, false); });
  pad.addEventListener('keydown', (e) => { const d = { ArrowLeft: [-0.05, 0], ArrowRight: [0.05, 0], ArrowUp: [0, 0.05], ArrowDown: [0, -0.05] }[e.key]; if (!d) return; e.preventDefault(); v = [clamp(+(v[0] + d[0]).toFixed(3), -1, 1), clamp(+(v[1] + d[1]).toFixed(3), -1, 1)]; put(); onInput(v, false); });
  return { el: pad, set(x) { if (Array.isArray(x)) { v = x; put(); } }, disable() { }, bare: false };
}

/* ---------- one control row ---------- */
function makeRow(c, opts) {
  opts = opts || {}; const kind = c.widgetName || c.kind;
  const row = el('div', { class: 'prow k-' + kind, 'data-id': c.id });
  const lab = el('label', { text: c.labelText || c.id }), out = el('output'), rst = el('button', { class: 'rst', title: 'Reset to the default (double-click the control also does)', 'aria-label': 'Reset ' + (c.labelText || c.id), text: '↺', onclick: () => byUser(() => c.reset()) }), why = el('button', { class: 'why', title: 'Why does it have this value?', 'aria-label': 'Explain ' + (c.labelText || c.id), text: '?' }), whyBox = el('pre', { class: 'src why-box', hidden: true });
  let w;
  const onInput = (v, live) => byUser(() => { c.set(v, 'user'); });
  if (kind === 'toggle' || (c.row && c.row.kind === 'bool' && kind === 'slider')) w = toggleWidget(c, onInput);
  else if (kind === 'dial') w = dialWidget(c, onInput); else if (kind === 'stepper') w = stepperWidget(c, onInput);
  else if (kind === 'select') w = selectWidget(c, onInput); else if (kind === 'segmented') w = segWidget(c, onInput); else if (kind === 'choice') w = choiceWidget(c, onInput); else if (kind === 'wheel') w = padWidget(c, (v) => byUser(() => c.set(v, 'user')));
  else if (kind === 'button') { w = { el: el('button', { class: 'btn sm', text: c.labelText || c.id, onclick: () => { if (c.opensName) { IDE.emit('focus-tile', c.opensName); IDE.focusView('workspace'); } else if (c.applyFn) byUser(() => c.applyFn({ wb: S.wb, ws: S.rb.ws, ctl: S.rb.ctl })); } }), set() {}, disable(d) { } , bare: true }; }
  else w = sliderWidget(c, onInput);
  const bare = w.bare;
  if (bare) { row.classList.add('bare'); row.append(w.el, rst, why, whyBox); } else { row.append(lab, out, rst, why, w.el, whyBox); }
  const unmet = (c.reqs || []).filter((r) => S.rb && S.rb.mainNet() && !S.rb.mainNet().capabilities().includes(r));
  why.addEventListener('click', () => {
    whyBox.hidden = !whyBox.hidden; if (whyBox.hidden) return;
    let t = ''; try { t = c.macro ? macroWhy(c.macro) : c.path ? String(S.rb.params.why(c.path)) : c.kind; } catch (e) { t = String(e.message || e); } whyBox.textContent = t;
  });
  function sync() {
    let v; try { v = c.get(); } catch (e) { v = undefined; }
    if (kind === 'wheel') v = c.wheelVal; w.set(v === undefined ? 0 : v); const d = c.disabled() || unmet.length > 0; w.disable(d);
    row.classList.toggle('dis', d); row.title = unmet.length ? `requires "${unmet[0]}", which the current engines do not provide` : '';
    const ch = c.changed; rst.hidden = !ch && kind !== 'wheel'; row.classList.toggle('changed', !!ch);
    if (kind !== 'button' && kind !== 'toggle' && kind !== 'wheel') out.textContent = typeof v === 'object' ? '' : (kind === 'select' || kind === 'segmented' || kind === 'choice') ? '' : c.format(v);
    if (!whyBox.hidden) { try { whyBox.textContent = c.macro ? macroWhy(c.macro) : c.path ? String(S.rb.params.why(c.path)) : ''; } catch (e) { /* ignore */ } }
  }
  return { el: row, sync, id: c.id };
}
function macroWhy(m) {
  const L = [`macro ${m.name}  range ${m.range[0]}…${m.range[1]}  now ${m.value}  rest ${m.rest}`];
  for (const d of m.drivesList) L.push(`  drives ${d.path}` + (d.gain !== undefined ? `  gain ${d.gain}` : '') + (d.map ? `  map ${JSON.stringify(d.map)}` : '') + (d.curve ? `  curve ${d.curve}` : ''));
  if (m.applyFn) L.push('  apply λ (' + m.applyPhase + ')'); if (m.readFn) L.push('  read λ: follows the parameters');
  if (m.shape) L.push('  shaped by calibration: ' + JSON.stringify(m.shape.map((p) => p.map((x) => +x.toFixed(2))))); return L.join('\n');
}

/* ---------- a panel of controls for a scheme ---------- */
IDE.controlsPanel = function (schemeName, o) {
  o = o || {}; const box = el('div', { class: 'ctlpanel' + (o.compact ? ' compact' : '') }); let rows = [], sig = '';
  function build() {
    const rb = S.rb; if (!rb) { box.textContent = ''; return; }
    const sch = schemeName ? (rb.ctl.schemeMap.get(schemeName) || null) : rb.ctl.current(); box.innerHTML = ''; rows = [];
    if (!sch) { const list = rb.ctl.list(); if (!list.length) box.append(el('p', { class: 'empty pad', text: 'No controls yet. Make one in a script: ctl.slider("camera.ev")' })); for (const c of list) { const r = makeRow(c, o); rows.push(r); box.append(r.el); } return; }
    for (const G of sch.groups) {
      if (!G.items.length) continue; const gh = el('div', { class: 'ghead', text: G.title }); box.append(gh);
      for (const c of G.items) { const r = makeRow(c, o); rows.push(r); box.append(r.el); }
    }
  }
  box.update = () => {
    const rb = S.rb; if (!rb) return; const sch = schemeName ? rb.ctl.schemeMap.get(schemeName) : rb.ctl.current(), cs = sch ? sch.controls() : rb.ctl.list();
    const s2 = (sch ? sch.name : '-') + '|' + cs.map((c) => c.id + ':' + c.widgetName + ':' + c.min + ':' + c.max + ':' + (c.macro ? c.macro.range : '')).join(',') + '|' + (sch ? sch.groups.map((g) => g.title).join('/') : '');
    if (s2 !== sig) { sig = s2; build(); } for (const r of rows) r.sync();
  };
  box.update(); return box;
};

/* ---------- the Controls view ---------- */
IDE.views.controls = () => IDE.makeView((v) => {
  v.el.classList.add('v-controls'); const tools = el('div', { class: 'toolbar' }), body = el('div', { class: 'scroll' }), seg = el('div', { class: 'seg sm wrap' });
  const auditBtn = el('button', { class: 'btn sm', text: 'Audit', title: 'Check that every mapped value is inside its range', onclick: () => { const sch = S.rb.ctl.current(); if (sch) { IDE.print('log', sch.audit()); IDE.focusView('console'); } } });
  tools.append(seg, el('span', { class: 'sp' }), auditBtn); v.el.append(tools, body);
  let panel = null, schemeSig = '';
  v.update = () => {
    const rb = S.rb; if (!rb) { body.innerHTML = ''; body.append(el('p', { class: 'empty pad', text: 'No session yet. Run main.js.' })); return; }
    const names = rb.ctl.schemes(), sig = names.join('|') + '#' + rb.ctl.active; tools.hidden = !names.length;
    if (sig !== schemeSig) { schemeSig = sig; seg.innerHTML = ''; names.forEach((n) => seg.append(el('button', { text: n, 'aria-pressed': String(n === rb.ctl.active), onclick: () => IDE.withBy(() => rb.apply({ op: 'ctl.use', scheme: n }, 'user')) }))); if (panel) { panel.remove(); panel = null; } }
    if (!panel) { panel = IDE.controlsPanel(null); body.innerHTML = ''; body.append(panel); } panel.update();
  };
  IDE.on('change', () => v.touch()); IDE.on('bench', () => { schemeSig = ''; panel = null; v.touch(); }); v.onShow = () => { };
});

/* ---------- Layers: mixer of the four layers, macros, looks and presets ---------- */
function opsPreview(ops) { const ks = Object.keys(ops || {}); return ks.slice(0, 3).map((k) => k + ' ' + (V2.opText ? V2.opText(ops[k]) : JSON.stringify(ops[k]))).join(' · ') + (ks.length > 3 ? ' · +' + (ks.length - 3) : ''); }
IDE.snapshotOps = function (changesOnly) {
  const rb = S.rb, ops = {}, get = (o, p) => String(p).split('.').reduce((a, k) => (a == null ? a : a[k]), o), def = FB.defaultParams(), st = (x) => JSON.stringify(x);
  for (const path of rb.table.paths()) { let cur; try { cur = rb.params.get(path); } catch (e) { continue; } if (cur === undefined || cur === null) continue; const d = get(def, path); if (changesOnly ? st(cur) !== st(d) : true) { if (typeof cur === 'object') continue; ops[path] = cur; } }
  return ops;
};
IDE.savePreset = async function () {
  const r = await IDE.ask({ title: 'Save the current look', note: 'Keeps every value that differs from the defaults, without the film and paper choice.', ok: 'Save', fields: [{ key: 'name', label: 'Name', value: 'My look' }, { key: 'desc', label: 'About it', value: '', placeholder: 'one line, optional', required: false }] }); if (!r) return; const name = r.name, desc = r.desc || '';
  const ops = IDE.snapshotOps(true); delete ops.film; delete ops.print;
  IDE.withBy(() => S.rb.apply({ op: 'preset.add', name, def: { desc, kind: 'look', ops } }, 'user')); IDE.toast('Saved "' + name + '" under Yours');
};
IDE.views.layers = () => IDE.makeView((v) => {
  v.el.classList.add('v-layers'); const body = el('div', { class: 'scroll' }); v.el.append(body); let openDesc = null;
  v.update = () => {
    const rb = S.rb; body.innerHTML = ''; if (!rb) { body.append(el('p', { class: 'empty pad', text: 'No session yet. Run main.js.' })); return; }
    const P = rb.params, LAYERS = V2.LAYERS;
    body.append(el('div', { class: 'ghead', text: 'Layers' }), el('p', { class: 'note pad', text: 'base → look → macros → agent → pin. Each layer folds over the one before it; opacity blends it in.' }));
    const mix = el('div', { class: 'mixer' });
    for (const name of LAYERS) {
      const L = P.layers[name], col = el('div', { class: 'strip' + (L.on ? '' : ' off') });
      const fader = el('input', { type: 'range', class: 'hs fader', min: 0, max: 1, step: 0.01, value: L.opacity, 'aria-label': name + ' opacity', 'aria-orientation': 'vertical', oninput: (e) => IDE.withBy(() => rb.apply({ op: 'layer.opacity', layer: name, value: +e.target.value }, 'user')) }); IDE.fill(fader);
      col.append(el('b', { text: name }), fader, el('output', { text: Math.round(L.opacity * 100) + '%' }), el('button', { class: 'tog' + (L.on ? ' on' : ''), text: L.on ? 'on' : 'off', onclick: () => IDE.withBy(() => rb.apply({ op: 'layer.on', layer: name, on: !L.on }, 'user')) }),
        el('small', { text: L.contrib.size ? [...L.contrib.keys()].slice(0, 2).join(', ') + (L.contrib.size > 2 ? ' +' + (L.contrib.size - 2) : '') : 'empty' }),
        el('span', { class: 'sact' }, el('button', { class: 'btn sm', text: 'Clear', disabled: !L.contrib.size, onclick: () => IDE.withBy(() => rb.apply({ op: 'layer.clear', layer: name }, 'user')) }), el('button', { class: 'btn sm', text: 'Bake', title: 'Fold this layer into the base values', disabled: !L.contrib.size, onclick: () => IDE.withBy(() => rb.apply({ op: 'layer.bake', layer: name }, 'user')) })));
      mix.append(col);
    }
    body.append(mix);
    const ms = Object.values(rb.macros); if (ms.length) {
      body.append(el('div', { class: 'ghead', text: 'Macros' })); const pn = el('div', { class: 'ctlpanel compact' });
      for (const m of ms) { const c = rb.ctl.list().find((x) => x.macro === m) || new V2.Control(rb, 'slider', m); const r = makeRow(c, {}); pn.append(r.el); r.sync(); } body.append(pn);
    }
    const presets = [...rb.presets.values()], looks = presets.filter((p) => p.kind === 'look' && !p.user), adjusts = presets.filter((p) => p.kind !== 'look' && !p.user), yours = presets.filter((p) => p.user);
    const cur = P.layers.look.preset;
    const group = (title, list, mode) => {
      body.append(el('div', { class: 'ghead' }, el('span', { text: title }), el('small', { text: String(list.length) })));
      if (!list.length) { body.append(el('p', { class: 'note pad', text: mode === 'yours' ? 'Nothing saved yet. Press Save current look… to keep what the workbench shows now.' : 'none' })); return; }
      for (const p of list) {
        const stacked = P.layers.look.contrib.has(p.name) && p.kind !== 'look'; const on = p.kind === 'look' ? cur === p.name : stacked;
        const row = el('div', { class: 'prs' + (on ? ' on' : '') }, el('button', { class: 'pname', title: p.desc, onclick: () => IDE.withBy(() => { if (p.kind === 'look' || mode === 'yours') rb.apply({ op: 'layer.use', layer: 'look', preset: p.name }, 'user'); else rb.apply({ op: 'layer.stack', layer: 'look', preset: p.name, on: !stacked }, 'user'); }) }, el('b', { text: p.name }), el('small', { text: p.desc || opsPreview(p.ops) })),
          el('button', { class: 'x', title: 'Show what it sets', 'aria-label': 'Show what ' + p.name + ' sets', text: 'ⓘ', onclick: () => { openDesc = openDesc === p.name ? null : p.name; v.update(); } }),
          p.user ? el('button', { class: 'x', title: 'Delete', 'aria-label': 'Delete ' + p.name, text: '×', onclick: async () => { if (await IDE.confirm('Delete the preset "' + p.name + '"?')) IDE.withBy(() => rb.apply({ op: 'preset.remove', name: p.name }, 'user')); } }) : null);
        body.append(row); if (openDesc === p.name) body.append(el('pre', { class: 'src why-box', text: Object.keys(p.ops).map((k) => `${k.padEnd(28)} ${V2.opText ? V2.opText(p.ops[k]) : JSON.stringify(p.ops[k])}`).join('\n') || '(no values)' }));
      }
    };
    body.append(el('div', { class: 'toolbar' }, el('button', { class: 'btn sm primary', text: 'Save current look…', onclick: () => IDE.savePreset() }), el('button', { class: 'btn sm', text: 'Clear the look', disabled: !cur, onclick: () => IDE.withBy(() => rb.apply({ op: 'layer.clear', layer: 'look' }, 'user')) })));
    group('Looks', looks, 'looks'); group('Adjustments', adjusts, 'adjust'); group('Yours', yours, 'yours');
  };
  IDE.on('change', () => v.touch()); IDE.on('bench', () => v.touch());
});

/* user presets survive reloads */
let presetSig = '';
function persistPresets() {
  const rb = S.rb; if (!rb) return; const user = [...rb.presets.values()].filter((p) => p.user).map((p) => p.toJSON()); const sig = JSON.stringify(user); if (sig === presetSig) return; presetSig = sig; IDE.store.set('presets', user);
}
IDE.on('change', persistPresets);
IDE.on('bench', () => {
  const rb = S.rb; if (!rb) return; const saved = IDE.store.get('presets', []); let n = 0;
  for (const d of saved) if (!rb.presets.has(d.name)) { try { rb.presets.set(d.name, new V2.Preset(rb, d.name, Object.assign({}, d, { user: true }))); n++; } catch (e) { /* skip bad preset */ } }
  presetSig = JSON.stringify([...rb.presets.values()].filter((p) => p.user).map((p) => p.toJSON())); if (n) rb._touch();
});
})();

/* Filmbench IDE — part 6: Graph (net + inspector), History (mutation log, undo, script), Reference. */
(function () {
'use strict';
const { el, $, $$, esc, clamp, vfs, store } = IDE, V2 = window.V2, raw = V2.raw;
const S = IDE.session;
const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs, ...kids) => { const e = document.createElementNS(NS, tag); for (const k of Object.keys(attrs || {})) e.setAttribute(k, attrs[k]); for (const c of kids) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c))); return e; };

/* ---------- Graph ---------- */
IDE.views.graph = () => IDE.makeView((v) => {
  v.el.classList.add('v-graph'); const tools = el('div', { class: 'toolbar' }), pipeSeg = el('div', { class: 'seg sm wrap' }), irBtn = el('button', { class: 'btn sm', text: 'DOT', title: 'Copy the pipeline as Graphviz DOT', onclick: () => { try { navigator.clipboard.writeText(net().toDot()); IDE.toast('DOT copied'); } catch (e) { IDE.print('log', net().toDot()); IDE.focusView('console'); } } });
  tools.append(pipeSeg, el('span', { class: 'sp' }), irBtn);
  const wrap = el('div', { class: 'scroll gwrap' }), stage = el('div', { class: 'gstage' }), insp = el('div', { class: 'ginsp' }); wrap.append(stage, insp); v.el.append(tools, wrap);
  let sel = null, pipeName = null;
  const net = () => { const rb = S.rb; if (!rb) return null; return (pipeName && rb.pipes.get(pipeName)) || rb.mainNet(); };
  function layout(n, vertical) {
    const nodes = n.nodes(), edges = n.edges(), depth = {}; nodes.forEach((x) => { depth[x.id] = 0; });
    for (let it = 0; it < nodes.length; it++) for (const [a, b] of edges) depth[b] = Math.max(depth[b], depth[a] + 1);
    const cols = {}; nodes.forEach((x) => { (cols[depth[x.id]] = cols[depth[x.id]] || []).push(x); });
    const NW = 132, NH = 50, GX = 36, GY = 26, pos = {};
    Object.keys(cols).forEach((d) => cols[d].forEach((x, i) => { pos[x.id] = vertical ? { x: i * (NW + GX), y: d * (NH + GY) } : { x: d * (NW + GX), y: i * (NH + GY) }; }));
    const W = Math.max(...Object.values(pos).map((p) => p.x)) + NW, H = Math.max(...Object.values(pos).map((p) => p.y)) + NH;
    return { nodes, edges, pos, NW, NH, W, H };
  }
  function drawGraph(n) {
    const w = wrap.clientWidth || 400, vertical = w < 560, L = layout(n, vertical), pad = 14;
    const svg = sv('svg', { class: 'gsvg', viewBox: `${-pad} ${-pad} ${L.W + 2 * pad} ${L.H + 2 * pad}`, width: Math.min(L.W + 2 * pad, w - 4), role: 'img', 'aria-label': 'Pipeline graph' });
    svg.append(sv('defs', {}, sv('marker', { id: 'ar', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, sv('path', { d: 'M0 0L8 4L0 8Z', class: 'garrow' }))));
    for (const [a, b, k] of L.edges) {
      const pa = L.pos[a], pb = L.pos[b]; if (!pa || !pb) continue; const x1 = vertical ? pa.x + L.NW / 2 : pa.x + L.NW, y1 = vertical ? pa.y + L.NH : pa.y + L.NH / 2, x2 = vertical ? pb.x + L.NW / 2 : pb.x, y2 = vertical ? pb.y : pb.y + L.NH / 2;
      const c = vertical ? `M${x1} ${y1} C${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}` : `M${x1} ${y1} C${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`;
      svg.append(sv('path', { d: c, class: 'gedge' + (k === 'through' ? ' thru' : ''), 'marker-end': 'url(#ar)' }));
      if (k === 'through') svg.append(sv('text', { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 4, class: 'gel', 'text-anchor': 'middle' }, 'through'));
    }
    for (const nd of L.nodes) {
      const p = L.pos[nd.id], st = n.stage(nd.stages[0]), g = sv('g', { class: 'gnode' + (sel === nd.id ? ' sel' : '') + (nd.kind === 'mask' ? ' mask' : '') + (st && st.kind === 'custom' ? ' custom' : ''), transform: `translate(${p.x} ${p.y})`, tabindex: '0', role: 'button', 'aria-label': 'Node ' + nd.id });
      g.append(sv('rect', { width: L.NW, height: L.NH }), sv('text', { x: 10, y: 20 }, nd.id), sv('text', { x: 10, y: 37, class: 's' }, (st ? st.tap + ' · ' + st.type : nd.kind)));
      const ms = S.rb.stats.ms[nd.stages[nd.stages.length - 1]]; if (ms !== undefined) g.append(sv('text', { x: L.NW - 8, y: 20, class: 's', 'text-anchor': 'end' }, (ms < 10 ? ms.toFixed(1) : Math.round(ms)) + ' ms'));
      const pick = () => { sel = nd.id; v.update(); }; g.addEventListener('click', pick); g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } }); svg.append(g);
    }
    stage.innerHTML = ''; stage.append(svg);
  }
  function inspector(n) {
    const rb = S.rb; insp.innerHTML = '';
    const blk = (title, ...kids) => { const b = el('section', { class: 'block' }, el('h4', { text: title }), ...kids); insp.append(b); return b; };
    blk('Pipeline', el('dl', { class: 'kv' }, el('dt', { text: 'name' }), el('dd', { text: n.name }), el('dt', { text: 'stages' }), el('dd', { text: String(n.stages.length) }), el('dt', { text: 'hash' }), el('dd', { text: V2.short ? V2.short(n.hashIR()) : String(n.hashIR()).slice(0, 8) }), el('dt', { text: 'capabilities' }), el('dd', { text: n.capabilities().join(' · ') })));
    const ex = n.explain(); const eng = el('div', { class: 'engrid' });
    for (const [slot, opts] of [['film', ['auto', ...(n.slots.film || [])]], ['paper', n.slots.paper || []], ['scan', n.slots.scan || []]]) {
      const cur = slot === 'film' ? n.engines.film : n.engines[slot], sel = el('select', { class: 'sel', 'aria-label': slot + ' engine', onchange: () => IDE.withBy(() => rb.apply({ op: 'pipe.swap', pipe: n.name, slot, engine: sel.value }, 'user')) }); opts.forEach((o) => sel.append(el('option', { value: o, text: o }))); sel.value = cur;
      eng.append(el('label', { text: slot }), sel, el('small', { text: ex[slot] ? ex[slot].why : '' }));
    }
    blk('Engines', eng);
    const scenes = Object.keys(rb.scenes), curScene = (n.stage('scene') || { opts: {} }).opts.scene, file = el('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => { const f = file.files[0]; file.value = ''; if (f) IDE.usePicture(f); } });
    const ssel = el('select', { class: 'sel', 'aria-label': 'Scene', onchange: () => IDE.withBy(() => rb.apply({ op: 'pipe.scene', pipe: n.name, scene: ssel.value }, 'user')) }); scenes.forEach((s) => ssel.append(el('option', { value: s, text: (rb.scenes[s] && rb.scenes[s].name) || s }))); ssel.value = curScene;
    blk('Picture', el('div', { class: 'row' }, ssel, el('button', { class: 'btn sm', text: 'Use a picture…', onclick: () => file.click() }), file), el('p', { class: 'note', text: 'Paste or drop a picture on the workspace to use it as the scene. It is treated as sRGB.' }));
    if (sel) {
      let nd; try { nd = n.node(sel); } catch (e) { nd = null; }
      if (nd) {
        const st = n.stage(nd.stages[0]), tapRows = nd.stages.map((id) => { const s = n.stage(id); return el('tr', {}, el('td', { class: 'nm', text: s.tap }), el('td', { text: s.type }), el('td', { class: 'num', text: rb.stats.ms[id] !== undefined ? Math.round(rb.stats.ms[id]) + ' ms' : '' })); });
        blk('Node ' + nd.id, el('dl', { class: 'kv' }, el('dt', { text: 'kind' }), el('dd', { text: nd.kind }), el('dt', { text: 'inputs' }), el('dd', { text: nd.inputs.join(', ') || 'none' }), st && st.mask ? el('dt', { text: 'through' }) : null, st && st.mask ? el('dd', { text: st.mask }) : null),
          el('table', { class: 'rt' }, el('thead', {}, el('tr', {}, el('th', { text: 'tap' }), el('th', { text: 'type' }), el('th', { class: 'num', text: 'last run' }))), el('tbody', {}, ...tapRows)),
          nd.source ? el('pre', { class: 'src', html: IDE.highlight(nd.source) }) : el('p', { class: 'note', text: 'A built-in stage: it runs the film engine, not a λ.' }),
          Object.keys(nd.opts || {}).length ? el('p', { class: 'note', text: 'options ' + JSON.stringify(nd.opts) }) : null);
      }
    } else blk('Node', el('p', { class: 'note', text: 'Select a node to see its taps, its inputs and the code of a custom stage.' }));
  }
  v.update = () => {
    const rb = S.rb; if (!rb) { stage.innerHTML = ''; insp.innerHTML = ''; stage.append(el('p', { class: 'empty pad', text: 'No session yet.' })); return; }
    const names = [...rb.pipes.keys()]; if (!pipeName || !rb.pipes.has(pipeName)) pipeName = (rb.mainNet() || {}).name;
    pipeSeg.innerHTML = ''; names.forEach((nm) => pipeSeg.append(el('button', { text: nm, 'aria-pressed': String(nm === pipeName), onclick: () => { pipeName = nm; sel = null; v.update(); } }))); pipeSeg.hidden = names.length < 2;
    const n = net(); if (!n || !n.stages.length) { stage.innerHTML = ''; insp.innerHTML = ''; stage.append(el('p', { class: 'empty pad', text: 'This pipeline has no stages.' })); return; }
    drawGraph(n); inspector(n);
  };
  IDE.on('change', () => v.touch()); IDE.on('bench', () => { pipeName = null; sel = null; v.touch(); }); v.resize = () => v.touch();
});

/* use a picture as the scene */
IDE.usePicture = async function (file) {
  const rb = S.rb; if (!rb) return;
  try {
    const bmp = await createImageBitmap(file), k = Math.min(1, 1100 / Math.max(bmp.width, bmp.height)), w = Math.max(2, Math.round(bmp.width * k)), h = Math.max(2, Math.round(bmp.height * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0, w, h); if (bmp.close) bmp.close(); const px = x.getImageData(0, 0, w, h).data, lin = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i++) for (let j = 0; j < 3; j++) lin[i * 3 + j] = FB.srgbDecode(px[i * 4 + j] / 255);
    const name = (file.name || 'pasted picture').replace(/^image\.(png|jpe?g|webp|gif)$/i, 'pasted picture').slice(0, 40);
    rb.addScene('user', { name, w, h, lin, midgray: [0.45, 0.45, 0.1, 0.1] });
    IDE.withBy(() => rb.apply({ op: 'pipe.scene', scene: 'user' }, 'user')); IDE.toast('Using "' + name + '" as the scene (' + w + '×' + h + ')');
  } catch (e) { IDE.toast('Could not read that picture: ' + (e.message || e), true); }
};
window.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files') && !e.target.closest('.v-agent')) e.preventDefault(); });
window.addEventListener('drop', (e) => { if (e.target.closest && e.target.closest('.v-agent')) return; const f = e.dataTransfer && [...e.dataTransfer.files].find((x) => /^image\//.test(x.type)); if (f) { e.preventDefault(); IDE.usePicture(f); } });
window.addEventListener('paste', (e) => { if (e.target.closest && (e.target.closest('.v-agent') || /^(INPUT|TEXTAREA)$/.test(e.target.tagName))) return; const f = [...(e.clipboardData ? e.clipboardData.items : [])].find((i) => i.kind === 'file' && i.type.startsWith('image/')); if (f) { e.preventDefault(); IDE.usePicture(f.getAsFile()); } });

/* ---------- History ---------- */
const ago = (t) => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 5 ? 'now' : s < 60 ? Math.round(s) + ' s' : s < 3600 ? Math.round(s / 60) + ' min' : Math.round(s / 3600) + ' h'; };
IDE.views.history = () => IDE.makeView((v) => {
  v.el.classList.add('v-history'); const tools = el('div', { class: 'toolbar' }), body = el('div', { class: 'scroll' }); v.el.append(tools, body); let showScript = false;
  const undo = el('button', { class: 'btn sm', text: 'Undo', onclick: () => S.rb && S.rb.undo() }), redo = el('button', { class: 'btn sm', text: 'Redo', onclick: () => S.rb && S.rb.redo() });
  const scr = el('button', { class: 'btn sm', text: 'Script', 'aria-pressed': 'false', onclick: () => { showScript = !showScript; v.update(); } });
  const saveBtn = el('button', { class: 'btn sm', text: 'Save as file', title: 'Keep the state as a script in snapshots/', onclick: () => { const rb = S.rb; if (!rb) return; const p = `snapshots/state-${rb.state.hash}.js`; vfs.write(p, `// state ${rb.state.hash} · saved ${new Date().toISOString()}\n// run this file on its own: it rebuilds the bench from scratch\n` + rb.script()); IDE.toast('Saved ' + p); IDE.openFile(p); } });
  tools.append(undo, redo, el('span', { class: 'sp' }), scr, saveBtn);
  v.update = () => {
    const rb = S.rb; body.innerHTML = ''; if (!rb) { body.append(el('p', { class: 'empty pad', text: 'No session yet.' })); return; }
    undo.disabled = !rb.undoStack.length; redo.disabled = !rb.redoStack.length; scr.classList.toggle('on', showScript);
    if (rb.pending.length) {
      body.append(el('div', { class: 'ghead' }, el('span', { text: 'Waiting for your approval' }), el('small', { text: String(rb.pending.length) })));
      for (const p of rb.pending) body.append(el('div', { class: 'pend' }, el('span', { class: 'tchip', text: p.by }), el('span', { class: 'pd', text: p.desc }), el('button', { class: 'btn sm primary', text: 'Approve', onclick: () => IDE.withBy(() => rb.approve(p.id)) }), el('button', { class: 'btn sm', text: 'Skip', onclick: () => rb.skip(p.id) })));
      if (rb.pending.length > 1) body.append(el('div', { class: 'toolbar' }, el('button', { class: 'btn sm primary', text: 'Approve all', onclick: () => IDE.withBy(() => rb.approveAll()) })));
    }
    body.append(el('dl', { class: 'kv pad' }, el('dt', { text: 'state' }), el('dd', { text: rb.state.hash }), el('dt', { text: 'log' }), el('dd', { text: rb.log.length + ' entries · hash ' + rb.log.hash }), el('dt', { text: 'cache' }), el('dd', { text: `${V2.cache.hits} hits · ${V2.cache.misses} misses · ${Math.round(V2.cache.bytes / 1e6)} MB` })));
    if (showScript) { let t = ''; try { t = rb.script(); } catch (e) { t = '// ' + e.message; } body.append(el('pre', { class: 'src pad', html: IDE.highlight(t) })); return; }
    body.append(el('div', { class: 'ghead' }, el('span', { text: 'Mutations' }), el('small', { text: 'newest first' })));
    const rows = rb.log.slice(-120).reverse(); if (!rows.length) body.append(el('p', { class: 'note pad', text: 'Nothing has been changed yet. Move a slider; every change lands here as one mutation.' }));
    const tbl = el('table', { class: 'rt' }); const tb = el('tbody');
    for (const e of rows) {
      const d = e.op === 'tx' ? `group "${e.name}"` : V2.describeOp ? V2.describeOp(e) : e.op;
      tb.append(el('tr', { class: e.by === 'agent' ? '' : '' }, el('td', { class: 'dimrow', text: ago(e.t) }), el('td', {}, el('span', { class: 'tchip', text: e.by })), el('td', { text: d }), el('td', { class: 'dimrow num', text: e.tx ? '⊂ ' + e.tx : '' })));
    }
    tbl.append(tb); body.append(el('div', { class: 'pad' }, tbl));
  };
  IDE.on('change', () => v.touch()); IDE.on('bench', () => v.touch()); setInterval(() => { if (v.visible && !IDE.dragging) v.touch(); }, 15000);
});

/* ---------- Reference ---------- */
IDE.views.reference = () => IDE.makeView((v) => {
  v.el.classList.add('v-ref'); const tools = el('div', { class: 'toolbar' }), body = el('div', { class: 'scroll' }), doc = el('div', { class: 'doc' }); body.append(doc);
  const names = () => vfs.list().filter((p) => /^docs\//.test(p)); let cur = store.get('refdoc', 'docs/reference.md');
  tools.append(el('span', { class: 'lbl', text: 'document' })); const sel = el('select', { class: 'sel', 'aria-label': 'Document', onchange: () => { cur = sel.value; store.set('refdoc', cur); v.update(); } }); tools.append(sel, el('span', { class: 'sp' }), el('button', { class: 'btn sm', text: 'Edit', onclick: () => IDE.openFile(cur) }));
  v.el.append(tools, body);
  v.update = () => {
    const ns = names(); sel.innerHTML = ''; ns.forEach((n) => sel.append(el('option', { value: n, text: n.replace(/^docs\//, '') }))); if (!ns.includes(cur)) cur = ns[0]; sel.value = cur;
    const t = vfs.read(cur) || ''; doc.innerHTML = IDE.md(t, { doc: true });
    const heads = $$('h2', doc); if (heads.length > 2 && !$('.toc', doc)) { const toc = el('div', { class: 'toc' }); heads.forEach((h, i) => { h.id = 'h' + i; toc.append(el('a', { href: '#', text: h.textContent, onclick: (e) => { e.preventDefault(); h.scrollIntoView({ block: 'start' }); } })); }); doc.insertBefore(toc, doc.firstChild); }
  };
  vfs.on(() => v.touch());
});
})();

/* Filmbench IDE — part 7: the agent. Lab helpers on the v2 API, eval loop, approvals through wb.pending, attachments, presets, export. */
(function () {
'use strict';
const { el, $, $$, clamp, sleep, vfs } = IDE, V2 = window.V2, raw = V2.raw, Img = CV.Img, AsyncFunction = IDE.AsyncFunction;
const S = IDE.session;
const A = (IDE.agentState = { mode: 'ask', model: 'default', think: 'auto', busy: false, ctl: null, threads: [], cur: null, looks: 0, noImages: false, pending: [], seq: 0 });
const MAX_STEPS = 10, EVAL_MS = 25000, TIER = { fast: 'quick', default: 'default', deep: 'complex' };
const WRITE_RE = /\blab\s*\.\s*(write|remove|export|useAsScene)\b/;
const MODE_CFG = { auto: 'auto', ask: 'ask', read: 'read-only' };

/* ---------- helpers ---------- */
const reg = (r) => { if (!Array.isArray(r) || r.length !== 4 || r.some((v) => !Number.isFinite(v))) throw new Error('region must be [x0,y0,x1,y1] in 0..1'); const o = [clamp(Math.min(r[0], r[2]), 0, 1), clamp(Math.min(r[1], r[3]), 0, 1), clamp(Math.max(r[0], r[2]), 0, 1), clamp(Math.max(r[1], r[3]), 0, 1)]; if (o[2] - o[0] < 0.004 || o[3] - o[1] < 0.004) throw new Error('region is too small'); return o; };
function headerCanvas(img, header) {
  const w = img.w, h = img.h, W = Math.max(w, 220), band = 18, c = document.createElement('canvas'); c.width = W; c.height = h + band; const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, h + band); const tmp = IDE.drawImg(document.createElement('canvas'), V2.displayImg(img)); x.drawImage(tmp, 0, band);
  x.fillStyle = '#111'; x.font = '11px ui-monospace, Menlo, Consolas, monospace'; x.textBaseline = 'middle'; x.fillText(header.slice(0, Math.floor(W / 6.5)), 4, band / 2 + 1); return c;
}
const blobOf = (canvas, type, q) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('could not encode image'))), type || 'image/png', q));
function bandOn(c, header) { const W = Math.max(c.width, 220), b = document.createElement('canvas'); b.width = W; b.height = c.height + 18; const x = b.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, b.height); x.drawImage(c, 0, 18); x.fillStyle = '#111'; x.font = '11px ui-monospace, Menlo, Consolas, monospace'; x.textBaseline = 'middle'; x.fillText(header.slice(0, Math.floor(W / 6.5)), 4, 10); return b; }
function similar(name, keys) { name = name.toLowerCase(); return keys.filter((k) => k.toLowerCase().includes(name.slice(0, 3)) || name.includes(k.toLowerCase().slice(0, 3))).slice(0, 5); }
const flat = (o, pre, out) => { out = out || {}; for (const k of Object.keys(o)) { const v = o[k], q = pre ? pre + '.' + k : k; if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, q, out); else out[q] = v; } return out; };
const labStats = (im) => { const s = im.stats(); return { L: s.lab_mean.L, a: s.lab_mean.a, b: s.lab_mean.b, hex: s.hex, clip_hi_pct: s.clip_pct.highlights, clip_lo_pct: s.clip_pct.shadows, luma_p5: s.luma.p5, luma_p50: s.luma.p50, luma_p95: s.luma.p95 }; };
const rb = () => S.rb;

/* ---------- attachments ---------- */
const ATT_EDGE = 1280, ATT_KEEP = 12;
const imgLimits = () => (IDE.caps.limits && IDE.caps.limits.images) || null;
const imgMax = () => { const l = imgLimits(); return l ? Math.max(1, l.maxCount | 0) : 0; };
const attMax = () => { const n = imgMax(); return n ? Math.max(1, Math.min(n - 2, 6)) : 0; };
const attName = (f) => { const n = (f && f.name) || ''; return !n || /^image\.(png|jpe?g|webp|gif)$/i.test(n) ? 'pasted image' : n.slice(0, 40); };
async function makeAttachment(file) {
  if (file.size > 40e6) throw new Error((file.name || 'that image') + ' is over 40 MB; resize it first');
  let bmp; try { bmp = await createImageBitmap(file); } catch (e) { throw new Error('could not read ' + attName(file) + ' as a picture'); }
  const sw = bmp.width, sh = bmp.height, f = Math.min(1, ATT_EDGE / Math.max(sw, sh)), w = Math.max(1, Math.round(sw * f)), h = Math.max(1, Math.round(sh * f));
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h); x.drawImage(bmp, 0, 0, w, h); if (bmp.close) bmp.close();
  const rgba = x.getImageData(0, 0, w, h).data, id = 'A' + (++A.seq), name = attName(file);
  const header = `#${id} ${name} · attached by the user · ${w}×${h}${f < 1 ? ' (from ' + sw + '×' + sh + ')' : ''}`;
  const types = (imgLimits() && imgLimits().mediaTypes) || ['image/jpeg', 'image/png'], jpeg = types.includes('image/jpeg');
  const blob = await blobOf(bandOn(c, header), jpeg ? 'image/jpeg' : 'image/png', 0.9);
  const k = 120 / Math.max(w, h), tc = document.createElement('canvas'); tc.width = Math.max(1, Math.round(w * k)); tc.height = Math.max(1, Math.round(h * k)); tc.getContext('2d').drawImage(c, 0, 0, tc.width, tc.height);
  return { id, name, w, h, srcW: sw, srcH: sh, file, blob, rgba, thumb: tc.toDataURL('image/jpeg', 0.8), header, bytes: blob.size, img: null };
}
function attImg(a) {
  if (!a.img) {
    if (!a.rgba) throw new Error('the pixels of ' + a.id + ' are no longer kept (only the last ' + ATT_KEEP + ' attachments of a thread are). Ask the user to attach it again.');
    const n = a.w * a.h, d = new Float32Array(n * 3), p = a.rgba; for (let i = 0; i < n; i++) { d[i * 3] = p[i * 4] / 255; d[i * 3 + 1] = p[i * 4 + 1] / 255; d[i * 3 + 2] = p[i * 4 + 2] / 255; }
    a.img = new Img(a.w, a.h, d, { space: 'srgb', note: 'attachment ' + a.id + ' ' + a.name });
  }
  return a.img;
}
const attDesc = (a) => `${a.id} "${a.name}" ${a.w}×${a.h}${a.srcW > a.w ? ' (from ' + a.srcW + '×' + a.srcH + ')' : ''}`;
function svgToImg(svgStr) {
  return new Promise((res, rej) => {
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr), im = new Image();
    im.onload = () => { const w = 1120, h = Math.round(1120 * im.height / Math.max(1, im.width)) || 600, c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(im, 0, 0, w, h); const px = x.getImageData(0, 0, w, h).data, d = new Float32Array(w * h * 3); for (let i = 0; i < w * h; i++) { d[i * 3] = px[i * 4] / 255; d[i * 3 + 1] = px[i * 4 + 1] / 255; d[i * 3 + 2] = px[i * 4 + 2] / 255; } res(new Img(w, h, d, { space: 'srgb', note: 'figure' })); };
    im.onerror = () => rej(new Error('could not rasterise the figure')); im.src = url;
  });
}

/* ---------- the lab ---------- */
const CHART = { W: 960, H: 640, pw: 134, ph: 96, gx: 12 };
const CC_NAMES = ['dark skin', 'light skin', 'blue sky', 'foliage', 'blue flower', 'bluish green', 'orange', 'purplish blue', 'moderate red', 'purple', 'yellow green', 'orange yellow', 'blue', 'green', 'red', 'yellow', 'magenta', 'cyan', 'white', 'neutral 8', 'neutral 6.5', 'neutral 5', 'neutral 3.5', 'black'];
function patchRect(i) { const { W, H, pw, ph, gx } = CHART, ox = (W - (6 * pw + 5 * gx)) / 2, oy = 28, cx = i % 6, cy = (i / 6) | 0; const x0 = ox + cx * (pw + gx), y0 = oy + cy * (ph + gx); return [(x0 + pw * 0.2) / W, (y0 + ph * 0.2) / H, (pw * 0.6) / W, (ph * 0.6) / H]; }
function makeLab(step) {
  const cache = {}; const lab = {}; const rig = () => S.G.rig || rb().mainNet();
  const needWrite = (what) => {
    if (A.mode === 'read') throw new Error('Read-only mode: ' + what + ' is not allowed. Describe the change to the user instead, or ask them to switch the mode.');
    if (A.mode === 'ask' && !step.approved) throw new Error('"' + what + '" changes the workbench outside the mutation log and needs the user\'s approval. Put it in its own eval block so it can be approved first.');
  };
  const ev = (tap, o) => { const net = rig(); return net.eval(tap, Object.assign({}, o)); };
  lab.state = () => {
    const r = rb(), P = r.params, def = FB.defaultParams(), get = (o, p) => String(p).split('.').reduce((a, k) => (a == null ? a : a[k]), o), changed = {};
    for (const path of r.table.paths()) { let v; try { v = P.effective(path); } catch (e) { continue; } const d = get(def, path); if (v !== undefined && typeof v !== 'object' && JSON.stringify(v) !== JSON.stringify(d)) changed[path] = typeof v === 'number' ? +v.toFixed(4) : v; }
    const net = r.mainNet(), layers = {}; for (const k of V2.LAYERS) { const L = P.layers[k]; layers[k] = { on: L.on, opacity: L.opacity, sources: [...L.contrib.keys()] }; }
    return { state_hash: r.state.hash, scene: net ? (net.stage('scene') || { opts: {} }).opts.scene : null, pipelines: [...r.pipes.keys()], taps: net ? net.taps : [], engines: net ? net.explain().lines : [], changed_from_defaults: changed, layers, macros: Object.fromEntries(Object.values(r.macros).map((m) => [m.name, { value: m.value, range: m.range }])), controls: { schemes: r.ctl.schemes(), active: r.ctl.active }, presets: [...r.presets.values()].map((p) => ({ name: p.name, kind: p.kind, user: p.user })), tiles: [...r.ws.tiles.values()].map((t) => ({ id: t.id, kind: t.kind, reads: t.ref(), by: t.by, ephemeral: t.ephemeral })), probes: Object.fromEntries(r.ws.probes), pending: r.pending.map((p) => ({ id: p.id, what: p.desc })), mode: A.mode, undo_depth: r.undoStack.length };
  };
  lab.paramInfo = (filter) => rb().table.paths().filter((p) => !filter || p.includes(filter)).map((path) => { const row = rb().table.row(path); return row ? { path, group: row.group, kind: row.kind, min: row.min, max: row.max, options: row.opts ? row.opts.map((o) => (Array.isArray(o) ? o[0] : o)) : undefined, unit: row.unit, now: rb().params.effective(path) } : { path }; });
  lab.stocks = () => ({ films: rb().stockIds('film').map((id) => ({ id, name: rb().stock(id).name, positive: rb().stock(id).positive })), papers: rb().stockIds('print').map((id) => ({ id, name: rb().stock(id).name })) });
  lab.scenes = () => Object.keys(rb().scenes).map((k) => ({ id: k, name: rb().scenes[k].name || k }));
  lab.presets = () => [...rb().presets.values()].map((p) => ({ name: p.name, kind: p.kind, user: p.user, desc: p.desc, sets: Object.keys(p.ops).length }));
  /* seeing */
  lab.img = (tap, o) => {
    tap = tap || 'out'; o = o || {}; const size = o.size ? clamp(Math.round(o.size), 128, 1600) : 480, key = tap + ':' + size + ':' + IDE.stateKey() + ':' + JSON.stringify(o.scope || {});
    if (cache[key]) return cache[key];
    const r = ev(tap, { max: size, scope: o.scope }); const im = V2.displayImg(r.img); im.meta.note = `${tap} @${size}${o.scope ? ' what-if' : ''}`; return (cache[key] = im);
  };
  lab.crop = (region, tap, o) => lab.img(tap || 'out', o).cropN(...reg(region));
  lab.zoom = (region, k, o) => { o = o || {}; return lab.crop(region, o.tap, o).zoom(k || 4); };
  lab.measure = (region, tap) => { const im = lab.img(tap || 'out'); return region ? im.cropN(...reg(region)).stats() : im.stats(); };
  lab.pixel = (u, v) => { const im = lab.img('out'), x = clamp(Math.round(u * (im.w - 1)), 0, im.w - 1), y = clamp(Math.round(v * (im.h - 1)), 0, im.h - 1), i = (y * im.w + x) * 3; return { x: u, y: v, rgb: [im.data[i], im.data[i + 1], im.data[i + 2]].map((q) => +q.toFixed(4)), lab: CV.lab(im.data[i], im.data[i + 1], im.data[i + 2]).map((q) => +q.toFixed(2)) }; };
  const lookCap = () => (step.cap != null ? step.cap : Math.min(imgMax(), 6));
  const lookGate = () => {
    if (!imgMax() || A.noImages) throw new Error('Images are not available in this view. Use numbers instead: lab.measure, lab.patches, img.stats(), img.cast(), img.hist() …');
    if (step.looks.length >= lookCap()) throw new Error(lookCap() ? 'At most ' + lookCap() + ' image' + (lookCap() > 1 ? 's' : '') + ' per step (the user\'s attachments use the rest of the limit). Look at fewer things, or combine them with Img.sbs([a, b]).' : 'No room for more images: the user\'s attachments use the whole limit.');
  };
  lab.look = async (what, label) => {
    lookGate(); let im, region = null;
    if (typeof what === 'string') { if (rb().ws.tiles.has(what) && !/^A\d+$/i.test(what)) what = await lab.shot(what); else what = lab.attachment(what); }
    if (Array.isArray(what)) { region = reg(what); im = lab.img('out').cropN(...region); } else if (what instanceof Img) { im = what; region = im.meta.region && im.meta.region.length === 4 ? im.meta.region : null; } else throw new Error('lab.look needs an Img, a region [x0,y0,x1,y1], a tile id or an attachment id like "A1"');
    const m = Math.max(im.w, im.h); if (m < 360) im = im.zoom(Math.min(8, Math.ceil(420 / m))); else if (m > 1024) im = im.fit(1024);
    const id = ++A.looks, regStr = region ? region.map((v) => +v.toFixed(3)).join(',') : '';
    const header = `#${id}${label ? ' ' + label : ''} · ${im.meta.note || 'image'}${regStr ? ' · region ' + regStr : ''} · ${im.w}×${im.h}`;
    step.looks.push({ id, label: label || '', header, blob: blobOf(headerCanvas(im, header)) }); return { look: id, px: im.w + 'x' + im.h, region: region || undefined };
  };
  /* an image of a workspace tile, as the user sees it */
  lab.shot = async (id, o) => {
    o = o || {}; const r = rb(), t = r.ws.get(id), size = o.size || 640;
    if (t.kind === 'render') { const x = r.ws.renderImg(t, { max: size }); if (x.placeholder) throw new Error('tile "' + id + '" reads a tap the pipeline lacks'); const im = x.img.clone({ note: `tile "${id}" ← ${t.spec.tap}${x.overlays && x.overlays[0] ? ' · ' + x.overlays[0].legend : ''}` }); return im; }
    if (t.kind === 'parade') return r.ws.paradeImg(t);
    if (t.kind === 'mosaic') {
      const g = r.ws.mosaicGrid(t), cw = Math.round(o.cell || Math.min(220, (size - 90) / g.cols.length)), imgs = g.cells.map((c) => r.ws.cellImg(t, c, { draft: false }).img), ch = Math.round(cw * imgs[0].h / imgs[0].w), padL = 78, padT = 18, W = padL + g.cols.length * cw, H = padT + g.rows.length * ch;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.fillStyle = '#111'; x.font = '10px ui-monospace, Menlo, monospace'; x.textBaseline = 'middle';
      g.cols.forEach((c, i) => x.fillText(IDE.valueLabel(g.colAxis.path, c).slice(0, Math.floor(cw / 6)), padL + i * cw + 3, padT / 2)); g.rows.forEach((rw, j) => x.fillText(IDE.valueLabel(g.rowAxis.path, rw).slice(0, 12), 3, padT + j * ch + ch / 2));
      g.cells.forEach((c, i) => { x.drawImage(IDE.imgCanvas(imgs[i], cw), padL + c.col * cw, padT + c.row * ch, cw, ch); });
      const px = x.getImageData(0, 0, W, H).data, d = new Float32Array(W * H * 3); for (let i = 0; i < W * H; i++) { d[i * 3] = px[i * 4] / 255; d[i * 3 + 1] = px[i * 4 + 1] / 255; d[i * 3 + 2] = px[i * 4 + 2] / 255; } return new Img(W, H, d, { space: 'srgb', note: `mosaic "${id}" (${g.colAxis.path} × ${g.rowAxis.path})` });
    }
    if (['curves', 'hist', 'line'].includes(t.kind)) return lab.figure(id);
    throw new Error('lab.shot does not draw tiles of kind "' + t.kind + '"');
  };
  lab.figure = async (id) => {
    const r = rb(), t = r.ws.get(id); const T = IDE.theme(); T.bg = '#ffffff'; T.ink = '#111'; T.ink2 = '#555'; T.rule = '#ddd'; const host = { body: { clientWidth: 560, clientHeight: 320 }, svg(s) { this.s = s; }, msg(m) { throw new Error(m); } };
    const keep = IDE.theme; IDE.theme = () => T; try { IDE.paintPlot(host, t); } finally { IDE.theme = keep; } return svgToImg(host.s);
  };
  lab.compare = (patch, o) => {
    o = o || {}; const scope = flat(patch || {}), edge = o.size || 480, before = lab.img('out', { size: edge }), after = lab.img('out', { size: edge, scope }), region = o.region ? reg(o.region) : null;
    const b = region ? before.cropN(...region) : before, a = region ? after.cropN(...region) : after, sb = labStats(b), sa = labStats(a), diff = a.diff(b, { mode: 'signed', gain: o.gain || 4 });
    return { before: b, after: a, diff, scope, delta: { L: +(sa.L - sb.L).toFixed(2), a: +(sa.a - sb.a).toFixed(2), b: +(sa.b - sb.b).toFixed(2), clip_hi_pct: +(sa.clip_hi_pct - sb.clip_hi_pct).toFixed(2), clip_lo_pct: +(sa.clip_lo_pct - sb.clip_lo_pct).toFixed(2), mean_dE2000: +V2.meanDE(a, b).toFixed(2) }, note: 'what-if: nothing was changed in the workbench' };
  };
  lab.sweep = (path, values, measure, o) => {
    o = o || {}; if (!Array.isArray(values) || !values.length) throw new Error('values must be a non-empty array'); if (values.length > 14) throw new Error('at most 14 values per sweep');
    const region = o.region ? reg(o.region) : null, rows = [];
    for (const v of values) { const im0 = lab.img('out', { size: o.size || 320, scope: { [path]: v } }), im = region ? im0.cropN(...region) : im0; const m = measure ? measure(im) : labStats(im); rows.push(Object.assign({ value: v }, m && typeof m === 'object' ? m : { measure: m })); }
    return { path, rows, note: 'what-if: nothing was changed in the workbench' };
  };
  lab.patches = () => {
    const out = ev('out', { max: 960, scope: { scene: 'chart' } }).img, im = V2.displayImg(out), rows = [];
    for (let i = 0; i < 24; i++) { const sc = CC24[i].map((x) => FB.srgbEncode(Math.min(1, x))), r = patchRect(i), c = im.cropN(r[0], r[1], r[0] + r[2], r[1] + r[3]), p = c.mean(); const a = CV.lab(...sc), b = CV.lab(...p), dC = Math.hypot(b[1], b[2]) - Math.hypot(a[1], a[2]); let dh = Math.atan2(b[2], b[1]) - Math.atan2(a[2], a[1]); dh = Math.atan2(Math.sin(dh), Math.cos(dh)) * 180 / Math.PI; rows.push({ i: i + 1, name: CC_NAMES[i], scene: CV.hex(...sc), print: CV.hex(...p), dL: +(b[0] - a[0]).toFixed(1), dC: +dC.toFixed(1), dh: +dh.toFixed(0), dE: +V2.dE2000(a, b).toFixed(1) }); }
    return { rows, note: 'standard ColorChecker values through the current film, paper and settings (the chart scene). "scene" is plain sRGB, so dL includes the film\'s tone curve' };
  };
  lab.tone = () => {
    const im = V2.displayImg(ev('out', { max: 960, scope: { scene: 'chart' } }).img), { W, H, pw, ph, gx } = CHART, ox = (W - (6 * pw + 5 * gx)) / 2, oy = 28, wy = oy + 4 * (ph + gx) + 6, ww = (W - 2 * ox) / 12, rows = [];
    for (let i = 0; i < 12; i++) { const c = im.cropN((ox + i * ww + ww * 0.2) / W, (wy + 8) / H, (ox + (i + 1) * ww - ww * 0.2) / W, (wy + 50) / H), L = CV.lab(...c.mean())[0]; rows.push({ stops: i - 7, L: +L.toFixed(1), slope: i ? +(L - rows[i - 1].L).toFixed(1) : null }); }
    return { rows, note: 'twelve grey steps one stop apart around 18% grey (stop 0), measured on the print' };
  };
  lab.curves = () => {
    const net = rig(), ctx = net.ctxFor({ w: 64 }), plan = net.plan(ctx), cu = FB.curvesFor(plan), n = FB.NLE, take = (arr, c) => { const o = []; for (let k = 0; k < n; k += 16) o.push(+arr[k * 3 + c].toFixed(3)); return o; };
    const row = (arr, c) => { let mx = 0, mn = 1e9; for (let k = 0; k < n; k += 1) { mx = Math.max(mx, arr[k * 3 + c]); mn = Math.min(mn, arr[k * 3 + c]); } return { dmin: +mn.toFixed(3), dmax: +mx.toFixed(3), samples: take(arr, c) }; };
    const out = { log_exposure_samples_at: Array.from({ length: Math.ceil(n / 16) }, (_, i) => +(FB.LE0 + i * 16 * FB.DLE).toFixed(2)), film: ['R', 'G', 'B'].map((c, i) => Object.assign({ layer: c }, row(cu.film.norm, i))) };
    if (cu.paper) out.paper = ['cyan', 'magenta', 'yellow'].map((c, i) => Object.assign({ dye: c }, row(cu.paper, i))); return out;
  };
  /* pictures the user attached */
  const threadAtts = () => (A.cur && A.cur.atts) || new Map();
  lab.attachments = () => [...threadAtts().values()].map((a) => ({ id: a.id, name: a.name, px: a.w + 'x' + a.h, original_px: a.srcW + 'x' + a.srcH, sent_with_this_message: !!(step.atts && step.atts.includes(a.id)), pixels_kept: !!a.rgba }));
  lab.attachment = (id) => { const a = threadAtts().get(String(id).toUpperCase()); if (!a) { const ids = [...threadAtts().keys()]; throw new Error('no attachment ' + id + (ids.length ? ' — attached in this thread: ' + ids.join(', ') : ' — the user has not attached anything in this thread')); } return attImg(a); };
  lab.vs = (id, o) => {
    o = o || {}; const ref = lab.attachment(id), region = o.region ? reg(o.region) : null, now = lab.img(o.tap || 'out', { size: 480 }), b = region ? now.cropN(...region) : now, r = o.refRegion ? ref.cropN(...reg(o.refRegion)) : ref;
    const sr = labStats(r.fit(480)), sn = labStats(b), chroma = (s) => +Math.hypot(s.a, s.b).toFixed(2), hue = (s) => +(Math.atan2(s.b, s.a) * 180 / Math.PI).toFixed(0), dl = (k) => +(sn[k] - sr[k]).toFixed(2);
    return { reference: Object.assign({ chroma: chroma(sr), hue_deg: hue(sr) }, sr), print: Object.assign({ chroma: chroma(sn), hue_deg: hue(sn) }, sn), print_minus_reference: { L: dl('L'), a: dl('a'), b: dl('b'), chroma: +(chroma(sn) - chroma(sr)).toFixed(2), luma_p5: dl('luma_p5'), luma_p50: dl('luma_p50'), luma_p95: dl('luma_p95'), contrast_p95_p5: +((sn.luma_p95 - sn.luma_p5) - (sr.luma_p95 - sr.luma_p5)).toFixed(2) }, note: 'positive b = print more yellow, positive a = more magenta; different scenes, so these are global statistics, not pixels' };
  };
  /* changing things: these go through the mutation log, so Ask mode queues them */
  lab.set = (a, b) => { const pairs = typeof a === 'string' ? { [a]: b } : a; if (!pairs || typeof pairs !== 'object') throw new Error('lab.set(path, value) or lab.set({path: value, …})'); const before = rb().pending.length; for (const k of Object.keys(pairs)) rb().apply({ op: 'param.set', path: k, value: pairs[k] }); return rb().pending.length > before ? { queued: rb().pending.length - before, note: 'waiting for the user to approve' } : { changed: Object.keys(pairs).map((k) => ({ path: k, now: rb().params.effective(k) })) }; };
  lab.film = (id) => lab.set('film', id); lab.print = (id) => lab.set('print', id);
  lab.reset = (path) => { if (path) rb().apply({ op: 'param.reset', path }); else rb().apply({ op: 'layer.clear', layer: 'look' }); return { ok: true }; };
  lab.preset = {
    get: (name) => { const p = rb().preset(name); return { name: p.name, desc: p.desc, kind: p.kind, user: p.user, ops: Object.fromEntries(Object.entries(p.ops).map(([k, o]) => [k, V2.opText ? V2.opText(o) : o])) }; },
    apply: (name) => { rb().apply({ op: 'layer.use', layer: 'look', preset: name }); return { applied: name }; },
    stack: (name, on) => { rb().apply({ op: 'layer.stack', layer: 'look', preset: name, on: on !== false }); return { stacked: name }; },
    /* save what the workbench shows now (changesOnly keeps just the values that differ from the stock defaults) */
    save: (o) => { o = o || {}; if (!o.name) throw new Error('lab.preset.save({name, desc, changesOnly}) needs a name'); const ops = IDE.snapshotOps(o.changesOnly !== false); delete ops.film; delete ops.print; if (o.includeStock) { ops.film = rb().params.effective('film'); ops.print = rb().params.effective('print'); } rb().apply({ op: 'preset.add', name: o.name, def: { desc: o.desc || '', kind: o.kind || 'look', ops } }); return { saved: o.name, values: Object.keys(ops).length, note: 'shown under Yours in the Layers view' }; },
    /* make a preset from an explicit patch, without touching the workbench: {name, desc, patch: {enlarger: {y_shift: -8}, film: 'kodak_ektar_100'}} or ops with op.add/op.mul */
    create: (o) => { o = o || {}; if (!o.name) throw new Error('lab.preset.create({name, desc, patch}) needs a name'); const ops = o.ops || flat(o.patch || {}); for (const k of Object.keys(ops)) rb().table.check(k); rb().apply({ op: 'preset.add', name: o.name, def: { desc: o.desc || '', kind: o.kind || 'look', ops } }); return { created: o.name, values: Object.keys(ops).length, note: 'shown under Yours in the Layers view' }; },
    remove: (name) => { const p = rb().preset(name); if (!p.user) throw new Error('"' + name + '" is a built-in preset and cannot be removed'); rb().apply({ op: 'preset.remove', name }); return { removed: name }; },
  };
  lab.useAsScene = async (id) => { needWrite('lab.useAsScene'); const a = threadAtts().get(String(id).toUpperCase()); if (!a) throw new Error('no attachment ' + id); await IDE.usePicture(a.file); return { scene: 'user', px: a.w + 'x' + a.h }; };
  /* tiles */
  lab.tiles = () => rb().ws.snapshot();
  lab.keep = (id) => { rb().ws.keep(id); return { kept: id }; }; lab.drop = (id) => { rb().ws.drop(id); return { dropped: id }; };
  /* the user's scripts */
  lab.files = () => vfs.list().map((p) => ({ path: p, bytes: (vfs.read(p) || '').length, edited: vfs.modified(p), mine: vfs.isNew(p) }));
  lab.read = (path) => { const t = vfs.read(path); if (t == null) throw new Error('no file ' + path + '. lab.files() lists them'); return t; };
  lab.editor = () => { const e = IDE.editor, t = vfs.read(e.active) || ''; return { file: e.active, open: e.open, text: t.length > 6000 ? t.slice(0, 6000) + '\n… [cut]' : t, problems: (e.diags.get(e.active) || []).map((d) => ({ line: d.line, msg: d.msg })) }; };
  lab.write = (path, text) => { needWrite('lab.write'); if (typeof text !== 'string') throw new Error('lab.write(path, text) needs the full text'); vfs.write(path, text); IDE.emit('editor-reload', path); return { wrote: path, bytes: text.length, note: 'run it from the Code view (the user presses Run)' }; };
  lab.remove = (path) => { needWrite('lab.remove'); if (path === 'main.js') throw new Error('main.js cannot be removed'); vfs.remove(path); return { removed: path }; };
  lab.export = async (o) => { needWrite('lab.export'); return IDE.exportImage(Object.assign({ edge: 1280, fmt: 'png', tap: 'out' }, o || {})); };
  /* UI */
  lab.view = (name) => { IDE.focusView(name); return { view: name }; };
  lab.focusTile = (id) => { IDE.focusView('workspace'); IDE.emit('focus-tile', id); return { tile: id }; };
  const names = Object.keys(lab).filter((k) => !k.startsWith('_'));
  return new Proxy(lab, { get(t, k) { if (typeof k === 'symbol' || k in t || k === 'then') return t[k]; const near = similar(String(k), names); throw new Error('lab.' + String(k) + ' does not exist.' + (near.length ? ' Did you mean ' + near.map((n) => 'lab.' + n).join(', ') + '?' : ' Available: ' + names.join(', '))); } });
}
IDE.makeLab = makeLab;

/* ---------- export ---------- */
IDE.exportImage = async function (o) {
  const r = rb(); if (!r) throw new Error('no session'); const edge = clamp(Math.round(o.edge || 1280), 256, 3200), fmt = o.fmt || 'png', tap = o.tap || 'out';
  const res = r.mainNet().eval(tap, { max: edge }); const im = V2.displayImg(res.img), cv = IDE.imgCanvas(im), type = fmt === 'jpeg' || fmt === 'jpg' ? 'image/jpeg' : fmt === 'webp' ? 'image/webp' : 'image/png';
  const blob = await blobOf(cv, type, 0.92), ext = type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png', name = `filmbench-${(r.params.effective('film') || 'film')}-${tap}-${im.w}x${im.h}.${ext}`;
  const dl = IDE.caps.downloads;
  if (dl && dl.save) { const out = await dl.save({ filename: name, data: blob }); return { saved: name, px: im.w + 'x' + im.h, bytes: blob.size, result: out && out.saved !== undefined ? out.saved : undefined }; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); return { saved: name, px: im.w + 'x' + im.h, bytes: blob.size };
};

/* ---------- the prompt ---------- */
function paramList() {
  const t = rb().table; return t.groups.filter((g) => g.rows.length).map((g) => g.title + ': ' + g.rows.map((r) => r.path + (r.kind === 'num' ? ' ' + r.min + '..' + r.max : r.opts ? ' {' + r.opts.map((o) => (Array.isArray(o) ? o[0] : o)).join('|') + '}' : r.kind === 'id' ? ' (stock id)' : ' bool')).join('; ')).join('\n');
}
function systemText() {
  const lim = imgMax(), r = rb(), briefs = [vfs.read('agent/brief.md') || '', ...(r ? r.briefs.map((b) => b.text) : [])].filter(Boolean).join('\n');
  return `You are the agent inside Filmbench, a browser IDE for studying a spectral film model (ported from the open-source spektrafilm project, after Kodak patent US 6,633,408): scene → film exposure → film development → enlarger → paper → scan. The whole workbench is built from one small JavaScript API (v2) living in editable scripts; you act by running JavaScript in the page. The user studies how the model works and builds looks and control schemes.

HOW TO ACT
- To run code, reply with ONE fenced block tagged eval and nothing after it (a sentence before it is fine):
\`\`\`eval
return lab.state()
\`\`\`
  The code is the body of an async function with wb, ctl, ws, rig, lab, lens, op, p, units, Img, CV, FB, PLOTS in scope; use await when needed and return what you want to read. The result comes back in the next message as YAML, with any images you queued with lab.look. Take as many steps as you need (limit ${MAX_STEPS}). A reply without an eval block is your final answer: plain Markdown, short and specific.
- Look first, measure second, change third, then check by looking again. Numbers (stats, patches, cast) are more reliable than your eye for colour; your eye is better for composition, banding, halos and clipping. Never claim to have seen what you did not look at.
- ${lim ? 'You may queue up to ' + Math.min(lim, 6) + ' images per step (fewer when the user attached pictures). Each image has a header band with its #id. Only the latest step\'s images are shown to you.' : 'Images are NOT available in this view: rely on numbers (lab.measure, lab.patches, img.stats(), img.cast(), img.hist()).'}
- Coordinates are normalised 0..1 (x right, y down) unless a method says pixels.
- Mode now: ${A.mode === 'read' ? 'READ-ONLY. Every wb.apply throws E_READONLY; use lab.compare / lab.sweep for what-ifs and tell the user what you would change.' : A.mode === 'ask' ? 'ASK. Changes made with wb.* / ctl.* / ws.* / lab.set are queued; the user approves them at the end of the step, and the result tells you what was approved or skipped. Explain a change in one sentence before the block. Changes outside the mutation log (lab.write, lab.export, lab.useAsScene) need approval before the block runs: give each its own eval block.' : 'AUTO. Changes run at once and are logged and undoable (wb.undo()). Keep them minimal and say what you changed.'}
- Link things so the user can jump: [text](ide:view/graph) [text](ide:file/main.js#12) [text](ide:tile/print) [text](ide:param/enlarger.y_shift=-8) [text](ide:preset/Portra 160).

THE v2 API
- wb: the bench. Every change is one mutation: wb.apply({op:'param.set', path, value}); wb.set(path, v) is the short form. wb.undo()/redo(), wb.tx('name', t => { … }) groups changes, wb.log is the history, wb.state.hash the state, wb.script() prints the whole bench as code. wb.preset(name) reads a preset; wb.axis(path, values) makes a swept axis for mosaics and plots.
- rig: the main pipeline, a net of stages with typed taps: src (Scene), log_e_film (LogExposure), cmy_film (Density), log_e_print, cmy_print (Density), out (RGB). rig.eval(tap, {scope?, w?, max?}) → { img, at(tap), ms }. scope overrides parameters for that evaluation only: {'enlarger.y_shift': -8, film: 'kodak_ektar_100', scene: 'chart'}; nothing changes. rig.explain() says which engines run and why; rig.diff(other) and rig.fork() compare pipelines.
- ctl: the control plane. ctl.list() controls, ctl.schemes(), ctl.why(path) shows how a value is resolved, ctl.layer('agent').use(preset) puts a preset in your own layer (layers fold base → look → macros → agent → pin; the user sees them in Layers). Macros (wb.macros) drive several parameters at once; ctl.macro(name, {range}).drives(path, {gain}).
- ws: the workspace of tiles. ws.describe(), ws.snapshot(), ws.probe(name) rect [u,v,w,h]. ws.attach(name, t => t.render('out').lens(lens.clip())) puts a tile in the user's workspace that stays yours until they Keep it. Tile kinds: render(tap), hist(tap,{channel:'L*',bands:'zones'}), plot.curves('paper'|'film'), plot.line({x: wb.axis(…), y: tap => …}), mosaic({cols: wb.axis(path, values), rows: wb.axis(…), cell: c => c.render('out')}), scope.parade(tap), table, text. Lenses: lens.clip(), lens.zones(), lens.diff({vs:{…}}), lens.split({with:{…}}), lens.falseDensity(tap). t.scope({…}) puts a tile in a what-if scope; t.crop(probe), t.zoom(k,{at:probe}).
- op: op.add(x), op.mul(x), op.set(x) for presets and macros. p, units: parameter and unit helpers.
- Errors are diagnostics (code, message, did-you-mean, valid choices, fix). Read them and fix the call. An unknown member of wb/ws/ctl/rig names the nearest valid ones.

LAB HELPERS (on top of the API)
SEE
lab.state()  scene, taps, engines, changed parameters, layers, macros, presets, tiles, probes, pending, mode
lab.img(tap='out', {size?, scope?}) → Img (display sRGB)   lab.crop(region, tap?, {size?})   lab.zoom(region, k=4, {tap, size})   lab.measure(region?, tap?)   lab.pixel(u,v)
lab.look(Img | region | tile id | 'A1', label?) → queue an image for you to see next message
await lab.shot(tileId, {size?}) → Img of a tile as the user sees it (render, mosaic, parade, plots)   await lab.figure(tileId)
lab.compare(patch, {region?, size?, gain?}) → what-if {before, after, diff, delta:{L,a,b,clip,mean_dE2000}}; patch like {'enlarger.y_shift': -8} or {film:'kodak_ektar_100'}
lab.sweep(path, [values], measure?(Img)→number|object, {region?, size?}) → table
lab.patches() ColorChecker through the chain (dE, dL, dC, dh)   lab.tone() grey steps → L*   lab.curves() film/paper samples
lab.paramInfo(filter?)  lab.stocks()  lab.scenes()  lab.presets()  lab.tiles()
lab.files() lab.read(path)  lab.editor() → the open script, its text and problems (help the user debug scripts)
PICTURES THE USER ATTACHED (shown with their message, each with a #A1 header band)
lab.attachments()  lab.attachment('A1') → Img (sRGB, ≤1280 px)  lab.vs('A1', {region?, refRegion?}) → tone / cast / saturation of the reference vs the print and the difference
Img methods (new Img): crop cropN(x0,y0,x1,y1) resize zoom(k) fit(maxEdge) flip channel('r'|'g'|'b'|'y'|'L'|'a'|'bs'|'chroma'|'sat'|'hue') levels gamma expose(ev) contrast autolevels threshold equalize falseColor clipMask blur sharpen edges diff(other,{mode,gain}) sbs([a,b])
Img analysis: stats() hist(bins,ch) profile(x0,y0,x1,y1,n) kmeans(k) cast() grain() sharpness() blobs() percentile(q,ch)
CHANGE (mutations; queued in Ask mode)
lab.set(path, v) | lab.set({…})  lab.film(id)  lab.print(id)  lab.reset(path?)
lab.preset.save({name, desc, changesOnly=true, kind:'look'|'adjust'})  keep what the workbench shows now;  lab.preset.create({name, desc, patch:{enlarger:{y_shift:-8}, film:'kodak_ektar_100'}})  a preset from a patch, without touching the workbench (test it with lab.compare first);  lab.preset.apply(name)  lab.preset.stack(name)  lab.preset.remove(name)  (built-in presets cannot be changed, only copied under a new name)
lab.keep(tileId) lab.drop(tileId)   lab.useAsScene('A1')   lab.write(path, text)   lab.export({fmt:'png'|'jpeg'|'webp', edge, tap})
UI: lab.view('workspace'|'code'|'graph'|…)  lab.focusTile(id)

WORKING FROM A REFERENCE PICTURE
- When the user attaches a photo and asks for "this look", you are matching global tone, colour cast, saturation, contrast and grain character, not content. Read it first (lab.look('A1'), lab.attachment('A1').stats(), .cast(), .hist()), say in a sentence what you see, then use lab.vs('A1') for the difference with the print. Change one thing at a time with lab.compare before you set it. Keep the result with lab.preset.save or lab.preset.create and tell the user its name.

PARAMETERS (path range)
${r ? paramList() : ''}

PHYSICS HINTS (verified in this engine)
- Enlarger filtration: +yellow makes the print bluer/cooler, −yellow warmer; +magenta greener, −magenta more magenta; +cyan redder, −cyan more cyan. Units are CC units; 5–10 is visible.
- enlarger.print_exposure > 1 darkens the print. With enlarger.comp on (default) camera.ev is compensated at the enlarger, so over/under-exposing changes shadow/highlight rendering, grain and saturation, not overall brightness.
- film_render.gamma raises the negative's contrast; print_render.morph.* changes paper contrast and only acts when morph.active is true. DIR couplers raise saturation. Halation is the red-orange glow around highlights.
- Grain is rendered at the working size; judge it at high zoom (lab.zoom with size: 1280).
- Honest limits: gamut compression, halation and grain are simplified versus spektrafilm; the "spectral" scan engine is a 65³ lattice stand-in; the working picture is down-sampled; imported photos are treated as sRGB.
${briefs ? '\nNOTES FROM THE USER AND THE FRAGMENTS\n' + briefs + '\n' : ''}
Keep answers short. If something fails, read the error, fix the call and try again instead of apologising.`;
}
function contextText() {
  const r = rb(), s = makeLab({ looks: [] }).state(), ed = IDE.editor;
  const ch = Object.entries(s.changed_from_defaults).slice(0, 40).map(([k, v]) => k + '=' + v);
  const L = ['[context]', `scene: ${s.scene} · pipelines: ${s.pipelines.join(', ')} · taps: ${s.taps.join(', ')}`, `changed from defaults: ${ch.length ? ch.join(', ') : 'none'}`,
    `layers: ${Object.entries(s.layers).map(([k, v]) => k + (v.on ? '' : ' (off)') + (v.sources.length ? ' [' + v.sources.join(', ') + ']' : '')).join(' · ')}`,
    `controls: ${s.controls.schemes.join(', ') || 'none'} (active ${s.controls.active || '—'}) · tiles: ${s.tiles.map((t) => t.id + (t.ephemeral ? '*' : '')).join(', ') || 'none'} · probes: ${Object.keys(s.probes).join(', ') || 'none'}`,
    `presets: ${s.presets.filter((p) => p.user).map((p) => p.name).join(', ') || 'no user presets'} (+${s.presets.filter((p) => !p.user).length} built in) · pending approvals: ${s.pending.length} · mode: ${A.mode} · state ${s.state_hash}`,
    `editor: ${ed.active}${(ed.diags.get(ed.active) || []).length ? ' (' + ed.diags.get(ed.active).length + ' problems)' : ''}`];
  return L.join('\n');
}

/* ---------- running a step ---------- */
function oneLine(code, result) { const c = code.replace(/\s+/g, ' ').trim().slice(0, 100), r2 = String(result).replace(/\s+/g, ' ').trim().slice(0, 160); return `[eval] ${c} → ${r2}`; }
function fmtResult(v) {
  if (v === undefined) return '(no return value — use `return …` to read something)';
  let t; try { v = raw(v); t = v instanceof Img ? CV.toYaml(v.summary()) + '\n(an image: pass it to lab.look() to see it)' : v && typeof v.toString === 'function' && v.toString !== Object.prototype.toString && !Array.isArray(v) && typeof v === 'object' && v.lines ? String(v) : CV.toYaml(v); } catch (e) { t = String(v); }
  return t.length > 9000 ? t.slice(0, 9000) + '\n… [cut at 9000 characters — return less]' : t;
}
function errText(e, code) {
  let msg = e && e.message ? e.message : String(e), line = null;
  if (e && e.stack) { const m = /fbfs\/agent:(\d+):\d+/.exec(e.stack); if (m) line = Math.max(1, parseInt(m[1], 10) - 2); }
  return 'Error: ' + msg + (line && line <= code.split('\n').length ? ' (line ' + line + ')' : '');
}
async function runCode(code, step) {
  const lab = makeLab(step), g = S.G, scope = { wb: g.wb, ctl: g.ctl, ws: g.ws, rig: g.rig || rb().pipe('default'), lab, lens: V2.lens, op: V2.op, p: V2.p, units: V2.units, Img, CV, FB, PLOTS };
  const names = Object.keys(scope), body = new AsyncFunction(...names, code + '\n//# sourceURL=fbfs/agent'); let timer;
  const to = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timed out after 25 s')), EVAL_MS); });
  const keep = V2.by; V2.by = 'agent'; IDE.agentStep = true;
  try { return await Promise.race([body(...names.map((n) => scope[n])), to]); } finally { clearTimeout(timer); V2.by = keep; IDE.agentStep = false; }
}

/* ---------- the panel ---------- */
let ui = {};
const SUGG = [
  'Look at the shadows and highlights. Is anything clipping or turning muddy?',
  'Check the neutral patches for a colour cast and tell me which filter to change.',
  'Add a mosaic of the paper stocks to the workspace and tell me which is most neutral.',
  'Make a warm, slightly soft look and save it as a preset.',
  'Match the look of a photo I attach, then save it as a preset.',
  'Read the open script and tell me what it does.',
];
const ERR = {
  not_granted: 'Claude is not allowed to run for this page, so the agent is off.', sampling_disabled: 'Claude is not available for this account, so the agent is off.', not_declared: 'This page no longer declares the Claude capability.', capability_disabled: 'Claude is not usable in this view.', capability_removed: 'This viewer cannot run the agent.',
  rate_limited: 'Too many requests, or your usage limit is reached. Wait a bit and press Send again.', session_expired: 'Your session has expired. Sign in again and retry.', refused: 'Claude declined that request. Rephrase it and try again.', empty_completion: 'Claude returned nothing. Try rephrasing, or ask for less.',
  prompt_too_large: 'This thread has grown too large. Start a new thread.', image_rejected: 'A picture was rejected (wrong type, unreadable, too large, or too many). Remove it and press Send again.', upstream_error: 'Connection problem. Your message is kept; press Send to retry.', cancelled: '', invalid_request: 'The page sent a malformed request (a bug). Try a new thread.', images_unavailable: 'Images are not available in this view, so the agent works from numbers.',
};
function newThread() { const t = { id: Date.now() + Math.random(), title: 'New thread', log: el('div', { class: 'agent-log' }), history: [], steps: [], atts: new Map() }; A.threads.push(t); selectThread(t); return t; }
function selectThread(t) { A.cur = t; paintThreads(); ui.logHost.innerHTML = ''; ui.logHost.append(t.log); if (!t.log.childElementCount) emptyState(t); scrollLog(); }
function paintThreads() {
  ui.threads.innerHTML = '';
  for (const t of A.threads) ui.threads.append(el('span', { class: 'th' + (t === A.cur ? ' on' : '') }, el('button', { text: t.title, onclick: () => !A.busy && selectThread(t), disabled: A.busy && t !== A.cur }), el('button', { class: 'x', text: '×', 'aria-label': 'Close thread', disabled: A.busy, onclick: () => closeThread(t) })));
  ui.threads.append(el('button', { class: 'new', text: '＋ New', disabled: A.busy, onclick: () => newThread() }));
}
function closeThread(t) { if (A.busy) return; A.threads = A.threads.filter((x) => x !== t); if (!A.threads.length) newThread(); else if (A.cur === t) selectThread(A.threads[A.threads.length - 1]); else paintThreads(); }
function emptyState(t) {
  t.log.innerHTML = '';
  t.log.append(el('div', { class: 'agent-empty' }, el('p', { text: 'Ask about the picture, the physics or your scripts. I can take screenshots of tiles, crop and magnify regions, run image operations and measurements, try what-ifs without touching your settings, attach tiles to the workspace and make presets.' }),
    el('div', { class: 'sugg' }, ...SUGG.map((s) => el('button', { text: s, onclick: () => { ui.input.value = s; send(); } })))));
}
const scrollLog = () => { requestAnimationFrame(() => { ui.logHost.firstChild && (ui.logHost.firstChild.scrollTop = ui.logHost.firstChild.scrollHeight); }); };
function paintCaps() {
  if (!ui.off) return; const on = !!IDE.caps.sample; ui.off.hidden = on; ui.composer.hidden = !on; ui.settings.hidden = !on; ui.logHost.hidden = !on;
  if (!on) { ui.off.innerHTML = ''; ui.off.append(el('b', { text: 'The agent is off here.' }), document.createTextNode(IDE.caps.known ? 'Claude is not available in this view (for example it is open outside Claude, or the Claude capability was not allowed). Everything else still works.' : 'Checking whether Claude is available in this view…')); }
  A.noImages = !imgLimits(); if (ui.attach) ui.attach.hidden = A.noImages; if (A.noImages && A.pending.length) { A.pending = []; paintAtts(); }
}
const MODE_PHRASE = { auto: 'steps run as they come', ask: 'you approve each change', read: 'read-only' };
function paintMeta() { if (!ui.meta) return; ui.meta.textContent = A.dropping ? 'Drop pictures to attach them' : A.reading ? 'Reading ' + (A.reading > 1 ? A.reading + ' pictures' : 'a picture') + '…' : ['Enter sends', 'Shift+Enter for a new line', A.noImages ? 'pictures are unavailable here' : 'paste or drop pictures', MODE_PHRASE[A.mode]].join(' · '); }
function paintSend() { if (ui.send) ui.send.disabled = !(ui.input.value.trim() || A.pending.length) || !IDE.caps.sample; }
function paintAtts() {
  ui.atts.innerHTML = ''; ui.atts.hidden = !A.pending.length;
  for (const a of A.pending) ui.atts.append(el('figure', { class: 'att', title: attDesc(a) }, el('img', { src: a.thumb, alt: a.name }), el('figcaption', {}, el('span', { text: a.id }), el('button', { class: 'x', text: '×', 'aria-label': 'Remove ' + a.id, title: 'Remove ' + a.name, onclick: () => { A.pending = A.pending.filter((x) => x !== a); paintAtts(); } }))));
  paintSend();
}
async function addFiles(list) {
  const files = [...list].filter((f) => f && /^image\//.test(f.type)); if (!files.length) return false;
  if (!IDE.caps.sample) { paintCaps(); return true; }
  if (A.noImages || !attMax()) { IDE.toast('Pictures are not available in this view, so the agent cannot see them.', true); return true; }
  const room = attMax() - A.pending.length; if (room <= 0) { IDE.toast('At most ' + attMax() + ' pictures per message. Remove one first.', true); return true; }
  const take = files.slice(0, room); if (files.length > room) IDE.toast('Attached ' + take.length + ' of ' + files.length + ': the limit is ' + attMax() + ' pictures per message.', true);
  A.reading = (A.reading || 0) + take.length; paintMeta();
  for (const f of take) { try { A.pending.push(await makeAttachment(f)); } catch (e) { IDE.toast(e.message, true); } A.reading--; paintAtts(); paintMeta(); }
  A.reading = 0; paintMeta(); ui.input.focus(); return true;
}
IDE.agentAttach = (files) => addFiles(files);
IDE.agentAsk = (q) => { IDE.focusView('agent'); if (ui.input) { ui.input.value = q; paintSend(); ui.input.focus(); } return Promise.resolve({ note: 'the question was put in the agent panel for the user to send' }); };
function paintSettings() {
  if (!ui.settings) return; ui.settings.innerHTML = '';
  const grp = (label, key, opts) => { const sel = el('select', { 'aria-label': label, disabled: A.busy }); for (const [v, t] of opts) sel.append(el('option', { value: v, text: t })); sel.value = A[key]; sel.addEventListener('change', () => { A[key] = sel.value; if (key === 'mode' && rb()) rb().agent({ mode: MODE_CFG[A.mode] }); paintSettings(); }); ui.settings.append(el('label', { class: 'sgrp' }, el('span', { class: 'ctl-l', text: label }), sel)); };
  grp('Mode', 'mode', [['auto', 'Auto'], ['ask', 'Ask'], ['read', 'Read-only']]); grp('Model', 'model', [['fast', 'Fast'], ['default', 'Balanced'], ['deep', 'Deep']]); grp('Thinking', 'think', [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Med'], ['high', 'High']]);
  paintMeta();
}
function mdBox(text) { return el('div', { class: 'md', html: IDE.md(text) }); }
function makeStepUI(code) {
  const first = code.split('\n').find((l) => l.trim()) || '', nm = el('span', { class: 'nm', text: 'eval' }), fst = el('span', { class: 'first', text: first.trim() }), ms = el('span', { class: 'ms', text: '…' });
  const d = el('details', { class: 'tool run' }), sum = el('summary', {}, el('span', { class: 'dot' }), nm, fst, ms), tb = el('div', { class: 'tb' });
  d.append(sum, tb); tb.append(el('pre', { class: 'src', html: IDE.highlight(code) })); return { d, tb, ms, set(cls) { d.className = 'tool ' + cls; } };
}
function approval(stepUI, text, queued) {
  return new Promise((resolve) => {
    stepUI.set('ask'); stepUI.d.open = true; stepUI.ms.textContent = 'waiting for you';
    const row = el('div', { class: 'apv' }, el('span', { class: 'what', text }), el('button', { class: 'btn sm primary', text: queued && queued.length > 1 ? 'Approve all' : 'Approve', onclick: () => done(true) }), el('button', { class: 'btn sm', text: queued && queued.length > 1 ? 'Skip all' : 'Skip', onclick: () => done(false) }));
    const done = (ok) => { row.remove(); stepUI.set('run'); stepUI.ms.textContent = '…'; resolve(ok); }; stepUI.tb.append(row); A.pendingApproval = () => done(false); scrollLog();
  });
}
function sentThumbs(atts) { const row = el('div', { class: 'sent' }); for (const a of atts) { const f = el('figure', { title: attDesc(a) }, el('img', { src: a.thumb, alt: a.name }), el('figcaption', { text: a.id })); f.querySelector('img').addEventListener('click', () => f.classList.toggle('big')); row.append(f); } return row; }
function trimAtts(t) { const all = [...t.atts.values()]; for (const a of all.slice(0, Math.max(0, all.length - ATT_KEEP))) { a.rgba = null; a.img = null; } }
async function send() {
  if (A.busy) return; let text = ui.input.value.trim(); const atts = A.pending.slice(); if (!text && !atts.length) return; if (!IDE.caps.sample) return paintCaps();
  if (!S.rb) { const ok = await IDE.runMain({ quiet: true }); if (!ok) return; }
  if (!text) text = atts.length > 1 ? 'Look at these pictures.' : 'Look at this picture.';
  const t = A.cur; if (t.title === 'New thread') { t.title = text.slice(0, 26) + (text.length > 26 ? '…' : ''); paintThreads(); }
  ui.input.value = ''; A.pending = []; paintAtts(); for (const a of atts) t.atts.set(a.id, a); trimAtts(t); if (!t.log.querySelector('.msg')) t.log.innerHTML = '';
  t.log.append(el('div', { class: 'msg user' }, el('div', { class: 'who', text: 'You' }), el('div', { class: 'body' }, el('span', { text }), atts.length ? sentThumbs(atts) : null)));
  await run(t, text, atts);
}
async function run(t, userText, atts) {
  atts = atts || []; rb().agent({ mode: MODE_CFG[A.mode] });
  A.busy = true; A.ctl = new AbortController(); ui.send.hidden = true; ui.stop.hidden = false; paintSettings(); paintThreads(); IDE.emit('agent-busy', true);
  const msg = el('div', { class: 'msg agent' }, el('div', { class: 'who', text: 'Agent' })); t.log.append(msg); scrollLog();
  const sample = IDE.caps.sample, sys = { role: 'user', content: systemText() }, done = [];
  const earlier = [...t.atts.values()].filter((a) => !atts.includes(a)), lim = imgMax(), attBlobs = A.noImages ? [] : atts.map((a) => a.blob), lookCap = Math.max(0, Math.min(6, lim - attBlobs.length));
  const attNote = (atts.length ? '\nattached to this message' + (A.noImages ? ' (pictures cannot be shown in this view; lab.attachment still gives you the pixels)' : ' (shown to you with it, in this order)') + ': ' + atts.map(attDesc).join('; ') : '') + (earlier.length ? '\nattached earlier in this thread (not shown now; lab.look(\'' + earlier[earlier.length - 1].id + '\') shows one again): ' + earlier.map(attDesc).join('; ') : '');
  const nowText = contextText() + attNote + '\n\n' + userText;
  let images = [], finalText = null, failed = false, stepsSummary = [];
  const trim = () => { let n = t.history.reduce((a, m) => a + m.content.length, 0); while (n > 110000 && t.history.length > 2) { n -= t.history[0].content.length + t.history[1].content.length; t.history.splice(0, 2); } }; trim();
  try {
    for (let n = 0; n < MAX_STEPS + 1; n++) {
      const turns = [sys, ...t.history, { role: 'user', content: nowText }];
      const old = done.slice(0, -2), recent = done.slice(-2);
      if (old.length) { turns.push({ role: 'assistant', content: 'Earlier steps (compressed):\n' + old.map((d) => oneLine(d.code, d.result)).join('\n') }); turns.push({ role: 'user', content: '(your earlier steps are summarised above; their images are no longer attached)' }); }
      for (const d of recent) { turns.push({ role: 'assistant', content: d.assistant }); turns.push({ role: 'user', content: '[result]\n' + d.result + (d.looks.length ? '\n(' + d.looks.length + ' image' + (d.looks.length > 1 ? 's' : '') + ' attached' + (d === recent[recent.length - 1] ? '' : ' earlier, no longer shown') + ')' : '') }); }
      if (n >= MAX_STEPS) turns.push({ role: 'user', content: 'Step limit reached. Reply now with your final answer from what you have; do not run more code.' });
      const body = el('div', { class: 'md thinking', text: 'Thinking' }); msg.append(body);
      const opts = { cache: false, signal: A.ctl.signal, modelTier: TIER[A.model] || 'default', onText: ({ text }) => { const i = text.indexOf('```eval'); const vis = (i >= 0 ? text.slice(0, i) : text).trim(); body.className = 'md'; body.innerHTML = vis ? IDE.md(vis) : ''; if (i >= 0) body.append(el('div', { class: 'thinking', text: 'Writing code' })); scrollLog(); } };
      if (A.think !== 'auto' && A.model !== 'fast') opts.effort = A.think;
      const shown = A.noImages ? [] : [...attBlobs, ...images].slice(0, lim); if (shown.length) opts.images = shown;
      let res; try { res = await sample(turns, opts); } catch (e) { body.remove(); throw e; }
      const text = res.text, m = /```eval[ \t]*\r?\n([\s\S]*?)```/.exec(text);
      if (!m) {
        if (/```eval/.test(text) && n < MAX_STEPS) { body.remove(); done.push({ code: '(unterminated block)', assistant: text, result: 'The eval block was not closed with ```. Resend the complete block.', looks: [] }); images = []; continue; }
        body.className = 'md'; body.innerHTML = IDE.md(text.trim()); finalText = text.trim(); break;
      }
      const code = m[1], prose = text.slice(0, m.index).trim(); body.className = 'md'; if (prose) body.innerHTML = IDE.md(prose); else body.remove();
      const su = makeStepUI(code); msg.append(su.d); scrollLog();
      const r = rb(), step = { code, looks: [], approved: false, t0: performance.now(), atts: atts.map((a) => a.id), cap: lookCap }; let result, bad = false;
      if (A.mode === 'ask' && WRITE_RE.test(code)) { const what = 'Changes outside the mutation log: lab.' + (WRITE_RE.exec(code) || [0, 'write'])[1]; const ok = await approval(su, what); if (!ok) { result = 'Error: the user denied this step. Do not retry it; ask what they would prefer or continue without changing anything.'; bad = true; } else step.approved = true; }
      const stackBefore = r.undoStack.length, hashBefore = r.state.hash, pendBefore = r.pending.length; let queuedNote = '';
      if (!bad) { try { result = fmtResult(await runCode(code, step)); } catch (e) { result = errText(e, code); bad = true; } }
      if (A.mode === 'ask' && r.pending.length > pendBefore) { /* mutations were queued: ask now, so the next turn knows what happened */
        const q = r.pending.slice(pendBefore); su.ms.textContent = 'waiting for you'; const ok = await approval(su, (q.length === 1 ? 'Approve: ' : 'Approve ' + q.length + ' changes: ') + q.map((x) => x.desc).join('; '), q);
        const ids = q.map((x) => x.id); if (ok) { IDE.withBy(() => { for (const id of ids) r.approve(id); }); queuedNote = `\n[the user approved ${q.length} queued change${q.length > 1 ? 's' : ''}: ${q.map((x) => x.desc).join('; ')}]`; } else { for (const id of ids) r.skip(id); queuedNote = `\n[the user skipped ${q.length} queued change${q.length > 1 ? 's' : ''}; nothing was applied. Do not retry them; ask what they would prefer]`; }
      }
      result += queuedNote;
      const blobs = []; for (const l of step.looks) { try { blobs.push(await l.blob); } catch (e) { result += '\n(image ' + l.id + ' could not be encoded)'; } }
      su.ms.textContent = Math.round(performance.now() - step.t0) + ' ms'; su.set(bad ? 'err' : ''); su.tb.append(el('pre', { class: 'res' + (bad ? ' bad' : ''), text: result }));
      if (blobs.length) { const th = el('div', { class: 'thumbs' }); blobs.forEach((b, i) => { const url = URL.createObjectURL(b), f = el('figure', {}, el('img', { src: url, alt: step.looks[i].header }), el('figcaption', { text: step.looks[i].header })); f.querySelector('img').addEventListener('click', () => f.classList.toggle('big')); th.append(f); }); su.tb.append(th); su.d.open = true; }
      const changed = hashBefore !== r.state.hash;
      if (changed) { const row = el('div', { class: 'row' }, el('span', { class: 'dim', text: 'This step changed the workbench.' })); const rv = el('button', { class: 'btn sm', text: 'Revert', onclick: () => { IDE.withBy(() => { while (r.undoStack.length > stackBefore) r.undo(); }); row.remove(); su.d.classList.add('reverted'); } }); row.append(rv); su.tb.append(row); }
      stepsSummary.push(oneLine(code, result)); done.push({ code, assistant: text.slice(0, m.index + m[0].length), result, looks: blobs }); images = blobs;
      scrollLog();
    }
    if (finalText === null) finalText = '(no answer)';
  } catch (e) {
    failed = true; if (msg.lastChild && msg.lastChild.classList && msg.lastChild.classList.contains('thinking')) msg.lastChild.remove();
    const code = e && e.code ? e.code : 'upstream_error'; if (code === 'images_unavailable') A.noImages = true;
    if (code !== 'cancelled') { msg.classList.add('error'); msg.querySelector('.who').textContent = 'Agent · stopped'; msg.append(el('div', { class: 'md', text: ERR[code] != null ? ERR[code] : (e && e.message) || 'Something went wrong.' })); if (e && e.text) msg.append(el('div', { class: 'md dim', text: 'Partial answer: ' + e.text.slice(0, 1200) })); }
    else msg.append(el('div', { class: 'note', text: 'Stopped.' }));
    if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].includes(code)) { IDE.caps.sample = null; IDE.caps.known = true; paintCaps(); }
  } finally { A.busy = false; A.ctl = null; V2.by = undefined; IDE.agentStep = false; ui.send.hidden = false; ui.stop.hidden = true; paintSettings(); paintSend(); paintThreads(); IDE.emit('agent-busy', false); scrollLog(); }
  const um = userText + (atts.length ? '\n[attached: ' + atts.map(attDesc).join('; ') + ']' : '');
  if (!failed && finalText != null) t.history.push({ role: 'user', content: um }, { role: 'assistant', content: (stepsSummary.length ? stepsSummary.slice(-8).join('\n') + '\n\n' : '') + finalText });
  else if (failed) t.history.push({ role: 'user', content: um }, { role: 'assistant', content: (stepsSummary.length ? stepsSummary.slice(-8).join('\n') + '\n' : '') + '(this turn was interrupted)' });
}
IDE.views.agent = () => IDE.makeView((v) => {
  const root = v.el; root.classList.add('v-agent');
  const panel = el('div', { class: 'agent-panel' }); root.append(panel);
  ui.root = root; ui.threads = el('div', { class: 'threads' }); ui.settings = el('div', { class: 'agent-set' }); ui.off = el('div', { class: 'agent-off', hidden: true }); ui.logHost = el('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } });
  ui.input = el('textarea', { placeholder: 'Ask the agent: “is anything clipping?”, “add a mosaic of the papers”, “make a warm preset”, “explain this script”', 'aria-label': 'Message to the agent', rows: 2 });
  ui.send = el('button', { class: 'btn primary', text: 'Send', disabled: true, onclick: send }); ui.stop = el('button', { class: 'btn danger', text: 'Stop', hidden: true, onclick: () => { if (A.pendingApproval) A.pendingApproval(); if (A.ctl) A.ctl.abort(); } }); ui.meta = el('span', { class: 'meta' });
  ui.atts = el('div', { class: 'atts', hidden: true }); ui.file = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: () => { const fs = [...ui.file.files]; ui.file.value = ''; addFiles(fs); } });
  ui.attach = el('button', { class: 'btn', text: 'Attach…', title: 'Attach pictures the agent can see. You can also paste or drop them here.', hidden: true, onclick: () => ui.file.click() });
  ui.composer = el('div', { class: 'composer' }, ui.atts, ui.input, el('div', { class: 'row' }, ui.meta, ui.attach, ui.send, ui.stop), ui.file);
  ui.input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!ui.send.disabled) send(); } });
  ui.input.addEventListener('input', paintSend);
  panel.append(ui.threads, ui.settings, ui.off, ui.logHost, ui.composer);
  root.tabIndex = -1;
  root.addEventListener('paste', (e) => { const fs = [...(e.clipboardData ? e.clipboardData.items : [])].filter((i) => i.kind === 'file' && i.type.startsWith('image/')).map((i) => i.getAsFile()).filter(Boolean); if (!fs.length) return; e.preventDefault(); e.stopPropagation(); addFiles(fs); });
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  const drop = (on) => { if (A.dropping === on) return; A.dropping = on; root.classList.toggle('dropping', on); paintMeta(); };
  root.addEventListener('dragenter', (e) => { if (hasFiles(e)) { e.preventDefault(); drop(true); } });
  root.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); drop(true); } });
  root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget)) drop(false); });
  root.addEventListener('drop', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); drop(false); addFiles(e.dataTransfer.files); });
  if (!A.threads.length) newThread(); else selectThread(A.cur || A.threads[0]);
  paintSettings(); paintCaps(); paintSend();
  IDE.on('caps', () => { paintCaps(); paintSettings(); paintSend(); });
  v.onShow = () => { scrollLog(); };
});
IDE.agentBusy = () => A.busy;
})();

/* Filmbench IDE — part 8: the shell. Header, IDE dock and layouts, menus, status bar, theme, capabilities, shortcuts, boot. */
(function () {
'use strict';
const { el, $, $$, clamp, clone, store } = IDE, V2 = window.V2, S = IDE.session, T = IDE.Tree;

/* ---------- the views ---------- */
IDE.VIEWS = {
  files: { title: 'Files', about: 'the scripts of this workbench' },
  code: { title: 'Code', about: 'editor with run and problems' },
  console: { title: 'Console', about: 'output and a REPL on the live bench' },
  workspace: { title: 'Workspace', about: 'tiles: pictures, plots, mosaics' },
  controls: { title: 'Controls', about: 'sliders and schemes from ctl' },
  layers: { title: 'Layers', about: 'looks, adjustments, macros and the layer stack' },
  graph: { title: 'Graph', about: 'the pipeline as a DAG' },
  history: { title: 'History', about: 'every mutation, with undo' },
  reference: { title: 'Reference', about: 'the v2 API and these tools' },
  agent: { title: 'Agent', about: 'ask questions, take looks, make presets' },
};
const tl = (...v) => T.tile(v.flat(), 0), tla = (act, ...v) => T.tile(v, act), row = (sizes, ...kids) => ({ t: 'split', dir: 'row', kids, sizes }), col = (sizes, ...kids) => ({ t: 'split', dir: 'col', kids, sizes });
IDE.LAYOUTS = {
  Studio: () => row([0.77, 0.23],
    col([0.64, 0.36], row([0.15, 0.33, 0.52], tl('files', 'reference'), tl('code'), tl('workspace')), row([0.42, 0.58], tl('console', 'history'), tl('graph'))),
    col([0.42, 0.58], tl('controls', 'layers'), tl('agent'))),
  Darkroom: () => row([0.68, 0.32], tl('workspace'), col([0.6, 0.4], tl('controls', 'layers'), tl('agent'))),
  Code: () => row([0.16, 0.5, 0.34], col([0.62, 0.38], tl('files'), tl('reference')), col([0.68, 0.32], tl('code'), tl('console', 'history')), col([0.62, 0.38], tl('workspace'), tl('graph', 'controls'))),
  Agent: () => row([0.5, 0.5], col([0.68, 0.32], tl('workspace'), tl('console')), col([0.66, 0.34], tl('agent'), tl('controls', 'layers'))),
  Inspect: () => row([0.5, 0.5], col([0.62, 0.38], tl('graph'), tl('history', 'console')), col([0.6, 0.4], tl('workspace'), tl('controls', 'layers'))),
};
const known = (id) => !!IDE.VIEWS[id];
const sane = (t) => { try { return T.norm(clone(t), { known, keepRoot: true }); } catch (e) { return null; } };
IDE.state.layout = store.get('layoutName', 'Studio');
let tree = sane(store.get('tree', null) || {}) ; if (!tree || !T.views(tree).length) { tree = IDE.LAYOUTS[IDE.LAYOUTS[IDE.state.layout] ? IDE.state.layout : 'Studio'](); }
const userLayouts = () => store.get('layouts', {});
let dock = null, shellEl = null, hdr = {};

/* ---------- the IDE dock ---------- */
function makeDock() {
  dock = new IDE.Dock({
    narrow: 760, keepEmpty: true,
    items: (id) => { const m = IDE.VIEWS[id]; return m ? { title: m.title, about: m.about, make: () => { const mk = IDE.views[id]; if (!mk) throw new Error('view ' + id + ' is not defined'); return mk(); } } : null; },
    all: () => Object.keys(IDE.VIEWS),
    getTree: () => tree,
    setTree: (t) => { tree = sane(t) || tree; store.set('tree', tree); IDE.state.layout = 'custom'; store.set('layoutName', 'custom'); paintLayoutLabel(); },
    badge: (id) => {
      if (id === 'code') { const n = (IDE.editor.diags.get(IDE.editor.active) || []).length; return n ? { n, bad: true } : null; }
      if (id === 'console') return conErr ? { n: conErr, bad: true } : null;
      if (id === 'agent') return IDE.agentBusy && IDE.agentBusy() ? { n: '…' } : (S.rb && S.rb.pending.length ? { n: S.rb.pending.length, bad: false } : null);
      if (id === 'history') return null;
      return null;
    },
  });
  dock.focused = (id) => { if (id === 'console') { conErr = 0; dock.updateTabs(); } };
  if (innerWidth < 760) dock.sid = 'workspace';
  return dock;
}
let conErr = 0;
IDE.on('console', (ln) => { if (ln && ln.kind === 'err') { const v = dock && dock.views.get('console'); if (!v || !v.visible) { conErr++; dock && dock.updateTabs(); } } });
IDE.on('diags', () => dock && dock.updateTabs());
IDE.on('editor', () => dock && dock.updateTabs());
IDE.on('agent-busy', () => dock && dock.updateTabs());
IDE.focusView = function (id) {
  if (!dock || !IDE.VIEWS[id]) return; dock.focus(id); if (id === 'console') { conErr = 0; dock.updateTabs(); }
  const v = dock.views.get(id); if (v && v.el && v.el.scrollIntoView) { /* keep the page still; the dock handles visibility */ }
};
IDE.layoutUse = function (name) {
  const ul = userLayouts(), t = IDE.LAYOUTS[name] ? IDE.LAYOUTS[name]() : ul[name] ? clone(ul[name]) : null; if (!t) { IDE.toast('No layout called "' + name + '"', true); return; }
  tree = sane(t); store.set('tree', tree); IDE.state.layout = name; store.set('layoutName', name); if (dock) { dock.sig = ''; dock.render(); } paintLayoutLabel(); IDE.toast('Layout: ' + name);
};

/* ---------- menus ---------- */
let openMenu = null;
function closeMenu() { if (openMenu) { openMenu.el.remove(); document.removeEventListener('pointerdown', openMenu.off, true); document.removeEventListener('keydown', openMenu.key, true); if (openMenu.btn) openMenu.btn.setAttribute('aria-expanded', 'false'); openMenu = null; } }
function menu(btn, cls, build) {
  if (openMenu && openMenu.btn === btn) { closeMenu(); return; } closeMenu();
  const host = btn.closest('.rel') || btn.parentElement, m = el('div', { class: 'menu ' + (cls || ''), role: 'menu' }); build(m, closeMenu);
  host.append(m); btn.setAttribute('aria-expanded', 'true');
  const off = (e) => { if (!m.contains(e.target) && !btn.contains(e.target)) closeMenu(); }, key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); btn.focus(); } };
  setTimeout(() => document.addEventListener('pointerdown', off, true), 0); document.addEventListener('keydown', key, true); openMenu = { el: m, btn, off, key };
  const r = m.getBoundingClientRect(); if (r.right > innerWidth - 6) { m.style.left = 'auto'; m.style.right = '0'; } if (r.left < 6) { m.style.left = '0'; m.style.right = 'auto'; }
  return m;
}
const item = (label, o) => { o = o || {}; return el('button', { role: 'menuitem', class: o.on ? 'on' : o.danger ? 'danger' : '', disabled: o.disabled, title: o.title, onclick: () => { closeMenu(); o.run && o.run(); } }, o.box !== undefined ? el('span', { class: 'box' + (o.box ? ' on' : '') }) : null, el('span', { class: 't', text: label }), o.sub ? el('small', { text: o.sub }) : null); };
const grp = (t) => el('div', { class: 'grp', text: t });
const byUser = (fn) => IDE.withBy(fn);

/* ---------- header ---------- */
function stockName(id) { const rb = S.rb; try { return rb.stock(id).name.replace(/^(Kodak|Fujifilm|Fuji|Ilford)\s+/, ''); } catch (e) { return id; } }
function buildHeader() {
  const bar = el('header', { class: 'bar' });
  const brand = el('div', { class: 'brand' }, 'Filmbench', el('i', { text: 'IDE' }));
  const benchBtn = el('button', { class: 'projbtn', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'Film, paper and scene of the main pipeline' }, el('span', { class: 'ptitle', text: '—' }), el('span', { class: 'pcode', text: '' }), el('span', { class: 'caret', text: '▾' }));
  const proj = el('div', { class: 'proj rel' }, benchBtn);
  benchBtn.addEventListener('click', () => menu(benchBtn, 'sceneMenu', (m) => {
    const rb = S.rb; if (!rb) { m.append(item('no session yet', { disabled: true })); return; }
    const net = rb.mainNet(), cur = net && net.stage('scene') ? net.stage('scene').opts.scene : '';
    m.append(grp('scene'));
    for (const id of Object.keys(rb.scenes)) m.append(item(rb.scenes[id].name || id, { box: cur === id, sub: id, run: () => byUser(() => rb.apply({ op: 'pipe.scene', scene: id }, 'user')) }));
    m.append(item('Open a picture…', { sub: 'or paste / drop one anywhere', run: () => hdr.file.click() }));
    m.append(grp('stocks'));
    m.append(item('Film: ' + stockName(rb.params.effective('film')), { sub: 'change it in Controls or with wb.set("film", …)', disabled: true }));
    m.append(item('Paper: ' + stockName(rb.params.effective('print')), { disabled: true }));
  }));
  const looksBtn = el('button', { class: 'btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, 'Looks ▾');
  looksBtn.addEventListener('click', () => menu(looksBtn, 'presets', (m) => {
    const rb = S.rb; if (!rb) { m.append(item('no session yet', { disabled: true })); return; }
    const P = rb.params, ps = [...rb.presets.values()], cur = P.layers.look.preset;
    const add = (title, list, adj) => { if (!list.length) return; m.append(grp(title)); for (const p of list) { const stacked = P.layers.look.contrib.has(p.name) && p.kind !== 'look', on = p.kind === 'look' ? cur === p.name : stacked; m.append(item(p.name, { box: on, sub: p.desc, run: () => byUser(() => (p.kind === 'look' || p.user ? rb.apply({ op: 'layer.use', layer: 'look', preset: p.name }, 'user') : rb.apply({ op: 'layer.stack', layer: 'look', preset: p.name, on: !stacked }, 'user'))) })); } };
    add('Looks', ps.filter((p) => p.kind === 'look' && !p.user)); add('Adjustments (stack)', ps.filter((p) => p.kind !== 'look' && !p.user)); add('Yours', ps.filter((p) => p.user));
    m.append(el('hr')); m.append(item('Save current look…', { run: () => IDE.savePreset() })); m.append(item('Clear the look', { disabled: !cur && !P.layers.look.contrib.size, run: () => byUser(() => rb.apply({ op: 'layer.clear', layer: 'look' }, 'user')) })); m.append(item('Open Layers', { run: () => IDE.focusView('layers') }));
  }));
  const layoutBtn = el('button', { class: 'btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, el('span', { class: 'lbl', text: 'Layout' }), ' ▾');
  layoutBtn.addEventListener('click', () => menu(layoutBtn, 'layouts', (m) => {
    m.append(grp('arrangements'));
    for (const n of Object.keys(IDE.LAYOUTS)) m.append(item(n, { on: IDE.state.layout === n, run: () => IDE.layoutUse(n) }));
    const ul = userLayouts(), names = Object.keys(ul); if (names.length) { m.append(grp('yours')); for (const n of names) { const b = item(n, { on: IDE.state.layout === n, run: () => IDE.layoutUse(n) }); b.append(el('span', { class: 'x', role: 'button', 'aria-label': 'Delete layout ' + n, title: 'Delete', text: '×', onclick: (e) => { e.stopPropagation(); const u = userLayouts(); delete u[n]; store.set('layouts', u); closeMenu(); } })); m.append(b); } }
    m.append(el('hr'));
    m.append(item('Save this layout as…', { run: async () => { const r = await IDE.ask({ title: 'Save this layout', ok: 'Save', fields: [{ key: 'n', label: 'Name', value: 'My layout' }] }); if (!r) return; const u = userLayouts(); u[r.n] = clone(tree); store.set('layouts', u); IDE.state.layout = r.n; store.set('layoutName', r.n); paintLayoutLabel(); IDE.toast('Saved layout "' + r.n + '"'); } }));
    m.append(item('Reset to Studio', { run: () => IDE.layoutUse('Studio') }));
    m.append(el('p', { class: 'note', text: 'Drag a tab to move it: onto a tab strip to reorder, onto the middle of a tile to join it, onto an edge to split. Press + on a strip to open a view. The Workspace has its own layouts for the tiles inside it.' }));
  }));
  const undoBtn = el('button', { class: 'ibtn', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo', text: '↶', onclick: () => doUndo(false) }), redoBtn = el('button', { class: 'ibtn', title: 'Redo (Ctrl+Shift+Z)', 'aria-label': 'Redo', text: '↷', onclick: () => doUndo(true) });
  const runBtn = el('button', { class: 'btn primary', title: 'Run main.js again from scratch (Ctrl+Enter in the editor runs the open file)', onclick: () => IDE.runMain() }, el('span', { class: 'glyph', text: '▶' }), el('span', { class: 'hide-s', text: 'Run main.js' }));
  const exportBtn = el('button', { class: 'btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, 'Export…');
  exportBtn.addEventListener('click', () => menu(exportBtn, 'right bexport', (m) => {
    const rb = S.rb; if (!rb) { m.append(item('no session yet', { disabled: true })); return; }
    m.append(grp('picture (the print)'));
    for (const [fmt, edge, sub] of [['png', 1280, 'lossless'], ['png', 2048, 'lossless, larger'], ['jpeg', 2048, 'smaller file'], ['webp', 2048, 'smaller file'], ['png', 3200, 'full working size']]) m.append(item(`${fmt.toUpperCase()} · ${edge} px`, { sub, run: async () => { try { const r = await IDE.exportImage({ fmt, edge }); IDE.toast('Saved ' + r.saved + ' (' + Math.round(r.bytes / 1024) + ' KB)'); } catch (e) { IDE.toast(String(e.message || e).split('\n')[0], true); } } }));
    m.append(grp('other taps'));
    for (const tap of rb.mainNet() ? rb.mainNet().taps.filter((t) => ['cmy_film', 'cmy_print', 'log_e_film'].includes(t)) : []) m.append(item(tap + ' as PNG', { sub: 'false colour of the intermediate', run: async () => { try { const r = await IDE.exportImage({ fmt: 'png', edge: 1280, tap }); IDE.toast('Saved ' + r.saved); } catch (e) { IDE.toast(String(e.message || e).split('\n')[0], true); } } }));
    m.append(grp('this workbench'));
    m.append(item('Copy as a script', { sub: 'wb.script()', run: async () => { try { const t = String(rb.script()); await navigator.clipboard.writeText(t); IDE.toast('Script copied (' + t.length + ' characters)'); } catch (e) { IDE.print('log', rb.script()); IDE.focusView('console'); } } }));
    m.append(item('Download all scripts (.json)', { run: async () => { const files = {}; for (const p of IDE.vfs.list()) files[p] = IDE.vfs.read(p); const blob = new Blob([JSON.stringify({ filmbench: 2, files }, null, 1)], { type: 'application/json' }); const dl = IDE.caps.downloads; try { if (dl && dl.save) await dl.save({ filename: 'filmbench-scripts.json', data: blob }); else { const a = el('a', { href: URL.createObjectURL(blob), download: 'filmbench-scripts.json' }); document.body.append(a); a.click(); setTimeout(() => a.remove(), 1000); } IDE.toast('Scripts saved'); } catch (e) { IDE.toast(String(e.message || e), true); } } }));
  }));
  const themeBtn = el('button', { class: 'ibtn', title: 'Light / dark', 'aria-label': 'Toggle the theme', onclick: () => IDE.setTheme(IDE.state.theme === 'dark' ? 'light' : 'dark') });
  const status = el('span', { class: 'pill', title: 'The state hash changes whenever a parameter, layer, preset or tile changes' }, el('b', { text: '' }), el('span', { text: '' }));
  const file = el('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => { const f = file.files[0]; file.value = ''; if (f) IDE.usePicture(f); } });
  bar.append(brand, proj, el('div', { class: 'rel' }, looksBtn), el('div', { class: 'rel' }, layoutBtn), el('div', { class: 'sp' }), status, undoBtn, redoBtn, runBtn, el('div', { class: 'rel' }, exportBtn), themeBtn, file);
  hdr = { bar, benchBtn, looksBtn, layoutBtn, undoBtn, redoBtn, runBtn, status, themeBtn, file };
  return bar;
}
function paintLayoutLabel() { if (hdr.layoutBtn) { const l = hdr.layoutBtn.querySelector('.lbl'); l.textContent = 'Layout · ' + (IDE.state.layout === 'custom' ? 'custom' : IDE.state.layout); } }
function paintHeader() {
  const rb = S.rb, h = hdr; if (!h.bar) return;
  h.themeBtn.textContent = IDE.state.theme === 'dark' ? '☼' : '☾'; h.themeBtn.title = IDE.state.theme === 'dark' ? 'Switch to light' : 'Switch to dark';
  h.runBtn.disabled = !!S.running; h.runBtn.classList.toggle('busy', !!S.running);
  if (!rb) { h.benchBtn.querySelector('.ptitle').textContent = S.running ? 'running main.js…' : 'no session'; h.benchBtn.querySelector('.pcode').textContent = ''; h.status.className = 'pill'; h.status.firstChild.textContent = '—'; h.status.lastChild.textContent = ''; h.undoBtn.disabled = h.redoBtn.disabled = true; return; }
  let film = '', print = '', scene = ''; try { film = stockName(rb.params.effective('film')); print = stockName(rb.params.effective('print')); const net = rb.mainNet(), st = net && net.stage('scene'); scene = st ? st.opts.scene : ''; } catch (e) { /* mid-run */ }
  h.benchBtn.querySelector('.ptitle').textContent = film + ' → ' + print; h.benchBtn.querySelector('.pcode').textContent = scene;
  const pend = rb.pending.length; h.status.className = 'pill' + (S.running ? ' busy' : '') + (pend ? ' bad' : '');
  h.status.firstChild.textContent = pend ? pend + ' pending' : rb.state.hash.slice(0, 6); h.status.lastChild.textContent = pend ? 'approve in Agent' : 'state';
  h.undoBtn.disabled = !rb.undoStack.length; h.redoBtn.disabled = !rb.redoStack.length;
}
function doUndo(redo) { const rb = S.rb; if (!rb) return; byUser(() => (redo ? rb.redo() : rb.undo())); }

/* ---------- status bar ---------- */
function buildStatus() {
  const bar = el('footer', { class: 'statusbar', role: 'status' }), left = el('span', { class: 'sl' }), mid = el('span', { class: 'sm' }), right = el('span', { class: 'sr' });
  bar.append(left, mid, right); hdr.sb = { bar, left, mid, right }; return bar;
}
let lastRun = '';
IDE.on('console', (ln) => { if (ln && ln.kind === 'info') { const t = String(ln.nodes[0] && ln.nodes[0].textContent || ''); if (/^ran /.test(t)) lastRun = t; } });
function paintStatus() {
  const s = hdr.sb; if (!s) return; const rb = S.rb;
  s.left.textContent = S.running ? 'running…' : lastRun || (rb ? 'ready' : 'no session');
  if (!rb) { s.mid.textContent = ''; s.right.textContent = ''; return; }
  const net = rb.mainNet(); let eng = ''; try { eng = net ? net.explain().lines.slice(0, 1).join('') : ''; } catch (e) { /* ignore */ }
  s.mid.textContent = `${rb.log.length} mutations · undo ${rb.undoStack.length} · mode ${rb.agentCfg.mode}`;
  s.right.textContent = `${rb.ws.tiles.size} tiles · ${rb.ctl.list().length} controls · ${rb.presets.size} presets${eng ? ' · ' + eng : ''}`;
}
let hq = false; const paintAll = () => { if (hq) return; hq = true; requestAnimationFrame(() => { hq = false; paintHeader(); paintStatus(); }); };
IDE.on('change', paintAll); IDE.on('bench', paintAll); IDE.on('running', paintAll); IDE.on('caps', paintAll);

/* ---------- theme ---------- */
IDE.setTheme = function (t) { IDE.state.theme = t; document.documentElement.dataset.theme = t; store.set('theme', t); paintHeader(); IDE.emit('theme', t); IDE.scheduleChange(); };

/* ---------- capabilities (they arrive later than the first script run) ---------- */
function getCaps() {
  const c = window.claude; const done = () => { IDE.caps.known = true; IDE.emit('caps'); };
  if (!c || !c.use) { done(); return; }
  c.use('downloads').then((d) => { IDE.caps.downloads = d || null; IDE.emit('caps'); }).catch(() => {});
  c.use('sample').then(async (s) => { IDE.caps.sample = s || null; if (s && s.limits) { try { IDE.caps.limits = await s.limits(); } catch (e) { IDE.caps.limits = null; } } done(); }).catch(done);
}

/* ---------- shortcuts ---------- */
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey, tag = e.target && e.target.tagName, typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable);
  if (mod && !typing && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); doUndo(e.shiftKey); }
  else if (mod && !typing && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); doUndo(true); }
  else if (e.altKey && /^[1-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey) { const ids = Object.keys(IDE.VIEWS), id = ids[+e.key - 1]; if (id) { e.preventDefault(); IDE.focusView(id); } }
});

/* ---------- boot ---------- */
async function inflateBytes(u8) { const ds = new DecompressionStream('deflate'), w = ds.writable.getWriter(); w.write(u8); w.close(); return new Uint8Array(await new Response(ds.readable).arrayBuffer()); }
IDE.boot = async function () {
  const app = $('#app'); const say = (a, b, bad) => { app.innerHTML = ''; app.append(el('div', { class: 'boot-screen' }, el('div', {}, el('b', { text: a }), el('span', { class: bad ? 'bad' : '', text: b || '' })))); };
  try {
    say('Filmbench', 'Unpacking film and paper data…');
    const b64 = document.getElementById('film-data').textContent.trim(), bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(await inflateBytes(bin))); await FB.decodeLuts(data, inflateBytes);
    V2.init(data, CC24);
    const th = store.get('theme', null) || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); IDE.state.theme = th; document.documentElement.dataset.theme = th;
    say('Filmbench', 'Starting the workbench…');
    app.innerHTML = ''; shellEl = el('div', { class: 'shell' }); const main = el('main', { class: 'ide' }); makeDock(); main.append(dock.root);
    shellEl.append(buildHeader(), main, buildStatus()); app.append(shellEl); paintLayoutLabel(); dock.render(); paintHeader(); paintStatus();
    getCaps();
    await IDE.runMain({ quiet: false });
    paintHeader(); paintStatus();
    new ResizeObserver(() => { dock.onResize(); }).observe(main);
  } catch (e) { console.error(e); say('Filmbench could not start', String(e && e.message || e), true); }
};
window.addEventListener('error', (e) => { if (!e.error) return; try { IDE.print('err', 'uncaught: ' + (e.error.message || e.message)); } catch (x) { /* console not ready */ } });
window.addEventListener('unhandledrejection', (e) => { try { IDE.print('err', 'unhandled: ' + ((e.reason && e.reason.message) || e.reason)); } catch (x) { /* console not ready */ } });
})();

IDE.vfs.define({"controls.js": "// controls.js — three ways to hold the same parameters.\n//   engineer   every parameter of the model, generated from the parameter table (ctl.fromSpec)\n//   darkroom   what a printer reaches for: exposure in stops, filtration, paper grade, surface\n//   colourist  warmth, tint, saturation, contrast, a colour-balance pad, texture\n// A scheme only arranges controls; it owns no state. Switch between them in the Controls view\n// (or ctl.use('engineer')) and the values stay where they are. Controls can also be docked as tiles.\n\nconst { CC, STOPS } = units;\nconst GRADE = [[0, 0.7], [1, 0.82], [2, 1], [3, 1.2], [4, 1.45], [5, 1.8]];   // paper grade to morph.gamma\nconst signed = (d, u = '') => (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d) + u;\n\n// ---- macros: a gesture that drives several parameters ----------------------------------------\n// They live in the 'macros' layer, so Layers shows them, Clear removes them, and ctl.why(path) explains them.\nexport function macros(wb) {\n  const { ctl } = wb;\n  const stops = ctl.macro('print stops', { range: [-3, 3], step: 1 / 6, unit: STOPS })\n    .drives('enlarger.print_exposure', { stops: 1 });                  // +1 stop of light on the paper: a darker print\n\n  const warmth = ctl.macro('warmth', { range: [-1, 1], step: 0.05 })\n    .drives('enlarger.y_shift', { gain: -24 })                         // less yellow filtration warms the print\n    .drives('enlarger.c_shift', { gain: 8, curve: 'easeIn' });         // a little cyan keeps the shadows from going orange\n\n  const tint = ctl.macro('tint', { range: [-1, 1], step: 0.05 })\n    .drives('enlarger.m_shift', { gain: -16 });                        // less magenta filtration: more magenta in the print\n\n  const saturation = ctl.macro('saturation', { range: [-1, 1], step: 0.05 })\n    .drives('film_render.dir.amount', { gain: 0.5 })                   // DIR couplers: inter-layer inhibition\n    .drives('enlarger.y_shift', { map: [[-1, -0.7], [0, 0], [1, 2.3]] })   // trims that keep the greys neutral\n    .drives('enlarger.m_shift', { map: [[-1, -0.4], [0, 0], [1, -0.5]] });\n\n  const contrast = ctl.macro('contrast', { range: [-1, 1], step: 0.05 })\n    .drives('film_render.gamma', { gain: 0.2 });                       // the negative's contrast; Paper grade is the print's\n\n  const grade = ctl.macro('paper grade', { range: [0, 5], step: 0.5, value: 2 })\n    .apply((g, P) => (g === 2 ? {} : {                                 // grade 2 is the paper as profiled; nothing to say\n      'print_render.morph.active': op.set(true),\n      'print_render.morph.gamma': op.set(interp(GRADE, g)),\n      'enlarger.print_exposure': P.enlarger.normalize ? op.keep : op.stops(0.25 * (g - 2)),   // harder paper needs a little more light\n    }))\n    .read((P) => (P.print_render.morph.active ? interp.inverse(GRADE, P.print_render.morph.gamma) : 2));   // follows the parameters\n\n  const rolloff = ctl.macro('highlight roll-off', { range: [0, 1], step: 0.05 })\n    .apply((r) => (r === 0 ? {} : { 'print_render.morph.active': op.set(true), 'print_render.morph.fast': op.set(interp([[0, 1], [1, 0.6]], r)) }));\n\n  return { stops, warmth, tint, saturation, contrast, grade, rolloff };\n}\n\n// ---- 1. engineer ------------------------------------------------------------------------------\nexport function engineer(wb) {\n  wb.ctl.scheme('engineer', wb.ctl.fromSpec());\n}\n\n// ---- 2. darkroom ------------------------------------------------------------------------------\nexport function darkroom(wb, m) {\n  const { ctl } = wb;\n  const filter = (path, name) => ctl.slider(path).label(name).unit(CC).range(-40, 40).step(1).detents([0]).fmt(signed(0, ' CC'));\n  ctl.scheme('darkroom', (s) => {\n    s.group('Exposure')\n      .add(ctl.slider(m.stops).widget('dial').label('Print exposure'))          // a tick ruler: drag sideways, wheel, arrow keys\n      .add(ctl.slider('camera.ev').label('Film exposure').fmt(signed(2, ' EV')));\n    s.group('Filtration')\n      .add(filter('enlarger.y_shift', 'Yellow'))\n      .add(filter('enlarger.m_shift', 'Magenta'))\n      .add(filter('enlarger.c_shift', 'Cyan'));\n    s.group('Paper')\n      .add(ctl.slider(m.grade).widget('stepper').label('Grade'))\n      .add(ctl.choice('surface', { gloss: 0.3, lustre: 1.2, matte: 2.4 }).drives('print_render.glare'))\n      .add(ctl.slider(m.rolloff).label('Highlight roll-off'));\n    s.group('Local')\n      .add(ctl.button('dodge and burn').opens('mask editor').requires('mask'));  // needs a graph with a mask node (examples/05)\n  });\n}\n\n// ---- 3. colourist -----------------------------------------------------------------------------\nexport function colourist(wb, m) {\n  const { ctl } = wb;\n  ctl.scheme('colourist', (s) => {\n    s.group('Colour')\n      .add(ctl.slider(m.warmth).label('Warmth').detents([0]))\n      .add(ctl.slider(m.tint).label('Tint').detents([0]))\n      .add(ctl.slider(m.saturation).label('Saturation').detents([0]));\n    s.group('Tone')\n      .add(ctl.slider(m.stops).label('Density').fmt(signed(2, ' stops')))\n      .add(ctl.slider(m.contrast).label('Contrast').detents([0]));\n    s.group('Balance')\n      .add(ctl.wheel('colour balance').apply(([x, y]) => ({           // a square pad: right is warmer, up is more magenta\n        'enlarger.y_shift': op.add(-12 * x),\n        'enlarger.m_shift': op.add(-10 * y),\n      })));\n    s.group('Texture')\n      .add(ctl.toggle('film_render.grain.active'))\n      .add(ctl.slider('film_render.grain.amount').disabledWhen((P) => !P.film_render.grain.active))\n      .add(ctl.slider('film_render.grain.size_um').disabledWhen((P) => !P.film_render.grain.active))\n      .add(ctl.toggle('film_render.halation.active'))\n      .add(ctl.slider('film_render.halation.amount').disabledWhen((P) => !P.film_render.halation.active));\n  });\n}\n", "looks.js": "// looks.js — presets.\n// A preset is a named set of operations on parameter paths. Two kinds:\n//   look     replaces the previous look (the 'look' layer holds one): a film and a paper, with whatever the stock implies\n//   adjust   stacks on top of the look and of each other\n// Opacity of the look layer (Layers view) blends a look in; Clear takes it out. Your own presets, saved from the\n// Layers view or by the agent, are kept in the browser and shown under Yours.\n\n// the parameters a stock pair changes, found by diffing against the plain defaults\nconst flatten = (o, pre = '', out = {}) => {\n  for (const k of Object.keys(o)) { const v = o[k], q = pre ? pre + '.' + k : k; if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, q, out); else out[q] = v; }\n  return out;\n};\nconst stockOps = (film, print) => {\n  const base = flatten(FB.defaultParams()), now = flatten(FB.defaultParams(film, print)), ops = {};\n  for (const k of Object.keys(now)) if (JSON.stringify(now[k]) !== JSON.stringify(base[k]) && typeof now[k] !== 'object') ops[k] = now[k];\n  return Object.assign({ film, print }, ops);\n};\n\nconst LOOKS = [\n  ['Portra 400 → Portra Endura', 'kodak_portra_400', 'kodak_portra_endura', 'The reference look: neutral skin, soft shoulder, gentle contrast.'],\n  ['Ektar 100 → Endura Premier', 'kodak_ektar_100', 'kodak_endura_premier', 'Fine grain, saturated and punchy.'],\n  ['Pro 400H → Crystal Archive', 'fujifilm_pro_400h', 'fujifilm_crystal_archive_typeii', 'Pastel greens, cool shadows, airy highlights.'],\n  ['Gold 200 → Supra Endura', 'kodak_gold_200', 'kodak_supra_endura', 'Warm consumer negative with a golden cast.'],\n  ['Vision3 500T → 2383', 'kodak_vision3_500t', 'kodak_2383', 'Cine tungsten stock on release print; strong contrast, tungsten source in the head.'],\n  ['Velvia 100 (slide)', 'fujifilm_velvia_100', 'kodak_portra_endura', 'Very saturated slide film scanned directly.'],\n  ['Ektachrome 100 (slide)', 'kodak_ektachrome_100', 'kodak_portra_endura', 'Clean, neutral slide film.'],\n  ['Portra 160 → Portra Endura', 'kodak_portra_160', 'kodak_portra_endura', 'The finest-grain Portra: softer colour and gentler contrast than Portra 400.'],\n  ['Portra 800 pushed +1 → Portra Endura', 'kodak_portra_800_push1', 'kodak_portra_endura', 'Rated one stop high and pushed in development: stronger colour and more contrast.'],\n  ['UltraMax 400 → Supra Endura', 'kodak_ultramax_400', 'kodak_supra_endura', 'Everyday consumer colour: a little warmer than Portra, with deeper shadows.'],\n  ['X-Tra 400 → Crystal Archive', 'fujifilm_xtra_400', 'fujifilm_crystal_archive_typeii', 'Fuji consumer stock on Fuji paper: saturated colour and deep shadows.'],\n  ['C200 → Crystal Archive', 'fujifilm_c200', 'fujifilm_crystal_archive_typeii', 'Fuji 200-speed colour: strong saturation and firm shadows.'],\n  ['Vision3 250D → 2383', 'kodak_vision3_250d', 'kodak_2383', 'Daylight cine negative on release print: deep blacks and restrained colour.'],\n  ['Vision3 50D → 2383', 'kodak_vision3_50d', 'kodak_2383', 'The finest-grain cine daylight stock on release print.'],\n  ['Vision3 200T → 2383', 'kodak_vision3_200t', 'kodak_2383', 'Tungsten-balanced cine negative on release print.'],\n  ['Kodachrome 64 (slide)', 'kodak_kodachrome_64', 'kodak_portra_endura', 'Warm, yellow-leaning slide film with deep blacks.'],\n  ['Provia 100F (slide)', 'fujifilm_provia_100f', 'kodak_portra_endura', 'Neutral slide film with moderate saturation.'],\n];\n\nconst ADJUST = [\n  ['Warm filtration', 'Pull yellow filtration out: warmer print, same exposure.', { 'enlarger.y_shift': -10, 'enlarger.m_shift': 2 }],\n  ['Cool filtration', 'Add yellow filtration: cooler, bluer print.', { 'enlarger.y_shift': 10, 'enlarger.m_shift': -2 }],\n  ['Hard paper', 'Steeper print curves, deeper blacks.', { 'print_render.morph.active': true, 'print_render.morph.gamma': 1.3 }],\n  ['Soft paper', 'Flatter print curves, more shadow and highlight detail.', { 'print_render.morph.active': true, 'print_render.morph.gamma': 0.8 }],\n  ['Clean (no grain, no halation)', 'Remove the spatial effects to judge colour only.', { 'film_render.grain.active': false, 'film_render.halation.active': false }],\n  ['Heavy grain', 'Large, strong grain.', { 'film_render.grain.active': true, 'film_render.grain.amount': 2.5, 'film_render.grain.size_um': 22 }],\n  ['Fine grain', 'Small, light grain.', { 'film_render.grain.active': true, 'film_render.grain.amount': 0.5, 'film_render.grain.size_um': 7 }],\n  ['Overexpose +1', 'Film exposed one stop over. The enlarger compensates, so you see richer shadows and softer highlights, not a brighter print.', { 'camera.ev': 1 }],\n  ['Underexpose −1', 'Film exposed one stop under: thinner shadows, more grain, colour drift.', { 'camera.ev': -1 }],\n  ['Underexpose −2', 'Film exposed two stops under: thin, lifted shadows and colour drift. The enlarger compensates the brightness.', { 'camera.ev': -2 }],\n  ['Muted colour', 'Weaker DIR couplers: about 20% less saturation. Filtration is trimmed so greys stay neutral.', { 'film_render.dir.active': true, 'film_render.dir.amount': 0.5, 'enlarger.m_shift': -0.4, 'enlarger.y_shift': -0.7 }],\n  ['Rich colour', 'Stronger DIR couplers: about 30% more saturation. Filtration is trimmed so greys stay neutral.', { 'film_render.dir.active': true, 'film_render.dir.amount': 1.5, 'enlarger.m_shift': -0.5, 'enlarger.y_shift': 2.3 }],\n  ['Lighter print', 'Less enlarger exposure: a lighter, airier print from the same negative.', { 'enlarger.print_exposure': 0.75 }],\n  ['Darker print', 'More enlarger exposure: a deeper, moodier print.', { 'enlarger.print_exposure': 1.3 }],\n  ['Matte blacks', 'Surface glare lifts the blacks, the way a matte or scuffed print does.', { 'print_render.glare': 1.5 }],\n  ['Halation glow', 'Strong red-orange bloom around bright highlights.', { 'film_render.halation.active': true, 'film_render.halation.amount': 2.4 }],\n];\n\nexport function looks(wb) {\n  for (const [name, film, print, desc] of LOOKS) wb.preset(name, { kind: 'look', desc, builtin: true, ops: stockOps(film, print) });\n  for (const [name, desc, ops] of ADJUST) wb.preset(name, { kind: 'adjust', desc, builtin: true, ops });\n}\n", "main.js": "// main.js — the studio.\n// Runs first, from scratch, whenever you press Run main. Everything the other views show is made here:\n// a bench (the state), one pipeline, then looks, controls and workspace from the files it imports.\n// Edit any of them and press Run main; the picture, the controls and the tiles are rebuilt.\n// (Your saved looks and the open files survive a run; the undo history starts again.)\n\nimport { macros, engineer, darkroom, colourist } from './controls.js';\nimport { looks } from './looks.js';\nimport { probes, tiles, layouts } from './workspace.js';\nimport { zoneSystem } from './lib/zone.js';\nimport { pushPull } from './lib/pushpull.js';\n\nconst wb  = bench('studio');\nconst rig = wb.pipe('default')\n  .scene('still')                       // 'chart' is the 24-patch test chart; paste or drop a picture to use your own\n  .film('kodak_portra_400')             // expose, then develop        taps: log_e_film, cmy_film\n  .enlarger()                           // film density to print exposure   tap: log_e_print\n  .paper('kodak_portra_endura')         // print development           tap: cmy_print\n  .scan();                              // scan, XYZ, sRGB             tap: out\n\nprobes(wb);                             // named rectangles other things can point at: skin, shadow, sky\nwb.use(zoneSystem, pushPull);           // fragments: macros, lenses, tiles and a note for the agent, from lib/\nlooks(wb);                              // presets: Looks swap the stocks, Adjustments stack on top\n\nconst m = macros(wb);                   // one gesture, several parameters\nengineer(wb);                           // every parameter of the model, in the order of the table\ndarkroom(wb, m);                        // what a printer reaches for: stops, filtration, grade, surface\ncolourist(wb, m);                       // warmth, tint, saturation, contrast and a colour-balance pad\nwb.ctl.use('darkroom');\n\ntiles(wb);                              // the pictures and plots of the Workspace\nlayouts(wb);                            // named arrangements of those tiles\nwb.ws.layout.use('Study');\n\nwb.agent({ mode: 'ask' });              // the agent proposes; you approve (Auto and Read-only are in the Agent view)\n", "workspace.js": "// workspace.js — the pictures and plots of the Workspace, and named arrangements of them.\n// A tile reads a tap of the pipeline (or is a plot, a table, some text or a set of controls). Tiles are cheap:\n// the film engine only runs in its slow, staged form while some tile reads a tap in the middle of the pipeline.\n// A layout is a function that arranges tiles, so it can also create the ones it needs.\n// Probes are named rectangles in picture coordinates (0…1) that tiles, tables and macros can point at.\n\nexport function probes(wb) {\n  const { ws } = wb;\n  ws.probe('skin',   [0.30, 0.28, 0.10, 0.12]);\n  ws.probe('shadow', [0.08, 0.70, 0.10, 0.10]);\n  ws.probe('sky',    [0.62, 0.06, 0.12, 0.10]);\n}\n\nexport function tiles(wb) {\n  const { ws } = wb;\n  ws.tile('print').render('out');                                       // what the scanner sees\n  ws.tile('paper curves').plot.curves('paper');                         // characteristic curves, one set per dye\n  ws.tile('histogram').hist('out', { channel: 'L*', bins: 64, bands: 'zones' });\n  ws.tile('notes').text('Move a slider and watch the curves and the histogram follow.\\n\\nWorkspace layouts live in workspace.js. Drag a tab to rearrange tiles, or use Layout above.');\n  ws.tile('controls').controls('colourist');                            // a scheme of controls, as a tile\n}\n\nexport function layouts(wb) {\n  const { ws } = wb;\n  const { row, col, tabs } = ws.dock;\n\n  ws.layout('Study', () => ws.dock.set(row([0.64, 'print'], [0.36, col([0.5, tabs('paper curves', 'notes')], [0.5, 'histogram'])])));\n\n  ws.layout('Darkroom', () => ws.dock.set(row([0.6, 'print'], [0.4, col([0.55, 'controls'], [0.45, 'histogram'])])));\n\n  // a mosaic of the same frame through every paper: the question \"what does the paper do?\" at a glance\n  ws.layout('Papers', () => {\n    const papers = wb.axis('print', ['kodak_portra_endura', 'kodak_ultra_endura', 'kodak_supra_endura', 'kodak_endura_premier', 'kodak_ektacolor_edge', 'fujifilm_crystal_archive_typeii', 'kodak_2383']);\n    ws.tile('paper shootout').mosaic({ cols: papers, rows: wb.axis('scene', ['chart', 'still']), cell: (c) => c.render('out').match('midgray'), size: 150 });\n    ws.dock.set(row([0.74, 'paper shootout'], [0.26, col([0.5, 'controls'], [0.5, 'histogram'])]));\n  });\n\n  // every stock through the same paper\n  ws.layout('Films', () => {\n    const films = wb.axis('film', ['kodak_portra_400', 'kodak_portra_160', 'kodak_ektar_100', 'kodak_gold_200', 'fujifilm_pro_400h', 'fujifilm_c200', 'kodak_vision3_250d', 'kodak_vision3_500t']);\n    ws.tile('film shootout').mosaic({ cols: films, rows: wb.axis('scene', ['still']), cell: (c) => c.render('out'), size: 180 });\n    ws.dock.set(row([0.78, 'film shootout'], [0.22, col([0.5, 'controls'], [0.5, 'print'])]));\n  });\n\n  // the picture next to what the film made of it: the staged film engine runs while these tiles exist\n  ws.layout('Negative', () => {\n    ws.tile('negative').render('cmy_film');\n    ws.tile('print density').render('cmy_print');\n    ws.dock.set(row([0.34, 'negative'], [0.33, 'print density'], [0.33, col([0.6, 'print'], [0.4, 'paper curves'])]));\n  });\n\n  // grain and halation want pixels, not a thumbnail\n  ws.layout('Grain', () => {\n    ws.tile('grain zoom').render('out').zoom(4, { at: 'skin' });\n    ws.tile('halation zoom').render('out').zoom(4, { at: 'sky' });\n    ws.dock.set(row([0.4, 'print'], [0.3, 'grain zoom'], [0.3, col([0.5, 'halation zoom'], [0.5, 'controls'])]));\n  });\n}\n", "agent/brief.md": "House notes for the agent. The user edits this file; it is added to your instructions on every message.\n\n- This is a study bench for the film model, not a retouching tool. Say what the physics does (toe, shoulder, dye cross-talk, paper white) before saying what to move.\n- Use the darkroom words the sliders use: print stops, filtration (yellow and magenta shifts), grade, push and pull, warmth and tint. Give the path in code font the first time, so the user can find the parameter in Controls.\n- Colour judgements come from numbers (`lab.measure`, `lab.patches`), composition and artefacts from looking. When you look, crop to what you are talking about.\n- When you compare papers or stocks, use `lab.compare` or a mosaic tile with `ws.attach`, not a series of changes to the bench. Leave the bench as you found it unless asked.\n- When you make a preset, name it by effect (\"Cool shadows\", \"Lifted blacks\"), keep only the values that differ from stock (`changesOnly`), and write one line of description saying what it does to the picture.\n- Report what you did in two or three sentences. Link the tile, parameter or preset you used, using the `ide:` links.\n- British spelling in anything you write to the user.\n", "examples/01-chain.js": "// 01 · One pipeline as one chain\n// A pipeline is a value. Nothing renders until something asks for a tap. Taps are named points in\n// the pipeline, and each carries a type (Scene, LogExposure, Density, RGB), so wrong wiring is caught early.\n// Press Run: three pictures appear in the Console. This file makes its own bench; the last line puts it on screen.\n\nconst wb = bench('hello');\n\nconst rig = wb.pipe('default')\n  .scene('chart')                    // 24-patch chart                     tap: src\n  .film('kodak_portra_400')          // expose, then develop               taps: log_e_film, cmy_film\n  .enlarger()                        // film density to print exposure     tap: log_e_print\n  .paper('kodak_portra_endura')      // print development                  tap: cmy_print\n  .scan();                           // scan to XYZ to sRGB                tap: out\n\nlog('taps   ', rig.taps.join(' · '));\nlog('stages ', rig.stageNames.join(' · '));\n\nshow(rig.at('out').eval({ w: 384, h: 256 }));          // the print as the scanner sees it\nshow(rig.at('log_e_film').eval({ w: 160, h: 106 }));   // what the lens put on the negative (log E, as false colour)\nshow(rig.at('cmy_film').eval({ w: 160, h: 106 }));     // what development made of it (dye densities)\n\nuse(wb);    // the Controls, Workspace and Graph views now show this bench. Run main.js to go back to the studio.\n", "examples/02-engines.js": "// 02 · Slots and engines\n// A slot holds engines of different fidelity. Tap demand decides which one runs: the fast fused film engine\n// when nobody reads a tap in the middle of the pipeline, the staged one the moment a tile or a stage does.\n\nconst wb = bench('engines');\nconst rig = wb.pipe('default').scene('chart').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();\n\nlog(String(rig.slots));                       // what each slot offers\n\nrig.swap('paper', engines.paper.measured);    // by value …\nrig.engine('scan', 'spectral');               // … or by name. (spectral is a 65³ lattice stand-in for the per-pixel spectral scan)\nrig.engine('film', 'auto');                   // the default: decided by demand\nlog(String(rig.explain()));\n\nwb.ws.tile('neg').render('cmy_film');         // a tile that needs a tap in the middle\nlog('with a tile on cmy_film:', rig.explain().film.engine, '·', rig.explain().film.why);\n\nwb.ws.tile('neg').remove();\nlog('tile removed:           ', rig.explain().film.engine, '·', rig.explain().film.why);   // demand is recomputed on every change\n\nrig.engine('paper', 'cdf'); rig.engine('scan', 'lut33');\nuse(wb);\n", "examples/03-forks.js": "// 03 · Fork a pipeline\n// A variant is a fork. Unchanged stages are shared and cached, so a comparison costs only what differs.\n\nconst wb = bench('forks');\nconst base  = wb.pipe('portra').scene('still').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();\n\nconst cine  = base.fork('cine print').paper('kodak_2383');                       // replace a stage\nconst noDir = base.fork('no DIR').set({ 'film_render.dir.active': false });      // overlay parameters\nconst fuji  = base.fork('Pro 400H').film('fujifilm_pro_400h');                   // replace the film\n\nlog(String(base.diff(noDir)));            // what differs, and which stages it reaches\n\nconst set = wb.compare({ base, cine, noDir, fuji });\nlog(String(set.plan()));                  // stage runs shared between the variants\n\nconst r = set.eval('out', { w: 192 });    // one render per variant\nlog('mean ΔE2000 against base:', JSON.stringify(r.table('dE2000', { ref: 'base' })));\nshow(r);                                  // the pictures, side by side\nuse(wb);\n", "examples/04-custom-stage.js": "// 04 · A custom stage with lambdas\n// A new stage between two taps. Three lambdas, three phases:\n//   build  once, when its parameters change (bakes tables)\n//   eval   per pixel, pure\n//   run    once per evaluation; may talk to the outside (notes, measurements)\n\nconst wb = bench('bypass');\nconst rig = wb.pipe('default').scene('still').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();\nconst mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;\n\nconst bypass = wb.stage('bleachBypass', {\n  from: 'Density', to: 'Density',                       // typed ports: legal wherever a Density flows\n  params: {\n    amount: p.slider({ min: 0, max: 1,   step: 0.01, value: 0.4, path: 'bypass.amount' }),\n    toe:    p.slider({ min: 1, max: 2.2, step: 0.01, value: 1.6, path: 'bypass.toe' }),\n  },\n  build: (P) => ({ silver: curve1D(256, (d) => 2 * (d / 2) ** P.toe) }),\n  eval:  (d, P, B) => { const s = B.silver(mean(d)); return d.map((x) => x + P.amount * (s - x)); },   // retained silver adds equal density to all three dyes\n  run:   (ctx) => ctx.note('silver kept: ' + Math.round(100 * ctx.P.amount) + ' %'),\n});\n\nrig.insert(bypass, { after: 'cmy_film' });              // insertion points are taps\nlog('taps  ', rig.taps.join(' · '));\nlog('film engine:', rig.explain().film.why);            // the stage reads cmy_film, so film runs staged\n\ntry { rig.insert(bypass, { after: 'log_e_film' }); } catch (e) { warn(e.message); }   // the type check says no\n\nconst ev = rig.eval('out', { w: 320 });\nlog('notes', ev.notes);\nshow(ev);\nwb.ctl.slider('bypass.amount');                         // the stage's parameters are ordinary paths now\nuse(wb);\n", "examples/05-graph.js": "// 05 · A graph when a chain is not enough\n// Chains cannot branch. A graph can: here a second, masked exposure is added to the same negative,\n// the way you burn the sky in at the enlarger. Open the Graph view afterwards to see the compiled IR.\n\nconst wb = bench('burn');\nconst g = wb.graph('burn the sky');\n\nconst src   = g.scene('still');\nconst neg   = g.film('kodak_portra_400').from(src);\nconst base  = g.enlarger({ print_exposure: 1.0 }).from(neg);                              // full-frame exposure\nconst sky   = g.mask('sky', (px) => smoothstep(0.7, 0.95, luma(px))).from(src);          // an eval λ over scene pixels, 0…1\nconst burn  = g.enlarger({ print_exposure: 0.35 }).from(neg).through(sky);                // same negative, light only where the mask is open\nconst sum   = g.sum('logH', base, burn);                                                  // light adds in linear exposure\nconst paper = g.paper('kodak_portra_endura').from(sum);\nconst out   = g.scan().from(paper);\n\nconst ir = g.compile(out);\nlog(String(ir.summary()));\nlog(ir.node('sky').source);                             // the λ's source travels with the IR\nconst ev = ir.eval('out', { w: 320 });\nshow(ev);\nshow(ev.at('logH'));                                    // the merged exposure is just another tap\n\nconst chain = bench('plain');\nchain.pipe('default').scene('still').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();\nlog(String(ir.irDiff(chain.graph.of(chain.pipe('default')).compile())));\nuse(wb);\n", "examples/06-bind-controls.js": "// 06 · Bind a control to a path\n// ctl.slider(path) reads the range, unit and kind from the parameter table; narrow it, relabel it, format it.\n// A control may narrow its path's range but never widen it: the model is only valid inside the table.\n// A scheme arranges controls into groups. The last line shows this bench; switch schemes in the Controls view.\n\nconst wb = bench('controls');\nwb.pipe('default').scene('chart').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();\nconst { ctl } = wb;\nconst { CC } = units;\n\nctl.scheme('basics', (s) => {\n  s.group('Exposure')\n    .add(ctl.slider('camera.ev'))\n    .add(ctl.slider('enlarger.print_exposure'));\n  s.group('Film')\n    .add(ctl.toggle('film_render.grain.active'))\n    .add(ctl.select('camera.method'))\n    .add(ctl.segmented('output.gamut'));\n  s.group('Filtration')\n    .add(ctl.slider('enlarger.y_shift').label('Yellow').unit(CC).range(-40, 40).step(1).detents([0])\n      .fmt((v) => (v > 0 ? '+' : '') + v + ' CC'));\n});\n\ntry { ctl.slider('enlarger.y_shift').range(-90, 90); } catch (e) { warn(e.message); }   // wider than the table: refused, with the real range\n\nlog(ctl.schemes().join(', '), '·', ctl.scheme('basics').controls().length, 'controls');\nctl.use('basics');\nuse(wb);\n", "examples/07-macros.js": "// 07 · One slider, several paths\n// A macro is a gesture that drives parameters at once. It lives in the 'macros' layer, so the base values\n// underneath stay untouched, Layers shows it, Clear removes it, and ctl.why(path) explains every contribution.\n\nconst wb = bench('macros');\nwb.pipe('default').scene('still').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();\nconst { ctl } = wb;\nconst { STOPS } = units;\n\nconst warmth = ctl.macro('warmth', { range: [-1, 1], step: 0.05, value: 0 })\n  .drives('enlarger.y_shift', { gain: -24 })                       // a plain gain\n  .drives('enlarger.c_shift', { gain: 8, curve: 'easeIn' })        // shaped: small near zero, full at the ends\n  .drives('enlarger.m_shift', { map: [[-1, 6], [0, 0], [1, -3]] }); // a piecewise-linear map\n\nconst stops = ctl.macro('print stops', { range: [-3, 3], step: 1 / 6, unit: STOPS })\n  .drives('enlarger.print_exposure', { stops: 1 });                // one unit is one stop of light\n\nwarmth.value = 0.5;\nlog(String(ctl.why('enlarger.y_shift')));                          // base, then each layer's contribution\nlog(String(ctl.why('enlarger.c_shift')));\nlog(String(ctl.why('enlarger.m_shift')));\n\nctl.scheme('macros', (s) => s.group('Print').add(ctl.slider(warmth)).add(ctl.slider(stops).widget('dial')));\nctl.use('macros');\nuse(wb);\n", "examples/08-layers.js": "// 08 · Layers: non-destructive control\n// Parameters resolve through layers, in order:  base → look → macros → agent → pin.\n// Each layer can be switched off, faded (opacity) and cleared; pin wins over everything.\n// A look is a preset; macros are the sliders; agent is where the assistant's changes land.\n\nconst wb = bench('layers');\nwb.pipe('default').scene('still').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();\nconst { ctl } = wb;\nconst eff = (path) => wb.params.effective(path);\n\nlog(String(ctl.layers()));\nwb.params.set('enlarger.y_shift', 5);                              // writes the base layer\n\nwb.preset('warm portrait', { kind: 'adjust', desc: 'less yellow, a little more light', ops: {\n  'enlarger.y_shift': op.add(-4),                                  // relative to what is below\n  'enlarger.print_exposure': op.mul(1.15),\n} });\nctl.layer('look').use(wb.preset('warm portrait'));\n\nconst warmth = ctl.macro('warmth', { range: [-1, 1], step: 0.05 }).drives('enlarger.y_shift', { gain: -24 });\nwarmth.value = 0.5;\nctl.pin('enlarger.print_exposure', 1.2);                           // a pin wins over every layer\n\nlog(String(ctl.why('enlarger.y_shift')));\nlog(String(ctl.why('enlarger.print_exposure')));\n\nctl.layer('macros').off();   log('macros off  → y_shift', eff('enlarger.y_shift'));\nctl.layer('macros').on();    log('macros on   → y_shift', eff('enlarger.y_shift'));\nctl.layer('look').opacity(0.5); log('look at 50% → y_shift', eff('enlarger.y_shift'));\nctl.layer('look').opacity(1);\n\nctl.scheme('layers', (s) => s.group('Look and macros').add(ctl.slider(warmth)).add(ctl.slider('enlarger.print_exposure')));\nctl.use('layers');\nuse(wb);       // open the Layers view: the mixer shows what you just built\n", "examples/09-lambda-macros.js": "// 09 · Lambda macros, read-back, calibration\n// drives() is declarative. apply() takes a function: any number of paths, computed from the macro value and\n// the parameters below it. read() runs the other way, so the slider follows when you change the parameters directly.\n// calibrate() renders the picture at several slider positions, measures it and stores a correction, so a \"warmth\"\n// slider moves b* evenly instead of whichever way the filtration happens to.\n\nconst wb = bench('lambda macros');\nwb.pipe('default').scene('chart').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();\nconst { ctl } = wb;\n\nconst GRADE = [[0, 0.7], [1, 0.82], [2, 1], [3, 1.2], [4, 1.45], [5, 1.8]];     // paper grade to print gamma\n\nconst grade = ctl.macro('paper grade', { range: [0, 5], step: 0.5, value: 2 })\n  .apply((g, P) => ({\n    'print_render.morph.active': op.set(true),\n    'print_render.morph.gamma': op.set(interp(GRADE, g)),\n    'enlarger.print_exposure': P.enlarger.normalize ? op.keep : op.stops(0.25 * (g - 2)),   // harder paper needs more light\n  }))\n  .read((P) => interp.inverse(GRADE, P.print_render.morph.gamma));\n\nwb.params.set('print_render.morph.gamma', 1.2);        // change the parameter directly …\nlog('the slider followed to grade', grade.value);      // … and the macro read it back\n\nconst warmth = ctl.macro('warmth', { range: [-1, 1], step: 0.05 }).drives('enlarger.y_shift', { gain: -24 });\nconst t0 = performance.now();\nconst cal = await warmth.calibrate({ measure: ({ out }) => out.lab().mean()[2], scene: 'chart', samples: 5 });\nlog(String(cal.report()), Math.round(performance.now() - t0) + ' ms');   // b* of the print at each slider position\ncal.apply();                                           // from now on the slider is shaped by what was measured\nlog('stale after calibrating?', warmth.stale);         // turns true as soon as anything the measurement depends on changes\n\nctl.scheme('lambda', (s) => s.group('Macros').add(ctl.slider(grade).widget('stepper')).add(ctl.slider(warmth)));\nctl.use('lambda');\nuse(wb);\n", "examples/10-schemes.js": "// 10 · A darkroom scheme, and others over the same state\n// The same parameters can be held by different control schemes. A scheme owns no state, so you can switch\n// (or show two at once as tiles) and nothing moves. ctl.fromSpec() makes the engineer's scheme from the\n// parameter table; this makes a printer's by hand. controls.js in the studio has the full version.\n\nconst wb = bench('schemes');\nwb.pipe('default').scene('still').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();\nconst { ctl, ws } = wb;\nconst { CC, STOPS } = units;\n\nconst stops = ctl.macro('print stops', { range: [-3, 3], step: 1 / 6, unit: STOPS }).drives('enlarger.print_exposure', { stops: 1 });\nconst grade = ctl.macro('paper grade', { range: [0, 5], step: 0.5, value: 2 })\n  .apply((g) => (g === 2 ? {} : { 'print_render.morph.active': op.set(true), 'print_render.morph.gamma': op.set(interp([[0, 0.7], [2, 1], [5, 1.8]], g)) }));\n\nconst darkroom = ctl.scheme('darkroom', (s) => {\n  s.group('Enlarger')\n    .add(ctl.slider(stops).widget('dial').label('Exposure'))\n    .add(ctl.slider('enlarger.y_shift').widget('dial').label('Yellow').unit(CC));\n  s.group('Paper')\n    .add(ctl.slider(grade).widget('stepper'))\n    .add(ctl.choice('surface', { gloss: 0.3, lustre: 1.2, matte: 2.4 }).drives('print_render.glare'))    // a named choice sets a number\n    .add(ctl.macro('highlight roll-off', { range: [0, 1] }).drives('print_render.morph.fast', { map: [[0, 1], [1, 0.6]] }).slider());\n  s.group('Local')\n    .add(ctl.button('dodge and burn').opens('mask editor').requires('mask'));    // a capability the plain chain lacks (see example 05)\n});\nctl.scheme('engineer', ctl.fromSpec());                  // every parameter, straight from the table\n\nctl.use('darkroom');\nlog(String(darkroom.audit()));                           // every mapped value inside its range? every requirement met?\nlog(ctl.schemes().join(' · '), '·', ctl.scheme('engineer').controls().length, 'controls in engineer');\n\nws.tile('print').render('out');\nws.tile('darkroom').controls('darkroom');                // a scheme as a tile …\nws.tile('engineer').controls('engineer');                // … and another one next to it: they edit the same state\nuse(wb);\n", "examples/11-tiles.js": "// 11 · Attach tiles to taps, dock them\n// A tile reads a tap (or is a plot, a table, text or a scheme of controls). Tiles arrange into a dock tree\n// of rows, columns and tabs. The Workspace view draws that tree; dragging a tab edits it (one mutation each).\n\nconst wb = bench('tiles');\nwb.pipe('default').scene('chart').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();\nconst { ctl, ws } = wb;\nconst { row, col, tabs } = ws.dock;\n\nctl.scheme('darkroom', (s) => s.group('Print').add(ctl.slider('enlarger.print_exposure')).add(ctl.slider('enlarger.y_shift')));\nws.tile('print').render('out');\nws.tile('neg').render('cmy_film');                       // a density map of the negative (the staged film engine turns on)\nws.tile('curves').plot.curves('paper');\nws.tile('notes').text('Compare the toe of the curves with the shadows of the print.');\nws.tile('controls').controls('darkroom');\n\nws.dock.set(row([0.2, 'controls'], [0.5, 'print'], [0.3, col('neg', tabs('curves', 'notes'))]));\nlog(String(ws.describe()));\nlog(String(wb.pipe('default').explain().film.why));\nuse(wb);\n", "examples/12-plots-probes.js": "// 12 · Intermediary views: plots, scopes, probes\n// Probes are named rectangles (0…1) on the picture. A table tile measures them, a line plot sweeps a macro or\n// parameter, a parade shows the channels. Each measurement is a λ over the taps it names.\n\nconst wb = bench('probes');\nwb.pipe('default').scene('still').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();\nconst { ctl, ws } = wb;\n\nctl.macro('warmth', { range: [-1, 1], step: 0.05 }).drives('enlarger.y_shift', { gain: -24 });\nws.tile('print').render('out');\nws.tile('parade').scope.parade('out');\nws.tile('density').hist('cmy_film', { bins: 128, channels: 'cmy' });\nws.probe('skin',   [0.30, 0.28, 0.10, 0.12]);\nws.probe('shadow', [0.08, 0.70, 0.10, 0.10]);\n\nws.tile('probes').table({\n  rows: ['skin', 'shadow'],\n  cols: { 'L*': ({ out }, pr) => out.crop(pr).lab().mean()[0], 'film D(c)': ({ cmy_film }, pr) => cmy_film.crop(pr).mean()[0] },\n});\nws.tile('b* vs warmth').plot.line({ x: wb.axis('macro.warmth', [-1, 1, 0.5]), y: ({ out }) => out.lab().mean()[2], taps: ['out'] });\n\nlog(JSON.stringify(ws.tableData(ws.tiles.get('probes'))));\nlog(JSON.stringify(ws.lineData(ws.tiles.get('b* vs warmth')).pts.map((a) => [a[0], +a[1].toFixed(2)])));\nuse(wb);\n", "examples/13-mosaic.js": "// 13 · A mosaic of papers\n// A mosaic tile runs a cell λ over two axes. Cells share every stage the axes do not touch, so seven papers by two\n// scenes cost seven paper runs, not fourteen full pipelines. .match('midgray') evens out exposure so you compare\n// the paper, not the brightness. A second tile puts a diff lens on the same grid to show how far each paper is from the first.\n\nconst wb = bench('papers');\nwb.pipe('default').scene('chart').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();\nconst { ws } = wb;\n\nconst papers = wb.axis('print', ['kodak_portra_endura', 'kodak_ultra_endura', 'kodak_supra_endura', 'kodak_endura_premier', 'kodak_ektacolor_edge', 'fujifilm_crystal_archive_typeii', 'kodak_2383']);\n\nconst grid = {\n  cols: papers,\n  rows: wb.axis('scene', ['chart', 'still']),\n  cell: (c) => c.render('out').match('midgray'),\n  size: 150,\n};\nconst sh = ws.tile('paper shootout').mosaic(grid);\nlog(String(sh.plan()));                                  // what is shared and what is recomputed\n\n// the same grid again, as difference from Portra Endura (ΔE2000, four times the gain); the cells are shared, so this costs almost nothing\nws.tile('paper difference').mosaic(grid).lens(lens.diff({ vs: { print: papers.first }, metric: 'dE2000', gain: 4 }));\nws.tile('paper curves').plot.curves('paper');\nws.dock.set(ws.dock.row([0.5, ws.dock.col('paper shootout', 'paper difference')], [0.5, 'paper curves']));\nuse(wb);       // the Workspace now shows the mosaic. Click a cell to read it; the chip on a tile switches its lens off.\n", "examples/14-lenses.js": "// 14 · Lenses\n// A lens is a λ over a tile's picture: it recolours, marks or measures it, and may add a legend. Built-in:\n// clip (clipped highlights/shadows), zones (L* in Zone System steps), diff, split, falseDensity. Your own take\n// parameters, and those become ordinary paths (so they get sliders).\n\nconst wb = bench('lenses');\nwb.pipe('default').scene('still').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();\nconst { ctl, ws } = wb;\n\nws.tile('p1').render('out').lens(lens.clip());\nlog('clip:', ws.renderImg(ws.tiles.get('p1'), { max: 320 }).overlays.map((o) => o.legend).join(' | '));\n\nconst magenta = lens('magentaCast', {\n  params: { floor: p.slider({ min: 0, max: 20, value: 6, unit: 'ΔE' }) },\n  eval: (img, P) => img.lab().map(([L, a, b]) => (a > P.floor && Math.abs(b) < a / 2 ? [L, 3 * a, b] : [L, 0, 0])).toRGB(),   // keep only the magenta-ish pixels, exaggerated\n  overlay: (img, P) => ({ legend: `a* above ${P.floor}` }),\n});\n\nws.tile('p2').render('out').lens(magenta).lens(lens.zones());          // lenses chain\nlog('chain:', ws.renderImg(ws.tiles.get('p2'), { max: 200 }).overlays.map((o) => o.legend).join(' | '));\nctl.scheme('lens', (s) => s.group('magentaCast').add(ctl.slider('lens.magentaCast.floor')));   // the lens parameter is a path now\nctl.use('lens');\nws.tile('p2').lens('magentaCast').off();                               // lenses switch off without being removed\nws.dock.set(ws.dock.row([0.5, 'p1'], [0.5, 'p2']));\nuse(wb);\n", "examples/15-layouts.js": "// 15 · Layouts and links as data\n// A layout is a function that arranges tiles, so it can create the ones it needs. Links tie tiles together:\n// a shared ROI, or a shared probe. Both serialise to plain data (ws.layout.json()), so they save, diff and travel.\n\nconst wb = bench('layouts');\nwb.pipe('default').scene('still').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();\nconst { ws } = wb;\nconst { row, col } = ws.dock;\n\nws.probe('skin', [0.30, 0.28, 0.10, 0.12]);\nws.tile('print').render('out');\nws.tile('grain zoom').render('out').zoom(4, { at: 'skin' });         // 4x on a probe: grain wants pixels\nws.tile('paper curves').plot.curves('paper');\nws.tile('histogram').hist('out', { bins: 64 });\n\nws.layout('overview', () => ws.dock.set(row([0.6, 'print'], [0.4, col('paper curves', 'histogram')])));\nws.layout('grain',    () => ws.dock.set(row([0.55, 'print'], [0.45, col('grain zoom', 'histogram')])));\nlog(ws.layout.list().join(', '));\n\nws.layout.use('grain');\nlog(String(ws.describe()));\nlog(JSON.stringify(ws.layout.json()).slice(0, 300));                  // the layout as data\n\nws.link(['print', 'grain zoom'], 'roi');                              // drag a region on one, the other follows\nws.link('*', 'probe');                                                // every tile shares the probes\nlog(JSON.stringify(ws.link.list()));\nuse(wb);       // Layout ▾ in the Workspace toolbar switches between overview and grain\n", "examples/16-mutations.js": "// 16 · Mutations: one verb set for everything\n// Builder calls, UI gestures and agent calls are the same thing: a mutation, applied with wb.apply({op, …}).\n// Each is logged (who, what, previous value), undoable, and changes the state hash. wb.tx groups several into one undo step.\n// Open the History view to watch these land.\n\nconst wb = bench('mutations');\nwb.pipe('default').scene('still').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();\nconst { ws } = wb;\n\nws.tile('print').render('out');\nwb.apply({ op: 'param.set', path: 'enlarger.y_shift', value: 8 }, 'ui');       // exactly what a drag does\nwb.apply({ op: 'pipe.swap', slot: 'paper', engine: 'measured' });\nwb.apply({ op: 'pipe.swap', slot: 'paper', engine: 'cdf' });\n\nwb.tx('A/B papers', (t) => {                                                    // one undo step, one render\n  t.apply({ op: 'scope.set', tile: 'print', scope: { print: 'kodak_ultra_endura' } });\n  t.apply({ op: 'lens.add', tile: 'print', lens: lens.split({ with: { print: 'kodak_ultra_endura' } }) });\n});\nlog('after tx:  scope', JSON.stringify(ws.tiles.get('print').scope), '· lenses', ws.tiles.get('print').lenses.length);\nwb.undo();\nlog('after undo: scope', JSON.stringify(ws.tiles.get('print').scope), '· lenses', ws.tiles.get('print').lenses.length);   // the whole transaction went\nwb.redo();\n\nlog(wb.log.slice(-4).map((e) => `${e.op} by ${e.by}`).join('\\n'));\nlog('state', wb.state.hash, '· log', wb.log.hash);          // where we are, and how we got there\n\nconst again = bench.load(wb.save());                         // save() is data; load() rebuilds the bench from it\nlog('reloaded identical?', again.state.hash === wb.state.hash);\nlog(wb.script().split('\\n').slice(0, 14).join('\\n') + '\\n…');   // and the same state as readable code\nuse(wb);\n", "examples/17-agent-workspace.js": "// 17 · The agent works the workspace\n// The agent uses the same verbs, marked by:'agent'. The mode decides when they land:\n//   auto       at once      ask       queued in wb.pending until you approve      read-only   refused\n// Tiles the agent attaches are ephemeral until you keep them. The Agent view shows the queue; so does History.\n\nconst wb = bench('agent');\nwb.pipe('default').scene('still').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();\nconst { ws } = wb;\nws.tile('print').render('out');\n\nwb.agent({ mode: 'ask' });\nwb.apply({ op: 'param.set', path: 'camera.ev', value: 1 }, 'agent');       // what the agent's lab.set does\nws.attach('shadow check', (w) => w.hist('out', { bins: 32 }));               // what lab's tile helpers do\nlog('pending:', wb.pending.map((q) => q.id + ' ' + q.desc).join('  ·  '));\n\nwb.approveAll();                                                             // the buttons in History and in the Agent view do this\nlog('ev now', wb.params.effective('camera.ev'), '· tiles', [...ws.tiles.keys()].join(', '));\nlog('ephemeral:', ws.tiles.get('shadow check').ephemeral);                   // dropped on the next agent run unless kept\nws.keep('shadow check');\n\nwb.agent({ mode: 'read-only' });\ntry { wb.apply({ op: 'param.set', path: 'camera.ev', value: 2 }, 'agent'); } catch (e) { warn(e.message); }\nwb.agent({ mode: 'ask' });\nuse(wb);       // now ask the agent to \"add a mosaic of the papers\": its tile appears in the Workspace as a pending change\n", "examples/18-fragments.js": "// 18 · Fragments across the planes\n// A fragment is a vertical slice through the planes: parameters, macros (control plane), lenses and tiles\n// (workspace), a note for the agent, methods on the bench, and decorations of what other fragments added.\n// Read lib/zone.js and lib/pushpull.js for the two the studio uses.\n\nimport { zoneSystem } from '../lib/zone.js';\nimport { pushPull } from '../lib/pushpull.js';\n\nconst wb = bench('fragments');\nwb.pipe('default').scene('still').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();\nconst { ctl, ws } = wb;\n\nws.probe('skin', [0.30, 0.28, 0.10, 0.12]);\nwb.use(zoneSystem, pushPull);\nwb.zoneSystem.placeSkin(6);                                  // a method the fragment added to the bench\nlog('zone.target', wb.params.effective('zone.target'), '· zone.probe', wb.params.effective('zone.probe'));\n\nws.tile('zones').render('out').lens('zones');                // a lens it contributed, by name\nlog(String(wb.fragments()));\nlog(ctl.list().filter((c) => c.from).map(String).join(' · '));   // controls that came from fragments\nuse(wb);\n", "examples/19-diagnostics.js": "// 19 · Diagnostics\n// Wrong calls get a diagnosis, not a stack trace: a code, what was wrong, the nearest valid names and a fix.\n// Each line below is a real failure caught on purpose; read what the API says. Errors you do not catch appear\n// in the Console with the file and line, and in the editor's gutter.\n\nconst wb = bench('diagnostics');\nconst rig = wb.pipe('default').scene('chart').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();\nconst { ctl, ws } = wb;\nconst tryit = (what, f) => { try { f(); warn('(no error)', what); } catch (e) { log('— ' + what + '\\n' + e.message + '\\n'); } };\n\ntryit('a tap that is a typo',          () => rig.at('cmy_flm'));\ntryit('a parameter that is a typo',    () => ctl.slider('enlarger.yshift'));\ntryit('a member that does not exist',  () => ws.tiel);\ntryit('an axis that is not a path',    () => wb.axis('paper', ['kodak_2383']));\ntryit('a stock id that is a typo',     () => wb.axis('print', ['kodak_portra_endra']));\ntryit('two macros that both set one value', () => {\n  ctl.macro('g2').apply((g) => ({ 'print_render.morph.gamma': op.set(1 + 0.2 * g) }));\n  ctl.macro('mood').apply((m) => ({ 'print_render.morph.gamma': op.set(1 - 0.1 * m) }));\n});\ntryit('a control that needs a capability the chain lacks', () => ctl.button('dodge').requires('mask').bind(rig));\ntryit('a tile created inside an eval λ', () => {\n  const bad = lens('bad', { eval: (img) => { ws.tile('t'); return img; } });\n  ws.tile('zz').render('out').lens(bad);\n  ws.renderImg(ws.tiles.get('zz'), { max: 64 });\n});\nuse(wb);\n", "examples/20-paper-study.js": "// 20 · A paper shootout study\n// Everything together: a pipeline, the darkroom controls and the zone fragment imported from the studio's files,\n// a workspace of mosaic + curves + scopes, and a question for the agent. The bench saves to plain data.\n\nimport { macros, darkroom } from '../controls.js';\nimport { zoneSystem } from '../lib/zone.js';\n\nconst wb = bench('paper shootout');\nconst { ctl, ws } = wb;\nconst { row, col } = ws.dock;\n\n// 1 · pipeline\nwb.pipe('default').scene('still').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();\n\n// 2 · controls and fragment (the studio's own files, imported)\nws.probe('skin', [0.30, 0.28, 0.10, 0.12]);\nwb.use(zoneSystem);\ndarkroom(wb, macros(wb));\nctl.use('darkroom');\n\n// 3 · workspace\nconst papers = wb.axis('print', ['kodak_portra_endura', 'kodak_ultra_endura', 'kodak_supra_endura', 'kodak_endura_premier', 'kodak_ektacolor_edge', 'fujifilm_crystal_archive_typeii', 'kodak_2383']);\nws.tile('controls').controls('darkroom');\nws.tile('print').render('out').lens(lens.clip());\nws.tile('parade').scope.parade('out');\nws.tile('shootout').mosaic({\n  cols: papers,\n  rows: wb.axis('camera.ev', [-1, 0, 1]),\n  cell: (c) => c.render('out'),                     // add .lens(lens.diff({ vs: { print: papers.first }, gain: 4 })) to see each paper's distance from Portra instead\n  size: 120,\n});\nws.tile('H&D').plot.curves('paper');\nws.dock.set(row([0.2, 'controls'], [0.4, col('print', 'parade')], [0.4, col('shootout', 'H&D')]));\nws.link(['print', 'shootout'], 'probe');\n\n// 4 · the agent\nwb.agent({ mode: 'ask', brief: 'Compare papers through their curves: toe, shoulder, Dmax. Use the mosaic; do not only quote numbers.' });\nwb.ask('Which paper holds the most shadow detail when the negative is a stop under?');   // opens the Agent view with the question ready to send\n\n// 5 · save\n// saved λ sources reload with bench.load(saved, { names the λs close over })\nlog('saved bench:', JSON.stringify(wb.save()).length, 'bytes');\nuse(wb);\n", "lib/pushpull.js": "// lib/pushpull.js — a fragment: push and pull processing as one control.\n// A fragment is a vertical slice through the planes. This one only contributes to the control plane (extends: ['ctl']).\n// Model: pushing by n stops means rating the film n stops faster (camera.ev falls by n) and developing longer,\n// which raises the negative's contrast. The 0.12 per stop is an eyeball figure, not a measurement: change it,\n// or calibrate it against Portra 800 and its pushed profiles (examples/09 shows how calibration works).\nexport const pushPull = fragment('pushPull', {\n  extends: ['ctl'],\n  macros: {\n    'pushPull.stops': (m) => m\n      .drives('camera.ev', { gain: -1 })\n      .drives('film_render.gamma', { gain: 0.12 }),\n  },\n  decorate: {\n    'ctl:camera.ev': (c) => c.label('Film exposure'),\n  },\n});\n", "lib/zone.js": "// lib/zone.js — a fragment: talk in zones.\n// It adds parameters, a macro that measures the picture, a lens, a tile and a note for the agent, in one place:\n//   zone.target / zone.probe   where a probe should land, and which probe\n//   place                      a macro that renders, measures the probe's L*, and moves camera.ev to put it there\n//   zones (lens)               posterises L* into zones so a tile shows the zone map\n//   zone histogram (tile)      L* histogram with zone bands\n// 'place' is an async apply with phase 'run': it measures by rendering, so it only runs when you let go of the slider.\nexport const zoneSystem = fragment('zoneSystem', {\n  extends: ['ctl', 'ws', 'agent'],\n\n  params: {\n    target: p.stepper({ min: 0, max: 10, value: 5, path: 'zone.target' }),\n    probe:  p.choice({ of: 'probes', value: 'skin', path: 'zone.probe' }),\n  },\n\n  macros: {\n    place: (m) => m.apply(async (z, P, ctx) => {\n      const L = await ctx.measure(P.zone.probe, ({ out }, pr) => out.crop(pr).lab().mean()[0]);\n      return { 'camera.ev': op.add(z - zoneOf(L)) };               // one zone is one stop\n    }, { phase: 'run' }),\n  },\n\n  lenses: { zones: lens.zones({ n: 11 }) },\n  tiles:  { 'zone histogram': (w) => w.hist('out', { channel: 'L*', bands: 'zones' }) },\n\n  decorate: { 'ctl:camera.ev': (c) => c.fmt((v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)} EV`) },\n\n  methods: { placeSkin(z) { this.set('zone.probe', 'skin').set('zone.target', z); } },\n  agent:   { brief: 'The user may talk in zones (0 black … 10 white, 5 middle grey). Place a probe and measure it before you quote an EV number.' },\n});\n", "docs/reference.md": "# Filmbench\n\nEverything on screen is made by scripts in this browser. The sliders, the looks, the tiles, the layouts and the agent's tools are all calls to the v2 API, and every script can be opened, edited and run. Start at [main.js](ide:file/main.js); it builds the studio from the other files.\n\n## Where things are\n\n| View | What it is for |\n|---|---|\n| Files | the virtual file system: built-in scripts, your files, snapshots. Changed built-ins are marked, and **Reset…** restores them. |\n| Code | the editor. Run the file with Ctrl/Cmd+Enter, run main.js with Shift+Ctrl/Cmd+Enter. Problems appear under the text, with the code and a suggestion. |\n| Console | output of runs, and a REPL on the live bench. `wb`, `ws`, `ctl` and `rig` are already in scope. |\n| Workspace | the tiles: renders, mosaics, plots, parades, notes. Tiles have their own dock tree, set by `ws.layout`. |\n| Controls | the sliders of the scheme you pick. Hairline sliders, dials, steppers, a colour-balance pad. |\n| Layers | looks, adjustments, macros, and the layer stack from base up to pin. |\n| Graph | the pipeline as a DAG with stage hashes; click a stage to see its parameters and cache state. |\n| History | every mutation with who made it (you, a script, the agent). Undo and redo walk this list. |\n| Agent | ask questions about the picture, have it take looks, make presets. Ask mode holds every change for you to approve. |\n\n## Tiling\n\nEvery view is a tile in a dock. Drag a tab by its label onto the edge of another tile to split it, onto the middle to join its tabs, or onto the header strip to reorder. Drag a gutter to resize it, or focus it and use the arrow keys. The **+** at the end of a tab strip opens a picker for views that are not on screen. Layouts in the header menu switch the arrangement: Studio, Darkroom, Code, Agent, Inspect. **Save this layout as…** in the same menu keeps the current one under a name. Below 760 px wide the dock shows one tile at a time, with the tab strip as a switcher.\n\nAlt+1 … Alt+9 focus a view in the order of the table above. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z undo and redo outside text fields.\n\n## Scripts\n\nFiles can import each other with relative paths. `import { macros } from './controls.js'` works; so does `export const`, `export function` and `export default`. Imports are resolved from the file system, not the network. Top-level `await` works in the file you run, not in files you import.\n\nA run builds a **bench** (the state) and shows it. The first bench made by main.js becomes the one all views show. A scratch script can make its own bench and then call `use(wb)` to make every view show that one; running main.js again returns to the studio.\n\n```js\nconst wb  = bench('scratch');\nconst rig = wb.pipe('default').scene('still').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();\nwb.ctl.slider('exposure', { path: 'enlarger.print_exposure', min: 0.6, max: 1.6, step: 0.01 });\nuse(wb);\n```\n\nGlobals in every script: `bench`, `use`, `log`, `warn`, `show`, `table`, `clear`, `sleep`, `FB` (the physics), `CV` (image operations), `PLOTS`, `Img`, `V2`, `sample` (ask Claude for a picture or a note), and `ide` (open files and views from code).\n\n## The v2 API in one page\n\n**Bench.** `bench(name)` is the state: a parameter table, layers, presets, a pipeline, a workspace, controls. `wb.apply({ op, … }, by)` is the one way to change anything; the fluent calls below all end in it. `wb.undo()`, `wb.redo()`, `wb.tx(name, fn)` for grouping, `wb.state.hash` for identity, `wb.script()` for the script that rebuilds it, `wb.save()` and `bench.load(saved, scope)` for data.\n\n**Pipeline.** `wb.pipe(name).scene(id).film(id).enlarger().paper(id).scan()`. Each stage is content-addressed: a change reruns only the stages downstream of it. `.fork(name)` copies a pipeline for a what-if. `.stage(name, spec)` adds your own stage with a lambda. Taps read values between stages: `src`, `log_e_film`, `cmy_film`, `log_e_print`, `cmy_print`, `out`. The engine picks fused or staged evaluation by which taps are in use.\n\n**Parameters.** `wb.params` is a store of layers: `base`, `look`, `macros`, `agent`, `pin`, in that order. Each op is `set`, `add`, `mul`, `stops` or `keep`. `wb.param('film.gamma')` reads the effective value. A wrong path is an error with a did-you-mean.\n\n**Controls.** `ctl.slider`, `dial`, `stepper`, `toggle`, `select`, `segmented`, `wheel`, `button`, `choice` make a control bound to a path or to a macro. `ctl.scheme(name, build)` groups controls; `ctl.use(name)` makes one active; the Controls view lists the schemes. `ctl.fromSpec(json)` builds controls from data, which is how the agent adds some.\n\n**Macros.** One gesture driving several parameters: `ctl.macro('warmth', { range: [-1, 1] }).drives('enlarger.y_shift', { gain: -24 })`; call `.drives` again for each further parameter. It takes `gain`, `map` (a function or a table), `curve` and `stops`. `apply(fn, { phase })` is the lambda form. `read` and `calibrate` run the other way.\n\n**Presets and looks.** `wb.preset(name, { kind, desc, ops })` defines one; `wb.preset(name)` reads it. A `look` swaps the stocks; an `adjustment` stacks on top of it. Whatever the sliders show can be saved as a preset with **Save current look…** in the Layers view.\n\n**Workspace.** `ws.tile(id).render(tap)`, `.mosaic(…)`, `.parade()`, `.plot.curves(of)`, `.hist(tap, opts)`, `.text(words)`, `.controls(scheme)`. `.scope({ print: 'kodak_ultra_endura' })` renders a tile as a what-if without touching the bench. `.lens(lens.split(…))` and `lens.diff(…)` change what a tile shows. `ws.dock.set(row(…, col(…)))` arranges tiles; tiles not placed go to the shelf and cost nothing. `ws.layout(name, fn)` stores an arrangement. `ws.probe(name, rect)` names a rectangle; `ws.link([tileA, tileB], 'probe')` shares the probe between tiles.\n\n**Fragments.** `wb.use(fragment)` adds macros, lenses, tiles and notes from a reusable function. Two live in `lib/`.\n\n**Agent.** `wb.agent({ mode: 'auto' | 'ask' | 'read-only', brief })`. In ask mode the agent's changes wait in `wb.pending` until approved or skipped. Everything it does is in History with its name.\n\n**Diagnostics.** Mistakes come back as `E_…` codes with the place, a short reason and, when there is one, a suggestion. The Problems list under the editor reads the same messages.\n\n## The agent\n\nThe Agent view sends your question together with pictures from the workbench. Attach or paste a picture into the box to show it something; it sees a reduced copy and can ask for crops and zooms at full detail. It works through a small set of lab calls and then answers:\n\n| Call | Does |\n|---|---|\n| `lab.state()` | film, paper, scene, layers, what differs from stock |\n| `lab.img(tap)`, `lab.crop(region, tap)`, `lab.zoom(region, k)` | pictures from any tap |\n| `lab.measure(region)`, `lab.pixel(u, v)` | numbers: Lab means, clipping, luma percentiles |\n| `lab.compare(patch)`, `lab.sweep(path, values, measure)` | what-ifs without changing the bench |\n| `lab.patches()`, `lab.tone()`, `lab.curves()` | chart readings and curve data |\n| `lab.set(path, value)`, `lab.film(id)`, `lab.print(id)`, `lab.reset()` | change the bench (held in ask mode) |\n| `lab.preset.create`, `.save`, `.apply`, `.stack`, `.remove` | make and use presets |\n| `lab.attachments()`, `lab.attachment(id)`, `lab.useAsScene(id)` | pictures you sent |\n| `lab.tiles()`, `lab.keep(id)`, `lab.drop(id)` | the workspace |\n\nIts lab calls appear in the thread, with a Revert on each batch of changes.\n\nTo use a picture as the scene: paste it anywhere in the page (not in a text field), drop it on the Workspace, or use **Open a picture…** in the menu at the left of the header, which also lists the built-in scenes. It is reduced to the working size and kept in this browser only.\n\n## Known limits\n\n- The `spectral` scan engine here is a coarse 65³ lookup stand-in for the full spectral path, so differences below a few ΔE are not meaningful.\n- Saved scripts that use your own lambdas need the names they close over passed to `bench.load(saved, { … })`.\n- The dial is a tick ruler, not a round knob.\n- Pixel snapshots (`ws.shot`) cover renders, mosaics and the parade; plots are rasterised through SVG.\n- Push/pull gain is a hand-fitted figure (0.12 per stop), not measured from process data.\n- Files and looks live in this browser's storage. Clear the site data and they go; use **Export… → Download all scripts** in the header for a copy.\n"});
IDE.boot();

