import fs from 'node:fs';
import { assembleEngine, WASM, OPENTYPE } from '../../engine/assemble.mjs';
const out = 'test/perf/www';
fs.mkdirSync(out + '/photos', { recursive: true });
fs.writeFileSync(out + '/engine.js', fs.readFileSync(OPENTYPE, 'utf8') + '\n;\n' + assembleEngine());
for (const w of WASM) fs.copyFileSync(w, out + '/' + w.split('/').pop());
for (const f of fs.readdirSync('assets/photos')) fs.copyFileSync('assets/photos/' + f, out + '/photos/' + f);
fs.writeFileSync(out + '/index.html', `<!doctype html><meta charset=utf-8><body><script>
(async () => {
  const w = new Worker('engine.js'); let seq = 0; const wait = new Map();
  w.onmessage = e => { const m = e.data; if (m.type === 'ready') return; const p = wait.get(m.id); if (p) { wait.delete(m.id); p(m); } };
  const post = (m, t) => new Promise(r => { const id = ++seq; wait.set(id, r); w.postMessage(Object.assign({ id }, m), t || []); });
  await new Promise(r => setTimeout(r, 300));
  await post({ type: 'init', base: new URL('.', location.href).href, maxSide: 2048 });
  for (const n of ['kodim05.jpg', 'kodim23.jpg']) { const b = await (await fetch('photos/' + n)).blob(); await post({ type: 'asset', name: n, blob: b }); }
  const c = await post({ type: 'compile', code: \`
    const src = ck.ui.input('src', 'kodim05.jpg'), max = ck.ui.input('max', 768), dev = ck.ui.input('develop', {})
    const img = ck.image(src, { max })
    img.develop(dev).as('render')
    img.as('original')
  \` });
  const log = [JSON.stringify(c)];
  const times = [];
  for (const [i, max] of [[0, 768], [1, 768], [2, 384], [3, 768], [4, 768]]) {
    const t = performance.now();
    const r = await post({ type: 'render', epoch: i, values: { src: 'kodim05.jpg', max, develop: { light: { exposure: 0.1 * i, contrast: 10 * i, highlights: -20, shadows: 15 }, color: { vibrance: 10 } } }, items: [{ key: 'v', out: 'render', max }] });
    times.push([max, Math.round(performance.now() - t), r.ms, Object.keys(r.views), JSON.stringify(r.errors)]);
  }
  log.push(JSON.stringify(times));
  const t = performance.now();
  const px = await post({ type: 'pixels', out: 'render', values: { src: 'kodim23.jpg', max: 256, develop: { light: { exposure: 0.5 } } }, max: 256 });
  log.push('pixels ' + px.ok + ' ' + px.w + 'x' + px.h + ' ' + Math.round(performance.now() - t) + 'ms ' + (px.message || ''));
  document.title = 'done'; document.body.textContent = log.join('\\n');
})();
</script>`);
