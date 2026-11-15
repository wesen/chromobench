export default async ({ page }) => {
  return await page.evaluate(() => {
    const out = {};
    const strip = [...document.querySelectorAll('*')].filter(e => e.innerText === 'landscape-negative.tif' && e.children.length < 3).map(e => { const r = e.getBoundingClientRect(); return [e.tagName, e.className, r.x, r.y, r.width, r.height]; });
    out.strip = strip;
    const imgs = [...document.querySelectorAll('img, canvas')].map(e => { const r = e.getBoundingClientRect(); return [e.tagName, e.className, Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; });
    out.imgs = imgs;
    const cb = window.chromobench; out.keys = Object.keys(cb);
    out.entries = cb.entries?.()?.slice?.(-10);
    return JSON.parse(JSON.stringify(out, (k, v) => typeof v === 'function' ? undefined : v));
  });
};
