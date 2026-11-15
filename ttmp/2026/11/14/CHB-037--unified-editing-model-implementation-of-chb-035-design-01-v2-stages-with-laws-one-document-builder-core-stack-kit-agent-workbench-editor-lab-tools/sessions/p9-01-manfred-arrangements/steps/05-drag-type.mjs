const { waitRender, count, drag, typeInto, mainExp } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {}; await readProbe();
  let n = await count(page); let t0 = Date.now();
  r.drag = await drag(page, 'Time', 60);
  r.dragRender = await waitRender(page, n, t0); r.afterDrag = await mainExp(page);
  r.dragProbe = await readProbe();
  await shot('05-time-dragged');
  for (const v of ['7,5', 'abc', '0', '1000', '12s']) {
    n = await count(page); t0 = Date.now();
    const field = await typeInto(page, 'Time value', v);
    const rr = await waitRender(page, n, t0, 4000);
    r['typed ' + v] = { field, main: await mainExp(page), render: rr.doneMs ?? 'no render', probe: await readProbe() };
    if (v === 'abc') await shot('06-typed-abc');
  }
  return r;
};
