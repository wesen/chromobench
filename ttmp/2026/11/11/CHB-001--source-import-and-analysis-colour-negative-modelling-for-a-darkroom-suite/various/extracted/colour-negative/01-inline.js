

// renderer.js — the book's markdown dialect, as the workbench renders it, plus the highlighters.
// One source for both sides: build.js requires it in node (math pre-rendered to MathML with KaTeX), and the page
// inlines it for the live playground (math through the KaTeX script when it has loaded).
(function (root) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* ---------- JavaScript highlighter (the workbench's own) ---------- */
  const KW = new Set('const let var function return if else for while do of in new class extends import export from require this typeof instanceof break continue switch case default try catch finally throw async await yield delete void static get set super'.split(' '));
  const LIT = new Set(['null', 'undefined', 'true', 'false', 'NaN', 'Infinity']);
  const RE = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:[^'\\\n]|\\.)*'?|"(?:[^"\\\n]|\\.)*"?|`(?:[^`\\]|\\.)*`?)|(=>)|(\b\d+(?:\.\d+)?(?:e[-+]?\d+)?\b|\.\d+\b)|([A-Za-z_$][\w$]*)|([{}()[\];,.:?!<>=+\-*/%&|^~]+)|(\s+)|(.)/g;
  function highlightLines(src) {
    const lines = [''];
    RE.lastIndex = 0; let m;
    while ((m = RE.exec(src))) {
      const t = m[0];
      const cls = m[1] ? 'tk-c' : m[2] ? 'tk-s' : m[3] ? 'tk-e' : m[4] ? 'tk-n' : m[5] ? (KW.has(t) ? 'tk-k' : LIT.has(t) ? 'tk-b' : '') : m[6] ? 'tk-p' : '';
      t.split('\n').forEach((p, i) => { if (i > 0) lines.push(''); if (p) lines[lines.length - 1] += cls ? `<span class="${cls}">${esc(p)}</span>` : esc(p); });
      if (!t.length) RE.lastIndex++;
    }
    return lines;
  }
  const highlight = (src) => highlightLines(src).join('\n');

  /* ---------- HTML / SVG highlighter: tags bold, attribute values grey, comments light ---------- */
  function highlightHtml(src) {
    return String(src).replace(/(<!--[\s\S]*?-->)|(<\/?)([\w:-]+)((?:\s+[\w:@.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)(\s*\/?>)|([^<]+)/g,
      (all, com, open, name, attrs, close, text) => {
        if (com) return `<span class="tk-c">${esc(com)}</span>`;
        if (text !== undefined) return esc(text);
        const a = (attrs || '').replace(/([\w:@.-]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)?/g, (x, n, eq, v) => `${esc(n)}${v !== undefined ? '<span class="tk-p">=</span><span class="tk-s">' + esc(v) + '</span>' : ''}`);
        return `<span class="tk-p">${esc(open)}</span><span class="tk-k">${esc(name)}</span>${a}<span class="tk-p">${esc(close)}</span>`;
      });
  }

  /* ---------- CSS highlighter: selectors bold, custom properties red, comments light ---------- */
  function highlightCss(src) {
    return String(src).replace(/(\/\*[\s\S]*?\*\/)|(--[\w-]+)|([^{};\n]+)(\{)|("[^"]*")|(\b\d+(?:\.\d+)?(?:px|em|ch|%|s|ms|deg)?\b)|([^])/g,
      (all, com, prop, sel, brace, str, num, ch) => {
        if (com) return `<span class="tk-c">${esc(com)}</span>`;
        if (prop) return `<span class="tk-e">${esc(prop)}</span>`;
        if (sel) return `<span class="tk-k">${esc(sel)}</span><span class="tk-p">{</span>`;
        if (str) return `<span class="tk-s">${esc(str)}</span>`;
        if (num) return `<span class="tk-n">${esc(num)}</span>`;
        return esc(ch);
      });
  }

  /* ---------- markdown: headings, fences and callout openers, so a source pane reads as structure ---------- */
  function highlightMd(src) {
    let inFence = false, inSvg = false;
    return String(src).split('\n').map((L) => {
      if (/^```/.test(L)) { const open = !inFence; inFence = open; inSvg = open && /^```svg/.test(L); return `<span class="tk-c">${esc(L)}</span>`; }
      if (inFence) return inSvg ? highlightHtml(L) : `<span class="tk-s">${esc(L)}</span>`;
      if (/^#{1,4}\s/.test(L)) return `<span class="tk-k">${esc(L)}</span>`;
      if (/^>\s?\*\*/.test(L)) return esc(L).replace(/^(&gt;\s?)(\*\*[^*]+\*\*)/, '<span class="tk-p">$1</span><span class="tk-e">$2</span>');
      return esc(L).replace(/(\$[^$\n]+\$)/g, '<span class="tk-s">$1</span>').replace(/(\]\()(lab:[^)\s]+)(\))/g, '$1<span class="tk-e">$2</span>$3');
    }).join('\n');
  }

  /* ---------- the dialect ---------- */
  const slug = (s) => String(s).toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const CALLOUTS = [[/^(try it|try|play)\b/i, 'try'], [/^(exercise|exercises|challenge)\b/i, 'exercise'], [/^(caveat|careful|warning|watch out|note)\b/i, 'caveat']];
  function fnv(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

  function makeRenderer(opts = {}) {
    const texFn = opts.tex || ((src, display) => display ? `<pre class="tex">${esc(src)}</pre>` : `<code class="tex">${esc(src)}</code>`);
    const labLink = opts.lab || ((href, text) => `<a href="#" class="lablink" data-lab="${esc(href)}">${text}</a>`);
    function inline(s) {
      const keep = []; const stash = (h) => `\u0000${keep.push(h) - 1}\u0000`;
      s = s.replace(/`([^`]+)`/g, (_, c) => stash(`<code>${esc(c)}</code>`));
      s = s.replace(/\$\$([^$]+)\$\$/g, (_, m) => stash(texFn(m, true)));
      s = s.replace(/(^|[^\\$\w])\$([^$\n]+?)\$(?![\w$])/g, (_, pre, m) => pre + stash(texFn(m, false)));
      s = esc(s).replace(/\\\$/g, '$');
      s = s.replace(/\[([^\]]+)\]\((lab:(?:[^()\n]|\([^()\n]*\))*|[^)\s]+)\)/g, (_, text, href) => {
        const h = href.replace(/&amp;/g, '&');
        if (/^lab:/.test(h)) return labLink(h, text);
        if (/^#/.test(h)) return `<a href="#${esc(h.slice(1))}">${text}</a>`;
        if (/^https?:/.test(h)) return `<a href="${esc(h)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
        return text;
      });
      s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<i>$2</i>').replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<i>$2</i>');
      return s.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[+i]);
    }
    function sanitizeSvg(src) {
      let s = String(src).trim();
      if (!/^<svg[\s>]/.test(s)) return null;
      s = s.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|foreignObject|iframe|image)\b[\s\S]*?<\/\1\s*>/gi, '').replace(/<(script|style|foreignObject|iframe|image)\b[^>]*\/>/gi, '');
      s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/\s(xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, '');
      const p = 'f' + fnv(s) + '-';
      s = s.replace(/\sid\s*=\s*"([^"]+)"/g, ` id="${p}$1"`).replace(/url\(#([^)]+)\)/g, `url(#${p}$1)`).replace(/(\s(?:xlink:)?href\s*=\s*")#([^"]+)"/g, `$1#${p}$2"`);
      const root = s.match(/^<svg\b[^>]*>/)[0];
      const vb = (root.match(/viewBox\s*=\s*"([^"]+)"/) || [])[1], w = +((root.match(/\swidth\s*=\s*"([\d.]+)/) || [])[1] || (vb ? vb.trim().split(/[\s,]+/)[2] : 0));
      let r = root.replace(/\s(width|height|style|class)\s*=\s*"[^"]*"/g, '');
      if (!/xmlns=/.test(r)) r = r.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
      r = r.replace(/>$/, ` class="figsvg"${w ? ` style="max-width:${w}px"` : ''}>`);
      return s.replace(/^<svg\b[^>]*>/, r);
    }
    function figure(src, cap) {
      const svg = sanitizeSvg(src);
      if (!svg) return `<pre class="src">${esc(src)}</pre>`;
      const label = cap.replace(/[*_`$\\]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
      return `<figure class="fig">${label ? svg.replace(/^<svg\b/, `<svg role="img" aria-label="${esc(label)}"`) : svg}${cap ? `<figcaption>${inline(cap)}</figcaption>` : ''}</figure>`;
    }
    function listHtml(items, start, ind) {
      const ord = items[start] && items[start].ord, parts = []; let i = start;
      while (i < items.length && items[i].ind >= ind) {
        if (items[i].ind > ind) { const sub = listHtml(items, i, items[i].ind); parts[parts.length - 1] = parts[parts.length - 1].replace(/<\/li>$/, sub.html + '</li>'); i = sub.next; continue; }
        parts.push(`<li>${inline(items[i].text)}</li>`); i++;
      }
      return { html: `<${ord ? 'ol' : 'ul'}>${parts.join('')}</${ord ? 'ol' : 'ul'}>`, next: i };
    }
    function render(md, o = {}) {
      const lines = String(md || '').replace(/\r/g, '').split('\n'), out = [], toc = [], para = [];
      let i = 0;
      const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para.length = 0; } };
      while (i < lines.length) {
        const L = lines[i];
        let m = L.match(/^```\s*([\w-]*)\s*$/);
        if (m) {
          flush();
          const lang = m[1].toLowerCase(), body = []; i++;
          while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
          i++;
          if (lang === 'math' || lang === 'tex' || lang === 'latex') out.push(`<div class="mathblock">${texFn(body.join('\n'), true)}</div>`);
          else if (lang === 'svg') {
            let j = i; while (j < lines.length && /^\s*$/.test(lines[j])) j++;
            let cap = '';
            if (j < lines.length && /^\s*\*{0,2}_?Figure\s+[\w.]+/.test(lines[j])) { const c = []; while (j < lines.length && !/^\s*$/.test(lines[j])) c.push(lines[j++].trim()); cap = c.join(' '); i = j; }
            out.push(figure(body.join('\n'), cap));
          } else {
            const code = body.join('\n');
            const hl = (lang === 'js' || lang === 'javascript') ? highlight(code) : (lang === 'html' || lang === 'svgsrc') ? highlightHtml(code) : lang === 'css' ? highlightCss(code) : lang === 'md' ? highlightMd(code) : esc(code);
            out.push(`<pre class="src${lang ? ' lang-' + lang : ''}">${hl}</pre>`);
          }
          continue;
        }
        if (/^\s*\$\$/.test(L)) {
          flush();
          let body = L.replace(/^\s*\$\$/, '');
          if (/\$\$\s*$/.test(body)) { out.push(`<div class="mathblock">${texFn(body.replace(/\$\$\s*$/, ''), true)}</div>`); i++; continue; }
          const parts = [body]; i++;
          while (i < lines.length && !/\$\$\s*$/.test(lines[i])) parts.push(lines[i++]);
          if (i < lines.length) parts.push(lines[i].replace(/\$\$\s*$/, ''));
          i++; out.push(`<div class="mathblock">${texFn(parts.join('\n'), true)}</div>`); continue;
        }
        m = L.match(/^(#{1,4})\s+(.*)$/);
        if (m) { flush(); const lvl = m[1].length, text = m[2].trim(), id = slug(text); if (lvl === 2) toc.push({ id, text }); out.push(`<h${lvl} id="${o.idPrefix || ''}${id}">${inline(text)}</h${lvl}>`); i++; continue; }
        if (/^\s*(---|\*\*\*|___)\s*$/.test(L)) { flush(); out.push('<hr>'); i++; continue; }
        if (/^\s*\|.*\|\s*$/.test(L) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
          flush();
          const row = (s) => s.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
          const head = row(L), aligns = row(lines[i + 1]).map((c) => /:$/.test(c) ? (/^:/.test(c) ? 'center' : 'right') : 'left');
          i += 2; const rows = [];
          while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(row(lines[i++]));
          const al = (k) => aligns[k] && aligns[k] !== 'left' ? ` style="text-align:${aligns[k]}"` : '';
          out.push(`<div class="tablewrap-x"><table><thead><tr>${head.map((c, k) => `<th${al(k)}>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, k) => `<td${al(k)}>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
          continue;
        }
        if (/^>\s?/.test(L)) {
          flush(); const body = [];
          while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
          const first = body.join(' ').replace(/^\*\*([^*]+)\*\*.*/, '$1').trim();
          let cls = ''; for (const [re, c] of CALLOUTS) if (re.test(first)) { cls = c; break; }
          out.push(`<div class="callout ${cls}">${render(body.join('\n'), Object.assign({}, o, { inner: true })).html}</div>`);
          continue;
        }
        if (/^\s*([-*+]|\d+[.)])\s+/.test(L)) {
          flush(); const items = [];
          while (i < lines.length && (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
            const mm = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
            if (mm) items.push({ ind: mm[1].length, ord: /\d/.test(mm[2]), text: mm[3] }); else items[items.length - 1].text += ' ' + lines[i].trim();
            i++;
          }
          out.push(listHtml(items, 0, items.length ? items[0].ind : 0).html); continue;
        }
        if (/^\s*$/.test(L)) { flush(); i++; continue; }
        para.push(L.trim()); i++;
      }
      flush();
      let html = out.join('\n');
      if (!o.inner && o.toc !== false && toc.length >= 3) html = html.replace(/(<\/h1>\s*(?:<p>[\s\S]*?<\/p>)?)/, `$1\n<nav class="toc">${toc.map((t) => `<a href="#${o.idPrefix || ''}${t.id}">${esc(t.text.replace(/[`*$]/g, ''))}</a>`).join('')}</nav>`);
      return { html, toc };
    }
    return { render, inline, figure, sanitizeSvg };
  }

  /* ---------- lint: the chapter checker's rules that can run in a browser ---------- */
  const SVG_CLASSES = new Set(['ink', 'mut', 'acc', 'hair', 'f-ink', 'f-mut', 'f-acc', 'f-fill', 'f-fill2', 'f-paper', 'f-sel', 'dash', 'dot', 'lbl', 'it', 'b']);
  function lintSvg(src, ln, out) {
    const s = src.trim();
    if (!/^<svg[\s>]/.test(s)) out.push({ ln, level: 'error', msg: 'An svg figure must start with <svg.' });
    if (!/viewBox="/.test(s)) out.push({ ln, level: 'error', msg: 'The svg needs a viewBox (no width or height attributes).' });
    if (/<(script|style|foreignObject|iframe|image)\b/i.test(s)) out.push({ ln, level: 'error', msg: 'script, style, foreignObject, iframe and image are stripped by the renderer.' });
    if (/\s(xlink:)?href="(?!#)/.test(s)) out.push({ ln, level: 'error', msg: 'Only #id hrefs survive; external hrefs are stripped.' });
    if (/\b(fill|stroke)="#(?!fff\b|ffffff\b)[0-9a-fA-F]{3,6}"/.test(s)) out.push({ ln, level: 'warn', msg: 'A hard-coded colour will not follow the dark theme; use the class vocabulary.' });
    for (const m of s.matchAll(/class="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) if (c && !SVG_CLASSES.has(c)) out.push({ ln, level: 'error', msg: `Class "${c}" is not in the figure vocabulary.` });
  }
  function lint(md, ctx = {}) {
    const out = [], lines = String(md).split('\n'); let i = 0, h1 = 0, figs = 0;
    const chapter = ctx.chapter;
    const texOk = (src, ln) => { if (ctx.katex) { try { ctx.katex.renderToString(src, { throwOnError: true, strict: false, output: 'mathml' }); } catch (e) { out.push({ ln, level: 'error', msg: 'KaTeX: ' + String(e.message).split('\n')[0] }); } } };
    const inlineChecks = (s, ln) => {
      const t = s.replace(/`[^`]+`/g, '');
      t.replace(/\$\$([^$]+)\$\$/g, (_, m) => texOk(m, ln));
      t.replace(/(^|[^\\$\w])\$([^$\n]+?)\$(?![\w$])/g, (_, p, m) => texOk(m, ln));
      if (/<\/?(div|span|b|i|em|strong|br|p|img|a|sub|sup|table)\b[^>]*>/i.test(t.replace(/\$[^$]*\$/g, ''))) out.push({ ln, level: 'error', msg: 'Raw HTML in prose is escaped by the renderer; use markdown.' });
      for (const m of t.matchAll(/\]\((lab:[^)\s]*)\)/g)) {
        const mm = m[1].match(/^lab:([a-z]+)\?(.*)$/);
        if (!mm) { out.push({ ln, level: 'error', msg: `Malformed lab link ${m[1]}.` }); continue; }
        const q = Object.fromEntries(mm[2].split('&').map((kv) => kv.split('=')));
        if (mm[1] === 'demo' && ctx.demos && !ctx.demos.has(q.id)) out.push({ ln, level: 'error', msg: `Unknown demo id ${q.id}.` });
        else if (mm[1] === 'sketch' && ctx.sketches && !ctx.sketches.has(q.id)) out.push({ ln, level: 'error', msg: `No sketch called ${q.id}.` });
        else if (!['demo', 'sketch', 'book'].includes(mm[1])) out.push({ ln, level: 'error', msg: `Unknown lab verb ${mm[1]}; use demo, sketch or book.` });
      }
    };
    let para = [], pln = 0;
    const flush = () => { if (para.length) inlineChecks(para.join(' '), pln); para = []; };
    while (i < lines.length) {
      const L = lines[i];
      const f = L.match(/^```\s*([\w-]*)\s*$/);
      if (f) {
        flush(); const start = i + 1, body = []; i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
        if (i >= lines.length) out.push({ ln: start, level: 'error', msg: 'Unclosed code fence.' });
        i++;
        if (f[1] === 'svg') {
          figs++; lintSvg(body.join('\n'), start, out);
          let j = i; while (j < lines.length && /^\s*$/.test(lines[j])) j++;
          if (!(j < lines.length && /^\s*\*{0,2}_?Figure\s+[\w.]+/.test(lines[j]))) out.push({ ln: start, level: 'error', msg: 'A figure must be followed by a "**Figure N.k.**" caption paragraph.' });
        }
        continue;
      }
      const h = L.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        flush();
        if (h[1].length === 1) h1++;
        if (h[1].length === 2 && chapter && !new RegExp(`^${chapter}\\.\\d+\\s`).test(h[2]) && !/^(Key points|Exercises|Further reading|Demos in this chapter|Code in this chapter)/.test(h[2])) out.push({ ln: i + 1, level: 'warn', msg: `Section "${h[2]}" is not numbered ${chapter}.k.` });
        inlineChecks(h[2], i + 1); i++; continue;
      }
      if (/^\s*$/.test(L)) { flush(); i++; continue; }
      if (!para.length) pln = i + 1;
      para.push(L.trim()); i++;
    }
    flush();
    if (h1 !== 1) out.push({ ln: 1, level: 'error', msg: `Expected exactly one "# Title" line; found ${h1}.` });
    return { issues: out, figs };
  }

  const api = { esc, highlight, highlightLines, highlightHtml, highlightCss, highlightMd, makeRenderer, lint, lintSvg, SVG_CLASSES: [...SVG_CLASSES] };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KilnMD = api;
})(typeof window !== 'undefined' ? window : globalThis);


