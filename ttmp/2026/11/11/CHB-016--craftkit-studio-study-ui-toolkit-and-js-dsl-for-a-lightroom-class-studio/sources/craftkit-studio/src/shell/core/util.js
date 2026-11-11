// Small shared helpers: paths, structural writes, equality, suggestions, platform.

export const isObj = v => v !== null && typeof v === 'object';
export const isPlain = v => isObj(v) && (Object.getPrototypeOf(v) === Object.prototype || Array.isArray(v) || Object.getPrototypeOf(v) === null);
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const round = (v, d = 0) => { const k = 10 ** d; return Math.round(v * k) / k; };

// ── paths ────────────────────────────────────────────────────────────────
// A path is an array of keys. Its string form joins with '.', and is what the path index and diagnostics use.
export const pathStr = p => p.join('.');
export const parsePath = s => (Array.isArray(s) ? s : String(s).split('.').filter(Boolean).map(k => (/^\d+$/.test(k) ? +k : k)));

export function getIn(obj, path) {
  let v = obj;
  for (const k of path) { if (v == null) return undefined; v = v[k]; }
  return v;
}

// structural write: copies only the objects along the path, so every untouched subtree keeps its identity
export function setIn(obj, path, value, i = 0) {
  if (i === path.length) return value;
  const k = path[i];
  const cur = obj == null ? (typeof k === 'number' ? [] : {}) : obj;
  const next = setIn(cur[k], path, value, i + 1);
  if (cur[k] === next && obj != null) return obj;
  if (Array.isArray(cur)) { const c = cur.slice(); c[k] = next; return c; }
  const c = Object.assign({}, cur);
  if (next === undefined) delete c[k]; else c[k] = next;
  return c;
}

export function hasPath(obj, path) {
  let v = obj;
  for (const k of path) { if (!isObj(v) || !(k in v)) return false; v = v[k]; }
  return true;
}

export const prefixOf = (a, b) => a.length <= b.length && a.every((k, i) => b[i] === k);   // a is a prefix of b (or equal)

export function shallowEq(a, b) {
  if (a === b) return true;
  if (!isObj(a) || !isObj(b)) return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

export function deepEq(a, b) {
  if (a === b) return true;
  if (!isObj(a) || !isObj(b)) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!deepEq(a[k], b[k])) return false;
  return true;
}

export function deepMerge(base, patch) {
  if (!isPlain(patch) || Array.isArray(patch)) return patch;
  const out = Object.assign({}, isPlain(base) && !Array.isArray(base) ? base : {});
  for (const [k, v] of Object.entries(patch)) out[k] = isPlain(v) && !Array.isArray(v) ? deepMerge(out[k], v) : v;
  return out;
}

export const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// ── suggestions (did you mean) ─────────────────────────────────────────────
export function lev(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}
export function suggest(name, pool, k = 3) {
  const low = String(name).toLowerCase();
  return [...new Set(pool)].map(p => [p, String(p).toLowerCase() === low ? 0 : String(p).toLowerCase().includes(low) || low.includes(String(p).toLowerCase()) ? 0.5 : lev(low, String(p).toLowerCase())])
    .sort((a, b) => a[1] - b[1]).filter(x => x[1] <= Math.max(2, Math.ceil(String(name).length / 3))).slice(0, k).map(x => x[0]);
}

// ── platform ─────────────────────────────────────────────────────────────
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

let uid = 0;
export const nextId = (p = 'n') => p + (++uid).toString(36);

export const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// a cheap stable hash for render caches and signatures
export function hash(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
export function stable(v) {
  if (v === undefined) return 'u';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
}
