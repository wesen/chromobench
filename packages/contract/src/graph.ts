// Hash-consed graph of op applications (guide §5.7). Node ids are content hashes, so graphs in other
// realms (DSL worker, GPU worker) rebuild the same ids from NodeDefs: send closure(id), call adopt().
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { canonicalJSON } from '@chromobench/values';
import { DOMAINS, type Domain, type ImageInfo } from './domains.ts';
import { fail, type Diagnostic } from './errors.ts';
import type { Node, NodeDef, NodeInfo, ValueInfo } from './graph-types.ts';
import { acceptsDomain, bindArgs, getOp, nodeSlots, opsProducing, outputChannels, type OpDef } from './registry.ts';
import type { SourceInfo } from './source.ts';
import type { Box } from './spec.ts';

export type { Node, NodeDef, NodeInfo, NodeRef, ValueInfo, FieldSpec } from './graph-types.ts';
/** Canonical JSON (one implementation, in @chromobench/values): the string node ids hash. */
export { canonicalJSON };

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
    if (op.returns === 'Term') fail('E_WRONG_KIND', `${op.name} is a darkroom layer, not a node: the light law compiles it into print.expose and print.combine`, { hint: 'insert it into stages.darkroom.stack and compile the document' });
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
    // Node-typed values (top level or list-item fields) may be Node objects: bind ids, then check each one.
    const { args, warnings } = bindArgs(op, toIds(raw) as Record<string, unknown>);
    const extra: string[] = [];
    for (const slot of nodeSlots(op, args)) {
      const n = this.nodes.get(slot.id) ?? fail('E_NO_NODE', `${op.name}.${slot.at}: unknown node ${String(slot.id).slice(0, 12)}…`);
      if (!isImage(n.info)) fail('E_WRONG_KIND', `${op.name}.${slot.at} needs an image`);
      if (slot.spec.type === 'Mask' && n.info.domain !== 'mask') fail('E_DOMAIN', `${op.name}.${slot.at} needs a mask; got ${n.info.domain}`, { hint: 'build one with mask.*' });
      extra.push(slot.id);
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
    // the pitches (contract 1.0): source.open carries the film's, print.expose derives the print's (× magnification)
    let channels = outputChannels(op, inInfo?.domain);
    if (op.name === 'source.open') {
      const s = this.sources.get(args['source'] as string) ?? fail('E_NO_SOURCE', `source ${String(args['source']).slice(0, 12)}… is not open`, { hint: 'engine.open(source) and graph.registerSource(info) first' });
      width = s.width;
      height = s.height;
      channels = s.channels === 1 ? 3 : s.channels;
      umPerPx = { film: args['umPerPx'] as number };
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
      if (op.name === 'print.expose' && umPerPx.film !== undefined) umPerPx.paper = umPerPx.film * (args['magnification'] as number);
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

/** Node objects (anything with an id) in a raw argument value → their ids, at any depth of arrays and objects. */
function toIds(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(toIds);
  if (v !== null && typeof v === 'object') {
    if ('id' in v && 'op' in v && 'inputs' in v) return (v as { id: string }).id;
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, toIds(x)]));
  }
  return v;
}
