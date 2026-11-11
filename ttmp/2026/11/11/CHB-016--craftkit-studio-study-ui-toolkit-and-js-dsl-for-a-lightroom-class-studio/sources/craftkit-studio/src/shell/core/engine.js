// The engine bridge. The shell records engine graphs at build time — ck.image(s => s.photo.src).develop(s => …) —
// as a chain of calls (structure, the deep embedding) whose holes are lambdas (behaviour, the shallow embedding).
// At build, every chain becomes one CraftKit program compiled once in the worker; each hole becomes an engine input.
// At runtime a render request carries only the holes' current values, computed by cells, so a slider drag sends
// one number and the engine re-runs only the nodes that read it (its own signature cache does the rest).
//
// Requests are tagged with a slot and an epoch: the worker drops a queued request when a newer one for the same
// slot arrives, and the page drops an answer older than what it has already painted.

import { isObj, stable, hash } from './util.js';
import { site } from './diag.js';
import { strip } from './store.js';

const EXPR = Symbol('ck.expr');
export const isExpr = v => !!(v && v[EXPR]);
export const exprNode = v => v && v[EXPR];

let nodeSeq = 0;
export const ALL = new Set();   // every expression recorded: the build compiles them all into one program
function mkExpr(node) {
  node.id = node.id || 'e' + (++nodeSeq);
  const p = new Proxy(function () {}, {
    get(t, k) {
      if (k === EXPR) return node;
      if (k === 'then' || typeof k === 'symbol') return undefined;
      if (k === 'toString') return () => `«engine ${node.op}»`;
      // chain any op: .develop(…), .softProof(…), .threshold(…) — the catalog checks the name at compile
      return (...args) => mkExpr({ kind: 'call', op: k, args, parent: node, at: site() });
    },
  });
  ALL.add(p);
  return p;
}
export function engineSource(op, args) { return mkExpr({ kind: 'source', op, args, at: site() }); }

// ── compile: chains → one CraftKit program ───────────────────────────────
export function compileGraph(exprs) {
  const nodes = new Map();          // id → node
  const inputs = new Map();         // input name → { fn, at, node }
  const order = [];
  const visit = node => {
    if (nodes.has(node.id)) return;
    if (node.parent) visit(node.parent);
    for (const a of node.args || []) walkArgs(a, x => { if (isExpr(x)) visit(exprNode(x)); });
    nodes.set(node.id, node); order.push(node);
  };
  for (const e of exprs) visit(exprNode(e));
  let inSeq = 0;
  const lit = (v, node) => {
    if (isExpr(v)) return exprNode(v).id;
    if (typeof v === 'function') { const name = 'i' + (++inSeq); inputs.set(name, { fn: v, node }); node.inputs = (node.inputs || []).concat([name]); return `ck.ui.input(${JSON.stringify(name)}, null)`; }
    if (isExpr(v)) return exprNode(v).id;
    if (Array.isArray(v)) return '[' + v.map(x => lit(x, node)).join(', ') + ']';
    if (isObj(v)) return '{ ' + Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${lit(x, node)}`).join(', ') + ' }';
    return JSON.stringify(v === undefined ? null : v);
  };
  const lines = ["const __max = ck.ui.input('max', 1024)"];
  const literals = [];
  for (const n of order) {
    if (n.kind === 'source') {
      if (typeof n.args[0] === 'string') literals.push(n.args[0]);
      const args = (n.args || []).map(a => lit(a, n));
      if (n.op === 'image') { while (args.length < 2) args.push('{}'); args[1] = `Object.assign(${args[1]}, { max: __max })`; }
      lines.push(`const ${n.id} = ck.${n.op}(${args.join(', ')}); ${n.id}.as(${JSON.stringify(n.id)})`);
    } else if (n.op === 'at') {
      // a list's item: separate(…).at(0)
      lines.push(`const ${n.id} = ${n.parent.id}[${lit(n.args[0], n)}]; ${n.id}.as(${JSON.stringify(n.id)})`);
    } else {
      lines.push(`const ${n.id} = ${n.parent.id}.${n.op}(${(n.args || []).map(a => lit(a, n)).join(', ')}); ${n.id}.as(${JSON.stringify(n.id)})`);
    }
  }
  // which inputs each node depends on (its own and its ancestors')
  const deps = new Map();
  const depsOf = n => {
    if (deps.has(n.id)) return deps.get(n.id);
    const s = new Set(n.inputs || []);
    if (n.parent) for (const x of depsOf(n.parent)) s.add(x);
    for (const a of n.args || []) walkArgs(a, x => { if (isExpr(x)) for (const y of depsOf(exprNode(x))) s.add(y); });
    deps.set(n.id, s);
    return s;
  };
  for (const n of order) depsOf(n);
  return { code: lines.join('\n'), inputs, deps, nodes, literals };
}
function walkArgs(v, f, depth = 0) {
  if (depth > 6) return;
  f(v);
  if (isExpr(v) || typeof v === 'function') return;
  if (Array.isArray(v)) v.forEach(x => walkArgs(x, f, depth + 1));
  else if (isObj(v)) Object.values(v).forEach(x => walkArgs(x, f, depth + 1));
}

// ── the bridge ───────────────────────────────────────────────────────────
export class Engine {
  constructor({ base = '', script = 'engine.js', maxSide = 2048, workers = 2 } = {}) {
    Object.assign(this, { base, script, maxSide, nWorkers: workers });
    this.exprs = new Set();
    this.graph = null;
    this.workers = [];
    this.seq = 0; this.wait = new Map();
    this.assets = new Map();
    this.ready = null;
    this.stats = { renders: 0, ms: 0, last: 0, dropped: 0 };
    this.listeners = new Set();
    this.lastPainted = new Map();   // slot → epoch
    this.cache = new Map();         // thumbnails: key → { bmp, w, h, t }
    this.cacheMax = 400;
  }
  use(e) { if (isExpr(e)) this.exprs.add(e); return e; }
  nextEpoch() { this.epochSeq = (this.epochSeq || 0) + 1; return this.epochSeq; }
  on(f) { this.listeners.add(f); return () => this.listeners.delete(f); }
  emit(k, d) { for (const f of this.listeners) f(k, d); }

  start() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const url = new URL(this.script, new URL(this.base || '.', location.href)).href;
      for (let i = 0; i < this.nWorkers; i++) {
        const w = new Worker(url);
        await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('the engine did not answer')), 15000); w.onmessage = e => { if (e.data && e.data.type === 'ready') { clearTimeout(t); res(); } }; w.onerror = err => { clearTimeout(t); rej(err); }; });
        w.onmessage = e => this.onMessage(e);
        this.workers.push(w);
      }
      await Promise.all(this.workers.map(w => this.post(w, { type: 'init', base: new URL(this.base || '.', location.href).href, maxSide: this.maxSide })));
      return true;
    })();
    return this.ready;
  }
  onMessage(e) {
    const m = e.data || {};
    const p = this.wait.get(m.id);
    if (p) { this.wait.delete(m.id); p(m); }
  }
  post(w, m, transfer) { const id = ++this.seq; return new Promise(r => { this.wait.set(id, r); w.postMessage(Object.assign({ id }, m), transfer || []); }); }
  worker(lane) { return this.workers[lane === 'bg' && this.workers.length > 1 ? 1 : 0]; }

  compile() {
    const g = this.buildGraph(); this.sentN = g.n;
    this.compiling = (async () => {
      await this.start();
      await this.ensureAssets(g.literals);
      const res = await Promise.all(this.workers.map(w => this.post(w, { type: 'compile', code: g.code })));
      const r = res[0];
      this.compiled = r;
      this.emit('compiled', r);
      return r;
    })();
    return this.compiling;
  }
  // (chains made after the first compile, by a module built later, recompile the program once)
  ensure() { return this.compiling && this.sentN === ALL.size ? this.compiling : this.compile(); }
  // the graph is plain code built from the recorded chains, so the main thread has it at once; only the workers wait.
  // (A view mounted before the workers answer still needs its input values, or it renders the engine's sample.)
  buildGraph() { if (!this.graph || this.graph.n !== ALL.size) { this.graph = compileGraph([...ALL]); this.graph.n = ALL.size; } return this.graph; }
  async asset(name, blob) {
    const replacing = this.sent && this.sent.has(name);
    this.assets.set(name, blob);
    await this.start();
    await Promise.all(this.workers.map(w => this.post(w, { type: 'asset', name, blob })));
    (this.sent || (this.sent = new Map())).set(name, Promise.resolve(true));
    if (replacing) this.cache.clear();
  }
  // sources the app knows by name (a URL or a Blob); sent to the workers the first time a render needs them
  declareAsset(name, src) { (this.declared || (this.declared = new Map())).set(name, src); }
  async ensureAssets(values) {
    if (!this.declared || !this.declared.size) return;
    this.sent = this.sent || new Map();
    const names = [];
    const walk = (v, d) => { if (d > 5 || v == null) return; if (typeof v === 'string') { if (this.declared.has(v)) names.push(v); return; } if (typeof v === 'object') for (const x of Object.values(v)) walk(x, d + 1); };
    walk(values, 0);
    await Promise.all(names.map(n => {
      if (!this.sent.has(n)) this.sent.set(n, (async () => { const src = this.declared.get(n); const blob = src instanceof Blob ? src : await (await fetch(src)).blob(); await this.start(); await Promise.all(this.workers.map(w => this.post(w, { type: 'asset', name: n, blob }))); return true; })());
      return this.sent.get(n);
    }));
  }

  // the input values an expression needs, from a state (or an item for per-item renders)
  values(expr, arg) {
    const node = exprNode(expr);
    if (!ALL.size) return {};
    const need = this.buildGraph().deps.get(node.id) || new Set();
    const out = {};
    // values stay as the lambdas returned them: inside a traced cell, an object handed through whole (s.dev[id]) must
    // still look returned to the tracker, or the cell would subscribe only to the fields the lambda happened to read.
    // They are stripped of proxies where they leave for a worker (render, pixels, thumb, auto).
    for (const name of need) { const inp = this.graph.inputs.get(name); try { out[name] = inp.fn(arg); } catch (e) { out[name] = null; } }
    return out;
  }
  key(expr, values, max) { return exprNode(expr).id + '|' + max + '|' + hash(stable(values)); }

  // render one expression; resolves { bmp, w, h, srcW, srcH, ms } or { stale } / { superseded } / { error }
  async render(expr, values, { max = 1024, lane = 'live', slot = null, epoch = 0, tag = null } = {}) {
    values = strip(values);
    await this.ensure();
    await this.ensureAssets(values);
    const node = exprNode(expr);
    const t0 = performance.now();
    const m = await this.post(this.worker(lane), { type: 'render', lane: lane === 'bg' ? 'bg' : 'live', slot, epoch, tag, values: Object.assign({ max }, values), items: [{ key: 'v', out: node.id, max }] });
    if (m.superseded || m.cancelled) { this.stats.dropped++; return { superseded: true }; }
    if (slot) { const last = this.lastPainted.get(slot) || -1; if (epoch < last) { this.stats.dropped++; m.views && m.views.v && m.views.v.bmp && m.views.v.bmp.close && m.views.v.bmp.close(); return { stale: true }; } this.lastPainted.set(slot, epoch); }
    this.stats.renders++; this.stats.last = Math.round(performance.now() - t0); this.stats.ms = m.ms;
    this.emit('rendered', { slot, ms: m.ms, wall: this.stats.last });
    const v = m.views && m.views.v;
    if (!v) { const err = (m.errors && (m.errors.v || m.errors._)) || { message: 'nothing came back' }; return { error: err.message || String(err) }; }
    return { bmp: v.bmp, w: v.w, h: v.h, srcW: v.srcW, srcH: v.srcH, ms: m.ms };
  }

  // cached small renders (thumbnails, filmstrip): one per (expr, values, size)
  async thumb(expr, values, max = 256) {
    values = strip(values);
    const k = this.key(expr, values, max);
    const hit = this.cache.get(k);
    if (hit) { hit.t = performance.now(); return hit; }
    const r = await this.render(expr, values, { max, lane: 'bg' });
    if (r.bmp) {
      this.cache.set(k, Object.assign(r, { t: performance.now() }));
      if (this.cache.size > this.cacheMax) { const old = [...this.cache.entries()].sort((a, b) => a[1].t - b[1].t).slice(0, this.cache.size - this.cacheMax); for (const [kk, v] of old) { this.cache.delete(kk); v.bmp && v.bmp.close && v.bmp.close(); } }
    }
    return r;
  }
  peekThumb(expr, values, max = 256) { return this.cache.get(this.key(expr, strip(values), max)) || null; }

  async pixels(expr, values, { max = 512, lane = 'live', encode = null, quality = 0.92, tag = null } = {}) {
    values = strip(values);
    await this.ensure();
    await this.ensureAssets(values);
    const m = await this.post(this.worker(lane), { type: 'pixels', lane: lane === 'bg' ? 'bg' : 'live', tag, out: exprNode(expr).id, values: Object.assign({ max: Math.max(max, 64) }, values), max, encode, quality });
    if (m.cancelled) return { cancelled: true };
    if (!m.ok) return { error: m.message };
    return m.encoded ? { w: m.w, h: m.h, blob: new Blob([m.encoded], { type: m.mime }) } : { w: m.w, h: m.h, data: new Uint8ClampedArray(m.data) };
  }
  cancel(tag) { for (const w of this.workers) w.postMessage({ type: 'cancel', tag }); }
  async wasm(module, op, args) { await this.start(); const m = await this.post(this.workers[0], { type: 'wasm', module, op, args }); if (!m.ok) throw new Error(m.message); return m.msg; }
  async auto(expr, values, settings) { values = strip(values); settings = strip(settings); await this.ensure(); await this.ensureAssets(values); const m = await this.post(this.workers[0], { type: 'auto', out: exprNode(expr).id, values: Object.assign({ max: 512 }, values), settings }); if (!m.ok) throw new Error(m.message); return m.msg; }
}
