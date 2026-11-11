// Regressions from the QA review of Library, Cull and Develop: what the screen and the pixels show, not just state.
// mean colour of the viewport's canvas, or of a box in it ([x0, y0, x1, y1] as fractions)
const pixelsOf = (page, box = [0, 0, 1, 1], sel = '.ck-vp-c') => page.evaluate(([s, bx]) => {
  const c = document.querySelector(s); if (!c) return null;
  const x = c.getContext('2d'); const d = x.getImageData(Math.round(bx[0] * c.width), Math.round(bx[1] * c.height), Math.max(1, Math.round((bx[2] - bx[0]) * c.width)), Math.max(1, Math.round((bx[3] - bx[1]) * c.height))).data;
  let r = 0, g = 0, b = 0, sat = 0, n = 0;
  for (let i = 0; i < d.length; i += 16) { r += d[i]; g += d[i + 1]; b += d[i + 2]; sat += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]); n++; }
  return { r: r / n, g: g / n, b: b / n, sat: sat / n, lum: (r + g + b) / 3 / n, w: c.width, h: c.height };
}, [sel, box]);
const cell = (n = 2) => `.ck-gridview .ck-coll-cell >> nth=${n}`;

module.exports = {
  async qaCells({ page, st, ok, shot, idle }) {
    await page.click(cell(2));
    const picked = await st(['ui', 'selection', 'primary']);
    await page.keyboard.press('p'); await page.waitForTimeout(200);           // auto advance moves on after a flag
    ok(await page.locator(`.ck-gridview .lib-cell[data-id="${picked}"] .lib-flag.is-pick`).count() === 1, 'the grid cell shows the pick flag');
    const id = await st(['ui', 'selection', 'primary']);
    await page.evaluate(() => STUDIO.store.set(['prefs', 'autoAdvance'], false));
    await page.keyboard.press('4'); await page.keyboard.press('6');
    await page.waitForTimeout(300);
    const c = page.locator(`.ck-gridview .lib-cell[data-id="${id}"]`);
    ok(await c.locator('.lib-stars i.is-on').count() === 4, 'the grid cell shows 4 stars');
    ok(await c.evaluate(e => e.classList.contains('lb-red')), 'the grid cell shows the red label');
    const strip = page.locator(`.ck-filmstrip .lib-cell[data-id="${id}"]`);
    ok(await strip.locator('.lib-stars i.is-on').count() === 4, 'the filmstrip cell shows 4 stars');
    // index numbers follow the list, not the catalog
    await page.evaluate(() => STUDIO.store.set(['view', 'source'], 'collection:portraits'));
    await page.waitForTimeout(300);
    const nums = await page.locator('.ck-gridview .lib-cell-n').allInnerTexts();
    ok(nums.slice(0, 3).join(',') === '1,2,3', `a collection numbers its photos 1, 2, 3 (${nums.join(',')})`);
    await shot('cells');
  },

  async qaMetadata({ page, st, ok }) {
    await page.click(cell(0));
    const a = await st(['ui', 'selection', 'primary']);
    const cap = page.locator('.ck-panel[data-panel="metadata"] textarea').first();
    await cap.click(); await page.keyboard.type('Caption for A');
    await page.click(cell(1));                       // the click blurs the field: the caption must land on A
    await page.waitForTimeout(250);
    const b = await st(['ui', 'selection', 'primary']);
    const capA = await page.evaluate(id => STUDIO.store.peek(['catalog', 'photos']).find(p => p.id === id).caption, a);
    const capB = await page.evaluate(id => STUDIO.store.peek(['catalog', 'photos']).find(p => p.id === id).caption, b);
    ok(capA === 'Caption for A' && capB === '', `the caption goes to the photo it was typed for (A: "${capA}", B: "${capB}")`);
  },

  async qaDevelopPixels({ page, st, ok, shot, idle }) {
    await page.keyboard.press('d'); await idle(1800);
    const base = await pixelsOf(page);
    // Treatment: Black & White
    await page.click('.ck-panel[data-panel="basic"] .ck-seg-b:has-text("Black & White")');
    await idle(1500);
    const bw = await pixelsOf(page);
    ok(base && bw && base.sat > 10 && bw.sat < 3, `Black & White takes the colour out (saturation ${base && base.sat.toFixed(1)} → ${bw && bw.sat.toFixed(1)})`);
    await page.keyboard.press('Control+z'); await idle(1200);
    const edit = f => page.evaluate(src => { const id = STUDIO.store.peek(['ui', 'selection', 'primary']); STUDIO.store.tx('test', t => { (0, eval)(src)(t.dev[id]); }); }, f);
    // the canvas shows the photo inside a margin; measure well inside the picture
    const mid = [0.42, 0.42, 0.58, 0.58];
    const m0 = await pixelsOf(page, mid);
    // a radial mask at +2 EV brightens the middle
    await edit(`d => { d.masks = [{ id: 7, name: 'Radial', visible: true, invert: false, refine: 0, components: [{ op: 'add', invert: false, shape: { kind: 'radial', center: { x: 0.5, y: 0.5 }, rx: 0.2, ry: 0.2, angle: 0, feather: 30, invert: false } }], adjust: { exposure: 2 } }]; }`);
    await idle(1500);
    const m1 = await pixelsOf(page, mid);
    ok(m1.lum > m0.lum + 25, `a radial mask at +2 EV brightens its centre (${m0.lum.toFixed(0)} → ${m1.lum.toFixed(0)})`);
    await edit(`d => { d.masks = []; }`); await idle(1200);
    // a clone spot copies other pixels over the middle
    await edit(`d => { d.spots = [{ mode: 'clone', points: [{ x: 0.5, y: 0.5 }], size: 0.08, feather: 0, opacity: 100, source_offset: { x: -0.29, y: -0.28 } }]; }`);
    await idle(1500);
    const sp = await pixelsOf(page, [0.47, 0.47, 0.53, 0.53]), sp0 = m0;
    ok(Math.abs(sp.r - sp0.r) + Math.abs(sp.g - sp0.g) + Math.abs(sp.b - sp0.b) > 12, `a clone spot changes the pixels under it (Δ ${(Math.abs(sp.r - sp0.r) + Math.abs(sp.g - sp0.g) + Math.abs(sp.b - sp0.b)).toFixed(0)})`);
    await edit(`d => { d.spots = []; }`); await idle(1200);
    // a panel switch: a strong tone curve, then Tone Curve off
    const c0 = await pixelsOf(page);
    await edit(`d => { d.curve.shadows = 100; d.curve.darks = 100; }`); await idle(1500);
    const c1 = await pixelsOf(page);
    await page.click('.ck-panel[data-panel="tone-curve"] .ck-panel-sw'); await idle(1500);
    const c2 = await pixelsOf(page);
    ok(c1.lum > c0.lum + 8 && Math.abs(c2.lum - c0.lum) < 2, `switching Tone Curve off takes its effect away (${c0.lum.toFixed(0)} → ${c1.lum.toFixed(0)} → off ${c2.lum.toFixed(0)})`);
    await shot('develop-base');
  },

  async qaBuildReport({ page, ok }) {
    const all = await page.evaluate(() => STUDIO.diagnostics.list.filter(d => d.level !== 'info').map(d => d.format().split('\n').slice(0, 2).join(' ')));
    ok(all.length === 0, `the build report is clean${all.length ? ': ' + all.join(' | ') : ''}`);
  },

  async qaLibrary({ page, st, ok, shot, idle }) {
    const sel = () => st(['ui', 'selection']);
    // culling keys work in Loupe, and after clicking a panel
    await page.click(cell(1)); await page.keyboard.press('e'); await idle(600);
    const a = (await sel()).primary;
    await page.evaluate(() => STUDIO.store.set(['prefs', 'autoAdvance'], false));
    await page.keyboard.press('3'); await page.keyboard.press('x'); await page.keyboard.press('7');
    const pa = await page.evaluate(id => STUDIO.store.peek(['catalog', 'photos']).find(p => p.id === id), a);
    ok(pa.rating === 3 && pa.flag === 'reject' && pa.label === 'yellow', `rating, flag and label keys work in Loupe (${pa.rating}, ${pa.flag}, ${pa.label})`);
    await page.keyboard.press('g'); await idle(300);
    await page.click('.ck-panel[data-panel="keywording"] .ck-panel-t');
    await page.click('.ck-panel[data-panel="keywording"] .ck-panel-t');
    await page.keyboard.press('2');
    ok((await page.evaluate(id => STUDIO.store.peek(['catalog', 'photos']).find(p => p.id === id).rating, a)) === 2, 'the keys still work after clicking a panel header');
    // Clear Filters
    await page.evaluate(() => STUDIO.store.set(['view', 'filter'], { text: 'zzz', flag: 'picks', rating: 3, label: 'purple', edited: true }));
    await page.click('.lib-filter .ck-btn:has-text("Clear")'); await idle(300);
    const f = await st(['view', 'filter']);
    ok(!f.text && !f.flag && !f.rating && !f.label && !f.edited, `Clear empties every filter (${JSON.stringify(f)})`);
    // Compare: the arrows move the candidate, the select stays
    await page.click(cell(0)); await page.click(cell(1), { modifiers: ['Control'] });
    await page.keyboard.press('c'); await idle(800);
    const s0 = await sel();
    await page.keyboard.press('ArrowRight'); await idle(800);
    const s1 = await sel();
    ok(s1.ids.length === 2 && s1.primary === s0.primary && s1.ids.find(x => x !== s1.primary) !== s0.ids.find(x => x !== s0.primary), `→ in Compare moves the candidate (${s0.ids} → ${s1.ids})`);
    const cand = await page.getAttribute('.ck-vp[data-viewport="candidate"]', 'data-rendered').catch(() => null);
    ok(!!cand, `the candidate renders (${cand})`);
    // Survey: the arrows move the active photo within the survey
    await page.keyboard.press('g'); await idle(300);
    await page.click(cell(0)); await page.click(cell(2), { modifiers: ['Shift'] });
    await page.keyboard.press('n'); await idle(600);
    const v0 = await sel(); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(200);
    const v1 = await sel();
    ok(v1.ids.length === 3 && v1.primary !== v0.primary, `← in Survey keeps the three photos (${v1.ids.length}) and moves the active one`);
    // Folders: one click chooses
    await page.keyboard.press('g'); await idle(300);
    await page.click('.ck-panel[data-panel="folders"] .ck-coll-row >> nth=1'); await idle(300);
    ok(/^folder:/.test(await st(['view', 'source'])), 'one click on a folder shows it');
    await page.click('.ck-panel[data-panel="catalog"] .ck-coll-row >> nth=0'); await idle(300);
    // tool keys belong to Develop: R in Library does nothing
    await page.keyboard.press('r'); await page.waitForTimeout(200);
    ok((await st(['ui', 'tool'])) == null && (await st(['view', 'module'])) === 'library', 'R in Library does not pick the crop tool');
    // histogram at startup and in Loupe
    const h0 = await st(['ui', 'hist']);
    ok(!!h0, 'the Library histogram is there');
    // Remove Rejected moves the selection off the removed photo
    await page.click(cell(4)); const gone = (await sel()).primary; await page.keyboard.press('x');
    await page.evaluate(() => STUDIO.runCommand('photo.removeRejected')); await page.waitForTimeout(200);
    await page.click('.ck-dialog .ck-btn.is-primary'); await idle(400);
    const after = await sel();
    const ids = await page.evaluate(() => STUDIO.store.peek(['catalog', 'photos']).map(p => p.id));
    ok(!ids.includes(gone) && ids.includes(after.primary) && after.ids.every(x => ids.includes(x)), `after Remove Rejected the selection is on a photo that stayed (${after.primary})`);
    const counts = await page.evaluate(() => { const have = new Set(STUDIO.store.peek(['catalog', 'photos']).map(p => p.id)); return STUDIO.store.peek(['catalog', 'collections']).every(c => c.ids.every(id => have.has(id))); });
    ok(counts, 'collections lose the removed photos too');
    await shot('library');
  },

  async qaDevelopMore({ page, st, ok, shot, idle }) {
    await page.keyboard.press('d'); await idle(1500);
    const id = await st(['ui', 'selection', 'primary']);
    // a preset's hue is a position, not an amount
    await page.click('.dv-preset >> text="Color"'); await page.waitForTimeout(150);
    await page.evaluate(() => STUDIO.store.set(['ui', 'presetAmount'], 50));
    await page.click('.dv-preset >> text="Teal & Orange"'); await idle(1200);
    const sh = await st(['dev', id, 'grading', 'shadows']);
    ok(sh && sh.hue > 150 && sh.hue < 230, `Teal & Orange at 50% keeps a teal shadow hue (${sh && sh.hue})`);
    // crop: an aspect reshapes at once; a straightened crop stays inside the picture
    await page.keyboard.press('r'); await idle(600);
    await page.selectOption('.ck-panel[data-panel="crop-options"] select', { label: '1 × 1' }); await idle(500);
    const r = await st(['dev', id, 'crop', 'geometry', 'rect']);
    const ratio = ((r.x1 - r.x0) * 768) / ((r.y1 - r.y0) * 512);
    ok(Math.abs(ratio - 1) < 0.01, `choosing 1 × 1 makes the crop square (${ratio.toFixed(3)})`);
    await page.evaluate(() => { const id = STUDIO.store.peek(['ui', 'selection', 'primary']); STUDIO.store.tx('t', t => { t.dev[id].crop.geometry = { rect: { x0: 0, y0: 0, x1: 1, y1: 1 }, angle: 0 }; }); });
    await page.keyboard.press('Escape'); await idle(300);
    await page.evaluate(() => { const id = STUDIO.store.peek(['ui', 'selection', 'primary']); STUDIO.store.tx('t', t => { t.dev[id].crop.geometry.angle = 12; }); });
    await idle(1500);
    // the developed picture itself (not the window around it): its corners are photo, not black wedges
    const corner = await page.evaluate(async () => {
      const G = await import('/app/engine-graphs.js');
      const r = await STUDIO.engine.pixels(G.render, STUDIO.engine.values(G.render, STUDIO.store.current), { max: 256 });
      const at = (x, y) => { const i = (y * r.w + x) * 4; return (r.data[i] + r.data[i + 1] + r.data[i + 2]) / 3; };
      return Math.min(at(1, 1), at(r.w - 2, 1), at(1, r.h - 2), at(r.w - 2, r.h - 2));
    });
    ok(corner > 25, `a straightened photo has no black corners (darkest corner ${corner.toFixed(0)})`);
    await page.evaluate(() => { const id = STUDIO.store.peek(['ui', 'selection', 'primary']); STUDIO.store.tx('t', t => { t.dev[id].crop.geometry.angle = 0; }); });
    await idle(800);
    // a radial gradient's centre can be dragged after it is made
    await page.keyboard.press('Shift+M'); await idle(300);
    const vp = await page.locator('.ck-vp').first().boundingBox();
    const cx = vp.x + vp.width / 2, cy = vp.y + vp.height / 2;
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 60, cy + 40, { steps: 5 }); await page.mouse.up(); await idle(400);
    const m1 = await st(['dev', id, 'masks']);
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx - 80, cy, { steps: 5 }); await page.mouse.up(); await idle(400);
    const m2 = await st(['dev', id, 'masks']);
    ok(m1.length === 1 && m2.length === 1 && m2[0].components[0].shape.center.x < m1[0].components[0].shape.center.x - 0.05, `dragging a radial's centre moves it (${m1.length} → ${m2.length} masks)`);
    // a click without a drag makes no mask
    await page.mouse.click(vp.x + 60, vp.y + 60); await idle(300);
    ok((await st(['dev', id, 'masks'])).length === 1, 'a bare click makes no new mask');
    await page.keyboard.press('Escape');
    // the palette finds controls
    await page.keyboard.press('Control+k'); await page.keyboard.type('expo'); await page.waitForTimeout(150);
    const first = await page.locator('.ck-palette-r.is-active .ck-palette-t').innerText();
    const n = await page.locator('.ck-palette-r').count();
    ok(/^Exposure/.test(first) && n < 12, `the palette's first answer to "expo" is ${first} (${n} answers)`);
    await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    ok(await page.evaluate(() => document.activeElement && !!document.activeElement.closest('.ck-slider')), 'choosing it focuses the slider');
    // menus show the keys that work here
    await page.click('.ck-menubar-t:text-is("Edit")'); await page.waitForTimeout(150);
    const selAll = await page.locator('.ck-menu-i:has-text("Select All") .ck-menu-k').innerText().catch(() => '');
    ok(selAll === '', `Develop's Edit ▸ Select All shows no Library-only shortcut ("${selAll}")`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(100);
    ok(await page.locator('.ck-menubar-t.is-open').count() === 0, 'Escape lets go of the menu title');
    await shot('develop');
  },

  async qaCull({ page, st, ok, idle }) {
    await page.click(cell(0)); await page.click(cell(2), { modifiers: ['Shift'] });
    await page.keyboard.press('Alt+c'); await idle(600);
    const s = await st(['ui', 'selection']);
    ok(s.ids.length === 1, `Cull starts from one photo (${s.ids.length})`);
    await page.keyboard.press('End'); await page.waitForTimeout(150);
    const L = await page.evaluate(() => STUDIO.store.peek(['catalog', 'filtered']).map(p => p.id));
    ok((await st(['ui', 'selection', 'primary'])) === L[L.length - 1], 'End goes to the last photo');
  },
};
