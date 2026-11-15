// Golden stacks (CHB-037 P8a): documents with the digital layers of the composite stages (contract 1.1), built on two
// balanced golden cases (the first print of the negative, the auto balance of the camera file) and rendered on the
// reference engine like every case. They have no P0 recipe: this file is their provenance, as translate.ts is the
// others'.
//
//   node tools/goldens/stacks.ts                    write every stack's document.json and its index entry (no pictures)
//   node tools/goldens/render.ts --only <ids>       render them (the ids are printed)
import { edit, type Document, type Entry, type Mask, type MaskComponent, type Params } from '@chromobench/contract';
import { Coll, insert, type Json, type Mutation } from '@chromobench/values';
import { readIndex, readJSON, writeData, type IndexCase } from './golden.ts';

const C = (items: [string, Record<string, unknown>][]): Json => Coll.of(items) as unknown as Json;
const L = (op: string, params: Params, over: Partial<Entry> = {}): Entry =>
  ({ kind: 'layer', op, params, name: op, enabled: true, amount: 1, mask: null, blend: 'normal', source: { kind: 'user' }, ...over }) as Entry;
const G = (name: string, items: [string, Entry][], over: Partial<Entry> = {}): Entry =>
  ({ kind: 'group', stack: Coll.of(items), name, enabled: true, amount: 1, mask: null, blend: 'pass', source: { kind: 'user' }, ...over }) as Entry;
const comp = (kind: MaskComponent['kind'], params: Params, combine: MaskComponent['combine'] = 'add', amount = 1): MaskComponent => ({ kind, params, combine, amount, enabled: true });
const mask = (name: string, components: [string, MaskComponent][], over: Partial<Mask> = {}): Mask =>
  ({ name, components: Coll.of(components), feather_mm: 0, invert: false, reads: 'stage-input', ...over });
const print = (id: string, e: Entry): Mutation => insert('stages.print.stack', id, e);
const scene = (id: string, e: Entry): Mutation => insert('stages.scene.stack', id, e);
const curve = (k: string, pts: [number, number][]): Json => C(pts.map(([x, y], i) => [`${k}-p${i}`, { x, y }]));

export interface Stack { id: string; title: string; exercises: string[]; base: 'neg-auto-lights' | 'cam-auto'; edits: Mutation[] }

export const STACKS: readonly Stack[] = [
  {
    id: 'stack-print-tone', base: 'neg-auto-lights',
    title: 'Print tone: exposure +0.3, an S-curve on L, levels on blue, vibrance (one OkLab run, one linear run)',
    exercises: ['exposure', 'curve', 'levels', 'vibrance', 'composite.encode'],
    edits: [
      print('x', L('exposure', { stops: 0.3, offset: -0.004 })),
      print('lb', L('levels', { channel: 'B', black: 0.04, white: 0.97, gamma: 0.92 })),
      print('s', L('curve', { channel: 'L', points: curve('s', [[0, 0.02], [0.25, 0.2], [0.6, 0.66], [1, 0.98]]) })),
      print('v', L('vibrance', { vibrance: 0.35, saturation: 0.05 })),
    ],
  },
  {
    id: 'stack-print-colour', base: 'neg-auto-lights',
    title: 'Print colour: HSL bands, colour grading (teal shadows, warm highlights), a channel mixer at 0.7',
    exercises: ['hsl', 'grade', 'mixer', 'composite.mix'],
    edits: [
      print('h', L('hsl', { bands: C([['hb', { centre_deg: 260, width_deg: 50, hue_deg: -12, saturation: 0.4, lightness: -0.2 }], ['ho', { centre_deg: 55, hue_deg: 6, saturation: -0.15, lightness: 0.25 }], ['hg', { centre_deg: 145, width_deg: 40, hue_deg: 15, saturation: -0.5 }]]) })),
      print('g', L('grade', { shadowsHue_deg: 200, shadowsChroma: 0.04, shadowsLightness: 0.05, highlightsHue_deg: 70, highlightsChroma: 0.03, midtonesLightness: -0.04, balance: 0.2 })),
      print('m', L('mixer', { red: [0.92, 0.1, -0.02], green: [0.04, 0.9, 0.06], blue: [0, 0.12, 0.88] }, { amount: 0.7 })),
    ],
  },
  {
    id: 'stack-print-masked', base: 'neg-auto-lights',
    title: 'Masked layers: a curve under a radial mask, exposure under a colour range intersected with a gradient, a vignette, sharpening',
    exercises: ['mask.radial', 'mask.colour', 'mask.linear', 'mask.combine', 'composite.mix', 'vignette', 'sharpen'],
    edits: [
      insert('masks', 'spot', mask('Centre', [['r1', comp('radial', { box: { x: 18, y: 8, w: 56, h: 46 }, angle_deg: 15, feather: 0.7 })]])),
      insert('masks', 'warm', mask('Warm tones, top', [
        ['c1', comp('colour', { colour: [0.62, 0.03, 0.06], tolerance: 0.06, softness: 0.12 })],
        ['g1', comp('linear', { from: { x: 0, y: 10 }, to: { x: 0, y: 50 } }, 'intersect')],
      ])),
      print('c', L('curve', { points: curve('c', [[0, 0], [0.3, 0.36], [0.7, 0.76], [1, 1]]) }, { mask: 'spot', amount: 0.8 })),
      print('x', L('exposure', { stops: -0.6 }, { mask: 'warm' })),
      print('n', L('vignette', { stops: -0.8, size: 0.35, feather: 0.8 })),
      print('sh', L('sharpen', { strength: 0.7, radius_mm: 0.15 })),
    ],
  },
  {
    id: 'stack-print-blends', base: 'neg-auto-lights',
    title: 'Blend modes and groups: multiply, screen, soft light, luminosity and colour layers; an isolated luminosity group under a mask; a pass group at 0.6',
    exercises: ['composite.mix blend', 'multiply', 'screen', 'soft-light', 'luminosity', 'colour', 'isolated group', 'pass group'],
    edits: [
      insert('masks', 'low', mask('Lower half', [['l1', comp('linear', { from: { x: 0, y: 60 }, to: { x: 0, y: 20 } })]])),
      print('mu', L('curve', { points: curve('mu', [[0, 0], [0.5, 0.42], [1, 1]]) }, { blend: 'multiply', amount: 0.5 })),
      print('sc', L('exposure', { stops: -1 }, { blend: 'screen', amount: 0.6 })),
      print('so', L('curve', { points: curve('so', [[0, 0.1], [1, 0.9]]) }, { blend: 'soft-light', amount: 0.7 })),
      print('lu', L('curve', { points: curve('lu', [[0, 0], [0.4, 0.3], [1, 1]]) }, { blend: 'luminosity' })),
      print('co', L('vibrance', { vibrance: 0.6, saturation: 0.2 }, { blend: 'colour', amount: 0.8 })),
      print('iso', G('Tone only', [['i1', L('exposure', { stops: 0.4 })], ['i2', L('vibrance', { vibrance: 1, saturation: 0.5 })]], { blend: 'luminosity', mask: 'low', amount: 0.9 })),
      print('pg', G('Look', [['p1', L('grade', { shadowsHue_deg: 250, shadowsChroma: 0.05, highlightsHue_deg: 50, highlightsChroma: 0.04 })], ['p2', L('hsl', { bands: C([['pb', { centre_deg: 25, hue_deg: 8, saturation: 0.2 }]]) })]], { amount: 0.6 })),
    ],
  },
  {
    id: 'stack-print-mono', base: 'neg-auto-lights',
    title: 'Black and white from the colour negative: a monochrome mixer with a red filter, levels, split toning by colour grading',
    exercises: ['mixer monochrome', 'levels', 'grade'],
    edits: [
      print('bw', L('mixer', { monochrome: true, grey: [0.45, 0.5, 0.05] })),
      print('lv', L('levels', { black: 0.03, white: 0.96, gamma: 1.1 })),
      print('tone', L('grade', { shadowsHue_deg: 240, shadowsChroma: 0.025, highlightsHue_deg: 75, highlightsChroma: 0.035, balance: -0.1 })),
    ],
  },
  {
    id: 'stack-scene', base: 'cam-auto',
    title: 'The scene stage of a camera file: exposure under a highlight luminance mask (reading scene.input), a curve on R, HSL, then the film; a print vignette',
    exercises: ['scene stage', 'scene.input', 'mask.luminance', 'exposure', 'curve R', 'hsl', 'vignette'],
    edits: [
      insert('masks', 'hi', mask('Highlights', [['hl', comp('luminance', { above: 0.35, softness: 0.25 })]], { reads: 'scene.input' })),
      scene('sx', L('exposure', { stops: -0.7 }, { mask: 'hi' })),
      scene('sr', L('curve', { channel: 'R', points: curve('sr', [[0, 0], [0.5, 0.53], [1, 1]]) })),
      scene('sh', L('hsl', { bands: C([['sb', { centre_deg: 260, saturation: 0.3, lightness: -0.15 }]]) })),
      print('pv', L('vignette', { stops: -0.5, size: 0.4, feather: 0.7 })),
    ],
  },
];

/** A stack's document: its base case's document with the edits (validated by the contract). */
export function stackDocument(s: Stack): Document {
  const base = readIndex().cases.find((c) => c.id === s.base)!;
  return edit(readJSON<Document>(base.document), s.edits).doc;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const index = readIndex();
  for (const s of STACKS) {
    const base = index.cases.find((c) => c.id === s.base)!;
    const document = `cases/${s.id}/document.json`;
    writeData(document, `${JSON.stringify(stackDocument(s), null, 2)}\n`);
    const entry: IndexCase = { id: s.id, title: s.title, exercises: s.exercises, fixture: base.fixture, document, cuts: null, ops: [] };
    const at = index.cases.findIndex((c) => c.id === s.id);
    if (at >= 0) index.cases[at] = { ...entry, cuts: index.cases[at]!.cuts, ops: index.cases[at]!.ops };
    else index.cases.push(entry);
  }
  writeData('index.json', `${JSON.stringify(index, null, 2)}\n`);
  console.log(`wrote ${STACKS.length} stacks; render them: node tools/goldens/render.ts --only ${STACKS.map((s) => s.id).join(',')}`);
}
