// Fragments: extend a form (or the shell/module builders, or a library's extensible kind) with methods, props and
// slots. Two registrations with two jobs: ck.extend(fragment | kit) gives the nodes (and builders) a ck instance
// makes the fragment's methods; a kit's .fragments(…) puts its props, slots, defaults, renderers and checks into the
// builds that use the kit. A method is a modifier factory: it returns a modifier, a function of the receiver or a
// props patch, applied with `with`. An unknown method is CK-X120 and a method whose `when` refuses the node CK-X121,
// both thrown where they are called (ir/node.ts); two fragments adding the same method or slot to one target is
// CK-X110, naming both kits and both call sites.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { site, type Diagnostics } from '../core/diag.ts';
import { mapTree, rebuildNode, type NodeData } from '../ir/node.ts';
import { slot as mkSlot, type Slot, type Time } from '../ir/slots.ts';
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

/** Fragment prop defaults, in one tree (fragment methods were applied when the program called them). */
export function applyDefaults(root: NodeData, idx: FragmentIndex): NodeData {
  return mapTree(root, n => {
    let cur = n;
    for (const f of idx.byTarget.get(cur.$) || []) {
      for (const [k, v] of Object.entries(f.spec.props || {}))
        if (v.default !== undefined && cur.props[k] === undefined && (!f.spec.when || f.spec.when(cur))) cur = rebuildNode(cur, { props: { ...cur.props, [k]: v.default } });
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
