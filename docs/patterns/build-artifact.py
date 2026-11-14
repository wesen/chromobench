#!/usr/bin/env python3
"""Builds one HTML page (a claude.ai Artifact) from the pattern chapters.

usage: build-artifact.py OUT_HTML
Converts 00-overview.md … 12-*.md and review/README.md with pandoc (GFM → HTML), rewrites cross-chapter links to
in-page anchors (#ch-NN), turns ```mermaid blocks into <pre class="mermaid"> for the viewer's renderer, and wraps
everything in a reading layout with a chapter sidebar.
"""
import glob
import html
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
out_path = sys.argv[1]

chapters = sorted(glob.glob(os.path.join(HERE, "[01][0-9]-*.md")))
parts = [(os.path.basename(p)[:2], p) for p in chapters] + [("rv", os.path.join(HERE, "review", "README.md"))]


def to_html(path: str) -> str:
    md = open(path, encoding="utf-8").read()
    md = re.sub(r"^---\n.*?\n---\n", "", md, flags=re.S)  # front matter, if any
    r = subprocess.run(["pandoc", "--from", "gfm", "--to", "html5", "--no-highlight"], input=md,
                       capture_output=True, text=True, check=True)
    h = r.stdout
    # cross-chapter links → anchors
    h = re.sub(r'href="(\d\d)-[a-z0-9-]+\.md"', r'href="#ch-\1"', h)
    h = re.sub(r'href="review/README\.md"', 'href="#ch-rv"', h)
    # mermaid: pandoc emits <pre class="mermaid"><code>…</code></pre>; the viewer wants <pre class="mermaid">text</pre>
    h = re.sub(r'<pre class="mermaid"><code>(.*?)</code></pre>', r'<pre class="mermaid">\1</pre>', h, flags=re.S)
    # wide tables scroll inside their own container
    h = h.replace("<table>", '<div class="tbl"><table>').replace("</table>", "</table></div>")
    return h


def title_of(path: str) -> str:
    for line in open(path, encoding="utf-8"):
        if line.startswith("# "):
            t = line[2:].strip()
            t = re.sub(r"^Chapter \d+ · ", "", t)
            return t.replace("★", "").strip()
    return os.path.basename(path)


nav, body = [], []
for key, path in parts:
    t = title_of(path)
    label = "Overview" if key == "00" else ("Validation" if key == "rv" else f"{int(key)} · {t}")
    stars = ""
    if key not in ("00", "rv"):
        first = open(path, encoding="utf-8").readline()
        stars = f'<span class="stars">{"★" * first.count("★")}</span>'
    nav.append(f'<a href="#ch-{key}">{html.escape(label)}{stars}</a>')
    body.append(f'<article id="ch-{key}" class="chapter">{to_html(path)}</article>')

page = f"""<title>Image Engine Patterns</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=IBM+Plex+Sans:ital,wght@0,400;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
/* Layout: a fixed chapter rail beside one 68ch reading column; on phones the rail becomes a menu at the top. */
:root {{
  --bg: #f6f6f4; --surface: #ffffff; --fg: #1d1f22; --muted: #5d6168; --line: #dcdcd8;
  --accent: #b8321e;            /* safelight red */
  --accent-soft: #f6e3de; --code-bg: #eeeeeb;
  --display: "Bricolage Grotesque", "Helvetica Neue", Arial, sans-serif;
  --body: "IBM Plex Sans", "Helvetica Neue", Arial, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, Menlo, monospace;
}}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{
  --bg: #15171a; --surface: #1c1f23; --fg: #e6e4df; --muted: #a2a5ab; --line: #30343a;
  --accent: #ff7a5c; --accent-soft: #3a211c; --code-bg: #22262b; color-scheme: dark; }} }}
:root[data-theme="dark"] {{
  --bg: #15171a; --surface: #1c1f23; --fg: #e6e4df; --muted: #a2a5ab; --line: #30343a;
  --accent: #ff7a5c; --accent-soft: #3a211c; --code-bg: #22262b; color-scheme: dark; }}
* {{ box-sizing: border-box; }}
body {{ background: var(--bg); color: var(--fg); font: 16px/1.62 var(--body); margin: 0; }}
.wrap {{ display: grid; grid-template-columns: 17rem minmax(0, 1fr); gap: 2.5rem; max-width: 78rem; margin: 0 auto;
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
  padding-block: 2rem 4rem; }}
nav.rail {{ position: sticky; top: calc(env(safe-area-inset-top, 0px) + 1.5rem); align-self: start; max-height: calc(100vh - 3rem);
  overflow-y: auto; display: flex; flex-direction: column; gap: .15rem; font-size: .9rem; }}
nav.rail .brand {{ font: 700 1.15rem/1.2 var(--display); margin-bottom: .9rem; letter-spacing: -.01em; }}
nav.rail .brand small {{ display: block; font: 400 .78rem/1.4 var(--body); color: var(--muted); margin-top: .3rem; }}
nav a {{ color: var(--fg); text-decoration: none; padding: .32rem .6rem; border-radius: 6px; display: flex; justify-content: space-between; gap: .5rem; }}
nav a:hover, nav a:focus-visible {{ background: var(--accent-soft); outline: none; }}
nav a.on {{ background: var(--accent-soft); color: var(--accent); font-weight: 600; }}
.stars {{ color: var(--accent); font-size: .75rem; letter-spacing: .05em; }}
details.menu {{ display: none; }}
main {{ min-width: 0; }}
.chapter {{ max-width: 46rem; padding-bottom: 3rem; margin-bottom: 3rem; border-bottom: 1px solid var(--line); }}
.chapter h1 {{ font: 700 clamp(1.8rem, 3.2vw, 2.5rem)/1.12 var(--display); letter-spacing: -.02em; text-wrap: balance; margin: 0 0 1rem; }}
.chapter h2 {{ font: 700 1.3rem/1.25 var(--display); margin: 2.4rem 0 .6rem; text-wrap: balance; }}
.chapter h3 {{ font: 600 1.05rem/1.3 var(--body); margin: 1.8rem 0 .4rem; }}
.chapter h1 + p em:only-child {{ color: var(--muted); }}
p, li {{ max-width: 68ch; }}
a {{ color: var(--accent); }}
strong {{ font-weight: 600; }}
code {{ font: .88em var(--mono); background: var(--code-bg); padding: .08em .3em; border-radius: 4px; }}
pre {{ background: var(--code-bg); border: 1px solid var(--line); border-radius: 8px; padding: .9rem 1rem; overflow-x: auto;
  font: .82rem/1.55 var(--mono); }}
pre code {{ background: none; padding: 0; font-size: inherit; }}
pre.mermaid {{ background: var(--surface); text-align: center; }}
blockquote {{ margin: 1.2rem 0; padding: .7rem 1rem; border-left: 3px solid var(--accent); background: var(--surface); border-radius: 0 8px 8px 0; }}
blockquote p {{ margin: .3rem 0; }}
.tbl {{ overflow-x: auto; margin: 1rem 0; }}
table {{ border-collapse: collapse; font-size: .88rem; min-width: 100%; }}
th, td {{ text-align: left; vertical-align: top; padding: .45rem .6rem; border-bottom: 1px solid var(--line); }}
th {{ font-weight: 600; color: var(--muted); font-size: .78rem; letter-spacing: .04em; text-transform: uppercase; }}
@media (max-width: 900px) {{
  .wrap {{ grid-template-columns: minmax(0, 1fr); gap: 1rem; }}
  nav.rail {{ display: none; }}
  details.menu {{ display: block; position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; background: var(--bg);
    padding-block: .6rem; border-bottom: 1px solid var(--line); }}
  details.menu summary {{ cursor: pointer; font: 700 1rem var(--display); }}
  details.menu nav {{ display: flex; flex-direction: column; margin-top: .5rem; font-size: .92rem; }}
  body::before {{ content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--bg); }}
}}
@media (prefers-reduced-motion: no-preference) {{ html {{ scroll-behavior: smooth; }} }}
</style>
<div class="wrap">
  <nav class="rail" aria-label="Chapters">
    <div class="brand">Image Engine Patterns<small>A pattern language for interactive image engines and their editors · 12 patterns</small></div>
    {''.join(nav)}
  </nav>
  <main>
    <details class="menu"><summary>Chapters</summary><nav aria-label="Chapters">{''.join(nav)}</nav></details>
    {''.join(body)}
  </main>
</div>
<script>
// highlight the chapter in view in the rail
(() => {{
  const links = [...document.querySelectorAll('nav.rail a')];
  const byId = new Map(links.map(a => [a.getAttribute('href').slice(1), a]));
  const io = new IntersectionObserver(es => {{
    for (const e of es) if (e.isIntersecting) {{ links.forEach(a => a.classList.remove('on')); byId.get(e.target.id)?.classList.add('on'); }}
  }}, {{ rootMargin: '-20% 0px -70% 0px' }});
  document.querySelectorAll('article.chapter').forEach(a => io.observe(a));
  document.querySelectorAll('details.menu nav a').forEach(a => a.addEventListener('click', () => a.closest('details').open = false));
}})();
</script>
"""
os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
open(out_path, "w", encoding="utf-8").write(page)
print(out_path, len(page) // 1024, "KiB")
