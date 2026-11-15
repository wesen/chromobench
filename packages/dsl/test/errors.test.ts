// Guide §5.9: one test per common agent mistake, asserting the exact code and fix.
// Fixes name the receiver by the vocabulary that produced it (`frame.negative()`), not the agent's
// local variable name (`neg`): the fix must be pasteable code, and the prelude cannot see local names.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type Setup } from './helpers.ts';

let s: Setup;
beforeAll(async () => {
  s = await setup();
});
afterAll(() => s.session.dispose());

const ROWS: { what: string; code: string; error: string; fix?: string; hint?: RegExp; noLine?: boolean }[] = [
  { what: 'misspelt method', code: 'const neg = frame.negative()\nreturn neg.pirnt({ time_s: 12 })', error: 'E_UNKNOWN_METHOD', fix: 'frame.negative().print(…)', hint: /Did you mean "print"\?/ },
  { what: 'op on the wrong domain', code: 'return frame.scan().print.expose({ time_s: 12 })', error: 'E_DOMAIN', fix: 'frame.negative().print.expose({time_s: 12})' },
  { what: 'a paper-exposure op on a negative', code: 'const neg = frame.negative()\nreturn neg.print.develop({ grade: 3 })', error: 'E_DOMAIN', fix: "frame.cut('darkroom.H').print.develop({grade: 3})" },
  { what: 'a field of an unawaited value', code: 'const p = frame.print()\nconst g = p.measure.densitometer({ at: [48, 32] })\nreturn g.D', error: 'E_NOT_AWAITED', fix: '(await frame.print().measure.densitometer({at: [48, 32]})).D' },
  { what: 'comparison with an unawaited value', code: 'const p = frame.print()\nif (p.measure.densitometer({ at: [48, 32] }) > 0.8) return 1', error: 'E_NOT_AWAITED', fix: '(await frame.print().measure.densitometer({at: [48, 32]})).D' },
  { what: 'arithmetic with an unawaited value', code: 'const v = frame.print().measure.densitometer({ at: [48, 32] })\nreturn v * 2', error: 'E_NOT_AWAITED', fix: '(await frame.print().measure.densitometer({at: [48, 32]})).D' },
  { what: 'assigning to a handle', code: 'const neg = frame.negative()\nneg.time_s = 12', error: 'E_IMMUTABLE', fix: "frame.propose(set('main.params.time_s', 12))" },
  { what: 'assigning to the document', code: 'frame.doc.stages.darkroom.stack.items.main.params.time_s = 12', error: 'E_IMMUTABLE', fix: "frame.propose(set('main.params.time_s', 12))" },
  { what: 'unknown option of a handle op', code: 'return frame.print().measure.densitometer({ att: [48, 32] })', error: 'E_UNKNOWN_OPTION', fix: 'frame.print().measure.densitometer({at: [48, 32]})' },
  { what: 'lights in points', code: "frame.propose(set('lights.params.logH', [4, 0, 0]))", error: 'E_ARG_RANGE', fix: "frame.propose(set('lights.params.logH', [0.1, 0, 0]))", hint: /1 point = 0.025 log H/ },
  { what: 'a node as a literal value', code: "const p = frame.print()\nreturn frame.with(set('main.params.time_s', p.measure.stats()))", error: 'E_ARG_TYPE', fix: '(await frame.print().measure.stats()).mean' },
  { what: 'misspelt document path', code: "frame.propose(set('main.param.time_s', 12))", error: 'E_PATH', fix: "frame.propose(set('main.params.time_s', 12))", hint: /did you mean params\?/ },
  { what: 'misspelt param in a path', code: "frame.propose(set('main.params.time', 12))", error: 'E_UNKNOWN_OPTION', fix: "frame.propose(set('main.params.time_s', 12))" },
  { what: 'a function in a layer\'s params', code: "return layer('burn', { stops: () => 1 })", error: 'E_ARG_TYPE', hint: /compute the value in your code/ },
  { what: 'a function as a set value', code: "frame.propose(set('main.params.time_s', (t) => t * 2))", error: 'E_ARG_TYPE' },
  { what: 'misspelt layer param', code: "return layer('burn', { stop: 1 })", error: 'E_UNKNOWN_OPTION', fix: "layer('burn', {stops: 1})" },
  { what: 'unknown layer op', code: "return layer('brun', { stops: 1 })", error: 'E_UNKNOWN_OP', fix: "layer('burn', …)" },
  { what: 'an id that is taken', code: "frame.propose(insert('stages.darkroom.stack', 'main', layer('burn', { stops: 1 })))", error: 'E_MUTATION', fix: "insert('stages.darkroom.stack', 'main1', …)" },
  { what: 'a layer in a stage that does not take it', code: "frame.propose(insert('stages.print.stack', 'b1', layer('burn', { stops: 1 })))", error: 'E_DOCUMENT' },
  { what: 'a layer where a change is expected', code: "return frame.with(layer('burn', { stops: 1 }))", error: 'E_ARG_TYPE', fix: "insert('stages.darkroom.stack', 'L1', layer(…))" },
  { what: 'options on a cut', code: 'return frame.print({ time_s: 12 })', error: 'E_ARG_TYPE', fix: "frame.with(set('main.params.time_s', 12)).print()" },
  { what: 'unknown cut', code: "return frame.cut('prnt')", error: 'E_CUT', fix: 'frame.print()' },
  { what: 'a cut the frame kind does not have', code: 'return frame.scene()', error: 'E_CUT' },
  { what: 'misspelt value method', code: "return layer('burn', { stops: 1 }).amout(0.5)", error: 'E_UNKNOWN_METHOD', hint: /Did you mean "amount"\?/ },
  { what: 'unknown mask component', code: "return mask('m').add('c1', 'gradient', { from: [0, 0], to: [0, 10] })", error: 'E_ARG_TYPE' },
  { what: 'timers', code: 'await new Promise(r => setTimeout(r, 500))', error: 'ReferenceError', hint: /there are no timers/ },
  { what: 'fetch', code: 'return fetch("https://example.com")', error: 'E_SANDBOX' },
  { what: 'require', code: 'return require("fs")', error: 'E_SANDBOX' },
  // QuickJS gives the module-load rejection no stack, so it has no line.
  { what: 'import()', code: 'return await import("x")', error: 'E_SANDBOX', noLine: true },
  { what: 'misspelt frame member', code: 'return frame.negatve()', error: 'E_UNKNOWN_METHOD', fix: 'frame.negative' },
  { what: 'misspelt cb member', code: 'return cb.franes()', error: 'E_UNKNOWN_METHOD', fix: 'cb.frames' },
  { what: 'misspelt op in a namespace', code: 'return frame.print().measure.densitomter({ at: [48, 32] })', error: 'E_UNKNOWN_METHOD', fix: 'frame.print().measure.densitometer(…)' },
  { what: 'the print namespace called as a print', code: 'return frame.negative().print({ time_s: 12 })', error: 'E_UNKNOWN_METHOD', fix: "frame.with(set('main.params.time_s', 12)).print()" },
];

describe('§5.9 mistakes → structured errors with a literal fix', () => {
  for (const row of ROWS) {
    it(row.what, async () => {
      const r = await s.run(row.code);
      expect(r.error?.code, r.yaml).toBe(row.error);
      if (row.fix !== undefined) expect(r.error?.fix).toBe(row.fix);
      if (row.hint) expect(r.error?.hint).toMatch(row.hint);
      expect(r.yaml).toMatch(/^error:\n {2}code: /);
      if (!row.noLine) expect(r.error?.where?.line, 'error points at an agent line').toBeGreaterThan(0);
    });
  }

  it('a handle in a template literal gives its label, so logging never crashes', async () => {
    const r = await s.run('const p = frame.print()\nconsole.log(p)\nreturn `${p}`');
    expect(r.error).toBeUndefined();
    expect(r.yaml).toMatch(/^'\[print-xyz #[0-9a-f]{4} view\.adapt\]'/);
    expect(r.yaml).toMatch(/console:\n {2}- 'line 2: \[print-xyz/);
  });

  it('JSON.stringify of a handle and of a frame does not throw', async () => {
    const r = await s.run('return JSON.stringify({ p: frame.print() }).length > 0');
    expect(r.yaml.split('\n')[0]).toBe('true');
  });

  it('awaiting an image gives a summary; .data is undefined and the summary says why', async () => {
    const r = await s.run('const sum = await frame.print()\nreturn { data: sum.data === undefined, note: sum.note, keys: Object.keys(sum) }');
    expect(r.yaml).toMatch(/data: true/);
    expect(r.yaml).toMatch(/pixels never enter the DSL/);
  });

  it('no return is not an error', async () => {
    const r = await s.run('const x = 1');
    expect(r.error).toBeUndefined();
    expect(r.yaml.split('\n')[0]).toBe('# nothing returned: end the code with return …');
  });

  it('reading frame with no bound frame → E_NO_FRAME with a fix', async () => {
    const r = await s.run('return frame.id', { frame: null });
    expect(r.error?.code).toBe('E_NO_FRAME');
    expect(r.error?.fix).toBe('cb.frame("frame_m1")');
    const ok = await s.run('return cb.frame("frame_m1").id', { frame: null });
    expect(ok.yaml.split('\n')[0]).toBe('frame_m1');
  });

  it('read-only mode: frame.propose throws E_READONLY with the describe-instead hint', async () => {
    const ro = await setup({ mode: 'read-only' });
    const r = await ro.run("frame.propose(set('main.params.time_s', 12))");
    expect(r.error?.code).toBe('E_READONLY');
    expect(r.error?.hint).toMatch(/describe the change instead/);
    expect(r.error?.fix).toBeUndefined();
    ro.session.dispose();
  });

  it('a RANGE warning carries the agent line', async () => {
    const r = await s.run("const x = 1\nreturn frame.with(set('main.params.time_s', 500)).print().id.length");
    const w = r.warnings.find((x) => x.code === 'RANGE');
    expect(w, r.yaml).toBeDefined();
    expect(w!.where?.line).toBe(2);
  });
});
