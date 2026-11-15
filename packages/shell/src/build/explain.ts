// explain: every node, kit and app renders as an indented outline. Deterministic: stable order, call sites only
// with { at: true }, lambdas shown by meaning (a bind by its path, a command reference by its id, other τ lambdas
// as τ). With { live: state } τ props are evaluated against that state: the answer to "what is on screen?".

/* eslint-disable @typescript-eslint/no-explicit-any */
import { formatDiag, type Diag, Diagnostics, where } from '../core/diag.ts';
import { bindingPath } from '../core/track.ts';
import { pathStr } from '../core/util.ts';
import { chordLabel } from '../core/keys.ts';
import { Store } from '../core/store.ts';
import { isNode, type NodeData } from '../ir/node.ts';
import { commonSlots, type SlotTable } from '../ir/slots.ts';
import type { FormSpec } from '../ir/forms.ts';
import type { Fragment, Kit, PassDef, UiIR } from './types.ts';
import type { FragmentIndex } from './fragments.ts';

export interface ExplainOpts {
  at?: boolean;
  /** evaluate τ props against this state */
  live?: unknown;
  forms?: Map<string, FormSpec>;
  fragments?: FragmentIndex;
  /** resolve panel references (an app) */
  panels?: Map<string, NodeData>;
  depth?: number;
  /** bind paths: a store over the initial state (probe mode) */
  store?: Store;
}

const probeStore = new Store({});
const SKIP = new Set(['id', 'title', 'label', 'min', 'max', 'value']);
const short = (v: unknown, max = 48): string => {
  let s: string;
  try {
    s = typeof v === 'string' ? JSON.stringify(v) : typeof v === 'number' || typeof v === 'boolean' || v == null ? String(v) : Array.isArray(v) ? `[${v.map(x => (typeof x === 'string' ? x : isNode(x) ? x.$ : typeof x === 'object' ? '{…}' : String(x))).join(', ')}]` : typeof v === 'object' ? `{${Object.keys(v as object).join(', ')}}` : String(v);
  } catch {
    s = '?';
  }
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
};
const refOf = (v: unknown): string => (typeof v === 'string' ? v : Array.isArray(v) ? `${v[0]}(${v.slice(1).map(x => short(x, 16)).join(', ')})` : 'ρ');

export function bindPathOf(v: unknown, store?: Store): string {
  if (typeof v === 'string') return v;
  if (typeof v !== 'function') return '?';
  const r = bindingPath(store || probeStore, v as (s: any) => unknown, { probe: true });
  return r.path ? pathStr(r.path) : '?';
}

function evalLive(v: unknown, state: unknown): string {
  try {
    return short((v as (s: unknown) => unknown)(state));
  } catch (e) {
    return `⚠ ${(e as Error)?.message ?? e}`;
  }
}

function propWords(n: NodeData, slots: SlotTable, o: ExplainOpts): { words: string[]; blocks: [string, NodeData][] } {
  const words: string[] = [];
  const blocks: [string, NodeData][] = [];
  const p = n.props;
  for (const k of Object.keys(p).sort()) {
    const v = p[k];
    if (v === undefined || SKIP.has(k)) continue;
    const t = slots[k]?.time;
    if (isNode(v)) {
      blocks.push([k, v]);
      continue;
    }
    if (k === 'cases' || k === 'tabs') {
      if (v && typeof v === 'object') for (const [ck, cv] of Object.entries(v)) if (isNode(cv)) blocks.push([`${k}.${ck}`, cv]);
      continue;
    }
    if (k === 'overlays' && Array.isArray(v)) {
      words.push(`overlays: ${v.map((x: any) => x?.kind ?? '?').join(', ')}`);
      continue;
    }
    if (t === 'bind' || (k === 'select' && v && typeof v === 'object' && (v as any).bind)) {
      const b = k === 'select' ? (v as any).bind : v;
      words.push(`${k === 'bind' ? 'bind' : k} ${bindPathOf(b, o.store)}${o.live !== undefined ? ` = ${evalLive(typeof b === 'function' ? b : (s: any) => s, o.live)}` : ''}`);
      continue;
    }
    if (t === 'ρ') {
      words.push(`${k} ${refOf(v)}`);
      continue;
    }
    if (t === 'θ' || t === 'ƒ') {
      words.push(`${k} ${t}`);
      continue;
    }
    if (typeof v === 'function') {
      words.push(o.live !== undefined && t === 'τ' ? `${k} ${evalLive(v, o.live)}` : `${k} τ`);
      continue;
    }
    if (v === true) words.push(k);
    else if (v !== false) words.push(`${k} ${short(v)}`);
  }
  return { words, blocks };
}

const titleOf = (n: NodeData, o: ExplainOpts): string => {
  const t = n.props['title'] ?? n.props['label'] ?? n.props['value'];
  if (t === undefined) return '';
  if (typeof t === 'function') return o.live !== undefined ? ` ${evalLive(t, o.live)}` : ' τ';
  if (isNode(t)) return '';
  return ` ${short(t)}`;
};

/** one node and its subtree */
export function explainNode(n: NodeData, o: ExplainOpts = {}, indent = ''): string {
  const depth = o.depth ?? 0;
  if (depth > 60) return indent + '…';
  const slots: SlotTable = { ...commonSlots, ...(o.forms?.get(n.$)?.slots || {}) };
  let head = n.$;
  if (n.props['id'] != null && n.$ !== 'text') head += ' ' + String(n.props['id']);
  if (n.$ === 'slider' || (n.$ === 'number' && n.props['min'] !== undefined)) head += ` ${n.props['min'] ?? ''}…${n.props['max'] ?? ''}`;
  head += titleOf(n, o);
  const { words, blocks } = propWords(n, slots, o);
  if (words.length) head += '  ' + words.join('  ');
  for (const f of o.fragments?.byTarget.get(n.$) || []) {
    if (f.spec.explain && (!f.spec.when || f.spec.when(n))) {
      const x = f.spec.explain(n);
      if (x) head += `  ${x}`;
    }
  }
  const spec = o.forms?.get(n.$);
  if (spec?.explain) {
    const x = spec.explain(n);
    if (x) head += `  ${x}`;
  }
  if (o.at && n.at) head += `   @${where(n.at)}`;
  const lines = [indent + head];
  const sub = { ...o, depth: depth + 1 };
  if (n.$ === 'panelref' && o.panels?.has(String(n.props['id']))) {
    const target = o.panels.get(String(n.props['id']))!;
    lines.push(explainNode(target, sub, indent + '  ').replace(/^(\s*)panel/, '$1→ panel'));
  }
  for (const [k, b] of blocks) {
    lines.push(`${indent}  ${k}:`);
    lines.push(explainNode(b, sub, indent + '    '));
  }
  for (const k of n.kids) lines.push(isNode(k) ? explainNode(k, sub, indent + '  ') : `${indent}  ${short(k)}`);
  return lines.join('\n');
}

export function explainKit(k: Kit): string {
  const d = k.def;
  const lines = [`kit ${k.name}${d.version ? '@' + d.version : ''}${d.requires.length ? ` (requires ${d.requires.map(r => (typeof r === 'string' ? r : r.name)).join(', ')})` : ''}`];
  if (d.state.length) lines.push(`  state ${d.state.map(s => s.key + (s.view === true ? ' (view)' : Array.isArray(s.view) ? ` (view: ${s.view.join(', ')})` : '')).join(', ')}`);
  if (d.mounts.length) lines.push(`  mounts ${d.mounts.map(r => r.prefix + (r.keyDepth ? '.*'.repeat(r.keyDepth) : '') + (r.kind ? ` (${r.kind})` : '')).join(', ')}`);
  if (d.forms.length) lines.push(`  forms ${d.forms.map(f => f.name).join(', ')}`);
  for (const f of d.fragments) lines.push(`  fragment ${f.target}: ${Object.keys(f.spec.methods || {}).map(m => '.' + m + '()').join(' ')}${Object.keys(f.spec.slots || {}).length ? ' slots ' + Object.keys(f.spec.slots!).join(', ') : ''}`);
  if (d.commands.length) lines.push(`  commands ${d.commands.map(c => c.id).join(', ')}`);
  for (const kd of d.keys) lines.push(`  keys ${kd.scope}: ${Object.entries(kd.map).map(([c, t]) => `${c} → ${refOf(t)}`).join(', ')}`);
  if (d.tools.length) lines.push(`  tools ${d.tools.map(t => t.id).join(', ')}`);
  for (const p of d.passes) lines.push(`  ${explainPass(p)}`);
  if (d.docs.length) lines.push(`  docs: ${d.docs[0]!.split('\n')[0]}`);
  return lines.join('\n');
}

export const explainPass = (p: PassDef): string => `pass ${p.name} on ${p.on}${p.after.length ? ` after ${p.after.join(', ')}` : ''}${p.before.length ? ` before ${p.before.join(', ')}` : ''}`;
export const explainFragment = (f: Fragment): string => `fragment ${f.target}${f.source ? ` (kit ${f.source})` : ''}: ${Object.keys(f.spec.methods || {}).map(m => '.' + m + '()').join(' ')}`;

export interface AppSummary {
  commands: number;
  bindings: number;
  scopes: number;
  passes: number;
  diagnostics: Diagnostics;
  commandRows?: { id: string; label: string; chord?: string | undefined; source?: string | undefined; menu?: string | undefined }[];
  platform?: { mac: boolean };
}

/** the whole app: header, modules with their regions, the program's commands, a summary line */
export function explainApp(ir: UiIR, sum: AppSummary, o: ExplainOpts = {}): string {
  const kits = ir.kits.map(k => `${k.name}${k.version ? '@' + k.version : ''}${k.requires.length ? ` (requires ${k.requires.join(', ')})` : ''}`);
  const out = [`shell ${JSON.stringify(ir.name)} · theme ${ir.theme ?? 'craftkit'} · kits: ${kits.length ? kits.join(', ') : 'none'}`];
  const opts: ExplainOpts = { ...o, forms: ir.forms, panels: ir.panels };
  for (const m of ir.modules) {
    out.push(`module ${m.id} ${JSON.stringify(m.label)}${m.key ? ` key ${m.key}` : ''}${m.stages?.length ? ` stages ${m.stages.join(', ')}` : ''}`);
    for (const side of ['top', 'left', 'center', 'right', 'bottom', 'toolbar'] as const) {
      const r = m.regions[side];
      if (!r) continue;
      const body = explainNode(r, opts, '');
      const [first, ...rest] = body.split('\n');
      out.push(`  ${side.padEnd(7)}${first}`);
      for (const l of rest) out.push(`  ${' '.repeat(7)}${l}`);
    }
  }
  if (sum.commandRows?.length) {
    out.push('commands');
    for (const c of sum.commandRows) out.push(`  ${c.id} ${JSON.stringify(c.label)}${c.menu ? ` (${c.menu})` : ''}${c.chord ? ` ${chordLabel(c.chord, sum.platform)}` : ''}${c.source ? ` ← ${c.source}` : ''}`);
  }
  if (ir.tools.size) out.push(`tools ${[...ir.tools.values()].map(t => t.id + (t.key ? ` (${t.key})` : '')).join(', ')}`);
  const D = sum.diagnostics;
  out.push(`commands ${sum.commands} · keys ${sum.bindings} in ${sum.scopes} scopes · tools ${ir.tools.size} · passes ${sum.passes} · diagnostics ${D.summary()}`);
  return out.join('\n');
}

export function explainDiags(list: Iterable<Diag>, o: { at?: boolean } = {}): string {
  return [...list].map(d => formatDiag(d, o)).join('\n');
}
