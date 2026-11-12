// Op calls on handles (split from host.ts, CHB-032): literal options, recipe-backed defaults, and contract
// errors re-targeted at the agent's own receiver.
import { ChromobenchError, diag, FRAME_ACCESSORS, formatValue, getOp, getPath, nodeArgs, PRINT_OPTIONS, recipeBackedArgs, type FrameRecipe, type OpDef } from '@chromobench/contract';
import type { Host } from '../host.ts';
import { suggest, isDslOp } from './words.ts';
import type { HandleInfo, At } from './types.ts';
import { unknownMethodErr } from './errors.ts';

/** Literal options: node handles only where the op takes a node; nothing else may be a handle. */
export function unmarshal(h: Host, op: OpDef, raw: unknown, recvExpr: string): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ChromobenchError(diag('E_ARG_TYPE', `${op.name} takes one options object`, { fix: `${recvExpr}.${op.name}({ … })`, valid: Object.keys(op.args) }));
  }
  const nodeArgNames = new Set(nodeArgs(op));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (nodeArgNames.has(k)) {
      const one = (x: unknown): unknown => (x && typeof x === 'object' && '__node' in x ? (x as { __node: string }).__node : x);
      out[k] = Array.isArray(v) ? v.map(one) : one(v);
      continue;
    }
    out[k] = literal(h, op.name, k, v);
  }
  return out;
}

export function literal(h: Host, where: string, key: string, v: unknown): unknown {
  if (v && typeof v === 'object') {
    if ('__node' in v) {
      const hd = h.exprs.get((v as { __node: string }).__node);
      const field = hd?.fields?.[0];
      throw new ChromobenchError(diag('E_ARG_TYPE', `${where}: option "${key}" got a node; options are literal values`, {
        hint: 'await the measurement first and pass the number',
        fix: hd ? `(await ${hd.expr})${field ? `.${field}` : ''}` : '(await …).…', path: `${where}.${key}`,
      }));
    }
    if ('__fn' in v || '__look' in v) throw new ChromobenchError(diag('E_ARG_TYPE', `${where}: option "${key}" must be a literal value`, { path: `${where}.${key}` }));
    if ('__num' in v) return Number((v as { __num: string }).__num);
    if (Array.isArray(v)) return v.map((x) => literal(h, where, key, x));
    return Object.fromEntries(Object.entries(v).map(([a, b]) => [a, literal(h, where, key, b)]));
  }
  return v;
}

export function recipeOf(h: Host, frame: string | null): FrameRecipe | null {
  return frame ? h.state(frame).base : null;
}

export function callOp(h: Host, opName: string, recv: HandleInfo, rawArgs: unknown, at: At): HandleInfo {
  const op = getOp(opName);
  if (!isDslOp(op)) throw unknownMethodErr(h, recv, op.area, opName.slice(op.area.length + 1));
  const args = unmarshal(h, op, rawArgs, recv.expr);
  const r = recipeOf(h, recv.frame);
  if (r) {
    for (const { arg, path } of recipeBackedArgs(op)) {
      if (arg in args) continue;
      const v = getPath(r, path);
      if (v !== undefined && v !== null) args[arg] = v;
    }
  }
  const callText = `${recv.expr}.${opName}(${Object.keys(rawArgs as object).length ? formatValue(rawArgs) : ''})`;
  try {
    const n = h.intern(opName, [recv.id], args, at);
    return h.info(n, recv.frame, callText);
  } catch (e) {
    throw rewrite(h, e, op, recv, rawArgs as Record<string, unknown>);
  }
}

/** Re-targets contract fixes at the agent's own receiver (E_DOMAIN, E_UNKNOWN_OPTION). */
export function rewrite(h: Host, e: unknown, op: OpDef, recv: HandleInfo, raw: Record<string, unknown>): unknown {
  if (!(e instanceof ChromobenchError)) return e;
  const d = { ...e.diag };
  const fx = h.frameExpr(recv.frame);
  if (d.code === 'E_DOMAIN' && recv.domain) {
    const macroOpt = Object.entries(PRINT_OPTIONS).find(([, [o]]) => o === op.name && op.name !== 'print.expose');
    if (recv.domain === 'film-dyes' && macroOpt) {
      const argVal = raw[macroOpt[1][1]];
      d.fix = `${fx}.negative().print(${argVal !== undefined ? formatValue({ [macroOpt[0]]: argVal }) : '{ … }'})`;
      d.hint = `${op.name} works on paper exposure (paper-logH); from a negative, set it through print({ ${macroOpt[0]} })`;
    } else {
      const acc = FRAME_ACCESSORS.find((x) => op.domainIn === 'any' || (Array.isArray(op.domainIn) ? op.domainIn.includes(x.domain) : op.domainIn === x.domain));
      if (acc) d.fix = `${fx}.${acc.name}().${op.name}(${Object.keys(raw).length ? formatValue(raw) : ''})`;
      else if (op.domainIn === 'paper-logH') d.fix = `${fx}.negative().print.expose().${op.name}(${Object.keys(raw).length ? formatValue(raw) : ''})`;
    }
    return new ChromobenchError(d);
  }
  if ((d.code === 'E_UNKNOWN_OPTION' || d.code === 'E_ARG_RANGE') && d.fix && d.fix.startsWith(`${op.name}(`)) {
    d.fix = `${recv.expr}.${d.fix}`;
    return new ChromobenchError(d);
  }
  if (d.code === 'E_UNKNOWN_OPTION' && !d.fix) {
    const k = Object.keys(raw).find((x) => !(x in op.args));
    const guess = k ? suggest(k, Object.keys(op.args)) : undefined;
    if (k && guess) {
      const fixed = Object.fromEntries(Object.entries(raw).map(([a, b]) => [a === k ? guess : a, b]));
      d.hint = `did you mean ${guess}?`;
      d.fix = `${recv.expr}.${op.name}(${formatValue(fixed)})`;
    }
    return new ChromobenchError(d);
  }
  return e;
}
