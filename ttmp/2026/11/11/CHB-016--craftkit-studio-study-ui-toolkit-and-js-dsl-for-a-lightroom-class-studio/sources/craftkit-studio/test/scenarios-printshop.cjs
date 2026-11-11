// Print Shop scenarios: the zine (S-01), the copier (S-02), the riso (S-04), screens (S-06), a phone, a reload.
// Exports are caught by a stand-in for window.claude's downloads (app.save uses it when it is there).
const ZINE = ['kodim06', 'kodim11', 'kodim12', 'kodim16', 'kodim19', 'kodim21', 'kodim22', 'kodim13'];
const slider = (panel, label) => `.ck-panel[data-panel="${panel}"] .ck-slider:has(.ck-slider-l:text-is("${label}")) .ck-slider-t`;
const history = page => page.evaluate(() => STUDIO.history.entries.map(e => e.label + (e.detail ? ' ' + e.detail : '')));
const catchSaves = page => page.evaluate(() => { window.__saved = []; window.claude = { use: async () => ({ save: async f => { window.__saved.push(f); } }) }; });
const saved = async page => { await page.waitForFunction(() => window.__saved && window.__saved.length > 0, null, { timeout: 60000 }); return page.evaluate(() => { const f = window.__saved.shift(); window.__last = f; return { filename: f.filename, size: f.data.size, type: f.data.type }; }); };
// the last saved file: a PNG's size, colour type and print resolution, or a ZIP's entries
const inspect = page => page.evaluate(async () => {
  const f = window.__last, b = new Uint8Array(await f.data.arrayBuffer()), dv = new DataView(b.buffer);
  const png = async bytes => { const v = new DataView(bytes.buffer, bytes.byteOffset); let ppm = 0; for (let at = 8; at + 12 <= bytes.length;) { const len = v.getUint32(at), type = String.fromCharCode(...bytes.subarray(at + 4, at + 8)); if (type === 'pHYs') ppm = v.getUint32(at + 8); at += 12 + len; } const bmp = await createImageBitmap(new Blob([bytes])); return { w: bmp.width, h: bmp.height, colorType: bytes[25], ppi: ppm ? Math.round(ppm * 0.0254) : 0 }; };
  if (b[0] === 137) return { png: await png(b) };
  const end = b.length - 22, n = dv.getUint16(end + 10, true); let p = dv.getUint32(end + 16, true); const entries = [];
  for (let i = 0; i < n; i++) {
    const len = dv.getUint16(p + 28, true), size = dv.getUint32(p + 20, true), lo = dv.getUint32(p + 42, true), name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + len));
    const at = lo + 30 + dv.getUint16(lo + 26, true), data = b.subarray(at, at + size);
    entries.push(Object.assign({ name, size }, /\.png$/.test(name) ? await png(data) : {}));
    p += 46 + len;
  }
  return { entries };
});
// a signature of what a viewport shows, and a wait until it differs from an earlier one
const sigOf = (page, vp) => page.evaluate(id => { const b = STUDIO.viewport(id) && STUDIO.viewport(id).bitmap(); if (!b) return ''; const c = new OffscreenCanvas(48, 32), g = c.getContext('2d'); g.drawImage(b, 0, 0, 48, 32); const d = g.getImageData(0, 0, 48, 32).data; let hsh = 0; for (let i = 0; i < d.length; i++) hsh = (hsh * 31 + d[i]) >>> 0; return hsh.toString(36); }, vp);
const changes = (page, vp, sig) => page.waitForFunction(([id, s0]) => { const b = STUDIO.viewport(id) && STUDIO.viewport(id).bitmap(); if (!b) return false; const c = new OffscreenCanvas(48, 32), g = c.getContext('2d'); g.drawImage(b, 0, 0, 48, 32); const d = g.getImageData(0, 0, 48, 32).data; let hsh = 0; for (let i = 0; i < d.length; i++) hsh = (hsh * 31 + d[i]) >>> 0; return hsh.toString(36) !== s0; }, [vp, sig], { timeout: 20000 }).then(() => true, () => false);
const rendered = (page, vp) => page.waitForFunction(id => { const v = STUDIO.viewport(id); return v && v.bitmap() && !document.querySelector(`.ck-vp[data-viewport="${id}"] .ck-vp-busy:not([hidden])`); }, vp, { timeout: 30000 }).then(() => true, () => false);
const openPrintShop = async (page, idle, key) => { await page.keyboard.press('Alt+s'); await idle(600); if (key) { await page.keyboard.press(key); await idle(600); } };

module.exports = {
  async printshopZine({ page, st, ok, shot, idle }) {
    const diag = await page.evaluate(() => STUDIO.diagnostics.list.filter(d => d.level !== 'info').map(d => `${d.code} ${d.title} ${d.at ? d.at.file + ':' + d.at.line : ''}`));
    ok(diag.length === 0, `the build is clean${diag.length ? ': ' + diag.join('; ') : ''}`);
    await openPrintShop(page, idle);
    ok((await st(['view', 'module'])) === 'printshop', 'Alt+S opens Print Shop');
    ok((await st(['view', 'printshop', 'mode'])) === 'zine', 'it opens on the zine');
    ok((await st(['printshop', 'zine', 'pages'])).join() === ZINE.join(), 'the pages start as the “Zine: Coastline” collection, in reading order');
    const drawn = await page.waitForFunction(() => +document.querySelector('.ps-sheet-wrap').dataset.ready === 8, null, { timeout: 20000 }).then(() => true, () => false);
    ok(drawn, 'the imposed sheet shows all eight pages (engine renders on the background lane)');
    await shot('sheet');
    // a photo from the filmstrip onto Page 4's slot
    const keys = await page.locator('.ck-filmstrip .ck-coll-cell').evaluateAll(els => els.map(e => e.dataset.key));
    const a = keys.find(k => !ZINE.includes(k) && k !== 'kodim01'), b = keys.find(k => !ZINE.includes(k) && k !== a && k !== 'kodim01');
    await page.dragAndDrop(`.ck-filmstrip .ck-coll-cell[data-key="${a}"]`, '.ck-listview .ck-coll-row[data-key="slot3"]');
    await idle(300);
    ok((await st(['printshop', 'zine', 'pages']))[3] === a, `dragging ${a} onto the Page 4 slot places it there`);
    let hist = await history(page);
    ok(hist.length === 1 && /Page 4/.test(hist[0]), `one undo step: ${hist.join(' | ')}`);
    // another onto the cover panel of the sheet itself (bottom right)
    const sheet = await page.locator('.ps-sheet').boundingBox();
    await page.dragAndDrop(`.ck-filmstrip .ck-coll-cell[data-key="${b}"]`, '.ps-sheet', { targetPosition: { x: sheet.width * 0.88, y: sheet.height * 0.7 } });
    await idle(300);
    ok((await st(['printshop', 'zine', 'pages']))[0] === b, `dropping ${b} on the sheet's cover panel puts it on the cover`);
    // drag Page 6 (bottom left) onto Page 7 to swap them
    const before = await st(['printshop', 'zine', 'pages']);
    await page.mouse.move(sheet.x + sheet.width * 0.12, sheet.y + sheet.height * 0.7);
    await page.mouse.down();
    await page.mouse.move(sheet.x + sheet.width * 0.37, sheet.y + sheet.height * 0.7, { steps: 8 });
    await page.mouse.up();
    await idle(300);
    const after = await st(['printshop', 'zine', 'pages']);
    ok(after[5] === before[6] && after[6] === before[5], `dragging page 6 onto page 7 swaps them (${before[5]} ↔ ${before[6]})`);
    hist = await history(page);
    ok(hist.length === 3 && /Swap Page 6 and Page 7/.test(hist[2]), `three steps: ${hist.join(' | ')}`);
    await page.keyboard.press('Control+z');
    ok((await st(['printshop', 'zine', 'pages'])).join() === before.join(), 'Mod+Z undoes the swap');
    // the title: typed, one undo step
    const title = page.locator('.ck-panel[data-panel="ps-zine"] .ck-textfield:has(.ck-field-l:text-is("Title")) input');
    await title.click(); await title.fill('Salt Air'); await page.keyboard.press('Enter');
    await idle(200);
    ok((await st(['printshop', 'zine', 'title'])) === 'Salt Air', 'the cover title is document state');
    hist = await history(page);
    ok(/Zine Title/.test(hist[hist.length - 1]), `the title edit is one step: ${hist[hist.length - 1]}`);
    // look and page numbers
    await page.click('.ck-panel[data-panel="ps-zine"] .ck-seg-b:has-text("B&W")');
    ok((await st(['printshop', 'zine', 'look'])) === 'bw', 'Look: B&W');
    await page.click('.ck-panel[data-panel="ps-zine"] .ck-check:has-text("Page numbers") input');
    ok((await st(['printshop', 'zine', 'numbers'])) === false, 'page numbers off');
    const bw = await page.waitForFunction(() => +document.querySelector('.ps-sheet-wrap').dataset.ready === 8, null, { timeout: 20000 }).then(() => true, () => false);
    ok(bw, 'the sheet re-renders the pages in black and white');
    await page.click('.ck-panel[data-panel="ps-zine-out"] .ck-seg-b:has-text("150 ppi")');
    ok((await st(['printshop', 'zine', 'ppi'])) === 150, 'resolution 150 ppi');
    await shot('edited');
    // export the print sheet
    await catchSaves(page);
    await page.click('.ck-panel[data-panel="ps-zine-out"] .ck-btn:has-text("Export print sheet")');
    const f = await saved(page);
    ok(f.filename === 'zine-salt-air-a4-150ppi.png' && f.type === 'image/png', `saved ${f.filename} (${Math.round(f.size / 1024)} KB)`);
    const info = await inspect(page);
    ok(info.png && info.png.w === 1754 && info.png.h === 1240 && info.png.ppi === 150, `the sheet is A4 at 150 ppi: ${JSON.stringify(info.png)}`);
    ok((await st(['ui', 'printshop', 'busy'])) === null, 'the export is done');
    // the Fold & Cut panel has four steps
    ok((await page.locator('.ps-step').count()) === 4, 'four fold-and-cut steps');
    // the Print Shop menu belongs to the module: it is in the bar here, gone in the Library
    const bar = () => page.locator('.ck-menubar-t:visible').allInnerTexts();
    ok((await bar()).includes('Print Shop'), 'the Print Shop menu is in the menu bar while Print Shop is open');
    await page.click('.ck-module:has-text("Library")'); await idle(400);
    ok(!(await bar()).includes('Print Shop'), 'and leaves it in the Library');
    await page.keyboard.press('Control+k'); await page.keyboard.type('riso masters'); await idle(200);
    const found = await page.locator('.ck-palette-r .ck-palette-t').allInnerTexts();
    ok(!found.some(t => /Riso Masters/.test(t)), `the palette does not offer Print Shop commands in the Library (${found.slice(0, 3).join(' | ') || 'nothing'})`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Alt+s'); await idle(400);
    // light theme
    await page.emulateMedia({ colorScheme: 'light' }); await idle(500);
    await shot('light');
  },

  async printshopCopier({ page, st, ok, shot, idle }) {
    await openPrintShop(page, idle, '2');
    ok((await st(['view', 'printshop', 'mode'])) === 'copier', '2 switches to the copier');
    ok(await rendered(page, 'ps-original') && await rendered(page, 'ps-copy'), 'the original and the copy render side by side');
    const g0 = await st(['printshop', 'copier', 'gens']);
    const s0 = await sigOf(page, 'ps-copy');
    await page.keyboard.press('g'); await page.keyboard.press('g');
    ok((await st(['printshop', 'copier', 'gens'])) === g0 + 2, `G G: generation ${g0} → ${g0 + 2}`);
    let hist = await history(page);
    ok(hist.length === 2 && hist[1] === `Generations: ${g0 + 2}`, `each G is one undo step: ${hist.join(' | ')}`);
    ok(await changes(page, 'ps-copy', s0), 'the copy on screen becomes generation 5');
    await page.keyboard.press('Shift+g');
    ok((await st(['printshop', 'copier', 'gens'])) === 1, 'Shift+G goes back to one copy');
    // a slider drag is one undo step
    const t = await page.locator(slider('ps-copier', 'Toner')).boundingBox();
    await page.mouse.move(t.x + t.width * 0.5, t.y + t.height / 2); await page.mouse.down();
    for (let i = 1; i <= 6; i++) { await page.mouse.move(t.x + t.width * 0.5 + i * 8, t.y + t.height / 2); await page.waitForTimeout(30); }
    await page.mouse.up(); await idle(400);
    hist = await history(page);
    ok(/Toner/.test(hist[hist.length - 1]) && hist.length === 4, `the Toner drag is one step: ${hist[hist.length - 1]}`);
    ok((await st(['printshop', 'copier', 'toner'])) > 0.45, `toner up: ${await st(['printshop', 'copier', 'toner'])}`);
    // the Generations panel: click the sixth
    await page.click('.ps-gen[data-gen="6"]');
    ok((await st(['printshop', 'copier', 'gens'])) === 6, 'clicking generation 6 in the panel picks it');
    ok(await rendered(page, 'ps-copy'), 'generation 6 renders');
    const thumbs = await page.waitForFunction(() => document.querySelectorAll('.ps-gen .ps-pic.is-ready').length === 8, null, { timeout: 30000 }).then(() => true, () => false);
    ok(thumbs, 'all eight generations have a picture');
    // G at eight says why
    for (let i = 0; i < 3; i++) await page.keyboard.press('g');
    ok((await st(['printshop', 'copier', 'gens'])) === 8, 'G stops at eight');
    await page.keyboard.press('g');
    const why = await page.locator('.ck-toast').last().innerText().catch(() => '');
    ok(/Eight generations/.test(why), `a ninth G explains: ${why.replace(/\n/g, ' ')}`);
    await idle(500); await rendered(page, 'ps-copy');
    await shot('copier');
    // G outside the copier does not add a generation
    await page.keyboard.press('1'); await idle(300);
    await page.keyboard.press('Shift+g');
    ok((await st(['printshop', 'copier', 'gens'])) === 8, 'Shift+G does nothing in the zine');
  },

  async printshopRiso({ page, st, ok, shot, idle }) {
    await openPrintShop(page, idle, '3');
    ok((await st(['view', 'printshop', 'mode'])) === 'riso', '3 switches to the riso');
    ok(await rendered(page, 'ps-riso'), 'the two-drum print renders');
    const both = await sigOf(page, 'ps-riso');
    await page.click('.ck-panel[data-panel="ps-drum-2"] .ck-panel-sw');
    ok((await st(['printshop', 'riso', 'drums', 1, 'on'])) === false, 'the header switch turns drum 2 off');
    let hist = await history(page);
    ok(hist.length === 1 && hist[0] === 'Drum 2: Off', `one undo step: ${hist.join(' | ')}`);
    ok(await changes(page, 'ps-riso', both), 'the print changes without drum 2');
    await page.keyboard.press('Control+z');
    ok((await st(['printshop', 'riso', 'drums', 1, 'on'])) === true, 'Mod+Z turns it back on');
    await page.selectOption('.ck-panel[data-panel="ps-drum-1"] select', { label: 'Yellow' });
    ok((await st(['printshop', 'riso', 'drums', 0, 'ink'])) === 'yellow', 'drum 1 ink: Yellow');
    await page.click('.ps-ink[data-ink="teal"]', { modifiers: ['Shift'] });
    ok((await st(['printshop', 'riso', 'drums', 1, 'ink'])) === 'teal', 'Shift-click in the ink drawer loads drum 2 with Teal');
    await page.click('.ck-panel[data-panel="ps-drum-2"] .ck-seg-b:has-text("Grain")');
    ok((await st(['printshop', 'riso', 'drums', 1, 'texture'])) === 'grain', 'drum 2 screen: grain');
    // arrow keys nudge the drum whose panel has focus: one step for a run of nudges
    const n0 = (await history(page)).length;
    await page.locator('.ck-panel[data-panel="ps-drum-1"] .ps-pad').focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    ok((await st(['printshop', 'riso', 'drums', 0, 'dx'])) === 3 && (await st(['printshop', 'riso', 'drums', 0, 'dy'])) === 10, 'arrows nudge drum 1 by 3 px right, Shift+↓ by 10 px down');
    hist = await history(page);
    ok(hist.length === n0 + 1 && /Drum 1 Registration/.test(hist[hist.length - 1]), `the nudges are one step: ${hist[hist.length - 1]}`);
    // V: the registration tool, drag on the print moves drum 2
    await page.keyboard.press('v');
    ok((await st(['ui', 'tool'])) === 'ps-register', 'V picks the registration tool');
    const vp = await page.locator('.ck-vp[data-viewport="ps-riso"]').boundingBox();
    const dx0 = await st(['printshop', 'riso', 'drums', 1, 'dx']);
    await page.mouse.move(vp.x + vp.width / 2, vp.y + vp.height / 2); await page.mouse.down();
    await page.mouse.move(vp.x + vp.width / 2 + 12, vp.y + vp.height / 2 + 6, { steps: 6 }); await page.mouse.up();
    await idle(300);
    const dx1 = await st(['printshop', 'riso', 'drums', 1, 'dx']);
    ok(dx1 > dx0, `dragging moves drum 2: ${dx0} → ${dx1} px`);
    hist = await history(page);
    ok(/Drum 2 Registration/.test(hist[hist.length - 1]), `one step: ${hist[hist.length - 1]}`);
    await idle(500); await rendered(page, 'ps-riso');
    await shot('riso');
    await page.keyboard.press('Escape');
    ok((await st(['ui', 'tool'])) === null, 'Esc leaves the tool');
    const masters = await page.waitForFunction(() => document.querySelectorAll('.ps-master .ps-pic.is-ready').length === 2, null, { timeout: 30000 }).then(() => true, () => false);
    ok(masters, 'both drums show their master');
    // export the masters
    await catchSaves(page);
    await page.click('.ck-panel[data-panel="ps-masters"] .ck-btn:has-text("Export masters")');
    const f = await saved(page);
    ok(f.filename === 'riso-masters-shuttered-house.zip' && f.type === 'application/zip', `saved ${f.filename} (${Math.round(f.size / 1024)} KB)`);
    const z = await inspect(page);
    const names = z.entries.map(e => e.name);
    ok(names.join() === 'drum-1-yellow.png,drum-2-teal.png,run-sheet.txt', `the ZIP holds ${names.join(', ')}`);
    const m = z.entries[0];
    ok(m.colorType === 0 && m.w === 768 && m.h === 512, `masters are greyscale PNGs at the photo's size: ${JSON.stringify(m)}`);
  },

  async printshopScreens({ page, st, ok, shot, idle }) {
    await openPrintShop(page, idle, '4');
    ok((await st(['view', 'printshop', 'mode'])) === 'screens', '4 switches to screens');
    ok(await rendered(page, 'ps-proof'), 'the overprint proof renders');
    const four = await page.waitForFunction(() => document.querySelectorAll('.ps-film').length === 4, null, { timeout: 30000 }).then(() => true, () => false);
    ok(four, 'four films with ink chips');
    await page.click('.ck-panel[data-panel="ps-separation"] .ck-stepper button[aria-label="more"]');
    ok((await st(['printshop', 'screens', 'n'])) === 5, 'the stepper adds a screen');
    const five = await page.waitForFunction(() => document.querySelectorAll('.ps-film').length === 5, null, { timeout: 30000 }).then(() => true, () => false);
    ok(five, 'five films');
    const inks = await page.locator('.ps-film').evaluateAll(els => els.map(e => e.dataset.ink));
    ok(new Set(inks).size === 5, `five different inks: ${inks.join(' ')}`);
    const copies = page.locator('.ck-panel[data-panel="ps-run"] .ck-number:has(.ck-field-l:text-is("Copies")) input');
    await copies.click(); await copies.fill('100'); await page.keyboard.press('Enter');
    ok((await st(['printshop', 'screens', 'copies'])) === 100, 'copies: 100');
    await idle(200);
    const est = await page.locator('.ck-panel[data-panel="ps-run"] .ck-stat.ps-total .ck-stat-v').innerText();
    ok(est === '$325.00', `5 screens × $25 + 500 pulls × $0.40 = ${est}`);
    const hist = await history(page);
    ok(hist.length === 2 && /Screens: 5/.test(hist[0]) && /Copies/.test(hist[1]), `each change is one step: ${hist.join(' | ')}`);
    await page.click('.ck-panel[data-panel="ps-separation"] .ck-seg-b:has-text("Transparent")');
    ok((await st(['printshop', 'screens', 'ink'])) === 'transparent', 'transparent inks');
    await idle(500); await rendered(page, 'ps-proof');
    await shot('screens');
    await catchSaves(page);
    await page.click('.ck-panel[data-panel="ps-films"] .ck-btn:has-text("Export films")');
    const f = await saved(page);
    ok(f.filename === 'screens-shuttered-house-5-films.zip', `saved ${f.filename} (${Math.round(f.size / 1024)} KB)`);
    const z = await inspect(page);
    const films = z.entries.filter(e => /^film-/.test(e.name));
    ok(films.length === 5 && films.every(e => e.colorType === 0 && e.w > 768), `five greyscale films with margins: ${films.map(e => `${e.name} ${e.w}×${e.h}`).join(', ')}`);
    ok(z.entries.some(e => e.name === 'proof.jpg') && z.entries.some(e => e.name === 'inks.txt'), 'with the proof and the ink list');
    await page.emulateMedia({ colorScheme: 'light' }); await idle(400);
    await shot('screens-light');
  },

  async printshopPhone({ page, st, ok, shot, idle }) {
    await page.setViewportSize({ width: 400, height: 820 });
    await page.reload();
    await page.waitForFunction(() => window.STUDIO && window.STUDIO.root, null, { timeout: 15000 });
    await idle(800);
    await openPrintShop(page, idle);
    for (const [key, mode] of [['1', 'zine'], ['2', 'copier'], ['3', 'riso'], ['4', 'screens']]) {
      await page.keyboard.press(key); await idle(1800);
      const w = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, document.querySelector('.ck-app').scrollWidth));
      ok(w <= 400, `${mode} fits a 400 px phone: page width ${w}`);
      const top = await page.evaluate(() => { const s = document.querySelector('.ps-top .ck-seg'); const r = s.getBoundingClientRect(); return r.right <= window.innerWidth && r.left >= 0; });
      ok(top, `${mode}: the mode switch is fully on screen`);
      await shot(mode);
    }
    await page.keyboard.press('1'); await idle(500);
    await page.keyboard.press('Tab'); await idle(400);   // show the side panels: they float over the centre
    await shot('zine-panels');
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    ok(w <= 400, `the floating panels do not widen the page: ${w}`);
    await page.emulateMedia({ colorScheme: 'light' }); await idle(400);
    await shot('zine-panels-light');
  },

  async printshopReload({ page, st, ok, shot, idle }) {
    await openPrintShop(page, idle);
    await page.waitForTimeout(1600);   // autosave keeps the open module
    await page.reload();
    await page.waitForFunction(() => window.STUDIO && window.STUDIO.root, null, { timeout: 15000 });
    ok((await st(['view', 'module'])) === 'printshop', 'a reload comes back to Print Shop');
    const drawn = await page.waitForFunction(() => document.querySelector('.ps-sheet-wrap') && +document.querySelector('.ps-sheet-wrap').dataset.ready === 8, null, { timeout: 20000 }).then(() => true, () => false);
    ok(drawn, 'the sheet renders when the module is open before the engine has compiled');
    await page.keyboard.press('3'); await idle(800);
    ok(await rendered(page, 'ps-riso'), 'and so does the riso');
    await shot('reloaded');
  },
};
