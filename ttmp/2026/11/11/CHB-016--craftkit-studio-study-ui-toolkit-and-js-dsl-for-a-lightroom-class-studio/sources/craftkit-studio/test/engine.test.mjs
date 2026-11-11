import assert from 'node:assert/strict';
import { engineSource, compileGraph, exprNode } from '../src/shell/core/engine.js';

const img = engineSource('image', [s => s.file]);
const dev = img.develop(s => s.dev);
const plates = img.separate(2, { inks: ['#ff48b0', s => s.ink] });
const pink = plates.at(0);
const stack = engineSource('stack', [engineSource('solid', ['#fff', [10, 10]])]).layer(pink, { blend: 'multiply' });
const g = compileGraph([dev, stack]);
assert.ok(/ck\.image\(ck\.ui\.input\("i1", null\), Object\.assign\(\{\}, \{ max: __max \}\)\)/.test(g.code), 'an image source gets a hole and the shared max input');
assert.ok(g.code.includes(`= ${exprNode(plates).id}[0]`), '.at(0) becomes a list index');
assert.ok(g.code.includes(`.layer(${exprNode(pink).id}, { "blend": "multiply" })`), 'an expression argument is passed by name, not as a hole');
assert.deepEqual([...g.deps.get(exprNode(dev).id)].sort(), ['i1', 'i2'], 'develop depends on the file and the settings');
assert.ok(g.deps.get(exprNode(stack).id).has('i3'), 'the stack depends on the ink hole through the plate');
assert.ok(!g.deps.get(exprNode(stack).id).has('i2'), 'and not on the develop settings');
console.log('engine graph: all passed');
