// A frame's history is the values document log under the contract's rules (LOG_RULES), and the component builders.
import { describe, expect, it } from 'vitest';
import { Coll, explain, insert, Log, plan, set, transaction, type Mutation } from '@chromobench/values';
import {
  amount, compile, documentKind, edit, layer, LOG_RULES, mask, maskWith, stackPath, validateDocument, type Document,
} from '@chromobench/contract';
import { camDoc, diagOf, graph, scanDoc } from './helpers.ts';

let t = 0;
const now = (): number => ++t;
const tx = (id: string, mutations: Mutation[], by: 'user' | 'agent' = 'user') => ({ doc: 'f1', tx: transaction({ id, label: id, by, mutations }) });
const frames = () => Log.create({ rules: LOG_RULES, now }).open('f1', scanDoc(), { kind: 'frame', by: 'auto', source: { kind: 'ingest' } });
const main = (log: Log) => log.doc<Document>('f1').stages.darkroom.stack.items['main'];

describe('a frame in the document log', () => {
  it('commits are checked by the document rules; undo returns the state exactly', () => {
    const log = frames().commit(tx('t1', [set('lights.params.logH', [0.1, 0, 0])]));
    expect(log.doc<Document>('f1').stages.darkroom.stack.items['lights']).toMatchObject({ params: { logH: [0.1, 0, 0] } });
    expect(diagOf(() => log.commit(tx('bad', [set('main.params.time_s', -1)]))).code).toBe('E_ARG_RANGE');
    expect(log.entries).toHaveLength(1);
    expect(log.undo().doc('f1')).toEqual(scanDoc());
  });

  it('a draft previews a drag; the what-if document compiles to the ids of the committed one', () => {
    const log = frames();
    const d = log.draft<Document>('f1').set('main.params.time_s', 11).set('main.params.time_s', 12);
    expect(log.entries).toHaveLength(0);
    const g = graph();
    const shown = compile(d.value, g).display.id;
    const c = log.commit(d.edit({ id: 'g1', label: 'Time', source: { kind: 'gesture', control: 'main.params.time_s' } }));
    expect(c.last!.tx.mutations).toEqual([{ op: 'set', path: 'main.params.time_s', value: 12 }]);
    expect(compile(c.doc<Document>('f1'), g).display.id).toBe(shown);
    expect(diagOf(() => d.set('main.params.time_s', -3)).code).toBe('E_ARG_RANGE');
  });

  it('an agent proposal: pending, stale when the photographer changed what it undoes, approved with force; why', () => {
    let log = frames().propose(tx('a1', [set('main.params.time_s', 12)], 'agent'), { why: 'brighter' });
    const p = log.last!;
    expect(main(log)).toMatchObject({ params: { time_s: 10 } });
    log = log.commit(tx('u1', [set('main.params.time_s', 11)]));
    expect(diagOf(() => log.approve(p.seq)).code).toBe('E_STALE');
    log = log.approve(p.seq, { force: true });
    expect(log.trail('f1', 'main.params.time_s').map((w) => [w.by, w.value])).toEqual([['auto', 10], ['user', 11], ['agent', 12]]);
    expect(log.why('f1', 'main.params.time_s')).toMatchObject({ approvedBy: 'user', tx: 'a1' });
  });

  it('a batch over a roll: plan skips the frame the rules refuse; one step; saved and loaded', () => {
    let log = frames().open('c1', camDoc(), { kind: 'frame' });
    const b = plan(log.targets<Document>(), (d) => (documentKind(d) === 'negative-scan' ? [set('main.params.time_s', 14)] : [set('main.params.time_s', -1)]), { id: 'roll-1', label: 'Roll time', by: 'user', source: { kind: 'roll' } });
    expect(b.edits.map((e) => e.doc)).toEqual(['f1']);
    expect(b.skipped.map((s) => s.doc)).toEqual(['c1']);
    log = log.commit(b);
    const back = Log.load(JSON.parse(JSON.stringify(log)), { rules: LOG_RULES });
    expect(back.doc('f1')).toEqual(log.doc('f1'));
    expect(back.steps).toEqual([{ seqs: [1], label: 'Roll time', batch: 'roll-1' }]);
    expect(diagOf(() => Log.load({ ...log.toJSON(), version: 0 } as never)).code).toBe('E_DOCUMENT');
  });
});

describe('builders', () => {
  it('chain methods are modifiers; the same modifier applies to a stored entry; values insert as their data', () => {
    const burn = layer('burn', { stops: 1 }).amount(0.5).mask('sky');
    expect(burn.data).toMatchObject({ kind: 'layer', op: 'burn', amount: 0.5, mask: 'sky', blend: 'normal' });
    expect(amount(0.5).then(maskWith('sky')).run(layer('burn', { stops: 1 }).data)).toEqual(burn.data);
    expect(explain(burn)).toMatchObject({ kind: 'layer' });
    expect((explain(burn) as { at?: string }).at).toMatch(/history-builders\.test\.ts/);
    const sky = mask('sky', ['c1', 'linear', { from: { x: 0, y: 0 }, to: { x: 0, y: 5 } }]).add('c2', 'ellipse', { box: { x: 1, y: 1, w: 4, h: 4 } }, 'intersect').feather(0.2);
    expect(Coll.ids(sky.data.components)).toEqual(['c1', 'c2']);
    const d = edit(scanDoc(), [insert('masks', 'sky', sky), insert(stackPath('darkroom'), 'b1', burn)]).doc;
    expect(validateDocument(d)).toEqual([]);
    expect(Object.isFrozen(burn.data)).toBe(true);
  });
});
