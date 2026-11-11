/* ck-runtime.js · CraftKit's recording runtime.
 * Runs a CraftKit program and records what it builds: a typed DAG of ops (the IR), the controls it exposes and the
 * view tree (the generated UI). It computes no pixels: in the real toolkit each op is a WASM/WebGPU kernel from one
 * of the Crafting Apps; here every op is checked against the catalog (CK_CATALOG), so a wrong name fails the way it
 * would there, with the closest real names. Lambdas are kept as source with the names they read; px lambdas are
 * traced to WGSL. Runs in a worker (no DOM).
 */
(function (root) {
  'use strict';
  const META = Symbol('ck.meta');

  // ── small utilities ──────────────────────────────────────────────────
  function lev(a, b) {
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
    return prev[n];
  }
  function suggest(name, pool, k) {
    k = k || 3;
    const low = name.toLowerCase();
    return pool.map(p => [p, p.toLowerCase().includes(low) || low.includes(p.toLowerCase()) ? 0.5 : lev(low, p.toLowerCase())])
      .sort((a, b) => a[1] - b[1]).filter(x => x[1] <= Math.max(2, Math.ceil(name.length / 3))).slice(0, k).map(x => x[0]);
  }
  const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); };
  class CkError extends Error { constructor(kind, message) { super(message); this.kind = kind; this.name = kind; } }

  // Names a lambda reads: identifiers that are not its parameters, its locals or JS globals.
  const GLOBALS = new Set('Math JSON Number String Array Object Boolean Date console undefined null true false NaN Infinity this new return const let var function if else for of in while typeof await async'.split(' '));
  function lambdaInfo(fn) {
    const src = String(fn);
    const arrow = src.indexOf('=>'), brace = src.indexOf('{'), paren = src.indexOf(')');
    const headEnd = arrow > 0 && (brace < 0 || arrow < brace) ? arrow : paren + 1;
    const head = src.slice(0, headEnd);
    const params = new Set((head.match(/[A-Za-z_$][\w$]*/g) || []).filter(w => w !== 'function' && w !== 'async'));
    const body = src.slice(headEnd).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ').replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""').replace(/([{,]\s*)[A-Za-z_$][\w$]*\s*:(?!:)/g, '$1');
    const locals = new Set([...body.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]));
    for (const m of body.matchAll(/\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>/g)) locals.add(m[1]);
    const reads = new Set(), fields = new Set();
    for (const m of body.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)(\s*\.\s*([A-Za-z_$][\w$]*))?/g)) {
      const id = m[2];
      if (params.has(id)) { if (m[4]) fields.add(id + '.' + m[4]); continue; }
      if (locals.has(id) || GLOBALS.has(id)) continue;
      reads.add(id);
    }
    return { src, params: [...params], reads: [...reads], fields: [...fields] };
  }

  // ── px lambdas: traced to an expression tree; WGSL (GPU) and JS (CPU) are both generated from it ──
  // AST: ['in', name] · ['num', v] · ['u', key] (a control or node read as a uniform) · ['f', fn, ...args] ·
  //      ['sw', expr, 'xy'] (swizzle or named channel) · ['obj', { name: expr }] (a returned record)
  const PXF = ['add', 'sub', 'mul', 'div', 'mix', 'smoothstep', 'sin', 'cos', 'abs', 'pow', 'clamp', 'oneMinus', 'distance', 'gray', 'step', 'fract', 'length', 'dot', 'max', 'min', 'floor', 'sqrt', 'exp', 'log', 'atan2', 'tan', 'sign', 'hsv'];
  let PX_UNIFORMS = null;   // collector while a px lambda is traced
  function pxArg(v) {
    if (typeof v === 'number') return ['num', v];
    if (typeof v === 'boolean') return ['num', v ? 1 : 0];
    if (v && v.__ast) return v.__ast;
    if (v && v[META]) {
      const m = v[META]; const key = m.type === 'control' ? m.id : (m.node || 'u');
      if (PX_UNIFORMS) PX_UNIFORMS[key] = m.type === 'control' ? { $control: m.id } : { $ref: m.node };
      return ['u', key];
    }
    if (Array.isArray(v)) return ['vec', v.map(pxArg)];
    if (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v)) { const h = v.length === 4 ? v.slice(1).split('').map(x => x + x).join('') : v.slice(1, 7); return ['vec', [0, 2, 4].map(i => ['num', parseInt(h.slice(i, i + 2), 16) / 255]).concat([['num', 1]])]; }
    throw new CkError('PxError', `px lambda: ${typeof v} values cannot be used inside a px lambda`);
  }
  function pxWrap(ast) {
    return new Proxy(function () {}, {
      get(t, k) {
        if (k === '__ast') return ast;
        if (k === '__px') return wgslOf(ast);
        if (typeof k === 'symbol' || k === 'then') return undefined;
        if (PXF.includes(k)) return (...args) => pxWrap(['f', k, ast].concat(args.map(pxArg)));
        if (/^[A-Za-z_]\w*$/.test(k)) return pxWrap(['sw', ast, k]);
        throw new CkError('PxError', `px lambda: .${String(k)} is not available on traced values. Use one of: ${PXF.join(', ')}, a swizzle (.r .xy .a) or a field channel name.`);
      },
    });
  }
  const WG = {
    add: (a, b) => `(${a} + ${b})`, sub: (a, b) => `(${a} - ${b})`, mul: (a, b) => `(${a} * ${b})`, div: (a, b) => `(${a} / ${b})`,
    mix: (a, b, t) => `mix(${a}, ${b}, ${t})`, smoothstep: (a, e0, e1) => `smoothstep(${e0}, ${e1}, ${a})`, step: (a, e) => `step(${e}, ${a})`,
    oneMinus: a => `(1.0 - ${a})`, distance: (a, b) => `distance(${a}, ${b})`, gray: a => `vec4f(vec3f(dot(${a}.rgb, vec3f(0.2126, 0.7152, 0.0722))), ${a}.a)`,
    hsv: a => `hsv2rgb(${a})`,
  };
  function wgslOf(a) {
    switch (a[0]) {
      case 'in': return a[1] === 't' ? 'u.time' : a[1];
      case 'num': return Number.isInteger(a[1]) ? a[1].toFixed(1) : String(a[1]);
      case 'u': return `u.${a[1]}`;
      case 'vec': return `vec${a[1].length}f(${a[1].map(wgslOf).join(', ')})`;
      case 'sw': return `${wgslOf(a[1])}.${a[2]}`;
      case 'obj': return 'vec4f(' + Object.entries(a[1]).map(([k, v]) => `/* ${k} */ ${wgslOf(v)}`).concat(Array(Math.max(0, 4 - Object.keys(a[1]).length)).fill('0.0')).join(', ') + ')';
      case 'f': { const args = a.slice(2).map(wgslOf); return WG[a[1]] ? WG[a[1]](...args) : `${a[1]}(${args.join(', ')})`; }
    }
    return '0.0';
  }
  function tracePx(fn) {
    const inputs = { c: pxWrap(['in', 'c']), uv: pxWrap(['in', 'uv']), xy: pxWrap(['in', 'xy']), t: pxWrap(['in', 't']), n: pxWrap(['in', 'n']), lap: pxWrap(['in', 'lap']), size: pxWrap(['in', 'size']) };
    PX_UNIFORMS = {};
    let ast = null, wgsl = null, error = null;
    try {
      const out = fn(inputs);
      if (out && out.__ast) ast = out.__ast;
      else if (out && typeof out === 'object' && !out[META]) { const o = {}; for (const [k, v] of Object.entries(out)) o[k] = pxArg(v); ast = ['obj', o]; }
      else if (typeof out === 'number') ast = ['num', out];
      else throw new CkError('PxError', 'a px lambda must return a traced value (built from c, uv, xy, t, n, lap) or an object of them');
      wgsl = `fn px(c: vec4f, uv: vec2f, xy: vec2f, n: f32, lap: vec4f) -> vec4f {\n  return ${wgslOf(ast)};\n}`;
    } catch (e) { error = String(e && e.message || e); }
    const uniforms = PX_UNIFORMS; PX_UNIFORMS = null;
    return { ast, wgsl, error, uniforms, reads: JSON.stringify(ast || []).includes('"t"]') ? ['time'] : [] };
  }

  // ── the recorder ─────────────────────────────────────────────────────
  function create(catalog, opts) {
    opts = opts || {};
    const ops = catalog.ops;
    const nodes = [], controls = [], views = [], events = [], diagnostics = [], fns = [];
    const byId = new Map();
    let seq = 0, cseq = 0, vseq = 0, componentSeq = 0, group = null, app = null;
    const log = (kind, what) => { if (events.length < 400) events.push({ kind, what }); };
    const node = id => byId.get(id);

    // a control passed as a param without a label takes that param's name
    function nameControls(v, key, depth) {
      if (!v || typeof v !== 'object' || (depth || 0) > 6) return;
      if (Array.isArray(v)) { v.forEach(x => nameControls(x, key, (depth || 0) + 1)); return; }
      if (v.$control) { const c = controls.find(x => x.id === v.$control); if (c && c.auto && key && !/^\d+$/.test(key) && !/^(value|arg\d*)$/.test(key)) { c.label = key; c.auto = false; } return; }
      for (const [k, x] of Object.entries(v)) nameControls(x, k, (depth || 0) + 1);
    }
    function addNode(op, out, inputs, params, extra) {
      nameControls(params);
      const id = 'n' + (++seq);
      const n = Object.assign({ id, op, kind: out, in: inputs || {}, params: params || {} }, extra || {});
      if (group) n.group = group;
      nodes.push(n); byId.set(id, n);
      log('node', `${id} ${op}`);
      return id;
    }

    // params: literals stay; values → {$ref}; controls → {$control}; keys → {$keys}; expr → {$expr, refs}; lambdas → {$lambda, reads}
    function enc(v, depth) {
      depth = depth || 0;
      if (depth > 8) return '…';
      if (v === null || v === undefined || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
      if (typeof v === 'function' && !v[META]) {
        if (v.componentName) return { $component: v.componentName, defaults: enc(v.defaults, depth + 1) };
        const info = lambdaInfo(v);
        fns.push(v);
        return { $lambda: info.src.length > 600 ? info.src.slice(0, 600) + '…' : info.src, reads: info.reads, fields: info.fields, $fn: fns.length - 1 };
      }
      if (v[META]) {
        const m = v[META];
        if (m.type === 'control') return { $control: m.id };
        if (m.type === 'keys') return { $keys: m.keys.map(k => k.map(x => enc(x, depth + 1))) };
        if (m.type === 'expr') return { $expr: m.text, refs: m.refs };
        if (m.type === 'value') return { $ref: project(m) };
        if (m.type === 'view') return { $view: m.id };
        if (m.type === 'sink') return { $ref: m.node };
      }
      if (Array.isArray(v)) return v.map(x => enc(x, depth + 1));
      if (typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = enc(v[k], depth + 1); return o; }
      return String(v);
    }
    // a value reached through a property path (ref.beauty, cell.center) becomes a projection node
    function project(m) {
      if (!m.path || !m.path.length) return m.node;
      return addNode('get', 'json', { from: m.node }, { field: m.path.join('.') });
    }
    const isVal = v => v && v[META] && v[META].type === 'value';

    function valueProxy(id, kind, path) {
      path = path || [];
      const meta = { type: 'value', node: id, kind, path };
      const p = new Proxy(function () {}, {
        get(t, k) {
          if (k === META) return meta;
          if (k === Symbol.iterator && kind === 'list' && !path.length) return () => iterate(meta);
          if (k === Symbol.toPrimitive) return () => { throw new CkError('ValueError', `a ${kind} value (${id}) is a node in the graph, not a number or string. Pass it to an op, or read it with ck.expr\`\${value}\``); };
          if (typeof k === 'symbol' || k === 'then') return undefined;
          if (path.length === 0) {
            if (k === 'kind') return kind;
            if (k === 'node') return id;
            if (k === 'toJSON') return () => ({ $ref: id });
            if (k === 'as') return name => { node(id).name = String(name); return p; };
            if (k === 'pipe') return f => f(p);
            if (k === 'pin') return () => { const n = node(id); n.pin = 'sha256:' + hash(id + n.op + JSON.stringify(n.params)); log('pin', id); return p; };
            if (k === 'eval') return async () => ({ node: id, kind, note: 'the recording runtime computes nothing; the IR shows what would run' });
            if (k === 'on') return (ev, f) => { const n = node(id); (n.on = n.on || {})[ev] = enc(f); return p; };
            if (k === 'tap') return (f, o) => { o = o || {}; const out = o.returns || kind; return valueProxy(addNode('js.tap', out, { src: id }, { fn: enc(f), key: o.key || null }, { device: 'js worker' }), out); };
            if (k === 'px') return (f, o) => pxNode(id, kind, f, o || {});
            if (k === 'export') return (format, o) => sink(id, String(format), o || {});
            if (kind === 'list') {
              if (k === 'map') return (f, o) => mapNode(meta, f, o, 'list');
              if (k === 'length') return countOf(id);
              if (/^\d+$/.test(k)) return valueProxy(addNode('list.at', elemOf(id), { list: id }, { index: +k }), elemOf(id));
            }
          }
          return valueProxy(id, kind, path.concat([String(k)]));
        },
        apply(t, self, args) {
          if (!path.length) throw new CkError('ValueError', `a ${kind} value (${id}) is not a function`);
          return callOp(meta, args);
        },
      });
      return p;
    }
    const elemOf = id => (node(id) && node(id).elem) || 'image';
    const countOf = id => (node(id) && node(id).count) || 4;
    function* iterate(meta) { const n = countOf(meta.node); for (let i = 0; i < n; i++) yield valueProxy(addNode('list.at', elemOf(meta.node), { list: meta.node }, { index: i }), elemOf(meta.node)); }

    // symbolic map: the lambda runs once over an element placeholder; the nodes it made are the per-element template
    function mapNode(meta, f, o, outKind, elemKind) {
      const ek = elemKind || elemOf(meta.node), start = seq;
      const elem = valueProxy(addNode('each', ek, { of: meta.node }, {}), ek);
      if (typeof f !== 'function') throw new CkError('ArgError', 'map(f): f must be a function of one element');
      const r = f(elem, 0);
      const rm = r && r[META];
      const body = nodes.filter(n => +n.id.slice(1) > start).map(n => n.id);
      const out = addNode(outKind === 'list' ? 'list.map' : meta.kind + '.map', outKind, Object.assign({ src: meta.node }, rm && rm.type === 'value' ? { each: project(rm) } : {}),
        Object.assign({ fn: enc(f), template: body }, o ? enc(o) : {}), outKind === 'list' ? { elem: rm ? rm.kind : 'json', count: countOf(meta.node) } : {});
      return valueProxy(out, outKind);
    }

    function lookup(kind, path) {
      const name = path.join('.');
      const also = kind === 'clip' || kind === 'comp' ? ['image'] : kind === 'mask' ? ['image'] : kind === 'path' ? ['shapes'] : kind === 'shapes' ? ['path'] : kind === 'text' ? ['shapes'] : kind === 'field' ? ['image'] : [];
      for (const id of [`${kind}.${name}`].concat(also.map(k => `${k}.${name}`), [`*.${name}`])) if (ops[id]) return [id, ops[id]];
      return null;
    }
    function opsOn(kind) { const also = kind === 'clip' || kind === 'comp' || kind === 'mask' || kind === 'field' ? ['image'] : kind === 'path' ? ['shapes'] : kind === 'shapes' || kind === 'text' ? ['path'] : []; return Object.keys(ops).filter(id => ops[id].on === kind || ops[id].on === '*' || also.includes(ops[id].on)).map(id => id.slice(id.indexOf('.') + 1)); }

    function callOp(meta, args) {
      const { node: src, kind, path } = meta;
      const found = lookup(kind, path);
      const name = path.join('.');
      if (!found) {
        const pool = opsOn(kind), s = suggest(name, pool);
        const elsewhere = Object.keys(ops).filter(id => id.endsWith('.' + name) && !id.startsWith(kind + '.')).map(id => id.split('.')[0]);
        throw new CkError('OpError', `${kind}.${name}() does not exist` + (s.length ? `; did you mean ${s.map(x => '.' + x + '()').join(' or ')}?` : '.') +
          (elsewhere.length ? ` (${name}() exists on ${elsewhere.join(', ')} values)` : '') + ` → docs("${kind}")`);
      }
      const [op, spec] = found;
      const inputs = { src };
      const params = {};
      const argNames = spec.args || ['params'];
      let fnArg = null;
      args.forEach((v, i) => {
        const a = argNames[i] || ('arg' + i);
        if (v === undefined) return;
        if (typeof v === 'function' && !v[META] && !v.componentName && (spec.each || spec.map)) { fnArg = v; return; }
        const plain = v && typeof v === 'object' && !v[META] && !Array.isArray(v);
        if (plain && (a === 'params' || (i === args.length - 1 && spec.params && Object.keys(v).every(k => k in spec.params)))) Object.assign(params, enc(v));
        else if (isVal(v)) inputs[a] = project(v[META]);
        else params[a] = enc(v);
      });
      checkParams(op, spec, params);
      if (spec.map) return mapNode(meta, fnArg, params, kind, spec.elem || 'image');
      let cellIds = null;
      if (spec.each) {
        const cols = typeof params.cols === 'number' ? params.cols : 1, rows = typeof params.rows === 'number' ? params.rows : 1, start = seq;
        cellIds = [];
        for (let i = 0; i < cols * rows; i++) {
          const cid = addNode('layout.cell', 'record', {}, { index: i, col: i % cols, row: Math.floor(i / cols), cols, rows });
          cellIds.push(cid);
          const r = fnArg ? fnArg(valueProxy(cid, 'record'), i) : null;
          if (isVal(r)) inputs['c' + i] = project(r[META]);
        }
        params.template = nodes.filter(n => +n.id.slice(1) > start).length + ' nodes';
        params.cells = cellIds;
      }
      const srcNode = node(src);
      if (srcNode && srcNode.acc && !spec.accumulate) srcNode.acc.forEach((a, i) => { inputs['k' + i] = a; });
      const out = spec.out === 'same' ? kind : spec.out === 'self' ? kind : spec.out;
      const extra = {};
      if (out === 'list') { extra.elem = spec.elem || kind; extra.count = (typeof params.n === 'number' && params.n) || spec.count || 4; }
      const id = addNode(op, out, inputs, params, extra);
      if (cellIds) for (const cid of cellIds) node(cid).params.grid = id;
      if (spec.accumulate || spec.out === 'self') {
        if (spec.accumulate && srcNode) (srcNode.acc = srcNode.acc || []).push(id);
        return valueProxy(src, kind);
      }
      return valueProxy(id, out);
    }
    function checkParams(op, spec, params) {
      if (!spec.params || spec.open) return;
      const known = new Set(Object.keys(spec.params).concat(spec.args || []));
      for (const k of Object.keys(params)) {
        if (!known.has(k)) {
          const s = suggest(k, Object.keys(spec.params));
          diagnostics.push({ level: 'warn', kind: 'ParamWarning', message: `${op}: unknown param "${k}"${s.length ? ` (did you mean "${s[0]}"?)` : ''}. Params: ${Object.keys(spec.params).join(', ') || 'none'}` });
        }
      }
      for (const [k, p] of Object.entries(spec.params)) {
        const v = params[k];
        if (typeof v === 'number' && typeof p.min === 'number' && (v < p.min || v > p.max)) diagnostics.push({ level: 'warn', kind: 'RangeWarning', message: `${op}: ${k} = ${v} is outside ${p.min}–${p.max}` });
      }
    }
    function pxNode(src, kind, f, o) {
      if (typeof f !== 'function') throw new CkError('ArgError', 'px(f): f must be a function of { c, uv, xy, t, n, lap }');
      const tr = tracePx(f);
      if (tr.error) diagnostics.push({ level: 'error', kind: 'PxError', message: tr.error });
      const id = addNode('raster.px', kind, { src }, Object.assign({ fn: enc(f), wgsl: tr.wgsl, ast: tr.ast, uniforms: tr.uniforms, time: tr.reads.includes('time') }, o.uniforms ? { extra: enc(o.uniforms) } : {}, o.size ? { size: enc(o.size) } : {}), { pointwise: true });
      return valueProxy(id, kind);
    }
    function sink(src, format, o) {
      const id = addNode('sink.' + format, 'sink', { src }, enc(o));
      return {
        [META]: { type: 'sink', node: id },
        save: async name => { node(id).params.file = name || null; log('sink', `${id} → ${name || format}`); return { saved: name || format, note: 'recording runtime: nothing written' }; },
        then: undefined,
      };
    }

    // ── controls: a param slot and a view at once ──
    const controlProxies = new Map();
    function mkControl(type, props) {
      const id = 'c' + (++cseq);
      const c = Object.assign({ id, type }, enc(props || {}));
      if (!c.label) { c.label = props && props.mode ? props.mode : type + ' ' + cseq; c.auto = !(props && props.mode); }
      nameControls(Object.fromEntries(Object.entries(c).filter(([k]) => !['id', 'type', 'label', 'auto'].includes(k))));
      controls.push(c);
      log('control', `${id} ${type} · ${c.label}`);
      const meta = { type: 'control', id };
      const p = new Proxy(function () {}, {
        get(t, k) {
          if (k === META) return meta;
          if (k === Symbol.toPrimitive) return () => `«${id}»`;
          if (typeof k === 'symbol' || k === 'then') return undefined;
          if (k === 'id') return id;
          if (k === 'value') { const E = root.CK_ENGINE; return E && E.liveControl ? E.liveControl(id) : c.value; }
          if (k === 'bind') return name => { c.bind = String(name); return p; };
          if (k === 'on') return (ev, f) => { (c.on = c.on || {})[ev] = enc(f); return p; };
          if (k === 'at') return x => { const E = root.CK_ENGINE; return E && E.controlAt ? E.controlAt(id, x) : x; };
          if (PXF.includes(k)) return (...a) => pxWrap(['f', k, pxArg(p)].concat(a.map(pxArg)));
          if (k === 'style' || k === 'slot') return () => p;
          return undefined;
        },
      });
      controlProxies.set(id, p);
      return p;
    }
    const ui = {
      slider: (min, max, o) => mkControl('slider', Object.assign({ min, max }, o)),
      knob: (min, max, o) => mkControl('knob', Object.assign({ min, max }, o)),
      xy: o => mkControl('xy', o),
      wheel: o => mkControl('wheel', Object.assign({ label: o && o.mode }, o)),
      curve: o => mkControl('curve', o),
      gradient: o => mkControl('gradient', o),
      color: o => mkControl('color', o),
      swatches: (pal, o) => mkControl('swatches', Object.assign({ of: pal }, o)),
      select: (options, o) => mkControl('select', Object.assign({ options }, o)),
      toggle: o => mkControl('toggle', o),
      prompt: o => mkControl('prompt', Object.assign({ label: 'prompt' }, o)),
      seed: o => mkControl('seed', Object.assign({ value: 4021, label: 'seed' }, o)),
      brush: o => mkControl('brush', Object.assign({ label: (o && o.preset) || 'brush' }, o)),
      develop: o => mkControl('develop', { value: o, label: 'develop' }),
      tokens: (t, o) => mkControl('tokens', Object.assign({ of: t, label: 'tokens' }, o)),
    };

    // ── views ──
    function bindOf(x) {
      if (x == null) return null;
      if (x[META]) return enc(x);
      if (Array.isArray(x)) return x.map(bindOf);
      if (typeof x === 'object') { const o = {}; for (const k of Object.keys(x)) o[k] = bindOf(x[k]); return o; }
      return x;
    }
    function view(type, bind, props) {
      const id = 'v' + (++vseq);
      const v = { id, view: type, bind: bindOf(bind), props: props && typeof props === 'object' && !props[META] ? enc(props) : props != null ? { arg: enc(props) } : {} };
      views.push(v);
      log('view', `${id} ${type}`);
      const meta = { type: 'view', id };
      const p = new Proxy(function () {}, {
        get(t, k) {
          if (k === META) return meta;
          if (typeof k === 'symbol' || k === 'then') return undefined;
          if (k === 'id') return id;
          if (k === 'on') return (ev, f) => { (v.on = v.on || {})[ev] = enc(f); return p; };
          if (k === 'add') return (x, o) => { (v.children = v.children || []).push({ item: bindOf(x), props: enc(o || {}) }); return p; };
          if (k === 'items') return kindName => valueProxy(addNode('board.items', 'list', {}, { board: id, kind: kindName || 'image' }, { elem: kindName || 'image', count: 5 }), 'list');
          if (k === 'style' || k === 'slot' || k === 'mount') return () => p;
          return undefined;
        },
      });
      return p;
    }
    const surface = {};
    ['canvas', 'stage', 'page', 'timeline', 'sheet', 'grid'].forEach(s => { surface[s] = (v, o) => view('surface.' + s, v, o); });
    surface.board = o => view('surface.board', null, o);
    const lens = {};
    ['histogram', 'waveform', 'vectorscope', 'parade', 'gamut', 'spectrum', 'loudness', 'preflight', 'graph', 'typography', 'constraints', 'blocks', 'diff'].forEach(s => { lens[s] = (v, o) => view('lens.' + s, v, o); });
    const panels = {};
    ['layers', 'effects', 'tracks', 'mixer', 'history'].forEach(s => { panels[s] = (v, o) => view('panel.' + s, v, o); });
    function mkApp(o, regions) {
      if (app) diagnostics.push({ level: 'warn', kind: 'AppWarning', message: 'ck.app() was called twice; the last call wins' });
      const r = {};
      for (const k of Object.keys(regions || {})) {
        if (!['top', 'left', 'center', 'right', 'bottom'].includes(k)) diagnostics.push({ level: 'warn', kind: 'AppWarning', message: `ck.app: unknown region "${k}". Regions: top, left, center, right, bottom` });
        r[k] = bindOf(regions[k]);
      }
      if (!r.center) diagnostics.push({ level: 'warn', kind: 'AppWarning', message: 'ck.app: no center region; the app has nothing to show' });
      app = { props: enc(o || {}), regions: r };
      log('app', `app · ${Object.keys(r).join(' · ')}`);
      return { mount: async () => true, graph: () => compile() };
    }

    // ── stacks: layers, comps, mixes ──
    function stackProxy(id) {
      const n = node(id), base = valueProxy(id, n.kind);
      const sp = new Proxy(function () {}, {
        get(t, k) {
          if (k === META) return base[META];
          if (typeof k === 'symbol' || k === 'then') return undefined;
          if (k === 'layer' || k === 'clip' || k === 'add') return (v, o) => {
            const entry = Object.assign({ kind: k === 'clip' ? 'clip' : 'layer' }, isVal(v) ? { $ref: project(v[META]) } : { value: enc(v) }, enc(o || {}));
            nameControls(entry);
            n.params.layers.push(entry);
            if (isVal(v)) n.in['l' + n.params.layers.length] = entry.$ref;
            return sp;
          };
          if (k === 'adjust') return (f, o) => {
            const start = seq, below = valueProxy(addNode('stack.below', n.kind, { stack: id }, { layer: n.params.layers.length }), n.kind);
            const r = f(below);
            const body = nodes.filter(x => +x.id.slice(1) > start).map(x => x.id);
            const entry = Object.assign({ kind: 'adjust', $ref: r[META].node, body }, enc(o || {}));
            n.params.layers.push(entry); n.in['l' + n.params.layers.length] = r[META].node;
            return sp;
          };
          if (k === 'group') return (name, f, o) => {
            const inner = stackProxy(addNode('stack', n.kind, {}, { layers: [], name }));
            const r = f(inner);
            n.params.layers.push(Object.assign({ kind: 'group', name, $ref: r[META].node }, enc(o || {}))); n.in['l' + n.params.layers.length] = r[META].node;
            return sp;
          };
          if (k === 'style') return fx => { const last = n.params.layers[n.params.layers.length - 1]; if (last) last.style = enc(fx); return sp; };
          return base[k];
        },
      });
      return sp;
    }
    function genProxy(id) {
      const base = valueProxy(id, 'image');
      return new Proxy(function () {}, {
        get(t, k) {
          if (k === META) return base[META];
          if (typeof k === 'symbol' || k === 'then') return undefined;
          if (k === 'status') return 'idle';
          if (k === 'variants') return () => valueProxy(addNode('gen.variants', 'list', { gen: id }, {}, { elem: 'image', count: node(id).params.n || 4 }), 'list');
          if (k === 'choose') return i => valueProxy(addNode('gen.choose', 'image', { gen: id }, { index: i }), 'image');
          if (k === 'plan') return () => valueProxy(addNode('gen.plan', 'json', { gen: id }, {}), 'json');
          return base[k];
        },
      });
    }
    function makeComponent(name, schema, f, defaults) {
      const call = function (input, p) {
        p = p || {};
        const merged = {};
        for (const [k, s] of Object.entries(schema || {})) merged[k] = k in p ? p[k] : k in defaults ? defaults[k] : s && s.default;
        for (const k of Object.keys(p)) if (!(k in merged)) merged[k] = p[k];
        for (const k of Object.keys(p)) if (schema && !(k in schema)) diagnostics.push({ level: 'warn', kind: 'ComponentWarning', message: `${name}: unknown prop "${k}". Props: ${Object.keys(schema).join(', ')}` });
        const outer = group; group = `${name}#${++componentSeq}`;
        log('component', `${group}(${Object.keys(p).join(', ')})`);
        try { return f(input, merged); } finally { group = outer; }
      };
      call.with = d => makeComponent(name, schema, f, Object.assign({}, defaults, d));
      call.extend = g => makeComponent(name, schema, g(call), defaults);
      call.schema = schema; call.componentName = name; call.defaults = defaults;
      return call;
    }

    // ── sources and the ck object ──
    const source = (op, out, params, extra) => valueProxy(addNode(op, out, {}, enc(params || {}), extra), out);
    const ck = {
      image: s => source('source.image', 'image', { src: String(s) }),
      images: async files => valueProxy(addNode('source.images', 'list', {}, { files: String(files) }, { elem: 'image', count: 12 }), 'list'),
      folder: async () => valueProxy(addNode('source.folder', 'list', {}, {}, { elem: 'image', count: 12 }), 'list'),
      psd: s => stackProxy(addNode('source.psd', 'image', {}, { src: String(s), layers: [] })),
      video: s => source('source.video', 'clip', { src: String(s) }),
      camera: () => source('source.camera', 'clip', {}),
      audio: s => source('source.audio', 'audio', { src: String(s) }),
      mic: () => source('source.mic', 'audio', {}),
      pdf: s => source('source.pdf', 'pages', { src: String(s) }),
      noise: p => source('source.noise', 'field', p),
      solid: (color, size) => source('source.solid', 'image', { color, size }),
      gradient: (stops, o) => source('source.gradient', 'image', Object.assign({ stops }, o)),
      text: (s, font) => source('source.text', 'text', { text: s, font }),
      story: (md, styles) => source('source.story', 'story', { text: String(md).slice(0, 40000), styles }),
      path: d => source('source.path', 'path', { d }),
      shapes: s => source('source.shapes', 'shapes', { svg: String(s || '').slice(0, 80) }),
      circle: (c, r) => { const ins = {}, ps = {}; if (isVal(c)) ins.center = project(c[META]); else ps.center = enc(c); if (isVal(r)) ins.r = project(r[META]); else ps.r = enc(r); return valueProxy(addNode('source.circle', 'shapes', ins, ps), 'shapes'); },
      group: (...items) => { const ins = {}; items.forEach((x, i) => { if (isVal(x)) ins['i' + i] = project(x[META]); }); return valueProxy(addNode('source.group', 'shapes', ins, {}), 'shapes'); },
      sheet: cells => source('source.sheet', 'table', { cells }),
      rect: o => source('source.rect', 'shapes', o),
      ellipse: o => source('source.ellipse', 'shapes', o),
      polygon: o => source('source.polygon', 'shapes', o),
      star: o => source('source.star', 'shapes', o),
      line: o => source('source.line', 'shapes', o),
      synth: o => source('source.synth', 'audio', o),
      palette: (colors, o) => source('source.palette', 'palette', Object.assign({ colors }, o)),
      sample: name => source('source.image', 'image', { src: String(name || 'portrait') }),
      scene: () => source('source.scene', 'scene', {}),
      mannequin: pose => source('source.mannequin', 'scene', { pose }),
      sketch2d: () => source('source.sketch2d', 'sketch', {}),
      pages: o => source('source.pages', 'pages', o),
      range: (a, b, n) => source('source.range', 'json', { from: a, to: b, n }),
      stack: base => stackProxy(addNode('stack', base && base[META] ? base[META].kind : 'image', base && base[META] ? { base: project(base[META]) } : {}, { layers: [] })),
      comp: o => stackProxy(addNode('comp', 'comp', {}, Object.assign(enc(o || {}), { layers: [] }))),
      mix: () => stackProxy(addNode('mix', 'audio', {}, { layers: [] })),
      gen: spec => { spec = spec || {}; const id = addNode('gen.' + (spec.model || 'model'), 'image', {}, enc(spec), { gen: true, device: 'remote model' }); return genProxy(id); },
      iterate: (init, steps, f) => {
        if (!isVal(init)) throw new CkError('ArgError', 'ck.iterate(init, steps, step): init must be a value (a field or image)');
        const k = init[META].kind, start = seq;
        const st = valueProxy(addNode('iterate.state', k, { init: project(init[META]) }, {}), k);
        const r = f(st);
        const body = nodes.filter(n => +n.id.slice(1) > start).map(n => n.id);
        return valueProxy(addNode('iterate', k, { init: project(init[META]), step: r[META].node }, { steps, body }, { loop: true }), k);
      },
      expr: (strings, ...vals) => {
        const refs = []; let text = '';
        strings.forEach((s, i) => {
          text += s;
          if (i < vals.length) {
            const v = vals[i];
            if (v && v[META]) { const m = v[META]; const key = m.type === 'control' ? m.id : project(m); refs.push(key); text += '$' + key; }
            else text += String(v);
          }
        });
        return { [META]: { type: 'expr', text, refs } };
      },
      keys: (...k) => ({ [META]: { type: 'keys', keys: k } }),
      curves: { sCurve: c => (c && c[META] ? { $curve: 'sCurve', contrast: c } : [[0, 0], [0.25, 0.25 / (c || 1)], [0.75, 1 - 0.25 / (c || 1)], [1, 1]]) },
      develop: { preset: o => o },
      ui, surface, lens, panels,
      inspector: (v, o) => view('inspector', v, o),
      column: (...vs) => view('layout.column', vs),
      row: (...vs) => view('layout.row', vs),
      tabs: t => view('layout.tabs', t),
      app: mkApp,
      component: (name, schema, f) => makeComponent(String(name), schema || {}, f, {}),
      op: (id, params, inputs) => { const spec = ops[id]; if (!spec) { const s = suggest(id, Object.keys(ops)); throw new CkError('OpError', `no op '${id}'${s.length ? `; did you mean ${s.join(' or ')}?` : ''}`); } const ins = {}; for (const [k, v] of Object.entries(inputs || {})) if (isVal(v)) ins[k] = project(v[META]); const out = spec.out === 'same' || spec.out === 'self' ? spec.on : spec.out; return valueProxy(addNode(id, out, ins, enc(params || {})), out); },
      register: spec => { if (!spec || !spec.id) throw new CkError('ArgError', 'ck.register({ id, on, out, params, src })'); ops[spec.id] = Object.assign({ on: spec.id.split('.')[0], args: ['params'], out: 'same', tier: 'T1' }, spec); log('register', spec.id); },
      plugin: async url => { log('plugin', String(url)); },
    };

    // ── compile: typecheck → fuse → place → plan → explain ──
    function compile(copts) {
      copts = copts || {};
      const target = copts.target || opts.target || 'webgpu';
      const deps = n => {
        const out = new Set(Object.values(n.in || {}).filter(x => typeof x === 'string'));
        (function walk(v) {
          if (!v || typeof v !== 'object') return;
          if (Array.isArray(v)) return v.forEach(walk);
          if (v.$ref) out.add(v.$ref);
          if (v.refs) v.refs.forEach(r => out.add(r));
          for (const x of Object.values(v)) walk(x);
        })(n.params);
        return [...out].filter(x => byId.has(x));
      };
      const edges = [];
      for (const n of nodes) for (const d of deps(n)) edges.push([d, n.id]);
      const children = {};
      for (const [a, b] of edges) (children[a] = children[a] || []).push(b);
      const downstream = ids => { const seen = new Set(); const st = [...ids]; while (st.length) { const x = st.pop(); for (const c of children[x] || []) if (!seen.has(c)) { seen.add(c); st.push(c); } } return seen; };
      // controls → nodes that read them (params, expressions, px uniforms)
      const use = {};
      const markUse = (cid, nid) => { (use[cid] = use[cid] || new Set()).add(nid); };
      for (const n of nodes) (function walk(v) {
        if (!v || typeof v !== 'object') return;
        if (Array.isArray(v)) return v.forEach(walk);
        if (v.$control) markUse(v.$control, n.id);
        if (v.refs) v.refs.forEach(r => { if (/^c\d+$/.test(r)) markUse(r, n.id); });
        for (const x of Object.values(v)) walk(x);
      })(n.params);
      // device placement
      for (const n of nodes) {
        const spec = ops[n.op] || {};
        n.pointwise = !!(n.pointwise || spec.pointwise);
        n.tier = spec.tier || (n.op === 'raster.px' ? 'T2' : n.op.startsWith('gen.') ? 'remote' : 'T1');
        if (spec.src) n.src = spec.src;
        if (n.device) continue;
        if (/^(source|sink|list|each|get|layout|board|stack\.below|iterate\.state)\b/.test(n.op)) n.device = 'io';
        else if (n.tier === 'T4') n.device = target === 'native' ? 'native' : 'unavailable';
        // where the engine in this workbench actually runs it: px lambdas and iterate on WebGPU (when the target is
        // webgpu), the apps' crates in wasm, layout and glue in JS
        else if ((n.op === 'raster.px' || n.op === 'iterate') && target === 'webgpu') n.device = 'webgpu';
        else if (spec.src && /^runtime/.test(spec.src)) n.device = 'js worker';
        else n.device = 'wasm';
      }
      // fuse chains of pointwise ops whose producer has one consumer
      const kernels = [], kIndex = {};
      for (const n of nodes) {
        if (!n.pointwise || n.device !== 'webgpu') continue;
        const srcId = n.in && n.in.src, src = srcId && byId.get(srcId);
        if (src && src.pointwise && kIndex[srcId] !== undefined && (children[srcId] || []).length === 1) { kernels[kIndex[srcId]].push(n.id); kIndex[n.id] = kIndex[srcId]; }
        else { kernels.push([n.id]); kIndex[n.id] = kernels.length - 1; }
      }
      const fused = kernels.filter(k => k.length > 1).map((k, i) => ({ id: 'k' + (i + 1), ops: k }));
      for (const k of fused) for (const id of k.ops) byId.get(id).kernel = k.id;
      // explain: what each control re-runs
      const explain = controls.map(c => {
        const direct = [...(use[c.id] || [])];
        const all = new Set(direct); for (const d of downstream(direct)) all.add(d);
        const list = [...all].sort((a, b) => +a.slice(1) - +b.slice(1));
        return { control: c.id, label: c.label, type: c.type, direct, reruns: list, kernels: [...new Set(list.map(id => byId.get(id).kernel).filter(Boolean))], devices: [...new Set(list.map(id => byId.get(id).device))] };
      });
      const used = new Set(edges.map(e => e[0]));
      const viewRefs = new Set(), shownControls = new Set();
      (function walk(v) { if (!v || typeof v !== 'object') return; if (Array.isArray(v)) return v.forEach(walk); if (v.$ref) viewRefs.add(v.$ref); if (v.$control) shownControls.add(v.$control); for (const x of Object.values(v)) walk(x); })([views, app, controls.map(c => Object.assign({}, c, { id: undefined }))]);
      const outputs = nodes.filter(n => !used.has(n.id) && !['each', 'layout.cell', 'stack.below', 'iterate.state'].includes(n.op)).map(n => n.id);
      const counts = {
        nodes: nodes.length, controls: controls.length, views: views.length, kernels: fused.length, fusedOps: fused.reduce((a, k) => a + k.ops.length, 0),
        webgpu: nodes.filter(n => n.device === 'webgpu').length, wasm: nodes.filter(n => n.device === 'wasm').length,
        js: nodes.filter(n => n.device === 'js worker').length, remote: nodes.filter(n => n.gen).length, io: nodes.filter(n => n.device === 'io').length,
        unavailable: nodes.filter(n => n.device === 'unavailable').length,
        tiers: nodes.reduce((a, n) => { if (/^T\d/.test(n.tier) && n.device !== 'io') a[n.tier] = (a[n.tier] || 0) + 1; return a; }, {}),
      };
      for (const c of controls) delete c.auto;
      const ir = { version: 1, target, nodes, controls, views, app, kernels: fused, outputs };
      ir.digest = hash(JSON.stringify([nodes.map(n => [n.op, n.in, n.params]), controls, views, app]));
      return { ir, edges, explain, counts, viewRefs: [...viewRefs], shownControls: [...shownControls], diagnostics, events };
    }

    return { ck, compile, diagnostics, fns, nodeOf: node };
  }

  // Run a program text with a fresh recorder. Stubs cover the browser names examples touch.
  const STUB_NAMES = ['fileList', 'upload', 'strokes', 'document', 'fetch', 'navigator', 'console', 'window', 'globalThis', 'self', 'localStorage', 'XMLHttpRequest', 'importScripts', 'postMessage'];
  function stubs(logs) {
    const log = (...a) => { if (logs.length < 200) logs.push(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
    return {
      fileList: '[12 files]', upload: '[an uploaded file]', strokes: [], document: { body: '[document.body]' },
      fetch: async u => ({ ok: true, text: async () => SAMPLE_TEXT(String(u)), json: async () => ({}) }),
      navigator: { clipboard: { writeText: async () => {} } }, console: { log, warn: log, error: log, info: log },
      window: undefined, globalThis: undefined, self: undefined, localStorage: undefined, XMLHttpRequest: undefined, importScripts: undefined, postMessage: undefined,
    };
  }
  // the sandbox has no network: fetch() returns a built-in sample essay (original text) for any URL
  const SAMPLE_TEXT = u => `# Quiet factories

The loudest thing in the old print works on Rua das Flores is now the kettle. Where four presses once shook the floorboards, a single digital machine sleeps under a dust sheet, and the compositors' cases have become drawers for invoices. Nobody here talks about decline. They talk about the room.

## The room

A factory is a machine for keeping people near each other. The press needed six hands at once, so six people stood close enough to shout, and the shouting became a language. When the work moved into software, the language stayed behind, half-remembered, in the way the foreman still taps the table twice before he says something important.

What replaces a room? The obvious answer is a network, but networks are made of messages, and rooms are made of interruptions. You cannot schedule the moment when someone looks over your shoulder and says that the kerning is wrong. That moment is the product as much as the paper is.

## Tools that remember

The new tools are patient. They keep every version, every command, every slider move, and they will replay any of it on request. A layout that took a week can be reflowed in a second when the copy changes. A colour that drifted between proofs can be traced back to the profile that moved it. The old machines forgot everything at the end of the day; the new ones forget nothing, which is its own kind of noise.

Still, a typesetter who learned on metal reads a page differently. She sees the rivers before the words, the grey of a paragraph before its meaning. Good software can learn to see this too: it can measure the badness of a line, the stretch of its spaces, the way a word hangs alone at the top of a column. Measuring is not caring, but it is a start.

## After the presses

The building will become something else. The developers want flats; the neighbours want a market; the last two printers want a school. Whatever happens, the floor will remember the weight of the machines in the faint grooves where the presses stood, and someone will stand there one day, a little closer to a stranger than they planned, and start to talk.`;
  const HEADER_LINES = 3;   // new Function adds 2 lines; the async wrapper adds 1
  async function run(code, catalog, opts) {
    opts = opts || {};
    const R = create(catalog, opts);
    const logs = [], st = stubs(logs);
    let error = null;
    const t0 = Date.now();
    try {
      const fn = new Function('ck', ...STUB_NAMES, `"use strict"; return (async () => {\n${code}\n})();\n//# sourceURL=program.js`);
      await fn(R.ck, ...STUB_NAMES.map(n => st[n]));
    } catch (e) {
      const where = String(e && e.stack || '').match(/program\.js:(\d+):(\d+)/) || String(e && e.stack || '').match(/<anonymous>:(\d+):(\d+)/);
      error = { kind: (e && (e.kind || e.name)) || 'Error', message: String(e && e.message || e), line: where ? Math.max(1, +where[1] - HEADER_LINES) : null };
    }
    const out = R.compile(opts);
    out.error = error; out.logs = logs; out.ms = Date.now() - t0;
    Object.defineProperty(out, 'fns', { value: R.fns, enumerable: false });
    return out;
  }

  root.CK = { create, run, lambdaInfo, tracePx, wgslOf, suggest, hash, CkError, PXF };
})(typeof self !== 'undefined' ? self : this);
