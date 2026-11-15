const { waitRender, count, sample, mainExp, typeInto } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {};
  for (const [f, v] of [['Time value', '7,5'], ['Filtration Y value', '-15'], ['Printer lights B value', '4']]) {
    const n = await count(page); const t0 = Date.now();
    r[f] = { field: await typeInto(page, f, v), render: (await waitRender(page, n, t0, 8000)).doneMs };
  }
  r.colours = await sample(page);
  r.main = await mainExp(page);
  r.probe = await readProbe();
  await shot('10-settled-print');
  return r;
};
