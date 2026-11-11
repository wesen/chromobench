// Scenarios: each is what a person does, with checks on the state that results.
const box = async (page, sel) => { const b = await page.locator(sel).first().boundingBox(); if (!b) throw new Error('no ' + sel); return b; };
const slider = label => `.ck-slider:has(.ck-slider-l:text-is("${label}")) .ck-slider-t`;

module.exports = {
  async developDrag({ page, st, ok, shot, idle }) {
    await page.keyboard.press('d');
    await idle(1500);
    const t = await box(page, slider('Exposure'));
    const y = t.y + t.height / 2;
    await page.mouse.move(t.x + t.width / 2, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(t.x + t.width / 2 + i * 6, y); await page.waitForTimeout(30); }
    const during = await page.evaluate(() => ({ doc: STUDIO.store.doc.dev.kodim01.light.exposure, cur: STUDIO.store.current.dev.kodim01.light.exposure, prev: STUDIO.store.previewing }));
    ok(during.prev && during.doc === 0 && during.cur > 0, `a drag previews (document ${during.doc}, shown ${during.cur})`);
    await page.mouse.up();
    await idle(800);
    const after = await st(['dev', 'kodim01', 'light', 'exposure']);
    ok(after > 0, `the drag committed: exposure ${after}`);
    const hist = await page.evaluate(() => STUDIO.history.entries.map(e => e.label + (e.detail ? ' ' + e.detail : '')));
    ok(hist.length === 1 && /Exposure/.test(hist[0]), `one undo step: ${JSON.stringify(hist)}`);
    const shared = await page.evaluate(() => STUDIO.store.doc.dev.kodim02 === STUDIO.store.doc.devDefaults);
    ok(shared, 'other photos still share the defaults');
    await shot('after-drag');
    await page.keyboard.press('Control+z');
    await idle(600);
    ok((await st(['dev', 'kodim01', 'light', 'exposure'])) === 0, 'Mod+Z undoes it');
    await page.keyboard.press('Control+Shift+z');
    ok((await st(['dev', 'kodim01', 'light', 'exposure'])) === after, 'Mod+Shift+Z redoes it');
    // keyboard: focus the Contrast track, nudge three times = one step
    await page.click(slider('Contrast'));
    const c0 = await st(['dev', 'kodim01', 'light', 'contrast']);
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    const c1 = await st(['dev', 'kodim01', 'light', 'contrast']);
    const n = await page.evaluate(() => STUDIO.history.entries.length);
    ok(c1 > c0 && n === 2, `three nudges, one more history entry (contrast ${c0}→${c1}, entries ${n})`);
    // double-click the label resets
    await page.dblclick('.ck-slider-l:text-is("Contrast")');
    ok((await st(['dev', 'kodim01', 'light', 'contrast'])) === 0, 'double-click on the label resets');
    // the History panel lists this photo's steps
    await page.click('.ck-docktab:has-text("History")');
    await page.waitForTimeout(150);
    const rows = await page.locator('.dv-hist-r').allInnerTexts();
    ok(rows.length === 4 && /Import/.test(rows[rows.length - 1]), `History panel: ${rows.map(r => r.replace(/\n/g, ' ')).join(' | ')}`);
    await page.locator('.dv-hist-r').nth(2).click();
    ok((await st(['dev', 'kodim01', 'light', 'exposure'])) === after && (await st(['dev', 'kodim01', 'light', 'contrast'])) === 0, 'clicking a history step restores that state');
    await page.keyboard.press('\\');
    await idle(900);
    ok((await st(['view', 'compare'])) === 'before', '\\ shows Before');
    await shot('before');
    await page.keyboard.press('y');
    await idle(1200);
    ok((await st(['view', 'compare'])) === 'lr', 'Y: before/after side by side');
    await shot('left-right');
    await page.keyboard.press('Escape');
  },
};

Object.assign(module.exports, {
  async libraryKeys({ page, st, ok, shot, idle }) {
    await page.click('.ck-gridview .ck-coll-cell >> nth=0');
    await page.keyboard.press('p');
    const f = await page.evaluate(() => STUDIO.store.doc.catalog.photos.find(p => p.id === 'kodim01').flag);
    ok(f === 'pick', 'P flags the photo as a pick');
    const prim = await st(['ui', 'selection', 'primary']);
    ok(prim !== 'kodim01', `auto advance moved on (${prim})`);
    await page.keyboard.press('x');
    await page.keyboard.press('3');
    const r = await page.evaluate(() => STUDIO.store.doc.catalog.photos.map(p => p.flag || p.rating).filter(Boolean));
    ok(r.length >= 2, `flags and ratings landed: ${JSON.stringify(r)}`);
    await page.keyboard.press('Control+a');
    ok((await st(['ui', 'selection', 'ids'])).length === 24, 'Mod+A selects all');
    await page.keyboard.press('Control+d');
    ok((await st(['ui', 'selection', 'ids'])).length === 1, 'Mod+D selects one');
    // filter: picks only
    await page.click('.lib-filter .ck-seg-b:has-text("Picks")');
    await page.waitForTimeout(200);
    const n = await page.locator('.ck-gridview .ck-coll-cell').count();
    ok(n === 1, `the Picks filter shows ${n} photo`);
    await shot('picks');
    await page.click('.lib-filter .ck-seg-b:has-text("All")');
    // shift-click a range, then survey
    await page.click('.ck-gridview .ck-coll-cell >> nth=2');
    await page.click('.ck-gridview .ck-coll-cell >> nth=5', { modifiers: ['Shift'] });
    ok((await st(['ui', 'selection', 'ids'])).length === 4, 'Shift-click selects a range of 4');
    await page.keyboard.press('n');
    await idle(900);
    ok((await st(['view', 'mode'])) === 'survey', 'N opens Survey');
    await shot('survey');
    await page.keyboard.press('c');
    await idle(1500);
    ok((await st(['view', 'mode'])) === 'compare', 'C opens Compare');
    await shot('compare');
    await page.keyboard.press('g');
    // palette
    await page.keyboard.press('Control+k');
    await page.keyboard.type('reject');
    await page.waitForTimeout(150);
    await shot('palette');
    const first = await page.locator('.ck-palette-r.is-active .ck-palette-t').innerText();
    ok(/^Set as Rejected/i.test(first), `the palette finds "${first}" (Library's, not another module's)`);
    await page.keyboard.press('Escape');
    // menus follow the module: Library has no Tools menu, Develop has no Library menu
    const bar = () => page.evaluate(() => [...document.querySelectorAll('.ck-menubar-t')].filter(b => !b.hidden).map(b => b.textContent));
    const inLib = await bar();
    ok(inLib.includes('Library') && !inLib.includes('Tools'), `Library's menu bar: ${inLib.join(' ')}`);
    await page.keyboard.press('d');
    await idle(400);
    const inDev = await bar();
    ok(inDev.includes('Tools') && !inDev.includes('Library'), `Develop's menu bar: ${inDev.join(' ')}`);
    await page.keyboard.press('g');
    await idle(400);
    // shortcut sheet
    await page.keyboard.press('Control+/');
    await page.waitForTimeout(150);
    const sheet = await page.locator('.ck-sheet-r').count();
    ok(sheet > 40, `the shortcut sheet lists ${sheet} keys`);
    await shot('sheet');
    await page.keyboard.press('Escape');
    // a disabled command explains itself
    await page.click('.ck-menubar-t:text-is("Edit")');
    await page.waitForTimeout(120);
    await shot('menu');
    await page.keyboard.press('Escape');
  },
  async crop({ page, st, ok, shot, idle }) {
    await page.keyboard.press('d'); await idle(1500);
    await page.keyboard.press('r'); await idle(1500);
    ok((await st(['ui', 'tool'])) === 'crop', 'R opens the crop tool');
    const vp = await (await page.locator('.ck-vp').first().boundingBox());
    const geo0 = await st(['dev', 'kodim01', 'crop', 'geometry']);
    // drag the top-left corner handle inward: find it from the viewport transform
    const corner = await page.evaluate(() => { const v = STUDIO.viewport('main'); return v.toScreen(0, 0); });
    await page.mouse.move(vp.x + corner[0] + 2, vp.y + corner[1] + 2);
    await page.mouse.down();
    await page.mouse.move(vp.x + corner[0] + 120, vp.y + corner[1] + 80, { steps: 6 });
    await page.mouse.up();
    await idle(800);
    const geo = await st(['dev', 'kodim01', 'crop', 'geometry']);
    ok(geo.rect.x0 > 0.05 && geo.rect.y0 > 0.05, `the corner drag cropped: ${JSON.stringify(geo.rect)}`);
    const ratio = (geo.rect.x1 - geo.rect.x0) * 768 / ((geo.rect.y1 - geo.rect.y0) * 512);
    ok(Math.abs(ratio - 1.5) < 0.02, `aspect stays locked at 3:2 (${ratio.toFixed(3)})`);
    await shot('cropping');
    // rotate by dragging outside the frame
    await page.mouse.move(vp.x + vp.width - 30, vp.y + 60);
    await page.mouse.down();
    await page.mouse.move(vp.x + vp.width - 30, vp.y + 140, { steps: 6 });
    await page.mouse.up();
    await idle(800);
    const ang = await st(['dev', 'kodim01', 'crop', 'geometry', 'angle']);
    ok(Math.abs(ang) > 0.5, `dragging outside straightens: ${ang}°`);
    await shot('straighten');
    await page.keyboard.press('Enter');
    await idle(1500);
    ok((await st(['ui', 'tool'])) === null, 'Enter applies and closes the tool');
    await shot('cropped');
    const labels = await page.evaluate(() => STUDIO.history.entries.map(e => e.label));
    ok(labels.includes('Crop Rectangle') && labels.includes('Straighten'), `history: ${labels.join(', ')}`);
  },
  async healAndMask({ page, st, ok, shot, idle }) {
    await page.keyboard.press('d'); await idle(1500);
    await page.keyboard.press('q');
    const vp = await page.locator('.ck-vp').first().boundingBox();
    await page.mouse.click(vp.x + vp.width * 0.4, vp.y + vp.height * 0.5);
    await idle(1500);
    const spots = await st(['dev', 'kodim01', 'spots']);
    ok(spots.length === 1, `a click adds a spot at ${JSON.stringify(spots[0] && spots[0].points[0])}`);
    await shot('spot');
    await page.keyboard.press('k');
    await page.mouse.move(vp.x + vp.width * 0.3, vp.y + vp.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(vp.x + vp.width * 0.6, vp.y + vp.height * 0.35, { steps: 12 });
    await page.mouse.up();
    await idle(1500);
    const masks = await st(['dev', 'kodim01', 'masks']);
    ok(masks.length === 1 && masks[0].components[0].shape.kind === 'brush' && masks[0].components[0].shape.strokes[0].points.length > 3, `a brush stroke made a mask (${masks.length}, ${masks[0] && masks[0].components[0].shape.strokes[0].points.length} points)`);
    await shot('brush');
    await page.keyboard.press('Shift+m');
    await page.mouse.move(vp.x + vp.width * 0.7, vp.y + vp.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(vp.x + vp.width * 0.85, vp.y + vp.height * 0.8, { steps: 6 });
    await page.mouse.up();
    await idle(1500);
    const m2 = await st(['dev', 'kodim01', 'masks']);
    ok(m2.length === 2 && m2[1].components[0].shape.kind === 'radial', 'Shift+M then a drag adds a radial mask');
    // adjust the selected mask
    const t = await page.locator('.ck-panel[data-panel="masks"] .ck-slider:has(.ck-slider-l:text-is("Exposure")) .ck-slider-t').boundingBox();
    await page.mouse.click(t.x + t.width * 0.2, t.y + t.height / 2);
    await idle(1500);
    const e = await page.evaluate(() => STUDIO.store.doc.dev.kodim01.masks[1].adjust.exposure);
    ok(e < 0, `the mask's Exposure slider changed that mask: ${e}`);
    await shot('radial');
  },
  async presets({ page, st, ok, shot, idle }) {
    await page.keyboard.press('d'); await idle(1500);
    await page.click('.dv-preset >> text="Color"');
    await page.waitForTimeout(200);
    await page.click('.dv-preset >> text="Teal & Orange"');
    await idle(2000);
    const g = await st(['dev', 'kodim01', 'grading', 'shadows']);
    ok(g && g.sat > 0, `a preset applied: shadows ${JSON.stringify(g)}`);
    await shot('preset');
  },
  async cull({ page, st, ok, shot, idle }) {
    await page.keyboard.press('Alt+c'); await idle(1500);
    ok((await st(['view', 'module'])) === 'cull', 'Alt+C opens Cull');
    await page.keyboard.press('p'); await idle(400);
    await page.keyboard.press('x'); await idle(400);
    await page.keyboard.press('p'); await idle(1200);
    const flags = await page.evaluate(() => STUDIO.store.doc.catalog.photos.map(p => p.flag).filter(Boolean));
    ok(flags.length === 3 && flags.filter(f => f === 'pick').length === 2, `P X P flagged three in a row: ${flags.join(' ')}`);
    await shot('cull');
    await page.keyboard.down('c'); await idle(1800);
    await shot('peek');
    ok(await page.locator('.ck-vp[data-viewport="peek"]').count() === 1, 'holding C shows the last pick');
    await page.keyboard.up('c'); await idle(300);
    ok(await page.locator('.ck-vp[data-viewport="peek"]').count() === 0, 'letting go hides it');
  },
});

Object.assign(module.exports, {
  async reference({ page, st, ok, shot, idle }) {
    await page.keyboard.press('d'); await idle(1500);
    await page.evaluate(() => STUDIO.runCommand('develop.setReference'));
    // pick a different photo, then Shift+R
    await page.keyboard.press('ArrowRight'); await idle(1500);
    await page.keyboard.press('Shift+r'); await idle(2500);
    ok((await st(['view', 'compare'])) === 'reference', 'Shift+R opens the reference view');
    ok(await page.locator('.ck-vp[data-viewport="ref"]').count() === 1, 'the reference is shown beside the active photo');
    await page.evaluate(() => STUDIO.store.set(['workspace', 'panels', 'scopes', 'open'], true));
    await page.evaluate(() => document.querySelector('.ck-panel[data-panel="scopes"]').scrollIntoView());
    await idle(1500);
    await shot('reference');
    const before = await page.evaluate(() => { const id = STUDIO.store.peek(['ui', 'selection', 'primary']); return STUDIO.store.peek(['dev', id]); });
    await page.keyboard.press('Alt+m'); await idle(2500);
    const after = await page.evaluate(() => { const id = STUDIO.store.peek(['ui', 'selection', 'primary']); return STUDIO.store.peek(['dev', id]); });
    ok(after !== before && after.wb.mode === 'custom', `Alt+M matched: exposure ${after.light.exposure}, temp ${after.wb.temp}, tint ${after.wb.tint}, sat ${after.color.saturation}`);
    await shot('matched');
  },
});

Object.assign(module.exports, {
  async persistence({ page, st, ok, shot, idle }) {
    await page.click('.ck-gridview .ck-coll-cell >> nth=3');
    await page.keyboard.press('p');
    await page.keyboard.press('d'); await idle(1500);
    const t = await page.locator('.ck-panel[data-panel="basic"] .ck-slider:has(.ck-slider-l:text-is("Shadows")) .ck-slider-t').boundingBox();
    await page.mouse.click(t.x + t.width * 0.8, t.y + t.height / 2);
    await idle(1200);
    const id = await st(['ui', 'selection', 'primary']);
    const v = await st(['dev', id, 'light', 'shadows']);
    // panel layout is saved too
    await page.evaluate(() => STUDIO.store.set(['workspace', 'layout', 'develop', 'right'], { size: 340 }));
    await page.waitForTimeout(2200);
    await page.reload();
    await page.waitForFunction(() => window.STUDIO && window.STUDIO.root, null, { timeout: 15000 });
    await idle(1500);
    ok(await page.evaluate(() => STUDIO.restored), 'the reload restored saved state');
    ok((await st(['dev', id, 'light', 'shadows'])) === v, `the edit survived a reload (${id} shadows ${v})`);
    const flagged = await page.evaluate(() => STUDIO.store.doc.catalog.photos.filter(p => p.flag === 'pick').length);
    ok(flagged === 1, 'the pick survived');
    ok(await page.evaluate(() => STUDIO.store.doc.dev.kodim02 === STUDIO.store.doc.devDefaults), 'unedited photos share the defaults again');
    ok((await st(['workspace', 'layout', 'develop', 'right', 'size'])) === 340, 'the column width survived');
    ok((await st(['view', 'module'])) === 'develop', 'the module survived');
    // a viewport mounted before the engine started still renders the photo (not the engine's sample)
    await page.waitForSelector('.ck-vp[data-rendered]', { timeout: 15000 });
    const size = await page.getAttribute('.ck-vp[data-rendered]', 'data-rendered');
    const [rw, rh] = size.split('x').map(Number);
    ok(Math.abs(rw / rh - 1.5) < 0.01, `the reloaded Develop view shows the photo (${size})`);
    await shot('restored');
  },
});

Object.assign(module.exports, {
  async dragRate({ page, st, ok, shot, idle }) {
    await page.keyboard.press('d'); await idle(2000);
    await page.evaluate(() => { window.__r = []; STUDIO.on('rendered', e => window.__r.push([performance.now(), e.ms, e.w, e.previewing])); });
    const t = await page.locator('.ck-panel[data-panel="basic"] .ck-slider:has(.ck-slider-l:text-is("Exposure")) .ck-slider-t').boundingBox();
    const y = t.y + t.height / 2, x0 = t.x + t.width / 2;
    await page.mouse.move(x0 + 3, y); await page.mouse.down();
    const t0 = await page.evaluate(() => performance.now());
    for (let i = 0; i < 60; i++) { await page.mouse.move(x0 + 3 + Math.sin(i / 6) * 40, y); await page.waitForTimeout(16); }
    const t1 = await page.evaluate(() => performance.now());
    await page.mouse.up(); await page.waitForTimeout(2500);
    const r = await page.evaluate(() => window.__r);
    const during = r.filter(x => x[0] <= 0 || true).filter(x => x[3]);
    const fps = during.length / ((t1 - t0) / 1000);
    ok(during.length >= 5, `preview renders during a 1 s drag: ${during.length} (${fps.toFixed(1)} per second), proxy width ${during[0] && during[0][2]} px, worker ${Math.round(during.reduce((a, x) => a + x[1], 0) / Math.max(1, during.length))} ms each`);
    console.log('    renders:', JSON.stringify(r.slice(-4).map(x => [Math.round(x[1]), x[2], x[3]])));
    const fin = r.filter(x => !x[3]).pop();
    ok(fin && fin[2] > (during[0] ? during[0][2] : 0), `after the drag a full-size render: ${fin && fin[2]} px in ${fin && fin[1]} ms`);
    ok((await page.evaluate(() => STUDIO.history.entries.length)) === 1, 'still one undo step');
  },
});

Object.assign(module.exports, {
  async zoomPan({ page, st, ok, shot, idle }) {
    await page.keyboard.press('d'); await idle(1800);
    await page.mouse.move(700, 400);
    await page.keyboard.press('z'); await idle(1500);
    const v1 = await st(['view', 'vp', 'main']);
    ok(v1.zoom === 1, `tapping Z toggles to 1:1 (${JSON.stringify(v1)})`);
    await page.keyboard.down(' ');
    await page.mouse.down(); await page.mouse.move(600, 340, { steps: 6 }); await page.mouse.up();
    await page.keyboard.up(' ');
    await idle(600);
    const v2 = await st(['view', 'vp', 'main']);
    ok(v2.cx !== v1.cx || v2.cy !== v1.cy, `Space-drag pans (${v1.cx.toFixed(2)},${v1.cy.toFixed(2)} → ${v2.cx.toFixed(2)},${v2.cy.toFixed(2)})`);
    ok((await page.evaluate(() => STUDIO.history.entries.length)) === 0, 'panning is not an undo step');
    await shot('one-to-one');
    await page.mouse.move(700, 400);
    await page.keyboard.down('Alt'); await page.mouse.wheel(0, -300); await page.keyboard.up('Alt');
    await idle(600);
    const v3 = await st(['view', 'vp', 'main']);
    ok(typeof v3.zoom === 'number' && v3.zoom > 1, `Alt+wheel zooms in at the pointer (${v3.zoom})`);
    await page.keyboard.down('Alt'); await page.mouse.wheel(0, 2000); await page.keyboard.up('Alt');
    await idle(600);
    ok((await st(['view', 'vp', 'main', 'zoom'])) === 'fit', 'zooming out stops at Fit');
    await page.keyboard.press('Control+0'); await idle(400);
    ok((await st(['view', 'vp', 'main', 'zoom'])) === 'fit', 'Mod+0 fits');
    await page.keyboard.press('Tab'); await idle(300);
    ok(await page.evaluate(() => document.querySelector('.ck-side-right').hidden), 'Tab hides the side panels');
    await shot('tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('F8'); await idle(200);
    ok(await page.evaluate(() => document.querySelector('.ck-side-right').hidden), 'F8 hides the right panels');
    await page.keyboard.press('F8');
  },
});

Object.assign(module.exports, {
  async importBig({ page, st, ok, shot, idle }) {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => STUDIO.runCommand('library.import'))]);
    await chooser.setFiles('/tmp/claude-0/-home-claude/67f1174e-8841-5d00-8f38-259a6c609c2c/scratchpad/big-macaws.jpg');
    await page.waitForTimeout(1500);
    const n = await page.evaluate(() => STUDIO.store.doc.catalog.photos.length);
    ok(n === 25, `the import added a photo (${n})`);
    const p = await page.evaluate(() => { const id = STUDIO.store.peek(['ui', 'selection', 'primary']); return STUDIO.store.doc.catalog.photos.find(x => x.id === id); });
    ok(p && p.w === 3072 && p.imported, `the new photo is selected: ${p && p.name} ${p && p.w}×${p && p.h}`);
    await page.keyboard.press('d'); await idle(3000);
    const t = await page.locator('.ck-panel[data-panel="basic"] .ck-slider:has(.ck-slider-l:text-is("Vibrance")) .ck-slider-t').boundingBox();
    await page.mouse.click(t.x + t.width * 0.85, t.y + t.height / 2); await idle(3000);
    const r = await page.evaluate(() => STUDIO.engine.stats);
    ok(r.renders > 0, `the engine rendered the imported photo (last ${r.ms} ms)`);
    await shot('imported');
  },
});
