// Type tests: these lines must fail `pnpm typecheck` (each @ts-expect-error is checked by tsc), and the same
// mistakes are caught at build (or, for an unknown method, where it is called) for JS layouts.
import { describe, expect, it } from 'vitest';
import { createCk } from '../../src/index.ts';

interface St {
  dev: { light: { exposure: number } };
  ui: { photo: string };
}

describe('the grammar is typed', () => {
  it('β slots refuse lambdas, binds are typed by the state, unknown methods are errors', () => {
    const ck = createCk<St>();
    // a lambda in a β slot is a type error (and CK-B140 at build)
    // @ts-expect-error step is β
    const a = ck.ui.slider(0, 1, { step: (s: St) => s.dev.light.exposure });
    // a binding into the typed state
    const b = ck.ui.slider(-5, 5, { bind: s => s.dev.light.exposure });
    // @ts-expect-error no such path in St
    const c = ck.ui.slider(-5, 5, { bind: s => s.dev.light.exposur });
    // an unknown fragment method (no kit augments FormMethods with it): a type error, and CK-X120 thrown where it is called
    // @ts-expect-error no such method
    expect(() => ck.ui.slider(0, 1, {}).testStrip()).toThrow(/CK-X120/);
    const d = ck.ui.slider(0, 1, {});
    // slot setters are typed: .step(n) takes a number
    const e = ck.ui.slider(0, 1, {}).step(0.1).label(s => s.ui.photo);
    // @ts-expect-error .step() takes a number
    const f = ck.ui.slider(0, 1, {}).step('fine');
    expect([a, b, c, d, e, f].every(ck.isNode)).toBe(true);
    const app = ck.shell('t').state({ dev: { light: { exposure: 0 } }, ui: { photo: 'a' } }).center(ck.column({}, a, d)).build();
    expect(app.codes()).toEqual(expect.arrayContaining(['CK-B140']));
  });
});
