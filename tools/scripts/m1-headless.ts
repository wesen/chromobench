// The M1 flow without a browser: open the fixture, render, +4 pt red, undo, agent proposal + approval.
//   pnpm demo:m1
import { readFileSync } from 'node:fs';
import { compile, Graph, LOG_RULES, newDocument, sha256Hex, type Document } from '@chromobench/contract';
import { canonicalJSON, Log, set, transaction, type Mutation } from '@chromobench/values';
import { M1, MockEngine } from '@chromobench/engine-mock';

const bytes = new Uint8Array(readFileSync(new URL('../../fixtures/synthetic/m1-negative-96x64.tif', import.meta.url)));
const engine = new MockEngine();
const info = await engine.open({ kind: 'file', sha256: sha256Hex(bytes), bytes });
const graph = new Graph();
graph.registerSource(info);
// one frame in the document log, as the studio opens it
let log = Log.create({ rules: LOG_RULES })
  .open('m1', newDocument('negative-scan', { sha256: info.sha256, name: 'm1' }, { umPerPx: 6 }), { kind: 'frame', by: 'auto' });
const state = (): Document => log.doc<Document>('m1');
const hash = (): string => sha256Hex(canonicalJSON(state())).slice(0, 12);
const tx = (id: string, label: string, by: 'user' | 'agent', mutations: Mutation[]) => ({ doc: 'm1', tx: transaction({ id, label, by, mutations }) });

async function patch(): Promise<string> {
  const n = compile(state(), graph).display;
  engine.adopt(graph.closure(n.id));
  const { x, y } = M1.patchCentre;
  const r = await engine.evaluate(n, { scale: 'full', precision: 'preview', region: { x, y, w: 1, h: 1 } });
  return Array.from(await r.read()).map((v) => v.toFixed(4)).join(', ');
}

console.log(`source ${info.sha256.slice(0, 12)}…  ${info.width}×${info.height}, ${info.bits} bit`);
console.log(`S0 ${hash()}…  patch (${await patch()})`);
log = log.commit(tx('t1', 'Printer lights', 'user', [set('lights.params.logH', [0.1, 0, 0])]));
console.log(`+4 pt red  S1 ${hash()}…  patch (${await patch()})`);
log = log.undo();
console.log(`undo       S  ${hash()}…  patch (${await patch()})`);
log = log.propose(tx('eval-1', 'eval-1', 'agent', [set('lights.params.logH', [0.1, 0, 0])]), { why: '+4 pt red' });
console.log(`agent proposal pending: ${log.pending('m1').length}; patch (${await patch()})`);
log = log.approve(log.pending('m1')[0]!.seq, { by: 'user' });
console.log(`approved   S  ${hash()}…  patch (${await patch()})`);
for (const w of log.trail('m1', 'lights.params.logH')) console.log(`why lights.params.logH: ${JSON.stringify(w)}`);
