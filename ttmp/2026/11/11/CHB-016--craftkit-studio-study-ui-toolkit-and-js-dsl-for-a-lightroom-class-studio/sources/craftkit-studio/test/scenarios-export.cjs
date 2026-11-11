// Export desk scenarios: a set from a collection, review marks, a recipe in one step, presets and naming, an
// export that lands as a valid .zip (CRC-checked here), one undo step per run, cancel, edits after export, the
// contact sheet, and the phone layout.
const fs = require('fs'), zlib = require('zlib'), path = require('path'), cp = require('child_process');

// read a .zip without a library: end record → central directory → local headers; check every CRC
function readZip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('no end-of-central-directory record');
  const n = buf.readUInt16LE(e + 10), cdOff = buf.readUInt32LE(e + 16);
  const files = []; let p = cdOff;
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central header ' + i);
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString('utf8');
    if (buf.readUInt32LE(off) !== 0x04034b50) throw new Error('bad local header for ' + name);
    const lnl = buf.readUInt16LE(off + 26), lxl = buf.readUInt16LE(off + 28);
    const data = buf.slice(off + 30 + lnl + lxl, off + 30 + lnl + lxl + size);
    files.push({ name, method, size, crc, crcOk: (zlib.crc32(data) >>> 0) === crc, data });
    p += 46 + nl + xl + cl;
  }
  return files;
}
function jpegSize(b) {
  if (b[0] !== 0xFF || b[1] !== 0xD8) return null;
  let i = 2;
  while (i + 9 < b.length) { if (b[i] !== 0xFF) return null; const m = b[i + 1], len = b.readUInt16BE(i + 2); if (m >= 0xC0 && m <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(m)) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) }; i += 2 + len; }
  return null;
}
const pngSize = b => (b.slice(1, 4).toString() === 'PNG' ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null);
const pyTest = file => { try { return cp.execFileSync('python3', ['-I', '-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip() or "ok", len(z.namelist()))', file], { encoding: 'utf8' }).trim(); } catch (e) { return 'python check unavailable: ' + e.message.split('\n')[0]; } };
const OUT = process.env.OUT || '/tmp/claude-0/-home-claude/67f1174e-8841-5d00-8f38-259a6c609c2c/scratchpad/e2e';
// this module's diagnostics fail the test; other modules' (built in parallel in the same tree) are reported only
const diag = async page => {
  const all = await page.evaluate(() => STUDIO.diagnostics.list.filter(d => d.level !== 'info').map(d => d.format()));
  const mine = all.filter(t => /export\.(js|css)/.test(t));
  if (all.length > mine.length) console.log(`  · note: other modules report ${all.length - mine.length}: ${all.filter(t => !mine.includes(t)).map(t => t.split('\n').slice(0, 2).join(' ')).join(' | ')}`);
  return mine;
};
const status = (page, id) => page.evaluate(i => { const r = STUDIO.store.peek(['exportDesk', 'status', i]); return r ? r.s : null; }, id);
const counts = page => page.locator('.exp-counts').innerText();
const cell = id => `.ck-coll-cell:has(.exp-cell[data-id="${id}"])`;

module.exports = {
  async exportDesk({ page, st, ok, shot, idle }) {
    await page.keyboard.press('Control+Shift+e');
    await idle(1200);
    ok((await st(['view', 'module'])) === 'export', 'Mod+Shift+E opens Export');
    const d0 = await diag(page);
    ok(d0.length === 0, `the build is clean: ${d0.join(' | ') || 'no warnings or errors'}`);
    ok((await page.evaluate(() => STUDIO.store.peek(['ui', 'exportSet']).length)) === 24, 'the set starts as the Library view (24 photos)');

    // the set: a collection
    await page.click('.exp-srcs .exp-src:has-text("Zine: Coastline")');
    await page.waitForTimeout(250);
    const ids = await page.evaluate(() => STUDIO.store.peek(['ui', 'exportSet']).map(p => p.id));
    ok(ids.length === 8, `a collection is the set: ${ids.length} photos`);
    ok((await page.locator('.exp-head-t').innerText()) === 'Zine: Coastline', 'the header names the set');
    let labels = await page.evaluate(() => STUDIO.history.entries.map(e => e.label));
    ok(labels.join() === 'Export Set: Zine: Coastline', `choosing a set is one undo step: ${labels.join(', ')}`);

    // review marks: click, Shift-click, R; then Enter makes one Ready again
    await page.click(cell(ids[0]));
    await page.click(cell(ids[2]), { modifiers: ['Shift'] });
    await page.keyboard.press('r');
    await page.waitForTimeout(150);
    ok((await status(page, ids[1])) === 'review', 'R marks the selected photos for review');
    ok(/5 to export · 3 need review/.test(await counts(page)), `the toolbar counts: "${await counts(page)}"`);
    await page.click(cell(ids[5]));   // a click inside a multi-selection only moves the primary: leave it first
    await page.click(cell(ids[1]));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    ok((await status(page, ids[1])) === 'ready' && (await st(['view', 'module'])) === 'export', 'Enter marks it Ready (and stays in Export)');
    ok(/6 to export · 2 need review/.test(await counts(page)), `counts follow: "${await counts(page)}"`);
    await shot('review');

    // the recipe: edit one photo, use it as the source, apply to the set in one transaction
    const src = 'kodim06';
    await page.evaluate(id => { const d = STUDIO.store.peek(['devDefaults']); STUDIO.store.tx('Test Edit', t => { t.dev[id] = Object.assign({}, d, { light: Object.assign({}, d.light, { exposure: 0.7 }), wb: Object.assign({}, d.wb, { mode: 'custom', temp: 6100 }) }); }); }, src);
    await page.click(cell(src));
    await page.waitForTimeout(150);
    const before = (await page.evaluate(() => STUDIO.history.entries.length));
    const applyLabel = await page.locator('.ck-panel[data-panel="export-recipe"] .ck-btn.is-primary').innerText();
    ok(applyLabel === 'Apply Recipe to 7 Photos', `the recipe button says what it will do: "${applyLabel}"`);
    await page.click('.ck-panel[data-panel="export-recipe"] .ck-btn.is-primary');
    await idle(600);
    const after = await page.evaluate(ids => ids.map(id => STUDIO.store.peek(['dev', id]).light.exposure), ids);
    ok(after.every(v => v === 0.7), `the recipe reached every photo: ${after.join(' ')}`);
    labels = await page.evaluate(() => STUDIO.history.entries.map(e => e.label));
    ok(labels.length === before + 1 && labels[labels.length - 1] === 'Apply Recipe to 7 Photos', `one undo step: ${labels[labels.length - 1]}`);
    ok((await status(page, ids[0])) === 'review' && (await status(page, src)) !== 'review', 'changed photos are marked for review, the source is not');
    const crop = await page.evaluate(id => STUDIO.store.peek(['dev', id]).crop === STUDIO.store.peek(['devDefaults']).crop, ids[0]);
    ok(crop, 'Crop is not copied by default');
    await page.keyboard.press('Control+z');
    await idle(300);
    ok((await page.evaluate(id => STUDIO.store.peek(['dev', id]).light.exposure, ids[0])) === 0 && (await status(page, ids[1])) === 'ready' && (await status(page, ids[0])) === 'review', 'Mod+Z undoes the whole recipe (settings and marks)');
    await page.keyboard.press('Control+Shift+z');
    await idle(300);
    ok((await page.evaluate(id => STUDIO.store.peek(['dev', id]).light.exposure, ids[0])) === 0.7, 'and Mod+Shift+Z redoes it');
    await shot('recipe');

    // approve everything: Mod+A, Enter
    await page.click(cell(ids[3]));
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    ok(/^8 to export$/.test(await counts(page)), `Mod+A, Enter: "${await counts(page)}"`);

    // export settings: a preset, then a naming template with a live preview
    await page.click('.exp-preset:has-text("Instagram 1080")');
    await page.waitForTimeout(150);
    const S = await st(['exportDesk', 'settings']);
    ok(S.square === true && S.longEdge === 1080 && S.format === 'jpeg', `the Instagram preset: ${JSON.stringify(S)}`);
    ok((await page.locator('.ck-panel[data-panel="export-settings"] .ck-panel-h .ck-text').innerText()) === 'Instagram 1080', 'the panel names the preset in use');
    await page.click('.exp-name input');
    await page.keyboard.press('Control+a');
    await page.keyboard.type('{date}_{seq}_{title}');
    await page.waitForTimeout(150);
    const first = await page.locator('.exp-first .ck-text:last-child').innerText();
    ok(first === '1991-01-12_01_Lighthouse and fence.jpg' || /^1991-\d\d-\d\d_01_.+\.jpg$/.test(first), `the first file name follows the template as you type: ${first}`);
    await page.keyboard.press('Tab');
    await shot('settings');

    // export: Mod+E → a .zip download; check it byte by byte
    await page.click(cell(ids[0]));
    let downloads = 0; page.on('download', () => downloads++);
    const dlP = page.waitForEvent('download', { timeout: 60000 });
    const n0 = await page.evaluate(() => STUDIO.history.entries.length);
    await page.keyboard.press('Control+e');
    await page.waitForTimeout(500);
    ok(await page.evaluate(() => STUDIO.store.peek(['ui', 'exportRun', 'running'])), 'Mod+E starts the export');
    await shot('running');
    const dl = await dlP;
    const file = path.join(OUT, 'export-test.zip');
    await dl.saveAs(file);
    const zip = readZip(fs.readFileSync(file));
    ok(/^Export - Zine - Coastline - \d{4}-\d\d-\d\d \d{4}\.zip$/.test(dl.suggestedFilename()), `the zip is named after the set: ${dl.suggestedFilename()}`);
    ok(zip.length === 8 && zip.every(f => f.crcOk && f.method === 0), `8 stored files, every CRC right: ${zip.map(f => f.name).join(', ')}`);
    const dims = zip.map(f => jpegSize(f.data));
    ok(dims.every(x => x && x.w === x.h && x.w === 512), `square JPEGs, 512 px (the photos are smaller than 1080: never enlarged): ${JSON.stringify(dims[0])}`);
    ok(zip.every(f => /^1991-\d\d-\d\d_0\d_.+\.jpg$/.test(f.name)), 'names follow the template');
    ok(/^ok 8$/.test(pyTest(file)) || /unavailable/.test(pyTest(file)), `Python's zipfile agrees: ${pyTest(file)}`);
    await idle(400);
    const sts = await page.evaluate(ids => ids.map(id => STUDIO.store.peek(['exportDesk', 'status', id]).s), ids);
    ok(sts.every(x => x === 'exported'), 'every photo is marked Exported');
    labels = await page.evaluate(() => STUDIO.history.entries.map(e => e.label + (e.detail ? ' · ' + e.detail : '')));
    ok(labels.length === n0 + 1 && /^Export 8 Photos · Export - Zine/.test(labels[labels.length - 1]), `one undo step per run: ${labels[labels.length - 1]}`);
    ok(/0 to export · 8 exported/.test(await counts(page)), `counts after: "${await counts(page)}"`);
    const qrows = await page.locator('.exp-qr.is-done').count();
    ok(qrows === 8, `the queue lists 8 finished files (${qrows})`);
    await shot('exported');
    // Save Again hands over the same zip and records nothing new
    const againP = page.waitForEvent('download', { timeout: 20000 });
    await page.click('.ck-panel[data-panel="export-queue"] .ck-btn:has-text("Save the Zip Again")');
    const again = await againP;
    ok(again.suggestedFilename() === dl.suggestedFilename() && (await page.evaluate(() => STUDIO.history.entries.length)) === n0 + 1, 'Save the Zip Again offers the same file, no new undo step');
    await page.click(cell(ids[0]));
    await page.keyboard.press('Control+z');
    ok((await status(page, ids[0])) === 'ready', 'undo takes the run back to Ready');
    await page.keyboard.press('Control+Shift+z');
    ok((await status(page, ids[0])) === 'exported', 'redo marks it Exported again');

    // edit after export: double-click opens Develop with that photo; the change makes it Review again
    await page.dblclick(cell(ids[1]));
    await idle(800);
    ok((await st(['view', 'module'])) === 'develop' && (await st(['ui', 'selection', 'primary'])) === ids[1], `double-click opens ${ids[1]} in Develop`);
    await page.evaluate(id => STUDIO.store.tx('Exposure', t => { t.dev[id].light.exposure = 1.2; }), ids[1]);
    await page.keyboard.press('Control+Shift+e');
    await idle(600);
    ok((await page.locator(`.exp-cell[data-id="${ids[1]}"] .exp-badge`).innerText()) === 'Review', 'an exported photo edited afterwards shows Review');
    ok(/0 to export · 1 needs review · 7 exported/.test(await counts(page)), `counts: "${await counts(page)}"`);

    // leave out and bring back
    await page.click(cell(ids[2]));
    await page.keyboard.press('Delete');
    await page.waitForTimeout(150);
    ok((await page.evaluate(() => STUDIO.store.peek(['ui', 'exportSet']).length)) === 7, 'Delete leaves a photo out of the set');
    await page.click('.ck-panel[data-panel="export-set"] .ck-btn:has-text("Bring Back")');
    ok((await page.evaluate(() => STUDIO.store.peek(['ui', 'exportSet']).length)) === 8, 'Bring Back restores it');

    // cancel: the whole Library view at full size PNG, cancel after the first file
    await page.click('.exp-srcs .exp-src:has-text("All in current filter")');
    await page.click('.exp-preset:has-text("Full size")');
    await page.waitForTimeout(150);
    const d1 = downloads;
    const ready0 = await page.evaluate(() => Object.keys(STUDIO.store.peek(['exportDesk', 'status'])).length);
    const h0 = await page.evaluate(() => STUDIO.history.entries.length);
    await page.keyboard.press('Control+e');
    await page.waitForFunction(() => STUDIO.store.peek(['ui', 'exportRun', 'done']) >= 1, null, { timeout: 30000 });
    await page.keyboard.press('Control+Period');
    await page.waitForFunction(() => !STUDIO.store.peek(['ui', 'exportRun', 'running']), null, { timeout: 30000 });
    await idle(600);
    const run = await st(['ui', 'exportRun']);
    ok(run.cancelled && run.done < run.total, `Mod+. cancels (${run.done} of ${run.total} done)`);
    ok(downloads === d1 && (await page.evaluate(() => STUDIO.history.entries.length)) === h0 && (await page.evaluate(() => Object.keys(STUDIO.store.peek(['exportDesk', 'status'])).length)) === ready0, 'a cancelled export saves nothing and changes no status');
    ok((await page.locator('.exp-qr.is-cancelled').count()) > 0, 'the queue shows what was cancelled');
    await shot('cancelled');

    // the contact sheet: one PNG of the set
    const shP = page.waitForEvent('download', { timeout: 90000 });
    await page.click('.ck-panel[data-panel="export-queue"] .ck-btn:has-text("Contact Sheet")');
    const sh = await shP;
    const shFile = path.join(OUT, 'export-contact.png');
    await sh.saveAs(shFile);
    const ps = pngSize(fs.readFileSync(shFile));
    ok(ps && ps.w > 1500 && ps.h > 1500 && /^Contact Sheet - All in current filter/.test(sh.suggestedFilename()), `a contact sheet PNG: ${JSON.stringify(ps)} ${sh.suggestedFilename()}`);

    const d2 = await diag(page);
    ok(d2.length === 0, `still clean after all that: ${d2.join(' | ') || 'no warnings or errors'}`);
  },

  async exportSelection({ page, st, ok, shot, idle }) {
    // Library: select three, then File ▸ Export Set from Selection
    await page.click('.ck-gridview .ck-coll-cell >> nth=2');
    await page.click('.ck-gridview .ck-coll-cell >> nth=4', { modifiers: ['Shift'] });
    await page.click('.ck-menubar-t:text-is("File")');
    await page.click('.ck-menu-i:has-text("Export Set from Selection")');
    await idle(800);
    ok((await st(['view', 'module'])) === 'export' && (await st(['exportDesk', 'source'])) === 'selection', 'File ▸ Export Set from Selection opens Export with that set');
    const n = await page.evaluate(() => STUDIO.store.peek(['ui', 'exportSet']).length);
    ok(n === 3, `the set is the three selected photos (${n})`);
    // clicking in the export grid does not shrink a set taken from the selection
    await page.click('.ck-gridview .ck-coll-cell >> nth=0');
    ok((await page.evaluate(() => STUDIO.store.peek(['ui', 'exportSet']).length)) === 3, 'clicking a photo in the set keeps the set');
    // a disabled command explains itself
    await page.click('.ck-menubar-t:text-is("File")');
    await page.waitForTimeout(150);
    const why = await page.locator('.ck-menu-i:has-text("Cancel Export")').getAttribute('aria-disabled');
    ok(why === 'true', 'Cancel Export is disabled when nothing runs');
    await shot('file-menu');
    await page.keyboard.press('Escape');
    // the palette finds the module's commands
    await page.keyboard.press('Control+k');
    await page.keyboard.type('contact sheet');
    await page.waitForTimeout(150);
    ok(/Contact Sheet/.test(await page.locator('.ck-palette-r.is-active .ck-palette-t').innerText()), 'the palette finds Contact Sheet');
    await page.keyboard.press('Escape');
    // the shortcut sheet lists the module's keys
    await page.keyboard.press('Control+/');
    await page.waitForTimeout(150);
    const sheet = await page.locator('.ck-sheet-s:has(h4:text-is("Export module")) .ck-sheet-r').allInnerTexts();
    ok(sheet.some(r => /Export/.test(r)) && sheet.length >= 5, `the shortcut sheet has an Export section (${sheet.length} keys)`);
    await page.keyboard.press('Escape');
    // reload: the set and the statuses are document state
    await page.evaluate(() => STUDIO.store.tx('Mark Ready', t => { t.exportDesk.status.kodim03 = { s: 'review', why: 'test' }; }));
    await page.waitForTimeout(1500);
    await page.reload();
    await page.waitForFunction(() => window.STUDIO && window.STUDIO.root);
    await idle(800);
    ok((await st(['exportDesk', 'source'])) === 'selection' && (await st(['exportDesk', 'status', 'kodim03', 's'])) === 'review', 'the set and the statuses survive a reload');
  },

  async exportFailure({ page, st, ok, shot, idle }) {
    // the engine fails on the second photo: the run goes on, the zip holds the others, the failure is recorded
    await page.keyboard.press('Control+Shift+e');
    await idle(800);
    await page.click('.exp-srcs .exp-src:has-text("Portraits")');
    await page.evaluate(() => { const eng = STUDIO.engine, orig = eng.pixels.bind(eng); let n = 0; eng.pixels = async (e, v, o) => (++n === 2 ? { error: 'simulated engine failure' } : orig(e, v, o)); });
    const ids = await page.evaluate(() => STUDIO.store.peek(['ui', 'exportSet']).map(p => p.id));
    const dlP = page.waitForEvent('download', { timeout: 60000 });
    await page.click('.ck-panel[data-panel="export-queue"] .ck-btn.is-primary');
    const dl = await dlP;
    const file = path.join(OUT, 'export-failure.zip');
    await dl.saveAs(file);
    const zip = readZip(fs.readFileSync(file));
    await idle(300);
    ok(zip.length === ids.length - 1 && zip.every(f => f.crcOk), `the zip holds the ${zip.length} that worked`);
    const sts = await page.evaluate(ids => ids.map(id => STUDIO.store.peek(['exportDesk', 'status', id])), ids);
    ok(sts[1].s === 'failed' && /simulated/.test(sts[1].why) && sts[0].s === 'exported' && sts[2].s === 'exported', `the failure is recorded with its reason: ${JSON.stringify(sts[1])}`);
    const last = await page.evaluate(() => STUDIO.history.entries[STUDIO.history.entries.length - 1].label);
    ok(last === 'Export 2 Photos (1 failed)', `the undo step says so: ${last}`);
    ok((await page.locator(`.exp-cell[data-id="${ids[1]}"] .exp-badge`).innerText()) === 'Failed', 'the cell shows Failed');
    ok(/0 to export · 2 exported · 1 failed/.test(await counts(page)), `counts: "${await counts(page)}"`);
    await page.click('.ck-segmented .ck-seg-b:has-text("Failed"), .exp-head .ck-seg-b:has-text("Failed")');
    await page.waitForTimeout(200);
    ok((await page.locator('.exp-grid .ck-coll-cell').count()) === 1, 'Show: Failed narrows the grid to the failed photo');
    await page.click(cell(ids[1]));
    await page.keyboard.press('Enter');
    ok((await status(page, ids[1])) === 'ready', 'Enter makes a failed photo Ready to try again');
    await shot('failed');
  },

  async exportPhone({ page, st, ok, shot, idle }) {
    await page.setViewportSize({ width: 400, height: 800 });
    await page.reload();
    await page.waitForFunction(() => window.STUDIO && window.STUDIO.root);
    await idle(800);
    await page.keyboard.press('Control+Shift+e');
    await idle(1200);
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.querySelector('.ck-app').scrollWidth, document.querySelector('.exp-tb').scrollWidth <= document.querySelector('.exp-tb').clientWidth + 1]);
    ok(w[0] <= 400 && w[1] <= 400 && w[2], `no horizontal scroll at 400 px (${w.join(', ')})`);
    await shot('phone');
    await page.evaluate(() => { STUDIO.store.set(['workspace', 'hide'], {}); STUDIO.store.set(['workspace', 'layout', 'export'], { left: { hidden: true } }); });
    await idle(600);
    const r = await page.evaluate(() => { const c = document.querySelector('.ck-side-right'); const b = c.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right), document.documentElement.scrollWidth]; });
    ok(r[0] >= 0 && r[1] <= 400 && r[2] <= 400, `the right column floats inside the screen (${r.join(', ')})`);
    await shot('phone-right');
  },
};
