// Hash-consed graph of op applications (guide §5.7). Node ids are content hashes, so graphs in other
// realms (DSL worker, GPU worker) rebuild the same ids from NodeDefs: send closure(id), call adopt().
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { DOMAINS, type Domain, type ImageInfo } from './domains.ts';
import { fail, type Diagnostic } from './errors.ts';
import type { Node, NodeDef, NodeInfo, ValueInfo } from './graph-types.ts';
import type { FrameRecipe, OutputSpaceId } from './recipe.ts';
import { acceptsDomain, bindArgs, getOp, nodeArgs, opsProducing, outputChannels, type OpDef } from './registry.ts';
import type { SourceInfo } from './source.ts';
import type { Box } from './spec.ts';

export type { Node, NodeDef, NodeInfo, NodeRef, ValueInfo, FieldSpec } from './graph-types.ts';

/** Canonical JSON: object keys sorted, arrays in order, numbers via JSON.stringify (−0 → 0). */
export function canonicalJSON(v: unknown): string {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) fail('E_ARG_RANGE', `canonicalJSON: non-finite number ${v}`);
      return JSON.stringify(Object.is(v, -0) ? 0 : v);
    }
    if (v === undefined) return 'null';
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonicalJSON).join(',')}]`;
  if (ArrayBuffer.isView(v)) fail('E_INTERNAL', 'canonicalJSON: typed arrays are not canonical values');
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(o[k])}`).join(',')}}`;
}

export function sha256Hex(s: string | Uint8Array): string {
  return bytesToHex(sha256(typeof s === 'string' ? utf8ToBytes(s) : s));
}

function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

/**
 * nodeId(def) = hex(sha256( u32le(len(op)) ‖ op ‖ u32le(len(J)) ‖ J ‖ input ids as raw 32-byte hashes ))
 * with J = canonicalJSON(args). Length prefixes after goja-cv hashNode (node.go 406–428).
 */
export function nodeId(def: NodeDef, canon: (v: unknown) => string = canonicalJSON): string {
  const op = utf8ToBytes(def.op);
  const j = utf8ToBytes(canon(def.args));
  const parts: Uint8Array[] = [u32le(op.length), op, u32le(j.length), j];
  for (const id of def.inputs) {
    if (!/^[0-9a-f]{64}$/.test(id)) fail('E_NO_NODE', `input "${id}" is not a node id`);
    parts.push(hexToBytes(id));
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  return bytesToHex(sha256(buf));
}

export interface InternResult { node: Node; warnings: Diagnostic[] }

export interface GraphOptions {
  /** Test hook for conformance mutants; never set in production. */
  canonicalJSON?: (v: unknown) => string;
}

function isImage(info: NodeInfo): info is ImageInfo {
  return info.kind === 'Image';
}

function domainList(op: OpDef): string {
  const d = op.domainIn;
  return d === undefined ? 'nothing' : d === 'any' ? 'any image' : Array.isArray(d) ? d.join(' or ') : d;
}

export class Graph {
  private readonly nodes = new Map<string, Node>();
  private readonly sources = new Map<string, SourceInfo>();
  private readonly canon: (v: unknown) => string;

  constructor(opts: GraphOptions = {}) {
    this.canon = opts.canonicalJSON ?? canonicalJSON;
  }

  /** Makes a decoded source known so source.open can infer its size. */
  registerSource(info: SourceInfo): void {
    this.sources.set(info.sha256, info);
  }

  source(sha256: string): SourceInfo | undefined {
    return this.sources.get(sha256);
  }

  get size(): number {
    return this.nodes.size;
  }

  get(id: string): Node | undefined {
    return this.nodes.get(id);
  }

  /** Builds (or finds) the node for op(inputs, raw). Node-typed args become extra inputs. */
  intern(opName: string, inputs: readonly string[], raw: Readonly<Record<string, unknown>> = {}): InternResult {
    const op = getOp(opName);
    const recv = inputs.map((id) => this.nodes.get(id) ?? fail('E_NO_NODE', `unknown input node ${id.slice(0, 12)}…`, { hint: 'adopt its closure first' }));
    if (op.on === 'none') {
      if (recv.length !== 0) fail('E_WRONG_KIND', `${op.name} takes no receiver`);
    } else {
      if (recv.length !== 1) fail('E_WRONG_KIND', `${op.name} takes exactly one receiver`);
      const r = recv[0]!;
      const wantImage = op.on === 'Image' || op.on === 'Mask';
      if (wantImage !== isImage(r.info)) {
        fail('E_WRONG_KIND', `${op.name} needs ${wantImage ? 'an image' : 'a value'}; got ${isImage(r.info) ? 'an image' : 'a value'}`);
      }
      if (isImage(r.info) && !acceptsDomain(op, r.info.domain)) this.domainError(op, r.info.domain);
    }
    // Node-typed args: replace Node objects by ids, check them.
    const rawArgs: Record<string, unknown> = { ...raw };
    for (const a of nodeArgs(op)) {
      const v = rawArgs[a];
      if (v === undefined || v === null) continue;
      const ids = (Array.isArray(v) ? v : [v]).map((x) => (typeof x === 'object' && x !== null && 'id' in x ? (x as { id: string }).id : x));
      rawArgs[a] = Array.isArray(v) ? ids : ids[0];
    }
    const { args, warnings } = bindArgs(op, rawArgs);
    const extra: string[] = [];
    for (const a of nodeArgs(op)) {
      const v = args[a];
      if (v === undefined) continue;
      const spec = op.args[a]!;
      for (const id of (Array.isArray(v) ? v : [v]) as string[]) {
        const n = this.nodes.get(id) ?? fail('E_NO_NODE', `${op.name}.${a}: unknown node ${id.slice(0, 12)}…`);
        if (!isImage(n.info)) fail('E_WRONG_KIND', `${op.name}.${a} needs an image`);
        if (spec.type.startsWith('Mask') && n.info.domain !== 'mask') fail('E_DOMAIN', `${op.name}.${a} needs a mask; got ${n.info.domain}`, { hint: 'build one with mask.*' });
        extra.push(id);
      }
    }
    const def: NodeDef = { op: op.name, inputs: [...inputs, ...extra], args };
    const id = nodeId(def, this.canon);
    const existing = this.nodes.get(id);
    if (existing) return { node: existing, warnings };
    const info = this.infer(op, recv[0], args);
    const node: Node = Object.freeze({ id, op: def.op, inputs: Object.freeze([...def.inputs]) as string[], args, info: Object.freeze(info) });
    this.nodes.set(id, node);
    return { node, warnings };
  }

  private domainError(op: OpDef, got: Domain): never {
    const need = op.domainIn;
    const needs = need === undefined || need === 'any' ? [] : Array.isArray(need) ? need : [need];
    let hint = '';
    for (const d of needs) {
      const p = opsProducing(d).find((o) => acceptsDomain(o, got));
      if (p) {
        hint = `call ${p.name} first`;
        break;
      }
    }
    if (!hint && needs[0]) hint = `ops producing ${needs[0]}: ${opsProducing(needs[0]).map((o) => o.name).join(', ')}`;
    return fail('E_DOMAIN', `${op.name} takes ${domainList(op)}; this input is ${got}`, { hint });
  }

  private infer(op: OpDef, recv: Node | undefined, args: Readonly<Record<string, unknown>>): NodeInfo {
    if (op.returns === 'Value' || op.returns === 'Regions' || op.returns === 'Table') {
      const v: ValueInfo = { kind: 'Value', returns: op.returns, fields: op.fields ?? [] };
      return v;
    }
    const inInfo = recv && isImage(recv.info) ? recv.info : undefined;
    const domain: Domain = op.domainFromArg ? (args[op.domainFromArg] as Domain) : op.domainOut === 'same' ? inInfo!.domain : (op.domainOut as Domain);
    let width: number;
    let height: number;
    let umPerPx: ImageInfo['umPerPx'] = {};
    let channels = outputChannels(op, inInfo?.domain);
    if (op.name === 'source.open') {
      const s = this.sources.get(args['source'] as string) ?? fail('E_NO_SOURCE', `source ${String(args['source']).slice(0, 12)}… is not open`, { hint: 'engine.open(source) and graph.registerSource(info) first' });
      width = s.width;
      height = s.height;
      channels = s.channels === 1 ? 3 : s.channels;
    } else if (op.name === 'source.pattern') {
      width = args['width'] as number;
      height = args['height'] as number;
      const c = args['channels'] as number;
      channels = c === 0 ? DOMAINS[domain].channels : (c as 1 | 3 | 4);
    } else if (op.name === 'darkroom.contactSheet') {
      const n = Math.max(1, (args['frames'] as string[]).length);
      const cols = Math.ceil(Math.sqrt(n));
      width = cols * (args['cell_px'] as number);
      height = Math.ceil(n / cols) * (args['cell_px'] as number);
    } else {
      if (!inInfo) return fail('E_INTERNAL', `${op.name}: no receiver to infer size from`);
      width = inInfo.width;
      height = inInfo.height;
      umPerPx = { ...inInfo.umPerPx };
      if (op.name === 'output.frame') {
        const crop = args['crop'] as Box | undefined;
        if (crop) {
          width = crop.w;
          height = crop.h;
        }
        const o = args['orientation'] as string;
        if (o === 'cw90' || o === 'ccw90' || o === 'transpose' || o === 'transverse') [width, height] = [height, width];
      }
      if (op.domainOut === 'same' && !op.channels) channels = inInfo.channels;
    }
    const info: ImageInfo = { kind: 'Image', domain, width, height, channels, umPerPx };
    return info;
  }

  /** The node and its ancestors, topologically sorted (inputs first). */
  closure(id: string): NodeDef[] {
    const out: NodeDef[] = [];
    const seen = new Set<string>();
    const visit = (nid: string): void => {
      if (seen.has(nid)) return;
      seen.add(nid);
      const n = this.nodes.get(nid) ?? fail('E_NO_NODE', `unknown node ${nid.slice(0, 12)}…`);
      for (const i of n.inputs) visit(i);
      out.push({ op: n.op, inputs: [...n.inputs], args: n.args });
    };
    visit(id);
    return out;
  }

  /**
   * Re-interns definitions built elsewhere (topologically sorted). Receivers are the inputs not
   * referenced by node-typed args. Returns the nodes; their ids must equal the ones recomputed here.
   */
  adopt(defs: readonly NodeDef[]): Node[] {
    const out: Node[] = [];
    for (const d of defs) {
      const op = getOp(d.op);
      const receivers = op.on === 'none' ? [] : d.inputs.slice(0, 1);
      const { node } = this.intern(d.op, receivers, d.args);
      const expected = nodeId(d, this.canon);
      if (node.id !== expected) fail('E_INTERNAL', `adopt: ${d.op} recomputed id ${node.id.slice(0, 12)}… ≠ ${expected.slice(0, 12)}…`);
      out.push(node);
    }
    return out;
  }
}

export interface CompileOptions {
  /** Display space of the viewer (output.display.space); default srgb. */
  displaySpace?: OutputSpaceId;
}

/** Builds the display node of a recipe, taking every recipe-backed argument from the recipe. */
export function compile(r: FrameRecipe, g: Graph, opts: CompileOptions = {}): Node {
  const I = (op: string, inputs: string[], args: Record<string, unknown>): string => g.intern(op, inputs, args).node.id;
  let n = I('source.open', [], { source: r.source.sha256, encoding: r.source.decode.encoding });
  let dyes: string;
  if (r.kind === 'negative-scan') {
    const s = r.scan ?? fail('E_RECIPE', 'negative-scan recipe without scan settings');
    if (s.flat) n = I('scan.flatField', [n], { flat: s.flat });
    if (s.flare) n = I('scan.flare', [n], { flare: s.flare });
    n = I('scan.density', [n], s.rebate ? { rebate: s.rebate } : {});
    if (s.dust.spots.length > 0) n = I('scan.heal', [n], { spots: canonicalJSON(s.dust.spots), method: s.dust.method, marginPx: s.dust.marginPx });
    dyes = I('invert.dyes', [n], { stock: s.stock, scanner: s.scanner });
  } else {
    const c = r.capture ?? fail('E_RECIPE', 'digital-raw recipe without capture settings');
    n = I('source.xyz', [n], { mode: c.whiteBalance.mode, temperature_K: c.whiteBalance.temperature_K, tint: c.whiteBalance.tint });
    n = I('capture.expose', [n], { stock: c.stock, exposureEV: c.exposureEV });
    n = I('film.couple', [n], { amount: c.development.dir.amount, diffusion_um: c.development.dir.diffusion_um });
    n = I('film.halation', [n], { strength: c.development.halation.strength });
    n = I('film.develop', [n], { push: c.development.push, curves: 'precorrected' });
    dyes = I('film.grain', [n], { amount: c.development.grain.amount, size_um: c.development.grain.size_um, seed: c.development.grain.seed });
  }
  const p = r.print;
  const e = p.enlarger;
  const exposeArgs = (time_s: number, filtration = e.filtration): Record<string, unknown> => ({
    paper: p.paper, mode: e.mode, lamp: e.lamp, filtration, time_s, fstop: e.fstop, ...(e.magnification !== null ? { magnification: e.magnification } : {}),
    aim: p.aim, aimView: r.view.illuminant,
  });
  let x = I('print.expose', [dyes], exposeArgs(e.time_s));
  const extra = p.exposures.filter((ex) => ex.enabled);
  if (extra.length > 0) {
    const exposures: string[] = [];
    const masks: string[] = [];
    const modes: string[] = [];
    for (const ex of extra) {
      const t = ex.time_s ?? (ex.stops === null ? e.time_s : ex.kind === 'dodge' ? e.time_s * (1 - 2 ** -ex.stops) : e.time_s * (2 ** ex.stops - 1));
      exposures.push(I('print.expose', [dyes], exposeArgs(Math.max(t, 0.1), ex.filtration ?? e.filtration)));
      const spec = ex.mask ? r.masks[ex.mask] : undefined;
      if (ex.mask && !spec) fail('E_RECIPE', `exposure ${ex.id}: unknown mask ${ex.mask}`);
      const maskNodes = spec ? g.adopt(spec.nodes) : [];
      const m = maskNodes.length ? maskNodes[maskNodes.length - 1]!.id : I('mask.luminance', [x], { above: 0, below: 1, softness: 0 });
      masks.push(m);
      modes.push(ex.kind === 'dodge' ? 'subtract' : 'add');
    }
    x = I('print.combine', [x], { exposures, masks, modes });
  }
  x = I('print.lights', [x], { logH: p.lights.logH });
  if (p.preflash > 0) x = I('print.preflash', [x], { amount: p.preflash });
  const pd = I('print.develop', [x], { paper: p.paper, grade: p.grade });
  let v = I('view.reflect', [pd], { illuminant: r.view.illuminant });
  v = I('view.flare', [v], { flare: r.view.output.rendering === 'scan-of-print' ? 0 : r.view.flare });
  v = I('view.adapt', [v], { to: r.view.output.white });
  const clarity = r.finishing.values['clarity'] ?? 0;
  if (clarity !== 0) v = I('finishing.clarity', [v], { amount: clarity, radius_px: r.finishing.values['clarity_radius_px'] ?? 40 });
  const d = I('output.display', [v], { space: opts.displaySpace ?? 'srgb', rendering: r.view.output.rendering, knee: r.view.output.display.knee.method });
  const orientation = r.scan?.orientation ?? 'none';
  const crop = r.scan?.crop ?? null;
  return g.intern('output.frame', [d], crop ? { orientation, crop } : { orientation }).node;
}
