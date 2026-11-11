// 16 · Mutations: one verb set for everything
// Builder calls, UI gestures and agent calls are the same thing: a mutation, applied with wb.apply({op, …}).
// Each is logged (who, what, previous value), undoable, and changes the state hash. wb.tx groups several into one undo step.
// Open the History view to watch these land.

const wb = bench('mutations');
wb.pipe('default').scene('still').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();
const { ws } = wb;

ws.tile('print').render('out');
wb.apply({ op: 'param.set', path: 'enlarger.y_shift', value: 8 }, 'ui');       // exactly what a drag does
wb.apply({ op: 'pipe.swap', slot: 'paper', engine: 'measured' });
wb.apply({ op: 'pipe.swap', slot: 'paper', engine: 'cdf' });

wb.tx('A/B papers', (t) => {                                                    // one undo step, one render
  t.apply({ op: 'scope.set', tile: 'print', scope: { print: 'kodak_ultra_endura' } });
  t.apply({ op: 'lens.add', tile: 'print', lens: lens.split({ with: { print: 'kodak_ultra_endura' } }) });
});
log('after tx:  scope', JSON.stringify(ws.tiles.get('print').scope), '· lenses', ws.tiles.get('print').lenses.length);
wb.undo();
log('after undo: scope', JSON.stringify(ws.tiles.get('print').scope), '· lenses', ws.tiles.get('print').lenses.length);   // the whole transaction went
wb.redo();

log(wb.log.slice(-4).map((e) => `${e.op} by ${e.by}`).join('\n'));
log('state', wb.state.hash, '· log', wb.log.hash);          // where we are, and how we got there

const again = bench.load(wb.save());                         // save() is data; load() rebuilds the bench from it
log('reloaded identical?', again.state.hash === wb.state.hash);
log(wb.script().split('\n').slice(0, 14).join('\n') + '\n…');   // and the same state as readable code
use(wb);
