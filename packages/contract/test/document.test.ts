// Document format 3 and its validation through the values hooks (design §20–§25, §35).
import { describe, expect, it } from 'vitest';
import { applyTransaction, Coll, insert, move, remove, revertTransaction, set, transaction, tryTransaction, unset, ValueError, equal } from '@chromobench/values';
import {
  ChromobenchError, DOCUMENT_RULES, ERROR_CODES, edit, isChromobenchError, newDocument, readableCuts, toDiagnostic, validateDocument,
  type Document,
} from '@chromobench/contract';
import { G, L, SHA, camDoc, diagOf, linear, maskOf, push, scanDoc, spot, spots } from './helpers.ts';

const first = (d: unknown): string | undefined => validateDocument(d)[0]?.code;

describe('document format 3', () => {
  it('a new document of each kind validates and is frozen-safe JSON', () => {
    expect(validateDocument(scanDoc())).toEqual([]);
    expect(validateDocument(camDoc())).toEqual([]);
    const d = scanDoc();
    expect(Coll.ids(d.stages.darkroom.stack)).toEqual(['main', 'lights']);
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
    expect(newDocument('negative-scan', { sha256: SHA, width: 6000, height: 4000 }).stages.scan!.medium).toMatchObject({ umPerPx: 6 });
    expect(diagOf(() => newDocument('negative-scan', { sha256: SHA })).code).toBe('E_DOCUMENT');
  });

  it('refuses recipes (versions 1 and 2) with a clear message: there is no migration', () => {
    const d = diagOf(() => edit({ version: 2, frame: 'x' } as unknown as Document, []));
    expect(d.code).toBe('E_DOCUMENT');
    expect(validateDocument({ version: 2, print: {} })[0]?.message).toMatch(/recipe \(version 2\).*no migration/);
    expect(first({ ...scanDoc(), format: 4 })).toBe('E_DOCUMENT');
  });

  it('kinds have their stages: a scan has no scene, a camera file no scan', () => {
    const d = scanDoc();
    expect(first({ ...d, stages: { ...d.stages, scene: camDoc().stages.scene } })).toBe('E_DOCUMENT');
    const c = camDoc();
    expect(first({ ...c, stages: { ...c.stages, film: undefined } })).toBe('E_DOCUMENT');
    expect(first({ ...d, extra: 1 })).toBe('E_PATH');
  });

  it('media are checked by the ArgSpecs of the ops that consume them', () => {
    expect(diagOf(() => edit(scanDoc(), [set('stages.darkroom.medium.grade', 9)]))).toMatchObject({ code: 'E_ARG_RANGE', path: 'stages.darkroom.medium.grade' });
    expect(diagOf(() => edit(scanDoc(), [set('stages.scan.medium.stok', 'x')]))).toMatchObject({ code: 'E_PATH', hint: 'did you mean stock?' });
    expect(diagOf(() => edit(scanDoc(), [set('stages.scan.medium.rebate', { x: 0, y: 0, w: -1, h: 4 })])).code).toBe('E_ARG_RANGE');
    expect(edit(scanDoc(), [set('stages.scan.medium.rebate', { x: 0, y: 0, w: 2, h: 4 })]).doc.stages.scan!.medium).toMatchObject({ rebate: { w: 2 } });
    expect(edit(scanDoc(), [set('stages.scan.medium.flare', [0.5, 0.4, 0.3])]).doc.stages.scan!.medium).toMatchObject({ flare: [0.5, 0.4, 0.3] });
    expect(diagOf(() => edit(scanDoc(), [unset('stages.print.medium.flare')])).code).toBe('E_DOCUMENT');
    expect(diagOf(() => edit(scanDoc(), [set('geometry.orientation', 'sideways')])).code).toBe('E_ARG_RANGE');
    expect(diagOf(() => edit(camDoc(), [set('stages.scan.medium.stock', 'x')])).code).toBe('E_PATH');
  });

  it('layer params are checked by their op: ranges, did-you-mean, the cross-argument rule, lists as Colls', () => {
    expect(diagOf(() => edit(scanDoc(), [set('main.params.time_s', 0)]))).toMatchObject({ code: 'E_ARG_RANGE', path: 'main.params.time_s' });
    expect(diagOf(() => edit(scanDoc(), [set('main.params.tim_s', 3)]))).toMatchObject({ code: 'E_UNKNOWN_OPTION', hint: 'did you mean time_s?' });
    expect(diagOf(() => edit(scanDoc(), [push('darkroom', 'b1', L('burn', { stops: 1, time_s: 3 }))])).message).toMatch(/exactly one of time_s and stops/);
    expect(diagOf(() => edit(scanDoc(), [push('print', 'h1', L('heal', { spots: [spot(1, 1)] as never }))])).message).toMatch(/Coll/);
    expect(diagOf(() => edit(scanDoc(), [push('print', 'h1', L('heal', spots(['s1', { x: 1, y: 1, r: 0, src: { x: 3, y: 1 } }])))])).code).toBe('E_ARG_RANGE');
    // a spot of a heal layer is addressed by its own id, wherever the layer sits
    const d = edit(scanDoc(), [push('print', 'h1', L('heal', spots(['s1', spot(1, 1)])))]).doc;
    expect(edit(d, [set('s1.opacity', 0.5)]).doc).toBeTruthy();
    expect(diagOf(() => edit(d, [set('s1.opacity', 2)]))).toMatchObject({ code: 'E_ARG_RANGE', path: 'h1.params.spots.0.opacity' });
  });

  it('stages accept only their ops (catalogue stages)', () => {
    expect(diagOf(() => edit(scanDoc(), [push('darkroom', 'x', L('clarity', { strength: 0.2, radius_mm: 5 }))]))).toMatchObject({ code: 'E_DOCUMENT', path: 'x.op' });
    expect(diagOf(() => edit(scanDoc(), [push('print', 'x', L('burn', { stops: 1 }))])).message).toMatch(/lives in darkroom/);
    expect(diagOf(() => edit(scanDoc(), [push('print', 'x', L('print.expose', {}))])).message).toMatch(/not a layer op/);
    expect(diagOf(() => edit(scanDoc(), [push('print', 'x', L('clarty', {}))]))).toMatchObject({ code: 'E_UNKNOWN_OP', hint: 'did you mean clarity?' });
    expect(diagOf(() => edit(camDoc(), [push('film', 'x', L('heal', spots()))])).message).toMatch(/takes no entries/);
  });

  it('the law rules: amount ranges, no blend and no isolated groups in the darkroom', () => {
    expect(diagOf(() => edit(scanDoc(), [set('main.amount', 20)])).code).toBe('E_ARG_RANGE');
    expect(edit(scanDoc(), [set('main.amount', 2)]).doc).toBeTruthy(); // light: amount scales (a doubled exposure)
    expect(diagOf(() => edit(scanDoc(), [push('print', 'x', L('clarity', {}, { amount: 1.5 }))])).message).toMatch(/opacity/);
    expect(diagOf(() => edit(scanDoc(), [push('darkroom', 'g', G('card', [], { blend: 'normal' }))]))).toMatchObject({ code: 'E_DOCUMENT', path: 'g.blend' });
    expect(diagOf(() => edit(scanDoc(), [push('print', 'x', L('clarity', {}, { blend: 'pass' }))])).code).toBe('E_DOCUMENT');
    expect(edit(scanDoc(), [push('print', 'g', G('sky', [], { blend: 'normal' }))]).doc).toBeTruthy(); // isolated in composite
    expect(diagOf(() => edit(scanDoc(), [push('scan', 'g', G('dust', [], { blend: 'normal' }))])).code).toBe('E_DOCUMENT'); // repair: pass only
  });

  it('exactly one main exposure, id main: a transaction may break the rule midway', () => {
    expect(diagOf(() => edit(scanDoc(), [remove('main')])).message).toMatch(/needs its main exposure/);
    expect(diagOf(() => edit(scanDoc(), [push('darkroom', 'm2', L('expose', {}))])).message).toMatch(/2 main exposures/);
    const main = scanDoc().stages.darkroom.stack.items['main']!;
    const r = edit(scanDoc(), [remove('main'), push('darkroom', 'main', { ...main, amount: 0.5 }, 0)]);
    expect(r.doc.stages.darkroom.stack.items['main']).toMatchObject({ amount: 0.5 });
    // moving the main into a group (a card over everything) is fine: ids survive moves
    const g = edit(scanDoc(), [push('darkroom', 'card', G('card', [])), move('main', { into: 'card.stack' })]).doc;
    expect(validateDocument(g)).toEqual([]);
    expect(edit(g, [set('main.params.time_s', 12)]).doc).toBeTruthy();
  });

  it('masks: components checked by their op; reads must be a cut before the stage that uses the mask', () => {
    expect(diagOf(() => edit(scanDoc(), [insert('masks', 'm', maskOf([['c1', { ...linear(), kind: 'radial' as never }]]))])).code).toBe('E_DOCUMENT');
    expect(diagOf(() => edit(scanDoc(), [insert('masks', 'm', maskOf([['c1', linear()]], { reads: 'scene' }))])).code).toBe('E_CUT');
    const late = edit(scanDoc(), [insert('masks', 'm', maskOf([['c1', linear()]], { reads: 'finished' }))]).doc;
    expect(diagOf(() => edit(late, [push('darkroom', 'b', L('burn', { stops: 1 }, { mask: 'm' }))]))).toMatchObject({ code: 'E_CUT', path: 'b.mask' });
    expect(diagOf(() => edit(scanDoc(), [push('darkroom', 'b', L('burn', { stops: 1 }, { mask: 'nope' }))])).code).toBe('E_DOCUMENT');
    expect(readableCuts('darkroom', 'negative-scan', 'mask')).toEqual(['source', 'scan', 'negative', 'darkroom.main']);
    expect(readableCuts('print', 'digital-raw', 'binding')).toEqual(['source', 'scene', 'film', 'negative', 'darkroom.main', 'darkroom.H', 'print']);
    expect(readableCuts('scan', 'negative-scan', 'medium')).toEqual([]);
  });

  it('transactions are atomic and exactly invertible under the contract rules', () => {
    const d = scanDoc();
    const tx = transaction({
      id: 't1', label: 'sky', by: 'agent', source: { kind: 'agent', turn: 1 },
      mutations: [insert('masks', 'sky', maskOf([['c1', linear()]])), push('darkroom', 'b1', L('burn', { stops: 0.5 }, { mask: 'sky' })), set('main.params.time_s', 12), move('b1', { at: 0 })],
    });
    const r = applyTransaction(d, tx, DOCUMENT_RULES);
    expect(Coll.ids(r.doc.stages.darkroom.stack)).toEqual(['b1', 'main', 'lights']);
    expect(equal(revertTransaction(r.doc, r.tx, DOCUMENT_RULES).doc, d)).toBe(true);
    const bad = tryTransaction(d, transaction({ id: 't2', label: 'x', by: 'user', mutations: [set('main.params.time_s', 12), set('main.params.fstop', 1)] }), DOCUMENT_RULES);
    expect(bad).toMatchObject({ ok: false, index: 1 });
  });
});

describe('one error class', () => {
  it('ChromobenchError is a ValueError; builder-core errors are contract diagnostics', () => {
    const e = new ChromobenchError({ code: 'E_ARG_TYPE', message: 'x' });
    expect(e).toBeInstanceOf(ValueError);
    expect(e.code).toBe('E_ARG_TYPE');
    expect(e.name).toBe('ChromobenchError');
    const v = new ValueError({ code: 'E_PATH', message: 'no such path' });
    expect(isChromobenchError(v)).toBe(true);
    expect(toDiagnostic(v)).toEqual({ code: 'E_PATH', message: 'no such path' });
    expect(diagOf(() => edit(scanDoc(), [set('nowhere.x', 1)])).code).toBe('E_PATH');
    for (const c of ['E_DOCUMENT', 'E_LINK', 'E_BINDING', 'E_CUT', 'E_MUTATION', 'E_PATH']) expect(ERROR_CODES).toHaveProperty(c);
    expect(ERROR_CODES).not.toHaveProperty('E_RECIPE');
  });
});
