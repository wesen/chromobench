
(() => {
const BOOK = JSON.parse(document.getElementById('book-data').textContent);
const $ = (id) => document.getElementById(id);
const store = { get(k) { try { return localStorage.getItem('lfp:' + k); } catch (e) { return null; } }, set(k, v) { try { v == null ? localStorage.removeItem('lfp:' + k) : localStorage.setItem('lfp:' + k, v); } catch (e) {} } };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* theme */
(function () { const t = store.get('theme'); if (t) document.documentElement.dataset.theme = t; })();
$('theme').onclick = () => {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'light' : 'dark'; store.set('theme', document.documentElement.dataset.theme);
};

/* highlighter (the workbench's own) */
const KW = new Set('const let var function return if else for while do of in new class extends import export from require this typeof instanceof break continue switch case default try catch finally throw async await yield delete void static get set super'.split(' '));
const LIT = new Set(['null', 'undefined', 'true', 'false', 'NaN', 'Infinity']);
const RE = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:[^'\\\n]|\\.)*'?|"(?:[^"\\\n]|\\.)*"?|`(?:[^`\\]|\\.)*`?)|(=>)|(\b\d+(?:\.\d+)?(?:e[-+]?\d+)?\b|\.\d+\b)|([A-Za-z_$][\w$]*)|([{}()[\];,.:?!<>=+\-*/%&|^~]+)|(\s+)|(.)/g;
function highlightLines(src) {
  const lines = ['']; RE.lastIndex = 0; let m;
  while ((m = RE.exec(src))) {
    const t = m[0];
    const cls = m[1] ? 'tk-c' : m[2] ? 'tk-s' : m[3] ? 'tk-e' : m[4] ? 'tk-n' : m[5] ? (KW.has(t) ? 'tk-k' : LIT.has(t) ? 'tk-b' : '') : m[6] ? 'tk-p' : '';
    t.split('\n').forEach((p, i) => { if (i > 0) lines.push(''); if (p) lines[lines.length - 1] += cls ? `<span class="${cls}">${esc(p)}</span>` : esc(p); });
    if (!t.length) RE.lastIndex++;
  }
  return lines;
}

/* book navigation; chapter HTML is rendered at build time (math as MathML) */
const CH = BOOK.chapters, byN = new Map(CH.map((c) => [String(c.n), c])), partOf = new Map(BOOK.parts.map((p) => [p.id, p]));
const label = (c) => `Chapter ${c.n}`;
let cur = null;
function tocHtml(query, withSecs) {
  const q = (query || '').trim().toLowerCase(); let h = '';
  for (const p of BOOK.parts) {
    const rows = [];
    for (const c of CH.filter((c) => c.part === p.id)) {
      let hits = 0;
      if (q) { const hay = (c.title + ' ' + c.about + ' ' + (c.text || '')).toLowerCase(); let k = hay.indexOf(q); while (k >= 0 && hits < 999) { hits++; k = hay.indexOf(q, k + q.length); } if (!hits) continue; }
      rows.push(`<button class="citem${cur && String(cur.n) === String(c.n) ? ' on' : ''}${c.html ? '' : ' missing'}" data-ch="${esc(c.n)}"><span class="n">${esc(c.n)}</span><span>${esc(c.title)}${hits ? ` <span class="hits">${hits}</span>` : ''}</span><small>${esc(c.about || '')}</small></button>`);
      if (withSecs && !q && cur === c && c.toc && c.toc.length) rows.push(`<div class="secs">${c.toc.map((t) => `<a href="#" data-anchor="c${esc(c.n)}-${esc(t.id)}">${esc(t.text.replace(/[`*$]/g, ''))}</a>`).join('')}</div>`);
    }
    if (rows.length) h += `<div class="part"><b>${esc(p.id)}</b>${esc(p.title)}</div>` + rows.join('');
  }
  return h || '<p class="empty">Nothing in the book matches.</p>';
}
function drawToc() { $('toclist').innerHTML = tocHtml($('q').value, true); $('chapmenu').innerHTML = tocHtml('', false); }
function openChapter(n, opts = {}) {
  const c = byN.get(String(n)) || CH[0]; cur = c;
  $('pcode').textContent = String(c.n).padStart(2, '0'); $('ptitle').textContent = c.title;
  const p = partOf.get(c.part);
  let html = c.html
    ? `<p class="eyebrow"><b>${label(c)}</b> · Part ${esc(p.id)} · ${esc(p.title)}</p>` + c.html
    : `<p class="eyebrow">${label(c)}</p><h1>${esc(c.title)}</h1><p>${esc(c.about || '')}</p><p class="pending">This chapter is not written yet. Its plan is in the book's outline; Chapter 1 is the pilot.</p>`;
  const i = CH.indexOf(c), prev = CH[i - 1], next = CH[i + 1];
  html += `<div class="pager">${prev ? `<button data-ch="${esc(prev.n)}"><small>${label(prev)}</small>${esc(prev.title)}</button>` : ''}${next ? `<button class="next" data-ch="${esc(next.n)}"><small>${label(next)}</small>${esc(next.title)}</button>` : ''}</div>`;
  $('doc').innerHTML = html;
  if (!opts.keepScroll) $('readscroll').scrollTop = 0;
  drawToc(); store.set('ch', String(c.n));
  try { history.replaceState(null, '', '#ch' + c.n); } catch (e) {}
  const sk = c.sketches || [];
  if (sk.length && (!bench.id || !sk.includes(bench.id))) openSketch(sk[0], { quiet: true }); else fillSketchSelect();
  if (opts.query) findInDoc(opts.query);
}
function findInDoc(q) {
  q = q.toLowerCase();
  const el = [...$('doc').querySelectorAll('p, li, td, h2, h3, figcaption, pre')].find((e) => e.textContent.toLowerCase().includes(q));
  if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400); }
}
function lab(href) {
  const m = href.match(/^lab:([a-z]+)\?(.*)$/); if (!m) return;
  const q = Object.fromEntries(m[2].split('&').map((kv) => { const [k, v = ''] = kv.split('='); return [k, decodeURIComponent(v)]; }));
  if (m[1] === 'book') openChapter(q.ch);
  else if (m[1] === 'sketch') { openSketch(q.id); showBench('sketch'); }
  else if (m[1] === 'demo') { openSource(q.id); showBench('src'); }
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-lab], a[data-anchor], [data-ch]');
  if (!a) { if (!e.target.closest('.chap')) { $('chapmenu').hidden = true; $('chapbtn').setAttribute('aria-expanded', 'false'); } return; }
  if (a.dataset.lab) { e.preventDefault(); lab(a.dataset.lab); }
  else if (a.dataset.anchor) { e.preventDefault(); const t = document.getElementById(a.dataset.anchor); if (t) { t.scrollIntoView({ block: 'start' }); t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1200); } }
  else if (a.dataset.ch) { e.preventDefault(); $('chapmenu').hidden = true; openChapter(a.dataset.ch, { query: a.closest('#toclist') ? $('q').value.trim() : '' }); }
});
$('chapbtn').onclick = () => { const m = $('chapmenu'); m.hidden = !m.hidden; $('chapbtn').setAttribute('aria-expanded', String(!m.hidden)); };
$('q').addEventListener('input', drawToc);

/* bench: source cards */
function showBench(which) {
  $('tab-sketch').classList.toggle('on', which === 'sketch'); $('tab-src').classList.toggle('on', which === 'src');
  $('bench-sketch').hidden = which !== 'sketch'; $('bench-src').hidden = which !== 'src';
  $('bench').classList.add('open');
}
$('tab-sketch').onclick = () => showBench('sketch');
$('tab-src').onclick = () => showBench('src');
$('benchbtn').onclick = () => $('bench').classList.add('open');
$('closebench').onclick = () => $('bench').classList.remove('open');
function openSource(id) {
  const d = BOOK.sources[id];
  if (!d) { $('bench-src').innerHTML = `<p class="empty">No source called ${esc(id)}.</p>`; return; }
  const chs = d.chapters.map((n) => byN.get(String(n))).filter(Boolean);
  $('bench-src').innerHTML = `<div class="card">
    <span class="lib">${esc(d.lib)} · ${esc(d.section)}</span>
    <h2>${esc(d.title)}</h2>
    <p class="tag">${esc(d.tagline)}</p>
    <div class="tags">${d.tags.split(' ').filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join('')}</div>
    <a class="btn primary" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">Open the source ↗</a>
    <p class="tag">${esc(d.license)}</p>
    <h3>In this book</h3>
    <ul>${chs.map((c) => `<li><button data-ch="${esc(c.n)}">${label(c)}: ${esc(c.title)}</button></li>`).join('')}</ul>
  </div>`;
}

/* bench: sketches (the handbook's contract: meta, setup, draw or frag) */
const cv = $('cv'), ctx = cv.getContext('2d');
const bench = { id: null, mod: null, meta: {}, params: {}, state: undefined, t: 0, last: 0, playing: true, frame: 0, err: null, slow: false, nextAt: 0, dirty: true, mouse: { x: 0, y: 0, down: false } };
const srcOf = (id) => store.get('src:' + id) || (BOOK.sketches[id] && BOOK.sketches[id].src) || '';
function fillSketchSelect() {
  const ids = (cur && cur.sketches) || [], opts = (bench.id && !ids.includes(bench.id) ? [bench.id] : []).concat(ids);
  $('sketchsel').innerHTML = opts.length ? opts.map((id) => `<option value="${esc(id)}"${id === bench.id ? ' selected' : ''}>${esc((BOOK.sketches[id] && BOOK.sketches[id].title) || id)}</option>`).join('') : '<option>No sketches in this chapter</option>';
  $('sketchsel').disabled = !opts.length;
}
$('sketchsel').onchange = (e) => openSketch(e.target.value);
function compile(src) {
  const module = { exports: {} };
  new Function('module', 'exports', 'require', src + '\n//# sourceURL=sketch.js')(module, module.exports, () => { throw new Error('Sketches are self-contained: require() is not available.'); });
  return module.exports;
}
function errLine(e) { const m = String(e && e.stack || '').match(/sketch\.js:(\d+):\d+/); return m ? +m[1] - 2 : null; }
function setErr(e) {
  bench.err = e; const ln = e ? errLine(e) : null;
  $('efoot').innerHTML = e ? `<span class="bad">${esc(e.message || String(e))}${ln ? ` (line ${ln})` : ''}</span>` : `<span>${esc(bench.id || '')}</span><span>${store.get('src:' + bench.id) ? 'edited here · Revert restores the original' : 'Ctrl/Cmd + Enter runs your edits'}</span>`;
  paintEditor(ln);
}
function paintEditor(errLn) {
  const lines = highlightLines($('src').value);
  $('hl').innerHTML = lines.map((l, i) => errLn === i + 1 ? `<span class="err-line">${l || ' '}</span>` : l).join('\n') + '\n';
  $('gutter').innerHTML = lines.map((_, i) => `<div${errLn === i + 1 ? ' class="err"' : ''}>${i + 1}</div>`).join('');
}
function syncScroll() { const t = $('src'); $('hl').style.transform = `translate(${-t.scrollLeft}px, ${-t.scrollTop}px)`; $('gutter').style.transform = `translateY(${-t.scrollTop}px)`; }
$('src').addEventListener('scroll', syncScroll);
$('src').addEventListener('input', () => { paintEditor(null); $('revert').disabled = false; });
$('src').addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); runEdited(); }
  else if (e.key === 'Tab') { e.preventDefault(); const t = e.target, a = t.selectionStart; t.setRangeText('  ', a, t.selectionEnd, 'end'); paintEditor(null); }
});
const fmt = (x) => Math.abs(x) >= 100 || Number.isInteger(x) ? String(Math.round(x * 100) / 100) : x.toFixed(Math.abs(x) < 0.01 ? 4 : Math.abs(x) < 1 ? 3 : 2);
function paramDefaults(meta) { const p = {}; for (const [k, v] of Object.entries(meta.params || {})) p[k] = v && typeof v === 'object' && 'value' in v ? v.value : v; return p; }
function buildParams() {
  const box = $('params'), ps = bench.meta.params || {}; box.innerHTML = '';
  for (const [k, spec] of Object.entries(ps)) {
    const v = bench.params[k], row = document.createElement('div'), id = 'p-' + k; row.className = 'prow';
    if (spec && Array.isArray(spec.options)) {
      row.innerHTML = `<label for="${id}">${esc(spec.label || k)}</label><select id="${id}">${spec.options.map((o) => `<option${String(o) === String(v) ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
      row.querySelector('select').onchange = (e) => setParam(k, typeof spec.value === 'number' ? +e.target.value : e.target.value);
    } else if (typeof v === 'boolean') {
      row.innerHTML = `<label for="${id}">${esc(spec.label || k)}</label><input id="${id}" type="checkbox"${v ? ' checked' : ''}>`;
      row.querySelector('input').onchange = (e) => setParam(k, e.target.checked);
    } else if (typeof v === 'number') {
      const min = spec.min ?? 0, max = spec.max ?? Math.max(1, v * 2), step = spec.step ?? (max - min) / 100;
      row.innerHTML = `<label for="${id}">${esc(spec.label || k)}</label><output>${fmt(v)}</output><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${v}">`;
      const out = row.querySelector('output');
      row.querySelector('input').oninput = (e) => { out.textContent = fmt(+e.target.value); setParam(k, +e.target.value); };
    } else continue;
    box.appendChild(row);
  }
}
function setParam(k, v) { bench.params[k] = v; doSetup(); bench.nextAt = 0; bench.dirty = true; if (!bench.playing) drawOnce(); }
function doSetup() {
  try { bench.state = bench.mod && bench.mod.setup ? bench.mod.setup({ w: bench.W, h: bench.H, params: bench.params }) : undefined; setErr(null); }
  catch (e) { setErr(e); }
}
function load(src, keepParams) {
  let mod; try { mod = compile(src); } catch (e) { setErr(e); return false; }
  bench.mod = mod; bench.meta = mod.meta || {};
  const [W, H] = bench.meta.size || [480, 320]; bench.W = W; bench.H = H;
  const prev = bench.params; bench.params = paramDefaults(bench.meta);
  if (keepParams) for (const k of Object.keys(bench.params)) if (k in prev) bench.params[k] = prev[k];
  const isFrag = !mod.draw && !!mod.frag, dpr = isFrag ? 1 : Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  cv.style.aspectRatio = `${W} / ${H}`; cv.style.width = W + 'px';
  bench.dpr = dpr; bench.img = isFrag ? ctx.createImageData(W, H) : null;
  $('sabout').textContent = bench.meta.about || '';
  buildParams(); doSetup();
  bench.t = 0; bench.frame = 0; bench.slow = false; bench.nextAt = 0; bench.dirty = true; bench.mouse = { x: -1, y: -1, down: false };
  return true;
}
function openSketch(id, opts = {}) {
  if (!BOOK.sketches[id]) { setErr(new Error('No sketch called ' + id)); return; }
  bench.id = id; fillSketchSelect();
  $('src').value = srcOf(id); $('revert').disabled = !store.get('src:' + id);
  syncScroll(); load($('src').value, false); if (!bench.err) setErr(null);
  if (!opts.quiet) showBench('sketch');
}
function runEdited() {
  const src = $('src').value, orig = BOOK.sketches[bench.id] ? BOOK.sketches[bench.id].src : '';
  store.set('src:' + bench.id, src === orig ? null : src); $('revert').disabled = src === orig;
  if (load(src, true)) setErr(null);
}
$('run').onclick = runEdited;
$('revert').onclick = () => { store.set('src:' + bench.id, null); $('src').value = BOOK.sketches[bench.id].src; $('revert').disabled = true; load($('src').value, false); setErr(null); };
$('restart').onclick = () => { bench.t = 0; bench.frame = 0; doSetup(); bench.nextAt = 0; bench.dirty = true; if (!bench.playing) drawOnce(); };
$('play').onclick = () => { bench.playing = !bench.playing; $('play').textContent = bench.playing ? 'Pause' : 'Play'; };
function pointer(e) { const r = cv.getBoundingClientRect(); bench.mouse.x = (e.clientX - r.left) / r.width * bench.W; bench.mouse.y = (e.clientY - r.top) / r.height * bench.H; bench.dirty = true; }
cv.addEventListener('pointermove', (e) => { pointer(e); if (!bench.playing) drawOnce(); });
cv.addEventListener('pointerdown', (e) => { pointer(e); bench.mouse.down = true; cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointerup', () => { bench.mouse.down = false; });
cv.addEventListener('pointerleave', () => { bench.mouse.x = -1; bench.mouse.y = -1; bench.dirty = true; });
function drawOnce() {
  const m = bench.mod; if (!m || bench.err) return;
  const env = { w: bench.W, h: bench.H, t: bench.t, frame: bench.frame, dt: 1 / 60, params: bench.params, state: bench.state, mouse: bench.mouse };
  const t0 = performance.now();
  try {
    if (m.draw) { ctx.setTransform(bench.dpr, 0, 0, bench.dpr, 0, 0); ctx.save(); m.draw(ctx, env); ctx.restore(); }
    else if (m.frag) {
      const d = bench.img.data, W = bench.W, H = bench.H;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = m.frag(x + 0.5, y + 0.5, env), k = (y * W + x) * 4; d[k] = v[0] * 255 + 0.5; d[k + 1] = v[1] * 255 + 0.5; d[k + 2] = v[2] * 255 + 0.5; d[k + 3] = v.length > 3 ? v[3] * 255 + 0.5 : 255; }
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.putImageData(bench.img, 0, 0);
    }
  } catch (e) { setErr(e); return; }
  const ms = performance.now() - t0; bench.slow = ms > 40; bench.dirty = false;
  $('stat').innerHTML = `${ms.toFixed(ms < 10 ? 1 : 0)} ms/frame${bench.slow ? ' · <span class="bad">slow, redrawn 4×/s</span>' : ''}`;
}
function loop(now) {
  const dt = Math.min(0.1, (now - (bench.last || now)) / 1000); bench.last = now;
  if (bench.playing && bench.mod && !bench.err) {
    bench.t += dt;
    // these sketches are static in t: redraw only when a parameter or the pointer changed
    if (bench.dirty && (!bench.slow || now >= bench.nextAt)) { drawOnce(); bench.frame++; bench.nextAt = now + 250; }
  }
  requestAnimationFrame(loop);
}

/* start */
drawToc();
const fromHash = (location.hash.match(/^#ch(\d)$/) || [])[1];
openChapter(fromHash || store.get('ch') || CH[0].n);
requestAnimationFrame(loop);
})();
