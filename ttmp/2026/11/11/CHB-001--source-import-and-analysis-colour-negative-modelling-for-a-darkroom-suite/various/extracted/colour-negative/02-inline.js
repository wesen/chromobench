

// runtime.js — the handbook's behaviour. Everything static is rendered at build time; this file adds the parts
// that have to run: theme switching, specimen theme flips, copy buttons, the contents highlight, the sketch
// benches, the markdown playground with its linter, the figure lab and the checklists.
(() => {
const DATA = JSON.parse(document.getElementById('hb-data').textContent);
const MD = window.KilnMD;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = MD.esc;
const store = { get(k) { try { return localStorage.getItem('kh:' + k); } catch (e) { return null; } }, set(k, v) { try { v == null ? localStorage.removeItem('kh:' + k) : localStorage.setItem('kh:' + k, v); } catch (e) {} } };

/* ---------- theme: Auto follows the viewer; Light and Dark pin the page through body classes ---------- */
function setTheme(t) {
  document.body.classList.remove('th-light', 'th-dark');
  if (t === 'light' || t === 'dark') document.body.classList.add('th-' + t);
  $$('#themeseg button').forEach((b) => b.classList.toggle('on', b.dataset.theme === t));
  store.set('theme', t === 'auto' ? null : t);
}
$$('#themeseg button').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.theme)));
setTheme(store.get('theme') || 'auto');

/* ---------- specimen flips: show one stage in the other theme without touching the page ---------- */
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-flip]');
  if (!b) return;
  const stage = b.closest('.spec').querySelector('.spec-stage');
  stage.classList.remove('th-light', 'th-dark');
  if (b.dataset.flip !== 'page') stage.classList.add('th-' + b.dataset.flip);
  $$('[data-flip]', b.parentNode).forEach((x) => x.classList.toggle('on', x === b));
});

/* ---------- copy buttons: copy the text of the nearest code block, or a data-copy string ---------- */
document.addEventListener('click', (e) => {
  const b = e.target.closest('.copy');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const target = b.dataset.copy != null ? null : (b.closest('.spec-src, .pair > div, .play > div, .copyable') || document).querySelector('pre, textarea');
  const text = b.dataset.copy != null ? b.dataset.copy : target ? (target.value != null && target.tagName === 'TEXTAREA' ? target.value : target.textContent) : '';
  const done = () => { const t = b.textContent; b.textContent = 'Copied'; setTimeout(() => { b.textContent = t; }, 1200); };
  const select = () => { if (!target) return; const r = document.createRange(); r.selectNodeContents(target); const s = getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = 'Selected'; };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, select); else select();
});

/* ---------- contents: highlight the section in view, mirror it in the bar, phone select ---------- */
const navLinks = $$('.hb-nav a[href^="#"]');
const byId = new Map(navLinks.map((a) => [a.getAttribute('href').slice(1), a]));
const where = $('#where');
const io = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    const a = byId.get(en.target.id); if (!a) continue;
    navLinks.forEach((x) => x.classList.toggle('on', x === a));
    const title = a.querySelector('span:last-child').textContent;
    if (where) where.innerHTML = a.dataset.part ? `${esc(a.dataset.part)} · <b>${esc(title)}</b>` : `<b>${esc(title)}</b>`;
    const nav = $('.hb-nav'); const r = a.getBoundingClientRect(), nr = nav.getBoundingClientRect();
    if (r.top < nr.top + 40 || r.bottom > nr.bottom - 40) nav.scrollTop += r.top - nr.top - nr.height / 3;
  }
}, { rootMargin: '-64px 0px -70% 0px' });
$$('.hb-sec[id], .hb-part[id]').forEach((s) => io.observe(s));
const mob = $('#mobnav'); if (mob) mob.addEventListener('change', () => { location.hash = mob.value; });

/* ---------- sketch benches ---------- */
const benches = [];
function compile(src) {
  const module = { exports: {} };
  const fn = new Function('module', 'exports', 'require', src + '\n//# sourceURL=sketch.js');
  fn(module, module.exports, () => { throw new Error('Sketches are self-contained: require() is not available.'); });
  return module.exports;
}
const errLine = (e) => { const m = String(e && e.stack || '').match(/sketch\.js:(\d+):\d+/); return m ? +m[1] - 2 : null; };
const fmt = (x) => Math.abs(x) >= 100 || Number.isInteger(x) ? String(Math.round(x * 100) / 100) : x.toFixed(Math.abs(x) < 0.01 ? 4 : Math.abs(x) < 1 ? 3 : 2);

class Bench {
  constructor(el) {
    this.el = el;
    this.choices = (el.dataset.select || el.dataset.sketch).split(',').map((s) => s.trim()).filter((s) => DATA.sketches[s]);
    this.id = this.choices[0];
    el.innerHTML = `
      <div class="bhead"><div class="row">${this.choices.length > 1 ? `<select class="field" aria-label="Sketch">${this.choices.map((id) => `<option value="${esc(id)}">${esc(DATA.sketches[id].title)} · ${esc(id.split('/')[0])}</option>`).join('')}</select>` : `<b></b>`}<span class="chip"></span></div><p class="about"></p></div>
      <div class="left"><div class="stage"><canvas width="480" height="320"></canvas></div>
        <div class="btools"><button class="btn sm" data-a="play">Pause</button><button class="btn sm" data-a="restart">Restart</button><button class="btn sm" data-a="src">Edit source</button><span class="stat"></span></div></div>
      <div class="right"><div class="params"></div></div>
      <div class="srcwrap" hidden>
        <div class="btools"><button class="btn sm primary" data-a="run" title="Run the edited source (Ctrl/Cmd + Enter)">Run</button><button class="btn sm" data-a="revert" disabled>Revert</button><span class="stat">Ctrl/Cmd + Enter runs your edits · edits stay in this browser</span></div>
        <div class="ed"><div class="gutter"><div class="gutter-in"></div></div><div class="code"><pre aria-hidden="true"></pre><textarea spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Sketch source"></textarea></div></div>
        <div class="efoot"></div>
      </div>`;
    this.cv = $('canvas', el); this.ctx = this.cv.getContext('2d');
    this.ta = $('textarea', el); this.hl = $('.code pre', el); this.gut = $('.gutter-in', el);
    this.playing = true; this.visible = false; this.t = 0; this.frame = 0; this.last = 0; this.nextAt = 0;
    this.mouse = { x: 0, y: 0, down: false };
    const sel = $('select', el); if (sel) sel.addEventListener('change', () => this.open(sel.value));
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-a]'); if (b) this.action(b.dataset.a, b); });
    this.ta.addEventListener('input', () => { this.paint(null); $('[data-a=revert]', el).disabled = false; });
    this.ta.addEventListener('scroll', () => this.sync());
    this.ta.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); this.runEdited(); }
      else if (e.key === 'Tab') { e.preventDefault(); const a = this.ta.selectionStart; this.ta.setRangeText('  ', a, this.ta.selectionEnd, 'end'); this.paint(null); }
    });
    const pt = (e) => { const r = this.cv.getBoundingClientRect(); this.mouse.x = (e.clientX - r.left) / r.width * this.W; this.mouse.y = (e.clientY - r.top) / r.height * this.H; };
    this.cv.addEventListener('pointermove', (e) => { pt(e); if (!this.playing) this.draw(); });
    this.cv.addEventListener('pointerdown', (e) => { pt(e); this.mouse.down = true; this.cv.setPointerCapture(e.pointerId); });
    this.cv.addEventListener('pointerup', () => { this.mouse.down = false; });
    this.open(this.id);
  }
  srcOf(id) { return store.get('src:' + id) || DATA.sketches[id].src; }
  open(id) {
    this.id = id;
    const s = DATA.sketches[id];
    const t = $('.bhead .row b', this.el); if (t) t.textContent = s.title;
    $('.bhead .chip', this.el).textContent = id;
    const sel = $('select', this.el); if (sel) sel.value = id;
    this.ta.value = this.srcOf(id); $('[data-a=revert]', this.el).disabled = !store.get('src:' + id);
    this.sync(); this.load(this.ta.value, false);
  }
  action(a, b) {
    if (a === 'play') { this.playing = !this.playing; b.textContent = this.playing ? 'Pause' : 'Play'; }
    else if (a === 'restart') { this.t = 0; this.frame = 0; this.setup(); this.nextAt = 0; if (!this.playing) this.draw(); }
    else if (a === 'src') { const w = $('.srcwrap', this.el); w.hidden = !w.hidden; b.classList.toggle('on', !w.hidden); this.paint(null); }
    else if (a === 'run') this.runEdited();
    else if (a === 'revert') { store.set('src:' + this.id, null); this.ta.value = DATA.sketches[this.id].src; b.disabled = true; this.load(this.ta.value, false); }
  }
  runEdited() {
    const src = this.ta.value, orig = DATA.sketches[this.id].src;
    store.set('src:' + this.id, src === orig ? null : src);
    $('[data-a=revert]', this.el).disabled = src === orig;
    this.load(src, true);
  }
  setErr(e) {
    this.err = e;
    const ln = e ? errLine(e) : null;
    $('.efoot', this.el).innerHTML = e ? `<span class="bad">${esc(e.message || String(e))}${ln ? ` (line ${ln})` : ''}</span>` : '';
    if (e) $('.btools .stat', this.el).innerHTML = '<span class="bad">stopped on an error</span>';
    this.paint(ln);
  }
  paint(errLn) {
    if ($('.srcwrap', this.el).hidden) return;
    const lines = MD.highlightLines(this.ta.value);
    this.hl.innerHTML = lines.map((l, i) => errLn === i + 1 ? `<span class="err-line">${l || ' '}</span>` : l).join('\n') + '\n';
    this.gut.innerHTML = lines.map((_, i) => `<div${errLn === i + 1 ? ' class="err"' : ''}>${i + 1}</div>`).join('');
    this.sync();
  }
  sync() { this.hl.style.transform = `translate(${-this.ta.scrollLeft}px, ${-this.ta.scrollTop}px)`; this.gut.style.transform = `translateY(${-this.ta.scrollTop}px)`; }
  load(src, keep) {
    let mod;
    try { mod = compile(src); } catch (e) { this.setErr(e); return false; }
    this.mod = mod; this.meta = mod.meta || {};
    const [W, H] = this.meta.size || [480, 320];
    this.W = W; this.H = H;
    const prev = this.params || {};
    this.params = {};
    for (const [k, v] of Object.entries(this.meta.params || {})) this.params[k] = v && typeof v === 'object' && 'value' in v ? v.value : v;
    if (keep) for (const k of Object.keys(this.params)) if (k in prev) this.params[k] = prev[k];
    const isFrag = !mod.draw && !!mod.frag, dpr = isFrag ? 1 : Math.min(2, window.devicePixelRatio || 1);
    this.cv.width = Math.round(W * dpr); this.cv.height = Math.round(H * dpr);
    this.cv.classList.toggle('px', isFrag); this.cv.style.aspectRatio = `${W} / ${H}`; this.cv.style.width = W + 'px';
    this.dpr = dpr; this.img = isFrag ? this.ctx.createImageData(W, H) : null;
    $('.bhead .about', this.el).textContent = this.meta.about || DATA.sketches[this.id].about || '';
    this.buildParams(); this.err = null; this.setErr(null); this.setup();
    this.t = 0; this.frame = 0; this.slow = false; this.nextAt = 0; this.mouse = { x: W / 2, y: H / 2, down: false };
    this.draw();
    return true;
  }
  setup() { try { this.state = this.mod && this.mod.setup ? this.mod.setup({ w: this.W, h: this.H, params: this.params }) : undefined; } catch (e) { this.setErr(e); } }
  buildParams() {
    const box = $('.params', this.el), ps = this.meta.params || {};
    box.innerHTML = '';
    for (const [k, spec] of Object.entries(ps)) {
      const v = this.params[k], row = document.createElement('div'); row.className = 'prow';
      const id = 'p-' + this.id.replace(/\W/g, '-') + '-' + k + '-' + benches.length;
      const label = esc((spec && spec.label) || k);
      if (spec && Array.isArray(spec.options)) {
        row.innerHTML = `<label for="${id}">${label}</label><select id="${id}">${spec.options.map((o) => `<option${String(o) === String(v) ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
        row.querySelector('select').onchange = (e) => this.set(k, typeof spec.value === 'number' ? +e.target.value : e.target.value);
      } else if (typeof v === 'boolean') {
        row.innerHTML = `<label for="${id}">${label}</label><input id="${id}" type="checkbox"${v ? ' checked' : ''}>`;
        row.querySelector('input').onchange = (e) => this.set(k, e.target.checked);
      } else if (typeof v === 'number') {
        const min = spec.min ?? 0, max = spec.max ?? Math.max(1, v * 2), step = spec.step ?? (max - min) / 100;
        row.innerHTML = `<label for="${id}">${label}</label><output>${fmt(v)}</output><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${v}">`;
        const out = row.querySelector('output');
        row.querySelector('input').oninput = (e) => { out.textContent = fmt(+e.target.value); this.set(k, +e.target.value); };
      } else if (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v)) {
        row.innerHTML = `<label for="${id}">${label}</label><input id="${id}" type="color" value="${esc(v)}">`;
        row.querySelector('input').oninput = (e) => this.set(k, e.target.value);
      } else continue;
      box.appendChild(row);
    }
  }
  set(k, v) { this.params[k] = v; this.setup(); this.nextAt = 0; if (!this.playing || !this.visible) this.draw(); }
  draw() {
    const m = this.mod; if (!m || this.err) return;
    const env = { w: this.W, h: this.H, t: this.t, frame: this.frame, dt: 1 / 60, params: this.params, state: this.state, mouse: this.mouse };
    const t0 = performance.now();
    try {
      if (m.draw) { this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); this.ctx.save(); m.draw(this.ctx, env); this.ctx.restore(); }
      else if (m.frag) {
        const d = this.img.data, W = this.W, H = this.H;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const v = m.frag(x + 0.5, y + 0.5, env), k = (y * W + x) * 4;
          d[k] = v[0] * 255 + 0.5; d[k + 1] = v[1] * 255 + 0.5; d[k + 2] = v[2] * 255 + 0.5; d[k + 3] = v.length > 3 ? v[3] * 255 + 0.5 : 255;
        }
        this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.putImageData(this.img, 0, 0);
      }
    } catch (e) { this.setErr(e); return; }
    const ms = performance.now() - t0;
    this.slow = ms > 40;
    $('.btools .stat', this.el).innerHTML = `t ${this.t.toFixed(1)} s · ${ms.toFixed(ms < 10 ? 1 : 0)} ms/frame${this.slow ? ' · redrawn 4×/s' : ''}`;
  }
  tick(now) {
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000); this.last = now;
    if (!this.playing || !this.visible || !this.mod || this.err) return;
    this.t += dt;
    if (!this.slow || now >= this.nextAt) { this.draw(); this.frame++; this.nextAt = now + 250; }
  }
}
const vis = new IntersectionObserver((es) => es.forEach((en) => { const b = en.target.__bench; if (b) { b.visible = en.isIntersecting; b.last = 0; } }), { rootMargin: '120px' });
$$('.bench-card[data-sketch], .bench-card[data-select]').forEach((el) => { const b = new Bench(el); el.__bench = b; benches.push(b); vis.observe(el); });
(function loop(now) { for (const b of benches) b.tick(now); requestAnimationFrame(loop); })(performance.now());

/* links into the sketch gallery from rendered chapters */
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-sketch]');
  if (!a) return;
  const gal = document.getElementById(a.dataset.bench || '') || $('#sketch-gallery'), b = gal && gal.__bench;
  if (!b || !DATA.sketches[a.dataset.sketch]) return;
  e.preventDefault();
  if (b.choices.includes(a.dataset.sketch)) b.open(a.dataset.sketch);
  gal.scrollIntoView({ block: 'center' });
});

/* ---------- editor helper shared by the playgrounds ---------- */
function editor(root, initial, lang, onChange) {
  root.innerHTML = `<div class="gutter"><div class="gutter-in"></div></div><div class="code"><pre aria-hidden="true"></pre><textarea spellcheck="false" autocapitalize="off" autocomplete="off"></textarea></div>`;
  const ta = $('textarea', root), pre = $('pre', root), gut = $('.gutter-in', root);
  const hl = lang === 'md' ? MD.highlightMd : lang === 'svg' ? MD.highlightHtml : MD.highlight;
  let marks = new Set();
  const paint = () => {
    const lines = hl(ta.value).split('\n');
    pre.innerHTML = lines.map((l, i) => marks.has(i + 1) ? `<span class="err-line">${l || ' '}</span>` : l).join('\n') + '\n';
    gut.innerHTML = lines.map((_, i) => `<div${marks.has(i + 1) ? ' class="err"' : ''}>${i + 1}</div>`).join('');
    sync();
  };
  const sync = () => { pre.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`; gut.style.transform = `translateY(${-ta.scrollTop}px)`; };
  let timer = 0;
  ta.addEventListener('input', () => { paint(); clearTimeout(timer); timer = setTimeout(() => onChange(ta.value), 180); });
  ta.addEventListener('scroll', sync);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); const a = ta.selectionStart; ta.setRangeText('  ', a, ta.selectionEnd, 'end'); paint(); onChange(ta.value); } });
  ta.value = initial; paint();
  return { ta, set(v) { ta.value = v; paint(); onChange(v); }, mark(lines) { marks = new Set(lines); paint(); } };
}
const linkFor = (href, text) => {
  const m = href.match(/^lab:([a-z]+)\?(.*)$/);
  const q = m ? Object.fromEntries(m[2].split('&').map((kv) => kv.split('='))) : {};
  // (this book has no web demos; the handbook's demo-link branch is removed)
  if (m && m[1] === 'sketch') return `<a class="lablink" href="#sketches" data-sketch="${esc(q.id)}">${text}</a>`;
  if (m && m[1] === 'book') return `<a class="lablink" href="${esc(DATA.readerUrl)}#ch${esc(q.ch)}" target="_blank" rel="noopener">${text}</a>`;
  return `<a class="lablink" href="#">${text}</a>`;
};
const texFn = (src, display) => {
  if (window.katex) { try { return window.katex.renderToString(src, { displayMode: !!display, output: 'mathml', throwOnError: false, strict: false }); } catch (e) {} }
  return display ? `<pre class="tex">${esc(src)}</pre>` : `<code class="tex">${esc(src)}</code>`;
};
const R = MD.makeRenderer({ tex: texFn, lab: linkFor });
function lintHtml(res, extra = []) {
  const all = res.issues.concat(extra).sort((a, b) => a.ln - b.ln);
  if (!all.length) return `<div class="ok">No problems. ${res.figs} figure${res.figs === 1 ? '' : 's'} checked${window.katex ? ', all math parsed' : ' (math is checked once the KaTeX script has loaded)'}.</div>`;
  return `<ol>${all.map((x) => `<li class="${x.level}"><span class="lv">${x.level === 'error' ? 'Error' : 'Warning'}</span> line ${x.ln}: ${esc(x.msg)}</li>`).join('')}</ol>`;
}

/* ---------- markdown playground ---------- */
const mdp = $('#mdplay');
if (mdp) {
  const samples = JSON.parse($('#md-samples').textContent);
  const out = $('.out', mdp), lintBox = $('.lintbox', mdp), sel = $('select', mdp);
  const ctx = () => ({ katex: window.katex, demos: new Set(Object.keys(DATA.demos)), sketches: new Set(Object.keys(DATA.sketches)), chapter: (sel.value.match(/^(\d+)/) || [])[1] || 'S' });
  const update = (v) => {
    out.innerHTML = `<article class="doc">${R.render(v, { idPrefix: 'pg-' }).html}</article>`;
    const res = MD.lint(v, ctx());
    lintBox.innerHTML = lintHtml(res);
    ed.mark(res.issues.filter((x) => x.level === 'error').map((x) => x.ln));
    store.set('md-draft:' + sel.value, v === samples[sel.value] ? null : v);
  };
  sel.innerHTML = Object.keys(samples).map((k) => `<option>${esc(k)}</option>`).join('');
  const ed = editor($('.ed', mdp), store.get('md-draft:' + sel.value) || samples[sel.value], 'md', update);
  sel.addEventListener('change', () => ed.set(store.get('md-draft:' + sel.value) || samples[sel.value]));
  $('[data-reset]', mdp).addEventListener('click', () => { store.set('md-draft:' + sel.value, null); ed.set(samples[sel.value]); });
  update(ed.ta.value);
  window.addEventListener('load', () => update(ed.ta.value));
}

/* ---------- figure lab ---------- */
const fl = $('#figlab');
if (fl) {
  const samples = JSON.parse($('#fig-samples').textContent);
  const sel = $('select', fl), panes = $$('.themepane .figbox', fl), lintBox = $('.lintbox', fl);
  const update = (v) => {
    const cap = '**Figure S.1.** Live render from the editor.';
    const html = R.figure(v, cap);
    panes.forEach((p) => { p.innerHTML = html; });
    const issues = []; MD.lintSvg(v, 1, issues);
    const svgLines = v.split('\n');
    lintBox.innerHTML = lintHtml({ issues: issues.map((x) => { const m = x.msg.match(/Class "([^"]+)"/); if (m) { const k = svgLines.findIndex((l) => l.includes('"' + m[1]) || l.includes(' ' + m[1] + '"') || l.includes(m[1])); return Object.assign({}, x, { ln: k + 1 }); } return x; }), figs: 1 });
  };
  sel.innerHTML = Object.keys(samples).map((k) => `<option>${esc(k)}</option>`).join('');
  const ed = editor($('.ed', fl), samples[sel.value], 'svg', update);
  sel.addEventListener('change', () => ed.set(samples[sel.value]));
  update(ed.ta.value);
}

/* ---------- source / rendered tabs on worked examples ---------- */
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  const box = b.closest('[data-tabs]');
  $$('[data-tab]', box).forEach((x) => x.classList.toggle('on', x === b));
  $$('[data-pane]', box).forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
});

/* ---------- checklists: ticks are a per-browser convenience ---------- */
$$('.checklist input[type=checkbox]').forEach((c) => {
  const k = 'chk:' + c.id;
  c.checked = store.get(k) === '1';
  c.addEventListener('change', () => store.set(k, c.checked ? '1' : null));
});
$$('[data-clear-checks]').forEach((b) => b.addEventListener('click', () => {
  $$('input[type=checkbox]', b.closest('.hb-sec')).forEach((c) => { c.checked = false; store.set('chk:' + c.id, null); });
}));

/* ---------- reader miniatures: scale to fit, draw one sketch frame into each mock canvas ---------- */
function fitMinis() { $$('.mini-wrap').forEach((w) => { const m = w.firstElementChild; const s = Math.min(1, w.clientWidth / m.offsetWidth); m.style.transform = `scale(${s})`; w.style.height = m.offsetHeight * s + 'px'; }); }
window.addEventListener('resize', fitMinis); fitMinis();
$$('canvas[data-still]').forEach((cv) => {
  try {
    const mod = compile(DATA.sketches[cv.dataset.still].src), meta = mod.meta || {}, [W, H] = meta.size || [480, 320];
    const params = {}; for (const [k, v] of Object.entries(meta.params || {})) params[k] = v && typeof v === 'object' && 'value' in v ? v.value : v;
    cv.width = W; cv.height = H; const ctx = cv.getContext('2d');
    const state = mod.setup ? mod.setup({ w: W, h: H, params }) : undefined;
    const env = { w: W, h: H, t: 1.2, frame: 0, dt: 1 / 60, params, state, mouse: { x: W / 2, y: H / 2, down: false } };
    if (mod.draw) mod.draw(ctx, env);
    else { const img = ctx.createImageData(W, H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = mod.frag(x + .5, y + .5, env), k = (y * W + x) * 4; img.data[k] = v[0] * 255; img.data[k + 1] = v[1] * 255; img.data[k + 2] = v[2] * 255; img.data[k + 3] = 255; } ctx.putImageData(img, 0, 0); }
  } catch (e) {}
});
})();


