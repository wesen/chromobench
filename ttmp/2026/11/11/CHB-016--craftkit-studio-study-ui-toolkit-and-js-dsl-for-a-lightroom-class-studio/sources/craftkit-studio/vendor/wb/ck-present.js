/* ck-present.js · turns engine values into what the page can draw: ImageBitmaps (transferred, not copied), palettes,
 * audio for playback, tables, and the scopes (histogram, waveform, vectorscope, parade, spectrum, loudness,
 * constraints, typography, preflight, gamut). Runs in the worker. */
(function (root) {
  'use strict';
  const E = root.CK_ENGINE, is = E.is, luma = E.luma, clamp01 = E.clamp01;

  async function bitmap(img, maxSide, transfer, meta) {
    let v = img;
    const m = Math.max(v.w, v.h); if (maxSide && m > maxSide) { const k = maxSide / m; v = E.resample(v, Math.max(1, Math.round(v.w * k)), Math.max(1, Math.round(v.h * k))); }
    const bmp = await createImageBitmap(new ImageData(E.toU8(v.t === 'image' ? v : await E.need(v, 'image')), v.w, v.h));
    transfer.push(bmp);
    return Object.assign({ kind: 'bitmap', w: v.w, h: v.h, srcW: img.w, srcH: img.h, bmp, u: img.u || 1, label: img.label }, meta || {});
  }
  E.bitmap = bitmap;

  E.present = async function (v, item, run, env, transfer) {
    const max = item.max || 1600;
    if (item.lens) return lens(item.lens, v, item, env, transfer);
    if (v == null) return { kind: 'json', value: null };
    if (typeof v !== 'object') return { kind: 'json', value: v };
    if (!v[E.K]) {
      if (v.beauty && is(v.beauty, 'image')) return bitmap(v.beauty, max, transfer, { passes: Object.keys(v).filter(k => is(v[k], ['image', 'field', 'mask'])) });
      if (v.sink) return { kind: 'sink', sink: v.sink, file: v.file };
      return { kind: 'json', value: JSON.parse(JSON.stringify(v, (k, x) => (x && x[E.K] ? E.describe(x) : x))) };
    }
    switch (v.t) {
      case 'image': case 'mask': case 'field': {
        const out = await bitmap(v, max, transfer, { vkind: v.t });
        if (v.audio) out.audio = await audioPayload(mixAudio(v.audio), transfer);
        if (v.timing) out.timing = v.timing;
        return out;
      }
      case 'proc': return bitmap(await v.gen(640, 480), max, transfer, { vkind: v.kind });
      case 'shapes': case 'path': case 'text': case 'pages': {
        const img = await E.rasterize(v, 0, 0, E.ctx(env), { paper: v.t !== 'pages' });
        return bitmap(img, max, transfer, { vkind: v.t, items: v.items ? v.items.length : undefined, stats: v.stats });
      }
      case 'list': {
        const items = [];
        for (const x of v.items.slice(0, 16)) items.push(await E.present(x, { max: Math.min(480, max) }, run, env, transfer));
        return { kind: 'list', items, count: v.items.length };
      }
      case 'palette': return { kind: 'palette', colors: v.colors, weighted: !!v.weighted };
      case 'tokens': return { kind: 'tokens', vars: v.vars, css: v.css, colors: v.palette ? v.palette.colors : [] };
      case 'audio': return audioPayload(v, transfer);
      case 'series': return { kind: 'series', frames: v.frames.length, hop: v.hop, now: E.sampleSeries(v, env.time) };
      case 'table': return { kind: 'table', cells: v.cells, values: v.values, errors: v.errors, node: v.node };
      case 'sketch': return { kind: 'sketch', report: v.report || null };
      case 'lut': return Object.assign(await bitmap(v.preview, 600, transfer), { kind: 'bitmap', vkind: 'lut', note: `${v.size}³ LUT baked from ${v.ops} ops` });
      case 'scene': case 'mannequin': { const sc = await E.evalSceneThumb(v, env); return sc ? bitmap(sc, max, transfer) : { kind: 'json', value: E.describe(v) }; }
      case 'story': return { kind: 'json', value: { paragraphs: v.paras.length, words: v.paras.reduce((a, p) => a + p.text.split(' ').length, 0) } };
      default: return { kind: 'json', value: E.describe(v) };
    }
  };
  E.evalSceneThumb = async function (v, env) {
    const sc = is(v, 'mannequin') ? E.mk('scene', { objects: [{ value: v, at: [0, 0, 0] }], camera: {} }) : v;
    const fake = { id: 'scene-thumb', op: 'scene.render', in: {}, params: {} };
    const r = await E.OPS['scene.render'].impl(fake, { src: sc }, { size: [512, 512] }, E.ctx(env));
    return r.beauty;
  };
  function mixAudio(list) {
    const parts = list.map(x => x.audio || x.a || x).filter(a => a && a.ch);
    if (!parts.length) return null;
    const sr = parts[0].sr, len = Math.max(...parts.map(a => a.ch[0].length)), L = new Float32Array(len), R = new Float32Array(len);
    for (const a of parts) { const l = a.ch[0], r = a.ch[1] || l; for (let i = 0; i < l.length; i++) { L[i] += l[i]; R[i] += r[i]; } }
    return E.audio(sr, [L, R]);
  }
  async function audioPayload(a, transfer) {
    if (!a) return null;
    const N = a.ch[0].length, P = 1200, peaks = new Float32Array(P * 2), per = N / P;
    for (let x = 0; x < P; x++) { let mn = 0, mx = 0; for (let i = Math.floor(x * per); i < Math.floor((x + 1) * per); i++) { const s = a.ch[0][i]; if (s < mn) mn = s; if (s > mx) mx = s; } peaks[x * 2] = mn; peaks[x * 2 + 1] = mx; }
    const pcm = a.ch.slice(0, 2).map(c => Float32Array.from(c));
    for (const c of pcm) transfer.push(c.buffer);
    return { kind: 'audio', sr: a.sr, pcm, peaks, dur: N / a.sr, channels: a.ch.length };
  }

  // ── scopes ─────────────────────────────────────────────────────────────
  async function lens(kind, v, item, env, transfer) {
    const X = E.ctx(env);
    const asImg = async () => { let img = await X.img(v); if (img.w * img.h > 300000) { const k = Math.sqrt(300000 / (img.w * img.h)); img = E.resample(img, Math.round(img.w * k), Math.round(img.h * k)); } return img; };
    if (kind === 'histogram') return { kind: 'histogram', hist: E.histogram(await asImg()) };
    if (kind === 'waveform' || kind === 'parade') {
      const img = await asImg(), W = Math.min(512, img.w), Hh = 200, parade = kind === 'parade', cols = parade ? 3 : 1;
      const acc = new Float32Array(W * cols * Hh * 3);
      for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
        const i = (y * img.w + x) * 4, xx = Math.floor(x * W / img.w);
        if (parade) for (let c = 0; c < 3; c++) { const yy = Hh - 1 - Math.round(clamp01(img.d[i + c]) * (Hh - 1)); acc[(yy * W * 3 + c * W + xx) * 3 + c] += 1; }
        else { const yy = Hh - 1 - Math.round(clamp01(luma(img.d[i], img.d[i + 1], img.d[i + 2])) * (Hh - 1)); const k = (yy * W + xx) * 3; acc[k] += 0.4; acc[k + 1] += 1; acc[k + 2] += 0.7; }
      }
      const OW = W * cols, out = E.image(OW, Hh), gain = 18 * (W * Hh) / (img.w * img.h);
      for (let i = 0; i < OW * Hh; i++) { for (let c = 0; c < 3; c++) out.d[i * 4 + c] = clamp01(0.07 + Math.sqrt(acc[i * 3 + c] * gain) * 0.35); out.d[i * 4 + 3] = 1; }
      for (const g of [0.25, 0.5, 0.75]) { const yy = Math.round(Hh * g); for (let x = 0; x < OW; x++) { const k = (yy * OW + x) * 4; out.d[k] = out.d[k + 1] = out.d[k + 2] = Math.max(out.d[k], 0.22); } }
      return bitmap(out, 0, transfer, { scope: kind });
    }
    if (kind === 'vectorscope') {
      const img = await asImg(), S = 220, acc = new Float32Array(S * S), out = E.image(S, S);
      for (let i = 0; i < img.w * img.h; i++) { const r = img.d[i * 4], g = img.d[i * 4 + 1], b = img.d[i * 4 + 2], cb = -0.1146 * r - 0.3854 * g + 0.5 * b, cr = 0.5 * r - 0.4542 * g - 0.0458 * b; const x = Math.round(S / 2 + cb * S * 0.9), y = Math.round(S / 2 - cr * S * 0.9); if (x >= 0 && y >= 0 && x < S && y < S) acc[y * S + x] += 1; }
      const gain = 40 * (S * S) / (img.w * img.h);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const k = y * S + x, d = Math.hypot(x - S / 2, y - S / 2), ring = Math.abs(d - S * 0.45) < 0.8 || Math.abs(d - S * 0.225) < 0.6; const a = Math.sqrt(acc[k] * gain); out.d[k * 4] = clamp01(0.06 + a * 0.3 + (ring ? 0.18 : 0)); out.d[k * 4 + 1] = clamp01(0.07 + a * 0.5 + (ring ? 0.18 : 0)); out.d[k * 4 + 2] = clamp01(0.08 + a * 0.35 + (ring ? 0.18 : 0)); out.d[k * 4 + 3] = 1; }
      if (item.props && item.props.skinLine) { for (let t = 0; t < S * 0.45; t++) { const a = (123 * Math.PI) / 180, x = Math.round(S / 2 + Math.cos(a) * t), y = Math.round(S / 2 - Math.sin(a) * t); const k = (y * S + x) * 4; out.d[k] = 0.95; out.d[k + 1] = 0.72; out.d[k + 2] = 0.3; } }
      return bitmap(out, 0, transfer, { scope: 'vectorscope' });
    }
    if (kind === 'spectrum') {
      if (is(v, 'audio')) { const fr = E.bandsOf(v, 32, 1 / 15, 0); const now = fr[Math.min(fr.length - 1, Math.floor((env.time || 0) * 15))] || []; const avg = fr.length ? fr[0].map((_, k) => fr.reduce((a, f) => a + f[k], 0) / fr.length) : []; return { kind: 'spectrum', now, avg }; }
      if (is(v, 'series')) { const now = E.sampleSeries(v, env.time); return { kind: 'spectrum', now: Array.isArray(now) ? now : [now], avg: [] }; }
      return { kind: 'json', value: 'spectrum needs audio' };
    }
    if (kind === 'loudness') {
      if (!is(v, 'audio')) return { kind: 'json', value: 'loudness needs audio' };
      try { const r = await E.snd('analyze', { kind: 'loudness' }, v); return { kind: 'stats', rows: [['Integrated', `${r.msg.integrated_lufs.toFixed(1)} LUFS`], ['True peak', `${r.msg.true_peak_db.toFixed(1)} dBTP`], ['Max momentary', `${r.msg.max_momentary_lufs.toFixed(1)} LUFS`], ['Length', `${r.msg.seconds.toFixed(1)} s`]], src: 'SoundCraft BS.1770 meter' }; }
      catch (e) { return { kind: 'stats', rows: [['Loudness', 'meter unavailable: ' + e.message]] }; }
    }
    if (kind === 'constraints') {
      let s = v; if (is(v, 'sketch') && !v.solved) { const sv = E.P.ir.nodes.find(m => m.op === 'sketch.solve' && m.in.src === v.id); if (sv) s = await X.eval(sv.id); }
      const r = (s && s.report) || {};
      const rows = [['Solved', r.ok ? 'yes' : r.ok === false ? 'no' : '—'], ['Degrees of freedom', r.dof ? `${r.dof.dof} (${r.dof.status})` : '—'], ['Constraints', String((s && s.constraints || []).length)], ['Max residual', r.maxResidual !== undefined ? Number(r.maxResidual).toExponential(1) : '—']];
      if (r.rejected && r.rejected.length) rows.push(['Rejected', r.rejected.map(x => `#${x.index} ${x.kind}`).join(', ')]);
      if (r.error) rows.push(['Solver', r.error]);
      return { kind: 'stats', rows, src: 'CADCraft constraints · damped Gauss–Newton' };
    }
    if (kind === 'typography') {
      const st = (v && v.stats) || {};
      return { kind: 'stats', rows: [['Breaker', st.breaker || '—'], ['Lines', String(st.lines || 0)], ['Mean badness', String(st.avgBadness || 0)], ['Max stretch ratio', (st.maxRatio || 0).toFixed(2)], ['Widows', String(st.widows || 0)], ['Overset lines', String(st.overset || 0)]], src: 'Knuth–Plass total fit over font metrics' };
    }
    if (kind === 'preflight') {
      const img = await X.img(v), p = item.props || {}, tac = p.tac || 300; let maxTac = 0, over = 0;
      if (img.cmyk) for (let i = 0; i < img.w * img.h; i++) { const t = (img.cmyk[i * 4] + img.cmyk[i * 4 + 1] + img.cmyk[i * 4 + 2] + img.cmyk[i * 4 + 3]) * 100; if (t > maxTac) maxTac = t; if (t > tac) over++; }
      const ppi = Math.round((img.w / (img.u || 1)) / 8.27);
      return { kind: 'checks', rows: [[maxTac <= tac, `Total ink ≤ ${tac}%`, img.cmyk ? `max ${Math.round(maxTac)}%${over ? `, ${over} px over` : ''}` : 'not separated'], [ppi >= (p.minPpi || 300) * 0.25, `Resolution ≥ ${p.minPpi || 300} ppi`, `preview at ${img.w}×${img.h} px`], [true, `Bleed ${p.bleed || 3} mm`, 'recorded for export'], [!!img.cmyk, 'Colour model', img.cmyk ? 'CMYK (GCR)' : 'RGB']] };
    }
    if (kind === 'gamut') {
      const img = await asImg(), out = E.image(img.w, img.h);
      for (let i = 0; i < img.w * img.h; i++) { const r = img.d[i * 4], g = img.d[i * 4 + 1], b = img.d[i * 4 + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx - mn; const og = sat > 0.55 && mx > 0.5; const y = luma(r, g, b); out.d[i * 4] = og ? 0.9 : y * 0.6; out.d[i * 4 + 1] = og ? 0.1 : y * 0.6; out.d[i * 4 + 2] = og ? 0.6 : y * 0.6; out.d[i * 4 + 3] = 1; }
      return bitmap(out, 900, transfer, { scope: 'gamut' });
    }
    if (kind === 'diff') { const img = await asImg(); return bitmap(img, 900, transfer); }
    if (kind === 'graph' || kind === 'blocks') return { kind: kind };
    return E.present(v, Object.assign({}, item, { lens: null }), null, env, transfer);
  }
})(typeof self !== 'undefined' ? self : this);
