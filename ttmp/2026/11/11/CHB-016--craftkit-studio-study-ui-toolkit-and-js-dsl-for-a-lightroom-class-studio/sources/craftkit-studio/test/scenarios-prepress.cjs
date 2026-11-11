// Prepress (W-05): what a reviewer does at the approval desk, with checks on the state that results.
const fs = require('fs');

const vpSel = '.ck-vp[data-viewport="prepress"]';
// a point on the shown page (u, v across the image) in page coordinates
const at = (page, u, v) => page.evaluate(([u, v]) => { const vp = STUDIO.viewport('prepress'); const r = vp.el.getBoundingClientRect(); const [x, y] = vp.toScreen(u, v); return [r.left + x, r.top + y]; }, [u, v]);
const drag = async (page, a, b, steps = 12) => { await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(b[0], b[1], { steps }); await page.mouse.up(); };
const diags = page => page.evaluate(() => STUDIO.diagnostics.list.filter(d => d.level !== 'info').map(d => d.format()));
const pp = (st, k) => st(['ui', 'pp', k]);
const statusOf = (page, id) => page.evaluate(i => { const p = STUDIO.store.peek(['prepress', 'pages', i]); return (p && p.status) || 'open'; }, id);
const waitFor = (page, fn, arg, ms = 20000) => page.waitForFunction(fn, arg, { timeout: ms });

module.exports = {
  async prepress({ page, st, ok, shot, idle }) {
    ok((await diags(page)).length === 0, 'the build report is clean before Prepress opens');
    await page.keyboard.press('Alt+p');
    await idle(1500);
    ok((await st(['view', 'module'])) === 'prepress', 'Alt+P opens Prepress');
    ok((await page.locator('.pp-page').count()) === 8, 'the job is the 8 photos of "Zine: Coastline"');
    ok((await pp(st, 'sel')).primary === 'kodim06', 'the first page is on screen (Moored boat)');
    await waitFor(page, () => Object.keys(STUDIO.store.peek(['ui', 'pp', 'stats'])).length >= 8 && STUDIO.store.peek(['ui', 'pp', 'rev']) > 0);
    const s6 = await page.evaluate(() => STUDIO.store.peek(['ui', 'pp', 'stats', 'kodim06']));
    ok(s6.cov.length === 4 && s6.max > 0 && s6.max <= 381, `every page is measured (Moored boat: C ${s6.cov.map(Math.round).join(' / ')} %, max ${Math.round(s6.max)} %)`);
    const checks = await page.locator('.pp-check').evaluateAll(els => els.map(e => e.dataset.check + ':' + [...e.classList].find(c => c.startsWith('is-'))));
    ok(checks.length === 5 && checks.includes('ppi:is-fail'), `Preflight lists its checks: ${checks.join(' ')}`);

    // the densitometer reads the pixel under the pointer with the engine's GCR model
    const mid = await at(page, 0.42, 0.62);
    await page.mouse.move(mid[0], mid[1]); await page.mouse.move(mid[0] + 1, mid[1] + 1);
    await page.waitForTimeout(150);
    const txt = await page.locator('.pp-dens').innerText();
    const mm = txt.replace(/\s+/g, ' ').match(/C ?(\d+) ?M ?(\d+) ?Y ?(\d+) ?K ?(\d+) ?= ?(\d+) %/);
    ok(!!mm, `the densitometer shows C M Y K and the total: "${txt.replace(/\s+/g, ' ')}"`);
    const want = await page.evaluate(([u, v]) => {
      const bmp = STUDIO.viewport('prepress').bitmap(); const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
      const x = Math.floor(u * bmp.width), y = Math.floor(v * bmp.height); const d = g.getImageData(x - 1, y - 1, 3, 3).data; const s = [0, 0, 0, 0];
      for (let i = 0; i < d.length; i += 4) { let cc = 1 - d[i] / 255, m = 1 - d[i + 1] / 255, yy = 1 - d[i + 2] / 255; const k = Math.min(cc, m, yy) * 0.8; cc = (cc - k) / (1 - k); m = (m - k) / (1 - k); yy = (yy - k) / (1 - k); s[0] += cc; s[1] += m; s[2] += yy; s[3] += k; }
      return s.map(t => Math.round(t / 9 * 100));
    }, await page.evaluate(([x, y]) => { const vp = STUDIO.viewport('prepress'); const r = vp.el.getBoundingClientRect(); return vp.toImage(x - r.left, y - r.top); }, [mid[0] + 1, mid[1] + 1]));
    const got = mm ? mm.slice(1, 5).map(Number) : [];
    ok(mm && got.every((g, i) => Math.abs(g - want[i]) <= 2) && Math.abs(+mm[5] - got.reduce((a, b) => a + b, 0)) <= 1, `the reading matches toCmyk on the shown bitmap (${got.join(' ')} vs ${want.join(' ')})`);
    await shot('desk');

    // approve, auto-advance, undo, reject, J / K
    await page.keyboard.press('a');
    ok((await statusOf(page, 'kodim06')) === 'approved', 'A approves the page');
    ok((await pp(st, 'sel')).primary === 'kodim11', 'and moves on to the next page');
    const hist = await page.evaluate(() => STUDIO.history.entries.map(e => e.label));
    ok(hist.length === 1 && /^Approve Page 1$/.test(hist[0]), `one undo step with a readable label: ${JSON.stringify(hist)}`);
    await page.keyboard.press('Control+z');
    ok((await statusOf(page, 'kodim06')) === 'open', 'Mod+Z undoes the approval');
    await page.keyboard.press('Control+Shift+z');
    ok((await statusOf(page, 'kodim06')) === 'approved', 'Mod+Shift+Z redoes it');
    await page.keyboard.press('r');
    ok((await statusOf(page, 'kodim11')) === 'rejected', 'R rejects the page on screen');
    ok((await pp(st, 'sel')).primary === 'kodim12', 'and moves on as well');
    await page.keyboard.press('k');
    ok((await pp(st, 'sel')).primary === 'kodim11', 'K goes back a page');
    await page.keyboard.press('j');
    ok((await pp(st, 'sel')).primary === 'kodim12', 'J goes forward a page');
    await page.waitForTimeout(150);
    const chips = await page.locator('.pp-chip').allInnerTexts();
    ok(chips[0] === 'Approved' && chips[1] === 'Rejected' && chips[2] === 'Open', `status chips in the list: ${chips.slice(0, 3).join(', ')}`);
    await page.waitForTimeout(1200);
    const saved = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('ck:CraftKit Studio:3:doc')).prepress.pages; } catch (e) { return null; } });
    ok(saved && saved.kodim06 && saved.kodim06.status === 'approved', 'approvals are autosaved with the document');
    await idle(800);

    // soft proof (Mod+Y): the engine's softProof op
    await page.keyboard.press('Control+y');
    await idle(1200);
    const key = await page.evaluate(() => STUDIO.viewport('prepress').view.key);
    ok((await st(['view', 'pp', 'proof'])) === true && /softProof/.test(key), 'Mod+Y shows the engine\'s soft proof');
    await shot('proof');
    // the ink heatmap (H), the gamut warning (Mod+Shift+Y)
    await page.keyboard.press('h');
    await page.waitForTimeout(600);
    ok((await page.locator(`${vpSel} .pp-fo canvas.pp-layer.is-glow`).count()) === 1, 'H shows the ink heatmap over the page');
    await shot('heatmap');
    await page.keyboard.press('Control+Shift+y');
    await page.waitForTimeout(400);
    ok((await st(['view', 'pp', 'gamut'])) === true && (await page.locator(`${vpSel} .pp-fo`).count()) === 3, 'Mod+Shift+Y adds the gamut warning');
    await page.keyboard.press('h'); await page.keyboard.press('Control+Shift+y'); await page.keyboard.press('Control+y');
    await idle(900);
    // plates: 1 solos cyan (as grey), Alt-click on an eye solos, 0 shows all
    await page.keyboard.press('1');
    await page.waitForTimeout(400);
    ok(JSON.stringify(await st(['view', 'pp', 'plates'])) === '[true,false,false,false]', '1 shows the cyan plate alone');
    const grey = await page.evaluate(() => { const c = document.querySelector('.ck-vp[data-viewport="prepress"] .pp-fo canvas'); if (!c) return null; const d = c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data; return [d[0], d[1], d[2]]; });
    ok(grey && grey[0] === grey[1] && grey[1] === grey[2], `one plate shows as grey (${grey})`);
    await shot('cyan-plate');
    await page.click('.pp-ink.is-m .pp-eye', { modifiers: ['Alt'] });
    ok(JSON.stringify(await st(['view', 'pp', 'plates'])) === '[false,true,false,false]', 'Alt-click on the magenta eye solos magenta');
    await page.click('.pp-ink.is-y .pp-eye');
    ok(JSON.stringify(await st(['view', 'pp', 'plates'])) === '[false,true,true,false]', 'a click on an eye adds that plate');
    await page.keyboard.press('0');
    ok((await st(['view', 'pp', 'plates'])).every(Boolean), '0 shows every plate');

    // measuring: marquee (M), Shift adds, Alt subtracts, Info shows the figures, Mod+D deselects
    await page.keyboard.press('m');
    ok((await st(['ui', 'tool'])) === 'pp-rect', 'M picks the Rectangular Marquee (not Develop\'s gradient)');
    await drag(page, await at(page, 0.1, 0.5), await at(page, 0.5, 0.95));
    await page.waitForTimeout(500);
    let mq = await pp(st, 'marquee');
    ok(mq && mq.shapes.length === 1 && mq.shapes[0].kind === 'rect', 'a drag makes a rectangular selection');
    await waitFor(page, () => { const x = STUDIO.store.peek(['ui', 'pp', 'selStats']); return x && x.n > 0; }, null, 5000).catch(() => {});
    const ss = await pp(st, 'selStats');
    ok(ss && ss.n > 0 && ss.cmyk.length === 4 && ss.max >= ss.tac && ss.over >= 0, `the selection is measured: ${ss && `${ss.area.toFixed(1)} % of the page, mean ${Math.round(ss.tac)} %, max ${Math.round(ss.max)} %, over ${ss.over.toFixed(1)} %`}`);
    const info = await page.locator('.pp-selinfo').innerText();
    ok(/Average/.test(info) && /Total ink/.test(info) && /Over 300 %/.test(info), 'the Info panel shows the average CMYK, the total ink and the share over the limit');
    await page.keyboard.press('Shift+m');
    ok((await st(['ui', 'tool'])) === 'pp-ellipse', 'Shift+M picks the Elliptical Marquee');
    await page.keyboard.down('Shift');
    await drag(page, await at(page, 0.55, 0.1), await at(page, 0.9, 0.45));
    await page.keyboard.up('Shift');
    mq = await pp(st, 'marquee');
    ok(mq.shapes.length === 2 && mq.shapes[1].kind === 'ellipse' && mq.shapes[1].op === 'add', 'Shift adds an ellipse to the selection');
    await page.keyboard.press('Shift+m');
    ok((await st(['ui', 'tool'])) === 'pp-rect', 'Shift+M again cycles back to the rectangle');
    await page.keyboard.down('Alt');
    await drag(page, await at(page, 0.2, 0.6), await at(page, 0.3, 0.7));
    await page.keyboard.up('Alt');
    mq = await pp(st, 'marquee');
    ok(mq.shapes.length === 3 && mq.shapes[2].op === 'sub', 'Alt subtracts');
    await page.waitForTimeout(150);
    const ants = await page.locator(`${vpSel} .pp-ants-b`).count();
    ok(ants === 3 && (await page.locator(`${vpSel} mask`).count()) === 3, `marching ants outline the selection (${ants} outlines, each masked by the others)`);
    await shot('marquee');
    const n0 = await page.evaluate(() => STUDIO.history.entries.length);
    await page.keyboard.press('Control+d');
    ok((await pp(st, 'marquee')) === null, 'Mod+D deselects in Prepress');
    ok((await page.evaluate(() => STUDIO.history.entries.length)) === n0, 'the measuring selection is view state (no undo step)');
    await page.keyboard.press('Control+Shift+d');
    ok((await pp(st, 'marquee')) && (await pp(st, 'marquee')).shapes.length === 3, 'Mod+Shift+D reselects');
    await page.keyboard.press('l');
    await page.mouse.move(...(await at(page, 0.3, 0.3))); await page.mouse.down();
    for (const [u, v] of [[0.45, 0.25], [0.55, 0.4], [0.4, 0.5], [0.28, 0.42]]) await page.mouse.move(...(await at(page, u, v)), { steps: 4 });
    await page.mouse.up();
    mq = await pp(st, 'marquee');
    ok(mq.shapes.length === 1 && mq.shapes[0].kind === 'lasso' && mq.shapes[0].pts.length > 4, `L draws a lasso (${mq.shapes[0].pts.length} points)`);
    await page.keyboard.press('Escape');
    ok((await st(['ui', 'tool'])) === null, 'Esc leaves the tool');

    // notes: N over the page pins a note at the pointer
    const np = await at(page, 0.7, 0.3);
    await page.mouse.move(np[0], np[1]); await page.mouse.move(np[0] + 1, np[1]);
    await page.keyboard.press('n');
    await page.waitForTimeout(400);
    await page.keyboard.type('Horizon tilts left');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    const notes = await page.evaluate(() => STUDIO.store.peek(['prepress', 'pages', 'kodim12', 'notes']));
    ok(notes && notes.length === 1 && notes[0].text === 'Horizon tilts left' && Math.abs(notes[0].u - 0.7) < 0.02 && Math.abs(notes[0].v - 0.3) < 0.02, `N pins a note where the pointer is: ${JSON.stringify(notes && notes[0])}`);
    ok((await page.locator(`${vpSel} .pp-pin`).count()) === 1, 'the pin is on the page');
    await page.mouse.move(0, 0);
    await page.evaluate(() => STUDIO.store.set(['ui', 'pp', 'note'], null));
    await page.waitForTimeout(150);
    const pinBox = await page.locator(`${vpSel} .pp-pin path`).boundingBox();
    const z0 = (await st(['view', 'vp', 'prepress'])).zoom;
    await page.mouse.click(pinBox.x + pinBox.width / 2, pinBox.y + pinBox.height / 3);
    await page.waitForTimeout(400);
    ok((await pp(st, 'note')) === notes[0].id && (await page.evaluate(() => document.activeElement && document.activeElement.closest('.pp-note') ? document.activeElement.closest('.pp-note').dataset.id : null)) === notes[0].id, 'clicking a pin selects its note and puts the cursor in its text');
    ok((await st(['view', 'vp', 'prepress'])).zoom === z0, 'and does not zoom the page');
    await page.keyboard.press('Escape');
    const h2 = await page.evaluate(() => STUDIO.history.entries.slice(-2).map(e => e.label));
    ok(h2[0] === 'Add Note' && h2[1] === 'Edit Note', `two undo steps: ${h2.join(', ')}`);
    await page.keyboard.press('a');
    ok((await statusOf(page, 'kodim12')) === 'approved', 'after Enter the keys work again (A approved the page)');

    // a failing check turns on its overlay: Moored boat is over the ink limit and short of resolution
    await page.click('.pp-page[data-id="kodim06"]');
    await idle(600);
    ok((await pp(st, 'sel')).primary === 'kodim06', 'a click in the page list shows that page');
    await page.keyboard.press('u');
    ok((await statusOf(page, 'kodim06')) === 'open' && (await pp(st, 'sel')).primary === 'kodim06', 'U in the focused list reopens the page (and stays on it)');
    await page.keyboard.press('Shift+2');
    ok(JSON.stringify(await st(['view', 'pp', 'plates'])) === '[true,false,true,true]', 'Shift+2 hides the magenta plate');
    await page.keyboard.press('Shift+2');
    await page.click('button.pp-check[data-check="tac"]');
    await page.waitForTimeout(300);
    ok((await st(['view', 'pp', 'heat'])) === true, 'clicking the failing Total ink check shows the heatmap');
    await page.click('button.pp-check[data-check="ppi"]');
    await page.waitForTimeout(300);
    const z = (await st(['view', 'vp', 'prepress'])).zoom;
    ok(typeof z === 'number' && Math.abs(z - 8.27 * 96 / 768) < 0.02, `clicking the failing Resolution check shows the print size (zoom ${typeof z === 'number' ? z.toFixed(3) : z})`);
    await shot('print-size');
    await page.keyboard.press('Control+0');
    await page.keyboard.press('h');
    // job settings are document state
    await page.click('.ck-panel[data-panel="pp-paper"] .ck-btn:has-text("Use")');
    ok((await st(['prepress', 'tac'])) === 330, 'Use sets the paper\'s usual ink limit (330 % for Coated FOGRA39)');
    await page.keyboard.press('Control+z');
    ok((await st(['prepress', 'tac'])) === 300, 'and it undoes');
    await page.selectOption('.ck-panel[data-panel="pp-paper"] .ck-select:has(.ck-field-l:text-is("Print size")) select', { label: '5 × 7 in' });
    ok((await st(['prepress', 'size'])) === '5x7', 'the print size is a job setting');
    await page.waitForTimeout(150);
    const ppiText = await page.locator('.ck-panel[data-panel="pp-paper"] .ck-stat:has-text("This page") .ck-stat-v').innerText();
    ok(/^110 ppi · 7\.0 × 4\.7 in/.test(ppiText), `effective ppi at 5 × 7 in for 768 × 512 px (768 / 7 in): ${ppiText}`);

    // the approval report
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('.ck-panel[data-panel="pp-pages"] .ck-btn:has-text("Approval Report")')]);
    const html = fs.readFileSync(await dl.path(), 'utf8');
    try { fs.writeFileSync(require('path').join(process.env.OUT || '.', 'prepress-report.html'), html); } catch (e) { /* only a copy to look at */ }
    ok(/^approval-zine-coastline-\d{4}-\d\d-\d\d\.html$/.test(dl.suggestedFilename()), `the report is saved: ${dl.suggestedFilename()}`);
    ok(/Moored boat/.test(html) && /Approved/.test(html) && /Rejected/.test(html) && /Horizon tilts left/.test(html) && /GCR|grey-component/.test(html) && (html.match(/<section/g) || []).length === 8, 'it lists every page with its status, checks and notes');

    // Mod+D keeps its Library meaning in the Library
    await page.keyboard.press('g');
    await idle(500);
    ok((await st(['view', 'module'])) === 'library', 'G goes to the Library');
    await page.keyboard.press('Control+a'); await page.keyboard.press('Control+d');
    ok((await st(['ui', 'selection', 'ids'])).length === 1, 'Mod+D in the Library still selects one photo');
    const menuItems = async name => { await page.click(`.ck-menubar-t:text-is("${name}")`); await page.waitForTimeout(150); const t = await page.locator('.ck-menu .ck-menu-l').allInnerTexts(); await page.keyboard.press('Escape'); await page.waitForTimeout(100); return t; };
    const libPhoto = await menuItems('Photo');
    const libView = await menuItems('View');
    ok(libPhoto.some(t => /Set as Rejected/.test(t)) && !libPhoto.some(t => /Approve Page|Reject Page/.test(t)) && !libView.some(t => /Proof Colors|^Plates/.test(t)), 'Prepress commands stay out of the Library\'s Photo and View menus');
    await page.keyboard.press('Alt+p');
    await idle(800);
    const ppPhoto = await menuItems('Photo'), ppView = await menuItems('View');
    ok(ppPhoto.some(t => /^Approve Page/.test(t)) && ppView.some(t => /^Proof Colors/.test(t)) && ppView.some(t => /^Plates/.test(t)), 'and show in Prepress (Photo ▸ Approve Page, View ▸ Proof Colors, Plates)');
    // several pages at once: Shift-click in the list, then A
    await page.click('.pp-page[data-id="kodim16"]');
    await page.click('.pp-page[data-id="kodim21"]', { modifiers: ['Shift'] });
    const n1 = await page.evaluate(() => STUDIO.history.entries.length);
    await page.keyboard.press('a');
    const many = await page.evaluate(() => ['kodim16', 'kodim19', 'kodim21'].map(id => (STUDIO.store.peek(['prepress', 'pages', id]) || {}).status));
    const lastLabel = await page.evaluate(() => STUDIO.history.entries[STUDIO.history.entries.length - 1].label);
    ok(many.every(x => x === 'approved') && (await page.evaluate(() => STUDIO.history.entries.length)) === n1 + 1 && lastLabel === 'Approve 3 Pages', `A approves every selected page in one step (${lastLabel})`);
    // sources: the selection, another collection
    await page.selectOption('.ck-panel[data-panel="pp-pages"] select', { label: 'On the water (6)' });
    await page.waitForTimeout(300);
    ok((await page.locator('.pp-page').count()) === 6 && (await pp(st, 'sel')).primary === 'kodim21', 'the job follows its source (On the water: 6 pages; Lighthouse point is in both, so it stays on screen)');
    await page.selectOption('.ck-panel[data-panel="pp-pages"] select', { label: 'Quick Collection (0)' });
    await idle(600);
    const empty = await page.evaluate(() => ({ rows: document.querySelectorAll('.pp-page').length, msg: !document.querySelector('.ck-vp[data-viewport="prepress"] .ck-vp-msg').hidden, hud: document.querySelector('.ck-vp[data-viewport="prepress"] .ck-hud.at-top-left').textContent, why: STUDIO.commands.status('prepress.approve', STUDIO.store.readonly()) }));
    ok(empty.rows === 0 && !empty.msg && /No pages/.test(empty.hud) && !empty.why.ok && /source/.test(empty.why.why), `an empty source: no pages, no render error, and Approve says why (${empty.why.why})`);
    await page.selectOption('.ck-panel[data-panel="pp-pages"] select', { label: 'Portraits (3)' });
    await page.waitForTimeout(300);
    ok((await page.locator('.pp-page').count()) === 3 && (await pp(st, 'sel')).primary === 'kodim04', 'a page that is not in the new job gives way to its first page');
    for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
    ok((await st(['prepress', 'source'])) === 'collection:zine', 'the source is part of the job (three undos bring the zine back)');
    const left = await diags(page);
    ok(left.length === 0, `no diagnostics after all that${left.length ? ': ' + left.join(' | ') : ''}`);
  },

  async prepressThemes({ page, st, ok, shot, idle }) {
    await page.keyboard.press('Alt+p');
    await idle(1500);
    await page.waitForFunction(() => STUDIO.store.peek(['ui', 'pp', 'rev']) > 0, null, { timeout: 15000 });
    await page.keyboard.press('h');
    await page.mouse.move(...(await at(page, 0.3, 0.8)));
    await page.waitForTimeout(500);
    await shot('dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(400);
    await shot('light');
    // a phone: 400 px wide, no sideways scroll
    await page.setViewportSize({ width: 400, height: 860 });
    await page.evaluate(() => STUDIO.store.set(['workspace', 'hide'], { sides: true }));
    await idle(1200);
    const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, tb: (() => { const t = document.querySelector('.pp-tb'); return t ? [t.scrollWidth, t.clientWidth] : null; })() }));
    ok(w.doc <= 400 && w.body <= 400 && w.tb && w.tb[0] <= w.tb[1] + 1, `no sideways scroll at 400 px (${JSON.stringify(w)})`);
    await shot('phone-light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => STUDIO.store.set(['workspace', 'hide'], {}));
    await page.waitForTimeout(500);
    await shot('phone-panels-dark');
    const left = await diags(page);
    ok(left.length === 0, `no diagnostics${left.length ? ': ' + left.join(' | ') : ''}`);
  },
};
