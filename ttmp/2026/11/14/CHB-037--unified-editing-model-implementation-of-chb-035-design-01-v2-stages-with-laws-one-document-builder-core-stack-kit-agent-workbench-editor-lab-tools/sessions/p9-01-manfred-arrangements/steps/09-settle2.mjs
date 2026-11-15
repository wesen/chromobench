const { waitRender, count, sample, mainExp, typeInto } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {};
  for (const [f, v] of [['Filtration Y value', '-25'], ['Filtration M value', '5']]) {
    const n = await count(page); const t0 = Date.now();
    r[f] = { field: await typeInto(page, f, v), render: (await waitRender(page, n, t0, 8000)).doneMs };
  }
  r.colours = await sample(page);
  r.main = await mainExp(page);
  r.probe = await readProbe();
  await shot('11-settled-print-2');
  return r;
};
