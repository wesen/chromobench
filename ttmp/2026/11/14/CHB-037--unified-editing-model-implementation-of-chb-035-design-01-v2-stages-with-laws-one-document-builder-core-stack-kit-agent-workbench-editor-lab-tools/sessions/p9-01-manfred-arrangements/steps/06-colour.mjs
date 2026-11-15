const { waitRender, count, drag, sample, readP } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {};
  r.before = await sample(page);
  // He is a dichroic-head printer: print too blue -> take yellow out. Y is at 0; try to drag it left.
  let n = await count(page); let t0 = Date.now();
  r.yDrag = await drag(page, 'Filtration Y', -40);
  r.yRender = await waitRender(page, n, t0, 8000);
  r.afterY = await sample(page);
  await shot('07-filtration-y-minus');
  // Then he tries the printer lights: B is +2 pt. Too blue print: more blue light -> more yellow on the paper.
  n = await count(page); t0 = Date.now();
  r.bDrag = await drag(page, 'Printer lights B', 15);
  r.bRender = await waitRender(page, n, t0, 8000);
  r.afterB = await sample(page);
  r.probe = await readProbe();
  await shot('08-printer-lights-b');
  return r;
};
