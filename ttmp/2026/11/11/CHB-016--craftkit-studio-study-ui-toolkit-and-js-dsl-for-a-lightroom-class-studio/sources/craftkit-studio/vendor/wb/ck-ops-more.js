/* ck-ops-more.js · time, sound, data, CAD, type layout, 3D stand-in, generation, lists, exports and the scopes.
 * Sound goes through SoundCraft's DSP crate (ck_sound), spreadsheets through GridCraft's calc engine (ck_grid), sketches
 * through CADCraft's constraint solver (ck_cad), develop through LightCraft (ck_light); a JS fallback covers each
 * when its module is missing. */
(function (root) {
  'use strict';
  const E = root.CK_ENGINE, def = E.def, is = E.is, hex = E.hex, clamp01 = E.clamp01, luma = E.luma;

  // ── clips: a still pushed in slowly stands in for a video file (no decoder ships here) ──
  def(['source.video', 'source.camera'], async (n, I, P, X) => {
    const img = await E.loadAsset(P.src || 'dusk.mov', 960); const t = X.time || 0, dur = 6;
    const k = 1 + 0.12 * (t / dur), W = Math.min(img.w, 854), H = Math.round(W * img.h / img.w);
    const c = E.canvas(W, H), g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
    const pan = Math.sin((t / dur) * Math.PI) * 0.03 * W;
    g.drawImage(E.toCanvas(img), (W - W * k) / 2 + pan, (H - H * k) / 2, W * k, H * k);
    const o = E.fromCanvas(c, { u: 1 }); o.timing = { dur, fps: 24 };
    if (n.op === 'source.camera') X.note('camera access is not available to pages here; a sample clip stands in');
    return o;
  }, { time: true });
  def(['clip.map', 'list.map', 'image.map', 'json.map', 'palette.map', 'shapes.map'], async (n, I, P, X) => {
    const src = await X.eval(n.in.src);
    const tpl = n.params.template || [], eachId = tpl.find(id => E.P.byId.get(id) && E.P.byId.get(id).op === 'each');
    const resId = n.in.each;
    const run = async (item, i) => { if (!resId) return item; const b = X.bind([[eachId, Object.assign(item && typeof item === 'object' ? item : { v: item }, item && typeof item === 'object' ? { __sig: E.fnv((item.__sig || X.sig) + ':' + i) } : {})]]); return X.eval(resId, Object.assign({}, X.env, { bind: b })); };
    if (n.op === 'clip.map' || (!is(src, 'list') && !Array.isArray(src))) { const r = await run(src, 0); if (r && src && src.timing) r.timing = src.timing; return r; }
    const items = is(src, 'list') ? src.items : src, out = [];
    for (let i = 0; i < items.length; i++) out.push(await run(items[i], i));
    return E.list(out);
  }, { lazy: true, rawParams: true });
  def('each', async (n, I, P, X) => { const src = await X.eval(n.in.of); return is(src, 'list') ? src.items[0] : src; }, { lazy: true });
  def('list.at', async (n, I, P) => { const l = I.list; const items = is(l, 'list') ? l.items : Array.isArray(l) ? l : [l]; return items[Math.max(0, Math.min(items.length - 1, P.index || 0))]; });
  def(['list.length', 'list.count'], async (n, I) => (is(I.src, 'list') ? I.src.items.length : 0));
  def(['list.first'], async (n, I) => (is(I.src, 'list') ? I.src.items[0] : I.src));
  def(['list.reverse'], async (n, I) => E.list(I.src.items.slice().reverse()));
  def(['list.slice'], async (n, I, P) => E.list(I.src.items.slice(P.a || P.start || 0, P.b || P.end)));
  def('get', async (n, I, P, X) => {
    let v = I.from; const path = String(P.field || '').split('.').filter(Boolean);
    for (const k of path) {
      if (v == null) return null;
      if (is(v, 'list')) { v = /^\d+$/.test(k) ? v.items[+k] : k === 'length' ? v.items.length : v.items[0] && v.items[0][k]; continue; }
      if (is(v, 'palette')) { v = /^\d+$/.test(k) ? (v.colors[+k] || {}).hex : k === 'length' ? v.colors.length : v.colors.map(c => c[k] || c.hex); continue; }
      if (is(v, 'series')) { const s = E.sampleSeries(v, X.time); v = /^\d+$/.test(k) && Array.isArray(s) ? s[+k] : s; continue; }
      if (is(v, ['image', 'mask', 'field'])) { v = k === 'width' ? v.w / (v.u || 1) : k === 'height' ? v.h / (v.u || 1) : k === 'size' ? [v.w, v.h] : v[k]; continue; }
      if (is(v, 'table')) { v = v.values[k.toUpperCase()]; continue; }
      if (is(v, 'tokens')) { v = v.vars[k]; continue; }
      v = v[k];
    }
    return v;
  });
  def('js.tap', async (n, I, P, X) => { const f = X.fn(n.params.fn); if (!f) return I.src; const r = await f(I.src, { describe: E.describe }); return r === undefined ? I.src : r; }, { rawParams: true });
  def(['source.range'], async (n, I, P) => { const a = +P.from || 0, b = +(P.to === undefined ? 1 : P.to), k = Math.max(1, Math.round(+P.n || 5)); return Array.from({ length: k }, (_, i) => (k === 1 ? a : a + (b - a) * i / (k - 1))); });
  def(['source.json', 'source.data'], async (n, I, P) => P.value !== undefined ? P.value : P);
  def(['comp.at'], async (n, I, P, X) => X.eval(n.in.src, Object.assign({}, X.env, { time: +(P.t || 0) })), { lazy: true });
  def(['comp.duration', 'clip.duration'], async (n, I, P, X) => { const s = E.P.byId.get(n.in.src); return s && typeof s.params.duration === 'number' ? s.params.duration : 4; }, { lazy: true });
  def(['clip.trim', 'clip.speed', 'clip.stabilize'], async (n, I, P, X) => { const s = E.P.byId.get(n.in.src); let t = X.time; if (n.op === 'clip.speed') t *= +(P.x || 1); if (n.op === 'clip.trim') t += +(P.a || 0); if (n.op === 'clip.stabilize') X.note('stabilize needs a tracker on real footage; the stand-in clip is already steady'); return X.eval(s.id, Object.assign({}, X.env, { time: t })); }, { lazy: true, time: true });
  def(['clip.flow'], async (n, I, P, X) => {
    const a = await X.eval(n.in.src), b = await X.eval(n.in.src, Object.assign({}, X.env, { time: (X.time || 0) + 1 / 24 }));
    const A = E.resample(a, Math.round(a.w / 4), Math.round(a.h / 4)), B = E.resample(b, A.w, A.h), W = A.w, H = A.h, f = E.field(W, H, 2, null, ['x', 'y']);
    const Y = im => { const o = new Float32Array(W * H); for (let i = 0; i < W * H; i++) o[i] = luma(im.d[i * 4], im.d[i * 4 + 1], im.d[i * 4 + 2]); return o; }; const ya = Y(A), yb = Y(B);
    for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) { let sxx = 0, syy = 0, sxy = 0, sxt = 0, syt = 0; for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) { const k = (y + j) * W + x + i; const ix = (ya[k + 1] - ya[k - 1]) / 2, iy = (ya[k + W] - ya[k - W]) / 2, it = yb[k] - ya[k]; sxx += ix * ix; syy += iy * iy; sxy += ix * iy; sxt += ix * it; syt += iy * it; } const det = sxx * syy - sxy * sxy; if (Math.abs(det) > 1e-6) { f.d[(y * W + x) * 2] = 0.5 + clamp01(0.5 + (-syy * sxt + sxy * syt) / det * 0.1) - 0.5; f.d[(y * W + x) * 2 + 1] = 0.5 + clamp01(0.5 + (sxy * sxt - sxx * syt) / det * 0.1) - 0.5; } else { f.d[(y * W + x) * 2] = 0.5; f.d[(y * W + x) * 2 + 1] = 0.5; } }
    return f;
  }, { lazy: true, time: true });
  def(['clip.track'], async (n, I, P, X) => { X.note('tracking needs real footage; reports the region unchanged'); return { box: P.region || [0.4, 0.4, 0.2, 0.2], frames: [] }; });
  def(['clip.toLut', 'image.toLut'], async (n, I, P, X) => {
    // bake the pointwise part of the graph: run it over an identity lattice standing in for its source
    const size = Math.max(9, Math.min(33, Math.round(P.size || 33)));
    let src = n.in.src, chain = [];
    let local = [];
    while (src) { const m = E.P.byId.get(src); if (!m || !(m.pointwise || /\.(grade|curves|levels|hsl|vibrance|gradientMap|lut|exposure|autoTone|invert|posterize|blackWhite|bw|channelMixer|colorBalance|photoFilter|develop|adjust|duotone|brightnessContrast|brightness|threshold|selectiveColor|look|sepia|tone|px)$/.test(m.op))) break; if (/\.(develop)$/.test(m.op)) local.push(m.op); chain.push(src); src = m.in && m.in.src; }
    if (!chain.length) throw new Error('toLut: nothing colour-only above this node to bake (blurs, warps and composites cannot live in a LUT)');
    const lat = E.image(size * size, size); for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) { const i = (g * size * size + b * size + r) * 4; lat.d[i] = r / (size - 1); lat.d[i + 1] = g / (size - 1); lat.d[i + 2] = b / (size - 1); lat.d[i + 3] = 1; }
    const out = await X.eval(n.in.src, Object.assign({}, X.env, { bind: X.bind([[src, Object.assign(lat, { __sig: 'lattice' + size })]]) }));
    let txt = `TITLE "CraftKit ${chain.length} ops"\nLUT_3D_SIZE ${size}\n`; for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) { const i = (g * size * size + b * size + r) * 4; txt += `${out.d[i].toFixed(5)} ${out.d[i + 1].toFixed(5)} ${out.d[i + 2].toFixed(5)}\n`; }
    X.note(`baked ${chain.length} colour ops into a ${size}³ LUT` + (local.length ? ' (develop bakes its global colour and tone; clarity, texture, dehaze, sharpening and noise reduction are local and stay out)' : ''));
    return E.mk('lut', { size, text: txt, preview: out, table: Float32Array.from(out.d), ops: chain.length });
  }, { lazy: true });

  // ── sound (SoundCraft DSP) ─────────────────────────────────────────────
  const SR = 44100;
  async function snd(op, args, a) {
    let data = null; if (a) { const n = a.ch[0].length; data = new Float32Array(n * a.ch.length); a.ch.forEach((c, i) => data.set(c, i * n)); }
    const r = await E.wasmCall('ck_sound', op, Object.assign(a ? { sr: a.sr, channels: a.ch.length, frames: a.ch[0].length } : {}, args), data);
    return r;
  }
  E.snd = snd;
  const planar = (r, chn, sr) => { const f = r.f32(), n = Math.floor(f.length / chn); return E.audio(sr, Array.from({ length: chn }, (_, i) => f.slice(i * n, (i + 1) * n))); };
  // a demo track in JS: drums + bass + chords at 120 bpm (used when the DSP module has no instrument for it)
  function jsTrack(seconds, sr, seed, kind) {
    const n = Math.round(seconds * sr), L = new Float32Array(n), R = new Float32Array(n), bpm = 120, beat = 60 / bpm;
    const rnd = (i) => E.hash2(i, 7, seed);
    const add = (t0, len, f) => { const s = Math.round(t0 * sr), e = Math.min(n, s + Math.round(len * sr)); for (let i = s; i < e; i++) { const v = f((i - s) / sr); L[i] += v; R[i] += v; } };
    const steps = Math.floor(seconds / (beat / 4));
    for (let s = 0; s < steps; s++) {
      const t = s * beat / 4;
      if (kind !== 'pad' && s % 4 === 0) add(t, 0.35, x => Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-x * 30)) * x) * Math.exp(-x * 9) * 0.9);
      if (kind !== 'pad' && s % 8 === 4) add(t, 0.2, x => (rnd(Math.floor(x * sr) + s * 999) * 2 - 1) * Math.exp(-x * 22) * 0.45 + Math.sin(2 * Math.PI * 190 * x) * Math.exp(-x * 30) * 0.3);
      if (kind !== 'pad' && s % 2 === 1) add(t, 0.05, x => (rnd(Math.floor(x * sr) + s * 77) * 2 - 1) * Math.exp(-x * 80) * 0.18);
      if (s % 4 === 2 || s % 8 === 0) { const notes = [41, 41, 44, 39], m = notes[Math.floor(s / 16) % 4], f = 440 * Math.pow(2, (m - 69) / 12); add(t, 0.3, x => Math.tanh(Math.sin(2 * Math.PI * f * x) * 2.5) * Math.exp(-x * 5) * 0.35); }
      if (s % 16 === 0) { const chord = [[65, 68, 72], [65, 68, 72], [68, 72, 75], [63, 67, 70]][Math.floor(s / 16) % 4]; for (const m of chord) { const f = 440 * Math.pow(2, (m - 69) / 12); add(t, beat * 4, x => (Math.sin(2 * Math.PI * f * x) + 0.3 * Math.sin(2 * Math.PI * f * 2.003 * x)) * Math.min(1, x * 8) * Math.exp(-x * 0.6) * 0.07); } }
    }
    let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(L[i])); const g = 0.85 / (mx || 1); for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
    return E.audio(sr, [L, R]);
  }
  E.jsTrack = jsTrack;
  // a demo track played by SoundCraft's own instruments: drum_synth + subtractive_synth (bass, pad)
  E.demoTrack = async function (seconds, kind) {
    const beat = 0.5, steps = Math.floor(seconds / (beat / 4)), drums = [], bass = [], pad = [];
    for (let s = 0; s < steps; s++) { const t = s * beat / 4; if (kind !== 'pad') { if (s % 4 === 0) drums.push({ t, dur: 0.2, midi: 36, vel: 0.95 }); if (s % 8 === 4) drums.push({ t, dur: 0.2, midi: 38, vel: 0.8 }); if (s % 2 === 1) drums.push({ t, dur: 0.05, midi: 42, vel: 0.45 }); } if (s % 4 === 2 || s % 8 === 0) bass.push({ t, dur: 0.22, midi: [41, 41, 44, 39][Math.floor(s / 16) % 4] - 12, vel: 0.8 }); if (s % 16 === 0) for (const m of [[65, 68, 72], [65, 68, 72], [68, 72, 75], [63, 67, 70]][Math.floor(s / 16) % 4]) pad.push({ t, dur: beat * 3.8, midi: m, vel: 0.35 }); }
    const parts = [];
    if (drums.length) parts.push([await snd('synth', { sr: SR, seconds, channels: 2, instrument: 'drum_synth', notes: drums }), 0.9]);
    parts.push([await snd('synth', { sr: SR, seconds, channels: 2, instrument: 'subtractive_synth', params: { cutoff: 900, resonance: 0.3 }, notes: bass }), 0.7]);
    parts.push([await snd('synth', { sr: SR, seconds, channels: 2, instrument: 'subtractive_synth', params: { osc1_wave: 'Saw', cutoff: 2200 }, notes: pad, chain: [{ plugin: 'plate_reverb', params: { mix: 30 } }] }), 0.35]);
    const N = Math.round(seconds * SR), L = new Float32Array(N), R = new Float32Array(N);
    for (const [r, g] of parts) { const a = planar(r, 2, SR); for (let i = 0; i < Math.min(N, a.ch[0].length); i++) { L[i] += a.ch[0][i] * g; R[i] += a.ch[1][i] * g; } }
    let mx = 0; for (let i = 0; i < N; i++) mx = Math.max(mx, Math.abs(L[i]), Math.abs(R[i])); const k = 0.89 / (mx || 1); for (let i = 0; i < N; i++) { L[i] *= k; R[i] *= k; }
    return E.audio(SR, [L, R]);
  };
  def('source.audio', async (n, I, P, X) => {
    const name = String(P.src || 'set.wav').toLowerCase(); const seconds = P.seconds || 8;
    const kind = /pad|ambient|drone/.test(name) ? 'pad' : 'beat';
    try { const a = await E.demoTrack(seconds, kind); X.note('no audio files ship with the workbench: a 120 bpm demo track is played by SoundCraft\'s drum and subtractive synths'); return a; }
    catch (e) { X.note('no audio files ship with the workbench: a 120 bpm demo track is synthesized in JS (' + e.message + ')'); return jsTrack(seconds, SR, 3, kind); }
  });
  def('source.mic', async (n, I, P, X) => { X.note('the microphone is not available to pages here; a demo track stands in'); return jsTrack(8, SR, 5, 'beat'); });
  def('source.synth', async (n, I, P, X) => {
    const notes = (P.notes || []).map(x => (Array.isArray(x) ? { t: x[0], dur: x[1], midi: x[2], vel: x[3] === undefined ? 0.8 : x[3] } : x)); const seconds = P.seconds || Math.max(2, ...notes.map(x => x.t + x.dur + 1));
    try { const inst = { synth: 'subtractive_synth', drums: 'drum_synth', drum: 'drum_synth', sampler: 'sampler' }[P.instrument || 'synth'] || P.instrument; const r = await snd('synth', { sr: SR, seconds, channels: 2, instrument: inst, params: P.params || {}, notes, chain: P.chain }); return planar(r, 2, SR); }
    catch (e) {
      X.note('instrument rendered in JS: ' + e.message);
      const N = Math.round(seconds * SR), L = new Float32Array(N); for (const nt of notes) { const f = 440 * Math.pow(2, (nt.midi - 69) / 12), s = Math.round(nt.t * SR), len = Math.round((nt.dur + 0.4) * SR); for (let i = 0; i < len && s + i < N; i++) { const x = i / SR, env = Math.min(1, x * 50) * (x < nt.dur ? 1 : Math.exp(-(x - nt.dur) * 8)); L[s + i] += (Math.sin(2 * Math.PI * f * x) + 0.4 * Math.sin(4 * Math.PI * f * x)) * env * (nt.vel || 0.8) * 0.25; } } return E.audio(SR, [L, Float32Array.from(L)]);
    }
  });
  const FX = { eq: 'eq_7band', compress: 'compressor', compressor: 'compressor', reverb: 'plate_reverb', room: 'room_reverb', plate: 'plate_reverb', delay: 'mod_delay', echo: 'mod_delay', chorus: 'chorus', flanger: 'flanger', phaser: 'phaser', distortion: 'saturator', saturate: 'saturator', drive: 'saturator', limiter: 'maximizer', maximize: 'maximizer', gate: 'expander_gate', bitcrush: 'lofi', lofi: 'lofi', pitch: 'pitch_shifter', deesser: 'de_esser', rectify: 'rectifier', strip: 'channel_strip' };
  for (const [k, id] of Object.entries(FX)) def(['audio.' + k], async (n, I, P, X) => {
    const a = I.src; const params = Object.assign({}, P); delete params.plugin;
    const pid = P.plugin || id;
    const r = await snd('process', { plugin: pid, params, tail: P.tail === undefined ? (/reverb|delay/.test(k) ? 2 : 0) : P.tail }, a);
    return planar(r, a.ch.length, a.sr);
  });
  def(['audio.process', 'audio.plugin'], async (n, I, P) => { const a = I.src; const r = await snd('process', { plugin: P.plugin || P.id || P.arg0, params: P.params || {}, tail: P.tail || 0 }, a); return planar(r, a.ch.length, a.sr); });
  def(['audio.chain'], async (n, I, P) => { const a = I.src; const r = await snd('chain', { chain: P.chain || P.arg0 || [], tail: P.tail || 1 }, a); return planar(r, a.ch.length, a.sr); });
  def(['audio.gain', 'audio.volume'], async (n, I, P) => { const g = P.db !== undefined ? Math.pow(10, P.db / 20) : +(P.gain || P.arg0 || 1); return E.audio(I.src.sr, I.src.ch.map(c => c.map(v => v * g))); });
  def(['audio.reverse'], async (n, I) => E.audio(I.src.sr, I.src.ch.map(c => c.slice().reverse())));
  def(['audio.normalize'], async (n, I, P) => { let mx = 0; for (const c of I.src.ch) for (const v of c) mx = Math.max(mx, Math.abs(v)); const g = Math.pow(10, (P.db === undefined ? -1 : P.db) / 20) / (mx || 1); return E.audio(I.src.sr, I.src.ch.map(c => c.map(v => v * g))); });
  def(['audio.slice', 'audio.trim'], async (n, I, P) => { const sr = I.src.sr, a = Math.round((P.a || P.start || 0) * sr), b = P.b || P.end ? Math.round((P.b || P.end) * sr) : undefined; return E.audio(sr, I.src.ch.map(c => c.slice(a, b))); });
  def(['audio.duration'], async (n, I) => I.src.ch[0].length / I.src.sr);
  def(['audio.loudness'], async (n, I) => { try { const r = await snd('analyze', { kind: 'loudness' }, I.src); return Math.round(r.msg.integrated_lufs * 10) / 10; } catch (e) { let s = 0; for (const c of I.src.ch) for (const v of c) s += v * v; return Math.round((10 * Math.log10(s / (I.src.ch.length * I.src.ch[0].length) + 1e-12) - 0.691) * 10) / 10; } });
  // FFT band energies over time (hop 1/60 s): drives visuals; sampled at the playhead by expressions
  function fft(re, im) { const n = re.length; for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } } for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a); for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let j = 0; j < len / 2; j++) { const ur = re[i + j], ui = im[i + j], vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci, vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr; re[i + j] = ur + vr; im[i + j] = ui + vi; re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } } }
  E.fft = fft;
  function bandsOf(a, nb, hop, smooth, lo, hi) {
    const N = 2048, L = a.ch[0], R = a.ch[1] || L, sr = a.sr, frames = [], H = Math.round(hop * sr); let prev = null;
    lo = lo || 30; hi = Math.min(hi || 16000, sr / 2);
    const edges = Array.from({ length: nb + 1 }, (_, i) => lo * Math.pow(hi / lo, i / nb));
    const win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
    for (let s = 0; s + N <= L.length; s += H) {
      const re = new Float32Array(N), im = new Float32Array(N); for (let i = 0; i < N; i++) re[i] = (L[s + i] + R[s + i]) * 0.5 * win[i]; fft(re, im);
      const b = new Array(nb).fill(0); for (let k = 1; k < N / 2; k++) { const f = k * sr / N; if (f < lo || f > hi) continue; let bi = 0; while (bi < nb - 1 && f > edges[bi + 1]) bi++; b[bi] += Math.hypot(re[k], im[k]); }
      const v = b.map(x => clamp01(Math.log10(1 + x) / 2.2));
      const sm = prev ? v.map((x, i) => (x > prev[i] ? x : prev[i] * smooth + x * (1 - smooth))) : v;
      frames.push(sm); prev = sm;
    }
    return frames;
  }
  E.bandsOf = bandsOf;
  def(['audio.bands', 'audio.spectrum'], async (n, I, P, X) => {
    const nb = Math.max(2, Math.min(128, Math.round(P.n || 16))), hop = 1 / 60, sm = P.smooth === undefined ? 0.5 : +P.smooth;
    try {
      const r = await snd('analyze', { kind: 'bands', n: nb, hop }, I.src); const f = r.f32(), fr = r.msg.frames, frames = []; let prev = null;
      for (let i = 0; i < fr; i++) { const v = Array.from(f.subarray(i * nb, (i + 1) * nb), db => clamp01((db + 72) / 66)); const s2 = prev ? v.map((x, k) => (x > prev[k] ? x : prev[k] * sm + x * (1 - sm))) : v; frames.push(s2); prev = s2; }
      return E.series(frames, hop, { bands: nb, edges: r.msg.edges });
    } catch (e) { X.note('band analysis ran in JS: ' + e.message); return E.series(bandsOf(I.src, nb, hop, sm), hop, { bands: nb }); }
  });
  def(['audio.onsets'], async (n, I, P) => {
    const hz = Array.isArray(P.hz) ? P.hz : [40, 16000], hop = 1 / 100, fr = bandsOf(I.src, 8, hop, 0, hz[0], hz[1]), flux = fr.map((f, i) => (i ? f.reduce((a, v, k) => a + Math.max(0, v - fr[i - 1][k]), 0) : 0));
    const mean = flux.reduce((a, b) => a + b, 0) / (flux.length || 1), thr = mean * 2.2 + 0.02, events = []; let last = -1;
    flux.forEach((v, i) => { if (v > thr && v >= (flux[i - 1] || 0) && v >= (flux[i + 1] || 0) && i * hop - last > 0.09) { events.push({ t: Math.round(i * hop * 1000) / 1000, strength: Math.round(v * 100) / 100 }); last = i * hop; } });
    return { events, duration: I.src.ch[0].length / I.src.sr, hz };
  });
  def(['json.envelope'], async (n, I, P) => { const ev = (I.src && I.src.events) || [], dur = (I.src && I.src.duration) || 8, hop = 1 / 60, decay = Math.max(0.01, +(P.decay || 0.2)), frames = []; let k = 0, v = 0; for (let t = 0; t < dur; t += hop) { while (k < ev.length && ev[k].t <= t) { v = 1; k++; } frames.push(v); v *= Math.exp(-hop / decay); } return E.series(frames, hop); });
  def(['json.count', 'json.length'], async (n, I) => (I.src && I.src.events ? I.src.events.length : Array.isArray(I.src) ? I.src.length : 0));
  def(['audio.transcribe'], async (n, I, P, X) => { X.note('speech-to-text needs Whisper weights (T3); nothing was transcribed'); return { words: [], text: '' }; });
  def(['audio.toImage', 'audio.waveform'], async (n, I, P) => E.waveImage(I.src, P.w || 1200, P.h || 300, P));
  E.waveImage = function (a, W, H, o) {
    o = o || {}; const img = E.image(W, H), bg = hex(o.background || '#101114'), fg = hex(o.color || '#f2b84b'); for (let i = 0; i < W * H; i++) img.d.set(bg, i * 4);
    const L = a.ch[0], per = L.length / W;
    for (let x = 0; x < W; x++) { let mn = 1, mx = -1; for (let i = Math.floor(x * per); i < Math.floor((x + 1) * per); i++) { const v = L[i]; if (v < mn) mn = v; if (v > mx) mx = v; } const y0 = Math.round(H / 2 - mx * H * 0.45), y1 = Math.round(H / 2 - mn * H * 0.45); for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) img.d.set(fg, (y * W + x) * 4); }
    return img;
  };

  // ── data: GridCraft's calc engine ──────────────────────────────────────
  async function recalc(cells) {
    try { const r = await E.wasmCall('ck_grid', 'recalc', { cells }); return { values: r.msg.values || {}, errors: r.msg.errors || {} }; }
    catch (e) {
      // minimal JS fallback: literals, and =A1 arithmetic with SQRT/SUM
      const vals = {}; const ev = (ref, depth) => { if (depth > 50) return '#CYCLE!'; if (ref in vals) return vals[ref]; const c = cells[ref]; if (typeof c !== 'string' || c[0] !== '=') return (vals[ref] = c); try { const js = c.slice(1).replace(/\b([A-Z]+[0-9]+)\b/g, (m, r) => `(${JSON.stringify(ev(r, depth + 1))})`).replace(/\bSQRT\(/g, 'Math.sqrt(').replace(/\bROUND\(/g, 'Math.round(').replace(/\^/g, '**'); return (vals[ref] = Function(`return (${js})`)()); } catch (x) { return (vals[ref] = '#VALUE!'); } };
      for (const k of Object.keys(cells)) ev(k, 0); return { values: vals, errors: {}, fallback: String(e.message) };
    }
  }
  E.recalc = recalc;
  def('source.sheet', async (n, I, P, X) => {
    const cells = Object.assign({}, P.cells || {}, (X.env.sheet && X.env.sheet[n.id]) || {});
    for (const k of Object.keys(cells)) if (cells[k] && typeof cells[k] === 'object' && !Array.isArray(cells[k])) cells[k] = cells[k].v !== undefined ? cells[k].v : String(cells[k]);
    const r = await recalc(cells);
    if (r.fallback) X.note('GridCraft calc module unavailable; formulas ran in a small JS evaluator');
    return E.mk('table', { cells, values: r.values, errors: r.errors, node: n.id });
  });
  def(['table.cell', 'json.cell'], async (n, I, P) => { const t = I.src; const ref = String(P.ref || 'A1').toUpperCase(); const v = t.values ? t.values[ref] : t[ref]; return v === undefined ? null : v; });
  def(['table.set'], async (n, I, P) => { const cells = Object.assign({}, I.src.cells, { [String(P.ref).toUpperCase()]: P.value }); const r = await recalc(cells); return E.mk('table', { cells, values: r.values, errors: r.errors }); });
  def(['table.range', 'table.column'], async (n, I, P) => {
    const t = I.src, refs = Object.keys(t.values || {}); const sel = String(P.ref || P.range || P.name || 'A');
    let keys; if (/^[A-Z]+$/i.test(sel)) keys = refs.filter(r => r.replace(/\d+/, '') === sel.toUpperCase()); else { const m = sel.toUpperCase().match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/); keys = m ? refs.filter(r => { const c = r.replace(/\d+/, ''), row = +r.replace(/\D+/, ''); return c >= m[1] && c <= m[3] && row >= +m[2] && row <= +m[4]; }) : [sel]; }
    keys.sort((a, b) => (+a.replace(/\D+/, '') - +b.replace(/\D+/, '')) || a.localeCompare(b));
    return keys.map(k => t.values[k]);
  });
  def(['table.chart'], async (n, I, P, X) => {
    const t = I.src, kind = P.kind || 'bar', W = P.size ? P.size[0] : 800, H = P.size ? P.size[1] : 500, vals = t.values || {};
    const col = c => Object.keys(vals).filter(r => r.replace(/\d+/, '') === c).sort((a, b) => +a.replace(/\D+/, '') - +b.replace(/\D+/, '')).map(r => vals[r]);
    const labels = col(P.labels || 'A').slice(1), data = col(P.values || 'B').slice(1).map(Number);
    const inks = P.colors || ['#2f6f9b', '#c2187a', '#f2b84b', '#4c6a5a', '#7a4fbf', '#e2437f'], items = [], mx = Math.max(...data, 1e-9), pad = 60;
    if (kind === 'pie' || kind === 'donut') { let a0 = -Math.PI / 2; const tot = data.reduce((a, b) => a + b, 0) || 1, cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - 30, ri = kind === 'donut' ? r * 0.55 : 0; data.forEach((v, i) => { const a1 = a0 + v / tot * 2 * Math.PI, big = a1 - a0 > Math.PI ? 1 : 0; const p = (a, rr) => [cx + rr * Math.cos(a), cy + rr * Math.sin(a)]; const [x0, y0] = p(a0, r), [x1, y1] = p(a1, r); const d = ri ? `M${x0} ${y0}A${r} ${r} 0 ${big} 1 ${x1} ${y1}L${p(a1, ri).join(' ')}A${ri} ${ri} 0 ${big} 0 ${p(a0, ri).join(' ')}Z` : `M${cx} ${cy}L${x0} ${y0}A${r} ${r} 0 ${big} 1 ${x1} ${y1}Z`; items.push({ d, fill: inks[i % inks.length], stroke: '#ffffff', sw: 2 }); a0 = a1; }); }
    else if (kind === 'line') { const pts = data.map((v, i) => [pad + i * (W - 2 * pad) / Math.max(1, data.length - 1), H - pad - v / mx * (H - 2 * pad)]); items.push({ d: E.polyD(pts, false), fill: 'none', stroke: inks[0], sw: 4 }); pts.forEach(p => items.push({ d: E.circleD(p[0], p[1], 6), fill: inks[1] })); items.push({ d: `M${pad} ${H - pad}H${W - pad}`, fill: 'none', stroke: '#1d2733', sw: 1.5 }); }
    else { const bw = (W - 2 * pad) / Math.max(1, data.length); data.forEach((v, i) => { const h = v / mx * (H - 2 * pad); items.push({ d: E.rectD(pad + i * bw + bw * 0.12, H - pad - h, bw * 0.76, h), fill: inks[i % inks.length] }); }); items.push({ d: `M${pad} ${H - pad}H${W - pad}`, fill: 'none', stroke: '#1d2733', sw: 1.5 }); }
    const sh = E.shapesOf(items, W, H, { background: P.background || '#fbfaf6' });
    for (let i = 0; i < labels.length && kind !== 'pie' && kind !== 'donut'; i++) { const bw = (W - 2 * pad) / Math.max(1, data.length); const ti = await E.textItems(E.mk('text', { text: String(labels[i]), font: { family: 'Inter', size: 16 }, at: [pad + i * bw + bw / 2, H - pad / 2] }), X, null); sh.items.push(...ti); }
    return sh;
  });
  E.tableImage = async function (t, W, H) { const keys = Object.keys(t.values || {}); return E.need('#fbfaf6', 'image', W || 400, H || 200); };

  // ── CAD sketches: CADCraft's solver ────────────────────────────────────
  def('source.sketch2d', async (n) => E.mk('sketch', { id: n.id }));
  def(['sketch.circle', 'sketch.line', 'sketch.point', 'sketch.arc', 'sketch.rect'], async (n, I, P) => ({ entity: n.id, type: n.op.split('.')[1], params: P }));
  for (const c of ['tangent', 'collinear', 'parallel', 'perpendicular', 'coincident', 'ratio', 'distance', 'equal', 'horizontal', 'vertical', 'concentric', 'fix', 'radius', 'angle', 'symmetric']) def('sketch.' + c, async (n) => ({ constraint: n.id }));
  function refOfNode(id) {
    const m = E.P.byId.get(id); if (!m) return null;
    if (m.op === 'get') { const base = refOfNode(m.in.from); const f = String(m.params.field); if (!base) return null; if (f === 'r' || f === 'radius') return { ref: base.ref, radiusOf: base.ref }; return { ref: `${base.ref}.${f}` }; }
    if (/^sketch\.(circle|line|point|arc|rect)$/.test(m.op)) return { ref: id };
    return null;
  }
  async function buildSketch(sketchId, X) {
    const ents = [], cons = []; let ci = 0, li = 0;
    // circles whose radius a ratio sets get no radius dimension of their own
    const ratioTargets = new Set(E.P.ir.nodes.filter(m => m.op === 'sketch.ratio' && m.in.b).map(m => { const g = E.P.byId.get(m.in.b); return g && g.op === 'get' ? g.in.from : null; }).filter(Boolean));
    for (const m of E.P.ir.nodes) {
      if (/^sketch\.(circle|line|point|arc)$/.test(m.op) && m.in.src === sketchId) {
        const p = await X.resolve(m.params), t = m.op.split('.')[1];
        if (t === 'circle') { const r = +(p.r || p.radius || 40); ents.push({ id: m.id, type: 'circle', cx: 220 + ci * 160, cy: 330 - ci * 40, r }); if (p.r !== undefined && !ratioTargets.has(m.id)) cons.push({ type: 'radius', refs: [m.id], value: r, name: 'r_' + m.id }); ci++; }
        else if (t === 'line') { const y = 470 + li * 46; ents.push({ id: m.id, type: 'line', x1: 80, y1: y + li * 6, x2: 720, y2: y }); li++; }
        else if (t === 'point') ents.push({ id: m.id, type: 'point', x: +(p.x || 400), y: +(p.y || 400) });
        else ents.push({ id: m.id, type: 'arc', cx: 400, cy: 400, r: +(p.r || 60), start: 0, end: 180 });
      }
    }
    for (const m of E.P.ir.nodes) {
      if (!/^sketch\.(tangent|collinear|parallel|perpendicular|coincident|ratio|distance|equal|horizontal|vertical|concentric|fix|radius|angle|symmetric)$/.test(m.op)) continue;
      const kind = m.op.split('.')[1], args = ['a', 'b', 'c'].map(k => m.in[k]).filter(Boolean).map(refOfNode).filter(Boolean);
      const lits = ['a', 'b', 'c'].map(k => m.params[k]).filter(v => typeof v === 'number');
      if (kind === 'ratio') { const [A, B] = args; const k = lits[0] || 1; if (A && B && A.radiusOf && B.radiusOf) { const nameA = 'r_' + A.radiusOf; if (!cons.find(c => c.name === nameA)) cons.push({ type: 'radius', refs: [A.radiusOf], name: nameA, value: (ents.find(e => e.id === A.radiusOf) || {}).r || 40 }); cons.push({ type: 'radius', refs: [B.radiusOf], expr: `${nameA}/${k}`, id: m.id }); } continue; }
      if (kind === 'distance') { const ea = ents.find(e => e.id === (args[0] || {}).ref), eb = ents.find(e => e.id === (args[1] || {}).ref); const refs = ea && eb && ea.type === 'line' && eb.type === 'line' ? [`${eb.id}.start`, ea.id] : args.map(a => a.ref); cons.push({ type: 'distance', refs, value: lits[0] === undefined ? 30 : lits[0], id: m.id }); continue; }
      if (kind === 'collinear' && args.length === 3) { // three points on a line: a helper construction line through the first two
        const hid = 'h' + m.id; ents.push({ id: hid, type: 'line', x1: 0, y1: 0, x2: 100, y2: 0, construction: true }); cons.push({ type: 'coincident', refs: [`${hid}.start`, args[0].ref], id: m.id + 'a' }, { type: 'coincident', refs: [`${hid}.end`, args[1].ref], id: m.id + 'b' }, { type: 'coincident', refs: [args[2].ref, hid], id: m.id + 'c' }); continue; }
      cons.push({ type: kind, refs: args.map(a => a.ref), id: m.id });
    }
    return { entities: ents, constraints: cons };
  }
  def('sketch.solve', async (n, I, P, X) => {
    const sk = await buildSketch(n.in.src, X);
    let r; try { r = (await E.wasmCall('ck_cad', 'solve', { entities: sk.entities, constraints: sk.constraints, incremental: true })).msg; }
    catch (e) { X.note('CADCraft solver unavailable: ' + e.message); r = { ok: false, error: e.message, entities: sk.entities, dof: {} }; }
    if (r.rejected && r.rejected.length) X.note(`${r.rejected.length} constraint${r.rejected.length > 1 ? 's' : ''} rejected (${r.rejected.map(x => x.kind).join(', ')})`);
    return E.mk('sketch', { id: n.in.src, solved: true, entities: r.entities || sk.entities, constraints: sk.constraints, report: r });
  });
  def('sketch.toShapes', async (n, I, P, X) => {
    let s = I.src; if (!s.solved) s = { entities: (await buildSketch(s.id, X)).entities };
    const fills = P.fills || ['#f2b84b', '#c2187a', '#2f6f9b', '#4c6a5a']; let fi = 0; const items = [];
    for (const e of s.entities) { if (e.construction || String(e.id).startsWith('h')) continue; if (e.type === 'circle') items.push({ d: E.circleD(e.cx, e.cy, Math.abs(e.r)), fill: fills[fi++ % fills.length] }); else if (e.type === 'line') items.push({ d: `M${e.x1} ${e.y1}L${e.x2} ${e.y2}`, fill: 'none', stroke: P.stroke || '#1d2733', sw: P.width || 3 }); else if (e.type === 'point') items.push({ d: E.circleD(e.x, e.y, 4), fill: '#1d2733' }); }
    const sh = E.shapesOf(items, 800, 800, { background: P.background || '#fbfaf6' });
    // fit the drawing into the artboard
    let b = [Infinity, Infinity, -Infinity, -Infinity]; for (const it of items) { const q = E.boundsD(it.d); b = [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])]; }
    if (b[0] < Infinity) { const k = Math.min(1.6, 640 / Math.max(b[2] - b[0], b[3] - b[1], 1)), tx = 400 - k * (b[0] + b[2]) / 2, ty = 400 - k * (b[1] + b[3]) / 2; sh.items = items.map(it => Object.assign({}, it, { d: E.transformD(it.d, [k, 0, 0, k, tx, ty]), sw: it.sw ? it.sw : undefined })); sh.fit = [k, tx, ty]; }
    return sh;
  });
  def('sketch.below', async (n, I, P, X) => {
    const sk = E.P.byId.get(n.in.src); const solve = E.P.ir.nodes.find(m => m.op === 'sketch.solve' && m.in.src === (sk && sk.op === 'sketch.solve' ? sk.in.src : n.in.src));
    const solved = solve ? await X.eval(solve.id) : null; const ent = n.in.entity ? refOfNode(n.in.entity) : null; const gap = +(P.gap === undefined ? 24 : P.gap);
    const shapes = solve ? await X.eval(E.P.ir.nodes.find(m => m.op === 'sketch.toShapes' && m.in.src === solve.id).id).catch(() => null) : null; const fit = shapes && shapes.fit ? shapes.fit : [1, 0, 0];
    const e = solved && ent ? solved.entities.find(x => x.id === ent.ref) : null;
    if (!e) return [400, 700];
    const y = e.type === 'line' ? Math.max(e.y1, e.y2) : (e.cy || e.y || 0) + (e.r || 0);
    const x = e.type === 'line' ? (e.x1 + e.x2) / 2 : (e.cx || e.x || 0);
    return [fit[0] * x + fit[1], fit[0] * y + fit[2] + gap * fit[0]];
  }, { lazy: true });

  // ── type: stories flowed through frames (Knuth–Plass) ──────────────────
  function parseStory(md) { return String(md || '').split(/\n\s*\n/).map(b => b.trim()).filter(Boolean).map(b => { const m = b.match(/^(#{1,3})\s+(.*)$/s); return m ? { style: 'h' + m[1].length, text: m[2].replace(/\s+/g, ' ') } : { style: 'body', text: b.replace(/\s+/g, ' ') }; }); }
  def('source.story', async (n, I, P) => E.mk('story', { paras: parseStory(P.text || ''), styles: P.styles || {} }));
  def(['json.story'], async (n, I, P) => E.mk('story', { paras: parseStory((I.src && I.src.text) || 'The scan held no recognizable text in this build (OCR needs model weights).'), styles: {} }));
  const PAGE = { A4: [595, 842], A5: [420, 595], A3: [842, 1191], Letter: [612, 792], Tabloid: [792, 1224], Square: [600, 600] };
  def('source.pages', async (n, I, P) => {
    const size = Array.isArray(P.size) ? P.size : PAGE[P.size] || PAGE.A4, count = P.spread ? 2 : (P.pages || 1), m = P.margin || 42, cols = P.columns || 1, gut = (P.gutter || 5) * 2.83;
    const pages = Array.from({ length: count }, (_, i) => ({ index: i, items: [], wraps: [], frames: Array.from({ length: cols }, (_, c) => ({ page: i, x: m + c * ((size[0] - 2 * m - gut * (cols - 1)) / cols + gut), y: m, w: (size[0] - 2 * m - gut * (cols - 1)) / cols, h: size[1] - 2 * m })) }));
    return E.mk('pages', { size, pages, baseline: P.baselineGrid || 0, spread: !!P.spread });
  });
  def('pages.place', async (n, I, P, X) => {
    const doc = I.src, pg = Math.max(0, Math.min(doc.pages.length - 1, (P.page || 1) - 1)), [W, H] = doc.size;
    const fr = P.frame || 'right'; const box = fr === 'bleed-right' ? [W * 0.45, 0, W * 0.55, H] : fr === 'top' ? [42, 42, W - 84, H * 0.36] : fr === 'full' || fr === 'bleed' ? [0, 0, W, H] : fr === 'left' ? [0, 0, W * 0.5, H] : Array.isArray(fr) ? fr : [W * 0.5, H * 0.3, W * 0.45, H * 0.4];
    const item = I.item || P.item; const pages = doc.pages.map(p => Object.assign({}, p, { items: p.items.slice(), wraps: p.wraps.slice() }));
    pages[pg].items.push({ value: item, box });
    if (P.wrap !== undefined || I.wrap) {
      const wv = I.wrap || P.wrap; let d = await E.dOf(wv, X);
      // the wrap path lives in the item's image space: map it into the placed box
      const src = is(item, ['image', 'mask']) ? item : null; if (src && d) { const iw = src.w / (src.u || 1), ih = src.h / (src.u || 1), k = Math.max(box[2] / iw, box[3] / ih); d = E.transformD(d, [k, 0, 0, k, box[0] + (box[2] - iw * k) / 2, box[1] + (box[3] - ih * k) / 2]); }
      pages[pg].wraps.push(d ? { d, polys: E.flatten(d) } : { box });
    } else pages[pg].wraps.push({ box });
    return E.mk('pages', Object.assign({}, doc, { pages }));
  });
  def('pages.frames', async (n, I) => ({ doc: I.src, frames: I.src.pages.flatMap(p => p.frames) }));
  def('pages.page', async (n, I, P) => E.mk('pages', Object.assign({}, I.src, { pages: [I.src.pages[Math.max(0, (P.n || 1) - 1)] || I.src.pages[0]], spread: false })));
  // available x-intervals on a line band [y0, y1] inside a frame after wraps
  function lineSlots(frame, y0, y1, wraps) {
    let slots = [[frame.x, frame.x + frame.w]];
    for (const w of wraps) {
      let lo = Infinity, hi = -Infinity;
      if (w.box) { const b = w.box; if (y1 > b[1] && y0 < b[1] + b[3]) { lo = b[0] - 8; hi = b[0] + b[2] + 8; } }
      else for (const p of w.polys) for (let i = 1; i < p.pts.length; i++) { const a = p.pts[i - 1], b = p.pts[i]; if ((a[1] < y0 && b[1] < y0) || (a[1] > y1 && b[1] > y1)) continue; lo = Math.min(lo, a[0], b[0]); hi = Math.max(hi, a[0], b[0]); }
      if (lo === Infinity) continue;
      slots = slots.flatMap(([a, b]) => (hi <= a || lo >= b ? [[a, b]] : [[a, Math.min(b, lo)], [Math.max(a, hi), b]]).filter(s => s[1] - s[0] > 40));
    }
    return slots.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0])).slice(0, 1);
  }
  // Knuth–Plass total-fit line breaking over boxes, glue and penalties
  function knuthPlass(words, widths, space, lineWidth, opts) {
    opts = opts || {}; const n = words.length, tol = opts.tolerance || 3, st = space * 0.5, sh = space * 0.33;
    const lw = i => (typeof lineWidth === 'function' ? lineWidth(i) : lineWidth);
    const pre = [0]; for (let i = 0; i < n; i++) pre.push(pre[i] + widths[i]);
    const start = { pos: -1, line: 0, demerits: 0, prev: null };
    let active = [start];
    for (let j = 0; j < n; j++) {
      const last = j === n - 1; let best = null; const keep = []; let removed = null;
      for (const a of active) {
        const words2 = j - a.pos, gaps = words2 - 1, w = pre[j + 1] - pre[a.pos + 1] + gaps * space, L = lw(a.line);
        let r;
        if (w <= L) r = last ? 0 : gaps ? (L - w) / (gaps * st) : (L - w < space * 2 ? 0 : Infinity);
        else r = gaps ? (L - w) / (gaps * sh) : -Infinity;
        if (r >= -1) keep.push(a); else if (!removed || a.pos > removed.pos) removed = a;
        if (r >= -1 && r <= tol) { const bad = 100 * Math.abs(r) ** 3, dem = a.demerits + (1 + bad) ** 2; if (!best || dem < best.demerits) best = { pos: j, line: a.line + 1, demerits: dem, prev: a, ratio: r, badness: bad }; }
      }
      active = keep;
      if (best) active.push(best);
      if (!active.length) {
        // everything is overfull: break before word j (or after it, when it alone overflows)
        const a = removed || start;
        if (a.pos + 1 >= j) { const node = { pos: j, line: a.line + 1, demerits: a.demerits + 1e5, prev: a, ratio: -1, badness: 1e4, forced: true }; active = [node]; }
        else { const node = { pos: j - 1, line: a.line + 1, demerits: a.demerits + 1e5, prev: a, ratio: tol, badness: 100 * tol ** 3, forced: true }; active = [node]; j--; }
      }
    }
    let end = active.filter(x => x.pos === n - 1).sort((a, b) => a.demerits - b.demerits)[0] || active[active.length - 1];
    const lines = []; while (end && end.prev) { lines.unshift({ from: end.prev.pos + 1, to: end.pos, ratio: end.ratio, badness: end.badness }); end = end.prev; }
    return lines;
  }
  function greedy(words, widths, space, lineWidth) { const lines = []; let from = 0, w = 0; for (let j = 0; j < words.length; j++) { const add = widths[j] + (j > from ? space : 0); if (w + add > (typeof lineWidth === 'function' ? lineWidth(lines.length) : lineWidth) && j > from) { lines.push({ from, to: j - 1, ratio: 0, badness: 0 }); from = j; w = widths[j]; } else w += add; } lines.push({ from, to: words.length - 1, ratio: 0, badness: 0 }); return lines; }
  E.knuthPlass = knuthPlass;
  async function flowStory(story, doc, opts, X) {
    const st = Object.assign({ body: { family: 'Fraunces', size: 9.5, leading: 12.5 }, h1: { family: 'Fraunces', size: 24, leading: 28, weight: 700 }, h2: { family: 'Fraunces', size: 14, leading: 17, weight: 700 }, h3: { family: 'Fraunces', size: 11, leading: 14, weight: 700 } }, story.styles || {});
    const frames = doc.pages.flatMap(p => p.frames.map(f => Object.assign({}, f, { wraps: p.wraps })));
    const pages = doc.pages.map(p => Object.assign({}, p, { glyphs: [], lines: 0 }));
    let fi = 0, y = frames[0] ? frames[0].y : 0; const stats = { lines: 0, badness: 0, widows: 0, maxRatio: 0, breaker: opts.breaker || 'knuthPlass', overset: 0 };
    for (const para of story.paras) {
      const s = Object.assign({ family: 'Fraunces', size: 10, leading: 13 }, st[para.style] || st.body);
      const words = para.text.split(' '), font = await E.font(s.family, s.weight, s.style), sc = s.size / font.unitsPerEm;
      const adv = w => E.wordPath(font, w, 0, 0, s.size).adv; const widths = words.map(adv), space = adv(' '), lead = s.leading || s.size * 1.25;
      if (para.style !== 'body') y += lead * 0.6;
      const lineInfo = []; let fy = y, ffi = fi;
      const advance = () => { while (ffi < frames.length && fy + lead > frames[ffi].y + frames[ffi].h) { ffi++; if (ffi < frames.length) fy = frames[ffi].y; } };
      const widthAt = i => {
        let guard = 0;
        while (lineInfo.length <= i && guard++ < 5000) {
          advance();
          if (ffi >= frames.length) { const prev = lineInfo.filter(l => !l.overset).pop(); lineInfo.push({ frame: frames.length, overset: true, w: prev ? prev.w : (frames[0] ? frames[0].w : 300) }); continue; }
          const f = frames[ffi], sl = lineSlots(f, fy, fy + lead, f.wraps)[0];
          if (!sl) { fy += lead; continue; }   // a placed box covers this band across the column: skip below it
          lineInfo.push({ frame: ffi, y: fy + lead * 0.8, x: sl[0], w: sl[1] - sl[0] }); fy += lead;
        }
        return lineInfo[Math.min(i, lineInfo.length - 1)].w;
      };
      const lines = (opts.breaker === 'greedy' ? greedy : knuthPlass)(words, widths, space, widthAt, { tolerance: 4 });
      lines.forEach((ln, li) => {
        widthAt(li); const L = lineInfo[li]; if (!L || L.overset || L.frame >= frames.length) { stats.overset++; return; }
        const frame = frames[L.frame], pg = pages[frame.page]; const ws = words.slice(ln.from, ln.to + 1), wsw = widths.slice(ln.from, ln.to + 1);
        const natural = wsw.reduce((a, b) => a + b, 0) + space * (ws.length - 1), lastLine = li === lines.length - 1;
        const gap = !lastLine && ws.length > 1 && para.style === 'body' ? (L.w - (natural - space * (ws.length - 1))) / (ws.length - 1) : space;
        let x = L.x; ws.forEach((w, k) => { pg.glyphs.push({ d: E.wordPath(font, w, x, L.y, s.size).d, fill: s.color || '#1d2733' }); x += wsw[k] + gap; });
        stats.lines++; stats.badness += ln.badness || 0; stats.maxRatio = Math.max(stats.maxRatio, Math.abs(ln.ratio || 0));
        if (lastLine && ws.length === 1 && lines.length > 1) stats.widows++;
      });
      if (lineInfo.length) { const lastL = lineInfo[Math.min(lines.length, lineInfo.length) - 1]; if (lastL.overset) { fi = frames.length; } else { fi = lastL.frame; y = lastL.y - lead * 0.8 + lead + lead * 0.35; } }
      void sc;
    }
    stats.avgBadness = stats.lines ? Math.round(stats.badness / stats.lines * 10) / 10 : 0;
    if (stats.overset && X) X.note(`overset: ${stats.overset} line${stats.overset === 1 ? '' : 's'} did not fit the frames (add pages or shrink the type)`);
    return E.mk('pages', Object.assign({}, doc, { pages, stats }));
  }
  def(['story.flow'], async (n, I, P, X) => { const fr = I.frames || P.frames; const doc = fr && fr.doc ? fr.doc : is(fr, 'pages') ? fr : await X.eval(E.P.ir.nodes.find(m => m.op === 'source.pages').id); return flowStory(I.src, doc, P, X); });
  def(['pages.flow'], async (n, I, P, X) => flowStory(I.story || P.story, I.src, P, X));
  E.renderPages = async function (doc, W, H, X) {
    const [pw, ph] = doc.size, count = doc.pages.length, gap = count > 1 ? 18 : 0, artW = pw * count + gap * (count - 1) + 40, artH = ph + 40;
    if (!W || !H) [W, H] = E.fitSize(artW * 2, artH * 2, 1400);
    const s = Math.min(W / artW, H / artH), c = E.canvas(W, H), g = c.getContext('2d');
    g.fillStyle = '#e8e6e0'; g.fillRect(0, 0, W, H); g.setTransform(s, 0, 0, s, (W - artW * s) / 2 + 20 * s, (H - artH * s) / 2 + 20 * s);
    for (let i = 0; i < count; i++) {
      const p = doc.pages[i], ox = i * (pw + gap);
      g.save(); g.translate(ox, 0); g.fillStyle = '#ffffff'; g.shadowColor = 'rgba(0,0,0,0.18)'; g.shadowBlur = 12; g.fillRect(0, 0, pw, ph); g.restore();
      g.save(); g.translate(ox, 0); g.beginPath(); g.rect(0, 0, pw, ph); g.clip();
      for (const it of p.items) { const v = it.value; if (!v) continue; const im = await X.img(v); const b = it.box, k = Math.max(b[2] / im.w, b[3] / im.h); g.save(); g.beginPath(); g.rect(b[0], b[1], b[2], b[3]); g.clip(); g.drawImage(E.toCanvas(im), b[0] + (b[2] - im.w * k) / 2, b[1] + (b[3] - im.h * k) / 2, im.w * k, im.h * k); g.restore(); }
      for (const gl of p.glyphs || []) { g.fillStyle = gl.fill; g.fill(new Path2D(gl.d)); }
      if (doc.baseline && X.env.showGrid) { g.strokeStyle = 'rgba(0,120,191,0.15)'; for (let y = 0; y < ph; y += doc.baseline) { g.beginPath(); g.moveTo(0, y); g.lineTo(pw, y); g.stroke(); } }
      g.restore();
    }
    return E.fromCanvas(c, { u: s });
  };
  def(['pages.render'], async (n, I, P, X) => {
    // a sample page stands in for the PDF: the bundled handwriting scan on paper
    if (I.src && I.src.pages && I.src.pages.some(p => (p.glyphs || []).length || p.items.length)) return E.renderPages(I.src, 0, 0, X);
    X.note('no PDF ships with the workbench; the bundled scan of handwritten notes stands in for page 1');
    const scan = await E.loadAsset('text.png', 1200); const img = await E.affine(scan, [1, 0.035, -0.035, 1, 12, -6]); const bg = E.image(img.w, img.h); bg.d.fill(0.97); return E.blend(bg, img, 'multiply', 1);
  });
  def('source.pdf', async (n, I, P) => E.mk('pages', { size: PAGE.A5, pages: [{ index: 0, items: [], wraps: [], frames: [] }], src: P.src }));
  def(['json.figures'], async (n, I) => E.list([{ box: [0.1, 0.55, 0.8, 0.4] }, { box: [0.55, 0.1, 0.4, 0.4] }]));

  // ── 3D: a small raymarcher stands in for the stage (capsule mannequin, extruded shapes) ──
  const POSES = {
    'dance-04': { lArm: [-140, 30], rArm: [40, -70], lLeg: [-15, 10], rLeg: [35, 70], spine: 8, head: -10 },
    'stand': { lArm: [-80, -10], rArm: [80, -10], lLeg: [-5, 0], rLeg: [5, 0], spine: 0, head: 0 },
    'reach': { lArm: [-160, 10], rArm: [160, -10], lLeg: [-10, 0], rLeg: [10, 0], spine: 0, head: -15 },
    'run': { lArm: [-50, 70], rArm: [130, -60], lLeg: [-40, 60], rLeg: [40, -10], spine: 12, head: 5 },
  };
  def('source.scene', async () => E.mk('scene', { objects: [], camera: { fov: 35, at: [0, 1.4, 4], lookAt: [0, 1, 0] } }));
  def('source.mannequin', async (n, I, P) => E.mk('mannequin', { pose: POSES[P.pose] ? P.pose : 'dance-04' }));
  def('scene.add', async (n, I, P) => { const it = I.item || P.item; return E.mk('scene', Object.assign({}, I.src, { objects: I.src.objects.concat([{ value: it, at: P.at || [0, 0, 0] }]) })); });
  def('scene.camera', async (n, I, P) => E.mk('scene', Object.assign({}, I.src, { camera: Object.assign({}, I.src.camera, P) })));
  function capsules(pose, at) {
    const p = POSES[pose] || POSES['dance-04'], rad = d => d * Math.PI / 180, caps = [], o = at || [0, 0, 0];
    const v = (x, y, z) => [x + o[0], y + o[1], z + o[2]];
    const hip = v(0, 0.95, 0), chest = v(Math.sin(rad(p.spine)) * 0.45, 1.4, 0), neck = v(chest[0] * 1.05, 1.55, 0), head = v(neck[0] + Math.sin(rad(p.head)) * 0.15, 1.72, 0);
    caps.push([hip, chest, 0.13], [neck, head, 0.11]);
    const limb = (root, ang, len, r) => { const a = rad(ang[0]), b = rad(ang[1]); const mid = [root[0] + Math.sin(a) * len, root[1] - Math.cos(a) * len, root[2]]; const end = [mid[0] + Math.sin(a + b) * len, mid[1] - Math.cos(a + b) * len, mid[2] + 0.05]; caps.push([root, mid, r], [mid, end, r * 0.85]); };
    limb([chest[0] - 0.2, 1.42, 0], p.lArm, 0.3, 0.055); limb([chest[0] + 0.2, 1.42, 0], p.rArm, 0.3, 0.055);
    limb([hip[0] - 0.1, 0.92, 0], p.lLeg.map(x => x), 0.44, 0.075); limb([hip[0] + 0.1, 0.92, 0], p.rLeg, 0.44, 0.075);
    return caps;
  }
  def('scene.render', async (n, I, P, X) => {
    const sc = I.src, size = P.size || [512, 512], [W, H] = E.fitSize(size[0], size[1], 320);
    const caps = []; for (const o of sc.objects) { const v = o.value; if (is(v, 'mannequin')) caps.push(...capsules(v.pose, o.at)); }
    const cam = sc.camera || {}, eye = cam.at || [0, 1.4, 4], look = cam.lookAt || [0, 1, 0], fov = (cam.fov || 35) * Math.PI / 180;
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], norm = a => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); }, cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const fw = norm(sub(look, eye)), rt = norm(cross(fw, [0, 1, 0])), up = cross(rt, fw);
    const sdf = p => { let d = p[1]; let id = 0; for (const [a, b, r] of caps) { const pa = sub(p, a), ba = sub(b, a); const h = clamp01(dot(pa, ba) / dot(ba, ba)); const q = [pa[0] - ba[0] * h, pa[1] - ba[1] * h, pa[2] - ba[2] * h]; const dd = Math.hypot(...q) - r; if (dd < d) { d = dd; id = 1; } } return [d, id]; };
    const beauty = E.image(W, H), depth = E.field(W, H, 1, null, ['depth']), L = norm([0.6, 0.9, 0.7]);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = (2 * (x + 0.5) / W - 1) * Math.tan(fov / 2) * (W / H), v = (1 - 2 * (y + 0.5) / H) * Math.tan(fov / 2), dir = norm([fw[0] + rt[0] * u + up[0] * v, fw[1] + rt[1] * u + up[1] * v, fw[2] + rt[2] * u + up[2] * v]);
      let t = 0, hit = false, id = 0; for (let s = 0; s < 80; s++) { const p = [eye[0] + dir[0] * t, eye[1] + dir[1] * t, eye[2] + dir[2] * t]; const [d, i] = sdf(p); if (d < 0.002) { hit = true; id = i; break; } t += d; if (t > 12) break; }
      const k = (y * W + x) * 4;
      if (hit) { const p = [eye[0] + dir[0] * t, eye[1] + dir[1] * t, eye[2] + dir[2] * t], e = 0.002; const nn = norm([sdf([p[0] + e, p[1], p[2]])[0] - sdf([p[0] - e, p[1], p[2]])[0], sdf([p[0], p[1] + e, p[2]])[0] - sdf([p[0], p[1] - e, p[2]])[0], sdf([p[0], p[1], p[2] + e])[0] - sdf([p[0], p[1], p[2] - e])[0]]); const dif = Math.max(0, dot(nn, L)), amb = 0.25 + 0.2 * nn[1]; const base = id ? [0.86, 0.8, 0.72] : [0.55, 0.57, 0.6]; const fog = Math.exp(-t * 0.08); for (let c = 0; c < 3; c++) beauty.d[k + c] = clamp01((base[c] * (dif * 0.85 + amb)) * fog + 0.12 * (1 - fog)); depth.d[y * W + x] = clamp01(1 - t / 8); }
      else { for (let c = 0; c < 3; c++) beauty.d[k + c] = 0.2 + 0.25 * (1 - y / H); depth.d[y * W + x] = 0; }
      beauty.d[k + 3] = 1;
    }
    return { beauty, depth, normal: depth, size: [W, H] };
  });
  def(['shapes.extrude'], async (n, I, P, X) => { X.note('3D extrude renders as a flat shaded preview here'); const img = await E.rasterize(I.src, 0, 0, X); return E.mk('scene', { objects: [{ value: img }], camera: {} }); });

  // ── generation: no model runs in the browser; a placeholder carries the prompt ──
  async function genPlaceholder(P, i, X) {
    const W = 512, H = 512, hue = (((P.seed || 0) * 37 + i * 83) % 360) / 360;
    const hsv = (h, s, v) => { const f = n => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return [f(5), f(3), f(1)]; };
    const a = hsv(hue, 0.55, 0.35), b = hsv((hue + 0.12) % 1, 0.5, 0.85), img = E.image(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const t = clamp01(0.5 * (x / W) + 0.7 * (y / H) + 0.08 * E.noise2('simplex', x / 90, y / 90, i)); const k = (y * W + x) * 4; for (let c = 0; c < 3; c++) img.d[k + c] = a[c] + (b[c] - a[c]) * t; img.d[k + 3] = 1; }
    const prompt = String(P.prompt || 'a generated image').slice(0, 90);
    const txt = E.mk('text', { text: `${prompt}`, font: { family: 'Instrument Serif', size: 28, width: 420 }, fill: '#ffffff', at: [0.5, 0.45] });
    const lbl = E.mk('text', { text: `${P.model || 'model'} · variant ${i + 1} · needs a remote model`, font: { family: 'JetBrains Mono', size: 13 }, fill: '#ffffffcc', at: [0.5, 0.88] });
    let out = await E.blend(img, await E.rasterize(txt, W, H, X, { unitsPerPx: 1, at: [0.5, 0.45] }), 'normal', 1);
    out = await E.blend(out, await E.rasterize(lbl, W, H, X, { unitsPerPx: 1, at: [0.5, 0.88] }), 'normal', 1);
    return out;
  }
  def('gen.*', async (n, I, P, X) => { X.note('image generation needs a remote model; this is a placeholder that carries the prompt'); return genPlaceholder(P, 0, X); });
  def('gen.variants', async (n, I, P, X) => { const g = E.P.byId.get(n.in.gen); const gp = await X.resolve(g.params); const k = Math.max(1, Math.min(8, gp.n || 4)); const items = []; for (let i = 0; i < k; i++) items.push(await genPlaceholder(gp, i, X)); return E.list(items); }, { lazy: true });
  def('gen.choose', async (n, I, P, X) => { const g = E.P.byId.get(n.in.gen); return genPlaceholder(await X.resolve(g.params), P.index || 0, X); }, { lazy: true });
  def('gen.plan', async (n, I, P, X) => ({ steps: ['remote model call', 'pin the chosen variant'], note: 'not run here' }), { lazy: true });
  def(['image.develop', 'clip.develop'], async (n, I, P, X) => {
    const img = await X.img(I.src); const s = Object.assign({}, P.settings || P); delete s.settings;
    const MAP = { exposure: 'light.exposure', contrast: 'light.contrast', highlights: 'light.highlights', shadows: 'light.shadows', whites: 'light.whites', blacks: 'light.blacks', vibrance: 'color.vibrance', saturation: 'color.saturation', texture: 'effects.texture', clarity: 'effects.clarity', dehaze: 'effects.dehaze', temp: 'wb.temp', temperature: 'wb.temp', tint: 'wb.tint', vignette: 'vignette.amount', grain: 'grain.amount', sharpen: 'detail.sharpen_amount', denoise: 'detail.nr_luminance' };
    const tree = {}; let preset = null;
    for (const [k, v] of Object.entries(s)) { if (k === 'preset') { preset = v; continue; } if (v && typeof v === 'object' && !Array.isArray(v)) { tree[k] = Object.assign(tree[k] || {}, v); continue; } const path = (MAP[k] || k).split('.'); if (path.length < 2) continue; (tree[path[0]] = tree[path[0]] || {})[path[1].replace(/[A-Z]/g, c => '_' + c.toLowerCase())] = v; }
    try { const r = await E.wasmCall('ck_light', 'develop', Object.assign({ w: img.w, h: img.h, settings: tree }, preset ? { preset, amount: s.amount === undefined ? 1 : s.amount } : {}), img.d); const W = r.msg.w || img.w, H = r.msg.h || img.h; return E.image(W, H, new Float32Array(r.out.buffer, 0, W * H * 4), { u: img.u }); }
    catch (e) {
      X.note('LightCraft develop module unavailable; a JS approximation ran: ' + e.message);
      let o = await E.adjust(img, 'exposure', { exposure: +(s.exposure || 0) }); if (s.contrast) o = await E.adjust(o, 'brightnessContrast', { contrast: s.contrast * 0.6 });
      if (s.vibrance || s.saturation) o = await E.adjust(o, 'vibrance', { vibrance: s.vibrance || 0, saturation: s.saturation || 0 });
      if (s.shadows || s.highlights) o = await E.adjust(o, 'curves', { points: [[0, 0], [64, Math.max(0, Math.min(255, 64 + (s.shadows || 0) * 0.4))], [192, Math.max(0, Math.min(255, 192 + (s.highlights || 0) * 0.3))], [255, 255]] });
      return o;
    }
  });
  def(['*.meta.set', 'image.meta.set'], async (n, I) => I.src);

  // ── exports ────────────────────────────────────────────────────────────
  def('sink.*', async (n, I, P) => ({ sink: n.op.slice(5), file: P.file || null, src: n.in.src }));
  E.exportSink = async function (id, req) {
    const n = E.P.byId.get(id); if (!n) throw new Error('no export ' + id);
    const fmt = n.op.slice(5), env = { controls: (req && req.controls) || {}, time: (req && req.time) || 0, sheet: (req && req.sheet) || {}, target: (req && req.target) || 'wasm', bind: null };
    const X = E.ctx(env); const v = await X.eval(n.in.src); const o = await X.resolve(n.params || {});
    const base = String(o.file || n.params.file || `craftkit.${fmt}`).replace(/\.(psd|mp4|mov|lottie|cube|pdf|wav)$/i, m => m);
    const asImg = async (mime, ext) => { const img = await X.img(v); const blob = await E.toCanvas(img).convertToBlob({ type: mime, quality: 0.92 }); return { filename: base.replace(/\.[a-z0-9]+$/i, '') + '.' + ext, data: await blob.arrayBuffer(), mime }; };
    if (fmt === 'png' || fmt === 'psd' || fmt === 'tiff') { const r = await asImg('image/png', 'png'); if (fmt !== 'png') r.note = `${fmt.toUpperCase()} is not written in the browser build; saved as PNG`; return r; }
    if (fmt === 'jpg' || fmt === 'jpeg') return asImg('image/jpeg', 'jpg');
    if (fmt === 'webp') return asImg('image/webp', 'webp');
    if (fmt === 'svg') return { filename: base.replace(/\.[a-z0-9]+$/i, '') + '.svg', data: await E.toSVG(v, X, o), mime: 'image/svg+xml' };
    if (fmt === 'css') { const t = is(v, 'tokens') ? v : is(v, 'palette') ? { css: ':root {\n' + v.colors.map((c, i) => `  --${String(c.name || 'color-' + (i + 1)).replace(/\s+/g, '-')}: ${c.hex};`).join('\n') + '\n}\n' } : { css: '' }; return { filename: base.replace(/\.[a-z0-9]+$/i, '') + '.css', data: t.css, mime: 'text/css', ext: 'txt' }; }
    if (fmt === 'cube') { const t = v && v.text ? v.text : ''; return { filename: base.replace(/\.[a-z0-9]+$/i, '') + '.cube', data: t, mime: 'text/plain', ext: 'txt' }; }
    if (fmt === 'json' || fmt === 'lottie') return { filename: base.replace(/\.[a-z0-9]+$/i, '') + '.json', data: JSON.stringify(E.describe(v) || v, null, 2), mime: 'application/json', note: fmt === 'lottie' ? 'Lottie export is not in the browser build; the comp description was saved as JSON' : undefined };
    if (fmt === 'wav' || is(v, 'audio')) { const a = v; const n2 = a.ch[0].length, ch = a.ch.length, buf = new ArrayBuffer(44 + n2 * ch * 2), dv = new DataView(buf); const w = (o2, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o2 + i, s.charCodeAt(i)); }; w(0, 'RIFF'); dv.setUint32(4, 36 + n2 * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true); dv.setUint32(24, a.sr, true); dv.setUint32(28, a.sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n2 * ch * 2, true); for (let i = 0; i < n2; i++) for (let c = 0; c < ch; c++) dv.setInt16(44 + (i * ch + c) * 2, Math.max(-1, Math.min(1, a.ch[c][i])) * 32767, true); return { filename: base.replace(/\.[a-z0-9]+$/i, '') + '.wav', data: buf, mime: 'audio/wav', zip: true }; }
    if (fmt === 'pdf') return { filename: base.replace(/\.[a-z0-9]+$/i, '') + '.pdf', data: await E.toPDF(v, X), mime: 'application/pdf' };
    if (fmt === 'mp4' || fmt === 'webm') return { video: true, filename: base.replace(/\.[a-z0-9]+$/i, '') + '.webm', note: 'video is recorded from the canvas as WebM' };
    return asImg('image/png', 'png');
  };
  // a PDF from a raster or from shapes (vector paths; text already outlined)
  E.toPDF = async function (v, X) {
    let W, H, content = '', img = null;
    if (is(v, ['shapes', 'path', 'text'])) {
      const s = await E.asShapes(v, X); W = s.w; H = s.h; const items = is(v, 'text') ? await E.textItems(v, X, [W, H]) : s.items;
      if (s.background) { const c = hex(s.background); content += `${c[0].toFixed(3)} ${c[1].toFixed(3)} ${c[2].toFixed(3)} rg 0 0 ${W} ${H} re f\n`; }
      for (const it of items) { if (!it.d) continue; let ops = ''; let x = 0, y = 0; for (const sg of E.parsePath(it.d)) { const T = (a, b) => `${a.toFixed(2)} ${(H - b).toFixed(2)}`; if (sg[0] === 'M') { ops += T(sg[1], sg[2]) + ' m '; x = sg[1]; y = sg[2]; } else if (sg[0] === 'L') { ops += T(sg[1], sg[2]) + ' l '; x = sg[1]; y = sg[2]; } else if (sg[0] === 'C') { ops += `${T(sg[1], sg[2])} ${T(sg[3], sg[4])} ${T(sg[5], sg[6])} c `; x = sg[5]; y = sg[6]; } else if (sg[0] === 'Q') { const c1 = [x + 2 / 3 * (sg[1] - x), y + 2 / 3 * (sg[2] - y)], c2 = [sg[3] + 2 / 3 * (sg[1] - sg[3]), sg[4] + 2 / 3 * (sg[2] - sg[4])]; ops += `${T(c1[0], c1[1])} ${T(c2[0], c2[1])} ${T(sg[3], sg[4])} c `; x = sg[3]; y = sg[4]; } else ops += 'h '; } const fl = it.fill && it.fill !== 'none' ? hex(it.fill) : null, st = it.stroke && it.stroke !== 'none' ? hex(it.stroke) : null; if (fl) content += `${fl[0].toFixed(3)} ${fl[1].toFixed(3)} ${fl[2].toFixed(3)} rg `; if (st) content += `${st[0].toFixed(3)} ${st[1].toFixed(3)} ${st[2].toFixed(3)} RG ${(it.sw || 1).toFixed(2)} w `; content += ops + (fl && st ? 'B\n' : fl ? 'f\n' : st ? 'S\n' : 'n\n'); }
    } else {
      img = await X.img(v); W = Math.round(img.w / (img.u || 1)); H = Math.round(img.h / (img.u || 1));
      content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q\n`;
    }
    const enc2 = new TextEncoder(), parts = [], offs = [];
    let jpg = null; if (img) jpg = new Uint8Array(await (await E.toCanvas(img).convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer());
    const objs = [`<< /Type /Catalog /Pages 2 0 R >>`, `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents 4 0 R /Resources << ${img ? '/XObject << /Im0 5 0 R >>' : ''} >> >>`, null, null];
    let pos = 0; const push = b => { const u = typeof b === 'string' ? enc2.encode(b) : b; parts.push(u); pos += u.length; };
    push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
    for (let i = 0; i < 3; i++) { offs.push(pos); push(`${i + 1} 0 obj\n${objs[i]}\nendobj\n`); }
    offs.push(pos); const cb = enc2.encode(content); push(`4 0 obj\n<< /Length ${cb.length} >>\nstream\n`); push(cb); push('\nendstream\nendobj\n');
    if (img) { offs.push(pos); push(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`); push(jpg); push('\nendstream\nendobj\n'); }
    const xref = pos; push(`xref\n0 ${offs.length + 1}\n0000000000 65535 f \n` + offs.map(o2 => String(o2).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${offs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(pos); let k = 0; for (const p of parts) { out.set(p, k); k += p.length; } return out.buffer;
  };
  // a stored-only ZIP (for formats the save dialog does not take directly: .wav, .cube)
  E.zip = function (files) {
    const enc2 = new TextEncoder(), crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const local = [], central = []; let off = 0;
    for (const f of files) { const name = enc2.encode(f.name), data = typeof f.data === 'string' ? enc2.encode(f.data) : new Uint8Array(f.data), c = crc(data); const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, c, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); local.push(new Uint8Array(h.buffer), name, data); const cd = new DataView(new ArrayBuffer(46)); cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint32(16, c, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, name.length, true); cd.setUint32(42, off, true); central.push(new Uint8Array(cd.buffer), name); off += 30 + name.length + data.length; }
    const cdLen = central.reduce((a, b) => a + b.length, 0), end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdLen, true); end.setUint32(16, off, true);
    const all = local.concat(central, [new Uint8Array(end.buffer)]), out = new Uint8Array(all.reduce((a, b) => a + b.length, 0)); let k = 0; for (const p of all) { out.set(p, k); k += p.length; } return out.buffer;
  };
})(typeof self !== 'undefined' ? self : this);
;(function (root) { const E = root.CK_ENGINE; E.def('source.palette', async (n, I, P) => E.mkPalette((P.colors || ['#1d2733', '#f4efe6']).map(c => ({ rgb: E.hex(c).slice(0, 3).map(v => Math.round(v * 255)) })), { weighted: false })); })(typeof self !== 'undefined' ? self : this);
