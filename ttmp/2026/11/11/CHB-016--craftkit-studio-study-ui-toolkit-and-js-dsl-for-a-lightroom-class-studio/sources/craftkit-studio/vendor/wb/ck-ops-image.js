/* ck-ops-image.js · image, mask, field and stack ops. Pixels go through PhotoCraft's own code compiled to wasm
 * (ck_photo: the 63 Filter-menu commands, the 47 Filter Gallery effects, Photoshop's adjustments, its 31 blend modes,
 * palette building and dithering, subject/sky/colour/wand selection, seam carving, content-aware fill). JS covers
 * glue: sources, noise, masks, fields, placement, the px-lambda interpreter. */
(function (root) {
  'use strict';
  const E = root.CK_ENGINE, def = E.def, is = E.is, hex = E.hex, clamp01 = E.clamp01, luma = E.luma;
  const PH = 'ck_photo';
  const F = () => root.CK_FILTERS || { commands: [], gallery: [] };

  // ── wasm helpers ─────────────────────────────────────────────────────
  async function photo(op, img, args, extra) {
    let data = img.d;
    if (extra) { data = new Float32Array(img.d.length + extra.length); data.set(img.d); data.set(extra, img.d.length); }
    return E.wasmCall(PH, op, Object.assign({ w: img.w, h: img.h }, args || {}), data);
  }
  const outImg = (r, img, w, h) => E.image(w || img.w, h || img.h, new Float32Array(r.out.buffer, 0, (w || img.w) * (h || img.h) * 4), { u: img.u });
  E.photo = photo;
  async function adjust(img, kind, params) { return outImg(await photo('adjust', img, { kind, params: params || {} }), img); }
  E.adjust = adjust;
  async function blend(back, top, mode, opacity, mask) {
    if (!top || (opacity !== undefined && opacity <= 0)) return back;
    const extra = mask ? new Float32Array(back.w * back.h * 5) : new Float32Array(back.w * back.h * 4);
    extra.set(top.d);
    if (mask) extra.set(mask.d, back.w * back.h * 4);
    const r = await photo('blend', back, { mode: mode || 'normal', opacity: opacity === undefined ? 1 : opacity }, extra);
    return outImg(r, back);
  }
  E.blend = blend;
  // param keys measured in pixels: scaled when the image is a preview of a larger canvas (u < 1)
  const PIXEL_KEYS = new Set(['radius', 'distance', 'cellSize', 'maxRadius', 'blur', 'horizontal', 'vertical', 'size', 'amplitudeMin', 'amplitudeMax', 'wavelengthMin', 'wavelengthMax']);
  function scaleParams(p, u) { if (!u || Math.abs(u - 1) < 1e-3) return p; const o = Object.assign({}, p); for (const k of Object.keys(o)) if (PIXEL_KEYS.has(k) && typeof o[k] === 'number') o[k] = o[k] * u; return o; }

  // ── filters by name: a Filter-menu command or a Filter Gallery effect ──
  const ALIAS = { oil: 'oilPaint', oilpaint: 'oilPaint', edges: 'findEdges', halftone: 'colorHalftone', pixelate: 'mosaic', gaussian: 'gaussianBlur', motion: 'motionBlur', radial: 'radialBlur', lens: 'lensBlur', surface: 'surfaceBlur', box: 'boxBlur', smart: 'smartBlur', shape: 'shapeBlur', tiltshift: 'tiltShift', iris: 'irisBlur', spin: 'spinBlur', field: 'fieldBlur', noise: 'addNoise', dust: 'dustAndScratches', unsharp: 'unsharpMask', polar: 'polarCoordinates', zigzag: 'zigZag', clouds: 'clouds', flare: 'lensFlare', lighting: 'lightingEffects', denoise: 'reduceNoise', sumie: 'sumiE', 'sumi-e': 'sumiE', chalk: 'chalkCharcoal', conte: 'conteCrayon', stained: 'stainedGlass', mosaictiles: 'mosaicTiles', neon: 'neonGlow', pencil: 'coloredPencil', pastel: 'roughPastels', glow: 'glowingEdges', posteredges: 'posterEdges' };
  E.findFilter = function (name) {
    const raw = String(name || '').trim(); if (!raw) return null;
    const low = raw.toLowerCase().replace(/[\s_-]/g, ''), a = ALIAS[low] || raw;
    const cmds = F().commands, gal = F().gallery;
    let c = cmds.find(x => x.id === raw) || cmds.find(x => x.id.split('.').pop().toLowerCase() === String(a).toLowerCase());
    if (c) return { kind: 'cmd', id: c.id, spec: c };
    const g = gal.find(x => x.key.toLowerCase() === String(a).toLowerCase() || x.name.toLowerCase().replace(/[\s&-]/g, '') === low);
    if (g) return { kind: 'gallery', key: g.key, spec: g };
    return null;
  };
  E.filterNames = () => F().commands.map(c => c.id.split('.').pop()).concat(F().gallery.map(g => g.key));
  function galleryEffect(g, p) {
    const doc = E.parseParamDoc(g.spec.params);
    const values = {}, eff = { filter: g.key, values };
    for (const [k, v] of Object.entries(p || {})) {
      if (k === 'foreground' || k === 'background' || k === 'glowColor' || k === 'color') { const c = hex(v); if (k === 'glowColor') eff.color = c; else eff[k] = c; continue; }
      const d = doc[k];
      if (d && d.enum) values[k] = Math.max(0, d.enum.indexOf(String(v)));
      else if (typeof v === 'boolean') values[k] = v ? 1 : 0;
      else if (typeof v === 'number') values[k] = v;
    }
    return eff;
  }
  async function applyFilter(img, name, params) {
    const f = E.findFilter(name);
    if (!f) { const s = root.CK && root.CK.suggest ? root.CK.suggest(String(name), E.filterNames()) : []; throw new Error(`no filter '${name}'${s.length ? `; did you mean ${s.map(x => `'${x}'`).join(' or ')}?` : ''} (PhotoCraft has ${F().commands.length} Filter-menu commands and ${F().gallery.length} Filter Gallery effects; docs("filters") lists them)`); }
    params = Object.assign({}, params || {}); delete params.name;
    for (const k of ['foreground', 'background']) if (typeof params[k] === 'string' && f.kind === 'cmd') params[k] = hex(params[k]);
    if (f.kind === 'cmd') {
      const sp = scaleParams(params, img.u), m = Math.min(96, Math.floor(Math.min(img.w, img.h) / 2), edgeMargin(f.id.split('.').pop(), sp));
      if (m > 0) {   // neighbourhood filters read outside the frame as black: pad with replicated edges, filter, crop back
        const pad = padEdges(img, m), r = outImg(await photo('cmd', pad, { id: f.id, params: sp }), pad);
        return cropPx(r, m, m, img.w, img.h, img);
      }
      return outImg(await photo('cmd', img, { id: f.id, params: sp }), img);
    }
    const effects = [galleryEffect(f, params)];
    return outImg(await photo('filter', img, { params: { filter: 'filterGallery', effects } }), img);
  }
  E.applyFilter = applyFilter;
  // how far a neighbourhood filter reaches, in pixels (0 = position-dependent or pointwise: never pad those)
  function edgeMargin(id, p) {
    const r = +(p.radius || 0), g = Math.ceil(3 * r) + 2;
    switch (id) {
      case 'gaussianBlur': case 'unsharpMask': case 'smartSharpen': case 'highPass': case 'smartBlur': return g;
      case 'boxBlur': case 'surfaceBlur': case 'lensBlur': case 'shapeBlur': case 'median': case 'dustAndScratches': case 'minimum': case 'maximum': return Math.ceil(r) + 2;
      case 'motionBlur': return Math.ceil(+(p.distance || 10)) + 2;
      case 'blur': case 'blurMore': case 'sharpen': case 'sharpenMore': case 'sharpenEdges': case 'despeckle': return 4;
      case 'reduceNoise': return 10;
      case 'emboss': case 'findEdges': case 'traceContour': return Math.ceil(+(p.height || 3)) + 2;
      default: return 0;
    }
  }
  function padEdges(img, m) {
    const W = img.w + 2 * m, H = img.h + 2 * m, d = new Float32Array(W * H * 4), s = img.d;
    for (let y = 0; y < H; y++) { const sy = Math.min(img.h - 1, Math.max(0, y - m)); for (let x = 0; x < W; x++) { const sx = Math.min(img.w - 1, Math.max(0, x - m)), i = (y * W + x) * 4, j = (sy * img.w + sx) * 4; d[i] = s[j]; d[i + 1] = s[j + 1]; d[i + 2] = s[j + 2]; d[i + 3] = s[j + 3]; } }
    return E.image(W, H, d, { u: img.u });
  }
  function cropPx(img, x0, y0, w, h, like) {
    const d = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++) d.set(img.d.subarray(((y + y0) * img.w + x0) * 4, ((y + y0) * img.w + x0 + w) * 4), y * w * 4);
    return E.image(w, h, d, { u: like ? like.u : img.u });
  }
  E.padEdges = padEdges; E.cropPx = cropPx;
  // resize with clamped edges: Catmull–Rom up, area average down (the wasm resizer reads black past the frame)
  E.resizeClamped = function (img, nw, nh) {
    const W = img.w, H = img.h, s = img.d, out = new Float32Array(nw * nh * 4), sx = W / nw, sy = H / nh;
    if (sx >= 1 && sy >= 1) {
      for (let y = 0; y < nh; y++) { const fy0 = y * sy, fy1 = (y + 1) * sy; for (let x = 0; x < nw; x++) { const fx0 = x * sx, fx1 = (x + 1) * sx; let a0 = 0, a1 = 0, a2 = 0, a3 = 0, wsum = 0;
        for (let yy = Math.floor(fy0); yy < Math.ceil(fy1); yy++) { const wy = Math.min(fy1, yy + 1) - Math.max(fy0, yy); if (wy <= 0) continue; const ry = Math.min(H - 1, yy) * W;
          for (let xx = Math.floor(fx0); xx < Math.ceil(fx1); xx++) { const wx = Math.min(fx1, xx + 1) - Math.max(fx0, xx); if (wx <= 0) continue; const w = wx * wy, j = (ry + Math.min(W - 1, xx)) * 4; a0 += s[j] * w; a1 += s[j + 1] * w; a2 += s[j + 2] * w; a3 += s[j + 3] * w; wsum += w; } }
        const i = (y * nw + x) * 4; out[i] = a0 / wsum; out[i + 1] = a1 / wsum; out[i + 2] = a2 / wsum; out[i + 3] = a3 / wsum; } }
    } else {
      const cr = t => { t = Math.abs(t); return t < 1 ? 1.5 * t * t * t - 2.5 * t * t + 1 : t < 2 ? -0.5 * t * t * t + 2.5 * t * t - 4 * t + 2 : 0; };
      for (let y = 0; y < nh; y++) { const fy = (y + 0.5) * sy - 0.5, iy = Math.floor(fy); const wy = [cr(fy - iy + 1), cr(fy - iy), cr(fy - iy - 1), cr(fy - iy - 2)], ry = [-1, 0, 1, 2].map(k => Math.min(H - 1, Math.max(0, iy + k)) * W);
        for (let x = 0; x < nw; x++) { const fx = (x + 0.5) * sx - 0.5, ix = Math.floor(fx); const wx = [cr(fx - ix + 1), cr(fx - ix), cr(fx - ix - 1), cr(fx - ix - 2)], cx = [-1, 0, 1, 2].map(k => Math.min(W - 1, Math.max(0, ix + k)));
          const i = (y * nw + x) * 4; for (let c = 0; c < 4; c++) { let v = 0; for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) v += s[(ry[a] + cx[b]) * 4 + c] * wy[a] * wx[b]; out[i + c] = v < 0 ? 0 : v > 1 ? 1 : v; } } }
    }
    return E.image(nw, nh, out, { u: img.u * nw / W });
  };
  // "{"radius":0.1..1000=1,"method":"spin|zoom","q":"a|b"="b","on":bool=true,"seed":u32=0,"bg":json}" → schema
  E.parseParamDoc = function (doc) {
    const out = {}; if (!doc || doc === '{}') return out;
    const body = doc.trim().replace(/^\{|\}$/g, '');
    const re = /"([A-Za-z0-9_]+)":((?:"[^"]*")|[^,"]+)(?:=("[^"]*"|[^,]+))?/g; let m;
    while ((m = re.exec(body))) {
      const k = m[1], t = m[2], d = m[3];
      if (t.startsWith('"')) { const opts = t.slice(1, -1).split('|'); out[k] = { type: 'string', enum: opts, default: d ? d.replace(/"/g, '') : opts[0] }; }
      else if (/^-?[\d.]+\.\.-?[\d.]+$/.test(t)) { const [lo, hi] = t.split('..').map(Number); out[k] = { type: 'number', min: lo, max: hi, default: d !== undefined ? Number(d) : lo }; }
      else if (t === 'bool') out[k] = { type: 'boolean', default: d === 'true' };
      else if (t === 'u32') out[k] = { type: 'number', min: 0, max: 99999, default: d !== undefined ? Number(d) : 0 };
      else if (t === 'px') out[k] = { type: 'number', min: -2000, max: 2000, default: d !== undefined ? Number(d) : 0 };
      else out[k] = { type: t };
    }
    return out;
  };

  // ── sample assets: CC0 / public-domain photos bundled with the workbench ──
  const ASSETS = {
    portrait: 'img/portrait.jpg', cat: 'img/cat.jpg', coffee: 'img/coffee.jpg', rocket: 'img/rocket.jpg', hubble: 'img/hubble.jpg',
    retina: 'img/retina.jpg', camera: 'img/camera.jpg', coins: 'img/coins.jpg', brick: 'img/brick.jpg', grass: 'img/grass.jpg', gravel: 'img/gravel.jpg', text: 'img/text.png',
  };
  E.ASSETS = ASSETS;
  const ASSET_WORDS = [
    [/portrait|face|person|astronaut|model|selfie|woman|man|headshot|people|trumpet|worker|dancer|subject/, 'portrait'],
    [/cat|pet|kitten|animal|fur|eye/, 'cat'], [/coffee|cup|still|food|product|espresso|table|kitchen|cafe|mug/, 'coffee'],
    [/rocket|launch|dusk|sky|night|city|street|range|lake|mountain|landscape|sunset|tower|scene|evening/, 'rocket'],
    [/space|galaxy|stars|hubble|cosmos|nebula|deep/, 'hubble'], [/retina|eye-?ball|medical|organic|circle|planet|orange|red/, 'retina'],
    [/camera|photographer|bw|black|mono|film|tripod|grey|gray/, 'camera'], [/coin|money|metal|museum/, 'coins'],
    [/brick|wall|texture|tile|pattern/, 'brick'], [/grass|lawn|field|green/, 'grass'], [/gravel|stone|rock|pebble|ground|sand/, 'gravel'],
    [/text|page|scan|zine|doc|hand|letter|note|math|paper|pdf/, 'text'],
  ];
  E.assetFor = function (name) {
    const n = String(name || '').toLowerCase();
    if (E.userAssets.has('*') && !/^(text|page|scan)/.test(n)) return { user: '*' };
    for (const [k, f] of E.userAssets) if (n === k.toLowerCase() || n.includes(k.toLowerCase().replace(/\.[a-z0-9]+$/, ''))) return { user: k };
    if (/upload|\[an uploaded file\]|drop/.test(n) && E.userAssets.size) return { user: [...E.userAssets.keys()].pop() };
    const base = n.replace(/\.[a-z0-9]+$/, '');
    if (ASSETS[base]) return { key: base };
    for (const [re, k] of ASSET_WORDS) if (re.test(n)) return { key: k };
    const keys = Object.keys(ASSETS).filter(k => k !== 'text');
    let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
    return { key: keys[h % keys.length] };
  };
  const ASSET_CACHE = new Map();
  E.clearAssets = () => ASSET_CACHE.clear();
  E.loadAsset = async function (name, maxSide) {
    const a = E.assetFor(name);
    const key = (a.user ? 'user:' + a.user : a.key) + '@' + (maxSide || E.MAX_SIDE);
    if (ASSET_CACHE.has(key)) return ASSET_CACHE.get(key);
    const p = (async () => {
      let blob;
      if (a.user) blob = E.userAssets.get(a.user);
      else { const r = await fetch(E.base + ASSETS[a.key]); if (!r.ok) throw new Error(`could not load the sample image ${ASSETS[a.key]}`); blob = await r.blob(); }
      const bmp = await createImageBitmap(blob);
      const [w, h] = E.fitSize(bmp.width, bmp.height, maxSide || E.MAX_SIDE);
      const c = E.canvas(w, h), g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, w, h);
      return E.fromCanvas(c, { u: w / bmp.width, src: a.user || a.key });
    })();
    ASSET_CACHE.set(key, p); p.catch(() => ASSET_CACHE.delete(key));
    return p;
  };
  E.assetNames = () => Object.keys(ASSETS).concat([...E.userAssets.keys()]);

  def('source.image', async (n, I, P) => E.loadAsset(P.src));
  const listOfAssets = async (count, seed) => { const keys = Object.keys(ASSETS).filter(k => k !== 'text'); const user = [...E.userAssets.keys()]; const pick = user.concat(keys); const items = []; for (let i = 0; i < count; i++) items.push(await E.loadAsset(pick[(i + (seed || 0)) % pick.length], 640)); return E.list(items); };
  def('source.images', async (n) => listOfAssets(Math.max(4, Math.min(12, n.count || 12))));
  def('source.folder', async (n) => listOfAssets(Math.max(4, Math.min(12, n.count || 12))));
  def('board.items', async (n) => listOfAssets(n.count || 5, 2));
  def('source.solid', async (n, I, P) => {
    const col = hex(P.color || '#ffffff');
    const make = (w, h, u) => { const o = E.image(w, h, null, { u: u || 1 }); for (let i = 0; i < w * h; i++) o.d.set(col, i * 4); return o; };
    if (Array.isArray(P.size) && P.size.length >= 2) { const [w, h, s] = E.fitSize(P.size[0], P.size[1]); return make(w, h, s); }
    return E.proc('image', (w, h) => make(w, h), { color: col });
  });
  function gradientAt(stops, t) {
    const S = stops.map((s, i) => (Array.isArray(s) && typeof s[0] === 'number' ? [s[0], hex(s[1])] : [i / Math.max(1, stops.length - 1), hex(s)]));
    if (t <= S[0][0]) return S[0][1]; if (t >= S[S.length - 1][0]) return S[S.length - 1][1];
    for (let i = 1; i < S.length; i++) if (t <= S[i][0]) { const a = S[i - 1], b = S[i], f = (t - a[0]) / ((b[0] - a[0]) || 1); return a[1].map((x, k) => x + (b[1][k] - x) * f); }
    return S[S.length - 1][1];
  }
  E.gradientAt = gradientAt;
  def('source.gradient', async (n, I, P) => {
    const stops = P.stops || ['#000', '#fff'], kind = P.kind || 'linear', ang = ((P.angle === undefined ? 90 : P.angle) * Math.PI) / 180;
    const make = (w, h, u) => {
      const o = E.image(w, h, null, { u: u || 1 }), ca = Math.cos(ang), sa = Math.sin(ang);
      const lut = []; for (let i = 0; i < 256; i++) lut.push(gradientAt(stops, i / 255));
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const u2 = x / (w - 1 || 1) - 0.5, v = y / (h - 1 || 1) - 0.5;
        let t = kind === 'radial' ? Math.hypot(u2, v) * 2 / Math.SQRT2 * 1.41 : kind === 'conic' || kind === 'angle' ? (Math.atan2(v, u2) / (2 * Math.PI) + 0.5) : (u2 * sa + v * -ca) * 0.999 + 0.5;
        if (kind === 'linear') t = (u2 * Math.sin(ang) + v * Math.cos(ang) * -1) + 0.5;
        o.d.set(lut[Math.max(0, Math.min(255, Math.round(clamp01(t) * 255)))], (y * w + x) * 4);
      }
      return o;
    };
    if (Array.isArray(P.size)) { const [w, h, s] = E.fitSize(P.size[0], P.size[1]); return make(w, h, s); }
    return E.proc('image', (w, h) => make(w, h));
  });

  // ── noise (fields): simplex, perlin, value, worley, fbm, grain ─────────
  const PERM = new Uint8Array(512); (function () { const p = []; for (let i = 0; i < 256; i++) p.push(i); let s = 1337; for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]; })();
  const G2 = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
  function simplex(x, y, seed) {
    const F2 = 0.5 * (Math.sqrt(3) - 1), G = (3 - Math.sqrt(3)) / 6; const so = (seed | 0) & 255;
    const s = (x + y) * F2, i = Math.floor(x + s), j = Math.floor(y + s), t = (i + j) * G;
    const x0 = x - (i - t), y0 = y - (j - t), i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G, y1 = y0 - j1 + G, x2 = x0 - 1 + 2 * G, y2 = y0 - 1 + 2 * G;
    const ii = (i + so) & 255, jj = j & 255;
    let n = 0;
    const c = (gx, gy, xx, yy) => { let tt = 0.5 - xx * xx - yy * yy; if (tt < 0) return 0; tt *= tt; const g = G2[PERM[gx + PERM[gy]] & 7]; return tt * tt * (g[0] * xx + g[1] * yy); };
    n += c(ii, jj, x0, y0); n += c(ii + i1, jj + j1, x1, y1); n += c(ii + 1, jj + 1, x2, y2);
    return 70 * n;   // -1..1
  }
  function hash2(x, y, s) { let h = (x * 374761393 + y * 668265263 + (s | 0) * 1442695041) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  E.hash2 = hash2;
  function valueNoise(x, y, s) { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy); const a = hash2(i, j, s), b = hash2(i + 1, j, s), c = hash2(i, j + 1, s), d = hash2(i + 1, j + 1, s); return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1; }
  function worley(x, y, s) { const i = Math.floor(x), j = Math.floor(y); let d1 = 9, d2 = 9; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const px = i + a + hash2(i + a, j + b, s), py = j + b + hash2(i + a, j + b, s + 7); const d = Math.hypot(px - x, py - y); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; } return [d1, d2]; }
  E.noise2 = (kind, x, y, seed) => kind === 'value' ? valueNoise(x, y, seed) : simplex(x, y, seed);
  E.worley = worley;
  function noiseField(P, w, h) {
    const kind = P.kind || 'simplex', scale = P.scale === undefined ? (kind === 'worley' ? 12 : 4) : P.scale, seed = P.seed || 0, oct = P.octaves || (kind === 'fbm' || kind === 'clouds' ? 5 : 1);
    const f = E.field(w, h, 1, null, ['n']), d = f.d, S = Math.max(w, h), k = scale / S;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v;
      if (kind === 'grain' || kind === 'white') { const g = Math.max(1, P.size || P.scale || 1); v = hash2(Math.floor(x / g), Math.floor(y / g), seed); }
      else if (kind === 'worley' || kind === 'cells' || kind === 'voronoi') { const [a, b] = worley(x * k, y * k, seed); v = P.mode === 'edges' ? clamp01((b - a) * 2) : clamp01(1 - a); }
      else if (kind === 'ridged') { let a = 0, amp = 0.5, fr = 1; for (let o = 0; o < oct + 2; o++) { a += amp * (1 - Math.abs(simplex(x * k * fr, y * k * fr, seed + o))); amp *= 0.5; fr *= 2; } v = clamp01(a * a); }
      else if (kind === 'turbulence') { let a = 0, amp = 0.5, fr = 1; for (let o = 0; o < oct + 3; o++) { a += amp * Math.abs(simplex(x * k * fr, y * k * fr, seed + o)); amp *= 0.5; fr *= 2; } v = clamp01(a * 1.4); }
      else { const fn = kind === 'value' ? valueNoise : simplex; let a = 0, amp = 0.5, fr = 1, norm = 0; for (let o = 0; o < oct; o++) { a += amp * fn(x * k * fr, y * k * fr, seed + o * 31); norm += amp; amp *= 0.5; fr *= 2; } v = (a / norm) * 0.5 + 0.5; }
      d[y * w + x] = v;
    }
    return f;
  }
  def('source.noise', async (n, I, P) => {
    if (Array.isArray(P.size)) { const [w, h, s] = E.fitSize(P.size[0], P.size[1], 768); const f = noiseField(P, w, h); f.u = s; return f; }
    return E.proc('field', (w, h) => noiseField(P, Math.min(w, 1024), Math.min(h, 1024)), { noise: P });
  });

  // ── image helpers in JS ────────────────────────────────────────────────
  function mapPx(img, f) { const o = E.image(img.w, img.h, null, { u: img.u }); const d = img.d, od = o.d; const c = [0, 0, 0, 0]; for (let i = 0; i < img.w * img.h; i++) { c[0] = d[i * 4]; c[1] = d[i * 4 + 1]; c[2] = d[i * 4 + 2]; c[3] = d[i * 4 + 3]; const r = f(c, i); od[i * 4] = r[0]; od[i * 4 + 1] = r[1]; od[i * 4 + 2] = r[2]; od[i * 4 + 3] = r[3]; } return o; }
  E.mapPx = mapPx;
  function blur1(src, w, h, r) {   // three box passes ≈ Gaussian, on one channel
    if (r <= 0.3) return Float32Array.from(src);
    let a = Float32Array.from(src), b = new Float32Array(src.length);
    const boxes = (() => { const n = 3, wIdeal = Math.sqrt((12 * r * r / n) + 1); let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--; const wu = wl + 2, m = Math.round((12 * r * r - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4)); return [0, 1, 2].map(i => ((i < m ? wl : wu) - 1) / 2); })();
    const pass = (s, t, rr, horiz) => {
      rr = Math.max(0, Math.round(rr)); const iarr = 1 / (rr + rr + 1);
      const L = horiz ? w : h, N = horiz ? h : w;
      for (let k = 0; k < N; k++) {
        const at = i => (horiz ? k * w + Math.max(0, Math.min(w - 1, i)) : Math.max(0, Math.min(h - 1, i)) * w + k);
        let acc = 0; for (let i = -rr; i <= rr; i++) acc += s[at(i)];
        for (let i = 0; i < L; i++) { t[horiz ? k * w + i : i * w + k] = acc * iarr; acc += s[at(i + rr + 1)] - s[at(i - rr)]; }
      }
    };
    for (const br of boxes) { pass(a, b, br, true); pass(b, a, br, false); }
    return a;
  }
  E.blur1 = blur1;

  // ── adjustments (pointwise; PhotoCraft's compose::adjust) ──────────────
  const lv = v => (Array.isArray(v) ? v : null);
  const to255 = v => (v <= 1.0001 ? v * 255 : v);
  function curvePts(c) {
    if (!c) return null;
    if (c.$curve === 'sCurve' || (c.contrast !== undefined && !Array.isArray(c))) { const k = typeof c.contrast === 'number' ? c.contrast : 1; c = [[0, 0], [0.25, 0.25 / Math.max(0.2, k)], [0.75, 1 - 0.25 / Math.max(0.2, k)], [1, 1]]; }
    if (!Array.isArray(c) || c.length < 2) return null;
    return c.map(p => [Math.round(to255(+p[0]) * 100) / 100, Math.round(to255(+p[1]) * 100) / 100]).sort((a, b) => a[0] - b[0]).filter((p, i, a) => !i || p[0] - a[i - 1][0] > 0.5);
  }
  E.curvePts = curvePts;
  function autoLevels(img, strength) {
    const n = img.w * img.h, lo = [0, 0, 0], hi = [1, 1, 1];
    for (let c = 0; c < 3; c++) { const hist = new Uint32Array(256); for (let i = 0; i < n; i++) hist[Math.max(0, Math.min(255, Math.round(img.d[i * 4 + c] * 255)))]++; const cut = n * 0.001; let a = 0, s = 0; while (a < 255 && s + hist[a] <= cut) s += hist[a++]; let b = 255; s = 0; while (b > 0 && s + hist[b] <= cut) s += hist[b--]; lo[c] = a / 255; hi[c] = Math.max(lo[c] + 0.02, b / 255); }
    const st = strength === undefined ? 1 : strength;
    return mapPx(img, c => [0, 1, 2].map(k => { const v = clamp01((c[k] - lo[k]) / (hi[k] - lo[k])); return c[k] + (v - c[k]) * st; }).concat([c[3]]));
  }
  def(['image.autoTone', 'clip.autoTone'], async (n, I, P, X) => autoLevels(await X.img(I.src), P.strength));
  def(['image.levels', 'clip.levels'], async (n, I, P, X) => {
    const img = await X.img(I.src), i = lv(P.in) || [0, 1], o = lv(P.out) || [0, 1];
    return adjust(img, 'levels', { inBlack: to255(i[0]), inWhite: to255(i[1]), gamma: P.gamma || 1, outBlack: to255(o[0]), outWhite: to255(o[1]) });
  });
  def(['image.curves', 'clip.curves'], async (n, I, P, X) => {
    const img = await X.img(I.src), p = {};
    const m = curvePts(P.rgb || P.points || P.master); if (m) p.points = m;
    for (const [k, key] of [['r', 'red'], ['g', 'green'], ['b', 'blue']]) { const c = curvePts(P[k] || P[key]); if (c) p[key] = c; }
    if (!Object.keys(p).length) return img;
    return adjust(img, 'curves', p);
  });
  def(['image.hsl', 'clip.hsl'], async (n, I, P, X) => adjust(await X.img(I.src), 'hueSaturation', { hue: +(P.hue || 0), saturation: +(P.sat !== undefined ? P.sat : P.saturation || 0), lightness: +(P.light !== undefined ? P.light : P.lightness || 0), colorize: !!P.colorize }));
  def(['image.vibrance', 'clip.vibrance'], async (n, I, P, X) => adjust(await X.img(I.src), 'vibrance', { vibrance: +(P.amount !== undefined ? P.amount : P.vibrance || 0), saturation: +(P.saturation || 0) }));
  function stopsOf(s) {
    if (!s) return [[0, '#000000'], [1, '#ffffff']];
    if (s.stops) s = s.stops;
    if (!Array.isArray(s)) return [[0, '#000000'], [1, '#ffffff']];
    return s.map((x, i) => (Array.isArray(x) && typeof x[0] === 'number' && x.length === 2 && typeof x[1] !== 'number' ? [x[0], E.toHex(hex(x[1]))] : [i / Math.max(1, s.length - 1), E.toHex(hex(x))]));
  }
  E.stopsOf = stopsOf;
  def(['image.gradientMap', 'clip.gradientMap'], async (n, I, P, X) => {
    let stops = P.stops;
    if (I.stops) { const v = await I.stops; const cols = v && (v.colors || (v.palette && v.palette.colors)); if (cols && cols.length) { stops = cols.map(c => (typeof c === 'string' ? c : c.hex || c.color || E.toHex(hex(c)))).map(h => [h, luma(...hex(h))]).sort((a, b) => a[1] - b[1]).map(x => x[0]); X.note(`gradient map from a ${stops.length}-colour palette, dark to light`); } }
    return adjust(await X.img(I.src), 'gradientMap', { stops: stopsOf(stops), reverse: !!P.reverse });
  });
  def(['image.duotone'], async (n, I, P, X) => adjust(await X.img(I.src), 'gradientMap', { stops: stopsOf([P.dark || P.a || '#1f2a6b', P.light || P.b || '#e2437f']) }));
  def(['image.exposure', 'clip.exposure'], async (n, I, P, X) => adjust(await X.img(I.src), 'exposure', { exposure: +(P.exposure !== undefined ? P.exposure : P.ev || 0), offset: +(P.offset || 0), gamma: +(P.gamma || 1) }));
  def(['image.brightnessContrast', 'image.brightness'], async (n, I, P, X) => adjust(await X.img(I.src), 'brightnessContrast', { brightness: +(P.brightness || 0), contrast: +(P.contrast || 0) }));
  def(['image.posterize'], async (n, I, P, X) => adjust(await X.img(I.src), 'posterize', { levels: Math.max(2, Math.round(P.levels || 4)) }));
  def(['image.threshold'], async (n, I, P, X) => adjust(await X.img(I.src), 'threshold', { level: to255(P.level === undefined ? 0.5 : P.level) }));
  def(['image.invert', 'clip.invert'], async (n, I, P, X) => adjust(await X.img(I.src), 'invert', {}));
  def(['image.blackWhite', 'image.bw'], async (n, I, P, X) => { const p = Object.assign({}, P); if (P.tint) { p.tint = true; if (typeof P.tint === 'string') p.tintColor = P.tint; } return adjust(await X.img(I.src), 'blackWhite', p); });
  def(['image.photoFilter'], async (n, I, P, X) => adjust(await X.img(I.src), 'photoFilter', Object.assign({}, P, typeof P.color === 'string' && !/^#/.test(P.color) ? { filter: P.color, color: undefined } : {}, { density: P.density === undefined ? 25 : P.density <= 1 ? P.density * 100 : P.density })));
  def(['image.channelMixer'], async (n, I, P, X) => adjust(await X.img(I.src), 'channelMixer', P));
  def(['image.colorBalance'], async (n, I, P, X) => adjust(await X.img(I.src), 'colorBalance', P));
  def(['image.adjust'], async (n, I, P, X) => adjust(await X.img(I.src), P.kind, P.params || Object.fromEntries(Object.entries(P).filter(([k]) => k !== 'kind'))));
  // Lumetri-style grade: lift / gamma / gain wheels ([x, y, luma] each), an optional curve, saturation, exposure
  async function grade(img, P) {
    const wheel = (w, k) => { if (!Array.isArray(w)) return [0, 0, 0]; const x = +w[0] || 0, y = +w[1] || 0, l = +w[2] || 0; const hue = Math.atan2(y, x), r = Math.min(1, Math.hypot(x, y)); const col = [Math.cos(hue), Math.cos(hue - 2.094), Math.cos(hue + 2.094)].map(c => c * r * k + l * 0.5); return col; };
    const L = wheel(P.lift, 0.12), G = wheel(P.gamma, 0.3), N = wheel(P.gain, 0.3), ex = Math.pow(2, +(P.exposure || 0)), sat = P.saturation === undefined ? 1 : +P.saturation;
    let out = mapPx(img, c => {
      const o = [0, 0, 0];
      for (let k = 0; k < 3; k++) { let v = c[k] * ex; v = v * (1 + N[k]) + L[k] * (1 - v); v = Math.pow(Math.max(0, v), 1 / Math.max(0.1, 1 + G[k])); o[k] = v; }
      const y = luma(o[0], o[1], o[2]);
      return [clamp01(y + (o[0] - y) * sat), clamp01(y + (o[1] - y) * sat), clamp01(y + (o[2] - y) * sat), c[3]];
    });
    const cv = curvePts(P.curve);
    if (cv && cv.length > 2) out = await adjust(out, 'curves', { points: cv });
    return out;
  }
  E.grade = grade;
  def(['image.grade', 'clip.grade'], async (n, I, P, X) => grade(await X.img(I.src), P));
  // looks for .lut('name'): procedural 3D looks (no .cube files ship with the workbench)
  const LOOKS = {
    nocturne: c => { const y = luma(c[0], c[1], c[2]); return [clamp01(y * 0.8 + c[0] * 0.15 + (y > 0.5 ? 0.06 : -0.02)), clamp01(y * 0.85 + c[1] * 0.12 + 0.01), clamp01(y * 0.7 + c[2] * 0.3 + (y < 0.5 ? 0.08 : 0)), c[3]]; },
    tealorange: c => { const y = luma(c[0], c[1], c[2]); return [clamp01(c[0] + (y - 0.45) * 0.25), clamp01(c[1] + 0.02), clamp01(c[2] - (y - 0.45) * 0.3), c[3]]; },
    bleach: c => { const y = luma(c[0], c[1], c[2]); const m = 0.55; return [0, 1, 2].map(k => clamp01((c[k] * (1 - m) + y * m) * 1.08 - 0.03)).concat([c[3]]); },
    kodak: c => [clamp01(c[0] * 1.06 + 0.02), clamp01(c[1] * 1.0 + 0.01), clamp01(c[2] * 0.88 + 0.03), c[3]],
    mono: c => { const y = luma(c[0], c[1], c[2]); return [y, y, y, c[3]]; },
    cyanotype: c => { const y = luma(c[0], c[1], c[2]); return [clamp01(0.04 + y * 0.75), clamp01(0.18 + y * 0.72), clamp01(0.36 + y * 0.64), c[3]]; },
    sepia: c => { const y = luma(c[0], c[1], c[2]); return [clamp01(y * 1.07 + 0.08), clamp01(y * 0.94 + 0.04), clamp01(y * 0.74), c[3]]; },
  };
  E.LOOKS = LOOKS;
  // a 3D LUT as a value: { size, table } with table laid out like the bake lattice (r fastest, then b blocks across, g down)
  function parseCube(text) {
    const lines = String(text).split(/\r?\n/); let size = 0; const vals = [];
    for (const l of lines) { const t = l.trim(); if (!t || t[0] === '#') continue; const m = t.match(/^LUT_3D_SIZE\s+(\d+)/); if (m) { size = +m[1]; continue; } if (/^[A-Z_]/.test(t)) continue; const p = t.split(/\s+/).map(Number); if (p.length >= 3 && p.every(x => !isNaN(x))) vals.push(p[0], p[1], p[2]); }
    if (!size || vals.length < size * size * size * 3) return null;
    const table = new Float32Array(size * size * size * 4); let k = 0;
    for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) { const i = (g * size * size + b * size + r) * 4; table[i] = vals[k++]; table[i + 1] = vals[k++]; table[i + 2] = vals[k++]; table[i + 3] = 1; }
    return { size, table };
  }
  E.parseCube = parseCube;
  function applyLut(img, L, amount) {
    const S = L.size, T = L.table, a = amount === undefined ? 1 : +amount;
    return mapPx(img, c => {
      const f = [0, 1, 2].map(k => Math.min(S - 1, Math.max(0, c[k] * (S - 1)))), i0 = f.map(Math.floor), i1 = i0.map(x => Math.min(S - 1, x + 1)), t = f.map((x, k) => x - i0[k]);
      const at = (r, g, b, ch) => T[(g * S * S + b * S + r) * 4 + ch], o = [0, 0, 0];
      for (let ch = 0; ch < 3; ch++) {
        const c00 = at(i0[0], i0[1], i0[2], ch) * (1 - t[0]) + at(i1[0], i0[1], i0[2], ch) * t[0], c10 = at(i0[0], i1[1], i0[2], ch) * (1 - t[0]) + at(i1[0], i1[1], i0[2], ch) * t[0];
        const c01 = at(i0[0], i0[1], i1[2], ch) * (1 - t[0]) + at(i1[0], i0[1], i1[2], ch) * t[0], c11 = at(i0[0], i1[1], i1[2], ch) * (1 - t[0]) + at(i1[0], i1[1], i1[2], ch) * t[0];
        const v = (c00 * (1 - t[1]) + c10 * t[1]) * (1 - t[2]) + (c01 * (1 - t[1]) + c11 * t[1]) * t[2];
        o[ch] = clamp01(c[ch] + (v - c[ch]) * a);
      }
      return [o[0], o[1], o[2], c[3]];
    });
  }
  E.applyLut = applyLut;
  def(['image.lut', 'clip.lut', '*.lut'], async (n, I, P, X) => {
    if (I.lut) { const v = await I.lut; if (v && v.table && v.size) { X.note(`applied a baked ${v.size}³ LUT`); return applyLut(await X.img(I.src), v, P.amount); } if (v && v.text) { const L = parseCube(v.text); if (L) return applyLut(await X.img(I.src), L, P.amount); } throw new Error('.lut(x): x must be a LUT value from .toLut(), .cube text, or a look name'); }
    if (typeof P.lut === 'string' && /LUT_3D_SIZE/.test(P.lut)) { const L = parseCube(P.lut); if (L) return applyLut(await X.img(I.src), L, P.amount); }
    const img = await X.img(I.src); const name = String(P.lut || P.name || 'nocturne').toLowerCase().replace(/\.(cube|3dl)$/, '').replace(/[^a-z]/g, '');
    const f = LOOKS[name] || LOOKS[Object.keys(LOOKS).find(k => name.includes(k))] || LOOKS.nocturne;
    if (!LOOKS[name]) X.note(`no .cube files ship with the workbench; '${P.lut}' uses the built-in look '${Object.keys(LOOKS).find(k => LOOKS[k] === f)}'`);
    return mapPx(img, f);
  });

  // ── filters (PhotoCraft's Filter menu and Filter Gallery) ──────────────
  def(['image.blur', 'clip.blur', 'mask.blurImage'], async (n, I, P, X) => {
    const img = await X.img(I.src); const kind = P.kind || 'gaussian', r = P.radius === undefined ? 4 : +P.radius;
    if (r <= 0 && kind === 'gaussian') return img;
    const map = { gaussian: ['gaussianBlur', { radius: Math.max(0.1, r) }], box: ['boxBlur', { radius: Math.max(1, r) }], motion: ['motionBlur', { angle: P.angle || 0, distance: Math.max(1, P.distance || r * 3) }], radial: ['radialBlur', { amount: Math.max(1, Math.min(100, P.amount || r)), method: P.method || 'zoom' }], lens: ['lensBlur', { radius: Math.min(100, r) }], surface: ['surfaceBlur', { radius: Math.max(1, Math.min(100, r)), threshold: P.threshold || 15 }], smart: ['smartBlur', { radius: Math.max(0.1, Math.min(100, r)), threshold: P.threshold || 25 }], tiltShift: ['tiltShift', Object.assign({ blur: r * 3 }, P)], iris: ['irisBlur', Object.assign({ blur: r * 3 }, P)], spin: ['spinBlur', Object.assign({ blurAngle: r * 4 }, P)], shape: ['shapeBlur', { radius: Math.max(5, r), shape: P.shape || 'circle' }] };
    const [name, prm] = map[kind] || map.gaussian;
    delete prm.kind;
    if (['tiltShift', 'irisBlur', 'spinBlur'].includes(name)) delete prm.radius;
    return applyFilter(img, name, prm);
  });
  def(['image.sharpen', 'clip.sharpen'], async (n, I, P, X) => applyFilter(await X.img(I.src), P.smart ? 'smartSharpen' : 'unsharpMask', { amount: P.amount === undefined ? 80 : P.amount, radius: P.radius === undefined ? 1 : P.radius, threshold: P.threshold || 0 }));
  def(['image.denoise', 'clip.denoise'], async (n, I, P, X) => applyFilter(await X.img(I.src), 'reduceNoise', { strength: (P.strength === undefined ? 0.5 : P.strength <= 1 ? P.strength * 10 : P.strength), preserveDetails: (P.detail === undefined ? 60 : P.detail <= 1 ? P.detail * 100 : P.detail), reduceColorNoise: 45, sharpenDetails: 20 }));
  def(['image.stylize', 'image.distort', 'image.filter', 'clip.stylize', 'clip.filter', 'image.render', 'image.pixelate.fx'], async (n, I, P, X) => { const p = Object.assign({}, P); const name = p.name || p.id; delete p.name; delete p.id; return applyFilter(await X.img(I.src), name, p); });
  def(['image.gallery', 'clip.gallery'], async (n, I, P, X) => {
    const img = await X.img(I.src);
    const list = Array.isArray(P.effects) ? P.effects : [Object.assign({ name: P.name }, P)];
    const effects = list.map(e => { const f = E.findFilter(e.name || e.filter); if (!f || f.kind !== 'gallery') throw new Error(`'${e.name || e.filter}' is not a Filter Gallery effect; the gallery has ${F().gallery.map(g => g.key).join(', ')}`); const p = Object.assign({}, e); delete p.name; delete p.filter; return galleryEffect(f, p); });
    return outImg(await photo('filter', img, { params: { filter: 'filterGallery', effects } }), img);
  });
  // sugar for common filters
  const SUGAR = { pixelate: ['mosaic', 'cellSize'], halftone: ['colorHalftone', 'maxRadius'], crystallize: ['crystallize', 'cellSize'], pointillize: ['pointillize', 'cellSize'], emboss: ['emboss', 'height'], findEdges: ['findEdges', null], solarize: ['solarize', null], twirl: ['twirl', 'angle'], pinch: ['pinch', 'amount'], spherize: ['spherize', 'amount'], ripple: ['ripple', 'amount'], wave: ['wave', 'generators'], wind: ['wind', 'method'], median: ['median', 'radius'], highPass: ['highPass', 'radius'], addNoise: ['addNoise', 'amount'], mezzotint: ['mezzotint', 'type'], facet: ['facet', null], fragment: ['fragment', null], diffuse: ['diffuse', 'mode'], extrude: ['extrude', 'size'], tiles: ['tiles', 'count'], polar: ['polarCoordinates', 'mode'], zigzag: ['zigZag', 'amount'], oilPaint: ['oilPaint', 'stylization'], clouds: ['clouds', 'seed'], lensFlare: ['lensFlare', 'brightness'], lighting: ['lightingEffects', 'intensity'], dustAndScratches: ['dustAndScratches', 'radius'], minimum: ['minimum', 'radius'], maximum: ['maximum', 'radius'], ntsc: ['ntscColors', null], tiltShift: ['tiltShift', 'blur'] };
  for (const [k, [name, key]] of Object.entries(SUGAR)) def(['image.' + k, 'clip.' + k], async (n, I, P, X) => { const p = Object.assign({}, P); if (key && p.value !== undefined) { p[key] = p.value; delete p.value; } if (key && p.arg0 !== undefined) { p[key] = p.arg0; delete p.arg0; } return applyFilter(await X.img(I.src), name, p); });
  def(['image.noise'], async (n, I, P, X) => applyFilter(await X.img(I.src), 'addNoise', { amount: P.amount === undefined ? 12 : P.amount <= 1 ? P.amount * 100 : P.amount, distribution: P.distribution || 'gaussian', monochromatic: P.mono !== false, seed: P.seed || 0 }));
  def(['image.grain', 'clip.grain'], async (n, I, P, X) => {
    const img = await X.img(I.src), a = P.amount === undefined ? 0.3 : +P.amount, s = Math.max(0.5, P.size || 1), seed = Math.floor((P.seed || 0) + (X.time || 0) * 24);
    return mapPx(img, (c, i) => { const x = i % img.w, y = (i / img.w) | 0; const g = (E.hash2(Math.floor(x / s), Math.floor(y / s), seed) + E.hash2(Math.floor(x / s) + 7, Math.floor(y / s) + 3, seed + 1) - 1) * a * 0.5; const k = 1 - 2 * Math.abs(luma(c[0], c[1], c[2]) - 0.5) * 0.6; return [clamp01(c[0] + g * k), clamp01(c[1] + g * k), clamp01(c[2] + g * k), c[3]]; });
  });
  def(['image.vignette', 'clip.vignette'], async (n, I, P, X) => { const img = await X.img(I.src), a = P.amount === undefined ? 0.5 : +P.amount, r = P.radius || 0.75, soft = P.softness || 0.5; return mapPx(img, (c, i) => { const x = (i % img.w) / img.w - 0.5, y = ((i / img.w) | 0) / img.h - 0.5; const d = Math.hypot(x, y) / 0.7071; const v = 1 - a * Math.min(1, Math.max(0, (d - r * (1 - soft)) / (soft || 1e-3))) ** 1.5; return [c[0] * v, c[1] * v, c[2] * v, c[3]]; }); });
  def(['image.chromatic', 'image.rgbSplit'], async (n, I, P, X) => {
    const img = await X.img(I.src), a = (P.amount === undefined ? 4 : +P.amount) * (img.u || 1), o = E.image(img.w, img.h, null, { u: img.u }), W = img.w, H = img.h;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; const dx = (x / W - 0.5), dy = (y / H - 0.5); const sx = k => Math.max(0, Math.min(W - 1, Math.round(x + dx * a * k * 2))), sy = k => Math.max(0, Math.min(H - 1, Math.round(y + dy * a * k * 2))); o.d[i] = img.d[(sy(1) * W + sx(1)) * 4]; o.d[i + 1] = img.d[i + 1]; o.d[i + 2] = img.d[(sy(-1) * W + sx(-1)) * 4 + 2]; o.d[i + 3] = img.d[i + 3]; }
    return o;
  });
  def(['image.displace', 'clip.displace'], async (n, I, P, X) => {
    const img = await X.img(I.src), by = I.by || P.by;
    if (!by) return img;
    const f = await X.need(by, 'field', img.w, img.h), amt = (P.amount === undefined ? 10 : +P.amount) * (img.u || 1);
    const o = E.image(img.w, img.h, null, { u: img.u }), W = img.w, H = img.h, ch = f.ch, fd = f.d;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = y * W + x; let dx, dy;
      if (ch >= 2) { dx = (fd[k * ch] - 0.5) * 2; dy = (fd[k * ch + 1] - 0.5) * 2; }
      else { const v = fd[k], vx = fd[y * W + Math.min(W - 1, x + 1)] - fd[y * W + Math.max(0, x - 1)], vy = fd[Math.min(H - 1, y + 1) * W + x] - fd[Math.max(0, y - 1) * W + x]; dx = (v - 0.5) * 2 + vx * 4; dy = (v - 0.5) * 2 + vy * 4; }
      const sx = x + dx * amt, sy = y + dy * amt;
      const x0 = Math.max(0, Math.min(W - 1, Math.floor(sx))), y0 = Math.max(0, Math.min(H - 1, Math.floor(sy))), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), tx = sx - Math.floor(sx), ty = sy - Math.floor(sy);
      for (let c = 0; c < 4; c++) { const a = img.d[(y0 * W + x0) * 4 + c], b = img.d[(y0 * W + x1) * 4 + c], cc = img.d[(y1 * W + x0) * 4 + c], dd = img.d[(y1 * W + x1) * 4 + c]; o.d[k * 4 + c] = (a + (b - a) * tx) * (1 - ty) + (cc + (dd - cc) * tx) * ty; }
    }
    return o;
  });

  // ── palettes, quantize, separations ────────────────────────────────────
  const srgb2lin = v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  function oklab(r, g, b) { r = srgb2lin(r); g = srgb2lin(g); b = srgb2lin(b); const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b); return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]; }
  E.oklab = oklab;
  const NAMES = [['ink', 0.0, 0.25], ['shadow', 0.25, 0.4], ['muted', 0.4, 0.6], ['accent', 0.4, 0.75], ['paper', 0.8, 1.01]];
  function nameColor(rgb) {
    const [r, g, b] = rgb.map(x => x / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, s = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
    let h = 0; if (mx !== mn) { if (mx === r) h = ((g - b) / (mx - mn) + 6) % 6; else if (mx === g) h = (b - r) / (mx - mn) + 2; else h = (r - g) / (mx - mn) + 4; h *= 60; }
    if (s < 0.12) return l < 0.2 ? 'ink' : l > 0.85 ? 'paper' : l < 0.5 ? 'graphite' : 'stone';
    const hn = h < 15 ? 'red' : h < 40 ? 'orange' : h < 65 ? 'yellow' : h < 160 ? 'green' : h < 200 ? 'teal' : h < 255 ? 'blue' : h < 290 ? 'violet' : h < 335 ? 'magenta' : 'red';
    return (l < 0.3 ? 'deep ' : l > 0.72 ? 'pale ' : '') + hn;
  }
  E.nameColor = nameColor;
  E.mkPalette = (cols, o) => E.palette(cols.map(c => { const rgb = (c.rgb || c).slice(0, 3).map(x => (x <= 1 && !(c.rgb && c.rgb.some(v => v > 1)) ? Math.round(x * 255) : Math.round(x))); return { rgb, hex: E.toHex(rgb.map(v => v / 255)), weight: c.weight !== undefined ? c.weight : c.count || 1, name: c.name || nameColor(rgb) }; }), o);
  def(['image.palette', 'clip.palette'], async (n, I, P, X) => {
    let img = await X.img(I.src);
    if (img.w * img.h > 200000) img = E.resample(img, Math.round(img.w / 2), Math.round(img.h / 2));
    const kind = P.method === 'kmeans' || P.method === 'perceptual' || !P.method ? 'perceptual' : P.method === 'median-cut' ? 'adaptive' : P.method;
    const r = await photo('palette', img, { kind, colors: Math.max(2, Math.min(32, Math.round(P.n || 6))) });
    const tot = r.msg.palette.reduce((a, c) => a + c.count, 0) || 1;
    const cols = r.msg.palette.filter(c => c.count > 0).sort((a, b) => b.count - a.count).map(c => ({ rgb: c.rgb, weight: c.count / tot }));
    const p = E.mkPalette(cols, { weighted: !!P.weights });
    if (Array.isArray(P.names)) p.colors.forEach((c, i) => { if (P.names[i]) c.name = P.names[i]; });
    return p;
  });
  def(['image.quantize', 'clip.quantize'], async (n, I, P, X) => {
    const img = await X.img(I.src); const dither = { none: 'none', floyd: 'diffusion', 'floyd-steinberg': 'diffusion', diffusion: 'diffusion', ordered: 'pattern', bayer: 'pattern', pattern: 'pattern', noise: 'noise' }[P.dither || 'none'] || 'none';
    const r = await photo('quantize', img, { kind: P.palette || 'perceptual', colors: Math.max(2, Math.min(256, Math.round(P.colors || 16))), dither, amount: P.amount === undefined ? 1 : P.amount });
    return outImg(r, img);
  });
  function nearestMap(img, pal, dither) {
    const P2 = pal.colors.map(c => ({ c: c.rgb.map(v => v / 255), l: oklab(c.rgb[0] / 255, c.rgb[1] / 255, c.rgb[2] / 255) }));
    const W = img.w, H = img.h, buf = dither ? Float32Array.from(img.d) : img.d, o = E.image(W, H, null, { u: img.u });
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, r = clamp01(buf[i]), g = clamp01(buf[i + 1]), b = clamp01(buf[i + 2]), L = oklab(r, g, b);
      let best = 0, bd = 1e9; for (let k = 0; k < P2.length; k++) { const q = P2[k].l, d = (q[0] - L[0]) ** 2 + (q[1] - L[1]) ** 2 + (q[2] - L[2]) ** 2; if (d < bd) { bd = d; best = k; } }
      const c = P2[best].c; o.d[i] = c[0]; o.d[i + 1] = c[1]; o.d[i + 2] = c[2]; o.d[i + 3] = img.d[i + 3];
      if (dither) { const er = [r - c[0], g - c[1], b - c[2]]; const add = (xx, yy, f) => { if (xx < 0 || xx >= W || yy >= H) return; const j = (yy * W + xx) * 4; for (let k = 0; k < 3; k++) buf[j + k] += er[k] * f; }; add(x + 1, y, 7 / 16); add(x - 1, y + 1, 3 / 16); add(x, y + 1, 5 / 16); add(x + 1, y + 1, 1 / 16); }
    }
    return o;
  }
  E.nearestMap = nearestMap;
  def(['image.mapColors', 'clip.mapColors'], async (n, I, P, X) => { const pal = I.palette || P.palette; const p = is(pal, 'palette') ? pal : E.mkPalette((Array.isArray(pal) ? pal : ['#000', '#fff']).map(c => hex(c))); return nearestMap(await X.img(I.src), p, !!P.dither); });
  def(['image.dither'], async (n, I, P, X) => { const img = await X.img(I.src); let pal = I.palette || P.palette; if (!pal) { const r = await photo('palette', img, { kind: 'perceptual', colors: P.colors || 4 }); pal = E.mkPalette(r.msg.palette.map(c => ({ rgb: c.rgb }))); } else if (!is(pal, 'palette')) pal = E.mkPalette(pal.map(c => hex(c))); return nearestMap(img, pal, P.method !== 'none'); });
  def('list.merge', async (n, I, P, X) => {
    const lists = is(I.src, 'list') ? I.src.items : [I.src];
    const all = []; for (const p of lists) if (is(p, 'palette')) for (const c of p.colors) all.push({ l: oklab(c.rgb[0] / 255, c.rgb[1] / 255, c.rgb[2] / 255), rgb: c.rgb, w: c.weight || 1 });
    const k = Math.max(1, Math.min(all.length, Math.round(P.k || 6)));
    let cent = all.slice().sort((a, b) => b.w - a.w).slice(0, k).map(c => c.l.slice());
    for (let it = 0; it < 12; it++) { const acc = cent.map(() => [0, 0, 0, 0]); for (const c of all) { let bi = 0, bd = 1e9; cent.forEach((m, i) => { const d = (m[0] - c.l[0]) ** 2 + (m[1] - c.l[1]) ** 2 + (m[2] - c.l[2]) ** 2; if (d < bd) { bd = d; bi = i; } }); const a = acc[bi]; a[0] += c.l[0] * c.w; a[1] += c.l[1] * c.w; a[2] += c.l[2] * c.w; a[3] += c.w; } cent = cent.map((m, i) => (acc[i][3] ? acc[i].slice(0, 3).map(v => v / acc[i][3]) : m)); }
    const out = cent.map(m => { let best = all[0], bd = 1e9; for (const c of all) { const d = (m[0] - c.l[0]) ** 2 + (m[1] - c.l[1]) ** 2 + (m[2] - c.l[2]) ** 2; if (d < bd) { bd = d; best = c; } } return { rgb: best.rgb, weight: 1 }; });
    out.sort((a, b) => luma(...a.rgb) - luma(...b.rgb));
    return E.mkPalette(out);
  });
  def('palette.tokens', async (n, I, P) => {
    const pal = I.src; const names = P.names || pal.colors.map(c => c.name);
    const vars = {}; pal.colors.forEach((c, i) => { vars[String(names[i] || `color-${i + 1}`).replace(/\s+/g, '-')] = c.hex; });
    const css = ':root {\n' + Object.entries(vars).map(([k, v]) => `  --${k}: ${v};`).join('\n') + '\n}\n';
    return E.mk('tokens', { vars, css, palette: pal });
  });
  // CMYK (naive GCR from the RGB values; no ICC profile ships with the workbench)
  function toCmyk(img, gcr) {
    const n = img.w * img.h, cm = new Float32Array(n * 4); gcr = gcr === undefined ? 0.8 : gcr;
    for (let i = 0; i < n; i++) { const r = img.d[i * 4], g = img.d[i * 4 + 1], b = img.d[i * 4 + 2]; let c = 1 - r, m = 1 - g, y = 1 - b; const k = Math.min(c, m, y) * gcr; c = (c - k) / (1 - k || 1); m = (m - k) / (1 - k || 1); y = (y - k) / (1 - k || 1); cm[i * 4] = c; cm[i * 4 + 1] = m; cm[i * 4 + 2] = y; cm[i * 4 + 3] = k; }
    return cm;
  }
  function cmykPreview(img, cm) {
    // coated-paper simulation: inks slightly dull, max density limited
    const inks = [[0, 0.63, 0.89], [0.93, 0.0, 0.55], [1.0, 0.94, 0.0]];
    return mapPx(img, (c, i) => { const C = cm[i * 4], M = cm[i * 4 + 1], Y = cm[i * 4 + 2], K = cm[i * 4 + 3]; let r = 0.97, g = 0.96, b = 0.93; const apply = (ink, a) => { r *= 1 - a * (1 - ink[0]); g *= 1 - a * (1 - ink[1]); b *= 1 - a * (1 - ink[2]); }; apply(inks[0], C); apply(inks[1], M); apply(inks[2], Y); const kk = 1 - K * 0.92; return [r * kk, g * kk, b * kk, c[3]]; });
  }
  def('image.convert', async (n, I, P, X) => {
    const img = await X.img(I.src); const model = P.model || 'cmyk';
    if (model === 'gray') return adjust(img, 'blackWhite', {});
    if (model === 'cmyk') { const cm = toCmyk(img, P.gcr); const o = cmykPreview(img, cm); o.cmyk = cm; o.profile = P.profile || 'Coated FOGRA39'; X.note('CMYK by grey-component replacement; no ICC profile ships with the workbench, so the profile name is recorded, not applied'); return o; }
    return img;
  });
  def(['image.softProof', 'clip.softProof'], async (n, I, P, X) => { const img = await X.img(I.src); return cmykPreview(img, toCmyk(img)); });
  def('image.channels', async (n, I, P, X) => {
    const img = await X.img(I.src); const W = img.w, H = img.h;
    if (img.cmyk) { const names = ['C', 'M', 'Y', 'K'], tint = [[0, 0.63, 0.89], [0.93, 0, 0.55], [1, 0.94, 0], [0.1, 0.1, 0.1]]; return E.list(names.map((nm, k) => { const o = E.image(W, H, null, { u: img.u, label: nm }); for (let i = 0; i < W * H; i++) { const a = img.cmyk[i * 4 + k]; for (let c = 0; c < 3; c++) o.d[i * 4 + c] = 1 - a * (1 - tint[k][c]); o.d[i * 4 + 3] = 1; } return o; })); }
    return E.list(['R', 'G', 'B'].map((nm, k) => { const o = E.image(W, H, null, { u: img.u, label: nm }); for (let i = 0; i < W * H; i++) { const v = img.d[i * 4 + k]; o.d[i * 4] = o.d[i * 4 + 1] = o.d[i * 4 + 2] = v; o.d[i * 4 + 3] = 1; } return o; }));
  });
  def('image.separate', async (n, I, P, X) => {
    const img = await X.img(I.src); const inks = (P.inks || ['#ff48b0', '#0078bf']).slice(0, Math.max(1, P.n || 2)).map(c => hex(c));
    const W = img.w, H = img.h, N = W * H;
    // per-pixel ink coverage: least squares in optical density (−log reflectance), clamped to 0..1
    const D = inks.map(c => c.slice(0, 3).map(v => -Math.log(Math.max(0.02, v))));
    const plates = inks.map(() => new Float32Array(N));
    for (let i = 0; i < N; i++) {
      const d = [0, 1, 2].map(k => -Math.log(Math.max(0.02, img.d[i * 4 + k])));
      if (inks.length === 1) { const a = D[0], t = (a[0] * d[0] + a[1] * d[1] + a[2] * d[2]) / (a[0] ** 2 + a[1] ** 2 + a[2] ** 2); plates[0][i] = clamp01(t); continue; }
      const a = D[0], b = D[1], aa = a[0] * a[0] + a[1] * a[1] + a[2] * a[2], bb = b[0] * b[0] + b[1] * b[1] + b[2] * b[2], ab = a[0] * b[0] + a[1] * b[1] + a[2] * b[2], ad = a[0] * d[0] + a[1] * d[1] + a[2] * d[2], bd = b[0] * d[0] + b[1] * d[1] + b[2] * d[2];
      const det = aa * bb - ab * ab || 1e-6; plates[0][i] = clamp01((ad * bb - bd * ab) / det); plates[1][i] = clamp01((bd * aa - ad * ab) / det);
    }
    return E.list(plates.map((p, k) => { const o = E.image(W, H, null, { u: img.u, label: `ink ${k + 1}`, ink: inks[k] }); for (let i = 0; i < N; i++) { for (let c = 0; c < 3; c++) o.d[i * 4 + c] = 1 - p[i] * (1 - inks[k][c]); o.d[i * 4 + 3] = 1; } return o; }));
  });

  // ── geometry ───────────────────────────────────────────────────────────
  def(['image.resize', 'clip.resize'], async (n, I, P, X) => {
    const img = await X.img(I.src); let w = P.w || 0, h = P.h || 0;
    if (w && w <= 4 && !h) { h = Math.round(img.h * w); w = Math.round(img.w * w); }
    if (!w && !h) return img; if (!h) h = Math.round(img.h * (w / img.w)); if (!w) w = Math.round(img.w * (h / img.h));
    const [pw, ph, s] = E.fitSize(w, h);
    if (!P.filter) return Object.assign(E.resizeClamped(img, pw, ph), { u: s });
    const k = pw / img.w, pm = 4, pad = padEdges(img, pm), qw = Math.round(pad.w * k), qh = Math.round(pad.h * ph / img.h);
    const r = await photo('resize', pad, { nw: qw, nh: qh, filter: P.filter });   // wasm resizers read black past the frame: pad, resize, crop
    return cropPx(E.image(qw, qh, new Float32Array(r.out.buffer, 0, qw * qh * 4)), Math.min(qw - pw, Math.round(pm * k)), Math.min(qh - ph, Math.round(pm * ph / img.h)), pw, ph, { u: s });
  });
  def(['image.scale'], async (n, I, P, X) => { const img = await X.img(I.src); const k = P.k || P.by || P.arg0 || 0.5; const nw = Math.max(1, Math.round(img.w * k)), nh = Math.max(1, Math.round(img.h * k)); if (P.filter && P.filter !== 'bicubic') { const pm = 4, pad = padEdges(img, pm), pw = Math.round(pad.w * k), ph = Math.round(pad.h * k); const r = await photo('resize', pad, { nw: pw, nh: ph, filter: P.filter }); const big = E.image(pw, ph, new Float32Array(r.out.buffer, 0, pw * ph * 4)); return cropPx(big, Math.min(pw - nw, Math.round(pm * k)), Math.min(ph - nh, Math.round(pm * k)), nw, nh, { u: img.u * k }); } return E.resizeClamped(img, nw, nh); });
  def(['image.carve', 'image.contentAwareScale'], async (n, I, P, X) => {
    const img = await X.img(I.src); let w = P.w || img.w, h = P.h || img.h;
    if (w <= 2) w = Math.round(img.w * w); if (h <= 2) h = Math.round(img.h * h);
    let protect = null; const pv = I.protect !== undefined ? I.protect : P.protect; if (pv) protect = (await X.need(pv, 'mask', img.w, img.h)).d;
    const r = await photo('carve', img, { nw: Math.round(w), nh: Math.round(h) }, protect);
    return E.image(r.msg.w, r.msg.h, new Float32Array(r.out.buffer, 0, r.msg.w * r.msg.h * 4), { u: img.u });
  });
  def(['image.crop', 'clip.crop'], async (n, I, P, X) => {
    const img = await X.img(I.src); let b = P.box || P.rect || [0.1, 0.1, 0.8, 0.8];
    if (b && !Array.isArray(b) && typeof b === 'object') b = [b.x || 0, b.y || 0, b.w || 1, b.h || 1];
    let [x, y, w, h] = b; if (Math.max(x, y, w, h) <= 1.0001) { x *= img.w; y *= img.h; w *= img.w; h *= img.h; } else { x *= img.u; y *= img.u; w *= img.u; h *= img.u; }
    x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y)); w = Math.max(1, Math.min(img.w - x, Math.round(w))); h = Math.max(1, Math.min(img.h - y, Math.round(h)));
    const o = E.image(w, h, null, { u: img.u }); for (let yy = 0; yy < h; yy++) o.d.set(img.d.subarray(((y + yy) * img.w + x) * 4, ((y + yy) * img.w + x + w) * 4), yy * w * 4); return o;
  });
  async function affine(img, m, w, h) {
    const c = E.canvas(w || img.w, h || img.h), g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]); g.drawImage(E.toCanvas(img), 0, 0); return E.fromCanvas(c, { u: img.u });
  }
  E.affine = affine;
  def(['image.translate', 'clip.translate'], async (n, I, P, X) => { const img = await X.img(I.src); const o = Array.isArray(P.offset) ? P.offset : [P.x || 0, P.y || 0]; return affine(img, [1, 0, 0, 1, o[0] * img.u, o[1] * img.u]); });
  def(['image.rotate', 'clip.rotate'], async (n, I, P, X) => { const img = await X.img(I.src); const a = ((P.deg !== undefined ? P.deg : P.angle !== undefined ? P.angle : P.arg0 || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), cx = img.w / 2, cy = img.h / 2; return affine(img, [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]); });
  def(['image.flip', 'clip.flip'], async (n, I, P, X) => { const img = await X.img(I.src); const v = P.axis === 'y' || P.axis === 'vertical'; return affine(img, v ? [1, 0, 0, -1, 0, img.h] : [-1, 0, 0, 1, img.w, 0]); });
  def(['image.transform', 'clip.transform'], async (n, I, P, X) => { const img = await X.img(I.src); const m = Array.isArray(P.m) ? P.m : [1, 0, 0, 1, 0, 0]; return affine(img, m.length === 6 ? m : [m[0], m[3], m[1], m[4], m[2], m[5]]); });
  def(['image.mirror', 'image.kaleido'], async (n, I, P, X) => { const img = await X.img(I.src); const W = img.w, H = img.h, o = E.image(W, H, null, { u: img.u }), seg = Math.max(2, P.segments || P.arg0 || 6); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let dx = x - W / 2, dy = y - H / 2; const r = Math.hypot(dx, dy); let a = Math.atan2(dy, dx); const s = (2 * Math.PI) / seg; a = ((a % s) + s) % s; if (a > s / 2) a = s - a; const sx = Math.max(0, Math.min(W - 1, Math.round(W / 2 + r * Math.cos(a)))), sy = Math.max(0, Math.min(H - 1, Math.round(H / 2 + r * Math.sin(a)))); o.d.set(img.d.subarray((sy * W + sx) * 4, (sy * W + sx) * 4 + 4), (y * W + x) * 4); } return o; });
  def(['image.deskew'], async (n, I, P, X) => {
    const img = await X.img(I.src); const small = E.resample(img, Math.min(400, img.w), Math.round(Math.min(400, img.w) * img.h / img.w)), W = small.w, H = small.h;
    // ink relative to the paper: the median tone is paper, anything lighter (scanner bed, rotated corners) counts as nothing
    const L = new Float32Array(W * H); for (let i = 0; i < W * H; i++) L[i] = luma(small.d[i * 4], small.d[i * 4 + 1], small.d[i * 4 + 2]);
    const sorted = Float32Array.from(L).sort(), med = sorted[Math.floor(sorted.length * 0.5)], dark = sorted[Math.floor(sorted.length * 0.02)], span = Math.max(0.05, med - dark);
    const ink = new Float32Array(W * H); for (let i = 0; i < W * H; i++) ink[i] = Math.min(1, Math.max(0, (med - 0.03 - L[i]) / span));
    let best = 0, bv = -1; for (let a = -8; a <= 8; a += 0.25) { const t = Math.tan((a * Math.PI) / 180), rows = new Float32Array(H * 2); for (let y = 0; y < H; y++) for (let x = 0; x < W; x += 2) { const yy = Math.round(y + (x - W / 2) * t) + H / 2; if (yy >= 0 && yy < H * 2) rows[yy] += ink[y * W + x]; } let v = 0; for (let i = 1; i < rows.length; i++) v += (rows[i] - rows[i - 1]) ** 2; if (v > bv) { bv = v; best = a; } }
    X.note(`deskewed by ${(-best).toFixed(2)}°`);
    const ang = (best * Math.PI) / 180, c = Math.cos(ang), s = Math.sin(ang), cx = img.w / 2, cy = img.h / 2;
    const bg = E.image(img.w, img.h); bg.d.fill(1);
    const rot = await affine(img, [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]);
    return blend(bg, rot, 'normal', 1);
  });
  def(['image.upright'], async (n, I, P, X) => { X.note('upright needs vanishing-point detection (LightCraft pipeline); the image is passed through'); return X.img(I.src); });
  def(['image.liquify', 'image.puppet'], async (n, I, P, X) => { X.note('liquify/puppet need strokes or pins from the canvas; with none, the image is passed through'); return X.img(I.src); });

  // ── selections and masks ───────────────────────────────────────────────
  const maskOut = (r, img) => E.mask(img.w, img.h, new Float32Array(r.out.buffer, 0, img.w * img.h), { u: img.u });
  def(['image.select.subject', 'clip.select.subject'], async (n, I, P, X) => { const img = await X.img(I.src); let small = img; if (img.w * img.h > 300000) small = E.resample(img, Math.round(img.w * 0.6), Math.round(img.h * 0.6)); const m = maskOut(await photo('subject', small), small); return small === img ? m : E.resample(m, img.w, img.h); });
  def(['image.select.sky', 'clip.select.sky'], async (n, I, P, X) => { const img = await X.img(I.src); return maskOut(await photo('sky', img), img); });
  def(['image.select.color'], async (n, I, P, X) => { const img = await X.img(I.src); return maskOut(await photo('colorRange', img, { color: hex(P.color || '#ffffff').slice(0, 3), fuzz: P.fuzz === undefined ? 40 : P.fuzz }), img); });
  def(['image.select.wand'], async (n, I, P, X) => { const img = await X.img(I.src); let at = P.at || [0.5, 0.5]; if (Math.max(at[0], at[1]) <= 1) at = [at[0] * img.w, at[1] * img.h]; else at = [at[0] * img.u, at[1] * img.u]; return maskOut(await photo('wand', img, { x: Math.round(at[0]), y: Math.round(at[1]), tolerance: P.tolerance === undefined ? 32 : P.tolerance, contiguous: P.contiguous !== false }), img); });
  def(['image.select.tones', 'image.select.luminance'], async (n, I, P, X) => { const img = await X.img(I.src), lo = P.lo === undefined ? 0.6 : P.lo, hi = P.hi === undefined ? 1 : P.hi, f = P.falloff || 0.1; const m = E.mask(img.w, img.h, null, { u: img.u }); for (let i = 0; i < img.w * img.h; i++) { const y = luma(img.d[i * 4], img.d[i * 4 + 1], img.d[i * 4 + 2]); m.d[i] = clamp01(Math.min((y - lo) / f + 1, (hi - y) / f + 1)); } return m; });
  def(['image.select.all'], async (n, I, P, X) => { const img = await X.img(I.src); const m = E.mask(img.w, img.h, null, { u: img.u }); m.d.fill(1); return m; });
  def(['image.select.ellipse', 'image.select.rect'], async (n, I, P, X) => { const img = await X.img(I.src); const b = P.box || [0.2, 0.2, 0.6, 0.6], m = E.mask(img.w, img.h, null, { u: img.u }), ell = n.op.endsWith('ellipse'); for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) { const u = (x / img.w - b[0]) / b[2], v = (y / img.h - b[1]) / b[3]; m.d[y * img.w + x] = ell ? ((u - 0.5) ** 2 + (v - 0.5) ** 2 <= 0.25 ? 1 : 0) : (u >= 0 && u <= 1 && v >= 0 && v <= 1 ? 1 : 0); } return m; });
  def(['image.alpha'], async (n, I, P, X) => { const img = await X.img(I.src); const m = E.mask(img.w, img.h, null, { u: img.u }); for (let i = 0; i < img.w * img.h; i++) m.d[i] = img.d[i * 4 + 3]; return m; });
  def(['image.luminance', 'image.toMask'], async (n, I, P, X) => X.need(await X.img(I.src), 'mask'));
  def(['image.mask', 'clip.mask'], async (n, I, P, X) => { const img = await X.img(I.src); const m = await X.need(I.mask || P.mask, 'mask', img.w, img.h); const o = E.image(img.w, img.h, Float32Array.from(img.d), { u: img.u }); for (let i = 0; i < img.w * img.h; i++) o.d[i * 4 + 3] *= m.d[i]; return o; });
  def(['mask.feather'], async (n, I, P, X) => { const m = await X.need(I.src, 'mask'); const r = (P.radius === undefined ? 2 : +P.radius) * (m.u || 1); return E.mask(m.w, m.h, blur1(m.d, m.w, m.h, r), { u: m.u }); });
  def(['mask.grow', 'mask.shrink', 'mask.border', 'mask.smooth'], async (n, I, P, X) => { const m = await X.need(I.src, 'mask'); const kind = { 'mask.grow': 'expand', 'mask.shrink': 'contract', 'mask.border': 'border', 'mask.smooth': 'smooth' }[n.op]; const r = await E.wasmCall(PH, 'maskop', { w: m.w, h: m.h, kind, r: (P.radius === undefined ? 2 : +P.radius) * (m.u || 1) }, m.d); return E.mask(m.w, m.h, new Float32Array(r.out.buffer, 0, m.w * m.h), { u: m.u }); });
  def(['mask.invert'], async (n, I, P, X) => { const m = await X.need(I.src, 'mask'); return E.mask(m.w, m.h, m.d.map(v => 1 - v), { u: m.u }); });
  def(['mask.and', 'mask.or', 'mask.minus', 'mask.xor'], async (n, I, P, X) => { const a = await X.need(I.src, 'mask'), b = await X.need(I.other || P.other, 'mask', a.w, a.h); const f = { 'mask.and': (x, y) => x * y, 'mask.or': (x, y) => x + y - x * y, 'mask.minus': (x, y) => x * (1 - y), 'mask.xor': (x, y) => Math.abs(x - y) }[n.op]; return E.mask(a.w, a.h, a.d.map((v, i) => f(v, b.d[i])), { u: a.u }); });
  def(['mask.refine'], async (n, I, P, X) => {
    const m = await X.need(I.src, 'mask'); if (!I.image) return m;
    const img = await X.need(I.image, 'image', m.w, m.h), W = m.w, H = m.h, r = Math.max(1, (P.radius || 8) * (m.u || 1) * 0.5), eps = 0.002;
    // guided filter (He et al.) with the image's luminance as guide: edges follow the picture
    const I0 = new Float32Array(W * H); for (let i = 0; i < W * H; i++) I0[i] = luma(img.d[i * 4], img.d[i * 4 + 1], img.d[i * 4 + 2]);
    const mI = blur1(I0, W, H, r), mp = blur1(m.d, W, H, r), II = blur1(I0.map(v => v * v), W, H, r), Ip = blur1(I0.map((v, i) => v * m.d[i]), W, H, r);
    const a = new Float32Array(W * H), b = new Float32Array(W * H); for (let i = 0; i < W * H; i++) { const varI = II[i] - mI[i] * mI[i], cov = Ip[i] - mI[i] * mp[i]; a[i] = cov / (varI + eps); b[i] = mp[i] - a[i] * mI[i]; }
    const ma = blur1(a, W, H, r), mb = blur1(b, W, H, r); return E.mask(W, H, I0.map((v, i) => clamp01(ma[i] * v + mb[i])), { u: m.u });
  });
  def(['mask.distance'], async (n, I, P, X) => {
    const m = await X.need(I.src, 'mask'), W = m.w, H = m.h, INF = 1e20; const f = new Float32Array(W * H); for (let i = 0; i < W * H; i++) f[i] = m.d[i] > 0.5 ? 0 : INF;
    const edt1 = (g, n2) => { const d = new Float32Array(n2), v = new Int32Array(n2), z = new Float32Array(n2 + 1); let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF; for (let q = 1; q < n2; q++) { let s; do { const p = v[k]; s = ((g[q] + q * q) - (g[p] + p * p)) / (2 * q - 2 * p); } while (s <= z[k] && --k >= 0); k++; v[k] = q; z[k] = s; z[k + 1] = INF; } k = 0; for (let q = 0; q < n2; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + g[v[k]]; } return d; };
    for (let x = 0; x < W; x++) { const col = new Float32Array(H); for (let y = 0; y < H; y++) col[y] = f[y * W + x]; const d = edt1(col, H); for (let y = 0; y < H; y++) f[y * W + x] = d[y]; }
    for (let y = 0; y < H; y++) { const d = edt1(f.subarray(y * W, y * W + W), W); for (let x = 0; x < W; x++) f[y * W + x] = Math.sqrt(d[x]) / Math.max(W, H); }
    return E.field(W, H, 1, f, ['d'], { u: m.u });
  });
  def(['mask.toImage', 'field.toImage', 'image.toImage'], async (n, I, P, X) => X.img(I.src));
  def(['image.edges'], async (n, I, P, X) => {
    const img = await X.img(I.src), W = img.w, H = img.h, Y = new Float32Array(W * H); for (let i = 0; i < W * H; i++) Y[i] = luma(img.d[i * 4], img.d[i * 4 + 1], img.d[i * 4 + 2]);
    const S = blur1(Y, W, H, P.method === 'sobel' ? 0.5 : 1.4), m = E.mask(W, H, null, { u: img.u }); let mx = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const a = k => S[k]; const i = y * W + x; const gx = -a(i - W - 1) - 2 * a(i - 1) - a(i + W - 1) + a(i - W + 1) + 2 * a(i + 1) + a(i + W + 1), gy = -a(i - W - 1) - 2 * a(i - W) - a(i - W + 1) + a(i + W - 1) + 2 * a(i + W) + a(i + W + 1); const g = Math.hypot(gx, gy); m.d[i] = g; if (g > mx) mx = g; }
    const t = P.threshold === undefined ? 0.15 : P.threshold; for (let i = 0; i < W * H; i++) m.d[i] = P.method === 'sobel' ? clamp01(m.d[i] / (mx || 1) * 1.5) : clamp01((m.d[i] / (mx || 1) - t) * 6);
    return m;
  });
  def(['image.histogram'], async (n, I, P, X) => E.histogram(await X.img(I.src)));
  E.histogram = function (img) { const H = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)]; const n = img.w * img.h, st = n > 400000 ? 2 : 1; for (let i = 0; i < n; i += st) { const r = img.d[i * 4], g = img.d[i * 4 + 1], b = img.d[i * 4 + 2]; H[0][Math.max(0, Math.min(255, r * 255 | 0))]++; H[1][Math.max(0, Math.min(255, g * 255 | 0))]++; H[2][Math.max(0, Math.min(255, b * 255 | 0))]++; H[3][Math.max(0, Math.min(255, luma(r, g, b) * 255 | 0))]++; } return { r: [...H[0]], g: [...H[1]], b: [...H[2]], l: [...H[3]] }; };
  def(['image.contentAwareFill', 'image.inpaint', 'image.heal', 'image.remove'], async (n, I, P, X) => {
    const img = await X.img(I.src); const hole = await X.need(I.hole || I.mask || P.hole, 'mask', img.w, img.h);
    let work = img, hm = hole; const big = img.w * img.h > 260000;
    if (big) { const k = Math.sqrt(260000 / (img.w * img.h)); work = E.resample(img, Math.round(img.w * k), Math.round(img.h * k)); hm = E.resample(hole, work.w, work.h); }
    const r = await photo('fill', work, { seed: P.seed || 1, mirror: !!P.mirror, rotation: P.rotation || 'none', color: P.color || 'default', scale: !!P.scale }, hm.d.map(v => (v > 0.4 ? 1 : 0)));
    let filled = outImg(r, work); if (big) { filled = E.resample(filled, img.w, img.h); const soft = E.mask(img.w, img.h, blur1(hole.d.map(v => (v > 0.4 ? 1 : 0)), img.w, img.h, 1.5)); return blend(img, filled, 'normal', 1, soft); }
    return filled;
  });
  def(['image.ocr', 'json.ocr'], async (n, I, P, X) => { X.note('OCR needs model weights (T3: ocrs on rten); no text was recognized here'); return { blocks: [], words: [], text: '', note: 'OCR is not in this browser build (needs model weights)' }; });
  def(['image.depth'], async (n, I, P, X) => {
    const img = await X.img(I.src); X.note('depth needs a model (T3); this is a stand-in: blurred luminance mixed with a vertical gradient');
    const W = img.w, H = img.h, Y = new Float32Array(W * H); for (let i = 0; i < W * H; i++) Y[i] = luma(img.d[i * 4], img.d[i * 4 + 1], img.d[i * 4 + 2]); const b = blur1(Y, W, H, 12); return E.field(W, H, 1, b.map((v, i) => 0.6 * ((i / W | 0) / H) + 0.4 * v), ['depth'], { u: img.u });
  });

  // ── fields ─────────────────────────────────────────────────────────────
  def(['field.threshold', 'image.thresholdField'], async (n, I, P, X) => { const f = await X.need(I.src, 'field'); const lvl = P.level === undefined ? 0.5 : +P.level; const o = E.field(f.w, f.h, 1, null, ['t'], { u: f.u }); for (let i = 0; i < f.w * f.h; i++) o.d[i] = f.d[i * f.ch] >= lvl ? 1 : 0; return o; });
  def(['field.toField', 'image.toField', 'mask.toField'], async (n, I, P, X) => {
    let src = I.src; if (is(src, 'proc')) src = await src.gen(256, 256);
    const f = await X.need(src, 'field'); const names = Array.isArray(P.channels) ? P.channels : ['a', 'b']; const init = Array.isArray(P.init) ? P.init : names.map(() => 0);
    const o = E.field(f.w, f.h, names.length, null, names, { u: f.u });
    for (let i = 0; i < f.w * f.h; i++) { const s = clamp01(f.d[i * f.ch]); for (let k = 0; k < names.length; k++) { const a = init[k] === undefined ? 0 : +init[k]; o.d[i * names.length + k] = a + ((1 - a) - a) * s; } }
    return o;
  });
  def(['field.channel'], async (n, I, P, X) => { const f = await X.need(I.src, 'field'); const nm = P.name === undefined ? 0 : P.name; let k = typeof nm === 'number' ? nm : (f.names || []).indexOf(nm); if (k < 0) k = { r: 0, g: 1, b: 2, a: 3, x: 0, y: 1 }[nm] || 0; const o = E.field(f.w, f.h, 1, null, [String(nm)], { u: f.u }); for (let i = 0; i < f.w * f.h; i++) o.d[i] = f.d[i * f.ch + Math.min(k, f.ch - 1)]; return o; });
  def(['field.blur'], async (n, I, P, X) => { const f = await X.need(I.src, 'field'); const r = (P.radius === undefined ? 4 : +P.radius) * (f.u || 1); const o = E.field(f.w, f.h, f.ch, null, f.names, { u: f.u }); for (let k = 0; k < f.ch; k++) { const c = new Float32Array(f.w * f.h); for (let i = 0; i < c.length; i++) c[i] = f.d[i * f.ch + k]; const b = blur1(c, f.w, f.h, r); for (let i = 0; i < c.length; i++) o.d[i * f.ch + k] = b[i]; } return o; });
  def(['field.remap'], async (n, I, P, X) => { const f = await X.need(I.src, 'field'); let lo = Infinity, hi = -Infinity; for (const v of f.d) { if (v < lo) lo = v; if (v > hi) hi = v; } const a = P.lo === undefined ? 0 : +P.lo, b = P.hi === undefined ? 1 : +P.hi; return Object.assign({}, f, { d: f.d.map(v => a + (v - lo) / ((hi - lo) || 1) * (b - a)) }); });
  def(['field.gradient', 'field.flow'], async (n, I, P, X) => { const f = await X.need(I.src, 'field'); const W = f.w, H = f.h, o = E.field(W, H, 2, null, ['x', 'y'], { u: f.u }); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = (xx, yy) => f.d[(Math.max(0, Math.min(H - 1, yy)) * W + Math.max(0, Math.min(W - 1, xx))) * f.ch]; o.d[(y * W + x) * 2] = 0.5 + (v(x + 1, y) - v(x - 1, y)) * 2; o.d[(y * W + x) * 2 + 1] = 0.5 + (v(x, y + 1) - v(x, y - 1)) * 2; } return o; });

  // ── px lambdas: the traced expression tree compiled to one scalar JS loop (the GPU path compiles the same tree to WGSL) ──
  const FN1 = { sin: 'Math.sin', cos: 'Math.cos', abs: 'Math.abs', fract: 'FR', floor: 'Math.floor', sqrt: 'SQ', exp: 'Math.exp', log: 'LG', tan: 'Math.tan', sign: 'Math.sign', oneMinus: 'OM' };
  function pxExprs(ast, names) {
    const SW = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3 };
    const dimIn = { c: 4, uv: 2, xy: 2, t: 1, n: 1, lap: 4, size: 2 };
    const uses = new Set(), unis = new Set();
    function g(a) {
      switch (a[0]) {
        case 'num': return [String(a[1])];
        case 'u': unis.add(a[1]); return ['U_' + String(a[1]).replace(/\W/g, '_')];
        case 'in': { uses.add(a[1]); const d = dimIn[a[1]] || 1; const pre = a[1] === 'lap' ? 'l' : a[1]; return d === 1 ? [a[1]] : Array.from({ length: d }, (_, i) => `${pre}${i}`); }
        case 'vec': return a[1].flatMap(g);
        case 'sw': {
          const base = g(a[1]), key = a[2];
          if (names && a[1][0] === 'in' && (a[1][1] === 'c' || a[1][1] === 'lap') && names.includes(key)) return [base[names.indexOf(key)]];
          if (names && a[1][0] === 'in' && (a[1][1] === 'c' || a[1][1] === 'lap') && !/^[xyzwrgba]{1,4}$/.test(key)) throw new Error(`px lambda: this field has channels ${names.join(', ')}; there is no '${key}'`);
          if (!/^[xyzwrgba]{1,4}$/.test(key)) { if (key.length === 1) return [base[0]]; throw new Error(`px lambda: '.${key}' is not a swizzle (x y z w / r g b a)`); }
          return key.split('').map(ch => base[Math.min(base.length - 1, SW[ch])] || '0');
        }
        case 'obj': return Object.values(a[1]).flatMap(g);
        case 'f': {
          const f = a[1], args = a.slice(2).map(g), n = Math.max(...args.map(x => x.length));
          const at = (x, i) => (x.length === 1 ? x[0] : x[Math.min(i, x.length - 1)]);
          const cw = fn => Array.from({ length: n }, (_, i) => fn(i));
          switch (f) {
            case 'add': return cw(i => `(${at(args[0], i)}+${at(args[1], i)})`);
            case 'sub': return cw(i => `(${at(args[0], i)}-${at(args[1], i)})`);
            case 'mul': return cw(i => `(${at(args[0], i)}*${at(args[1], i)})`);
            case 'div': return cw(i => `(${at(args[0], i)}/${at(args[1], i)})`);
            case 'pow': return cw(i => `Math.pow(Math.max(0,${at(args[0], i)}),${at(args[1], i)})`);
            case 'min': return cw(i => `Math.min(${at(args[0], i)},${at(args[1], i)})`);
            case 'max': return cw(i => `Math.max(${at(args[0], i)},${at(args[1], i)})`);
            case 'atan2': return cw(i => `Math.atan2(${at(args[0], i)},${at(args[1], i)})`);
            case 'mix': return cw(i => `MX(${at(args[0], i)},${at(args[1], i)},${at(args[2], i)})`);
            case 'clamp': return cw(i => `CL(${at(args[0], i)},${at(args[1], i)},${at(args[2], i)})`);
            case 'smoothstep': return cw(i => `SS(${at(args[1], i)},${at(args[2], i)},${at(args[0], i)})`);
            case 'step': return cw(i => `(${at(args[0], i)}>=${at(args[1], i)}?1:0)`);
            case 'dot': { const m = Math.min(args[0].length, args[1].length); return ['(' + Array.from({ length: m }, (_, i) => `${args[0][i]}*${args[1][i]}`).join('+') + ')']; }
            case 'length': return ['Math.sqrt(' + args[0].map(x => `${x}*${x}`).join('+') + ')'];
            case 'distance': { const m = Math.max(args[0].length, args[1].length); return ['Math.sqrt(' + Array.from({ length: m }, (_, i) => `(${at(args[0], i)}-${at(args[1], i)})**2`).join('+') + ')']; }
            case 'gray': { const c = args[0]; const y = `(0.2126*${c[0]}+0.7152*${at(c, 1)}+0.0722*${at(c, 2)})`; return [y, y, y, c.length > 3 ? c[3] : '1']; }
            case 'hsv': { const c = args[0]; return [0, 1, 2].map(k => `HSV(${c[0]},${at(c, 1)},${at(c, 2)},${k})`).concat([c.length > 3 ? c[3] : '1']); }
            default: if (FN1[f]) return args[0].map(x => `${FN1[f]}(${x})`); throw new Error(`px lambda: no function '${f}'`);
          }
        }
      }
      throw new Error('px lambda: bad expression');
    }
    const comps = g(ast);
    return { comps, uses, unis: [...unis], outNames: ast[0] === 'obj' ? Object.keys(ast[1]) : null };
  }
  function compilePx(ast, names, ch) {
    const { comps, uses, unis, outNames } = pxExprs(ast, names);
    const useLap = uses.has('lap');
    const load = Array.from({ length: 4 }, (_, k) => `const c${k} = ${k < ch ? `cur[i*${ch}+${k}]` : ch === 1 && k < 3 ? 'c0' : k === 3 ? '1' : '0'};`).join(' ');
    const lap = useLap ? Array.from({ length: Math.min(ch, 4) }, (_, k) => `const l${k} = 0.05*cur[i00*${ch}+${k}] + 0.2*cur[i01*${ch}+${k}] + 0.05*cur[i02*${ch}+${k}] + 0.2*cur[i10*${ch}+${k}] - cur[i*${ch}+${k}] + 0.2*cur[i12*${ch}+${k}] + 0.05*cur[i20*${ch}+${k}] + 0.2*cur[i21*${ch}+${k}] + 0.05*cur[i22*${ch}+${k}];`).join(' ') + Array.from({ length: Math.max(0, 4 - ch) }, (_, k) => ` const l${ch + k} = 0;`).join('') : '';
    const outCh = outNames ? comps.length : (ch === 1 ? 1 : Math.min(4, comps.length));
    const body = `const MX=(a,b,t)=>a+(b-a)*t, CL=(x,a,b)=>x<a?a:x>b?b:x, SS=(e0,e1,x)=>{const t=CL((x-e0)/((e1-e0)||1e-9),0,1);return t*t*(3-2*t)}, FR=x=>x-Math.floor(x), OM=x=>1-x, SQ=x=>Math.sqrt(Math.max(0,x)), LG=x=>Math.log(Math.max(1e-9,x)), HSV=(h,s,v,k)=>{const f=(n)=>{const kk=(n+h*6)%6;return v-v*s*Math.max(0,Math.min(kk,4-kk,1))};return f(k===0?5:k===1?3:1)};
      return function(cur, nxt, W, H, U, t, steps, swap, budget) {
        ${unis.map(u => `const U_${String(u).replace(/\W/g, '_')} = +U[${JSON.stringify(u)}] || 0;`).join(' ')}
        const size0 = W, size1 = H; const t0 = Date.now(); let s = 0;
        for (; s < steps; s++) {
          for (let y = 0; y < H; y++) {
            const ym = (y === 0 ? H - 1 : y - 1) * W, yy = y * W, yp = (y === H - 1 ? 0 : y + 1) * W, uv1 = (y + 0.5) / H, xy1 = y;
            for (let x = 0; x < W; x++) {
              const i = yy + x, uv0 = (x + 0.5) / W, xy0 = x;
              ${useLap ? 'const xm = x === 0 ? W - 1 : x - 1, xp = x === W - 1 ? 0 : x + 1; const i00 = ym + xm, i01 = ym + x, i02 = ym + xp, i10 = yy + xm, i12 = yy + xp, i20 = yp + xm, i21 = yp + x, i22 = yp + xp;' : ''}
              ${load} const n = c0; ${lap}
              ${comps.slice(0, outCh).map((e, k) => `nxt[i*${outCh}+${k}] = ${e};`).join(' ')}
            }
          }
          if (steps > 1) { const tmp = cur; cur = nxt; nxt = tmp; if (budget && (s & 15) === 15 && Date.now() - t0 > budget) { s++; break; } }
        }
        return { buf: steps > 1 ? cur : nxt, steps: s };
      }`;
    const fn = new Function(body)();
    return { fn, n: comps.length, outCh, outNames, uses };
  }
  E.compilePx = compilePx; E.pxExprs = pxExprs;
  const PX_CACHE = new Map();
  function kernelFor(ast, names, ch) { const key = JSON.stringify(ast) + '|' + (names || []).join(',') + '|' + ch; let k = PX_CACHE.get(key); if (!k) { k = compilePx(ast, names, ch); PX_CACHE.set(key, k); if (PX_CACHE.size > 64) PX_CACHE.delete(PX_CACHE.keys().next().value); } return k; }
  async function uniforms(P, X) { const U = {}; for (const [k, v] of Object.entries(P.uniforms || {})) U[k] = typeof v === 'number' ? v : await E.need(v, 'number', 0, 0, X); return U; }
  function wrapOut(src, buf, k, names) {
    const W = src.w, H = src.h;
    if (k.outCh === 4 && !k.outNames && (is(src, 'image') || !src.names)) { for (let i = 0; i < buf.length; i++) { const v = buf[i]; buf[i] = v < 0 ? 0 : v > 1 ? 1 : v; } return E.image(W, H, buf, { u: src.u }); }
    return E.field(W, H, k.outCh, buf, k.outNames || names || null, { u: src.u });
  }
  E.runPx = async function (src, P, X) {
    const ch = is(src, 'image') ? 4 : is(src, 'mask') ? 1 : src.ch, names = is(src, 'image') ? null : src.names;
    const k = kernelFor(P.ast, names, ch), U = await uniforms(P, X);
    const nxt = new Float32Array(src.w * src.h * k.outCh);
    const r = k.fn(src.d, nxt, src.w, src.h, U, X.time || 0, 1, false, 0);
    return wrapOut(src, r.buf, k, names);
  };
  E.iteratePx = async function (src, P, steps, X, budgetMs) {
    const ch = is(src, 'image') ? 4 : is(src, 'mask') ? 1 : src.ch, names = is(src, 'image') ? null : src.names;
    const k = kernelFor(P.ast, names, ch); if (k.outCh !== ch) throw new Error('a px lambda inside iterate must return the same channels it reads');
    const U = await uniforms(P, X), a = Float32Array.from(src.d), b = new Float32Array(a.length);
    const r = k.fn(a, b, src.w, src.h, U, X.time || 0, steps, true, budgetMs || 0);
    return { value: wrapOut(src, r.buf, k, names), steps: r.steps };
  };
  def(['raster.px'], async (n, I, P, X) => {
    const prep = async src => { if (is(src, 'proc')) src = await src.gen(512, 512); if (!is(src, ['image', 'field', 'mask'])) src = await X.img(src); return src; };
    if (X.env.target === 'webgpu' && E.gpu && await E.gpu.ready()) {
      try {
        const f = E.gpu.fuse(n, P);
        const src = await prep(await X.eval(f.srcId));
        const r = await E.gpu.px(src, Object.assign({}, P, { ast: f.ast, fused: f.count > 1 ? f.count : 0 }), X); if (r) return r;
      } catch (e) { X.note('WebGPU path failed, ran on the CPU: ' + e.message); }
    }
    return E.runPx(await prep(await X.eval(n.in.src)), P, X);
  }, { lazy: true });
  def('iterate', async (n, I, P, X) => {
    let init = await X.eval(n.in.init);
    if (is(init, 'proc')) init = await init.gen(256, 256);
    const stepId = n.in.step, body = n.params.body || [], stateId = body.find(id => E.P.byId.get(id) && E.P.byId.get(id).op === 'iterate.state');
    const stepNode = E.P.byId.get(stepId), steps = Math.max(1, Math.round(P.steps || 1));
    // fast path: the step is one px lambda over the state
    if (stepNode && stepNode.op === 'raster.px' && stepNode.in.src === stateId) {
      const sp = await X.resolve(stepNode.params);
      if (X.env.target === 'webgpu' && E.gpu && await E.gpu.ready()) { try { const r = await E.gpu.iterate(init, sp, steps, X); if (r) { X.note(`${steps} steps on the GPU`); return r; } } catch (e) { X.note('WebGPU iterate failed, ran on the CPU: ' + e.message); } }
      let src = init;
      const r = await E.iteratePx(src, sp, steps, X, 8000);
      if (r.steps < steps) X.note(`CPU path ran ${r.steps} of ${steps} steps in its 8 s budget; the WebGPU target runs them all`);
      else X.note(`${steps} steps on the CPU (compiled JS loop)`);
      return r.value;
    }
    let v = init;
    for (let k = 0; k < Math.min(steps, 400); k++) { const b = X.bind([[stateId, Object.assign(v, { __sig: E.fnv('it' + k + X.sig) })]]); v = await X.eval(stepId, Object.assign({}, X.env, { bind: b })); }
    if (steps > 400) X.note(`ran 400 of ${steps} steps (general step graphs are not compiled)`);
    return v;
  }, { lazy: true });
  def('iterate.state', async (n, I, P, X) => { throw new Error('iterate.state is bound by iterate'); });

  // ── stacks: layers, adjustment layers, groups, styles ──────────────────
  async function placeLayer(v, W, H, u, entry, X) {
    if (v == null) return null;
    if (is(v, 'list')) v = v.items[0];
    if (is(v, 'audio') || is(v, 'series')) return null;
    if (typeof v === 'string' || (Array.isArray(v) && v.length >= 3 && typeof v[0] === 'number')) return X.need(v, 'image', W, H);
    if (is(v, ['text', 'shapes', 'path', 'pages'])) {
      let img = await E.rasterize(v, W, H, X, { unitsPerPx: 1 / u, at: entry.at });
      const isText = is(v, 'text'), sc = entry.scale === undefined ? 1 : +entry.scale, rot = +(entry.rotate || 0), move = !isText && Array.isArray(entry.at);
      if (img && (sc !== 1 || rot || move)) {   // layer transforms for vector layers: move the artboard centre to 'at', then scale and rotate about it
        let cx = W / 2, cy = H / 2, tx = 0, ty = 0;
        if (Array.isArray(entry.at)) { const ax = entry.at[0] <= 1.5 ? entry.at[0] * W : entry.at[0] * u, ay = entry.at[1] <= 1.5 ? entry.at[1] * H : entry.at[1] * u; if (move) { tx = ax - W / 2; ty = ay - H / 2; } cx = ax; cy = ay; }
        const c = E.canvas(W, H), g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
        g.translate(cx, cy); g.rotate(rot * Math.PI / 180); g.scale(sc, sc); g.translate(-cx, -cy); g.translate(tx, ty); g.drawImage(E.toCanvas(img), 0, 0);
        img = E.fromCanvas(c, { u });
      }
      return img;
    }
    if (is(v, 'proc')) return X.need(await v.gen(W, H), 'image', W, H);
    let img = await X.need(v, 'image');
    if (img.w === W && img.h === H && !entry.at && !entry.scale) return img;
    const fit = entry.fit || 'cover';
    let s = fit === 'none' ? (u / (img.u || 1)) : fit === 'contain' ? Math.min(W / img.w, H / img.h) : Math.max(W / img.w, H / img.h);
    if (entry.scale) s *= entry.scale;
    const dw = img.w * s, dh = img.h * s;
    let cx = W / 2, cy = H / 2;
    if (Array.isArray(entry.at)) { cx = entry.at[0] <= 1.5 ? entry.at[0] * W : entry.at[0] * u; cy = entry.at[1] <= 1.5 ? entry.at[1] * H : entry.at[1] * u; }
    const c = E.canvas(W, H), g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
    if (entry.rotate) { g.translate(cx, cy); g.rotate(entry.rotate * Math.PI / 180); g.translate(-cx, -cy); }
    g.drawImage(E.toCanvas(img), cx - dw / 2, cy - dh / 2, dw, dh);
    return E.fromCanvas(c, { u });
  }
  E.placeLayer = placeLayer;
  async function layerStyle(acc, img, st, u) {
    if (!st) return acc;
    const W = img.w, H = img.h, alpha = new Float32Array(W * H); for (let i = 0; i < W * H; i++) alpha[i] = img.d[i * 4 + 3];
    const ds = st.dropShadow || st.shadow;
    if (ds) {
      const dist = (ds.distance === undefined ? 6 : ds.distance) * u, ang = ((ds.angle === undefined ? 135 : ds.angle) * Math.PI) / 180, size = (ds.size === undefined ? 10 : ds.size) * u;
      const b = blur1(alpha, W, H, size / 2), dx = Math.round(-Math.cos(ang) * dist), dy = Math.round(Math.sin(ang) * dist), col = hex(ds.color || '#000000');
      const sh = E.image(W, H, null, { u }); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const sx = x - dx, sy = y - dy; const a = sx >= 0 && sy >= 0 && sx < W && sy < H ? b[sy * W + sx] : 0; const i = (y * W + x) * 4; sh.d[i] = col[0]; sh.d[i + 1] = col[1]; sh.d[i + 2] = col[2]; sh.d[i + 3] = a; }
      acc = await blend(acc, sh, ds.blend || 'multiply', ds.opacity === undefined ? 0.5 : ds.opacity);
    }
    const og = st.outerGlow || st.glow;
    if (og) { const size = (og.size === undefined ? 14 : og.size) * u, b = blur1(alpha, W, H, size / 2), col = hex(og.color || '#ffd400'); const gl = E.image(W, H, null, { u }); for (let i = 0; i < W * H; i++) { gl.d.set(col.slice(0, 3), i * 4); gl.d[i * 4 + 3] = clamp01(b[i] * 1.6); } acc = await blend(acc, gl, og.blend || 'screen', og.opacity === undefined ? 0.75 : og.opacity); }
    return acc;
  }
  async function strokeStyle(img, st, u) {
    if (!st || !st.stroke) return img;
    const s = st.stroke, W = img.w, H = img.h, size = (s.size === undefined ? 3 : s.size) * u, col = hex(s.color || '#000000');
    const al = new Float32Array(W * H); for (let i = 0; i < W * H; i++) al[i] = img.d[i * 4 + 3];
    const r = await E.wasmCall(PH, 'maskop', { w: W, h: H, kind: 'expand', r: size }, al); const grown = new Float32Array(r.out.buffer, 0, W * H);
    const ring = E.image(W, H, null, { u }); for (let i = 0; i < W * H; i++) { ring.d.set(col.slice(0, 3), i * 4); ring.d[i * 4 + 3] = grown[i]; }
    return blend(ring, img, 'normal', 1);
  }
  async function composite(n, X, P0, opts) {
    const layers = n.params.layers || [];
    let W, H, u = 1, acc;
    const baseV = opts.base !== undefined ? opts.base : (n.in.base ? await X.eval(n.in.base) : null);
    if (opts.size) { [W, H, u] = E.fitSize(opts.size[0], opts.size[1]); }
    if (!W && baseV && !is(baseV, 'proc') && is(baseV, ['image', 'mask', 'field'])) { W = baseV.w; H = baseV.h; u = baseV.u || 1; }
    if (!W) {
      // size from the first sized layer
      for (const l of layers) { if (!l.$ref || l.kind === 'adjust') continue; const v = await X.eval(l.$ref); if (is(v, ['image', 'mask', 'field'])) { W = v.w; H = v.h; u = v.u || 1; break; } if (is(v, 'shapes')) { [W, H, u] = E.fitSize(v.w, v.h); break; } }
    }
    if (!W) { W = E.DEF[0]; H = E.DEF[1]; }
    acc = baseV ? await placeLayer(baseV, W, H, u, {}, X) : E.image(W, H, null, { u });
    if (!acc) acc = E.image(W, H, null, { u });
    acc = Object.assign(acc, { u });
    const audio = [];
    for (let i = 0; i < layers.length; i++) {
      const raw = layers[i];
      const meta = await X.resolve(Object.assign({}, raw, { $ref: undefined, body: undefined, value: raw.value }));
      if (meta.visible === false || meta.hidden) continue;
      if (opts.time !== undefined) { const st = meta.start || 0, en = meta.end === undefined ? Infinity : meta.end; if (opts.time < st || opts.time > en) continue; }
      const opacity = meta.opacity === undefined ? 1 : E.clamp01(+meta.opacity);
      let mask = null;
      if (raw.mask) { const mv = raw.mask.$ref ? await X.eval(raw.mask.$ref) : meta.mask; mask = await X.need(mv, 'mask', W, H); }
      if (raw.kind === 'adjust') {
        const below = n.params.layers && E.P.ir.nodes.find(x => x.op === 'stack.below' && x.in.stack === n.id && x.params.layer === i);
        const b = below ? X.bind([[below.id, Object.assign(acc, { __sig: E.fnv(X.sig + ':below' + i) })]]) : X.env.bind;
        const res = await X.need(await X.eval(raw.$ref, Object.assign({}, X.env, { bind: b })), 'image', W, H);
        acc = await blend(acc, res, meta.blend || 'normal', opacity, mask);
        continue;
      }
      let v = raw.$ref ? await X.eval(raw.$ref) : meta.value;
      if (is(v, 'audio')) { audio.push({ audio: v, gain: meta.gain === undefined ? 1 : meta.gain, start: meta.start || 0 }); continue; }
      if (v && v.audio) audio.push(...v.audio);
      let img = await placeLayer(v, W, H, u, meta, X);
      if (!img) continue;
      if (meta.style || raw.style) { const st = meta.style || raw.style; img = await strokeStyle(img, st, u); acc = await layerStyle(acc, img, st, u); }
      acc = await blend(acc, img, meta.blend || 'normal', opacity, mask);
    }
    acc.u = u;
    if (audio.length) acc.audio = audio;
    if (X.env.strokes && X.env.strokes[n.id] && (X.env.strokes[n.id].list || []).length) acc = await paintStrokes(acc, X.env.strokes[n.id], X);
    return acc;
  }
  E.composite = composite;
  // strokes painted on a canvas with a brush tool: dabs whose size, angle, opacity and wetness come from the
  // brush's dynamics lambdas, called per stylus sample at runtime
  async function paintStrokes(acc, S, X) {
    const ctl = E.P.controls.get(S.brush) || {};
    const spec = await X.resolve(Object.assign({}, ctl, { id: undefined, type: undefined }));
    const dyn = spec.dynamics || {}, preset = String(spec.preset || 'round');
    const call = (f, s, d) => { if (typeof f !== 'function') return typeof f === 'number' ? f : d; try { const v = f(s); return typeof v === 'number' && isFinite(v) ? v : d; } catch (e) { return d; } };
    const scatter = typeof spec.scatter === 'number' ? spec.scatter : 0.2, col = hex(spec.color || (preset.includes('ink') ? '#141414' : '#1d2733'));
    const W = acc.w, H = acc.h, u = acc.u || 1, c = E.canvas(W, H), g = c.getContext('2d'); g.drawImage(E.toCanvas(acc), 0, 0);
    const bristle = /bristle|oil|dry/.test(preset), soft = /air|soft|wash|water/.test(preset), pencil = /pencil|graphite/.test(preset);
    let seed = 1;
    for (const st of S.list) {
      let prev = null;
      for (const p of st) {
        const x = p[0] * W, y = p[1] * H, pressure = p[2] === undefined ? 0.5 : p[2], tilt = [(p[3] || 0) / 90, (p[4] || 0) / 90], tms = p[5] || 0;
        const speed = prev ? Math.hypot(x - prev.x, y - prev.y) / u / Math.max(1, tms - prev.t) * 1000 : 0;
        const s = { x: x / u, y: y / u, pressure, tilt, speed, time: tms / 1000 };
        const size = Math.max(0.5, call(dyn.size, s, 4 + pressure * 20)) * u, ang = call(dyn.angle, s, 0) * Math.PI / 180;
        const wet = E.clamp01(call(dyn.wetness, s, 0.6)), op = E.clamp01(call(dyn.opacity, s, 0.8));
        const from = prev || { x, y }, dist = Math.hypot(x - from.x, y - from.y), step = Math.max(0.6, size * (pencil ? 0.15 : 0.22)), n = Math.max(1, Math.ceil(dist / step));
        for (let k = prev ? 1 : 0; k <= n; k++) {
          const t = k / n, cx = from.x + (x - from.x) * t, cy = from.y + (y - from.y) * t;
          const j = scatter * size * 0.6, jx = (E.hash2(seed, k, 3) - 0.5) * 2 * j, jy = (E.hash2(seed, k, 9) - 0.5) * 2 * j; seed++;
          const a = op * (0.25 + 0.6 * wet) * (soft ? 0.18 : pencil ? 0.5 : 0.32);
          g.save(); g.translate(cx + jx, cy + jy); g.rotate(ang); g.scale(1, bristle ? 0.55 : 1);
          if (bristle) { for (let b = 0; b < 7; b++) { const bx = (E.hash2(b, 1, 7) - 0.5) * size, by = (E.hash2(b, 2, 7) - 0.5) * size * 0.9, br = size * (0.12 + 0.12 * E.hash2(b, 3, 7)); g.fillStyle = `rgba(${col.slice(0, 3).map(v => Math.round(v * 255)).join(',')},${Math.min(1, a * 2.4).toFixed(3)})`; g.beginPath(); g.arc(bx, by, br, 0, Math.PI * 2); g.fill(); } }
          else { const gr = g.createRadialGradient(0, 0, 0, 0, 0, size / 2); const rgb = col.slice(0, 3).map(v => Math.round(v * 255)).join(','); gr.addColorStop(0, `rgba(${rgb},${a.toFixed(3)})`); gr.addColorStop(soft ? 0.2 : pencil ? 0.85 : 0.6, `rgba(${rgb},${(a * (soft ? 0.5 : 0.9)).toFixed(3)})`); gr.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, size / 2, 0, Math.PI * 2); g.fill(); }
          g.restore();
        }
        prev = { x, y, t: tms };
      }
    }
    X.note(`${S.list.length} stroke${S.list.length === 1 ? '' : 's'} painted with ${preset}; size, angle and wetness from the brush's lambdas`);
    return E.fromCanvas(c, { u });
  }
  def('stack', async (n, I, P, X) => composite(n, X, P, {}), { lazy: true, rawParams: true });
  def('stack.below', async () => { throw new Error('stack.below is bound by its stack'); });
  def('source.psd', async (n, I, P, X) => {
    // a built-in layered document stands in for the .psd: the photo, a duotone wash and a title
    const photoImg = await E.loadAsset(P.src || 'poster');
    const base = await adjust(photoImg, 'gradientMap', { stops: [[0, '#1f2a6b'], [0.6, '#c2187a'], [1, '#f2b84b']] });
    return composite(n, X, P, { base: await blend(photoImg, base, 'color', 0.85) });
  }, { lazy: true, rawParams: true });
  def('comp', async (n, I, P, X) => {
    const size = Array.isArray(n.params.size) ? n.params.size : (n.params.size && n.params.size.$control ? null : [1920, 1080]);
    const r = await composite(n, X, P, { size: size || [1920, 1080], time: X.time, base: n.params.background ? await X.resolve(n.params.background) : '#101114' });
    r.timing = { dur: typeof n.params.duration === 'number' ? n.params.duration : 4, fps: n.params.fps || 30 };
    return r;
  }, { lazy: true, rawParams: true, time: true });
  def('mix', async (n, I, P, X) => {
    const layers = n.params.layers || []; const parts = [];
    for (const l of layers) { const v = l.$ref ? await X.eval(l.$ref) : null; const meta = await X.resolve(Object.assign({}, l, { $ref: undefined })); if (is(v, 'audio')) parts.push({ a: v, gain: meta.gain === undefined ? 1 : meta.gain, start: meta.start || 0 }); }
    if (!parts.length) return E.audio(44100, [new Float32Array(44100)]);
    const sr = parts[0].a.sr, len = Math.max(...parts.map(p => p.a.ch[0].length + Math.round(p.start * sr))), L = new Float32Array(len), R = new Float32Array(len);
    for (const p of parts) { const s = Math.round(p.start * sr), l = p.a.ch[0], r = p.a.ch[1] || l; for (let i = 0; i < l.length; i++) { L[s + i] += l[i] * p.gain; R[s + i] += r[i] * p.gain; } }
    return E.audio(sr, [L, R]);
  }, { lazy: true, rawParams: true });
  def(['image.blend', 'clip.blend', 'mask.blend'], async (n, I, P, X) => {
    const back = await X.img(I.src); const top = I.top || P.top; if (!top) return back;
    const t = await placeLayer(top, back.w, back.h, back.u || 1, { fit: P.fit || 'cover', at: P.at }, X);
    const mask = I.mask || P.mask ? await X.need(I.mask || P.mask, 'mask', back.w, back.h) : null;
    return blend(back, t, P.mode || 'normal', P.opacity === undefined ? 1 : +P.opacity, mask);
  });
  def(['image.over', 'image.under'], async (n, I, P, X) => { const a = await X.img(I.src); const b = await placeLayer(I.other || P.other, a.w, a.h, a.u || 1, {}, X); return n.op === 'image.over' ? blend(b, a, 'normal', 1) : blend(a, b, 'normal', 1); });
  def(['image.fill', 'mask.fill'], async (n, I, P, X) => { const m = await X.need(I.src, 'mask'); const col = hex(P.color || P.paint || '#000'); const o = E.image(m.w, m.h, null, { u: m.u }); for (let i = 0; i < m.w * m.h; i++) { o.d.set(col.slice(0, 3), i * 4); o.d[i * 4 + 3] = m.d[i] * col[3]; } return o; });
})(typeof self !== 'undefined' ? self : this);
