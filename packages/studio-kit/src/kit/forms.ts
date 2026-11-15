// The headless half of studio-kit's forms: slots with binding times, docs and explain words. Renderers live in
// src/dom (passed to mount as `renderers`), so layouts build and explain in Node.
import { slot, type FormSpec, type NodeData } from '@chromobench/shell';
import { argModel, parseStep } from './args.ts';
import { formatStops } from '../model/units.ts';

const { build: b, traced: t, handler: h } = slot;

function argWords(n: NodeData): string | null {
  const a = argModel(String(n.props['path']));
  if (!a) return null;
  const m = a.model;
  const widget = (n.props['widget'] as string) || m.widget;
  const words = [widget];
  const unit = m.storageUnit === 'fstop' ? 'f' : m.displayUnit === 'point' ? 'pt' : m.storageUnit === 'stop' ? 'st' : m.storageUnit;
  if (unit && unit !== 'none') words.push(unit);
  if (m.scale === 'log2') words.push('log2');
  const step = parseStep(n.props['step']);
  if (m.storageUnit === 's' && m.scale === 'log2') words.push(`step ${formatStops(step?.value ?? m.step).replace('+', '')} st`);
  else if (step) words.push(`step ${n.props['step']}`);
  else if (m.type !== 'enum' && m.type !== 'string' && m.storageUnit !== 'fstop') words.push(`step ${Number(m.step.toFixed(3))} ${unit}`.trim());
  if (m.aside) words.push(`aside ${m.storageUnit === 's' || m.storageUnit === 'fstop' ? 'st' : m.storageUnit === 'CC' ? 'pt' : 'log H'}`);
  if (m.detents.length) words.push(`detent ${m.detents.join(',')}`);
  if (a.component !== null) words.push(`component ${m.components?.[a.component] ?? a.component}`);
  if (n.props['strip']) words.push(`+testStrip(${(n.props['strip'] as { step?: string }).step ?? '1/3 st'})`);
  return words.join('  ');
}

const spec = (name: string, slots: FormSpec['slots'], doc: string, extra: Partial<FormSpec> = {}): FormSpec => ({ name, slots, doc, kind: 'cb', ...extra });

export const argForm = spec(
  'cb.arg',
  {
    path: b<string>('a document path (main.params.time_s, stages.darkroom.medium.paper) or a component (main.params.filtration.y)'),
    label: b<string>(),
    step: b<string | number>("a darkroom step: '1/3 st', '5 CC', '2 pt'"),
    widget: b<string>('slider · stepper · segmented · select · toggle · pad · nudge'),
    frame: t<string | null>('the frame it edits (default: the selected one)'),
    strip: b<Record<string, unknown>>('set by .testStrip()'),
    labels: b<[string, string]>('nudge: the decrease and increase labels'),
    axis: b<string>("nudge on the lights: 'yellow-blue' or 'magenta-green'"),
    big: b<boolean>(),
  },
  'A control generated from the op registry: unit, scale, step, detents and second readout come from ArgSpec.ui',
  { explain: argWords },
);

const panelSpec = (name: string, doc: string, slots: FormSpec['slots'] = {}): FormSpec => spec(name, { compact: b<boolean>(), frame: t<string | null>(), ...slots }, doc);

export const CB_FORMS: FormSpec[] = [
  argForm,
  panelSpec('cb.history', "The frame's steps in the document log, in darkroom words, author, cursor; click moves the log's cursor there"),
  panelSpec('cb.approvals', 'One card per pending agent proposal: Show · Approve (the checked changes) · Reject; Approve all; Apply anyway on E_STALE'),
  panelSpec('cb.why', 'Why the focused control has its value (the log\'s trail of the path)'),
  panelSpec('cb.snapshots', 'Named versions of the frame\'s document; restore is one step'),
  panelSpec('cb.exposures', 'The darkroom layers (main, burns, dodges, flashes, preflash, density masks, filters) and the printing script'),
  panelSpec('cb.journal', 'The log\'s journal for the frame: seq, status, by, transaction, mutations'),
  panelSpec('cb.nodes', 'The display closure with node ids and evaluation counts'),
  panelSpec('cb.explain', 'This studio, explained'),
  panelSpec('cb.metadata', 'The selected frame: name, SHA-256, size, flag, stars'),
  panelSpec('cb.library', 'The roll: frames by flag, counts'),
  panelSpec('cb.densitometer', 'Pinned probes and their densities'),
  panelSpec('cb.output', 'Save the print (CHB-011 replaces this with export and colour management)', { simple: b<boolean>() }),
  spec('cb.steps', { steps: b<string[]>(), labels: b<Record<string, string>>() }, 'Step buttons for view.step with Next and Back'),
  spec('cb.readout', { frame: t<string | null>() }, 'The densitometer line under the probe'),
  spec('cb.ribbon', { frame: t<string | null>() }, 'The ribbon over a shown agent proposal'),
  spec('cb.filter', { onChange: h() }, 'Search and flag filter for the library'),
];
