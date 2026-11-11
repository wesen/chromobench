// The M1 flow without a browser: open the fixture, render, +4 pt red, undo, agent proposal + approval.
//   pnpm demo:m1
import { readFileSync } from 'node:fs';
import { compile, defaultRecipe, EditLog, Graph, sha256Hex } from '@chromobench/contract';
import { M1, MockEngine } from '@chromobench/engine-mock';

const bytes = new Uint8Array(readFileSync(new URL('../../fixtures/synthetic/m1-negative-96x64.tif', import.meta.url)));
const engine = new MockEngine();
const info = await engine.open({ kind: 'file', sha256: sha256Hex(bytes), bytes });
const graph = new Graph();
graph.registerSource(info);
const log = EditLog.create(defaultRecipe('negative-scan', { sha256: info.sha256, name: 'm1' }), { mode: 'ask', by: 'auto' });

async function patch(): Promise<string> {
  const n = compile(log.state, graph);
  engine.adopt(graph.closure(n.id));
  const { x, y } = M1.patchCentre;
  const r = await engine.evaluate(n, { scale: 'full', precision: 'preview', region: { x, y, w: 1, h: 1 } });
  return Array.from(await r.read()).map((v) => v.toFixed(4)).join(', ');
}

console.log(`source ${info.sha256.slice(0, 12)}…  ${info.width}×${info.height}, ${info.bits} bit`);
console.log(`S0 ${log.stateHash.slice(0, 12)}…  patch (${await patch()})`);
log.apply([{ op: 'set', path: 'print.lights.logH', value: [0.1, 0, 0] }], 'user', 'Printer lights');
console.log(`+4 pt red  S1 ${log.stateHash.slice(0, 12)}…  patch (${await patch()})`);
log.undo();
console.log(`undo       S  ${log.stateHash.slice(0, 12)}…  patch (${await patch()})`);
const p = log.propose([{ op: 'set', path: 'print.lights.logH', value: [0.1, 0, 0] }], { tx: 'eval-1', why: '+4 pt red' });
console.log(`agent proposal pending: ${log.pending().length}; patch (${await patch()})`);
log.approve(p.map((e) => e.seq));
console.log(`approved   S  ${log.stateHash.slice(0, 12)}…  patch (${await patch()})`);
console.log(log.formatWhy('print.lights.logH'));
