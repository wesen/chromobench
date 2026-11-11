// v0 catalog: measure (CHB-003, CHB-005), darkroom (CHB-010), finishing (CHB-015).
import { defineOp, type OpDef } from '../registry.ts';

export const measureOps: OpDef[] = [
  defineOp({
    name: 'measure.stats', area: 'measure', owner: 'CHB-003', on: 'Image', returns: 'Value', domainIn: 'any',
    class: 'measure', binding: 'pixel',
    args: {
      box: { type: 'box', unit: 'px', optional: true, doc: 'Region in source px; absent = whole image.' },
      mask: { type: 'Mask', optional: true, doc: 'Weighting mask.' },
    },
    fields: [
      { name: 'mean', type: 'vec3', doc: "mean per channel, in the domain's unit" },
      { name: 'p01', type: 'vec3', doc: '1st percentile' },
      { name: 'p99', type: 'vec3', doc: '99th percentile' },
      { name: 'clipLow', type: 'number', unit: 'fraction', doc: 'fraction at or below the domain minimum' },
      { name: 'clipHigh', type: 'number', unit: 'fraction', doc: 'fraction at or above the domain maximum' },
    ],
    doc: 'Exact statistics over a region.',
  }),
  defineOp({
    name: 'measure.histogram', area: 'measure', owner: 'CHB-003', on: 'Image', returns: 'Value', domainIn: 'any',
    class: 'measure', binding: 'pixel',
    args: {
      channel: { type: 'enum', values: ['r', 'g', 'b', 'L'], default: 'L', doc: 'Channel (L = mean of channels).' },
      bins: { type: 'number', unit: 'none', min: 8, max: 1024, integer: true, default: 64, doc: 'Number of bins.' },
    },
    fields: [
      { name: 'edges', type: 'table', doc: 'bins + 1 edges over the domain range' },
      { name: 'counts', type: 'table', doc: 'counts per bin' },
    ],
    doc: 'Histogram over the domain range.',
  }),
  defineOp({
    name: 'measure.densitometer', area: 'measure', owner: 'CHB-003', on: 'Image', returns: 'Value',
    domainIn: ['scanner-density', 'film-dyes', 'printing-density', 'paper-dyes', 'print-xyz'],
    class: 'measure', binding: 'pixel',
    args: {
      at: { type: 'point', unit: 'px', default: { x: 0, y: 0 }, doc: 'Centre in source px.' },
      aperture_px: { type: 'number', unit: 'px', min: 1, max: 200, default: 9, doc: 'Aperture diameter.' },
      response: { type: 'enum', values: ['status-a', 'status-m', 'visual'], optional: true, doc: 'Densitometric response; absent = chosen by domain.' },
    },
    fields: [
      { name: 'D', type: 'vec3', unit: 'D', doc: 'density per channel' },
      { name: 'visual', type: 'number', unit: 'D', optional: true, doc: 'visual density (print-xyz only)' },
    ],
    doc: 'Reads densities at a point, like a hand densitometer.',
  }),
  defineOp({
    name: 'measure.patches', area: 'measure', owner: 'CHB-003', on: 'Image', returns: 'Value', domainIn: 'any',
    class: 'measure', binding: 'pixel',
    args: {
      box: { type: 'box', unit: 'px', optional: true, doc: 'Region; absent = whole image.' },
      cols: { type: 'number', unit: 'none', min: 1, max: 24, integer: true, default: 1, doc: 'Columns.' },
      rows: { type: 'number', unit: 'none', min: 1, max: 24, integer: true, default: 1, doc: 'Rows.' },
    },
    fields: [{ name: 'cells', type: 'table', doc: 'rows {cell, D: vec3, visual}' }],
    doc: 'Mean value per grid cell (test strips, ring-arounds, charts).',
  }),
];

const VARY = ['time', 'lights.r', 'lights.g', 'lights.b', 'filtration.c', 'filtration.m', 'filtration.y', 'grade'];

export const darkroomOps: OpDef[] = [
  defineOp({
    name: 'darkroom.testStrip', area: 'darkroom', owner: 'CHB-010', on: 'Image', returns: 'Image', domainIn: 'film-dyes', domainOut: 'print-xyz',
    class: 'decoration', binding: 'setting',
    args: {
      vary: { type: 'enum', values: VARY, default: 'time', doc: 'Quantity varied across the strip.' },
      steps: { type: 'number', unit: 'none', min: 2, max: 12, integer: true, default: 7, doc: 'Number of bands.' },
      step: { type: 'number', unit: 'none', default: 0.5, doc: "Step in the varied quantity's display unit: stops (time), points (lights), CC (filtration), grades." },
      direction: { type: 'enum', values: ['horizontal', 'vertical'], default: 'vertical', doc: 'Band direction.' },
    },
    validate: (a) => {
      const v = a['vary'] as string;
      const s = Math.abs(a['step'] as number);
      const max = v === 'time' ? 2 : v.startsWith('lights') ? 20 : v.startsWith('filtration') ? 50 : 1;
      return s > 0 && s <= max ? null : `step for ${v} must be in (0, ${max}]`;
    },
    doc: "A test strip of the receiver's print, each band printed with its own setting.",
  }),
  defineOp({
    name: 'darkroom.ringAround', area: 'darkroom', owner: 'CHB-010', on: 'Image', returns: 'Image', domainIn: 'film-dyes', domainOut: 'print-xyz',
    class: 'decoration', binding: 'setting',
    args: {
      step_cc: { type: 'number', unit: 'CC', min: 2, max: 40, default: 10, doc: 'Filtration step between prints.' },
      rings: { type: 'number', unit: 'none', min: 1, max: 2, integer: true, default: 1, doc: 'Number of rings.' },
    },
    doc: 'A ring-around: the print surrounded by prints with more and less of each filter.',
  }),
  defineOp({
    name: 'darkroom.contactSheet', area: 'darkroom', owner: 'CHB-010', on: 'none', returns: 'Image', domainOut: 'print-xyz',
    class: 'decoration', binding: 'setting',
    args: {
      frames: { type: 'string[]', default: [], doc: 'Frame ids.' },
      cell_px: { type: 'number', unit: 'px', min: 64, max: 1024, integer: true, default: 256, doc: 'Cell size.' },
    },
    doc: 'A contact sheet of several frames.',
  }),
  defineOp({
    name: 'darkroom.lightsToFiltration', area: 'darkroom', owner: 'CHB-010', on: 'Image', returns: 'Value', domainIn: 'film-dyes',
    class: 'measure', binding: 'setting',
    args: { logH: { type: 'vec3', unit: 'logH', min: -1.5, max: 1.5, default: [0, 0, 0], doc: 'Printer lights to express as filtration.' } },
    fields: [
      { name: 'filtration', type: 'object', unit: 'CC', doc: '{c, m, y} equivalent filtration' },
      { name: 'residual', type: 'number', unit: 'logH', doc: 'what filtration cannot reproduce' },
    ],
    doc: 'Expresses printer lights as colour-head filtration plus time.',
  }),
];

export const finishingOps: OpDef[] = [
  defineOp({
    name: 'finishing.clarity', area: 'finishing', owner: 'CHB-015', on: 'Image', returns: 'Image', domainIn: 'print-xyz', domainOut: 'print-xyz',
    class: 'spatial', binding: 'setting',
    args: {
      amount: { type: 'number', unit: 'fraction', min: -1, max: 1, default: 0, path: 'finishing.values.clarity', doc: 'Local contrast.', ui: { widget: 'slider', step: 0.01, label: 'Clarity', group: 'Finishing' } },
      radius_px: { type: 'number', unit: 'px', min: 5, max: 200, default: 40, path: 'finishing.values.clarity_radius_px', doc: 'Radius.' },
    },
    doc: 'Local contrast on the print, before output.display.',
  }),
  defineOp({
    name: 'finishing.hue', area: 'finishing', owner: 'CHB-015', on: 'Image', returns: 'Image', domainIn: 'print-xyz', domainOut: 'print-xyz',
    class: 'pointwise', binding: 'setting',
    args: {
      family: { type: 'enum', values: ['reds', 'skin', 'yellows', 'greens', 'blues', 'purples'], default: 'reds', doc: 'Hue family.' },
      shift_deg: { type: 'number', unit: 'deg', min: -30, max: 30, default: 0, doc: 'Hue shift.' },
    },
    doc: 'Shifts one hue family (recipe: finishing.hues.<family>).',
  }),
];
