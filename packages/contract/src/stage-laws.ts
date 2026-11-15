// Stage laws (contract 1.0, design §22, Decision D2): a law says how a stage's entries combine, what amount and blend
// mean there and which groups exist, and compiles a stack into graph nodes. One copy of every law: the viewer, the
// export, the first print and the agent's what-if all compile through these.
//
//   light      (darkroom)     contributions add in H, modulators multiply; amount scales; order-free; pass groups
//   composite  (scene, print) entries apply bottom to top; amount is opacity; blend modes; pass and isolated groups
//   repair     (scan)         entries replace pixels in order; amount is opacity; no blend; pass groups
//
// Structural identities (design §29): a disabled entry, an amount of 0 and an identity layer produce no node; a pass
// group at amount 1 without a mask produces no node of its own. Adjacent coalescible layers (heal, clone) become one
// node (design §23).
import { canonicalJSON, Coll, type Id } from '@chromobench/values';
import type { BlendMode, Entry, EntryBlend, FrameKind, Layer, LawName, Media, StageName } from './document.ts';
import { fail, type Diagnostic } from './errors.ts';
import { getOp, opEncoding, type OpDef, type OpEncoding } from './registry.ts';
import type { CutName, Params } from './document.ts';

/** The rules a law imposes on entries (validation reads them; compile relies on them). */
export interface LawRules {
  /** Layers may carry a blend mode other than normal. */
  blend: boolean;
  /** Group kinds: 'pass' (children act on the backdrop), 'isolated' (children's result blended as one layer). */
  groups: readonly ('pass' | 'isolated')[];
  /** 'scale': amount multiplies light and density; 'opacity': amount mixes. */
  amount: 'scale' | 'opacity';
  amountRange: readonly [number, number];
  /** 'free': the stack order only arranges the panel (a sum); 'stack': bottom to top. */
  order: 'free' | 'stack';
  /** Adjacent layers of a coalescible op merge into one node. */
  coalesce: boolean;
}

/** What a law's compile function may use: the graph (through intern), the stage's masks, the media, the cuts. */
export interface LawContext {
  readonly stage: StageName;
  readonly kind: FrameKind;
  readonly media: Partial<Media>;
  /** g.intern(op, inputs, args).node.id; warnings are collected. */
  intern(op: string, inputs: readonly string[], args: Readonly<Record<string, unknown>>): string;
  /** The node of a mask of the document, compiled for this stage. */
  mask(id: Id): string;
  /** Layer params → node args: list Colls → arrays in order, defaults filled, checked (bindings are already resolved). */
  args(op: OpDef, params: Params): Record<string, unknown>;
  /**
   * The node in another encoding of the stage (composite.encode; the node itself when it is in it already). A
   * conversion of a conversion converts the original node, so no round trip is ever built (design §22, §29).
   */
  encode(node: string, to: OpEncoding): string;
  /** The encoding a node of this stage is in. */
  encodingOf(node: string): OpEncoding;
  setCut(name: CutName, node: string): void;
  /** Records the node an entry compiled to (explain, the stack panel's node ids). */
  note(entry: Id, node: string): void;
  warn(d: Diagnostic): void;
}

export interface StageLaw extends LawRules {
  readonly name: LawName;
  readonly doc: string;
  /** Compiles a stack (resolved: no links, no bindings) on its input node; returns the output node. */
  compile(ctx: LawContext, stack: Coll<Entry>, input: string): string;
}

const LAWS = new Map<LawName, StageLaw>();

/** Registers a law (design §22: "a law is registered like an op, with its compile function and its properties"). */
export function defineLaw(name: LawName, rules: LawRules & { doc: string }, compile: StageLaw['compile']): StageLaw {
  if (LAWS.has(name)) fail('E_INVALID_OP_DEF', `defineLaw(${name}): duplicate law`);
  const law: StageLaw = Object.freeze({ name, ...rules, groups: Object.freeze([...rules.groups]), amountRange: Object.freeze([...rules.amountRange]) as unknown as readonly [number, number], compile });
  LAWS.set(name, law);
  return law;
}

export function getLaw(name: LawName): StageLaw {
  return LAWS.get(name) ?? fail('E_INTERNAL', `no law ${name}`);
}

export function allLaws(): StageLaw[] {
  return [...LAWS.values()];
}

// ---- light -----------------------------------------------------------------------------------------------------

interface Weighted { id: Id; layer: Layer; amount: number; masks: Id[] }

/** Enabled layers with their groups' amounts and masks multiplied in (a card held over several exposures). */
function flatten(stack: Coll<Entry>, amount = 1, masks: Id[] = [], out: Weighted[] = []): Weighted[] {
  for (const [id, e] of Coll.entries(stack)) {
    if (!e.enabled) continue;
    const a = amount * e.amount;
    const ms = e.mask ? [...masks, e.mask] : masks;
    if (e.kind === 'group') flatten(e.stack, a, ms, out);
    else if (e.kind === 'layer') out.push({ id, layer: e, amount: a, masks: ms });
    else fail('E_INTERNAL', `link ${id} reached the light law unresolved`);
  }
  return out;
}

function findMain(stack: Coll<Entry>): Layer | undefined {
  for (const e of Coll.values(stack)) {
    if (e.kind === 'layer' && e.op === 'expose') return e;
    if (e.kind === 'group') {
      const m = findMain(e.stack);
      if (m) return m;
    }
  }
  return undefined;
}

/** Seconds of a burn, dodge or flash: time_s, or stops relative to the main time (dodge t(1 − 2^−s), else t(2^s − 1)). */
export function termSeconds(op: string, p: Readonly<Record<string, unknown>>, tMain: number): number {
  if (typeof p['time_s'] === 'number') return p['time_s'];
  const s = p['stops'] as number;
  return op === 'dodge' ? tMain * (1 - 2 ** -s) : tMain * (2 ** s - 1);
}

function maskProduct(ctx: LawContext, ids: readonly Id[]): string | undefined {
  let m: string | undefined;
  for (const id of ids) {
    const n = ctx.mask(id);
    m = m === undefined ? n : ctx.intern('mask.combine', [m], { other: n, mode: 'intersect', amount: 1 });
  }
  return m;
}

export const LIGHT = defineLaw('light', {
  blend: false, groups: ['pass'], amount: 'scale', amountRange: [0, 16], order: 'free', coalesce: false,
  doc: 'Darkroom: every entry is light on the paper (expose, burn, dodge, flash, preflash) or a filter in its path (densityMask, filter); they add in linear H and multiply transmissions, so the order is free. Amount scales a contribution\'s light and a modulator\'s density; groups multiply their children\'s amounts and masks.',
}, (ctx, stack, input) => {
  const main = findMain(stack) ?? fail('E_DOCUMENT', 'the darkroom has no main exposure (an expose layer with id main)', { path: 'stages.darkroom.stack' });
  const dm = ctx.media.darkroom!;
  const view = ctx.media.print!;
  const mp = ctx.args(getOp('expose'), main.params);
  const tMain = mp['time_s'] as number;
  const expose = (time_s: number, filtration: unknown): string => ctx.intern('print.expose', [input], {
    paper: dm.paper, mode: dm.mode, lamp: dm.lamp, filtration, time_s, fstop: mp['fstop'], magnification: dm.magnification, aim: dm.aim, aimView: view.illuminant,
  });
  const x = expose(tMain, mp['filtration']);
  ctx.setCut('darkroom.main', x);
  let mainAmount = 0;
  let mainMask: string | undefined;
  const terms: Record<string, unknown>[] = [];
  const densities: Record<string, unknown>[] = [];
  const filters: Record<string, unknown>[] = [];
  const preflash: Record<string, unknown>[] = [];
  for (const t of flatten(stack)) {
    const op = getOp(t.layer.op);
    const p = ctx.args(op, t.layer.params);
    if (op.name === 'expose') {
      mainAmount = t.amount;
      mainMask = maskProduct(ctx, t.masks);
      ctx.note(t.id, x);
      continue;
    }
    if (t.amount === 0 || op.identity?.(p)) continue;
    const mask = maskProduct(ctx, t.masks);
    const w = { amount: t.amount, ...(mask ? { mask } : {}) };
    switch (op.name) {
      case 'burn': case 'dodge': case 'flash': {
        const node = expose(Math.max(termSeconds(op.name, p, tMain), 0.1), op.name === 'dodge' ? mp['filtration'] : (p['filtration'] ?? mp['filtration']));
        const role = op.name === 'flash' ? (p['through'] === 'open' ? 'flash-open' : 'flash-base') : op.name;
        terms.push({ role, image: node, ...w });
        ctx.note(t.id, node);
        break;
      }
      case 'densityMask': {
        const d = ctx.intern('print.densityMask', [x], { gamma: p['gamma'], radius_um: p['radius_um'], polarity: p['polarity'] });
        densities.push({ image: d, ...w });
        ctx.note(t.id, d);
        break;
      }
      case 'filter': filters.push({ logH: p['logH'], ...w }); break;
      case 'preflash': preflash.push({ fraction: p['fraction'], ...w }); break;
      default: fail('E_INTERNAL', `the light law has no rule for ${op.name}`);
    }
  }
  if (!terms.length && !densities.length && !filters.length && !preflash.length && mainAmount === 1 && mainMask === undefined) return x;
  return ctx.intern('print.combine', [x], { mainAmount, ...(mainMask ? { mainMask } : {}), terms, densities, filters, preflash });
});

// ---- composite and repair ----------------------------------------------------------------------------------------

/**
 * The composite law's mix of one entry (design §4, §22): out = back + a·m·(B(back, top) − back), computed in the
 * encoding of the entry's result (a layer's op encoding, whatever a group's last child left); a blend other than
 * normal needs a working encoding, so a result in the stage's XYZ is mixed in linear RGB. No node when the entry is
 * the identity (amount 1, no mask, normal): the result goes on in its own encoding.
 */
function mix(ctx: LawContext, back: string, top: string, amount: number, mask: Id | null, blend: BlendMode): string {
  if (top === back || amount === 0) return back;
  if (amount === 1 && mask === null && blend === 'normal') return top;
  let enc = ctx.encodingOf(top);
  if (blend !== 'normal' && enc === 'stage') enc = 'linear';
  const b = ctx.encode(back, enc);
  return ctx.intern('composite.mix', [b], { top: ctx.encode(top, enc), amount, ...(mask ? { mask: ctx.mask(mask) } : {}), blend });
}

const groupBlend = (b: EntryBlend): BlendMode => (b === 'pass' ? 'normal' : b);

/** A coalescible layer joins a run: no mask, normal blend, and its amount folds exactly into its items' opacity. */
function joins(op: OpDef, e: Layer, args: Record<string, unknown>): boolean {
  const c = op.coalesce;
  return !!c && e.mask === null && e.blend === 'normal' && (e.amount === 1 || (args[c.list] as unknown[]).length <= 1);
}

function scaled(op: OpDef, args: Record<string, unknown>, amount: number): Record<string, unknown>[] {
  const { list, opacity } = op.coalesce!;
  return (args[list] as Record<string, unknown>[]).map((it) => (amount === 1 ? it : { ...it, [opacity]: (it[opacity] as number) * amount }));
}

const others = (op: OpDef, args: Record<string, unknown>): string => canonicalJSON(Object.fromEntries(Object.entries(args).filter(([k]) => k !== op.coalesce!.list)));

function compileOrdered(ctx: LawContext, stack: Coll<Entry>, input: string): string {
  let v = input;
  const live = Coll.entries(stack).filter(([, e]) => e.enabled && e.amount !== 0);
  for (let i = 0; i < live.length; i++) {
    const [id, e] = live[i]!;
    if (e.kind === 'link') fail('E_INTERNAL', `link ${id} reached the ${ctx.stage} law unresolved`);
    if (e.kind === 'group') {
      const top = compileOrdered(ctx, e.stack, v);
      v = mix(ctx, v, top, e.amount, e.mask, groupBlend(e.blend));
      ctx.note(id, v);
      continue;
    }
    const op = getOp(e.op);
    const args = ctx.args(op, e.params);
    if (op.identity?.(args)) continue;
    if (joins(op, e, args)) {
      // a run of adjacent layers of the same op (and the same other args) is one node: their items in order
      const items = scaled(op, args, e.amount);
      const ids = [id];
      const key = others(op, args);
      while (i + 1 < live.length) {
        const [nid, n] = live[i + 1]!;
        if (n.kind !== 'layer' || n.op !== e.op) break;
        const nargs = ctx.args(op, n.params);
        if (!joins(op, n, nargs) || others(op, nargs) !== key) break;
        i++;
        if (op.identity?.(nargs)) continue;
        items.push(...scaled(op, nargs, n.amount));
        ids.push(nid);
      }
      v = ctx.intern(op.name, [ctx.encode(v, opEncoding(op, args))], { ...args, [op.coalesce!.list]: items });
      for (const x of ids) ctx.note(x, v);
      continue;
    }
    // the layer's input in its op's encoding (the compiler inserts the conversion; one encoding fuses)
    const vin = ctx.encode(v, opEncoding(op, args));
    const top = ctx.intern(op.name, [vin], args);
    v = mix(ctx, vin, top, e.amount, e.mask, e.blend === 'pass' ? 'normal' : e.blend);
    ctx.note(id, v);
  }
  return v;
}

/** A composite or repair stack: entries in order, the result back in the stage's own encoding for the next stage. */
const compileStack = (ctx: LawContext, stack: Coll<Entry>, input: string): string => ctx.encode(compileOrdered(ctx, stack, input), 'stage');

export const COMPOSITE = defineLaw('composite', {
  blend: true, groups: ['pass', 'isolated'], amount: 'opacity', amountRange: [0, 1], order: 'stack', coalesce: true,
  doc: 'Scene and print: entries apply bottom to top, v ← v + a·m·(B(v, A(v)) − v) in the op\'s encoding (XYZ, linear RGB or OkLab; the compiler converts between them). Amount is opacity. A pass group\'s children act on the backdrop and the group fades their total effect; an isolated group blends its children\'s result as one layer with its mode.',
}, compileStack);

export const REPAIR = defineLaw('repair', {
  blend: false, groups: ['pass'], amount: 'opacity', amountRange: [0, 1], order: 'stack', coalesce: true,
  doc: 'Scan: entries apply in order, each replacing pixels within its geometry (heal and clone spots on the negative). Amount is opacity; no blend modes.',
}, compileStack);
