// The frame vocabulary (split from host.ts, CHB-032): frame.source()/scan()/negative()/print()/display(), the
// print() macro mirroring compile(), cb.testStrip/ringAround, and closure order.
import { ChromobenchError, cut, diag, formatValue, getOp, PRINT_OPTIONS, type FrameRecipe, type Node } from '@chromobench/contract';
import type { Host } from '../host.ts';
import { suggest, dslOps } from './words.ts';
import type { HandleInfo, At } from './types.ts';
import { unmarshal, literal, recipeOf, rewrite } from './calls.ts';

/** The node of a frame's compiled chain with the given op (the last one in the closure). */
export function cutOf(h: Host, r: FrameRecipe, op: string): Node {
  return cut(r, h.graph, op);
}

/** Node ids in closure order (same order as Graph.closure). */
export function closureIds(h: Host, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (nid: string): void => {
    if (seen.has(nid)) return;
    seen.add(nid);
    for (const i of h.node(nid).inputs) visit(i);
    out.push(nid);
  };
  visit(id);
  return out;
}

/** The negative-to-viewed-print chain, mirroring compile() (cache-identity test). */
export function printChain(h: Host, dyes: string, r: FrameRecipe | null, opts: Record<string, unknown>, at: At): Node {
  const p = r?.print;
  const e = p?.enlarger;
  const pick = <T>(k: string, fromRecipe: T | undefined): T | undefined => (k in opts ? (opts[k] as T) : fromRecipe);
  const filtration = pick('filtration', e?.filtration);
  const exposeArgs = (time_s: unknown, filt: unknown): Record<string, unknown> => {
    const a: Record<string, unknown> = {};
    const set = (k: string, v: unknown): void => { if (v !== undefined && v !== null) a[k] = v; };
    set('paper', pick('paper', p?.paper));
    set('mode', e?.mode);
    set('lamp', e?.lamp);
    set('filtration', filt);
    set('time_s', time_s);
    set('fstop', pick('fstop', e?.fstop));
    set('magnification', e?.magnification);
    return a;
  };
  const time = pick('time_s', e?.time_s);
  let x = h.intern('print.expose', [dyes], exposeArgs(time, filtration), at).id;
  const extra = (p?.exposures ?? []).filter((ex) => ex.enabled);
  if (r && p && e && extra.length > 0) {
    const t0 = (time as number | undefined) ?? e.time_s;
    const exposures: string[] = [];
    const masks: string[] = [];
    const modes: string[] = [];
    for (const ex of extra) {
      const t = ex.time_s ?? (ex.stops === null ? t0 : ex.kind === 'dodge' ? t0 * (1 - 2 ** -ex.stops) : t0 * (2 ** ex.stops - 1));
      exposures.push(h.intern('print.expose', [dyes], exposeArgs(Math.max(t, 0.1), ex.filtration ?? filtration), at).id);
      const spec = ex.mask ? r.masks[ex.mask] : undefined;
      const maskNodes = spec ? h.graph.adopt(spec.nodes) : [];
      masks.push(maskNodes.length ? maskNodes[maskNodes.length - 1]!.id : h.intern('mask.luminance', [x], { above: 0, below: 1, softness: 0 }, at).id);
      modes.push(ex.kind === 'dodge' ? 'subtract' : 'add');
    }
    x = h.intern('print.combine', [x], { exposures, masks, modes }, at).id;
  }
  const lights = pick('lights', p?.lights.logH);
  x = h.intern('print.lights', [x], lights !== undefined ? { logH: lights } : {}, at).id;
  const preflash = pick('preflash', p?.preflash) as number | undefined;
  if (preflash !== undefined && (typeof preflash !== 'number' || preflash !== 0)) x = h.intern('print.preflash', [x], { amount: preflash }, at).id;
  const develop: Record<string, unknown> = {};
  const paper = pick('paper', p?.paper);
  const grade = pick('grade', p?.grade);
  if (paper !== undefined) develop['paper'] = paper;
  if (grade !== undefined) develop['grade'] = grade;
  const pd = h.intern('print.develop', [x], develop, at).id;
  const ill = pick('illuminant', r?.view.illuminant);
  let v = h.intern('view.reflect', [pd], ill !== undefined ? { illuminant: ill } : {}, at).id;
  const rendering = r?.view.output.rendering ?? 'scan-of-print';
  const flare = 'flare' in opts ? opts['flare'] : rendering === 'scan-of-print' ? 0 : r?.view.flare;
  v = h.intern('view.flare', [v], flare !== undefined ? { flare } : { flare: 0 }, at).id;
  return h.intern('view.adapt', [v], r ? { to: r.view.output.white } : {}, at);
}

export function printOpts(h: Host, raw: unknown, expr: string): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ChromobenchError(diag('E_ARG_TYPE', 'print() takes one options object', { fix: `${expr}.print({ time_s: 12 })`, valid: Object.keys(PRINT_OPTIONS) }));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(k in PRINT_OPTIONS)) {
      // redirects of the owning args (lights: points → logH)
      for (const [opt, [opName, arg]] of Object.entries(PRINT_OPTIONS)) {
        const r = getOp(opName).args[arg]?.redirects?.[k];
        if (r) {
          const conv = r.scale !== undefined ? (Array.isArray(v) ? v.map((x) => Number((Number(x) * r.scale!).toPrecision(12))) : Number((Number(v) * r.scale).toPrecision(12))) : v;
          const fixed = { ...(raw as Record<string, unknown>) };
          delete fixed[k];
          fixed[opt] = conv;
          throw new ChromobenchError(diag('E_UNKNOWN_OPTION', `print() has no option "${k}"; use "${opt}"`, { hint: r.hint, fix: `${expr}.print(${formatValue(fixed)})`, valid: Object.keys(PRINT_OPTIONS) }));
        }
      }
      const guess = suggest(k, Object.keys(PRINT_OPTIONS));
      const fixed = guess ? Object.fromEntries(Object.entries(raw as Record<string, unknown>).map(([a, b]) => [a === k ? guess : a, b])) : undefined;
      throw new ChromobenchError(diag('E_UNKNOWN_OPTION', `print() has no option "${k}"`, {
        ...(guess ? { hint: `did you mean ${guess}?`, fix: `${expr}.print(${formatValue(fixed)})` } : {}), valid: Object.keys(PRINT_OPTIONS),
      }));
    }
    out[k] = literal(h, 'print', k, v);
  }
  return out;
}

/** Runs printChain and re-targets binder errors at the macro option that caused them. */
export function printMacro(h: Host, dyes: HandleInfo, raw: unknown, expr: string, at: At, exprOut: string): HandleInfo {
  const opts = printOpts(h, raw, expr);
  try {
    const n = printChain(h, dyes.id, recipeOf(h, dyes.frame), opts, at);
    return h.info(n, dyes.frame, exprOut);
  } catch (e) {
    if (!(e instanceof ChromobenchError)) throw e;
    const d = { ...e.diag };
    const opt = Object.entries(PRINT_OPTIONS).find(([, [o, a]]) => d.path === `${o}.${a}`);
    if (opt) {
      d.path = `print.${opt[0]}`;
      if (d.fix !== undefined && d.code === 'E_ARG_RANGE') {
        const fixed = { ...(raw as Record<string, unknown>), [opt[0]]: '__FIX__' };
        d.fix = `${expr}.print(${formatValue(fixed).replace('"__FIX__"', d.fix)})`;
      }
    }
    throw new ChromobenchError(d);
  }
}

export function macro(h: Host, name: string, recv: HandleInfo, raw: unknown, at: At): HandleInfo {
  if (name !== 'print') throw new ChromobenchError(diag('E_UNKNOWN_METHOD', `${recv.expr}.${name} is a namespace, not a method`, { hint: `call one of its ops, e.g. ${recv.expr}.${name}.${dslOps().find((o) => o.area === name)?.name.split('.')[1] ?? '…'}({…})`, valid: dslOps().filter((o) => o.area === name).map((o) => o.name) }));
  h.vocabulary['neg.print'] = (h.vocabulary['neg.print'] ?? 0) + 1;
  if (recv.domain !== 'film-dyes') {
    throw new ChromobenchError(diag('E_DOMAIN', `print() takes a negative (film-dyes); this handle is ${recv.domain}`, {
      hint: 'print from frame.negative() or another film-dyes handle', fix: `${h.frameExpr(recv.frame)}.negative().print(${raw && Object.keys(raw).length ? formatValue(raw) : ''})`,
    }));
  }
  const out = `${recv.expr}.print(${raw && Object.keys(raw).length ? formatValue(raw) : ''})`;
  return printMacro(h, recv, raw, recv.expr, at, out);
}

export function vocab(h: Host, name: string, frame: string, raw: unknown, at: At): HandleInfo {
  h.vocabulary[name] = (h.vocabulary[name] ?? 0) + 1;
  const s = h.state(frame);
  const fx = h.frameExpr(frame);
  const neg = (): HandleInfo => h.info(cutOf(h, s.base, 'invert.dyes'), frame, `${fx}.negative()`);
  switch (name) {
    case 'source': return h.info(cutOf(h, s.base, 'source.open'), frame, `${fx}.source()`);
    case 'scan': {
      const dyes = cutOf(h, s.base, 'invert.dyes');
      return h.info(h.node(dyes.inputs[0]!), frame, `${fx}.scan()`);
    }
    case 'negative': return neg();
    case 'display': return h.info(cutOf(h, s.base, 'output.frame'), frame, `${fx}.display()`);
    case 'print': {
      const empty = !raw || Object.keys(raw).length === 0;
      if (empty) return h.info(cutOf(h, s.base, 'view.adapt'), frame, `${fx}.print()`);
      return printMacro(h, neg(), raw, fx, at, `${fx}.print(${formatValue(raw)})`);
    }
    case 'testStrip': case 'ringAround': {
      const op = `darkroom.${name}`;
      const n = neg();
      const args = unmarshal(h, getOp(op), raw, n.expr);
      try {
        return h.info(h.intern(op, [n.id], args, at), frame, `cb.${name}(${fx}${Object.keys(args).length ? `, ${formatValue(args)}` : ''})`);
      } catch (e) {
        throw rewrite(h, e, getOp(op), n, raw as Record<string, unknown>);
      }
    }
    default: throw new ChromobenchError(diag('E_INTERNAL', `unknown vocabulary ${name}`));
  }
}

/** frame.print() of a recipe (the view.adapt node): receipts' previews. */
export function printOf(h: Host, r: FrameRecipe): Node {
  return cutOf(h, r, 'view.adapt');
}
