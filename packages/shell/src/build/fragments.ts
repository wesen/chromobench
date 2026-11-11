// Fragments: extend a form (or the shell/module builders, or a library's extensible kind) with methods, props and
// slots. They install into one build (usually through a kit), never onto global prototypes: a variant without the
// kit sees none of them.
//
// Method calls resolve late: a node records a call it cannot answer yet ({ name, args, at }); the `normalize`
// pass applies pending calls once every kit is in. A call no fragment provides is CK-X120 with suggestions from
// the receiver; a method whose `when` refuses this node is CK-X121; two fragments adding the same method or slot
// to one target is CK-X110, naming both kits and both call sites.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { site, type Diagnostics } from '../core/diag.ts';
import { suggest } from '../core/util.ts';
import { isNode, mapTree, rebuildNode, type NodeData } from '../ir/node.ts';
import { commonSlots, slot as mkSlot, type Slot, type SlotTable, type Time } from '../ir/slots.ts';
import type { FormSpec } from '../ir/forms.ts';
import type { Fragment, FragmentSpec } from './types.ts';

/** A target: a form name, a form constructor (ck.ui.slider), an extensible kind, or 'shell' / 'module'. */
export type FragmentTarget = string | { form: string } | { extensible: string } | ((...a: any[]) => any);

export function targetName(t: FragmentTarget): string {
  if (typeof t === 'string') return t;
  if (typeof t === 'function' && typeof (t as any).form === 'string') return (t as any).form;
  if (t && typeof t === 'object' && 'form' in t) return t.form;
  if (t && typeof t === 'object' && 'extensible' in t) return 'ext:' + t.extensible;
  throw new TypeError('ck.fragment(target, spec): target is a form name, a form constructor, an extensible kind, or "shell" / "module"');
}

export function fragment(target: FragmentTarget, spec: FragmentSpec): Fragment {
  return { kind: 'fragment', target: targetName(target), spec, at: site() };
}
export const isFragment = (v: unknown): v is Fragment => !!v && typeof v === 'object' && (v as Fragment).kind === 'fragment';

const who = (f: Fragment): string => `${f.source ? `kit ${f.source}` : 'the program'}${f.at ? ` (${f.at.file}:${f.at.line})` : ''}`;

/** Methods and slots by target, with conflicts reported (X110). */
export interface FragmentIndex {
  /** target → method name → fragments (several when their `when` predicates split the nodes) */
  methods: Map<string, Map<string, Fragment[]>>;
  /** target → slot name → fragment */
  slots: Map<string, Map<string, Fragment>>;
  byTarget: Map<string, Fragment[]>;
}
export function indexFragments(frags: Fragment[], D: Diagnostics): FragmentIndex {
  const methods = new Map<string, Map<string, Fragment[]>>();
  const slots = new Map<string, Map<string, Fragment>>();
  const byTarget = new Map<string, Fragment[]>();
  const seen = new Set<Fragment>();
  for (const f of frags) {
    if (seen.has(f)) continue;
    seen.add(f);
    (byTarget.get(f.target) || byTarget.set(f.target, []).get(f.target)!).push(f);
    const mt = methods.get(f.target) || methods.set(f.target, new Map()).get(f.target)!;
    for (const name of Object.keys(f.spec.methods || {})) {
      const list = mt.get(name) || mt.set(name, []).get(name)!;
      const prev = list.find(x => x !== f && !(x.spec.when && f.spec.when));
      if (prev) {
        D.error('CK-X110', `Two fragments add .${name}() to ${f.target}`, {
          at: f.at,
          facts: [`first: ${who(prev)}`, `again: ${who(f)}`],
          fix: 'Rename one of the methods, or give the fragments `when` predicates that do not overlap.',
          source: f.source ?? 'shell',
        });
        continue;
      }
      if (!list.includes(f)) list.push(f);
    }
    const st = slots.get(f.target) || slots.set(f.target, new Map()).get(f.target)!;
    for (const name of [...Object.keys(f.spec.slots || {}), ...Object.keys(f.spec.props || {})]) {
      const prev = st.get(name);
      const isList = Array.isArray(f.spec.slots?.[name]);
      if (prev && prev !== f && !isList) {
        D.error('CK-X110', `Two fragments add the slot '${name}' to ${f.target}`, {
          at: f.at,
          facts: [`first: ${who(prev)}`, `again: ${who(f)}`],
          fix: 'Rename one of the slots.',
          source: f.source ?? 'shell',
        });
        continue;
      }
      if (!prev) st.set(name, f);
    }
  }
  return { methods, slots, byTarget };
}

/** Add fragment slots and props to a copy of the form table. */
export function extendForms(forms: Map<string, FormSpec>, idx: FragmentIndex): Map<string, FormSpec> {
  const out = new Map(forms);
  for (const [target, fr] of idx.byTarget) {
    const base = out.get(target);
    if (!base) continue;
    const slots: Record<string, Slot<unknown, Time>> = { ...base.slots };
    for (const f of fr) {
      for (const [k, v] of Object.entries(f.spec.slots || {})) slots[k] = Array.isArray(v) ? (slots[k] ?? mkSlot.build<unknown[]>(undefined, true)) : v;
      for (const [k, v] of Object.entries(f.spec.props || {})) slots[k] = { time: v.time ?? 'β', ...(v.doc ? { doc: v.doc } : {}) } as Slot<unknown, Time>;
    }
    out.set(target, { ...base, slots });
  }
  return out;
}

const methodNames = (idx: FragmentIndex, target: string): string[] => [...(idx.methods.get(target)?.keys() ?? [])];

/** Apply pending fragment calls in one tree (and fragment prop defaults). */
export function applyCalls(root: NodeData, idx: FragmentIndex, forms: Map<string, FormSpec>, D: Diagnostics, where: string): NodeData {
  return mapTree(root, n => {
    let cur = n;
    // defaults from fragment props
    for (const f of idx.byTarget.get(cur.$) || []) {
      for (const [k, v] of Object.entries(f.spec.props || {}))
        if (v.default !== undefined && cur.props[k] === undefined && (!f.spec.when || f.spec.when(cur))) cur = rebuildNode(cur, { props: { ...cur.props, [k]: v.default } });
    }
    if (!cur.calls.length) return cur;
    const calls = cur.calls;
    cur = rebuildNode(cur, { calls: [] });
    for (const c of calls) {
      const cands = idx.methods.get(cur.$)?.get(c.name) ?? [];
      const node = cur;
      const f = cands.find(x => !x.spec.when || x.spec.when(node)) ?? cands[0];
      const spec = forms.get(cur.$);
      const slots: SlotTable = { ...commonSlots, ...(spec?.slots || {}) };
      if (f && (!f.spec.when || f.spec.when(cur))) {
        let r: unknown;
        try {
          r = f.spec.methods![c.name]!.apply(cur, c.args);
        } catch (e) {
          D.error('CK-X123', `.${c.name}() threw on ${cur.$}`, { at: c.at ?? cur.at, facts: [String((e as Error)?.message ?? e), `defined by ${who(f)}`], source: f.source ?? 'shell' });
          continue;
        }
        if (!isNode(r)) {
          D.error('CK-X122', `.${c.name}() did not return a node`, { at: c.at ?? cur.at, facts: [`defined by ${who(f)}`, `returned ${typeof r}`], fix: 'Fragment methods are fluent: return this.prop(…), this.with(…) or another node.', source: f.source ?? 'shell' });
          continue;
        }
        // calls the method's result recorded itself are applied too
        cur = r.calls.length ? applyCalls(r, idx, forms, D, where) : r;
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(slots, c.name)) {
        cur = rebuildNode(cur, { props: { ...cur.props, [c.name]: c.args[0] } });
        continue;
      }
      if (f) {
        D.error('CK-X121', `.${c.name}() does not apply to this ${cur.$}`, {
          at: c.at ?? cur.at,
          facts: [`${who(f)} adds .${c.name}() to ${cur.$} nodes that pass its \`when\`; this one does not.`, `in ${where}`],
          fix: f.spec.doc || `Remove .${c.name}() here.`,
          source: f.source ?? 'shell',
        });
        continue;
      }
      const offered = [...methodNames(idx, cur.$).filter(m => idx.methods.get(node.$)!.get(m)!.some(g => !g.spec.when || g.spec.when(node))), ...Object.keys(spec?.slots || {}), 'with', 'prop', 'slot', 'tip', 'disabled'];
      const s = suggest(c.name, offered);
      const elsewhere = [...idx.methods.entries()].filter(([t, m]) => t !== node.$ && m.has(c.name)).map(([t, m]) => `${t} (${who(m.get(c.name)![0]!)})`);
      D.error('CK-X120', `No method .${c.name}() on ${cur.$}`, {
        at: c.at ?? cur.at,
        facts: [
          elsewhere.length ? `.${c.name}() exists for ${elsewhere.join(', ')}, but this is a ${cur.$}.` : `No installed fragment adds .${c.name}() to ${cur.$}.`,
          `${cur.$} offers: ${offered.slice(0, 14).join(', ')}`,
          `in ${where}`,
        ],
        fix: s.length ? `Did you mean .${s[0]}()${(() => {
          const g = idx.methods.get(node.$)?.get(s[0]!)?.[0];
          return g?.source ? ` (kit ${g.source})` : '';
        })()}?` : 'Install the kit that defines it with .use(kit), or remove the call.',
      });
    }
    return cur;
  });
}

/** Builder fragments ('shell', 'module'): the method for a name, or null. */
export function builderMethod(frags: Fragment[], target: 'shell' | 'module', name: string): ((...a: any[]) => any) | null {
  for (let i = frags.length - 1; i >= 0; i--) {
    const f = frags[i]!;
    if (f.target === target && f.spec.methods && typeof f.spec.methods[name] === 'function') return f.spec.methods[name]!;
  }
  return null;
}
