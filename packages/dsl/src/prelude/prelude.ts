// The prelude: guest code that runs inside QuickJS once per VM. It receives two host functions,
// `host(name, json) → json` (synchronous) and `hostEval(id) → Promise<json>` (deferred), keeps them
// in its closure (they are never globals), installs the globals — `cb`, `frame`, `units`, `mem`, `console`, the
// builders `layer`, `group`, `mask`, `coll` and the changes `set`, `insert`, `remove`, `move` — and a seeded
// `Math.random`, and returns the private hooks the session calls.
//
// Handle rules follow goja-cv pkg/gojamod/cv/prelude.js 1–14:
// - `then` makes handles awaitable (Value → evaluated numbers, Image → a summary);
// - Symbol.toPrimitive / valueOf throw E_NOT_AWAITED, except the string hint, which gives a label;
// - assignments throw E_IMMUTABLE; a data field on a Value handle throws E_NOT_AWAITED;
// - an unknown member throws E_UNKNOWN_METHOD with a did-you-mean; a handle passed as a literal
//   option is E_ARG_TYPE (checked by the host);
// - generic probes (constructor, inspect, $$typeof, toJSON, Symbol.toStringTag …) pass through.
//
// Builder values (contract 1.0, design §30–§31) are data with chain methods: `layer('burn', { stops: 0.5 })` holds the
// layer's data, and `.amount(0.5)` asks the host for new data (the contract's modifier). Nothing in them is a
// function the host keeps, so they cross into documents as data and survive between evals on mem. Frames and
// what-ifs are views: `frame.with(change)` is the document with a change; its cuts are handles.
//
// Written as a plain string so it loads unchanged in Node and in the browser. It must not use
// backticks or "${" (it lives inside a template literal).
export const PRELUDE = String.raw`(function (host, hostEval) {
  'use strict';
  const JP = JSON.parse, JS = JSON.stringify;
  const PROBES = new Set(['constructor', 'inspect', '$$typeof', 'nodeType', 'asymmetricMatch', '@@__IMMUTABLE_ITERABLE__@@', 'prototype', 'length', 'name', 'call', 'apply', 'bind', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', '__proto__']);

  function mkErr(d) {
    const e = new Error(d.message);
    e.name = d.code;
    e.code = d.code;
    if (d.hint !== undefined) e.hint = d.hint;
    if (d.fix !== undefined) e.fix = d.fix;
    if (d.valid !== undefined) e.valid = d.valid;
    if (d.path !== undefined) e.path = d.path;
    return e;
  }
  function callerLine() {
    const s = String(new Error().stack || '');
    const m = /eval-(\d+)\.js:(\d+)/.exec(s);
    return m ? { eval: +m[1], line: +m[2] - 1 } : null;
  }
  function H(name, arg) {
    const r = JP(host(name, JS(arg === undefined ? null : arg)));
    if (r.err) throw mkErr(r.err);
    return r.ok;
  }
  function deepFreeze(v) {
    if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
      Object.freeze(v);
      for (const k of Object.keys(v)) deepFreeze(v[k]);
    }
    return v;
  }

  const T = H('tables');
  const AREAS = new Set(T.areas);

  // ---- handles -------------------------------------------------------------------------------
  const handles = new WeakMap();   // proxy → info
  let cache = new Map();           // id|frame → proxy (hash-consed nodes are === within an eval)
  const shows = new WeakSet();
  const values = new WeakMap();    // value proxy → { kind, data, trail }
  const viewKeys = new WeakMap();  // frame or what-if object → view key

  function isHandle(x) { return (typeof x === 'object' || typeof x === 'function') && x !== null && handles.has(x); }
  function isValue(x) { return (typeof x === 'object' || typeof x === 'function') && x !== null && values.has(x); }

  function marshal(v, depth) {
    if (depth > 30) return null;
    if (isHandle(v)) return { __node: handles.get(v).id };
    if (isValue(v)) return { __value: values.get(v).kind, data: values.get(v).data };
    if (typeof v === 'function') return { __fn: true };
    if (Array.isArray(v)) return v.map((x) => marshal(x, depth + 1));
    if (v !== null && typeof v === 'object') {
      if (shows.has(v)) return { __show: v.show };
      if (viewKeys.has(v)) return { __frame: viewKeys.get(v) };
      const o = {};
      for (const k of Object.keys(v)) { const x = v[k]; if (x !== undefined) o[k] = marshal(x, depth + 1); }
      return o;
    }
    if (typeof v === 'number' && !isFinite(v)) return { __num: String(v) };
    return v;
  }

  function evaluate(info) {
    return hostEval(info.id).then((j) => { const r = JP(j); if (r.err) throw mkErr(r.err); return r.ok; });
  }

  function showRef(r) {
    const obj = { show: r.show, caption: r.caption, toString: () => '[image ' + r.show + ': ' + r.caption + ']' };
    shows.add(obj);
    return Object.freeze(obj);
  }
  function showOf(info, opts) {
    const o = typeof opts === 'string' ? { label: opts } : (opts || {});
    return showRef(H('show', { ids: [info.id], frame: info.frame, opts: marshal(o, 0), at: callerLine() }));
  }

  function wrap(info) {
    const key = info.id + '|' + (info.frame || '');
    const hit = cache.get(key);
    if (hit) return hit;
    const nsCache = new Map();
    const isValueNode = info.kind !== 'Image';
    const prim = function (hint) {
      if (hint === 'string') return info.label;
      return H('notAwaited', { info: info, key: null, at: callerLine() });
    };
    const p = new Proxy({}, {
      get(t, k) {
        if (typeof k === 'symbol') {
          if (k === Symbol.toPrimitive) return prim;
          if (k === Symbol.toStringTag) return 'Handle';
          return undefined;
        }
        if (k === 'then') return (res, rej) => evaluate(info).then(res, rej);
        if (k === 'toString' || k === 'toJSON') return () => info.label;
        if (k === 'valueOf') return () => prim('number');
        if (PROBES.has(k)) return undefined;
        if (isValueNode) return H('notAwaited', { info: info, key: k, at: callerLine() });
        if (k === 'id') return info.id;
        if (k === 'domain') return info.domain;
        if (k === 'kind') return info.kind;
        if (k === 'width') return info.width;
        if (k === 'height') return info.height;
        if (k === 'show') return (opts) => showOf(info, opts);
        if (k === 'explain') return () => H('explain', { id: info.id });
        if (AREAS.has(k)) {
          let ns = nsCache.get(k);
          if (!ns) { ns = namespace(info, k); nsCache.set(k, ns); }
          return ns;
        }
        return H('unknown', { where: 'handle', info: info, key: k });
      },
      set(t, k, v) { return H('immutable', { info: info, key: String(k), value: marshal(v, 0) }); },
      defineProperty(t, k) { return H('immutable', { info: info, key: String(k) }); },
      deleteProperty(t, k) { return H('immutable', { info: info, key: String(k) }); },
      has(t, k) { return k === 'then'; },
      ownKeys() { return []; },
    });
    handles.set(p, info);
    cache.set(key, p);
    return p;
  }

  function namespace(info, area) {
    const fn = function () {};
    return new Proxy(fn, {
      get(t, k) {
        if (typeof k === 'symbol') {
          if (k === Symbol.toPrimitive) return () => info.label + '.' + area;
          return undefined;
        }
        if (k === 'then' || PROBES.has(k)) return undefined;
        if (k === 'toString' || k === 'toJSON') return () => info.label + '.' + area;
        const op = area + '.' + k;
        if (T.ops[op]) return (args) => wrap(H('call', { op: op, recv: info, args: marshal(args === undefined ? {} : args, 0), at: callerLine() }));
        return H('unknown', { where: 'namespace', info: info, area: area, key: k });
      },
      apply() { return H('macro', { name: area, recv: info, at: callerLine() }); },
      set(t, k, v) { return H('immutable', { info: info, key: area + '.' + String(k), value: marshal(v, 0) }); },
    });
  }

  // ---- guarded plain objects (did-you-mean on unknown members) --------------------------------
  function guarded(name, obj) {
    return new Proxy(obj, {
      get(t, k) {
        if (typeof k === 'symbol' || k in t || k === 'then' || PROBES.has(k) || k === 'toJSON') return t[k];
        return H('unknown', { where: name, key: k, valid: Object.keys(t) });
      },
      set(t, k, v) { return H('immutable', { info: null, key: name + '.' + String(k), value: marshal(v, 0) }); },
    });
  }

  // ---- builder values: layer, group, mask, change ---------------------------------------------
  const METHODS = {
    layer: ['amount', 'mask', 'blend', 'name', 'enabled', 'params'],
    group: ['amount', 'mask', 'blend', 'name', 'enabled'],
    mask: ['add', 'feather', 'invert', 'reads', 'name'],
    change: [],
  };
  function label(kind, data) {
    if (kind === 'layer') return '[layer ' + data.op + ']';
    if (kind === 'group') return '[group ' + JS(data.name) + ']';
    if (kind === 'mask') return '[mask ' + JS(data.name) + ']';
    const m = data.mutations[0];
    return '[' + m.op + ' ' + (m.op === 'set' ? m.path : m.id) + ']';
  }
  function mkValue(kind, data, trail) {
    deepFreeze(data);
    const rec = { kind: kind, data: data, trail: trail };
    const p = new Proxy({}, {
      get(t, k) {
        if (typeof k === 'symbol') {
          if (k === Symbol.toPrimitive) return () => label(kind, data);
          return undefined;
        }
        if (k === 'kind') return kind;
        if (k === 'data') return data;
        if (k === 'toJSON') return () => data;
        if (k === 'toString') return () => label(kind, data);
        if (k === 'explain') return () => ({ kind: kind, built: trail, data: data });
        if (k === 'then') return undefined;
        if (METHODS[kind].indexOf(k) >= 0) return function () {
          const at = callerLine();
          const args = Array.prototype.slice.call(arguments);
          const step = (at ? 'line ' + at.line + ': ' : '') + k + '(' + args.map((a) => { try { return JS(marshal(a, 0)); } catch (e) { return '?'; } }).join(', ') + ')';
          return mkValue(kind, H('value', { kind: kind, data: data, method: k, args: marshal(args, 0), at: at }), trail.concat([step]));
        };
        if (PROBES.has(k)) return undefined;
        return H('unknown', { where: label(kind, data), key: k, valid: METHODS[kind].concat(['data', 'kind', 'explain']) });
      },
      set(t, k, v) { return H('immutable', { info: null, key: label(kind, data) + '.' + String(k), value: marshal(v, 0) }); },
      deleteProperty(t, k) { return H('immutable', { info: null, key: label(kind, data) + '.' + String(k) }); },
      defineProperty(t, k) { return H('immutable', { info: null, key: label(kind, data) + '.' + String(k) }); },
      ownKeys() { return []; },
    });
    values.set(p, rec);
    return p;
  }
  function built(what, arg) {
    const at = callerLine();
    arg.what = what;
    arg.at = at;
    const step = (at ? 'line ' + at.line + ': ' : '') + what;
    return { data: H('build', arg), trail: [step] };
  }
  function builder(kind, what, mk) {
    return function () {
      const b = built(what, mk.apply(null, arguments));
      return mkValue(kind, b.data, b.trail);
    };
  }
  const layer = builder('layer', 'layer', (op, params) => ({ op: op, params: marshal(params, 0) }));
  const group = builder('group', 'group', (name, entries) => ({ name: name, entries: marshal(entries, 0) }));
  const mask = builder('mask', 'mask', (name) => ({ name: name }));
  const set = builder('change', 'set', (path, value) => ({ path: path, value: marshal(value, 0) }));
  const insert = builder('change', 'insert', (c, id, item, pos) => ({ coll: c, id: id, item: marshal(item, 0), pos: pos }));
  const remove = builder('change', 'remove', (id) => ({ id: id }));
  const move = builder('change', 'move', (id, to) => ({ id: id, to: marshal(to, 0) }));
  const coll = function (items) { return deepFreeze(built('coll', { items: marshal(items, 0) }).data); };

  // ---- read-only document views --------------------------------------------------------------
  function frozenView(obj, path, frameId) {
    if (obj === null || typeof obj !== 'object') return obj;
    return new Proxy(obj, {
      get(t, k) {
        if (typeof k === 'symbol') return t[k];
        const v = t[k];
        if (v !== null && typeof v === 'object') return frozenView(v, path ? path + '.' + k : k, frameId);
        return v;
      },
      set(t, k, v) { return H('immutableDoc', { frame: frameId, path: path ? path + '.' + String(k) : String(k), value: marshal(v, 0) }); },
      deleteProperty(t, k) { return H('immutableDoc', { frame: frameId, path: path ? path + '.' + String(k) : String(k) }); },
      defineProperty(t, k) { return H('immutableDoc', { frame: frameId, path: path ? path + '.' + String(k) : String(k) }); },
    });
  }

  // ---- frames and what-ifs -------------------------------------------------------------------
  let BOUND = null;
  let frameCache = new Map();
  function changeArg(c) { return marshal(c, 0); }
  function viewObj(v, frame, extra) {
    const key = v.key;
    let docCache;
    const o = {
      id: v.frame, kind: v.kind,
      get: (path) => H('get', { view: key, path: path }),
      cut: (name, opts) => wrap(H('cut', { view: key, name: String(name), opts: marshal(opts === undefined ? {} : opts, 0), at: callerLine() })),
      with: (c) => viewObj(H('with', { view: key, change: changeArg(c), at: callerLine() }), null, null),
      explain: () => H('explainView', { view: key, at: callerLine() }),
      toString: () => frame ? '[frame ' + v.frame + ']' : '[what-if of ' + v.frame + ']',
    };
    Object.defineProperty(o, 'doc', { enumerable: true, get() { if (docCache === undefined) docCache = frozenView(H('doc', { view: key }), '', v.frame); return docCache; } });
    for (const c of T.cuts) o[c] = (opts) => wrap(H('cut', { view: key, name: c, opts: marshal(opts === undefined ? {} : opts, 0), at: callerLine() }));
    if (frame) {
      o.name = frame.name;
      o.propose = (c, opts) => receipt(H('propose', { frame: v.frame, change: changeArg(c), why: opts && opts.why, label: opts && opts.label, at: callerLine() }));
      o.why = (path) => H('why', { frame: v.frame, path: path });
      o.pending = () => H('pending', { frame: v.frame });
    }
    if (extra) for (const k of Object.keys(extra)) o[k] = extra[k];
    const g = guarded(frame ? 'frame' : 'what-if', o);
    viewKeys.set(g, key);
    return g;
  }
  function frameObj(id) {
    const hit = frameCache.get(id);
    if (hit) return hit;
    const f = H('frame', { id: id });
    const obj = viewObj({ key: f.view, frame: f.id, kind: f.kind }, f, null);
    frameCache.set(id, obj);
    return obj;
  }
  function receipt(r) {
    return Object.freeze({ id: r.id, status: r.status, changes: r.changes, preview: viewObj(r.preview, null, null), note: r.note });
  }

  // ---- globals -------------------------------------------------------------------------------
  const U = T.units;
  const each = (f) => (x) => Array.isArray(x) ? x.map((v) => f(v)) : f(x);
  const units = guarded('units', Object.freeze({
    pt: each((x) => x * U.logHPerPoint),
    toPt: each((x) => x / U.logHPerPoint),
    stops: each((x) => x * U.log10_2),
    toStops: each((x) => x / U.log10_2),
    stopsFromTime: (t1, t2) => Math.log2(t2 / t1),
    stopsFromFstop: (n1, n2) => 2 * Math.log2(n1 / n2),
  }));

  const docs = guarded('cb.docs', Object.freeze({
    list: () => H('docs', { op: 'list' }),
    search: (text) => H('docs', { op: 'search', text: String(text) }),
    read: (id, opts) => H('docs', { op: 'read', id: String(id), section: opts && opts.section }),
  }));
  // ---- cb.looks (CHB-021; CHB-037 P7): registered looks and presets as links on the frames (one batch, one card) ----
  function toIds(to) {
    if (Array.isArray(to)) return to.map((x) => (x && typeof x === 'object' && typeof x.id === 'string' ? x.id : x));
    if (to && typeof to === 'object' && typeof to.id === 'string') return to.id;
    return to;
  }
  function viewRef(x) {
    if (x && typeof x === 'object' && viewKeys.has(x)) return { __frame: viewKeys.get(x) };
    if (typeof x === 'string') return { __frame: '@' + x };
    return H('argType', { what: 'cb.looks.diff', expect: 'two frames or what-ifs: cb.looks.diff(frame, cb.looks.whatIf(frame, name))' });
  }
  const looksObj = guarded('cb.looks', Object.freeze({
    list: () => H('looks.list'),
    apply: (name, params, opts) => {
      const o = Object.assign({}, opts || {});
      if (typeof o.where === 'function') {
        const pred = o.where;
        const cands = H('looks.targets', { to: marshal(o.to === undefined ? 'all' : toIds(o.to), 0) });
        o.to = cands.filter((x) => pred(Object.freeze(x))).map((x) => x.id);
        delete o.where;
      } else if (o.to !== undefined) o.to = toIds(o.to);
      return Object.freeze(H('looks.apply', { name: String(name), params: marshal(params === undefined ? {} : params, 0), opts: marshal(o, 0), at: callerLine() }));
    },
    whatIf: (f, name, params, opts) => {
      const r = H('looks.whatIf', { frame: frameIdOf(f), name: String(name), params: marshal(params === undefined ? {} : params, 0), opts: marshal(opts === undefined ? {} : opts, 0), at: callerLine() });
      return viewObj(r, null, { look: r.look, label: r.label, diff: r.diff, changes: r.changes, skipped: r.skipped });
    },
    diff: (a, b) => H('looks.diff', { a: viewRef(a), b: viewRef(b) }),
    bake: (key, opts) => Object.freeze(H('looks.bake', { key: String(key), frame: opts && opts.frame !== undefined ? frameIdOf(opts.frame) : null, at: callerLine() })),
  }));
  function compare(pair, lbl) {
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(isHandle)) return H('argType', { what: 'cb.compare', expect: 'two image handles: cb.compare([a, b], label)' });
    return showRef(H('show', { ids: pair.map((h) => handles.get(h).id), frame: handles.get(pair[0]).frame, opts: { label: lbl === undefined ? 'compare' : String(lbl) }, at: callerLine() }));
  }
  const cbObj = {
    version: T.version,
    looks: looksObj,
    frames: () => H('frames'),
    frame: (id) => frameObj(H('frameId', { id: id })),
    help: (name) => H('help', { name: name === undefined ? null : (isHandle(name) ? handles.get(name).op : String(name)) }),
    docs: docs,
    explain: (x) => {
      if (isHandle(x)) return H('explain', { id: handles.get(x).id });
      if (isValue(x) || (x && typeof x === 'object' && viewKeys.has(x))) return x.explain();
      return H('unknown', { where: 'cb.explain', key: 'argument', valid: ['a handle', 'a frame or what-if', 'a layer, group, mask or change'] });
    },
    compare: compare,
    testStrip: (f, opts) => wrap(H('strip', { name: 'testStrip', frame: frameIdOf(f), opts: marshal(opts === undefined ? {} : opts, 0), at: callerLine() })),
    ringAround: (f, opts) => wrap(H('strip', { name: 'ringAround', frame: frameIdOf(f), opts: marshal(opts === undefined ? {} : opts, 0), at: callerLine() })),
  };
  Object.defineProperty(cbObj, 'mode', { get: () => H('mode', {}), enumerable: true });
  function frameIdOf(f) {
    if (f && typeof f === 'object' && typeof f.id === 'string' && !isHandle(f)) return f.id;
    if (typeof f === 'string') return f;
    return H('argType', { what: 'the first argument', expect: 'a frame: cb.testStrip(frame, {…})' });
  }
  const cb = guarded('cb', cbObj);

  const consoleObj = {};
  for (const lvl of ['log', 'info', 'warn', 'error', 'debug']) {
    consoleObj[lvl] = function () {
      const parts = [];
      for (let i = 0; i < arguments.length; i++) {
        const a = arguments[i];
        if (typeof a === 'string') parts.push(a);
        else if (isHandle(a)) parts.push(handles.get(a).label);
        else if (isValue(a)) parts.push(label(values.get(a).kind, values.get(a).data));
        else { try { parts.push(JS(marshal(a, 0))); } catch (e) { parts.push(String(a)); } }
      }
      host('log', JS({ level: lvl, text: parts.join(' '), at: callerLine() }));
    };
  }

  // seeded, frozen Math.random (reseeded by the host before every eval)
  let seedState = 0;
  const rnd = function random() {
    seedState |= 0; seedState = (seedState + 0x6D2B79F5) | 0;
    let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Object.defineProperty(Math, 'random', { value: rnd, writable: false, configurable: false, enumerable: false });

  const mem = {};
  const G = globalThis;
  const def = (k, v) => Object.defineProperty(G, k, { value: v, writable: false, configurable: false, enumerable: false });
  def('cb', cb);
  def('units', units);
  def('mem', mem);
  def('console', Object.freeze(consoleObj));
  def('layer', layer);
  def('group', group);
  def('mask', mask);
  def('coll', coll);
  def('set', set);
  def('insert', insert);
  def('remove', remove);
  def('move', move);
  Object.defineProperty(G, 'frame', {
    get() { if (BOUND === null) return H('noFrame', {}); return frameObj(BOUND); },
    set(v) { H('immutable', { info: null, key: 'frame', value: null }); },
    configurable: false, enumerable: false,
  });

  // ---- shaping results for the host ------------------------------------------------------------
  function shape(v, depth, seen) {
    if (v === undefined) return { __undef: 1 };
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'number') return isFinite(v) ? v : { __num: String(v) };
    if (typeof v === 'bigint') return String(v);
    if (typeof v === 'symbol') return String(v);
    if (isHandle(v)) return { __h: handles.get(v).label };
    if (isValue(v)) return shape(values.get(v).data, depth, seen);
    if (typeof v === 'function') return { __fn: describeFn(v.name || 'function', v) };
    if (shows.has(v)) return { __show: v.show, caption: v.caption };
    if (viewKeys.has(v)) return { __h: String(v) };
    if (depth > 12) return '[too deep]';
    if (seen.indexOf(v) >= 0) return '[circular]';
    seen.push(v);
    let out;
    if (v instanceof Error) out = { __err: (v.name || 'Error') + ': ' + v.message };
    else if (Array.isArray(v)) out = v.map((x) => shape(x, depth + 1, seen));
    else {
      out = {};
      for (const k of Object.keys(v)) { if (v[k] !== undefined) out[k] = shape(v[k], depth + 1, seen); }
    }
    seen.pop();
    return out;
  }
  function describeFn(name, f) {
    let src = '';
    try { src = Function.prototype.toString.call(f); } catch (e) { src = ''; }
    return { name: name, src: src };
  }
  function errInfo(e) {
    if (e instanceof Error || (e && typeof e === 'object' && 'message' in e)) {
      return { name: String(e.name || 'Error'), message: String(e.message), stack: String(e.stack || ''), code: e.code, hint: e.hint, fix: e.fix, valid: e.valid, path: e.path };
    }
    let s; try { s = String(e); } catch (x) { s = '[unprintable]'; }
    return { name: 'Throw', message: 'the code threw a non-Error value: ' + s, stack: '' };
  }

  return {
    begin(frameId, seed) { BOUND = frameId; frameCache = new Map(); cache = new Map(); seedState = seed | 0; },
    run: async function (fn) {
      try { const v = await fn(); return JS({ ok: true, value: shape(v, 0, []) }); }
      catch (e) { return JS({ ok: false, error: errInfo(e) }); }
    },
    memInfo() {
      const out = [];
      for (const k of Object.keys(mem)) {
        const d = Object.getOwnPropertyDescriptor(mem, k);
        if (!d) continue;
        if (d.get || d.set) { out.push({ key: k, kind: 'accessor' }); continue; }
        const v = d.value;
        if (typeof v === 'function') out.push({ key: k, kind: 'function', src: describeFn(k, v).src });
        else if (isHandle(v)) out.push({ key: k, kind: 'handle', label: handles.get(v).label });
        else if (isValue(v)) out.push({ key: k, kind: 'handle', label: label(values.get(v).kind, values.get(v).data) });
        else if (Array.isArray(v)) out.push({ key: k, kind: 'array', n: v.length });
        else if (v === null) out.push({ key: k, kind: 'null' });
        else out.push({ key: k, kind: typeof v });
      }
      return JS(out);
    },
    probe: async function () { await null; return 'ok'; },
  };
})`;
