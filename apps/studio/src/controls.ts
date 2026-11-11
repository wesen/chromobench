// Controls generated from ArgSpec.ui (the registry is the single source of truth), drawn in
// Chromogen Studio's slider style (.ctl: label, aside unit, value; hairline track, zero tick, fill
// from zero). A slider moves in its display unit; dragging previews, releasing applies one
// mutation (DR-6). The widget clamps its own gesture; the contract never clamps (DR-2).
// CHB-009 grows this into the full control set.
import { argPath, convert, getOp, type EditLog, type Unit, type Vec3 } from '@chromobench/contract';

const CHANNEL_SWATCH = ['var(--pR)', 'var(--pG)', 'var(--pB)'];

export interface Vec3Control {
  /** Moves the sliders to a committed value (undo, redo, approvals). */
  sync(v: Vec3): void;
}

export function vec3Slider(host: HTMLElement, log: () => EditLog | null, opName: string, argName: string): Vec3Control {
  const op = getOp(opName);
  const spec = op.args[argName]!;
  const path = argPath(op, argName, spec)!;
  const unit = spec.unit as Unit;
  const shown = (spec.ui?.displayUnit ?? unit) as Unit;
  const toShown = (v: number): number => convert(v, unit, shown);
  const fromShown = (v: number): number => convert(v, shown, unit);
  const lo = Math.round(toShown(spec.min ?? -1));
  const hi = Math.round(toShown(spec.max ?? 1));
  const step = toShown(spec.ui?.step ?? 0.01);
  const labels = spec.ui?.components ?? ['R', 'G', 'B'];
  const fmt = (v: number): string => `${v > 0 ? '+' : ''}${Math.round(v * 100) / 100}`;
  const frac = (v: number): number => (v - lo) / (hi - lo);
  const inputs: HTMLInputElement[] = [];
  const paint: Array<() => void> = [];

  labels.forEach((lab, k) => {
    const ctl = document.createElement('div');
    ctl.className = 'ctl';
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('label');
    const sw = document.createElement('i');
    sw.style.background = CHANNEL_SWATCH[k] ?? 'var(--ink)';
    label.append(sw, `${spec.ui?.label ?? argName} ${lab}`);
    const aside = document.createElement('span');
    aside.className = 'aside';
    aside.textContent = shown === 'point' ? 'pt' : shown;
    const val = document.createElement('output');
    val.className = 'val';
    row.append(label, aside, val);

    const track = document.createElement('div');
    track.className = 'track';
    const fill = document.createElement('span');
    fill.className = 'fillbar';
    const zero = document.createElement('span');
    zero.className = 'zero';
    zero.style.left = `calc(${frac(0) * 100}% + ${4 - 8 * frac(0)}px)`;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(lo);
    input.max = String(hi);
    input.step = String(step);
    input.value = '0';
    input.dataset['path'] = path;
    input.dataset['component'] = String(k);
    input.setAttribute('aria-label', `${spec.ui?.label ?? argName} ${lab}`);
    input.title = spec.doc;
    track.append(fill, zero, input);
    ctl.append(row, track);
    host.append(ctl);
    inputs.push(input);

    const draw = (): void => {
      const v = Number(input.value);
      val.textContent = fmt(v);
      const a = frac(Math.min(0, v));
      const b = frac(Math.max(0, v));
      // thumb centres run from 4px to width-4px (8px thumb)
      fill.style.left = `calc(${a * 100}% + ${4 - 8 * a}px)`;
      fill.style.width = `calc(${(b - a) * 100}% - ${8 * (b - a)}px)`;
      ctl.classList.toggle('changed', v !== 0);
    };
    paint.push(draw);
    draw();

    const value = (): Vec3 => inputs.map((i) => fromShown(Number(i.value))) as Vec3;
    input.addEventListener('input', () => {
      draw();
      log()?.preview({ op: 'set', path, value: value() });
    });
    input.addEventListener('change', () => {
      log()?.apply([{ op: 'set', path, value: value() }], 'user', `${spec.ui?.label ?? path} ${labels.map((l, j) => `${l} ${fmt(Number(inputs[j]!.value))}`).join(' ')}`);
    });
  });

  return {
    sync(v: Vec3) {
      inputs.forEach((i, k) => {
        i.value = String(Math.round(toShown(v[k]!) * 1e6) / 1e6);
        paint[k]!();
      });
    },
  };
}
