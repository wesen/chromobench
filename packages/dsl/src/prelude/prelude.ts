// The prelude: guest code that runs inside QuickJS once per VM. It receives two host functions,
// `host(name, json) → json` (synchronous) and `hostEval(id) → Promise<json>` (deferred), keeps them
// in its closure (they are never globals), installs the globals `cb`, `frame`, `units`, `mem`,
// `console` and a seeded `Math.random`, and returns the private hooks the session calls.
//
// Handle rules follow goja-cv pkg/gojamod/cv/prelude.js 1–14:
// - `then` makes handles awaitable (Value → evaluated numbers, Image → a summary);
// - Symbol.toPrimitive / valueOf throw E_NOT_AWAITED, except the string hint, which gives a label;
// - assignments throw E_IMMUTABLE; a data field on a Value handle throws E_NOT_AWAITED;
// - an unknown member throws E_UNKNOWN_METHOD with a did-you-mean; a handle passed as a literal
//   option is E_ARG_TYPE (checked by the host);
// - generic probes (constructor, inspect, $$typeof, toJSON, Symbol.toStringTag …) pass through.
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

  const T = H('tables');
  const AREAS = new Set(T.areas);

  // ---- handles -------------------------------------------------------------------------------
  const handles = new WeakMap();   // proxy → info
  let cache = new Map();           // id|frame → proxy (hash-consed nodes are === within an eval)
  const looks = new WeakSet();

  function isHandle(x) { return (typeof x === 'object' || typeof x === 'function') && x !== null && handles.has(x); }

  function marshal(v, depth) {
    if (depth > 20) return null;
    if (isHandle(v)) return { __node: handles.get(v).id };
    if (typeof v === 'function') return { __fn: true };
    if (Array.isArray(v)) return v.map((x) => marshal(x, depth + 1));
    if (v !== null && typeof v === 'object') {
      if (looks.has(v)) return { __look: v.look };
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

  function lookOf(info, opts) {
    const o = typeof opts === 'string' ? { label: opts } : (opts || {});
    const r = H('look', { ids: [info.id], frame: info.frame, opts: marshal(o, 0), at: callerLine() });
    const obj = { look: r.look, caption: r.caption, toString: () => '[look ' + r.look + ': ' + r.caption + ']' };
    looks.add(obj);
    return Object.freeze(obj);
  }

  function wrap(info) {
    const key = info.id + '|' + (info.frame || '');
    const hit = cache.get(key);
    if (hit) return hit;
    const nsCache = new Map();
    const isValue = info.kind !== 'Image';
    const prim = function (hint) {
      if (hint === 'string') return info.label;
      return H('notAwaited', { info: info, key: null, at: callerLine() });
    };
    const target = isValue ? {} : {};
    const p = new Proxy(target, {
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
        if (isValue) return H('notAwaited', { info: info, key: k, at: callerLine() });
        if (k === 'id') return info.id;
        if (k === 'domain') return info.domain;
        if (k === 'kind') return info.kind;
        if (k === 'width') return info.width;
        if (k === 'height') return info.height;
        if (k === 'look') return (opts) => lookOf(info, opts);
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
      apply(t, self, argv) {
        return wrap(H('macro', { name: area, recv: info, opts: marshal(argv[0] === undefined ? {} : argv[0], 0), at: callerLine() }));
      },
      set(t, k, v) { return H('immutable', { info: info, key: area + '.' + String(k), value: marshal(v, 0) }); },
    });
  }

  // ---- read-only recipe views ----------------------------------------------------------------
  function frozenView(obj, path, frameId) {
    if (obj === null || typeof obj !== 'object') return obj;
    return new Proxy(obj, {
      get(t, k) {
        if (typeof k === 'symbol') return t[k];
        const v = t[k];
        if (v !== null && typeof v === 'object') return frozenView(v, path ? path + '.' + k : k, frameId);
        return v;
      },
      set(t, k, v) { return H('immutableRecipe', { frame: frameId, path: path ? path + '.' + String(k) : String(k), value: marshal(v, 0) }); },
      deleteProperty(t, k) { return H('immutableRecipe', { frame: frameId, path: path ? path + '.' + String(k) : String(k) }); },
      defineProperty(t, k) { return H('immutableRecipe', { frame: frameId, path: path ? path + '.' + String(k) : String(k) }); },
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

  // ---- frames --------------------------------------------------------------------------------
  let BOUND = null;
  let frameCache = new Map();
  function frameObj(id) {
    const hit = frameCache.get(id);
    if (hit) return hit;
    const f = H('frame', { id: id });
    const vocab = (name, opts) => wrap(H('vocab', { name: name, frame: id, opts: marshal(opts === undefined ? {} : opts, 0), at: callerLine() }));
    const editFn = function (changes, opts) { return receipt(H('edit', { frame: id, kind: 'set', changes: marshal(changes, 0), why: opts && opts.why, at: callerLine() })); };
    editFn.exposure = guarded('frame.edit.exposure', {
      add: (e, opts) => receipt(H('edit', { frame: id, kind: 'exposure.add', exposure: marshal(e, 0), why: opts && opts.why, at: callerLine() })),
      remove: (eid, opts) => receipt(H('edit', { frame: id, kind: 'exposure.remove', id: eid, why: opts && opts.why, at: callerLine() })),
    });
    editFn.mask = guarded('frame.edit.mask', {
      set: (mid, mask, opts) => receipt(H('edit', { frame: id, kind: 'mask.set', id: mid, mask: marshal(mask, 0), why: opts && opts.why, at: callerLine() })),
    });
    const obj = guarded('frame', {
      id: f.id, name: f.name, kind: f.kind,
      recipe: frozenView(f.recipe, '', id),
      source: () => vocab('source'),
      scan: () => vocab('scan'),
      negative: () => vocab('negative'),
      print: (opts) => vocab('print', opts),
      display: () => vocab('display'),
      edit: editFn,
      why: (path) => H('why', { frame: id, path: path }),
      pending: () => H('pending', { frame: id }),
      toString: () => '[frame ' + f.id + ']',
    });
    frameCache.set(id, obj);
    return obj;
  }
  function receipt(r) {
    return Object.freeze({ id: r.id, status: r.status, mutations: r.mutations, preview: wrap(r.preview), note: r.note });
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
  const cbObj = {
    version: T.version,
    frames: () => H('frames'),
    frame: (id) => frameObj(H('frameId', { id: id })),
    help: (name) => H('help', { name: name === undefined ? null : (isHandle(name) ? handles.get(name).op : String(name)) }),
    docs: docs,
    explain: (h) => isHandle(h) ? H('explain', { id: handles.get(h).id }) : H('unknown', { where: 'cb.explain', key: 'argument', valid: ['a handle'] }),
    compare: (pair, label) => {
      if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(isHandle)) return H('argType', { what: 'cb.compare', expect: 'two image handles: cb.compare([a, b], label)' });
      const r = H('look', { ids: pair.map((h) => handles.get(h).id), frame: handles.get(pair[0]).frame, opts: { label: label === undefined ? 'compare' : String(label) }, at: callerLine() });
      const obj = { look: r.look, caption: r.caption, toString: () => '[look ' + r.look + ': ' + r.caption + ']' };
      looks.add(obj);
      return Object.freeze(obj);
    },
    testStrip: (f, opts) => wrap(H('vocab', { name: 'testStrip', frame: frameIdOf(f), opts: marshal(opts === undefined ? {} : opts, 0), at: callerLine() })),
    ringAround: (f, opts) => wrap(H('vocab', { name: 'ringAround', frame: frameIdOf(f), opts: marshal(opts === undefined ? {} : opts, 0), at: callerLine() })),
  };
  Object.defineProperty(cbObj, 'mode', { get: () => H('mode', { frame: BOUND }), enumerable: true });
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
    if (typeof v === 'function') return { __fn: describeFn(v.name || 'function', v) };
    if (looks.has(v)) return { __look: v.look, caption: v.caption };
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
        else if (Array.isArray(v)) out.push({ key: k, kind: 'array', n: v.length });
        else if (v === null) out.push({ key: k, kind: 'null' });
        else out.push({ key: k, kind: typeof v });
      }
      return JS(out);
    },
    probe: async function () { await null; return 'ok'; },
  };
})`;
