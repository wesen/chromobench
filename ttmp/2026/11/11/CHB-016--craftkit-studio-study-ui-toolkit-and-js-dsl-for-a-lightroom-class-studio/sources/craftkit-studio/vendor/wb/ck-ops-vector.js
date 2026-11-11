/* ck-ops-vector.js · vectors and type. Paths are SVG path data in canvas units. Booleans, offsets, outline strokes,
 * simplification, Pathfinder and Image Trace run VectorCraft's own crates in wasm (ck_vector); glyph outlines come
 * from the font files through opentype.js; text on a path, per-character animators, contours and the plotter
 * ordering are JS. Shapes rasterize through OffscreenCanvas Path2D and serialize to SVG for export. */
(function (root) {
  'use strict';
  const E = root.CK_ENGINE, def = E.def, is = E.is, hex = E.hex, clamp01 = E.clamp01;
  const VC = 'ck_vector';
  const r3 = v => Math.round(v * 100) / 100;

  // ── fonts (SIL OFL families bundled as WOFF; opentype.js reads the outlines) ──
  const FAM = {
    'anton': ['anton', [400]], 'bebas neue': ['bebas-neue', [400]], 'archivo black': ['archivo-black', [400]], 'abril fatface': ['abril-fatface', [400]],
    'inter': ['inter', [400, 700, 900], true], 'source sans 3': ['source-sans-3', [400, 700, 900], true], 'space grotesk': ['space-grotesk', [400, 700]], 'syne': ['syne', [400, 700]],
    'instrument serif': ['instrument-serif', [400], true], 'fraunces': ['fraunces', [400, 700, 900], true], 'playfair display': ['playfair-display', [400, 700, 900], true], 'dm serif display': ['dm-serif-display', [400], true],
    'jetbrains mono': ['jetbrains-mono', [400, 700], true], 'ibm plex mono': ['ibm-plex-mono', [400, 700], true], 'caveat': ['caveat', [400, 700]],
  };
  E.FONTS = Object.keys(FAM).map(k => k.replace(/\b\w/g, c => c.toUpperCase()));
  function famKey(name) {
    const n = String(name || 'Inter').toLowerCase().trim();
    if (FAM[n]) return n;
    const k = Object.keys(FAM).find(x => n.includes(x) || x.includes(n));
    if (k) return k;
    if (/mono|code|courier/.test(n)) return 'jetbrains mono';
    if (/serif|times|georgia|garamond|baskerville|caslon|didot|bodoni/.test(n) && !/sans/.test(n)) return /display|didot|bodoni/.test(n) ? 'playfair display' : 'fraunces';
    if (/condensed|impact|oswald|league|knockout|compressed/.test(n)) return 'anton';
    if (/hand|script|marker|brush/.test(n)) return 'caveat';
    if (/black|heavy|ultra/.test(n)) return 'archivo black';
    if (/grotesk|helvetica|neue|arial|sans|roboto|sf|system/.test(n)) return 'inter';
    return 'inter';
  }
  const FONT_CACHE = new Map();
  E.font = function (family, weight, style) {
    const k = famKey(family), [file, weights, italic] = FAM[k];
    const w = weights.reduce((a, b) => (Math.abs(b - (weight || 400)) < Math.abs(a - (weight || 400)) ? b : a), weights[0]);
    const st = style === 'italic' && italic ? 'italic' : 'normal';
    const key = `${file}-${w}-${st}`;
    if (FONT_CACHE.has(key)) return FONT_CACHE.get(key);
    const p = (async () => {
      const r = await fetch(`${E.base}fonts/${file}-latin-${w}-${st}.woff`);
      if (!r.ok) throw new Error(`font ${key} did not load`);
      return root.opentype.parse(await r.arrayBuffer());
    })();
    FONT_CACHE.set(key, p); p.catch(() => FONT_CACHE.delete(key));
    return p;
  };
  E.famKey = famKey;

  // ── SVG path data: parse to absolute segments, transform, measure, sample ──
  function parsePath(d) {
    const toks = String(d || '').match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
    const segs = []; let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, lc = null, lq = null;
    const num = () => +toks[i++];
    while (i < toks.length) {
      if (/[A-Za-z]/.test(toks[i])) cmd = toks[i++];
      const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
      const ax = v => (rel ? x + v : v), ay = v => (rel ? y + v : v);
      if (C === 'Z') { segs.push(['Z']); x = sx; y = sy; lc = lq = null; continue; }
      if (C === 'M') { x = ax(num()); y = ay(num()); sx = x; sy = y; segs.push(['M', x, y]); cmd = rel ? 'l' : 'L'; lc = lq = null; continue; }
      if (C === 'L') { x = ax(num()); y = ay(num()); segs.push(['L', x, y]); lc = lq = null; continue; }
      if (C === 'H') { x = rel ? x + num() : num(); segs.push(['L', x, y]); lc = lq = null; continue; }
      if (C === 'V') { y = rel ? y + num() : num(); segs.push(['L', x, y]); lc = lq = null; continue; }
      if (C === 'C') { const a = ax(num()), b = ay(num()), c = ax(num()), e = ay(num()); x = ax(num()); y = ay(num()); segs.push(['C', a, b, c, e, x, y]); lc = [c, e]; lq = null; continue; }
      if (C === 'S') { const a = lc ? 2 * x - lc[0] : x, b = lc ? 2 * y - lc[1] : y; const c = ax(num()), e = ay(num()); x = ax(num()); y = ay(num()); segs.push(['C', a, b, c, e, x, y]); lc = [c, e]; lq = null; continue; }
      if (C === 'Q') { const a = ax(num()), b = ay(num()); x = ax(num()); y = ay(num()); segs.push(['Q', a, b, x, y]); lq = [a, b]; lc = null; continue; }
      if (C === 'T') { const a = lq ? 2 * x - lq[0] : x, b = lq ? 2 * y - lq[1] : y; x = ax(num()); y = ay(num()); segs.push(['Q', a, b, x, y]); lq = [a, b]; lc = null; continue; }
      if (C === 'A') {
        let rx = Math.abs(num()), ry = Math.abs(num()); const phi = num() * Math.PI / 180, fa = num(), fs = num(); const x2 = ax(num()), y2 = ay(num());
        if (!rx || !ry) { segs.push(['L', x2, y2]); x = x2; y = y2; continue; }
        const cp = Math.cos(phi), sp = Math.sin(phi), dx = (x - x2) / 2, dy = (y - y2) / 2, x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
        let lam = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry); if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
        const sgn = fa === fs ? -1 : 1, co = sgn * Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p) / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
        const cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx, cx = cp * cxp - sp * cyp + (x + x2) / 2, cy = sp * cxp + cp * cyp + (y + y2) / 2;
        const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
        let t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry), dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
        if (!fs && dt > 0) dt -= 2 * Math.PI; if (fs && dt < 0) dt += 2 * Math.PI;
        const n = Math.ceil(Math.abs(dt) / (Math.PI / 2)), h = dt / n, k = 4 / 3 * Math.tan(h / 4);
        for (let s = 0; s < n; s++) { const a1 = t1 + s * h, a2 = a1 + h; const p = (a) => [cx + rx * Math.cos(a) * cp - ry * Math.sin(a) * sp, cy + rx * Math.cos(a) * sp + ry * Math.sin(a) * cp]; const d1 = (a) => [-rx * Math.sin(a) * cp - ry * Math.cos(a) * sp, -rx * Math.sin(a) * sp + ry * Math.cos(a) * cp]; const P1 = p(a1), P2 = p(a2), D1 = d1(a1), D2 = d1(a2); segs.push(['C', P1[0] + k * D1[0], P1[1] + k * D1[1], P2[0] - k * D2[0], P2[1] - k * D2[1], P2[0], P2[1]]); }
        x = x2; y = y2; lc = lq = null; continue;
      }
      i++;
    }
    return segs;
  }
  E.parsePath = parsePath;
  const segsToD = segs => segs.map(s => s[0] + (s.length > 1 ? s.slice(1).map(r3).join(' ') : '')).join('');
  E.segsToD = segsToD;
  function mapPts(segs, f) { return segs.map(s => { if (s[0] === 'Z') return s; const o = [s[0]]; for (let i = 1; i < s.length; i += 2) { const p = f(s[i], s[i + 1]); o.push(p[0], p[1]); } return o; }); }
  E.transformD = (d, m) => segsToD(mapPts(parsePath(d), (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]));
  function bounds(d) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const s of parsePath(d)) for (let i = 1; i < s.length; i += 2) { x0 = Math.min(x0, s[i]); x1 = Math.max(x1, s[i]); y0 = Math.min(y0, s[i + 1]); y1 = Math.max(y1, s[i + 1]); } return x0 === Infinity ? [0, 0, 0, 0] : [x0, y0, x1, y1]; }
  E.boundsD = bounds;
  // flatten to polylines (one per subpath) with cumulative lengths
  function flatten(d, tol) {
    const polys = []; let cur = null, x = 0, y = 0, sx = 0, sy = 0; const steps = tol || 12;
    for (const s of parsePath(d)) {
      if (s[0] === 'M') { cur = { pts: [[s[1], s[2]]], closed: false }; polys.push(cur); x = sx = s[1]; y = sy = s[2]; }
      else if (s[0] === 'L') { if (!cur) { cur = { pts: [[x, y]], closed: false }; polys.push(cur); } cur.pts.push([s[1], s[2]]); x = s[1]; y = s[2]; }
      else if (s[0] === 'C' || s[0] === 'Q') { if (!cur) { cur = { pts: [[x, y]], closed: false }; polys.push(cur); } const pts = s[0] === 'C' ? [[x, y], [s[1], s[2]], [s[3], s[4]], [s[5], s[6]]] : [[x, y], [s[1], s[2]], [s[3], s[4]]]; const len = Math.hypot(pts[pts.length - 1][0] - x, pts[pts.length - 1][1] - y) + Math.hypot(pts[1][0] - x, pts[1][1] - y); const n = Math.max(2, Math.min(64, Math.ceil(len / 6), steps * 4)); for (let k = 1; k <= n; k++) { const t = k / n, u = 1 - t; let px, py; if (s[0] === 'C') { px = u * u * u * pts[0][0] + 3 * u * u * t * pts[1][0] + 3 * u * t * t * pts[2][0] + t * t * t * pts[3][0]; py = u * u * u * pts[0][1] + 3 * u * u * t * pts[1][1] + 3 * u * t * t * pts[2][1] + t * t * t * pts[3][1]; } else { px = u * u * pts[0][0] + 2 * u * t * pts[1][0] + t * t * pts[2][0]; py = u * u * pts[0][1] + 2 * u * t * pts[1][1] + t * t * pts[2][1]; } cur.pts.push([px, py]); } x = s[s.length - 2]; y = s[s.length - 1]; }
      else if (s[0] === 'Z') { if (cur) { cur.closed = true; cur.pts.push([sx, sy]); } x = sx; y = sy; cur = null; }
    }
    for (const p of polys) { p.len = [0]; for (let i = 1; i < p.pts.length; i++) p.len.push(p.len[i - 1] + Math.hypot(p.pts[i][0] - p.pts[i - 1][0], p.pts[i][1] - p.pts[i - 1][1])); p.total = p.len[p.len.length - 1]; }
    return polys;
  }
  E.flatten = flatten;
  function sampler(d) {
    const polys = flatten(d).filter(p => p.total > 0); const total = polys.reduce((a, p) => a + p.total, 0);
    const at = s => {
      if (!polys.length) return { x: 0, y: 0, a: 0 };
      let rest = Math.max(0, Math.min(total, s));
      for (const p of polys) {
        if (rest <= p.total || p === polys[polys.length - 1]) {
          rest = Math.min(rest, p.total); let i = 1; while (i < p.len.length - 1 && p.len[i] < rest) i++;
          const a = p.pts[i - 1], b = p.pts[i], f = (rest - p.len[i - 1]) / ((p.len[i] - p.len[i - 1]) || 1);
          return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, a: Math.atan2(b[1] - a[1], b[0] - a[0]) };
        }
        rest -= p.total;
      }
      return { x: 0, y: 0, a: 0 };
    };
    const p0 = polys[0]; return { total, at, closed: polys.length === 1 && (p0.closed || Math.hypot(p0.pts[0][0] - p0.pts[p0.pts.length - 1][0], p0.pts[0][1] - p0.pts[p0.pts.length - 1][1]) < 0.5) };
  }
  E.sampler = sampler;
  const polyD = (pts, closed) => (pts.length ? 'M' + pts.map(p => r3(p[0]) + ' ' + r3(p[1])).join('L') + (closed ? 'Z' : '') : '');
  E.polyD = polyD;
  const circleD = (cx, cy, r) => { const k = 0.5523 * r; return `M${r3(cx + r)} ${r3(cy)}C${r3(cx + r)} ${r3(cy + k)} ${r3(cx + k)} ${r3(cy + r)} ${r3(cx)} ${r3(cy + r)}C${r3(cx - k)} ${r3(cy + r)} ${r3(cx - r)} ${r3(cy + k)} ${r3(cx - r)} ${r3(cy)}C${r3(cx - r)} ${r3(cy - k)} ${r3(cx - k)} ${r3(cy - r)} ${r3(cx)} ${r3(cy - r)}C${r3(cx + k)} ${r3(cy - r)} ${r3(cx + r)} ${r3(cy - k)} ${r3(cx + r)} ${r3(cy)}Z`; };
  E.circleD = circleD;
  const ellipseD = (cx, cy, rx, ry) => E.transformD(circleD(0, 0, 1), [rx, 0, 0, ry, cx, cy]);
  const rectD = (x, y, w, h, r) => { if (!r) return `M${r3(x)} ${r3(y)}H${r3(x + w)}V${r3(y + h)}H${r3(x)}Z`; r = Math.min(r, w / 2, h / 2); return `M${r3(x + r)} ${r3(y)}H${r3(x + w - r)}A${r} ${r} 0 0 1 ${r3(x + w)} ${r3(y + r)}V${r3(y + h - r)}A${r} ${r} 0 0 1 ${r3(x + w - r)} ${r3(y + h)}H${r3(x + r)}A${r} ${r} 0 0 1 ${r3(x)} ${r3(y + h - r)}V${r3(y + r)}A${r} ${r} 0 0 1 ${r3(x + r)} ${r3(y)}Z`; };
  E.rectD = rectD;
  const polygonD = (cx, cy, r, n, rot) => { const pts = []; for (let i = 0; i < n; i++) { const a = (rot || -Math.PI / 2) + (i * 2 * Math.PI) / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return polyD(pts, true); };
  const starD = (cx, cy, r, r2, n) => { const pts = []; for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + (i * Math.PI) / n, rr = i % 2 ? r2 : r; pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]); } return polyD(pts, true); };

  // ── vector wasm ──────────────────────────────────────────────────────
  const vc = (op, args, data) => E.wasmCall(VC, op, args, data);
  E.vc = vc;
  async function boolOp(a, b, op) { if (!a) return b || ''; if (!b) return a; return (await vc('boolean', { a, b, op })).msg.d; }
  E.boolOp = boolOp;

  // ── values ─────────────────────────────────────────────────────────────
  const DEF_ART = [800, 800];
  const shapesOf = (items, w, h, o) => E.shapes(w || DEF_ART[0], h || DEF_ART[1], items, o);
  function artboardFor(items, pad) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const it of items) if (it.d) { const b = bounds(it.d); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); } if (x0 === Infinity) return DEF_ART; pad = pad === undefined ? 40 : pad; return [Math.ceil(Math.max(x1 + pad, 100)), Math.ceil(Math.max(y1 + pad, 100))]; }
  E.artboardFor = artboardFor;
  E.asShapes = async function (v, X) {
    if (is(v, 'shapes')) return v;
    if (is(v, 'path')) return shapesOf([{ d: v.d, fill: v.fill || 'none', stroke: v.stroke || '#1d2733', sw: v.sw || 2 }], v.w || artboardFor([{ d: v.d }])[0], v.h || artboardFor([{ d: v.d }])[1]);
    if (is(v, 'text')) { const items = await textItems(v, X); return shapesOf(items, v.w || artboardFor(items)[0], v.h || artboardFor(items)[1]); }
    if (is(v, 'list')) { const all = []; let W = 0, H = 0; for (const x of v.items) { const s = await E.asShapes(x, X); all.push(...s.items); W = Math.max(W, s.w); H = Math.max(H, s.h); } return shapesOf(all, W, H); }
    if (is(v, ['image', 'mask', 'field'])) { const img = await X.img(v); return shapesOf([{ img, x: 0, y: 0, w: img.w / (img.u || 1), h: img.h / (img.u || 1) }], img.w / (img.u || 1), img.h / (img.u || 1)); }
    if (typeof v === 'string' || typeof v === 'number') return E.asShapes(E.mk('text', { text: String(v), font: { family: 'Inter', size: 32 } }), X);
    throw new Error(`a ${v && v.t || typeof v} value is not a shape`);
  };

  // ── text layout ────────────────────────────────────────────────────────
  function fontSpec(f) {
    if (typeof f === 'string') { const m = f.match(/^(.*?)\s+(\d+)(?:px)?$/); return m ? { family: m[1], size: +m[2] } : { family: f, size: 48 }; }
    return Object.assign({ family: 'Inter', size: 48 }, f || {});
  }
  E.fontSpec = fontSpec;
  // path data from opentype commands with our own number formatting (opentype.js's rounding yields NaN for some values)
  const fnum = v => { if (!isFinite(v)) return '0'; const t = (Math.round(v * 100) / 100).toFixed(2).replace(/\.?0+$/, ''); return t === '-0' ? '0' : t; };
  function pathData(p) {
    let d = '';
    for (const c of p.commands) {
      if (c.type === 'M' || c.type === 'L') d += c.type + fnum(c.x) + ' ' + fnum(c.y);
      else if (c.type === 'C') d += 'C' + fnum(c.x1) + ' ' + fnum(c.y1) + ' ' + fnum(c.x2) + ' ' + fnum(c.y2) + ' ' + fnum(c.x) + ' ' + fnum(c.y);
      else if (c.type === 'Q') d += 'Q' + fnum(c.x1) + ' ' + fnum(c.y1) + ' ' + fnum(c.x) + ' ' + fnum(c.y);
      else if (c.type === 'Z') d += 'Z';
    }
    return d;
  }
  E.glyphPathData = pathData;
  // glyph runs for one line: [{ path(d), x, adv, ch }]
  async function shapeLine(text, f) {
    const font = await E.font(f.family, f.weight, f.style), size = f.size || 48, scale = size / font.unitsPerEm, track = (f.tracking || 0) / 1000 * size;
    const chars = Array.from(String(text)), glyphs = chars.map(ch => font.charToGlyph(ch)); const out = []; let x = 0;
    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i]; const p = g.getPath(0, 0, size);
      out.push({ d: pathData(p), x, adv: g.advanceWidth * scale, ch: chars[i] });
      x += g.advanceWidth * scale + track;
      if (i < glyphs.length - 1 && f.kerning !== false) { try { x += font.getKerningValue(g, glyphs[i + 1]) * scale; } catch (e) { /* no kerning table */ } }
    }
    return { glyphs: out, width: Math.max(0, x - track), ascent: font.ascender * scale, descent: -font.descender * scale, font };
  }
  E.shapeLine = shapeLine;
  // a word's outline and advance from its glyphs (no GSUB: opentype.js cannot apply every lookup)
  E.wordPath = function (font, word, x, y, size) {
    const sc = size / font.unitsPerEm, chars = Array.from(word); let d = '', ax = x;
    for (let i = 0; i < chars.length; i++) { const g = font.charToGlyph(chars[i]); d += pathData(g.getPath(ax, y, size)); ax += g.advanceWidth * sc; if (i < chars.length - 1) { try { ax += font.getKerningValue(g, font.charToGlyph(chars[i + 1])) * sc; } catch (e) { /* no kerning */ } } }
    return { d, adv: ax - x };
  };
  E.measure = async (text, f) => (await shapeLine(text, fontSpec(f))).width;
  async function wrapLines(text, f, width) {
    const words = String(text).split(/\s+/).filter(Boolean); const lines = []; let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (!width || (await E.measure(t, f)) <= width || !cur) cur = t; else { lines.push(cur); cur = w; } }
    if (cur) lines.push(cur); return lines;
  }
  // a text value → shape items (glyph outlines placed in canvas units)
  async function textItems(v, X, canvas) {
    const f = fontSpec(v.font), fill = v.fill || f.color || f.fill || '#1d2733';
    const size = f.size || 48, lead = f.leading || size * 1.15;
    let lines = String(v.text == null ? '' : v.text).split('\n');
    if (f.width || v.width) { const out = []; for (const l of lines) out.push(...await wrapLines(l, f, f.width || v.width)); lines = out; }
    const runs = []; for (const l of lines) runs.push(await shapeLine(l, f));
    const items = [];
    const cw = canvas ? canvas[0] : 0, ch = canvas ? canvas[1] : 0;
    // anchor: v.at (point in units, or fractions of the canvas), default centre of the canvas
    let ax = cw / 2, ay = ch / 2;
    if (v.at) { const a = Array.isArray(v.at) ? v.at : [v.at.x || 0, v.at.y || 0]; ax = canvas && a[0] <= 1.5 && a[1] <= 1.5 ? a[0] * cw : a[0]; ay = canvas && a[0] <= 1.5 && a[1] <= 1.5 ? a[1] * ch : a[1]; }
    else if (!canvas) { ax = 0; ay = 0; }
    const align = f.align || (v.at || canvas ? 'center' : 'left');
    const total = runs.length * lead, n = runs.reduce((a, r) => a + r.glyphs.length, 0);
    let gi = 0;
    // text on a path
    if (v.onPath) {
      const S = sampler(v.onPath.d); const run = runs[0]; const off = (v.onPath.offset || 0) * S.total;
      const start = align === 'center' ? (S.total - run.width) / 2 + off : off;
      for (const g of run.glyphs) {
        const anim = v.animate ? await animProps(v.animate, gi, n, X) : null;
        let s = start + g.x + g.adv / 2 + (anim && anim.x || 0);
        if (S.closed && S.total > 0) s = ((s % S.total) + S.total) % S.total;   // a closed path has no ends: wrap past the seam
        else if (s < -g.adv || s > S.total + g.adv) { gi++; continue; }
        const p = S.at(s);
        const rot = p.a + ((anim && anim.rotation) || 0) * Math.PI / 180, dy = (anim && anim.y) || 0, sc = anim && anim.scale !== undefined ? anim.scale : 1;
        const m = [Math.cos(rot) * sc, Math.sin(rot) * sc, -Math.sin(rot) * sc, Math.cos(rot) * sc, 0, 0];
        const local = E.transformD(g.d, [1, 0, 0, 1, -g.adv / 2, dy]);
        items.push({ d: E.transformD(local, [m[0], m[1], m[2], m[3], p.x, p.y]), fill, opacity: anim && anim.opacity !== undefined ? clamp01(anim.opacity) : 1, glyph: g.ch });
        gi++;
      }
      return items;
    }
    for (let li = 0; li < runs.length; li++) {
      const run = runs[li];
      let x0 = align === 'center' ? ax - run.width / 2 : align === 'right' ? ax - run.width : ax;
      const base = (canvas || v.at ? ay - total / 2 + run.ascent * 0.92 : ay + run.ascent) + li * lead;
      if (!v.animate) { items.push({ d: run.glyphs.map(g => E.transformD(g.d, [1, 0, 0, 1, x0 + g.x, base])).join(''), fill, text: lines[li] }); gi += run.glyphs.length; continue; }
      for (const g of run.glyphs) {
        const anim = await animProps(v.animate, gi, n, X);
        const sc = anim.scale !== undefined ? anim.scale : 1, rot = (anim.rotation || 0) * Math.PI / 180;
        const cx = x0 + g.x + g.adv / 2 + (anim.x || 0), cy = base - run.ascent * 0.35 + (anim.y || 0);
        const local = E.transformD(g.d, [1, 0, 0, 1, -g.adv / 2, run.ascent * 0.35]);
        items.push({ d: E.transformD(local, [Math.cos(rot) * sc, Math.sin(rot) * sc, -Math.sin(rot) * sc, Math.cos(rot) * sc, cx, cy]), fill: anim.fill || fill, opacity: anim.opacity !== undefined ? clamp01(anim.opacity) : 1, glyph: g.ch });
        gi++;
      }
    }
    return items;
  }
  E.textItems = textItems;
  async function animProps(anim, i, n, X) {
    if (!X) return {};
    const props = anim.props || {};
    const sub = X.with({ exprScope: { textIndex: i, textTotal: n, index: i, seed: 7 } });
    const out = {};
    for (const [k, v] of Object.entries(props)) { const r = await sub.resolve(v); out[k] = typeof r === 'number' ? r : Array.isArray(r) ? r[0] : r; }
    // stagger: { delay } makes keys run later for later characters
    return out;
  }

  // ── rasterize shapes / paths / text ────────────────────────────────────
  E.rasterize = async function (v, W, H, X, opts) {
    opts = opts || {};
    if (is(v, 'pages')) return E.renderPages ? E.renderPages(v, W, H, X) : E.need('#ffffff', 'image', W, H);
    let art, items;
    if (is(v, 'text')) {
      const canvasU = opts.unitsPerPx ? [W * opts.unitsPerPx, H * opts.unitsPerPx] : null;
      const tv = opts.at && !v.at ? Object.assign({}, v, { at: opts.at }) : v;
      items = await textItems(tv, X, canvasU || (W && H ? null : null));
      if (canvasU) art = canvasU;
      else { const b = artboardFor(items, 0); const bb = items.reduce((a, it) => { const q = bounds(it.d); return [Math.min(a[0], q[0]), Math.min(a[1], q[1]), Math.max(a[2], q[2]), Math.max(a[3], q[3])]; }, [Infinity, Infinity, -Infinity, -Infinity]); const pad = (fontSpec(v.font).size || 48) * 0.3; items = items.map(it => Object.assign({}, it, { d: E.transformD(it.d, [1, 0, 0, 1, pad - bb[0], pad - bb[1]]) })); art = [bb[2] - bb[0] + pad * 2, bb[3] - bb[1] + pad * 2]; void b; }
    } else {
      const s = await E.asShapes(v, X); items = s.items; art = [s.w, s.h];
      if (s.background || opts.paper) items = [{ d: rectD(0, 0, s.w, s.h), fill: s.background || '#fbfaf6' }].concat(items);
    }
    if (!W || !H) { const [w, h] = E.fitSize(art[0], art[1]); W = w; H = h; }
    const sx = W / art[0], sy = H / art[1], sc = opts.unitsPerPx ? 1 / opts.unitsPerPx : Math.min(sx, sy);
    const c = E.canvas(W, H), g = c.getContext('2d');
    const ox = opts.unitsPerPx ? 0 : (W - art[0] * sc) / 2, oy = opts.unitsPerPx ? 0 : (H - art[1] * sc) / 2;
    g.setTransform(sc, 0, 0, sc, ox, oy);
    await drawItems(g, items, X, sc);
    const out = E.fromCanvas(c, { u: sc });
    return out;
  };
  async function drawItems(g, items, X, sc) {
    for (const it of items) {
      g.save();
      if (it.opacity !== undefined) g.globalAlpha = clamp01(it.opacity);
      if (it.blend && it.blend !== 'normal') g.globalCompositeOperation = { multiply: 'multiply', screen: 'screen', overlay: 'overlay', difference: 'difference', darken: 'darken', lighten: 'lighten', exclusion: 'exclusion' }[it.blend] || 'source-over';
      if (it.tf) g.transform(it.tf[0], it.tf[1], it.tf[2], it.tf[3], it.tf[4], it.tf[5]);
      if (it.img) { const im = await X.img(it.img); g.imageSmoothingQuality = 'high'; g.drawImage(E.toCanvas(im), it.x || 0, it.y || 0, it.w || im.w, it.h || im.h); }
      else if (it.items) await drawItems(g, it.items, X, sc);
      else if (it.d) {
        const p = new Path2D(it.d);
        if (it.fill && it.fill !== 'none') { g.fillStyle = paint(g, it.fill, it); g.fill(p, it.rule === 'evenodd' ? 'evenodd' : 'nonzero'); }
        if (it.stroke && it.stroke !== 'none') { g.strokeStyle = paint(g, it.stroke, it); g.lineWidth = it.sw || 1; g.lineJoin = it.join || 'round'; g.lineCap = it.cap || 'round'; if (it.dash) g.setLineDash([].concat(it.dash)); g.stroke(p); }
      }
      g.restore();
    }
  }
  function paint(g, f, it) {
    if (typeof f === 'string') return E.toHex(hex(f)) + (hex(f)[3] < 1 ? Math.round(hex(f)[3] * 255).toString(16).padStart(2, '0') : '');
    if (Array.isArray(f)) return E.toHex(hex(f));
    if (f && f.stops) { const b = it.d ? bounds(it.d) : [0, 0, 100, 100]; const gr = f.type === 'radial' ? g.createRadialGradient((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, 0, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2, Math.max(b[2] - b[0], b[3] - b[1]) / 2) : g.createLinearGradient(b[0], b[1], b[0], b[3]); E.stopsOf(f.stops).forEach(([t, c]) => gr.addColorStop(t, c)); return gr; }
    return '#000000';
  }
  // ── SVG export ─────────────────────────────────────────────────────────
  const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  E.toSVG = async function (v, X, o) {
    o = o || {};
    const s = await E.asShapes(v, X); const W = s.w, H = s.h;
    const pens = o.pens;
    let body = '';
    const penOf = new Map(), groups = pens ? pens.map(() => '') : null;
    for (const it of s.items) {
      if (it.img) { const im = await X.img(it.img); const blob = await E.toCanvas(im).convertToBlob({ type: 'image/png' }); const b64 = btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer()).slice(0, 0))) || ''; void b64; body += `<rect x="${r3(it.x || 0)}" y="${r3(it.y || 0)}" width="${r3(it.w || im.w)}" height="${r3(it.h || im.h)}" fill="#ccc"/>`; continue; }
      if (!it.d) continue;
      if (pens) {   // plotter: one pen per distinct source colour (in order of first use), grouped per pen so each pass plots one layer
        const key = E.toHex(hex(it.stroke && it.stroke !== 'none' ? it.stroke : it.fill && it.fill !== 'none' ? it.fill : '#000'));
        if (!penOf.has(key)) penOf.set(key, penOf.size % pens.length);
        const k = penOf.get(key), pc = typeof pens[k] === 'string' ? pens[k] : (pens[k] && pens[k].color) || '#000';
        groups[k] += `<path d="${xmlEsc(it.d)}" fill="none" stroke="${pc}" stroke-width="${r3(o.penWidth || 0.6)}" stroke-linecap="round" stroke-linejoin="round"/>`;
        continue;
      }
      const fill = it.fill && it.fill !== 'none' ? E.toHex(hex(it.fill)) : 'none';
      const stroke = it.stroke && it.stroke !== 'none' ? E.toHex(hex(it.stroke)) : null;
      body += `<path d="${xmlEsc(it.d)}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${r3(pens ? 0.6 : it.sw || 1)}" stroke-linecap="round" stroke-linejoin="round"` : ''}${it.dash ? ` stroke-dasharray="${[].concat(it.dash).join(' ')}"` : ''}${it.opacity !== undefined && it.opacity < 1 ? ` opacity="${r3(it.opacity)}"` : ''}/>`;
    }
    if (pens) body += groups.map((g, k) => (g ? `<g id="pen-${k + 1}" data-pen="${xmlEsc(typeof pens[k] === 'string' ? pens[k] : (pens[k] && pens[k].name) || k + 1)}">${g}</g>` : '')).join('');
    const size = o.size && o.units ? ` width="${o.size[0]}${o.units}" height="${o.size[1]}${o.units}"` : ` width="${W}" height="${H}"`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r3(W)} ${r3(H)}"${size}>${s.background ? `<rect width="100%" height="100%" fill="${E.toHex(hex(s.background))}"/>` : ''}${body}</svg>`;
  };

  // ── sources ────────────────────────────────────────────────────────────
  def('source.path', async (n, I, P) => { const d = String(P.d || ''); return E.path(d, { w: artboardFor([{ d }])[0], h: artboardFor([{ d }])[1] }); });
  def('source.shapes', async (n, I, P) => {
    // a small SVG subset: <path d>, <circle>, <rect>, <ellipse>, <polygon> with fill/stroke
    const svg = String(P.svg || P.src || ''); const items = [];
    const attr = (t, k) => { const m = t.match(new RegExp(`\\b${k}="([^"]*)"`)); return m ? m[1] : null; };
    for (const m of svg.matchAll(/<(path|circle|rect|ellipse|polygon|line)\b[^>]*>/g)) {
      const t = m[0], tag = m[1]; let d = null;
      if (tag === 'path') d = attr(t, 'd'); else if (tag === 'circle') d = circleD(+attr(t, 'cx') || 0, +attr(t, 'cy') || 0, +attr(t, 'r') || 0); else if (tag === 'rect') d = rectD(+attr(t, 'x') || 0, +attr(t, 'y') || 0, +attr(t, 'width') || 0, +attr(t, 'height') || 0, +attr(t, 'rx') || 0); else if (tag === 'ellipse') d = ellipseD(+attr(t, 'cx') || 0, +attr(t, 'cy') || 0, +attr(t, 'rx') || 0, +attr(t, 'ry') || 0); else if (tag === 'polygon') d = polyD((attr(t, 'points') || '').trim().split(/[\s,]+/).map(Number).reduce((a, v, i, arr) => (i % 2 ? a : a.concat([[v, arr[i + 1]]])), []), true); else if (tag === 'line') d = `M${attr(t, 'x1')} ${attr(t, 'y1')}L${attr(t, 'x2')} ${attr(t, 'y2')}`;
      if (d) items.push({ d, fill: attr(t, 'fill') || (tag === 'line' ? 'none' : '#1d2733'), stroke: attr(t, 'stroke'), sw: +(attr(t, 'stroke-width') || 1) });
    }
    const vb = (svg.match(/viewBox="([^"]+)"/) || [])[1];
    const [w, h] = vb ? vb.split(/[\s,]+/).slice(2).map(Number) : artboardFor(items);
    return shapesOf(items, w, h);
  });
  const dv = (v, d) => (v === undefined || v === null || (typeof v === 'number' && !isFinite(v)) ? d : v);   // 0 is a value, not 'missing'
  const ptOf = v => (Array.isArray(v) ? v : v && typeof v === 'object' ? (v.center || [v.x || 0, v.y || 0]) : [400, 400]);
  def('source.circle', async (n, I, P, X) => { const c = ptOf(I.center !== undefined ? I.center : P.center || [400, 400]); const r = await E.need(I.r !== undefined ? I.r : P.r === undefined ? 100 : P.r, 'number', 0, 0, X); return shapesOf([{ d: circleD(c[0], c[1], Math.max(0, r)), fill: P.fill || '#1d2733' }]); });
  def(['source.rect', 'source.ellipse', 'source.polygon', 'source.star', 'source.line'], async (n, I, P) => {
    const k = n.op.slice(7); let d;
    if (k === 'rect') { const b = P.box || [dv(P.x, 100), dv(P.y, 100), dv(P.w, 300), dv(P.h, 200)]; d = rectD(b[0], b[1], Math.max(0, b[2]), Math.max(0, b[3]), dv(P.r, P.radius || 0)); }
    else if (k === 'ellipse') { const c = ptOf(P.center || [400, 400]); d = ellipseD(c[0], c[1], dv(P.rx, 200), dv(P.ry, 120)); }
    else if (k === 'polygon') { const c = ptOf(P.center || [400, 400]); d = polygonD(c[0], c[1], dv(P.r, 200), P.sides || P.n || 6, P.rotation); }
    else if (k === 'star') { const c = ptOf(P.center || [400, 400]); d = starD(c[0], c[1], dv(P.r, 200), dv(P.inner, dv(P.r, 200) * 0.45), P.points || P.n || 5); }
    else { const a = P.from || [100, 400], b = P.to || [700, 400]; d = `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`; return shapesOf([{ d, fill: 'none', stroke: P.stroke || '#1d2733', sw: dv(P.width, 2) }]); }
    return shapesOf([{ d, fill: P.fill || '#1d2733', stroke: P.stroke, sw: P.width }]);
  });
  def('source.group', async (n, I, P, X) => { const items = []; let W = 0, H = 0; for (const k of Object.keys(n.in || {}).sort((a, b) => +a.slice(1) - +b.slice(1))) { const s = await E.asShapes(I[k], X); items.push(...s.items); W = Math.max(W, s.w); H = Math.max(H, s.h); } const art = items.length ? [Math.max(W, DEF_ART[0]), Math.max(H, DEF_ART[1])] : DEF_ART; return shapesOf(items, art[0], art[1]); });
  def('source.text', async (n, I, P, X) => {
    let t = P.text; if (t && t[E.K]) t = is(t, 'list') ? t.items.join(' ') : t.v !== undefined ? t.v : String(E.describe(t).kind);
    if (typeof t === 'number') t = Math.round(t * 100) / 100;
    const f = fontSpec(P.font);
    return E.mk('text', { text: t == null ? '' : String(t), font: f, fill: f.color || f.fill || P.fill });
  });
  def(['text.at', 'shapes.at', 'path.at', '*.at'], async (n, I, P, X) => {
    const v = I.src; const at = I.point !== undefined ? I.point : P.point;
    const pt = Array.isArray(at) ? at : at && typeof at === 'object' ? (at.center || [at.x, at.y]) : [0.5, 0.5];
    if (is(v, 'text')) return Object.assign({}, v, { at: pt });
    if (is(v, ['shapes', 'path'])) { const s = await E.asShapes(v, X); const b = s.items.reduce((a, it) => { const q = it.d ? bounds(it.d) : [0, 0, 0, 0]; return [Math.min(a[0], q[0]), Math.min(a[1], q[1]), Math.max(a[2], q[2]), Math.max(a[3], q[3])]; }, [Infinity, Infinity, -Infinity, -Infinity]); const dx = pt[0] - (b[0] + b[2]) / 2, dy = pt[1] - (b[1] + b[3]) / 2; return shapesOf(s.items.map(it => (it.d ? Object.assign({}, it, { d: E.transformD(it.d, [1, 0, 0, 1, dx, dy]) }) : it)), s.w, s.h); }
    return Object.assign({}, v, { at: pt });
  });
  def('text.onPath', async (n, I, P) => { const p = I.path || P.path; return Object.assign({}, I.src, { onPath: { d: p && p.d ? p.d : String(p || ''), offset: +(P.offset || 0) } }); });
  def('text.animate', async (n, I, P) => Object.assign({}, I.src, { animate: { by: n.params.by || 'char', props: n.params.props || {} } }), { rawParams: true, time: true });
  def(['text.style', 'text.font'], async (n, I, P) => Object.assign({}, I.src, { font: Object.assign({}, I.src.font, P) }));
  def(['text.fill', 'text.color'], async (n, I, P) => Object.assign({}, I.src, { fill: P.paint || P.color || P.arg0 || '#000' }));
  def('text.toPaths', async (n, I, P, X) => { const items = await textItems(I.src, X); return E.path(items.map(i => i.d).join(''), { w: artboardFor(items)[0], h: artboardFor(items)[1] }); });

  // ── paths ──────────────────────────────────────────────────────────────
  const dOf = async (v, X) => { if (v == null) return ''; if (typeof v === 'string') return v; if (is(v, 'path')) return v.d; if (is(v, 'shapes')) return v.items.filter(i => i.d).map(i => i.d).join(''); if (is(v, 'text')) return (await textItems(v, X)).map(i => i.d).join(''); if (is(v, 'list')) { let s = ''; for (const x of v.items) s += await dOf(x, X); return s; } return ''; };
  E.dOf = dOf;
  const keepArt = (src, d) => E.path(d, { w: src && src.w, h: src && src.h });
  for (const [k, op] of [['union', 'union'], ['subtract', 'difference'], ['intersect', 'intersect'], ['exclude', 'xor']]) {
    def(['path.' + k, 'shapes.' + k], async (n, I, P, X) => {
      const a = await dOf(I.src, X), other = I.other !== undefined ? I.other : P.other;
      if (other === undefined || other === null) { const r = await vc('unite', { paths: [a] }); return keepArt(I.src, r.msg.d); }
      const b = await dOf(other, X); return keepArt(I.src, await boolOp(a, b, op));
    });
  }
  def(['path.offset', 'shapes.offset'], async (n, I, P, X) => { const d = await dOf(I.src, X); const r = await vc('offset', { d, delta: +(P.d === undefined ? 4 : P.d), join: P.join || 'round', miter: 4 }); return keepArt(I.src, r.msg.d); });
  def(['path.outline', 'shapes.outline'], async (n, I, P, X) => { const d = await dOf(I.src, X); const st = P.stroke || P; const r = await vc('outline', { d, width: +(st.width || st.w || 4), cap: st.cap || 'round', join: st.join || 'round' }); return keepArt(I.src, r.msg.d); });
  def(['path.simplify', 'shapes.simplify'], async (n, I, P, X) => {
    const tol = +(P.tolerance === undefined ? 0.5 : P.tolerance);
    if (is(I.src, 'shapes')) { const items = []; for (const it of I.src.items) { if (!it.d) { items.push(it); continue; } try { const r = await vc('simplify', { d: it.d, tolerance: tol }); items.push(Object.assign({}, it, { d: r.msg.d })); } catch (e) { items.push(it); } } return Object.assign({}, I.src, { items }); }
    const r = await vc('simplify', { d: await dOf(I.src, X), tolerance: tol }); return keepArt(I.src, r.msg.d);
  });
  def(['path.roundCorners', 'shapes.roundCorners'], async (n, I, P, X) => { const r = await vc('roundCorners', { d: await dOf(I.src, X), radius: +(P.radius || P.r || 12), kind: P.kind || 'round' }); return keepArt(I.src, r.msg.d); });
  def(['path.measure', 'shapes.measure'], async (n, I, P, X) => (await vc('measure', { d: await dOf(I.src, X) })).msg);
  def(['path.pathfinder', 'shapes.pathfinder', 'shapes.divide'], async (n, I, P, X) => {
    const s = await E.asShapes(I.src, X); const op = P.op || (n.op.endsWith('divide') ? 'divide' : 'divide');
    const r = await vc('pathfinder', { paths: s.items.filter(i => i.d).map(i => i.d), op });
    const src = s.items.filter(i => i.d); return shapesOf(r.msg.shapes.map(x => Object.assign({}, src[x.source] || {}, { d: x.d })), s.w, s.h);
  });
  function resamplePoly(d, N) { const S = sampler(d); const pts = []; for (let i = 0; i < N; i++) { const p = S.at((i / N) * S.total); pts.push([p.x, p.y, p.a]); } return pts; }
  def(['path.roughen', 'shapes.roughen'], async (n, I, P, X) => {
    const size = +(P.size === undefined ? 4 : P.size), det = Math.max(1, +(P.detail === undefined ? 20 : P.detail)), seed = P.seed || 3;
    const rough = d => flatten(d).map((p, pi) => { if (p.total <= 0) return ''; const N = Math.max(8, Math.round(p.total / 100 * det)); const pts = []; for (let i = 0; i < N; i++) { const s = (i / N) * p.total; let k = 1; while (k < p.len.length - 1 && p.len[k] < s) k++; const a = p.pts[k - 1], b = p.pts[k], f = (s - p.len[k - 1]) / ((p.len[k] - p.len[k - 1]) || 1); pts.push([a[0] + (b[0] - a[0]) * f + (E.hash2(i, pi, seed) - 0.5) * 2 * size, a[1] + (b[1] - a[1]) * f + (E.hash2(i, pi + 99, seed) - 0.5) * 2 * size]); } return polyD(pts, p.closed); }).join('');
    if (is(I.src, 'shapes')) return Object.assign({}, I.src, { items: I.src.items.map(it => (it.d ? Object.assign({}, it, { d: rough(it.d) }) : it)) });
    return keepArt(I.src, rough(await dOf(I.src, X)));
  });
  def(['path.zigzag', 'shapes.zigzag'], async (n, I, P, X) => {
    const size = +(P.size === undefined ? 4 : P.size), ridges = Math.max(1, +(P.ridges === undefined ? 10 : P.ridges)), smooth = !!P.smooth;
    const zz = d => flatten(d).map(p => { if (p.total <= 0) return ''; const N = Math.max(4, Math.round(p.total / 100 * ridges * 2)); const pts = []; for (let i = 0; i <= N; i++) { const s = (i / N) * p.total; let k = 1; while (k < p.len.length - 1 && p.len[k] < s) k++; const a = p.pts[k - 1], b = p.pts[k], f = (s - p.len[k - 1]) / ((p.len[k] - p.len[k - 1]) || 1), ang = Math.atan2(b[1] - a[1], b[0] - a[0]); const o = (i % 2 ? 1 : -1) * size; pts.push([a[0] + (b[0] - a[0]) * f - Math.sin(ang) * o, a[1] + (b[1] - a[1]) * f + Math.cos(ang) * o]); } return smooth ? polyD(pts, p.closed) : polyD(pts, p.closed); }).join('');
    if (is(I.src, 'shapes')) return Object.assign({}, I.src, { items: I.src.items.map(it => (it.d ? Object.assign({}, it, { d: zz(it.d) }) : it)) });
    return keepArt(I.src, zz(await dOf(I.src, X)));
  });
  def(['path.morph', 'shapes.morph'], async (n, I, P, X) => { const a = await dOf(I.src, X), b = await dOf(I.to || P.to, X), t = clamp01(+(P.t === undefined ? 0.5 : P.t)), N = 160; const A = resamplePoly(a, N), B = resamplePoly(b, N); let best = 0, bd = Infinity; for (let s = 0; s < N; s += 4) { let dd = 0; for (let i = 0; i < N; i += 8) { const q = B[(i + s) % N]; dd += (A[i][0] - q[0]) ** 2 + (A[i][1] - q[1]) ** 2; } if (dd < bd) { bd = dd; best = s; } } return keepArt(I.src, polyD(A.map((p, i) => { const q = B[(i + best) % N]; return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; }), true)); });
  def(['path.fill', 'shapes.fill'], async (n, I, P, X) => {
    let paint = I.paint !== undefined ? await I.paint : (P.paint || P.color || P.fill || '#1d2733');
    if (paint && paint[E.K]) paint = paint.colors ? paint.colors.map(c => (typeof c === 'string' ? c : c.hex || E.toHex(E.hex(c)))) : paint.v !== undefined ? paint.v : paint.hex || '#1d2733';
    if (is(I.src, 'shapes')) { const pal = Array.isArray(paint) && typeof paint[0] !== 'number' ? paint : null; return Object.assign({}, I.src, { items: I.src.items.map((it, i) => (it.d ? Object.assign({}, it, { fill: pal ? pal[i % pal.length] : paint }) : it)) }); }
    const d = await dOf(I.src, X); return shapesOf([{ d, fill: paint, rule: P.rule }], I.src.w || artboardFor([{ d }])[0], I.src.h || artboardFor([{ d }])[1]);
  });
  def(['path.stroke', 'shapes.stroke', 'text.stroke'], async (n, I, P, X) => {
    const st = P.style || P; const mk = d => ({ d, fill: 'none', stroke: st.color || st.paint || st.stroke || '#1d2733', sw: +(st.width || st.w || 2), dash: st.dash, cap: st.cap, join: st.join, opacity: st.opacity });
    if (is(I.src, 'shapes')) return Object.assign({}, I.src, { items: I.src.items.map(it => (it.d ? Object.assign({}, it, mk(it.d), { fill: st.keepFill ? it.fill : 'none' }) : it)) });
    const d = await dOf(I.src, X); const art = artboardFor([{ d }]); return shapesOf([mk(d)], I.src.w || art[0], I.src.h || art[1]);
  });
  def(['path.pointAt', 'shapes.pointAt'], async (n, I, P, X) => { const S = sampler(await dOf(I.src, X)); const p = S.at(clamp01(+(P.t || 0)) * S.total); return [p.x, p.y]; });
  def(['path.reverse'], async (n, I, P, X) => keepArt(I.src, flatten(await dOf(I.src, X)).map(p => polyD(p.pts.slice().reverse(), p.closed)).join('')));
  def(['path.transform', 'shapes.transform', 'path.scale', 'shapes.scale', 'path.rotate', 'shapes.rotate', 'path.move', 'shapes.move'], async (n, I, P, X) => {
    let m = Array.isArray(P.m) ? P.m : null; const s = await E.asShapes(I.src, X); const cx = s.w / 2, cy = s.h / 2;
    if (!m) { const k = n.op.split('.')[1]; if (k === 'scale') { const f = +(P.k || P.by || P.arg0 || 1); m = [f, 0, 0, f, cx - f * cx, cy - f * cy]; } else if (k === 'rotate') { const a = (+(P.deg || P.angle || P.arg0 || 0)) * Math.PI / 180, c = Math.cos(a), si = Math.sin(a); m = [c, si, -si, c, cx - c * cx + si * cy, cy - si * cx - c * cy]; } else { const o = P.by || P.offset || [P.x || 0, P.y || 0]; m = [1, 0, 0, 1, o[0], o[1]]; } }
    const items = s.items.map(it => (it.d ? Object.assign({}, it, { d: E.transformD(it.d, m) }) : it));
    return is(I.src, 'path') ? keepArt(I.src, items.map(i => i.d).join('')) : shapesOf(items, s.w, s.h);
  });
  def(['path.repeat', 'shapes.repeat'], async (n, I, P, X) => {
    const s = await E.asShapes(I.src, X), count = Math.max(1, Math.min(200, Math.round(P.n || P.count || 6))), mode = P.mode || 'radial', items = [], cx = (P.center || [s.w / 2, s.h / 2])[0], cy = (P.center || [s.w / 2, s.h / 2])[1];
    for (let k = 0; k < count; k++) {
      let m;
      if (mode === 'radial') { const a = (k / count) * 2 * Math.PI, c = Math.cos(a), si = Math.sin(a); m = [c, si, -si, c, cx - c * cx + si * cy, cy - si * cx - c * cy]; }
      else if (mode === 'grid') { const cols = P.cols || Math.ceil(Math.sqrt(count)); m = [1, 0, 0, 1, (k % cols) * dv(P.dx, 80), Math.floor(k / cols) * dv(P.dy, 80)]; }
      else { const f = Math.pow(P.scale === undefined ? 0.85 : P.scale, k), a = (P.rotate || 8) * k * Math.PI / 180, c = Math.cos(a) * f, si = Math.sin(a) * f; m = [c, si, -si, c, cx - c * cx + si * cy, cy - si * cx - c * cy]; }
      for (const it of s.items) if (it.d) items.push(Object.assign({}, it, { d: E.transformD(it.d, m), fill: Array.isArray(P.fills) ? P.fills[k % P.fills.length] : it.fill, stroke: Array.isArray(P.strokes) ? P.strokes[k % P.strokes.length] : it.stroke }));
    }
    return shapesOf(items, s.w, s.h);
  });
  def(['shapes.add', 'path.add', 'text.add'], async (n, I, P, X) => {
    const a = await E.asShapes(I.src, X); const other = I.other !== undefined ? I.other : P.other;
    if (other == null) return a;
    let b;
    if (is(other, 'text')) { const items = await textItems(other, X, other.at ? null : [a.w, a.h]); b = shapesOf(items, a.w, a.h); }
    else b = await E.asShapes(other, X);
    return shapesOf(a.items.concat(b.items), Math.max(a.w, b.w), Math.max(a.h, b.h), { background: a.background });
  });
  def('shapes.select', async (n, I, P, X) => {
    const s = await E.asShapes(I.src, X); let items = s.items.filter(i => i.d);
    if (P.fill) {
      const want = hex(P.fill), nearest = String(P.fill).startsWith('nearest:');
      const dist = it => { const c = hex(it.fill || '#000'); return (c[0] - want[0]) ** 2 + (c[1] - want[1]) ** 2 + (c[2] - want[2]) ** 2; };
      if (nearest) { const best = Math.min(...items.map(dist)); items = items.filter(it => dist(it) <= best + 1e-6); } else items = items.filter(it => dist(it) < 0.002);
    }
    if (P.largest) items = items.map(it => [it, (() => { const b = bounds(it.d); return (b[2] - b[0]) * (b[3] - b[1]); })()]).sort((a, b) => b[1] - a[1]).slice(0, P.largest === true ? 1 : P.largest).map(x => x[0]);
    if (P.index !== undefined) items = [items[P.index]].filter(Boolean);
    return E.path(items.map(i => i.d).join(''), { w: s.w, h: s.h });
  });
  def('shapes.background', async (n, I, P, X) => Object.assign({}, await E.asShapes(I.src, X), { background: P.color || P.paint || P.arg0 || '#ffffff' }));
  def('shapes.orderForPlotter', async (n, I, P, X) => {
    const s = await E.asShapes(I.src, X); const items = s.items.filter(i => i.d); const left = items.map(it => { const pl = flatten(it.d)[0]; return { it, a: pl ? pl.pts[0] : [0, 0], b: pl ? pl.pts[pl.pts.length - 1] : [0, 0] }; });
    const out = []; let at = [0, 0], travel0 = 0, travel1 = 0; let prev = [0, 0];
    for (const x of left) { travel0 += Math.hypot(x.a[0] - prev[0], x.a[1] - prev[1]); prev = x.b; }
    while (left.length) { let bi = 0, bd = Infinity, rev = false; left.forEach((x, i) => { const d1 = Math.hypot(x.a[0] - at[0], x.a[1] - at[1]), d2 = Math.hypot(x.b[0] - at[0], x.b[1] - at[1]); if (d1 < bd) { bd = d1; bi = i; rev = false; } if (d2 < bd) { bd = d2; bi = i; rev = true; } }); const x = left.splice(bi, 1)[0]; travel1 += bd; out.push(rev ? Object.assign({}, x.it, { d: flatten(x.it.d).map(p => polyD(p.pts.slice().reverse(), p.closed)).join('') }) : x.it); at = rev ? x.a : x.b; }
    X.note(`pen-up travel ${Math.round(travel0)} → ${Math.round(travel1)} units`);
    return shapesOf(out, s.w, s.h, { background: s.background });
  });
  def('shapes.grid', async (n, I, P, X) => {
    const cols = P.cols || 2, rows = P.rows || 2, items = []; let W = DEF_ART[0], H = DEF_ART[1];
    if (is(I.src, 'shapes') && I.src.items.length) { W = I.src.w; H = I.src.h; items.push(...I.src.items); }
    if (Array.isArray(P.size)) [W, H] = P.size;
    for (let i = 0; i < cols * rows; i++) { const v = I['c' + i]; if (v == null) continue; const s = is(v, 'text') ? shapesOf(await textItems(v, X, [W, H]), W, H) : await E.asShapes(v, X); items.push(...s.items); }
    return shapesOf(items, W, H, { background: P.background });
  });
  def('layout.cell', async (n, I, P, X) => {
    const g = E.P.byId.get(P.grid); const gp = g ? await X.resolve(g.params) : {}; const cols = P.cols || gp.cols || 2, rows = P.rows || gp.rows || 2;
    const src = g && g.in && g.in.src ? await X.eval(g.in.src) : null;
    const [W, H] = Array.isArray(gp.size) ? gp.size : src && is(src, 'shapes') && src.items.length ? [src.w, src.h] : DEF_ART;
    const gap = gp.gap === undefined ? 0 : gp.gap, cw = (W - gap * (cols - 1)) / cols, ch = (H - gap * (rows - 1)) / rows, x = P.col * (cw + gap), y = P.row * (ch + gap), pad = Math.min(cw, ch) * 0.1;
    return { index: P.index, col: P.col, row: P.row, x, y, w: cw, h: ch, box: [x, y, cw, ch], center: [x + cw / 2, y + ch / 2], top: [x + cw / 2, y + pad], bottom: [x + cw / 2, y + ch - pad], left: [x + pad, y + ch / 2], right: [x + cw - pad, y + ch / 2], size: [cw, ch] };
  });
  def(['shapes.blend', 'path.blend'], async (n, I, P, X) => {
    const a = await E.asShapes(I.src, X), b = await E.asShapes(I.to || P.to, X), steps = Math.max(1, Math.min(200, Math.round(P.steps || 8))), N = 120;
    const ia = a.items.find(i => i.d), ib = b.items.find(i => i.d); if (!ia || !ib) return a;
    const A = resamplePoly(ia.d, N), B = resamplePoly(ib.d, N), ca = hex(ia.fill || ia.stroke || '#000'), cb = hex(ib.fill || ib.stroke || '#000');
    const items = [];
    for (let s = 0; s <= steps + 1; s++) { const t = s / (steps + 1); items.push({ d: polyD(A.map((p, i) => [p[0] + (B[i][0] - p[0]) * t, p[1] + (B[i][1] - p[1]) * t]), true), fill: ia.fill && ia.fill !== 'none' ? E.toHex(ca.map((v, k) => v + (cb[k] - v) * t)) : 'none', stroke: ia.stroke ? E.toHex(ca.map((v, k) => v + (cb[k] - v) * t)) : undefined, sw: ia.sw }); }
    return shapesOf(items, Math.max(a.w, b.w), Math.max(a.h, b.h));
  });
  def(['shapes.rasterize', 'path.rasterize', 'text.rasterize', 'text.toImage', 'shapes.toImage', 'path.toImage'], async (n, I, P, X) => { const sz = P.size || P.w; let W = 0, H = 0; if (Array.isArray(sz)) [W, H] = E.fitSize(sz[0], sz[1]); return E.rasterize(I.src, W, H, X); });
  def(['shapes.toPath', 'text.toPath'], async (n, I, P, X) => E.path(await dOf(I.src, X)));
  def(['shapes.count', 'path.count'], async (n, I, P, X) => (is(I.src, 'shapes') ? I.src.items.length : 1));

  // ── raster → vector ────────────────────────────────────────────────────
  def(['image.trace', 'clip.trace', 'mask.trace'], async (n, I, P, X) => {
    let img = await X.img(I.src); if (img.w * img.h > 360000) { const k = Math.sqrt(360000 / (img.w * img.h)); img = E.resample(img, Math.round(img.w * k), Math.round(img.h * k)); }
    const u8 = E.toU8(img), colors = Math.max(1, Math.round(P.colors || 6)), detail = P.detail === undefined ? 0.5 : +P.detail, smooth = P.smooth === undefined ? 0.5 : +P.smooth;
    let tp;
    if (P.preset) {   // a named VectorCraft preset: send only what the program set explicitly, laid over the preset
      tp = Object.assign({}, P.params || {});
      if (P.colors !== undefined) tp.colors = Math.max(2, colors);
      if (P.detail !== undefined) { tp.paths = Math.round(20 + detail * 75); tp.noise = Math.round(4 + (1 - detail) * 40); }
      if (P.smooth !== undefined) tp.corners = Math.round(90 - smooth * 70);
      if (P.ignoreWhite !== undefined) tp.ignoreWhite = !!P.ignoreWhite;
      if (P.strokeWidth !== undefined) tp.strokeWidth = P.strokeWidth;
    } else {
      tp = Object.assign({ mode: colors <= 2 ? 'blackAndWhite' : 'color', palette: 'limited', colors: Math.max(2, colors), paths: Math.round(20 + detail * 75), corners: Math.round(90 - smooth * 70), noise: Math.round(4 + (1 - detail) * 40), snapCurvesToLines: false, ignoreWhite: !!P.ignoreWhite }, P.params || {});
      if (P.mode === 'centerline' || P.mode === 'lines') Object.assign(tp, { strokes: true, fills: false, strokeWidth: P.strokeWidth || 6, mode: 'blackAndWhite' });
    }
    const r = await vc('trace', Object.assign({ w: img.w, h: img.h, params: tp, maxAnchors: 60000 }, P.preset ? { preset: P.preset } : {}), u8);
    const s = 1 / (img.u || 1);
    const items = r.msg.paths.map(p => ({ d: s === 1 ? p.d : E.transformD(p.d, [s, 0, 0, s, 0, 0]), fill: p.fill || 'none', stroke: p.stroke ? p.color || '#000' : undefined, sw: p.stroke ? p.stroke * s : undefined }));
    X.note(`traced ${items.length} paths, ${r.msg.anchors} anchors, ${r.msg.palette.length} colours${P.preset ? ` (preset '${P.preset}')` : ''}`);
    return shapesOf(items, img.w * s, img.h * s, { palette: r.msg.palette });
  });
  def(['mask.toPath'], async (n, I, P, X) => {
    const m = await X.need(I.src, 'mask'); const u8 = new Uint8ClampedArray(m.w * m.h * 4); for (let i = 0; i < m.w * m.h; i++) { const v = m.d[i] > 0.5 ? 0 : 255; u8[i * 4] = u8[i * 4 + 1] = u8[i * 4 + 2] = v; u8[i * 4 + 3] = 255; }
    const r = await vc('trace', { w: m.w, h: m.h, params: { mode: 'blackAndWhite', threshold: 128, paths: 70, corners: 60, noise: 12, ignoreWhite: true } }, u8); const s = 1 / (m.u || 1);
    const d = r.msg.paths.filter(p => p.fill && p.fill !== '#ffffff').map(p => p.d).join('');
    return E.path(s === 1 ? d : E.transformD(d, [s, 0, 0, s, 0, 0]), { w: m.w * s, h: m.h * s });
  });
  // marching squares over a field: iso-lines at each level, joined into polylines
  def(['field.contours', 'image.contours', 'mask.contours'], async (n, I, P, X) => {
    let f = await X.need(I.src, 'field'); if (f.ch > 1) { const o = E.field(f.w, f.h, 1); for (let i = 0; i < f.w * f.h; i++) o.d[i] = f.d[i * f.ch + (f.ch > 1 ? 1 : 0)]; o.u = f.u; f = o; }
    let levels = I.levels !== undefined ? await I.levels : P.levels; if (levels && levels[E.K] && levels.t === 'list') levels = levels.items; if (is(levels, 'list')) levels = levels.items;
    if (Array.isArray(levels)) levels = levels.map(v => (typeof v === 'number' ? v : v && v[E.K] && typeof v.v === 'number' ? v.v : +v)).filter(v => isFinite(v)); if (levels && levels[E.K] && levels.t === 'json') levels = levels.v;
    if (!Array.isArray(levels)) { const k = typeof levels === 'number' ? levels : 6; levels = Array.from({ length: k }, (_, i) => (i + 1) / (k + 1)); }
    const W = f.w, H = f.h, d = f.d, s = 1 / (f.u || 1), items = [];
    const pens = P.colors || ['#1f2a6b', '#c2187a', '#2f6f9b', '#f2b84b'];
    levels.forEach((lv, li) => {
      const segs = [];
      for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
        const a = d[y * W + x], b = d[y * W + x + 1], c = d[(y + 1) * W + x + 1], e = d[(y + 1) * W + x];
        const idx = (a > lv ? 8 : 0) | (b > lv ? 4 : 0) | (c > lv ? 2 : 0) | (e > lv ? 1 : 0); if (idx === 0 || idx === 15) continue;
        const t = (p, q) => (lv - p) / ((q - p) || 1e-9);
        const T = [x + t(a, b), y], R = [x + 1, y + t(b, c)], B = [x + t(e, c), y + 1], L = [x, y + t(a, e)];
        const tab = { 1: [[L, B]], 2: [[B, R]], 3: [[L, R]], 4: [[T, R]], 5: [[L, T], [B, R]], 6: [[T, B]], 7: [[L, T]], 8: [[L, T]], 9: [[T, B]], 10: [[T, R], [L, B]], 11: [[T, R]], 12: [[L, R]], 13: [[B, R]], 14: [[L, B]] }[idx];
        for (const sg of tab) segs.push(sg);
      }
      // join segments into polylines
      const key = p => `${Math.round(p[0] * 8)},${Math.round(p[1] * 8)}`, map = new Map();
      segs.forEach((sg, i) => { for (const e of [0, 1]) { const k = key(sg[e]); (map.get(k) || map.set(k, []).get(k)).push(i); } });
      const used = new Uint8Array(segs.length);
      for (let i = 0; i < segs.length; i++) {
        if (used[i]) continue; used[i] = 1; const line = [segs[i][0], segs[i][1]];
        for (const dir of [1, 0]) { let guard = 0; while (guard++ < 100000) { const end = dir ? line[line.length - 1] : line[0]; const next = (map.get(key(end)) || []).find(j => !used[j]); if (next === undefined) break; used[next] = 1; const sg = segs[next]; const other = key(sg[0]) === key(end) ? sg[1] : sg[0]; if (dir) line.push(other); else line.unshift(other); } }
        if (line.length > 3) items.push({ d: polyD(line.map(p => [p[0] * s, p[1] * s]), key(line[0]) === key(line[line.length - 1])), fill: 'none', stroke: pens[li % pens.length], sw: P.width || 1.2 });
      }
    });
    return shapesOf(items, W * s, H * s);
  });
  E.shapesOf = shapesOf;
})(typeof self !== 'undefined' ? self : this);
