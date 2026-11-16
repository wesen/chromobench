// Renderers of studio-kit's panels and bars (guide §5.3–5.6). Each reads the store through cells (docs.<f> changes
// whenever the frame's document does; ui.log whenever the log does, proposals included) and writes through
// commands, so every action is in the palette and the shortcut sheet as well.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { canonicalJSON, Coll } from '@chromobench/values';
import { clear, h, listen, type MountCtx, type Renderer } from '@chromobench/shell/dom';
import type { NodeData } from '@chromobench/shell';
import { describe, historyRows, jumpCrosses, whyRows, WHO, type ModelLookup } from '../model/history.ts';
import { linksOf, TIME_PATH } from '../model/doc.ts';
import { pickerOf, type Picker, type PickerKind } from '../model/presets.ts';
import { modelAt } from '../kit/args.ts';
import type { Studio } from '../studio.ts';
import { renderArg } from './arg.ts';
import { sel } from '../sel.ts';
import { STACK_RENDERERS } from '../../kits/stack/src/dom.ts';

const studioOf = (m: MountCtx): Studio => m.rt.services['studio'] as Studio;
const frameOf = (n: NodeData, s: any): string | null => (typeof n.props['frame'] === 'function' ? (n.props['frame'] as (s: any) => string | null)(s) : ((n.props['frame'] as string | undefined) ?? sel.current(s)));
const btn = (text: string, cls: string, attrs: Record<string, unknown> = {}) => h('button', { type: 'button', class: `ck-btn is-small ${cls}`, text, ...attrs });
const time = (ts: number): string => new Date(ts).toTimeString().slice(0, 5);

/** a panel body that re-renders from one cell (small lists; no virtualisation needed) */
const list = (cls: string, read: (s: any, n: NodeData) => unknown, draw: (el: HTMLElement, v: any, m: MountCtx, n: NodeData) => void, equals?: (a: any, b: any) => boolean): Renderer => (n, m) => {
  const el = h('div', { class: `cb-panel ${cls}` });
  m.cell(
    s => read(s, n),
    v => {
      clear(el);
      draw(el, v, m, n);
    },
    equals ? { equals } : {},
  );
  return el;
};
const same = (a: any, b: any) => !!a && Object.keys(a).every(k => a[k] === b[k]) && Object.keys(b).every(k => a[k] === b[k]);
const frameDeps = (s: any, n: NodeData) => {
  const f = frameOf(n, s);
  return { f, r: f ? s.docs?.[f] : undefined, p: f ? sel.proposals(s, f) : undefined, v: sel.logVersion(s) };
};
const lookup: ModelLookup = (p, d) => modelAt(p, d) ?? undefined;

const history = list(
  'cb-history',
  frameDeps,
  (el, v, m) => {
    const st = m.rt.store;
    if (!v.f || !st.log.has(v.f)) return void el.append(h('p', { class: 'cb-empty', text: 'No frame' }));
    const log = st.log;
    const rows = historyRows(log, v.f, lookup);
    const ol = h('ol', { class: 'cb-hist', id: 'history' });
    const nameOf = (d: string): string => (d === 'main' ? 'the library' : (sel.entry(m.store.readonly(), d)?.name ?? d));
    /** a jump: at once when it touches only this frame, else after the photographer confirms (inline, under the row) */
    const jump = (li: HTMLElement, to: number): void => {
      ol.querySelector('.cb-hist-confirm')?.remove();
      const c = jumpCrosses(log, v.f, to, nameOf);
      if (!c.count) return void m.rt.runCommand('history.jump', null, to);
      const yes = btn('Jump anyway', 'cb-hist-yes is-primary');
      const no = btn('Cancel', 'cb-hist-no');
      const box = h('li', { class: 'cb-hist-confirm', role: 'alert' }, h('span', { text: `This also ${c.redo ? 'redoes' : 'undoes'} ${c.count} later ${c.count === 1 ? 'change' : 'changes'} on ${c.names.join(', ')}.` }), h('span', { class: 'cb-card-b' }, yes, no));
      listen(m.scope, yes, 'click', () => m.rt.runCommand('history.jump', null, to));
      listen(m.scope, no, 'click', () => box.remove());
      li.after(box);
    };
    // the opening: jumping there undoes every step of this frame (and the steps of other frames after them)
    const firstCursor = rows.length ? rows[0]!.cursor - 1 : log.cursor;
    const atStart = !rows.some(r => r.inEffect);
    const start = h('li', { class: ['cb-hist-i', atStart && 'is-cursor'], 'data-index': '0' }, h('span', { class: 'cb-who', text: WHO.auto }), ' Frame added');
    listen(m.scope, start, 'click', () => jump(start, firstCursor));
    ol.append(start);
    let cursor: HTMLElement = start;
    const last = [...rows].reverse().find(r => r.inEffect);
    for (const g of rows) {
      const text = g.changes.map(c => c.text).join('; ');
      // a step of this frame under later steps of other frames: a jump to it crosses them (marked, and it asks)
      const under = g.inEffect ? jumpCrosses(log, v.f, g.cursor, nameOf) : { count: 0, names: [] as string[] };
      const tip = [...g.changes.map(c => c.text), ...(under.count ? [`Later changes on ${under.names.join(', ')} sit on top of this step`] : [])].join('\n');
      // the whole step in the tooltip, one change a line (a long row is cut with an ellipsis)
      const li = h('li', { class: ['cb-hist-i', !g.inEffect && 'is-undone', g === last && 'is-cursor', under.count > 0 && 'is-crossed'], 'data-cursor': String(g.cursor), title: tip }, h('span', { class: 'cb-who', text: WHO[g.by] + (g.approved ? ' ✓' : '') }), ' ', text || g.label);
      listen(m.scope, li, 'click', () => jump(li, g.cursor));
      ol.append(li);
      if (g === last) cursor = li;
    }
    // a rejected proposal in words (CHB-031 F32: not its transaction id and sequence number)
    const now = log.doc<any>(v.f);
    for (const r of log.entries.filter(x => x.doc === v.f && x.tx.status === 'rejected')) ol.append(h('li', { class: 'cb-hist-i is-rejected', text: `Agent · rejected: ${r.tx.mutations.map(mu => describe(mu, now, lookup)).join('; ')}` }));
    el.append(ol);
    // the list is drawn anew on every change: keep the current step in view (F33: 30+ steps scroll)
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => {
      if (!cursor.isConnected) return;
      const top = cursor.offsetTop;
      if (top < ol.scrollTop || top + cursor.offsetHeight > ol.scrollTop + ol.clientHeight) ol.scrollTop = Math.max(0, top + cursor.offsetHeight - ol.clientHeight);
    });
  },
  same,
);

const approvals = list(
  'cb-approvals',
  (s, n) => ({ ...frameDeps(s, n), a: s.ui?.approvals, show: s.ui?.showProposal, mode: s.prefs?.agentMode }),
  (el, v, m, n) => {
    const ul = h('ul', { id: 'pending', class: 'cb-cards' });
    const props = (v.p ?? []) as any[];
    if (!props.length) el.append(h('p', { class: 'cb-empty', text: n.props['compact'] ? '' : 'No agent proposals' }));
    for (const p of props) {
      const st = v.a?.[p.tx] ?? {};
      const off: number[] = st.off ?? [];
      const li = h('li', { class: ['cb-card', v.show === p.tx && 'is-shown'], 'data-tx': p.tx });
      li.append(h('div', { class: 'cb-card-h' }, h('strong', { text: 'Agent' }), p.why ? ` · ${p.why}` : ''));
      const changes = h('div', { class: 'cb-changes' });
      for (const c of p.changes) {
        const box = h('input', { type: 'checkbox', 'aria-label': `Include ${c.text}` }) as HTMLInputElement;
        // c.seq is the change's index in the proposal's transaction
        box.checked = !off.includes(c.seq);
        listen(m.scope, box, 'change', () => m.rt.runCommand('proposal.toggle', null, p.tx, c.seq));
        changes.append(h('div', { class: 'cb-change' }, h('label', {}, p.changes.length > 1 ? box : null, ' ', c.text)));
      }
      li.append(changes);
      if (st.stale?.length) li.append(h('div', { class: 'cb-stale' }, ...st.stale.map((d: any) => h('div', { text: `${d.code}: ${d.message}` }))));
      const row = h('div', { class: 'cb-card-b' });
      const show = btn(v.show === p.tx ? 'Hide' : 'Show', 'show');
      const ok = btn(off.length ? 'Approve checked' : 'Approve', 'approve is-primary');
      const no = btn('Reject', 'reject');
      listen(m.scope, show, 'click', () => m.rt.runCommand('proposal.show', null, p.tx));
      listen(m.scope, ok, 'click', () => m.rt.runCommand('proposal.approve', null, v.f, p.tx));
      listen(m.scope, no, 'click', () => m.rt.runCommand('proposal.reject', null, v.f, p.tx));
      row.append(show, ok, no);
      if (st.stale?.length) {
        const force = btn('Apply anyway', 'force');
        listen(m.scope, force, 'click', () => m.rt.runCommand('proposal.approve', null, v.f, p.tx, true));
        row.append(force);
      }
      li.append(row);
      ul.append(li);
    }
    el.append(ul);
    if (props.length > 1) {
      const all = btn('Approve all', 'approve-all');
      listen(m.scope, all, 'click', () => m.rt.runCommand('proposal.approveAll', null));
      el.append(all);
    }
  },
  same,
);

const why = list(
  'cb-why',
  s => ({ f: sel.current(s), r: sel.current(s) ? s.docs?.[sel.current(s)!] : undefined, path: s.ui?.focusPath ?? TIME_PATH, v: sel.logVersion(s) }),
  (el, v, m) => {
    const log = m.rt.store.log;
    if (!v.f || !log.has(v.f)) return;
    const w = whyRows(log, v.f, v.path, lookup);
    el.append(h('div', { class: 'cb-why-t', id: 'why', text: w.title }));
    const t = h('table', { class: 'cb-tbl' });
    for (const r of w.rows) t.append(h('tr', {}, h('td', { text: r.when }), h('td', { text: r.who }), h('td', { text: r.text }), h('td', { class: 'cb-dim', text: r.note })));
    el.append(t);
  },
  same,
);

const snapshots = list(
  'cb-snapshots',
  s => ({ f: sel.current(s), list: sel.current(s) ? s.snapshots?.[sel.current(s)!] : undefined }),
  (el, v, m) => {
    const add = btn('New snapshot', 'snap-new');
    listen(m.scope, add, 'click', () => m.rt.runCommand('snapshot.new', null));
    el.append(add);
    const ul = h('ul', { class: 'cb-list' });
    for (const s of v.list ?? []) {
      const r = btn('Restore', 'snap-restore');
      listen(m.scope, r, 'click', () => m.rt.runCommand('snapshot.restore', null, s.id));
      ul.append(h('li', {}, h('span', { text: `${s.name} · ${time(s.ts)}` }), r));
    }
    el.append(ul);
  },
  same,
);

const journal = list('cb-journal', frameDeps, (el, v, m) => {
  const log = m.rt.store.log;
  if (!v.f || !log.has(v.f)) return;
  const t = h('table', { class: 'cb-tbl cb-mono' });
  t.append(h('tr', {}, ...['seq', 'status', 'by', 'tx', 'mutations'].map(x => h('th', { text: x }))));
  for (const x of log.entries.filter(e => e.doc === v.f)) {
    const ms = x.tx.mutations.map((mu: any) => (mu.op === 'set' ? `${mu.path} = ${canonicalJSON(mu.value ?? null)}` : mu.op === 'insert' ? `insert ${mu.id} into ${mu.coll}` : `${mu.op} ${mu.id}`)).join('; ');
    t.append(h('tr', {}, h('td', { text: String(x.seq) }), h('td', { text: x.tx.status }), h('td', { text: x.tx.by }), h('td', { text: x.tx.id }), h('td', { text: ms })));
  }
  el.append(h('div', { class: 'cb-dim', text: `cursor ${log.cursor} of ${log.steps.length} steps` }), t);
});

const nodes = list('cb-nodes', frameDeps, (el, v, m) => {
  if (!v.r || !v.f) return;
  const studio = studioOf(m);
  const shown = studio.bridge.lower({ $: 'cb.image', frame: v.f, doc: v.r, what: 'print', args: {}, expr: 'frame.print()' }).shown;
  const e = studio.frames.get(v.f)!;
  const ul = h('ol', { class: 'cb-list cb-mono' });
  for (const d of e.graph.closure(shown.id)) {
    const id = e.graph.adopt([d])[0]!.id;
    ul.append(h('li', { text: `${d.op}  ${id.slice(0, 8)}${studio.bridge.runs.get(id) ? `  ×${studio.bridge.runs.get(id)}` : ''}` }));
  }
  el.append(ul);
});

const explain: Renderer = (_n, m) => {
  const pre = h('pre', { class: 'cb-explain' });
  const b = btn('Explain this studio', 'explain-b');
  listen(m.scope, b, 'click', () => void (pre.textContent = m.rt.explain({ live: true })));
  pre.textContent = m.rt.app.explain();
  return h('div', { class: 'cb-panel' }, b, pre);
};

const metadata = list(
  'cb-metadata',
  s => ({ f: sel.current(s), c: sel.entry(s) }),
  (el, v, m) => {
    if (!v.c) return void el.append(h('p', { class: 'cb-empty', text: 'No frame selected' }));
    const e = studioOf(m).frames.get(v.f);
    const rows: [string, string][] = [
      ['Name', v.c.name],
      ['Frame', v.f],
      ['SHA-256', `${v.c.sha256.slice(0, 16)}…`],
      ['Size', e ? `${e.info.width} × ${e.info.height}` : '—'],
      ['Flag', v.c.flag ?? '—'],
      ['Stars', '★'.repeat(v.c.stars) || '—'],
      ['Label', v.c.label ?? '—'],
    ];
    const t = h('table', { class: 'cb-tbl' });
    for (const [k, x] of rows) t.append(h('tr', {}, h('th', { text: k }), h('td', { text: x })));
    el.append(t);
  },
  same,
);

const library = list(
  'cb-library',
  s => ({ c: s.catalog, r: s.ratings, flag: s.view?.filter?.flag }),
  (el, v, m) => {
    const fr = Object.keys(v.c?.frames ?? {}).map(id => ({ ...v.c.frames[id], ...(v.r?.[id] ?? {}) })) as any[];
    const count = (pred: (x: any) => boolean) => fr.filter(pred).length;
    const ul = h('ul', { class: 'cb-list' });
    for (const [label, flag, n] of [
      ['All frames', null, fr.length],
      ['Picks', 'pick', count(x => x.flag === 'pick')],
      ['Rejects', 'reject', count(x => x.flag === 'reject')],
      ['Unflagged', 'unflagged', count(x => !x.flag)],
    ] as const) {
      const li = h('li', { class: ['cb-lib-i', v.flag === flag && 'is-on'] }, h('span', { text: label }), h('span', { class: 'cb-dim', text: String(n) }));
      listen(m.scope, li, 'click', () => m.rctx().set({ view: { filter: { flag } } }));
      ul.append(li);
    }
    el.append(ul);
  },
  same,
);

const densitometer = list('cb-densitometer', s => ({ ...frameDeps(s, { props: {} } as NodeData), probe: s.ui?.probe }), (el, v, m) => {
  if (!v.r || !v.f) return;
  const studio = studioOf(m);
  const pins = Coll.entries(v.r.probes) as [string, { x: number; y: number }][];
  const t = h('table', { class: 'cb-tbl cb-mono' });
  t.append(h('tr', {}, ...['probe', 'x, y', 'visual D', 'D (R G B)'].map(x => h('th', { text: x }))));
  const rows: [string, number, number][] = [...(v.probe ? [['cursor', v.probe[0], v.probe[1]] as [string, number, number]] : []), ...pins.map(([id, p]) => [id, p.x, p.y] as [string, number, number])];
  for (const [id, x, y] of rows) {
    const d = h('td', { text: '…' });
    const vis = h('td', { class: 'cb-visual-d', 'data-probe': id, text: '…' });
    t.append(h('tr', {}, h('td', { text: id }), h('td', { text: `${x}, ${y}` }), vis, d));
    studio
      .measure(v.f, v.r, x, y)
      .then(r => {
        d.textContent = r ? r.D.map(z => z.toFixed(2)).join(' ') : '—';
        vis.textContent = r && r.visual !== undefined ? r.visual.toFixed(2) : '—';
      })
      .catch(() => {
        d.textContent = '—';
        vis.textContent = '—';
      });
  }
  if (!rows.length) el.append(h('p', { class: 'cb-empty', text: 'Probe the print (I), then P pins it' }));
  else el.append(t);
});

const readout = list('cb-readout', s => ({ f: sel.current(s), r: sel.current(s) ? s.docs?.[sel.current(s)!] : undefined, probe: s.ui?.probe }), (el, v, m) => {
  if (!v.probe || !v.r) return;
  const span = h('span', { text: `${v.probe[0]}, ${v.probe[1]} · …` });
  el.append(span);
  studioOf(m)
    .measure(v.f, v.r, v.probe[0], v.probe[1])
    .then(r => void (span.textContent = r ? `${v.probe[0]}, ${v.probe[1]} · ${r.visual !== undefined ? `visual D ${r.visual.toFixed(2)} · ` : ''}D ${r.D.map(z => z.toFixed(2)).join(' ')}` : ''))
    .catch(() => undefined);
}, same);

const ribbon = list(
  'cb-ribbon',
  s => ({ f: sel.current(s), show: s.ui?.showProposal, p: sel.current(s) ? sel.proposals(s) : undefined }),
  (el, v) => {
    const p = (v.p ?? []).find((x: any) => x.tx === v.show);
    el.hidden = !p;
    if (p) el.append(h('span', { text: `Agent proposal, not applied: ${p.changes.map((c: any) => c.text).join('; ')}` }));
  },
  same,
);

const steps: Renderer = (n, m) => {
  const ids = (n.props['steps'] as string[]) ?? [];
  const labels = (n.props['labels'] as Record<string, string>) ?? {};
  const el = h('div', { class: 'cb-steps', role: 'tablist' });
  const back = btn('Back', 'cb-steps-back');
  const next = btn('Next', 'cb-steps-next is-primary');
  const bs = ids.map(id => {
    const b = h('button', { type: 'button', class: 'cb-step', role: 'tab', 'data-step': id, text: labels[id] ?? id });
    listen(m.scope, b, 'click', () => m.rt.runCommand('step.go', null, id));
    return b;
  });
  const go = (d: number) => {
    const i = ids.indexOf(m.store.peek(['view', 'step']));
    const j = Math.max(0, Math.min(ids.length - 1, i + d));
    m.rt.runCommand('step.go', null, ids[j]);
  };
  listen(m.scope, back, 'click', () => go(-1));
  listen(m.scope, next, 'click', () => go(1));
  el.append(back, ...bs, next);
  m.cell(
    s => s.view?.step,
    v => {
      for (const b of bs) {
        b.classList.toggle('is-on', b.dataset['step'] === v);
        b.setAttribute('aria-selected', String(b.dataset['step'] === v));
      }
      back.disabled = ids.indexOf(v) <= 0;
      next.disabled = ids.indexOf(v) >= ids.length - 1;
    },
  );
  return el;
};

const filter: Renderer = (_n, m) => {
  const input = h('input', { type: 'search', class: 'cb-search', placeholder: 'Search frames', 'aria-label': 'Search frames' }) as HTMLInputElement;
  listen(m.scope, input, 'input', () => m.rctx().set({ view: { filter: { text: input.value } } }));
  listen(m.scope, input, 'keydown', (e: KeyboardEvent) => e.stopPropagation());
  const modes = h('div', { class: 'cb-seg' });
  for (const [mode, label] of [['grid', 'Grid'], ['loupe', 'Loupe'], ['compare', 'Compare'], ['survey', 'Survey']]) {
    const b = h('button', { type: 'button', class: 'ck-btn is-small', 'data-mode': mode, text: label });
    listen(m.scope, b, 'click', () => m.rt.runCommand('view.mode', null, mode));
    modes.append(b);
  }
  m.cell(
    s => s.view?.mode,
    v => {
      for (const b of modes.children) (b as HTMLElement).classList.toggle('is-on', (b as HTMLElement).dataset['mode'] === v);
    },
  );
  return h('div', { class: 'cb-filter' }, input, modes);
};

const output: Renderer = (n, m) => {
  const b = btn(n.props['simple'] ? 'Save the print' : 'Save PNG', 'cb-save is-primary');
  listen(m.scope, b, 'click', () => m.rt.runCommand('output.save', null));
  return h('div', { class: ['cb-panel cb-output', n.props['simple'] && 'is-simple'] }, h('p', { class: 'cb-dim', text: 'Export, colour management and soft proofing come with CHB-011.' }), b);
};

const chat: Renderer = () => h('div', { class: 'cb-panel cb-dim', text: 'The chat comes with CHB-008. Until then: window.chromobench.propose(mutations, why).' });
void studioOf;

/** every studio-kit renderer, by form name: pass to mount as `renderers` */
/** cb.preset: a select of presets (model/presets.ts pickerOf), the frame's own shown, Custom when none; a choice runs the command */
const preset: Renderer = (n, m) => {
  const kind = String(n.props['kind']) as PickerKind;
  const el = h('label', { class: 'ck-field ck-select cb-preset', 'data-kind': kind });
  const lab = h('span', { class: 'ck-field-l' });
  const select = h('select', { class: 'ck-field-i' }) as HTMLSelectElement;
  el.append(lab, select);
  let picker: Picker | null = null;
  m.cell(
    (s) => {
      const f = frameOf(n, s);
      return { r: f ? s.docs?.[f] : undefined, shot: f ? s.catalog?.frames?.[f]?.asShot : undefined, links: linksOf(s) };
    },
    (v: any) => {
      picker = pickerOf(kind, v.r, { asShot: v.shot ?? null, links: v.links });
      el.hidden = !picker;
      if (!picker) return;
      lab.textContent = picker.label;
      el.title = picker.tip;
      select.setAttribute('aria-label', picker.label);
      const opts: HTMLElement[] = [];
      if (picker.current === null) opts.push(h('option', { value: '', text: picker.custom, selected: true }));
      let group: HTMLElement | null = null;
      for (const o of picker.options) {
        const opt = h('option', { value: o.value, text: o.label, disabled: !!o.disabled, selected: o.value === picker.current, ...(o.tip ? { title: o.tip } : {}) });
        if (o.group) {
          if (!group || group.getAttribute('label') !== o.group) {
            group = h('optgroup', { label: o.group });
            opts.push(group);
          }
          group.append(opt);
        } else {
          group = null;
          opts.push(opt);
        }
      }
      select.replaceChildren(...opts);
      select.value = picker.current ?? '';
    },
    { equals: same },
  );
  listen(m.scope, select, 'change', () => {
    if (!picker || !select.value) return;
    const [cmd, arg] = picker.run(select.value);
    m.rt.runCommand(cmd, null, arg);
  });
  listen(m.scope, select, 'keydown', (e: KeyboardEvent) => e.stopPropagation());
  return el;
};

export const CB_RENDERERS: Record<string, Renderer> = {
  'cb.arg': renderArg,
  'cb.history': history,
  'cb.approvals': approvals,
  'cb.why': why,
  'cb.snapshots': snapshots,
  'cb.journal': journal,
  'cb.nodes': nodes,
  'cb.explain': explain,
  'cb.metadata': metadata,
  'cb.library': library,
  'cb.densitometer': densitometer,
  'cb.output': output,
  'cb.chat': chat,
  'cb.steps': steps,
  'cb.readout': readout,
  'cb.ribbon': ribbon,
  'cb.filter': filter,
  'cb.preset': preset,
  // the stack kit is in every studio (cb.studio installs it)
  ...STACK_RENDERERS,
};
