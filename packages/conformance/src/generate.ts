// Generates conformance cases from the registry: a new op is tested the moment it is registered.
// Each case runs against a fresh engine from `makeEngine` and throws on failure.
import {
  acceptsDomain, allOps, ChromobenchError, DOMAINS, DOMAIN_NAMES, Graph, nodeArgs, outputChannels, sha256Hex,
  type ArgSpec, type Diagnostic, type Domain, type Engine, type ImageInfo, type Node, type OpDef,
} from '@chromobench/contract';
import { semanticCases } from './semantics.ts';
import { writeTiny16 } from './tiny-tiff.ts';

export type CaseKind =
  | 'build' | 'wrong-domain' | 'hard-bound' | 'soft-bound' | 'unknown-option' | 'redirect' | 'canonical-id'
  | 'shape' | 'region' | 'determinism' | 'measure-fields' | 'wrong-kind' | 'cancel' | 'not-implemented'
  /** What an op computes (CHB-010: print.combine and mask.*), semantics.ts. */
  | 'semantics';

export interface EnvOptions {
  /** Test hook: conformance mutants swap the canonicaliser. */
  canonicalJSON?: (v: unknown) => string;
}

export interface Env {
  engine: Engine;
  graph: Graph;
  makeEngine: () => Engine | Promise<Engine>;
  /** A seeded receiver of the given domain, adopted into the engine. */
  input(domain: Domain): Node;
  sourceSha: string;
  /** Builds node(s) in env.graph and adopts the closure into the engine. */
  build(op: string, inputs: string[], args: Record<string, unknown>): Node;
}

export interface Case {
  id: string;
  op: string;
  kind: CaseKind;
  run(env: Env): Promise<void>;
}

const W = 12;
const H = 10;

class CaseFailure extends Error {}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new CaseFailure(msg);
}

async function expectCode(code: string, f: () => unknown | Promise<unknown>, check?: (d: Diagnostic) => string | null): Promise<void> {
  try {
    await f();
  } catch (e) {
    if (!(e instanceof ChromobenchError)) throw new CaseFailure(`expected ${code}, got ${String(e)}`);
    assert(e.diag.code === code, `expected ${code}, got ${e.diag.code}: ${e.diag.message}`);
    const msg = check?.(e.diag);
    assert(!msg, msg ?? '');
    return;
  }
  throw new CaseFailure(`expected ${code}, but the call succeeded`);
}

export async function makeEnv(makeEngine: () => Engine | Promise<Engine>, opts: EnvOptions = {}): Promise<Env> {
  const engine = await makeEngine();
  const graph = new Graph(opts.canonicalJSON ? { canonicalJSON: opts.canonicalJSON } : {});
  const bytes = writeTiny16(W, H);
  const info = await engine.open({ kind: 'file', sha256: sha256Hex(bytes), bytes });
  graph.registerSource(info);
  const env: Env = {
    engine, graph, makeEngine, sourceSha: info.sha256,
    build(op, inputs, args) {
      const { node } = graph.intern(op, inputs, args);
      engine.adopt(graph.closure(node.id));
      return node;
    },
    input(domain) {
      return env.build('source.pattern', [], { domain, width: W, height: H, seed: 7 });
    },
  };
  return env;
}

function receiverDomain(op: OpDef): Domain | undefined {
  if (op.on === 'none') return undefined;
  if (op.on === 'Mask') return 'mask';
  const d = op.domainIn;
  if (d === undefined || d === 'any') return 'camera-linear';
  return Array.isArray(d) ? d[0] : d;
}

/** Required arguments without defaults get a generic valid value. */
function requiredArgs(op: OpDef, env: Env): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [n, s] of Object.entries(op.args)) {
    if (s.default !== undefined || s.optional) continue;
    if (op.name === 'source.open' && n === 'source') out[n] = env.sourceSha;
    else if (s.type === 'Mask') out[n] = env.input('mask').id;
    else if (s.type === 'Image') out[n] = env.input('camera-linear').id;
    else if (s.type === 'string' || s.type === 'stockId') out[n] = 'x';
    else throw new CaseFailure(`conformance cannot synthesise required argument ${op.name}.${n}`);
  }
  return out;
}

function buildDefault(op: OpDef, env: Env, extra: Record<string, unknown> = {}): Node {
  const d = receiverDomain(op);
  const inputs = d ? [env.input(d).id] : [];
  return env.build(op.name, inputs, { ...requiredArgs(op, env), ...extra });
}

function isNumeric(s: ArgSpec): boolean {
  return s.type === 'number' || s.type === 'vec3' || s.type === 'cmy';
}

function valueOf(s: ArgSpec, v: number): unknown {
  if (s.type === 'vec3') return [v, v, v];
  if (s.type === 'cmy') return { c: v, m: v, y: v };
  return v;
}

function eps(s: ArgSpec): number {
  if (s.integer) return 1;
  const span = (s.max ?? 1) - (s.min ?? 0);
  return Math.max(1e-6, Math.abs(span) * 1e-3);
}

function shuffleObjects(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(shuffleObjects);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, shuffleObjects(x)]));
  return v;
}

async function bytesOf(engine: Engine, node: Node, target: Parameters<Engine['evaluate']>[1]): Promise<{ data: ArrayLike<number>; width: number; height: number; info: ImageInfo }> {
  const r = await engine.evaluate(node, target);
  return { data: await r.read(), width: r.width, height: r.height, info: r.info };
}

function sameBits(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

function expectedInfo(op: OpDef, recv: Domain | undefined, args: Record<string, unknown>): { domain: Domain; channels: number } {
  const domain = op.domainFromArg ? (args[op.domainFromArg] as Domain) ?? 'camera-linear' : op.domainOut === 'same' ? recv! : (op.domainOut as Domain);
  return { domain, channels: op.domainOut === 'same' && !op.channels ? DOMAINS[recv!].channels : outputChannels(op, recv) };
}

const isImageOp = (op: OpDef): boolean => op.returns === 'Image' || op.returns === 'Mask';

/** All cases for an engine whose capabilities list `implemented`. */
export function generateCases(implemented: readonly string[]): Case[] {
  const impl = new Set(implemented);
  const cases: Case[] = [];
  const add = (op: OpDef, kind: CaseKind, suffix: string, run: Case['run']): void => {
    cases.push({ id: `${op.name} ${kind}${suffix ? ` ${suffix}` : ''}`, op: op.name, kind, run });
  };
  for (const op of allOps({ includeInternal: true })) {
    if (!impl.has(op.name)) {
      add(op, 'not-implemented', '', async (env) => {
        const n = buildDefault(op, env);
        await expectCode('E_NOT_IMPLEMENTED', () => (n.info.kind === 'Image' ? env.engine.evaluate(n, { scale: 'full', precision: 'export' }) : env.engine.measure(n)));
      });
      continue;
    }
    add(op, 'build', '', async (env) => {
      const n = buildDefault(op, env);
      if (isImageOp(op)) {
        const exp = expectedInfo(op, receiverDomain(op), n.args as Record<string, unknown>);
        assert(n.info.kind === 'Image', 'expected an image node');
        assert(n.info.domain === exp.domain, `domain ${n.info.domain} ≠ ${exp.domain}`);
        assert(n.info.channels === exp.channels, `channels ${n.info.channels} ≠ ${exp.channels}`);
      } else assert(n.info.kind === 'Value', 'expected a value node');
    });
    const din = op.domainIn;
    if ((op.on === 'Image' || op.on === 'Mask') && din !== undefined && din !== 'any') {
      const wrong = DOMAIN_NAMES.find((d) => !acceptsDomain(op, d) && d !== 'silver-density');
      if (wrong) {
        add(op, 'wrong-domain', wrong, async (env) => {
          const inp = env.input(wrong);
          await expectCode('E_DOMAIN', () => env.graph.intern(op.name, [inp.id], requiredArgs(op, env)), (d) => (d.hint ? null : 'E_DOMAIN without a hint'));
        });
      }
    }
    for (const [name, s] of Object.entries(op.args)) {
      if (!isNumeric(s)) continue;
      for (const [label, v] of [['min', s.min === undefined ? undefined : s.min - eps(s)], ['max', s.max === undefined ? undefined : s.max + eps(s)]] as const) {
        if (v === undefined) continue;
        add(op, 'hard-bound', `${name} ${label}`, async (env) => {
          const d = receiverDomain(op);
          const inputs = d ? [env.input(d).id] : [];
          await expectCode('E_ARG_RANGE', () => env.graph.intern(op.name, inputs, { ...requiredArgs(op, env), [name]: valueOf(s, v) }), (dg) => (dg.valid?.length ? null : 'E_ARG_RANGE without valid'));
        });
      }
      if (s.usual) {
        const below = s.usual[0] - eps(s);
        const above = s.usual[1] + eps(s);
        const v = s.min === undefined || below >= s.min ? below : s.max === undefined || above <= s.max ? above : undefined;
        if (v !== undefined) {
          add(op, 'soft-bound', name, async (env) => {
            const d = receiverDomain(op);
            const inputs = d ? [env.input(d).id] : [];
            const { node, warnings } = env.graph.intern(op.name, inputs, { ...requiredArgs(op, env), [name]: valueOf(s, v) });
            assert(node, 'node not built');
            assert(warnings.some((w) => w.code === 'RANGE'), 'no RANGE warning');
          });
        }
      }
    }
    for (const [name, s] of Object.entries(op.args)) {
      for (const [rk] of Object.entries(s.redirects ?? {})) {
        add(op, 'redirect', `${rk}→${name}`, async (env) => {
          const d = receiverDomain(op);
          const inputs = d ? [env.input(d).id] : [];
          await expectCode('E_UNKNOWN_OPTION', () => env.graph.intern(op.name, inputs, { ...requiredArgs(op, env), [rk]: s.default ?? 1 }), (dg) => (dg.fix?.includes(name) ? null : `fix ${dg.fix} does not name ${name}`));
        });
      }
    }
    const first = Object.keys(op.args)[0];
    if (first) {
      add(op, 'unknown-option', first, async (env) => {
        const d = receiverDomain(op);
        const inputs = d ? [env.input(d).id] : [];
        await expectCode('E_UNKNOWN_OPTION', () => env.graph.intern(op.name, inputs, { ...requiredArgs(op, env), [`${first}x`]: 1 }), (dg) => (dg.hint?.includes(first) ? null : `hint ${dg.hint} does not name ${first}`));
      });
    }
    add(op, 'canonical-id', '', async (env) => {
      const d = receiverDomain(op);
      const inputs = d ? [env.input(d).id] : [];
      const req = requiredArgs(op, env);
      const a = env.graph.intern(op.name, inputs, req).node;
      const explicit: Record<string, unknown> = { ...req };
      for (const [n, s] of Object.entries(op.args)) if (s.default !== undefined && !nodeArgs(op).includes(n)) explicit[n] = shuffleObjects(s.default);
      const reversed = Object.fromEntries(Object.entries(explicit).reverse());
      const b = env.graph.intern(op.name, inputs, reversed).node;
      assert(a.id === b.id, 'explicit defaults in another key order give a different id');
    });
    if (isImageOp(op)) {
      add(op, 'shape', '', async (env) => {
        const n = buildDefault(op, env);
        const info = n.info as ImageInfo;
        for (const scale of [1, 0.5] as const) {
          const r = await bytesOf(env.engine, n, { scale, precision: 'preview' });
          assert(r.info.domain === info.domain, `result domain ${r.info.domain} ≠ node domain ${info.domain}`);
          assert(r.info.channels === info.channels, `result channels ${r.info.channels} ≠ ${info.channels}`);
          assert(r.width === Math.max(1, Math.round(info.width * scale)), `width ${r.width} at scale ${scale}`);
          assert(r.data.length === r.width * r.height * info.channels, `data length ${r.data.length} ≠ w·h·c`);
          for (let i = 0; i < r.data.length; i++) assert(Number.isFinite(r.data[i]), `non-finite sample at ${i}`);
        }
      });
      if (op.class === 'pointwise' && op.on !== 'none') {
        add(op, 'region', '', async (env) => {
          const n = buildDefault(op, env);
          const info = n.info as ImageInfo;
          const reg = { x: 2, y: 1, w: 5, h: 4 };
          const full = await bytesOf(env.engine, n, { scale: 'full', precision: 'export' });
          const part = await bytesOf(env.engine, n, { scale: 'full', precision: 'export', region: reg });
          const c = info.channels;
          const crop: number[] = [];
          for (let y = reg.y; y < reg.y + reg.h; y++) for (let x = reg.x; x < reg.x + reg.w; x++) for (let k = 0; k < c; k++) crop.push(full.data[(y * full.width + x) * c + k]!);
          assert(sameBits(part.data, crop), 'region result differs from the crop of the full result');
        });
      }
      add(op, 'determinism', '', async (env) => {
        const n = buildDefault(op, env);
        const t = { scale: 'full' as const, precision: 'export' as const };
        const a = await bytesOf(env.engine, n, t);
        const b = await bytesOf(env.engine, n, t);
        assert(sameBits(a.data, b.data), 'two evaluations differ');
        const env2 = await makeEnv(env.makeEngine);
        const n2 = buildDefault(op, env2);
        assert(n2.id === n.id, 'node ids differ between environments');
        const c = await bytesOf(env2.engine, n2, t);
        assert(sameBits(a.data, c.data), 'two engine instances differ');
        env2.engine.dispose();
      });
    } else {
      add(op, 'measure-fields', '', async (env) => {
        const n = buildDefault(op, env);
        const m = await env.engine.measure(n);
        assert(m.node === n.id, 'measurement node id');
        for (const f of op.fields ?? []) {
          const v = m.value[f.name];
          if (f.optional && v === undefined) continue;
          assert(v !== undefined, `field ${f.name} missing`);
          if (f.type === 'number') assert(typeof v === 'number' && Number.isFinite(v), `field ${f.name} not a finite number`);
          if (f.type === 'vec3') assert(Array.isArray(v) && v.length === 3 && v.every((x) => Number.isFinite(x)), `field ${f.name} not a finite vec3`);
        }
      });
    }
  }
  // Engine-wide rules, attached to representative ops.
  const img = allOps({ includeInternal: true }).find((o) => o.name === 'source.pattern');
  const val = allOps().find((o) => o.name === 'measure.stats');
  if (img && impl.has(img.name)) {
    cases.push({ id: 'engine wrong-kind measure(Image)', op: img.name, kind: 'wrong-kind', run: async (env) => {
      await expectCode('E_WRONG_KIND', () => env.engine.measure(env.input('camera-linear')));
    } });
    cases.push({ id: 'engine cancel', op: img.name, kind: 'cancel', run: async (env) => {
      const ac = new AbortController();
      ac.abort();
      await expectCode('E_CANCELLED', () => env.engine.evaluate(env.input('camera-linear'), { scale: 'full', precision: 'export', signal: ac.signal }));
    } });
  }
  if (val && impl.has(val.name)) {
    cases.push({ id: 'engine wrong-kind evaluate(Value)', op: val.name, kind: 'wrong-kind', run: async (env) => {
      const n = env.build('measure.stats', [env.input('camera-linear').id], {});
      await expectCode('E_WRONG_KIND', () => env.engine.evaluate(n, { scale: 'full', precision: 'export' }));
    } });
  }
  cases.push(...semanticCases(impl));
  return cases;
}

export { CaseFailure };
