/* studio-worker.js · the engine side of the shell's engine bridge. Appended after the CraftKit engine files
 * (catalog, recorder, engine, ops, presenter) in one worker blob.
 *
 * The page compiles the app's whole engine graph once (the shell records ck.image(…).develop(…) chains at build
 * time and emits them as one CraftKit program), then sends render requests that carry only input values. Every
 * request has an epoch; the page drops answers older than what it has already drawn, and the worker skips queued
 * requests that a newer one on the same lane has replaced (latest wins). */
(function () {
  'use strict';
  const E = self.CK_ENGINE;
  let names = {}, inputs = {};
  // two lanes: 'live' (what the person is looking at) jumps ahead of 'bg' (thumbnails, batch, exports)
  const queue = { live: [], bg: [] };
  let running = false;

  function reply(m, transfer) { self.postMessage(m, transfer || []); }

  async function compile(m) {
    let out;
    try { out = await self.CK.run(m.code, self.CK_CATALOG, { target: 'wasm' }); }
    catch (err) { return reply({ type: 'compiled', id: m.id, ok: false, errors: [String(err && err.message || err)] }); }
    const errors = (out.error ? [`${out.error.line ? 'line ' + out.error.line + ': ' : ''}${out.error.kind}: ${out.error.message}`] : [])
      .concat(out.diagnostics.filter(d => d.level === 'error').map(d => `${d.kind}: ${d.message}`));
    if (errors.length) return reply({ type: 'compiled', id: m.id, ok: false, errors });
    E.load(out, out.fns);
    names = {}; inputs = {};
    for (const n of out.ir.nodes) if (n.name) names[n.name] = n.id;
    for (const c of out.ir.controls) if (c.type === 'input') inputs[c.label] = c.id;
    reply({ type: 'compiled', id: m.id, ok: true, names, inputs, nodes: out.ir.nodes.length,
      warnings: out.diagnostics.filter(d => d.level !== 'error').map(d => d.message) });
  }

  // controls arrive keyed by input name; the engine reads them by control id
  function controlsOf(values) {
    const c = {};
    for (const [k, v] of Object.entries(values || {})) if (inputs[k]) c[inputs[k]] = v;
    return c;
  }

  async function render(m) {
    const t0 = performance.now();
    const items = (m.items || []).map(it => ({ key: it.key, ref: names[it.out] || it.out, max: it.max, lens: it.lens || null }));
    let res;
    try { res = await E.render({ controls: controlsOf(m.values), items, target: 'wasm' }); }
    catch (err) { res = { views: {}, errors: { _: { message: String(err && err.message || err) } }, transfer: [] }; }
    const transfer = res.transfer || []; delete res.transfer;
    reply({ type: 'rendered', id: m.id, epoch: m.epoch, lane: m.lane, views: res.views, errors: res.errors,
      ms: Math.round(performance.now() - t0), computed: res.computed, hits: res.hits }, transfer);
  }

  // pixels for analysis (histogram, scopes, densitometer, export): RGBA8 at a size
  async function pixels(m) {
    try {
      const env = { controls: controlsOf(m.values), time: 0, sheet: {}, target: 'wasm', bind: null };
      const X = E.ctx(env);
      let v = await X.eval(names[m.out] || m.out);
      v = await X.img(v);
      if (m.max && Math.max(v.w, v.h) > m.max) { const k = m.max / Math.max(v.w, v.h); v = E.resample(v, Math.round(v.w * k), Math.round(v.h * k)); }
      if (m.encode) {
        const blob = await E.toCanvas(v).convertToBlob({ type: m.encode, quality: m.quality || 0.92 });
        const buf = await blob.arrayBuffer();
        return reply({ type: 'pixels', id: m.id, ok: true, w: v.w, h: v.h, encoded: buf, mime: m.encode }, [buf]);
      }
      const u8 = E.toU8(v);
      reply({ type: 'pixels', id: m.id, ok: true, w: v.w, h: v.h, data: u8.buffer }, [u8.buffer]);
    } catch (err) { reply({ type: 'pixels', id: m.id, ok: false, message: String(err && err.message || err) }); }
  }

  async function pump() {
    if (running) return;
    running = true;
    try {
      for (;;) {
        // yield to the message queue first: requests that arrived during the last render land in the queue now,
        // and a newer request for the same slot replaces an older one (otherwise every frame of a drag renders)
        await new Promise(r => setTimeout(r, 0));
        const m = queue.live.shift() || queue.bg.shift();
        if (!m) break;
        if (m.type === 'render') await render(m);
        else if (m.type === 'pixels') await pixels(m);
      }
    } finally { running = false; }
  }

  self.onmessage = e => {
    const m = e.data || {};
    if (m.type === 'init') { E.base = m.base || ''; if (m.maxSide) E.MAX_SIDE = m.maxSide; return reply({ type: 'inited', id: m.id }); }
    if (m.type === 'compile') return compile(m);
    if (m.type === 'wasm') {   // a direct call into one of the crates (LightCraft's meta, presets, settings)
      return E.wasmCall(m.module, m.op, m.args || {}, new Uint8Array(0))
        .then(r => reply({ type: 'wasm', id: m.id, ok: true, msg: r.msg }))
        .catch(err => reply({ type: 'wasm', id: m.id, ok: false, message: String(err && err.message || err) }));
    }
    if (m.type === 'auto') {   // LightCraft's Auto tone and white balance, measured on the source a graph output reads
      return (async () => {
        try {
          const X = E.ctx({ controls: controlsOf(m.values), time: 0, sheet: {}, target: 'wasm', bind: null });
          const img = await X.img(await X.eval(names[m.out] || m.out));
          const r = await E.wasmCall('ck_light', 'auto', { w: img.w, h: img.h, settings: m.settings || {} }, img.d);
          reply({ type: 'auto', id: m.id, ok: true, msg: r.msg });
        } catch (err) { reply({ type: 'auto', id: m.id, ok: false, message: String(err && err.message || err) }); }
      })();
    }
    if (m.type === 'asset') { E.userAssets.set(m.name, m.blob); E.assetVersion++; return reply({ type: 'asset-ok', id: m.id }); }
    if (m.type === 'cancel') {   // drop queued work for a tag (a cancelled batch)
      for (const lane of ['live', 'bg']) queue[lane] = queue[lane].filter(x => { if (x.tag && x.tag === m.tag) { reply({ type: x.type === 'render' ? 'rendered' : 'pixels', id: x.id, cancelled: true }); return false; } return true; });
      return;
    }
    if (m.type === 'render' || m.type === 'pixels') {
      const lane = m.lane === 'bg' ? 'bg' : 'live';
      // latest wins: a newer live request for the same slot replaces the queued one
      if (m.slot) queue[lane] = queue[lane].filter(x => { if (x.slot === m.slot) { reply({ type: x.type === 'render' ? 'rendered' : 'pixels', id: x.id, superseded: true }); return false; } return true; });
      queue[lane].push(m);
      pump();
    }
  };
  reply({ type: 'ready' });
})();
