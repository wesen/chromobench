// The stack kit's editors (DOM): the curve, levels, HSL bands, colour grading wheels and the channel mixer of a
// layer, shown by the params panel for the layer's op. They are document adapters over the shell's widgets (the
// curve plane and the colour wheel) and the kit's one number control, so they look like every other control: a drag
// previews the frame's document (the store's gesture draft) and commits one step on release; arrow keys coalesce
// into one step; a typed value, a segment, a switch is one step. What they draw and measure with is core's, through
// the host's `editorMath` service (editors.ts).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { curvePlane, drag, h, listen, svgEl, wheelDisc, type CurveEdit, type MountCtx, type Renderer } from '@chromobench/shell/dom';
import { Coll, type Id } from '@chromobench/values';
import { getOp, type ArgSpec, type Document } from '@chromobench/contract';
import { findEntry, storePath } from '../../../../src/model/doc.ts';
import { sel } from '../../../../src/sel.ts';
import { btn, frameOf, numAt, numberControl, peekDoc } from '../controls/dom.ts';
import { bandWord, freeItemId, gammaAt, gammaOf, mathOf, oklchCss, pointsColl, pointsOf, stageHistogram, type EditorMath, type MeasureHost, type Point } from '../editors.ts';

// ── the editors' plumbing: the layer's values, one gesture, one step ──

type Frame = (s: any) => string | null;
interface Gesture {
  /** the frame now */
  frame(): string | null;
  /** the frame's document now (with a gesture's preview) */
  doc(): Document | undefined;
  /** the frame's committed document (ids for new list items are free in it) */
  committed(): Document | undefined;
  /** a drag in progress: one document path's value */
  preview(path: string, v: unknown): void;
  /** the gesture's end: one step */
  commit(label: string): void;
  cancel(): void;
  /** one step now: several paths in one transaction; `coalesce` joins a run of key presses on them into one step */
  set(values: readonly (readonly [string, unknown])[], label: string, coalesce?: string): void;
}
function gestureOf(m: MountCtx, frame: Frame): Gesture {
  const st = m.store;
  const f = (): string | null => frame(st.readonly());
  const doc = (): Document | undefined => {
    const x = f();
    return x ? peekDoc(m, x) : undefined;
  };
  const where = (path: string): (string | number)[] | null => {
    const x = f();
    const d = doc();
    try {
      return x && d ? storePath(x, d, path) : null;
    } catch {
      return null;
    }
  };
  return {
    frame: f,
    doc,
    committed: () => {
      const x = f();
      const studio = m.rt.services['studio'] as { doc(f: string): Document | undefined } | undefined;
      return (x && studio?.doc(x)) || doc();
    },
    preview: (path, v) => {
      const p = where(path);
      if (p) st.preview(p, v);
    },
    commit: (label) => {
      if (st.previewing) st.commit(label, m.txOpts());
    },
    cancel: () => st.cancel(),
    set: (values, label, coalesce) => {
      const ps = values.map(([path, v]) => [where(path), v] as const).filter((x): x is readonly [(string | number)[], unknown] => !!x[0]);
      if (!ps.length) return;
      const x = f();
      m.rctx().tx(label, (t: any) => {
        for (const [p, v] of ps) t.$set(p, v);
      }, { ...m.txOpts(), ...(coalesce ? { coalesce: `${x}:${coalesce}` } : {}), source: { kind: 'control', control: values[0]![0] } });
    },
  };
}
/** a layer's params in the state (with a gesture's preview) */
const paramsIn = (s: any, frame: Frame, id: Id): Record<string, any> | undefined => {
  const f = frame(s);
  const d = f ? sel.doc(s, f) : undefined;
  const e = d ? findEntry(d, id)?.entry : undefined;
  return e && e.kind === 'layer' ? (e.params as Record<string, any>) : undefined;
};
const nameOf = (g: Gesture, id: Id): string => {
  const d = g.doc();
  return (d && findEntry(d, id)?.entry.name) || id;
};
const host = (m: MountCtx): MeasureHost | null => (m.rt.services['studio'] as MeasureHost | undefined) ?? null;
const argSpec = (op: string, arg: string): ArgSpec => getOp(op).args[arg]!;
const pct = (v: number): string => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`;
/** a typed value of a fraction shown in percent ('+20', '−15', '20 %') */
const parsePct = (t: string): number | null => {
  const x = Number(t.trim().replace(',', '.').replace('−', '-').replace(/\s*%$/, ''));
  return t.trim() !== '' && Number.isFinite(x) ? x / 100 : null;
};
const parseDeg = (t: string): number | null => {
  const x = Number(t.trim().replace(',', '.').replace('−', '-').replace(/\s*°$/, ''));
  return t.trim() !== '' && Number.isFinite(x) ? x : null;
};

/** A segmented choice (the curve's and levels' channel, the HSL property): one step (or view state) per click. */
function segmented(m: MountCtx, label: string, values: readonly string[], o: { word?: (v: string) => string; tip?: (v: string) => string; read: (s: any) => string | undefined; write: (v: string) => void }): HTMLElement {
  const seg = h('div', { class: 'ck-seg is-small cb-ed-seg', role: 'radiogroup', 'aria-label': label });
  for (const v of values) {
    const b = h('button', { type: 'button', class: 'ck-seg-b', role: 'radio', text: o.word?.(v) ?? v, 'data-value': v, ...(o.tip ? { 'data-tip': o.tip(v) } : {}) });
    listen(m.scope, b, 'click', () => o.write(v));
    seg.append(b);
  }
  m.cell(o.read, (cur) => {
    for (const b of seg.children) {
      const on = (b as HTMLElement).dataset['value'] === cur;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  });
  return seg;
}

const CHANNEL_TIPS: Record<string, string> = {
  L: 'Lightness (OkLab L): tone without hue shifts',
  R: 'Red: the cube root of linear red (a neutral’s R, G and B curves are its L curve)',
  G: 'Green: the cube root of linear green',
  B: 'Blue: the cube root of linear blue',
};
/** a channel's curve colour (data colours: the channel's own) */
const CHANNEL_INK: Record<string, string> = { L: 'var(--text)', R: oklchCss(25, 0.19, 0.64), G: oklchCss(145, 0.17, 0.7), B: oklchCss(260, 0.18, 0.62) };

/** the tone channel segmented control of a curve or levels layer */
function channelSeg(m: MountCtx, frame: Frame, g: Gesture, id: Id, op: string): HTMLElement {
  return segmented(m, 'Channel', ['L', 'R', 'G', 'B'], {
    tip: (v) => CHANNEL_TIPS[v]!,
    read: (s) => paramsIn(s, frame, id)?.['channel'] ?? argSpec(op, 'channel').default,
    write: (v) => g.set([[`${id}.params.channel`, v]], `${nameOf(g, id)} on ${v === 'L' ? 'lightness' : v}`),
  });
}

/** The histogram of the stage input in a tone channel (once per log change and channel: the input does not move while
 *  the layer's own controls do). */
function stageHistogramCell(m: MountCtx, frame: Frame, g: Gesture, id: Id, stage: string, show: (bins: number[] | null) => void): void {
  const math = mathOf(m.rt.services);
  const hs = host(m);
  let ask = 0;
  m.cell((s) => ({ f: frame(s), ch: String(paramsIn(s, frame, id)?.['channel'] ?? 'L'), v: sel.logVersion(s) }), (x) => {
    const d = g.committed();
    if (!math || !hs || !x.f || !d) return show(null);
    const n = ++ask;
    let p: Promise<number[]>;
    try {
      p = stageHistogram(hs, math, x.f, d, stage as never, x.ch);
    } catch {
      return show(null);
    }
    p.then((bins) => n === ask && show(bins), () => n === ask && show(null));
  }, { equals: (a: any, b: any) => a.f === b.f && a.ch === b.ch && a.v === b.v });
}

/** without the host's editorMath the curve is drawn through its points with straight segments */
const straight = (pts: readonly { x: number; y: number }[]) => (x: number): number => {
  const p = [...pts].sort((a, b) => a.x - b.x);
  if (x <= p[0]!.x) return p[0]!.y;
  for (let i = 1; i < p.length; i++) if (x <= p[i]!.x) return p[i - 1]!.y + ((p[i]!.y - p[i - 1]!.y) * (x - p[i - 1]!.x)) / (p[i]!.x - p[i - 1]!.x || 1);
  return p[p.length - 1]!.y;
};

const WHAT: Record<CurveEdit, string> = { move: 'move point', add: 'add point', delete: 'delete point', reset: 'reset' };

// ── the curve ──

const curve: Renderer = (n, m) => {
  const id = String(n.props['entry']);
  const stage = String(n.props['stage']);
  const frame: Frame = (s) => frameOf(n, s);
  const g = gestureOf(m, frame);
  const math: EditorMath | null = mathOf(m.rt.services);
  const el = h('div', { class: 'cb-ed cb-ed-curve', 'data-entry': id });
  const at = `${id}.params.points`;
  const coll = (pts: readonly Point[]) => pointsColl(g.committed() ?? g.doc()!, id, pts);
  const plane = curvePlane(m.scope, {
    size: 220, fixedEnds: false, maxPoints: argSpec('curve', 'points').maxItems ?? 16, label: 'Curve',
    fn: math ? (pts) => math.curve(pts) : straight,
    newId: (list) => freeItemId(g.committed() ?? g.doc()!, id, 'points', list.map((p) => p.id)),
    preview: (pts) => g.preview(at, coll(pts)),
    commit: (pts, what) => {
      g.preview(at, coll(pts));
      g.commit(`${nameOf(g, id)}: ${WHAT[what]}`);
    },
    cancel: () => g.cancel(),
    nudge: (pts) => g.set([[at, coll(pts)]], `${nameOf(g, id)}: move point`, at),
  });
  const reset = btn('Reset', 'cb-ed-reset', { 'aria-label': 'Reset the curve' });
  listen(m.scope, reset, 'click', () => {
    const pts = pointsOf(g.doc(), id);
    g.set([[at, coll([{ ...pts[0]!, x: 0, y: 0 }, { ...pts[pts.length - 1]!, x: 1, y: 1 }])]], `${nameOf(g, id)}: reset`);
  });
  el.append(
    h('div', { class: 'cb-ed-bar' }, channelSeg(m, frame, g, id, 'curve'), reset),
    plane.svg,
    plane.read,
    h('p', { class: 'cb-dim cb-ed-hint', text: math ? 'Click adds a point, drag moves it; drag it off or double-click it to remove; arrows nudge.' : 'Click adds a point, drag moves it. The host gives no curve function: drawn with straight segments.' }),
  );
  m.cell((s) => {
    const d = sel.doc(s, frame(s));
    return pointsOf(d, id).map((p) => `${p.id}:${p.x}:${p.y}`).join(',');
  }, () => plane.set(pointsOf(sel.doc(m.store.readonly(), frame(m.store.readonly())), id)));
  m.cell((s) => String(paramsIn(s, frame, id)?.['channel'] ?? 'L'), (ch) => plane.stroke(CHANNEL_INK[ch] ?? 'var(--text)'));
  stageHistogramCell(m, frame, g, id, stage, (bins) => plane.backdrop(bins));
  return el;
};

// ── levels: the stage input's histogram with black, gamma and white handles ──

const levels: Renderer = (n, m) => {
  const id = String(n.props['entry']);
  const stage = String(n.props['stage']);
  const frame: Frame = (s) => frameOf(n, s);
  const g = gestureOf(m, frame);
  const math = mathOf(m.rt.services);
  const W = 256, H = 72;
  const el = h('div', { class: 'cb-ed cb-ed-levels', 'data-entry': id });
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'cb-ed-hist', preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Histogram of the stage input' });
  const hist = svgEl('path', { class: 'cb-ed-hist-a' });
  const line = svgEl('path', { class: 'cb-ed-hist-t' });
  svg.append(hist, line);
  const bar = h('div', { class: 'cb-ed-handles' });
  type K = 'black' | 'gamma' | 'white';
  const handles: Record<K, HTMLElement> = {
    black: h('div', { class: 'cb-ed-handle is-black', role: 'slider', tabindex: '0', 'aria-label': 'Black point' }),
    gamma: h('div', { class: 'cb-ed-handle is-gamma', role: 'slider', tabindex: '0', 'aria-label': 'Midtones (gamma)' }),
    white: h('div', { class: 'cb-ed-handle is-white', role: 'slider', tabindex: '0', 'aria-label': 'White point' }),
  };
  bar.append(handles.black, handles.gamma, handles.white);
  const read = h('div', { class: 'cb-ed-read' });
  el.append(h('div', { class: 'cb-ed-bar' }, channelSeg(m, frame, g, id, 'levels')), svg, bar, read);
  let cur = { black: 0, white: 1, gamma: 1, outBlack: 0, outWhite: 1 };
  const valueAt = (k: K, x: number): [string, number] => {
    if (k === 'black') return ['black', Number(Math.max(0, Math.min(cur.white - 0.01, x)).toFixed(4))];
    if (k === 'white') return ['white', Number(Math.min(1, Math.max(cur.black + 0.01, x)).toFixed(4))];
    return ['gamma', gammaOf(cur.black, cur.white, x)];
  };
  const word = (k: K): string => (k === 'black' ? 'black point' : k === 'white' ? 'white point' : 'midtones');
  for (const k of ['black', 'gamma', 'white'] as K[]) {
    const hd = handles[k];
    listen(m.scope, hd, 'pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      hd.focus?.();
      const start = { ...cur };
      drag(e, {
        cursor: 'ew-resize',
        move: (ev) => {
          const r = bar.getBoundingClientRect();
          cur = { ...start };
          const [arg, v] = valueAt(k, (ev.clientX - r.left) / (r.width || 1));
          g.preview(`${id}.params.${arg}`, v);
        },
        up: () => g.commit(`${nameOf(g, id)} ${word(k)}`),
        cancel: () => g.cancel(),
      });
    });
    listen(m.scope, hd, 'keydown', (e: KeyboardEvent) => {
      const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      e.stopPropagation();
      const step = (e.shiftKey ? 10 : 1) * 0.002;
      // the store's values (a run of presses is faster than the cells)
      const d = g.doc();
      const pe = d ? findEntry(d, id)?.entry : undefined;
      if (pe && pe.kind === 'layer') cur = { ...cur, ...(pe.params as Partial<typeof cur>) };
      const x = k === 'gamma' ? gammaAt(cur.black, cur.white, cur.gamma) + dir * step : cur[k] + dir * step;
      const [arg, v] = valueAt(k, x);
      g.set([[`${id}.params.${arg}`, v]], `${nameOf(g, id)} ${word(k)}`, `${id}.levels.${arg}`);
    });
  }
  m.cell((s) => {
    const p = paramsIn(s, frame, id);
    return p ? `${p['black'] ?? 0}|${p['white'] ?? 1}|${p['gamma'] ?? 1}|${p['outBlack'] ?? 0}|${p['outWhite'] ?? 1}` : '';
  }, (k) => {
    if (!k) return;
    const [black, white, gamma, outBlack, outWhite] = k.split('|').map(Number) as [number, number, number, number, number];
    cur = { black, white, gamma, outBlack, outWhite };
    const gx = gammaAt(black, white, gamma);
    handles.black.style.left = `${black * 100}%`;
    handles.white.style.left = `${white * 100}%`;
    handles.gamma.style.left = `${gx * 100}%`;
    handles.black.setAttribute('aria-valuetext', `black ${Math.round(black * 100)} %`);
    handles.white.setAttribute('aria-valuetext', `white ${Math.round(white * 100)} %`);
    handles.gamma.setAttribute('aria-valuetext', `gamma ${gamma.toFixed(2)}`);
    read.textContent = `Black ${Math.round(black * 100)} % · Gamma ${gamma.toFixed(2)} · White ${Math.round(white * 100)} %`;
    const f = math ? math.levels(cur) : (x: number) => x;
    let d = '';
    for (let i = 0; i <= 64; i++) {
      const x = i / 64;
      d += `${i ? 'L' : 'M'}${(x * W).toFixed(1)} ${((1 - Math.max(0, Math.min(1, f(x)))) * H).toFixed(1)}`;
    }
    line.setAttribute('d', d);
  });
  stageHistogramCell(m, frame, g, id, stage, (bins) => {
    if (!bins) return void hist.setAttribute('d', '');
    const nb = bins.length;
    const mx = Math.max(1e-12, ...bins.slice(1, nb - 1));
    let d = `M0 ${H}`;
    for (let i = 0; i < nb; i++) d += `L${(((i + 0.5) / nb) * W).toFixed(1)} ${(H - Math.min(H, (bins[i]! / mx) * H * 0.92)).toFixed(1)}`;
    hist.setAttribute('d', `${d}L${W} ${H}Z`);
  });
  return el;
};

// ── HSL: hue, saturation or lightness of each band ──

type HslProp = 'hue_deg' | 'saturation' | 'lightness';
const HSL_PROPS: readonly HslProp[] = ['hue_deg', 'saturation', 'lightness'];
const HSL_WORDS: Record<HslProp, string> = { hue_deg: 'Hue', saturation: 'Saturation', lightness: 'Lightness' };
/** what a band's slider does, as its track (data colours) */
function bandTrack(prop: HslProp, centre: number): string {
  if (prop === 'hue_deg') return `linear-gradient(to right, ${oklchCss(centre - 60)}, ${oklchCss(centre)}, ${oklchCss(centre + 60)})`;
  if (prop === 'saturation') return `linear-gradient(to right, ${oklchCss(centre, 0)}, ${oklchCss(centre, 0.17)})`;
  return `linear-gradient(to right, ${oklchCss(centre, 0.08, 0.32)}, ${oklchCss(centre, 0.08, 0.92)})`;
}

const hsl: Renderer = (n, m) => {
  const id = String(n.props['entry']);
  const frame: Frame = (s) => frameOf(n, s);
  const g = gestureOf(m, frame);
  const of = argSpec('hsl', 'bands').of!;
  const el = h('div', { class: 'cb-ed cb-ed-hsl', 'data-entry': id });
  const seg = segmented(m, 'Adjust', HSL_PROPS, {
    word: (v) => HSL_WORDS[v as HslProp],
    read: (s) => s.stack?.hsl ?? 'saturation',
    write: (v) => m.rctx().set({ stack: { hsl: v } }),
  });
  const rows = h('div', { class: 'cb-ed-bands' });
  const widths = h('details', { class: 'cb-stack-adv cb-ed-widths' }, h('summary', { text: 'Band widths' }));
  const resetB = btn('Reset', 'cb-ed-reset', { 'aria-label': 'Reset the bands' });
  listen(m.scope, resetB, 'click', () => {
    const d = g.doc();
    const e = d ? findEntry(d, id)?.entry : undefined;
    const bands = e && e.kind === 'layer' ? ((e.params as any)['bands'] as Coll<Record<string, number>>) : undefined;
    if (!bands || !Coll.is(bands)) return;
    g.set(Coll.ids(bands).flatMap((b) => HSL_PROPS.map((p) => [`${b}.${p}`, 0] as const)), `${nameOf(g, id)}: reset`);
  });
  el.append(h('div', { class: 'cb-ed-bar' }, seg, resetB), rows, widths);
  let scope: MountCtx | null = null;
  m.cell((s) => {
    const p = paramsIn(s, frame, id);
    const b = p?.['bands'];
    const ids = Coll.is(b) ? Coll.entries(b as Coll<Record<string, number>>).map(([bid, x]) => `${bid}:${x['centre_deg']}`).join(',') : '';
    return `${s.stack?.hsl ?? 'saturation'}|${ids}`;
  }, (key) => {
    scope?.scope.dispose();
    scope = m.child('bands');
    const sm = scope;
    rows.replaceChildren();
    for (const x of [...widths.children].slice(1)) x.remove();
    const [prop, list] = key.split('|') as [HslProp, string];
    if (!list) return void rows.append(h('p', { class: 'cb-empty', text: 'This layer has no hue bands.' }));
    const spec = of[prop]!;
    for (const item of list.split(',')) {
      const [bid, c] = item.split(':') as [string, string];
      const centre = Number(c);
      const word = bandWord(centre);
      const path = `${bid}.${prop}`;
      const sw = h('span', { class: 'cb-ed-swatch', 'aria-hidden': 'true' });
      sw.style.background = oklchCss(centre);
      rows.append(numberControl(sm, {
        label: word, path, frame, min: spec.min!, max: spec.max!, step: prop === 'hue_deg' ? 1 : 0.01,
        show: (v) => (prop === 'hue_deg' ? `${v > 0 ? '+' : ''}${Math.round(v)}°` : pct(v)), parse: prop === 'hue_deg' ? parseDeg : parsePct, stepLabel: `${word} ${HSL_WORDS[prop].toLowerCase()}`,
        tip: spec.doc, lead: sw, track: bandTrack(prop, centre), cls: 'cb-ed-band', read: (s) => numAt(s, frame, path) ?? 0,
      }));
      const ws = of['width_deg']!;
      widths.append(numberControl(sm, {
        label: word, path: `${bid}.width_deg`, frame, min: ws.min!, max: ws.max!, step: 1, show: (v) => `${Math.round(v)}°`, parse: parseDeg, stepLabel: `${word} band width`,
        tip: ws.doc, cls: 'cb-ed-band', read: (s) => numAt(s, frame, `${bid}.width_deg`) ?? 45,
      }));
    }
  });
  return el;
};

// ── colour grading: three wheels (hue around, strength out), lightness under each ──

const WHEELS = [['shadows', 'Shadows'], ['midtones', 'Midtones'], ['highlights', 'Highlights']] as const;
const grade: Renderer = (n, m) => {
  const id = String(n.props['entry']);
  const frame: Frame = (s) => frameOf(n, s);
  const g = gestureOf(m, frame);
  const el = h('div', { class: 'cb-ed cb-ed-grade', 'data-entry': id });
  const row = h('div', { class: 'cb-ed-wheels' });
  for (const [w, word] of WHEELS) {
    const hueP = `${id}.params.${w}Hue_deg`;
    const chP = `${id}.params.${w}Chroma`;
    const cs = argSpec('grade', `${w}Chroma`);
    // the rim is the usual strongest tint (a stronger one is typed); strength = r · rim
    const rim = cs.usual?.[1] ?? cs.max ?? 0.1;
    const step = cs.ui?.step ?? 0.002;
    const hold = (r: number): number => Number((Math.round((Math.max(0, Math.min(1, r)) * rim) / step) * step).toFixed(4));
    const pair = (v: { hue: number; r: number }) => [[hueP, Number(((v.hue + 360) % 360).toFixed(1))], [chP, hold(v.r)]] as const;
    const wd = wheelDisc(m.scope, {
      size: 88, label: word, step: { hue: 1, r: step / rim },
      puck: (v) => (v.r > 0 ? oklchCss(v.hue, Math.min(0.2, 0.04 + v.r * 0.14), 0.7) : ''),
      preview: (v) => {
        for (const [p, x] of pair(v)) g.preview(p, x);
      },
      commit: () => g.commit(`${nameOf(g, id)} ${word.toLowerCase()} tint`),
      cancel: () => g.cancel(),
      nudge: (v) => g.set(pair(v), `${nameOf(g, id)} ${word.toLowerCase()} tint`, `${id}.${w}.wheel`),
      reset: () => g.set([[chP, 0]], `${nameOf(g, id)} ${word.toLowerCase()} tint: reset`),
    });
    wd.disc.classList.add('cb-ed-disc');
    const read = h('div', { class: 'ck-wheel-r cb-ed-read' });
    m.cell((s) => {
      const p = paramsIn(s, frame, id);
      return p ? `${p[`${w}Hue_deg`] ?? argSpec('grade', `${w}Hue_deg`).default}|${p[`${w}Chroma`] ?? 0}` : '';
    }, (k) => {
      if (!k) return;
      const [hue, c] = k.split('|').map(Number) as [number, number];
      wd.set({ hue, r: c / rim });
      wd.disc.setAttribute('aria-valuetext', `hue ${Math.round(hue)}°, strength ${c.toFixed(3)}`);
      read.textContent = c > 0 ? `${Math.round(hue)}° · ${c.toFixed(3)}` : 'none';
    });
    const ls = argSpec('grade', `${w}Lightness`);
    const lum = numberControl(m, {
      label: '', path: `${id}.params.${w}Lightness`, frame, min: ls.min!, max: ls.max!, step: ls.ui?.step ?? 0.01, show: pct, parse: parsePct, stepLabel: `${word} lightness`,
      tip: `${word}: lightness`, cls: 'cb-ed-lum', read: (s) => numAt(s, frame, `${id}.params.${w}Lightness`) ?? 0,
    });
    row.append(h('div', { class: 'ck-wheel cb-ed-wheel', 'data-wheel': w }, h('div', { class: 'ck-wheel-l', text: word }), wd.disc, read, lum));
  }
  el.append(row, h('p', { class: 'cb-dim cb-ed-hint', text: 'Drag in a wheel: around is the hue, out is the strength (Shift keeps the hue, Alt is fine); double-click the dot to clear it.' }));
  return el;
};

// ── the channel mixer: a 3 × 3 grid, or monochrome from weighted channels ──

const ROWS = [['red', 'Red'], ['green', 'Green'], ['blue', 'Blue']] as const;
/** one cell of the grid: type a value, arrows step it, drag sideways to scrub (one step per gesture) */
function mixCell(m: MountCtx, frame: Frame, g: Gesture, id: Id, arg: string, k: number, label: string): HTMLElement {
  const path = `${id}.params.${arg}`;
  const spec = argSpec('mixer', arg);
  const [lo, hi] = [spec.min ?? -2, spec.max ?? 2];
  const field = h('input', { type: 'text', class: 'cb-num cb-ed-cell', 'aria-label': `${label} from ${'RGB'[k]}`, spellcheck: 'false', 'data-arg': arg, 'data-k': String(k) }) as HTMLInputElement;
  let v = 0;
  let vec: number[] = [0, 0, 0];
  const show = (x: number): string => x.toFixed(2);
  const withK = (x: number): number[] => vec.map((y, i) => (i === k ? Number(Math.min(hi, Math.max(lo, x)).toFixed(3)) : y));
  m.cell((s) => {
    const p = paramsIn(s, frame, id);
    const a = (p?.[arg] as number[] | undefined) ?? (spec.default as number[]);
    return a.join(',');
  }, (x) => {
    vec = x.split(',').map(Number);
    v = vec[k] ?? 0;
    if (document.activeElement !== field) field.value = show(v);
    field.classList.toggle('is-zero', v === 0);
  });
  listen(m.scope, field, 'keydown', (e: KeyboardEvent) => {
    e.stopPropagation();
    const dir = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
    if (dir) {
      e.preventDefault();
      // the store's vector (a run of presses is faster than the cell)
      const d = g.doc();
      const pe = d ? findEntry(d, id)?.entry : undefined;
      const now = pe && pe.kind === 'layer' ? ((pe.params as any)[arg] as number[] | undefined) : undefined;
      if (now) {
        vec = [...now];
        v = vec[k] ?? v;
      }
      g.set([[path, withK(v + dir * (e.shiftKey ? 0.1 : 0.01))]], `${nameOf(g, id)} ${label.toLowerCase()}`, `${path}.${k}`);
      field.value = show(Math.min(hi, Math.max(lo, v + dir * (e.shiftKey ? 0.1 : 0.01))));
    } else if (e.key === 'Enter') {
      const x = Number(field.value.replace(',', '.'));
      if (!Number.isFinite(x) || field.value.trim() === '') {
        field.classList.add('is-bad');
        m.rt.chrome.toast(`${label}: "${field.value}" is not a value`, { kind: 'warn', ms: 3000 });
        return;
      }
      field.classList.remove('is-bad');
      g.set([[path, withK(x)]], `${nameOf(g, id)} ${label.toLowerCase()} ${show(x)}`);
      field.blur();
    } else if (e.key === 'Escape') {
      field.value = show(v);
      field.blur();
    }
  });
  listen(m.scope, field, 'blur', () => void (field.value = show(v)));
  // drag sideways to scrub: a click without a move types
  listen(m.scope, field, 'pointerdown', (e: PointerEvent) => {
    if (e.button !== 0 || document.activeElement === field) return;
    const x0 = e.clientX;
    const v0 = v;
    let moved = false;
    e.preventDefault();
    drag(e, {
      cursor: 'ew-resize',
      move: (ev) => {
        const dx = ev.clientX - x0;
        if (!moved && Math.abs(dx) < 3) return;
        moved = true;
        g.preview(path, withK(Math.round((v0 + dx * (ev.shiftKey ? 0.001 : 0.005)) * 100) / 100));
      },
      up: () => {
        if (moved) g.commit(`${nameOf(g, id)} ${label.toLowerCase()}`);
        else {
          field.focus();
          field.select();
        }
      },
      cancel: () => g.cancel(),
    });
  });
  return field;
}

const mixer: Renderer = (n, m) => {
  const id = String(n.props['entry']);
  const frame: Frame = (s) => frameOf(n, s);
  const g = gestureOf(m, frame);
  const el = h('div', { class: 'cb-ed cb-ed-mixer', 'data-entry': id });
  const mono = h('input', { type: 'checkbox', class: 'cb-ed-mono', 'aria-label': 'Monochrome' }) as HTMLInputElement;
  listen(m.scope, mono, 'change', () => g.set([[`${id}.params.monochrome`, mono.checked]], `${nameOf(g, id)}: ${mono.checked ? 'monochrome' : 'colour'}`));
  const reset = btn('Reset', 'cb-ed-reset', { 'aria-label': 'Reset the mixer' });
  listen(m.scope, reset, 'click', () => g.set(['red', 'green', 'blue', 'grey'].map((a) => [`${id}.params.${a}`, argSpec('mixer', a).default] as const), `${nameOf(g, id)}: reset`));
  const grid = h('div', { class: 'cb-ed-grid', role: 'grid', 'aria-label': 'Channel mixer' });
  const head = ['', 'R', 'G', 'B', 'Σ'].map((t) => h('span', { class: 'cb-ed-gh', text: t }));
  grid.append(...head);
  const sums: Record<string, HTMLElement> = {};
  const rowEls: HTMLElement[][] = [];
  const line = (arg: string, word: string): void => {
    const cells = [h('span', { class: 'cb-ed-gl', text: word }), mixCell(m, frame, g, id, arg, 0, word), mixCell(m, frame, g, id, arg, 1, word), mixCell(m, frame, g, id, arg, 2, word), (sums[arg] = h('span', { class: 'cb-ed-sum' }))];
    rowEls.push(cells);
    grid.append(...cells);
  };
  for (const [a, w] of ROWS) line(a, w);
  line('grey', 'Grey');
  el.append(h('div', { class: 'cb-ed-bar' }, h('label', { class: 'cb-ed-switch' }, mono, h('span', { text: 'Monochrome' })), reset), grid,
    h('p', { class: 'cb-dim cb-ed-hint', text: 'Each output channel from the input R, G, B (linear light); a row summing to 1 keeps a neutral’s brightness. Drag a cell sideways or type.' }));
  m.cell((s) => {
    const p = paramsIn(s, frame, id) ?? {};
    const vec = (a: string) => ((p[a] as number[] | undefined) ?? (argSpec('mixer', a).default as number[]));
    return JSON.stringify({ mono: !!p['monochrome'], sums: Object.fromEntries(['red', 'green', 'blue', 'grey'].map((a) => [a, vec(a).reduce((x, y) => x + y, 0)])) });
  }, (k) => {
    const v = JSON.parse(k) as { mono: boolean; sums: Record<string, number> };
    mono.checked = v.mono;
    el.classList.toggle('is-mono', v.mono);
    rowEls.forEach((cells, i) => {
      const isGrey = i === 3;
      for (const c of cells) (c as HTMLElement).hidden = isGrey ? !v.mono : v.mono;
    });
    for (const [a, s] of Object.entries(v.sums)) {
      sums[a]!.textContent = s.toFixed(2);
      sums[a]!.classList.toggle('is-off', Math.abs(s - 1) > 0.005);
    }
  });
  return el;
};

/** the editors' renderers (part of STACK_RENDERERS) */
export const EDITOR_RENDERERS: Record<string, Renderer> = { 'stack.curve': curve, 'stack.levels': levels, 'stack.hsl': hsl, 'stack.grade': grade, 'stack.mixer': mixer };
