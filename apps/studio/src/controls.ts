// Controls generated from ArgSpec.ui (the registry is the single source of truth). A slider moves in
// its display unit; dragging previews, releasing applies one mutation (DR-6). The widget clamps its
// own gesture; the contract never clamps (DR-2). CHB-009 grows this into the full control set.
import { argPath, convert, getOp, type EditLog, type Unit, type Vec3 } from '@chromobench/contract';

export function vec3Slider(host: HTMLElement, log: () => EditLog | null, opName: string, argName: string): void {
  const op = getOp(opName);
  const spec = op.args[argName]!;
  const path = argPath(op, argName, spec)!;
  const unit = spec.unit as Unit;
  const shown = (spec.ui?.displayUnit ?? unit) as Unit;
  const toShown = (v: number): number => convert(v, unit, shown);
  const fromShown = (v: number): number => convert(v, shown, unit);
  const step = toShown(spec.ui?.step ?? 0.01);
  const fs = document.createElement('fieldset');
  fs.innerHTML = `<legend>${spec.ui?.label ?? argName} (${shown})</legend>`;
  const labels = spec.ui?.components ?? ['R', 'G', 'B'];
  const inputs: HTMLInputElement[] = [];
  labels.forEach((lab, k) => {
    const row = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(Math.round(toShown(spec.min ?? -1)));
    input.max = String(Math.round(toShown(spec.max ?? 1)));
    input.step = String(step);
    input.value = '0';
    input.dataset['path'] = path;
    input.dataset['component'] = String(k);
    input.setAttribute('aria-label', `${spec.ui?.label ?? argName} ${lab}`);
    const out = document.createElement('output');
    out.textContent = '0';
    row.append(lab, input, out);
    fs.append(row);
    inputs.push(input);
    const value = (): Vec3 => inputs.map((i) => fromShown(Number(i.value))) as Vec3;
    input.addEventListener('input', () => {
      out.textContent = input.value;
      log()?.preview({ op: 'set', path, value: value() });
    });
    input.addEventListener('change', () => {
      const l = log();
      if (!l) return;
      l.apply([{ op: 'set', path, value: value() }], 'user', spec.ui?.label ?? path);
    });
  });
  // Keep the sliders in sync with the committed state (undo, redo, approvals).
  (host as HTMLElement & { syncFrom?: (v: Vec3) => void }).syncFrom = (v: Vec3) => {
    inputs.forEach((i, k) => {
      i.value = String(Math.round(toShown(v[k]!) * 1e6) / 1e6);
      (i.nextElementSibling as HTMLOutputElement).textContent = i.value;
    });
  };
  host.append(fs);
}
