// The edit log over transactions (minimal; phase 4 replaces it) and the component builders.
import { describe, expect, it } from 'vitest';
import { Coll, explain, insert, set } from '@chromobench/values';
import {
  amount, compile, EditLog, edit, layer, mask, maskWith, stackPath, validateDocument, type Diagnostic, type LogEntry,
} from '@chromobench/contract';
import { diagOf, graph, scanDoc } from './helpers.ts';

let t = 0;
const now = (): number => ++t;

describe('edit log', () => {
  it('apply, undo, redo: one transaction per unit; the state hash returns exactly', () => {
    const log = EditLog.create(scanDoc(), { now });
    const h0 = log.stateHash;
    log.apply([set('lights.params.logH', [0.1, 0, 0])], 'user', '+4 pt red');
    expect(log.committed.stages.darkroom.stack.items['lights']).toMatchObject({ params: { logH: [0.1, 0, 0] } });
    expect(diagOf(() => log.apply([set('main.params.time_s', -1)], 'user', 'bad')).code).toBe('E_ARG_RANGE');
    expect(log.entries).toHaveLength(1);
    log.undo();
    expect(log.stateHash).toBe(h0);
    log.redo();
    expect(log.stateHash).not.toBe(h0);
    expect(diagOf(() => log.apply([], 'agent' as never, 'x')).code).toBe('E_READONLY');
  });

  it('preview overlays without logging; the what-if state compiles to the committed ids', () => {
    const log = EditLog.create(scanDoc(), { now });
    const ms = [set('main.params.time_s', 12)];
    log.preview(ms);
    expect(log.entries).toHaveLength(0);
    const g = graph();
    const draft = compile(log.state, g).display.id;
    log.apply(ms, 'user', 'time');
    expect(compile(log.committed, g).display.id).toBe(draft);
  });

  it('ask mode: pending, approve as one unit; a stale proposal is refused unless forced; batches; read-only', () => {
    const log = EditLog.create(scanDoc(), { now, mode: 'ask' });
    const e = log.propose([set('main.params.time_s', 12)], { tx: 'a1', why: 'brighter' });
    expect(e.tx.status).toBe('pending');
    expect(log.committed.stages.darkroom.stack.items['main']).toMatchObject({ params: { time_s: 10 } });
    log.apply([set('main.params.time_s', 11)], 'user', 'meanwhile');
    const stale = log.approve([e.seq]) as Diagnostic[];
    expect(stale[0]?.code).toBe('E_STALE');
    const ok = log.approve([e.seq], { force: true }) as LogEntry[];
    expect(ok[0]!.approvedBy).toBe('user');
    expect(log.why('main.params.time_s').map((p) => [p.by, p.value])).toEqual([['auto', 10], ['user', 11], ['agent', 12]]);
    const b1 = log.propose([set('main.params.fstop', 11)], { tx: 'b', batch: 'roll-1' });
    log.reject({ batch: 'roll-1' });
    expect(log.entries[b1.seq - 1]!.tx.status).toBe('rejected');
    log.setMode('read-only');
    expect(diagOf(() => log.propose([set('main.params.fstop', 11)], { tx: 'c' })).code).toBe('E_READONLY');
    log.setMode('auto');
    expect(log.propose([set('main.params.fstop', 11)], { tx: 'd' }).tx.status).toBe('applied');
  });

  it('persists and reloads; a recipe log is refused', () => {
    const log = EditLog.create(scanDoc(), { now });
    log.apply([set('main.params.time_s', 12)], 'user', 'x');
    const back = new EditLog(log.toJSON());
    expect(back.stateHash).toBe(log.stateHash);
    expect(diagOf(() => new EditLog({ ...log.toJSON(), version: 2 } as never)).code).toBe('E_DOCUMENT');
  });
});

describe('builders', () => {
  it('chain methods are modifiers; the same modifier applies to a stored entry; values insert as their data', () => {
    const burn = layer('burn', { stops: 1 }).amount(0.5).mask('sky');
    expect(burn.data).toMatchObject({ kind: 'layer', op: 'burn', amount: 0.5, mask: 'sky', blend: 'normal' });
    expect(amount(0.5).then(maskWith('sky')).run(layer('burn', { stops: 1 }).data)).toEqual(burn.data);
    expect(explain(burn)).toMatchObject({ kind: 'layer' });
    expect((explain(burn) as { at?: string }).at).toMatch(/editlog-builders\.test\.ts/);
    const sky = mask('sky', ['c1', 'linear', { from: { x: 0, y: 0 }, to: { x: 0, y: 5 } }]).add('c2', 'ellipse', { box: { x: 1, y: 1, w: 4, h: 4 } }, 'intersect').feather(0.2);
    expect(Coll.ids(sky.data.components)).toEqual(['c1', 'c2']);
    const d = edit(scanDoc(), [insert('masks', 'sky', sky), insert(stackPath('darkroom'), 'b1', burn)]).doc;
    expect(validateDocument(d)).toEqual([]);
    expect(Object.isFrozen(burn.data)).toBe(true);
  });
});
