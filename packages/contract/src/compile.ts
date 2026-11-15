// The one compiler (contract 1.0, design §29). compile(doc) builds the hash-consed graph of a document and names its
// cuts; the viewer, the export, the first print and the agent's what-if (compile(doc ⊕ draft)) all use it.
//
//   1. resolve links (rolls; looks and presets in phase 7) → plain media and stacks
//   2. stage by stage, in pipeline order: resolve the stage's bindings (they read only cuts already compiled), run
//      the medium's fixed chain (scan.density, film.develop, view.adapt, …), then the stage law on its stack
//   3. output: output.display and the document geometry (output.frame)
//
// Masks compile per (mask, stage): geometric components hang off the source (document pixels), range components off
// the cut the mask reads; the feather (mm on the print) becomes document pixels with the print's pitch.
import { Coll, isPlainObject, type Id, type Json, type JsonObject } from '@chromobench/values';
import { callBinding, getBinding, isBindingRef, type FrameFacts } from './bindings.ts';
import {
  cutDef, documentKind, readableCuts, STAGES, type BindingRef, type CutName, type Document, type Entry, type FrameKind, type Media, type OutputSpaceId,
  type Params, type StageName,
} from './document.ts';
import type { Engine } from './engine.ts';
import { ChromobenchError, fail, type Diagnostic } from './errors.ts';
import type { Graph, Node } from './graph.ts';
import { resolveLinks, type LinkContext } from './links.ts';
import { bindArgs, getOp, type OpDef } from './registry.ts';
import { paramsToArgs } from './schema.ts';
import { getLaw, type LawContext } from './stage-laws.ts';

export interface CompileOptions {
  /** Display space of the viewer (output.display.space); default srgb. */
  displaySpace?: OutputSpaceId;
  /** Link resolution: the rolls (and, from phase 7, looks and presets). */
  links?: LinkContext;
  /** Facts for bindings (EXIF via the source info, the roll). */
  facts?: FrameFacts;
  /** Measurements bindings read, by the id of their measure node (see compileMeasured). */
  measurements?: Readonly<Record<string, Json>>;
}

export interface Compiled {
  /** The document compiled: links resolved, bindings replaced by their values. */
  readonly doc: Document;
  /** The named cuts (only those the document's kind has). */
  readonly cuts: Readonly<Partial<Record<CutName, Node>>>;
  /** The display cut. */
  readonly display: Node;
  /** The nodes each entry compiled to (a coalesced run shares one). */
  readonly entries: Readonly<Record<Id, readonly string[]>>;
  readonly warnings: readonly Diagnostic[];
}

/** The media fields that set the pitches: literals, never bound (every stage converts physical sizes with them). */
export const PITCH_FIELDS: readonly string[] = ['stages.scan.medium.umPerPx', 'stages.film.medium.format.longEdge_mm', 'stages.darkroom.medium.magnification'];

const literal = (v: unknown, at: string): number => (typeof v === 'number' ? v : fail('E_BINDING', `${at} sets a pitch and must be a number (not bound)`, { path: at }));

/**
 * The film and print pitches of a (link-resolved) document, µm per document pixel: a scan's umPerPx, or a camera
 * file's film long edge over the source's long side; the print's is the film's times the magnification.
 */
export function pitches(doc: Document, g: Graph): { film: number; paper: number } {
  const st = doc.stages;
  let film: number;
  if (st.scan) film = literal((st.scan.medium as { umPerPx?: unknown }).umPerPx, PITCH_FIELDS[0]!);
  else {
    const s = g.source(doc.source.sha256) ?? fail('E_NO_SOURCE', `source ${doc.source.sha256.slice(0, 12)}… is not open`, { hint: 'engine.open(source) and graph.registerSource(info) first' });
    film = (literal((st.film!.medium as { format?: { longEdge_mm?: unknown } }).format?.longEdge_mm, PITCH_FIELDS[1]!) * 1000) / Math.max(s.width, s.height);
  }
  return { film, paper: film * literal((st.darkroom.medium as { magnification?: unknown }).magnification, PITCH_FIELDS[2]!) };
}

/** A binding that needs a measurement: the measure node to evaluate (CompileOptions.measurements[node.id]). */
export interface BindingNeed { binding: string; cut: CutName; node: Node }

class NeedsMeasurement extends ChromobenchError {
  readonly need: BindingNeed;
  constructor(need: BindingNeed) {
    super({ code: 'E_BINDING', message: `${need.binding} needs the measurement of ${need.cut} (node ${need.node.id.slice(0, 12)}…)`, hint: 'measure it and pass CompileOptions.measurements, or use compileMeasured', valid: [need.node.id] });
    this.need = need;
  }
}

class Compiler {
  readonly cuts: Partial<Record<CutName, Node>> = {};
  readonly entries: Record<Id, string[]> = {};
  readonly warnings: Diagnostic[] = [];
  readonly kind: FrameKind;
  readonly media: Partial<Media> = {};
  private readonly masks = new Map<string, string>();
  private paper = 0;
  readonly doc: Document;
  readonly g: Graph;
  readonly opts: CompileOptions;

  constructor(doc: Document, g: Graph, opts: CompileOptions) {
    this.doc = doc;
    this.g = g;
    this.opts = opts;
    this.kind = documentKind(doc);
  }

  I = (op: string, inputs: readonly string[], args: Readonly<Record<string, unknown>>): string => {
    const r = this.g.intern(op, inputs, args);
    this.warnings.push(...r.warnings);
    return r.node.id;
  };

  setCut(name: CutName, id: string): void {
    this.cuts[name] = this.g.get(id)!;
  }

  /** Replaces every binding reference in a value (params or a medium) by the binding's value. */
  bind(v: unknown, stage: StageName, use: 'medium' | 'binding', at: string): unknown {
    if (isBindingRef(v)) return this.call(v, stage, use, at);
    if (Array.isArray(v)) return v.map((x, i) => this.bind(x, stage, use, `${at}.${i}`));
    if (isPlainObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.bind(x, stage, use, `${at}.${k}`)]));
    return v;
  }

  private call(ref: BindingRef, stage: StageName, use: 'medium' | 'binding', at: string): Json {
    const def = getBinding(ref.bind, ref.version);
    let measured: Json | undefined;
    if (ref.reads !== undefined || def.measure) {
      const reads = ref.reads ?? fail('E_BINDING', `${at}: ${ref.bind} measures a cut; say which in reads`, { path: at });
      if (!readableCuts(stage, this.kind, use).includes(reads)) {
        fail('E_BINDING', `${at}: a binding here may not read ${reads}: only cuts computed before its value is used`, { path: at, valid: readableCuts(stage, this.kind, use) });
      }
      const cut = this.cuts[reads] ?? fail('E_INTERNAL', `${at}: cut ${reads} is not compiled yet`);
      if (def.measure) {
        const node = this.g.intern(def.measure.op, [cut.id], def.measure.args ?? {}).node;
        measured = this.opts.measurements?.[node.id];
        if (measured === undefined) throw new NeedsMeasurement({ binding: `${ref.bind}@${ref.version}`, cut: reads, node });
      }
    }
    return callBinding(ref, this.opts.facts ?? {}, measured);
  }

  medium<S extends StageName>(s: S): Media[S] {
    const m = this.bind(this.doc.stages[s]!.medium, s, 'medium', `stages.${s}.medium`) as Media[S];
    this.media[s] = m;
    return m;
  }

  /** A mask's node for entries of a stage (cached per mask and stage). */
  mask(id: Id, stage: StageName): string {
    const key = `${id}@${stage}`;
    const hit = this.masks.get(key);
    if (hit) return hit;
    const m = Coll.get(this.doc.masks, id) ?? fail('E_DOCUMENT', `unknown mask ${id}`, { path: id, valid: [...this.doc.masks.order] });
    const geom = this.cuts.source!.id;
    const reads: CutName = m.reads === 'stage-input' ? STAGES[stage].input : m.reads;
    const lum = (this.cuts[reads] ?? fail('E_CUT', `mask ${id} reads ${reads}, which is not compiled before the ${stage} stage`, { path: `${id}.reads`, valid: readableCuts(stage, this.kind, 'mask') })).id;
    let v: string | undefined;
    for (const c of Coll.values(m.components)) {
      if (!c.enabled) continue;
      const op = getOp(`mask.${c.kind}`);
      const node = this.I(op.name, [c.kind === 'luminance' ? lum : geom], paramsToArgs(op, this.bind(c.params, stage, 'binding', id) as Params));
      if (v === undefined && c.combine === 'add' && c.amount === 1) {
        v = node; // the empty mask's identity: 0 + (max(0, c) − 0) = c
        continue;
      }
      v ??= this.I('mask.constant', [geom], { value: 0 });
      if (c.amount !== 0) v = this.I('mask.combine', [v], { other: node, mode: c.combine, amount: c.amount });
    }
    v ??= this.I('mask.constant', [geom], { value: 0 });
    if (m.feather_mm > 0) v = this.I('mask.feather', [v], { radius_px: (m.feather_mm * 1000) / this.paper });
    if (m.invert) v = this.I('mask.invert', [v], {});
    this.masks.set(key, v);
    return v;
  }

  /** Binds a stack's params, then runs the stage law on it. */
  stack(s: StageName, input: string): string {
    const st = this.doc.stages[s]!;
    const lawName = STAGES[s].law;
    if (lawName === null) {
      if (st.stack.order.length) fail('E_DOCUMENT', `the ${s} stage takes no entries yet`, { path: `stages.${s}.stack` });
      return input;
    }
    const bound = this.bindStack(st.stack, s);
    const ctx: LawContext = {
      stage: s,
      kind: this.kind,
      media: this.media,
      intern: this.I,
      mask: (id) => this.mask(id, s),
      args: (op: OpDef, params: Params) => {
        // the op's arguments with their defaults (a stored layer may omit a defaulted argument)
        const r = bindArgs(op, paramsToArgs(op, params));
        this.warnings.push(...r.warnings);
        return { ...r.args };
      },
      setCut: (name, node) => this.setCut(name, node),
      note: (entry, node) => (this.entries[entry] ??= []).push(node),
      warn: (d) => this.warnings.push(d),
    };
    return getLaw(lawName).compile(ctx, bound, input);
  }

  private bindStack(stack: Coll<Entry>, s: StageName): Coll<Entry> {
    return Coll.map(stack, (e, id): Entry => {
      if (e.kind === 'group') return { ...e, stack: this.bindStack(e.stack, s) };
      if (e.kind === 'layer') return { ...e, params: this.bind(e.params, s, 'binding', `${id}.params`) as Params };
      return e;
    });
  }

  run(): Compiled {
    const d = this.doc;
    const I = this.I;
    // each medium is bound just before its stage, so its bindings read only cuts compiled before it
    const pitch = pitches(d, this.g);
    this.paper = pitch.paper;
    const src = I('source.open', [], { source: d.source.sha256, encoding: d.source.decode.encoding, umPerPx: pitch.film });
    this.setCut('source', src);
    let neg: string;
    if (this.kind === 'negative-scan') {
      const s = this.medium('scan');
      let n = src;
      if (s.flat) n = I('scan.flatField', [n], { flat: s.flat });
      if (Array.isArray(s.flare) ? s.flare.some((f) => f !== 0) : s.flare) n = I('scan.flare', [n], { flare: s.flare });
      // the roll's base wins over the frame's rebate box (CHB-020 scan.baseT)
      n = I('scan.density', [n], s.baseT ? { baseT: s.baseT } : s.rebate ? { rebate: s.rebate } : {});
      n = this.stack('scan', n);
      this.setCut('scan', n);
      neg = I('invert.dyes', [n], { stock: s.stock, scanner: s.scanner });
    } else {
      const wb = this.medium('scene').whiteBalance;
      let n = I('source.xyz', [src], { mode: wb.mode, temperature_K: wb.temperature_K, tint: wb.tint });
      n = this.stack('scene', n);
      this.setCut('scene', n);
      const f = this.medium('film');
      n = I('capture.expose', [n], { stock: f.stock, exposureEV: f.exposureEV });
      n = I('film.couple', [n], { amount: f.dir.amount, diffusion_um: f.dir.diffusion_um });
      n = I('film.halation', [n], { strength: f.halation.strength });
      n = I('film.develop', [n], { push: f.push, curves: 'precorrected' });
      n = I('film.grain', [n], { amount: f.grain.amount, size_um: f.grain.size_um, seed: f.grain.seed });
      n = this.stack('film', n);
      this.setCut('film', n);
      neg = n;
    }
    this.setCut('negative', neg);
    const dm = this.medium('darkroom');
    const pm = this.medium('print'); // its illuminant is the darkroom's aim view
    const h = this.stack('darkroom', neg);
    this.setCut('darkroom.H', h);
    let v = I('print.develop', [h], { paper: dm.paper, grade: dm.grade });
    v = I('view.reflect', [v], { illuminant: pm.illuminant });
    v = I('view.flare', [v], { flare: d.output.rendering === 'scan-of-print' ? 0 : pm.flare });
    v = I('view.adapt', [v], { to: d.output.white });
    this.setCut('print', v);
    v = this.stack('print', v);
    this.setCut('finished', v);
    const disp = I('output.display', [v], { space: this.opts.displaySpace ?? 'srgb', rendering: d.output.rendering, knee: d.output.display.knee.method });
    const geo = d.geometry;
    const top = I('output.frame', [disp], { orientation: geo.orientation, angle_deg: geo.angle_deg, ...(geo.crop ? { crop: geo.crop } : {}) });
    this.setCut('display', top);
    return Object.freeze({ doc: d, cuts: Object.freeze({ ...this.cuts }), display: this.cuts.display!, entries: Object.freeze({ ...this.entries }), warnings: this.warnings });
  }
}

/** Compiles a document into `g` (hash-consed: unchanged parts are the same nodes after every edit). */
export function compile(doc: Document, g: Graph, opts: CompileOptions = {}): Compiled {
  return new Compiler(resolveLinks(doc, opts.links), g, opts).run();
}

/** The node of a named cut; E_CUT when the name is unknown or the document's kind has no such cut. */
export function cutNode(c: Compiled, name: string): Node {
  const def = cutDef(name) ?? fail('E_CUT', `unknown cut "${name}"`, { valid: Object.keys(c.cuts) });
  return c.cuts[def.name] ?? fail('E_CUT', `a ${documentKind(c.doc)} document has no ${name} cut`, { valid: Object.keys(c.cuts) });
}

/** The node a reader names (the viewer's `cut: 'finished'`, the agent's `d.cut('print')`): compile, then the cut. */
export function cut(doc: Document, g: Graph, name: string, opts: CompileOptions = {}): Node {
  return cutNode(compile(doc, g, opts), name);
}

/**
 * compile, measuring what bindings read: on each missing measurement the measure node is evaluated on the engine
 * (upstream cuts only, so the loop ends) and the compile runs again.
 */
export async function compileMeasured(doc: Document, g: Graph, engine: Pick<Engine, 'adopt' | 'measure'>, opts: CompileOptions = {}): Promise<Compiled> {
  const measurements: Record<string, Json> = { ...opts.measurements };
  for (;;) {
    try {
      return compile(doc, g, { ...opts, measurements });
    } catch (e) {
      if (!(e instanceof NeedsMeasurement)) throw e;
      engine.adopt(g.closure(e.need.node.id));
      measurements[e.need.node.id] = (await engine.measure(e.need.node)).value as unknown as JsonObject;
    }
  }
}
