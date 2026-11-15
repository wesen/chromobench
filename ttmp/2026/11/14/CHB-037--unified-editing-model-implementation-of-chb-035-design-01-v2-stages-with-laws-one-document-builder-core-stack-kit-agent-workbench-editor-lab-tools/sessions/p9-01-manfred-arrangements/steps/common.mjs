export const status = (page) => page.evaluate(() => (document.body.innerText.match(/rendered (\d+) · ([^\n]*)/) || [null, '-1', ''])).catch(() => [null, '-1', '']);
// Wait until the "rendered N · done" counter moves past `from` and says done; returns ms.
export async function waitRender(page, from, t0 = Date.now(), max = 120000) {
  let first = null;
  while (Date.now() - t0 < max) {
    const [, n, word] = await status(page);
    if (+n > from && first == null) first = Date.now() - t0;
    if (+n > from && /done/.test(word)) return { firstMs: first, doneMs: Date.now() - t0, n: +n, word };
    await page.waitForTimeout(150);
  }
  return { timeout: true, ms: Date.now() - t0, status: await status(page) };
}
export const count = async (page) => +(await status(page))[1];
export const history = (page) => page.evaluate(() => {
  const h = [...document.querySelectorAll('*')].find(e => e.innerText?.trim() === 'History' && e.children.length === 0);
  const panel = h?.closest('.ck-panel, section, [class*=panel]') ?? h?.parentElement?.parentElement;
  return panel?.innerText?.split('\n').slice(0, 40);
});
export const lum = (page) => page.evaluate(() => {
  // mean RGB of the visible print on screen (measurement only)
  const c = document.querySelector('canvas.ck-vp-c'); return c ? null : null;
});
// screen position of a range input's thumb (as a user sees it)
export const thumbOf = (page, label) => page.evaluate((label) => {
  const s = document.querySelector(`input[type=range][aria-label="${label}"]`); const r = s.getBoundingClientRect();
  const f = (s.value - s.min) / (s.max - s.min); return { x: r.x + 8 + f * (r.width - 16), y: r.y + r.height / 2, value: s.value, text: s.getAttribute('aria-valuetext') };
}, label);
export async function drag(page, label, dx, steps = 15) {
  const t = await thumbOf(page, label);
  await page.mouse.move(t.x, t.y); await page.mouse.down();
  for (let i = 1; i <= steps; i++) { await page.mouse.move(t.x + (dx * i) / steps, t.y); await page.waitForTimeout(30); }
  await page.mouse.up();
  return { before: t.text, after: (await thumbOf(page, label)).text };
}
export async function typeInto(page, label, text) {
  const f = page.getByLabel(label, { exact: true }); await f.click(); await f.fill(''); await f.type(text); await f.press('Enter');
  await page.waitForTimeout(300);
  return page.evaluate((label) => { const e = document.querySelector(`[aria-label="${label}"]`); return { value: e.value, cls: e.className, invalid: e.getAttribute('aria-invalid') }; }, label);
}
export const mainExp = (page) => page.evaluate(() => document.body.innerText.match(/Main exposure\n([^\n]*)/)?.[1]);
export const toasts = (p) => p.toasts?.map(t => t[2]);
// Mean screen RGB in named boxes (screen px) — measurement only, from a screenshot of the page.
export const BOX = { sky: [300, 170, 400, 60], skyHigh: [600, 160, 150, 30], wall: [400, 520, 50, 50], door: [462, 540, 25, 50], hills: [700, 640, 300, 80], fg: [400, 700, 600, 50] };
export async function sample(page, boxes = BOX) {
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(async ({ png, boxes }) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode();
    const c = new OffscreenCanvas(img.width, img.height); const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const out = {};
    for (const [k, [x, y, w, h]] of Object.entries(boxes)) {
      const d = g.getImageData(x, y, w, h).data; let r = 0, gg = 0, b = 0; const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
      out[k] = [Math.round(r / n), Math.round(gg / n), Math.round(b / n)];
    }
    return out;
  }, { png, boxes });
}
