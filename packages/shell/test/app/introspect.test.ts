// Introspection for the agent's workbench (CHB-037 P6b): the command table as data, the controls with what they
// write and their live values, the commands a person can reach, a module's live explain, and Store.acting (an agent's
// command: its author, proposals in ask mode, refusals in read-only).
import { describe, expect, it } from 'vitest';
import { createCk, paramNames } from '../../src/index.ts';
import { manualClock } from '../../src/testing/index.ts';

function app() {
  const ck = createCk();
  const kit = ck
    .kit('k')
    .state('doc', { init: { n: 1, label: 'a' } })
    .state('look', { init: { split: 0.5 }, view: true })
    .commands({
      'n.set': { label: 'Set N', run: (ctx: any, n: number) => ctx.tx(`N ${n}`, (t: any) => void (t.doc.n = n)) },
      'n.bump': { label: 'Bump', enabled: (s: any) => s.doc.n < 5, why: 'N is at its top', run: 'n.set' },
      'n.both': { label: 'Both', args: ['value'], run: (ctx: any, v: number) => ctx.tx('Both', (t: any) => void (t.doc.n = v), {}) },
      'n.half': { label: 'Half', run: (ctx: any) => ctx.set({ look: { split: 0.25 } }) },
    })
    .keys({ 'Mod+1': ['n.set', 1], 'Mod+2': ['n.set', 2] });
  return ck
    .shell('S')
    .use(kit)
    .menus(ck.menu('Edit', ['edit.undo', '-', 'n.bump', { label: 'More', items: ['n.both'] }]))
    .module(
      ck
        .module('main', { label: 'Main' })
        .center(ck.column({}, ck.ui.slider({ label: 'Split', min: 0, max: 1, bind: (s: any) => s.look.split }), ck.ui.button({ run: ['n.set', 3], text: 'Three' }), ck.toolbar(['n.half'])))
        .right(ck.panel.define('p', { title: 'P' }, ck.ui.number({ label: 'N', bind: (s: any) => s.doc.n }))),
    )
    .module(ck.module('other', { label: 'Other' }).center(ck.text('x')))
    .build();
}

describe('introspection', () => {
  it('paramNames: the handler parameters after ctx', () => {
    expect(paramNames((ctx: unknown, n: number, colour = 'red') => [ctx, n, colour])).toEqual(['n', 'colour']);
    expect(paramNames((ctx: unknown) => ctx)).toEqual([]);
    expect(paramNames(function run(ctx: unknown, { a }: { a: number }) { return [ctx, a]; })).toEqual(['options']);
    expect(paramNames('n.set')).toEqual([]);
  });

  it('the command table: labels, args, keys with their arguments, menus, enabled and why', async () => {
    const rt = await app().boot({ clock: manualClock() });
    const t = new Map(rt.commandTable().map((r) => [r.id, r]));
    expect(t.get('n.set')).toMatchObject({ label: 'Set N', args: ['n'], enabled: true, builtin: false, keys: [{ chord: 'mod+1', args: [1] }, { chord: 'mod+2', args: [2] }] });
    expect(t.get('n.bump')).toMatchObject({ args: ['n'], menu: 'Edit' });
    expect(t.get('n.both')).toMatchObject({ args: ['value'], menu: 'Edit ▸ More' });
    expect(t.get('edit.undo')).toMatchObject({ builtin: true, menu: 'Edit' });
    rt.run('n.set', 7);
    expect(rt.commandTable().find((r) => r.id === 'n.bump')).toMatchObject({ enabled: false, why: 'N is at its top' });
  });

  it('controls: the bind path, the command, the panel, live values; reachable commands', async () => {
    const rt = await app().boot({ clock: manualClock() });
    const c = rt.controls();
    expect(c).toEqual(expect.arrayContaining([
      expect.objectContaining({ module: 'main', form: 'slider', label: 'Split', bind: 'look.split', value: 0.5 }),
      expect.objectContaining({ module: 'main', form: 'button', command: 'n.set', args: [3] }),
      expect.objectContaining({ module: 'main', panel: 'p', form: 'number', bind: 'doc.n', value: 1 }),
    ]));
    expect(rt.controls({ module: 'other' })).toEqual([]);
    const reach = rt.reachable().map((r) => `${r.from} ${r.id}`);
    expect(reach).toEqual(expect.arrayContaining(['key n.set', 'menu n.bump', 'menu n.both', 'button n.set', 'toolbar n.half']));
  });

  it('explain({ module }) shows one module with live values and no command list', async () => {
    const rt = await app().boot({ clock: manualClock() });
    const x = rt.explain({ live: true, module: 'main' });
    expect(x).toContain('module main');
    expect(x).not.toContain('module other');
    expect(x).toContain('bind look.split = 0.5');
    expect(x).not.toMatch(/^commands$/m);
  });

  it('Store.acting: the agent authors the transaction; propose waits for approval; refuse keeps the document', async () => {
    const rt = await app().boot({ clock: manualClock() });
    rt.store.acting({ by: 'agent', source: { kind: 'agent', eval: 'e1' }, why: 'try 4' }, () => rt.run('n.set', 4));
    const last = rt.store.log.inEffect('main').at(-1)!;
    expect([last.tx.by, last.tx.source['kind'], last.why, rt.state.doc.n]).toEqual(['agent', 'agent', 'try 4', 4]);
    rt.store.acting({ by: 'agent', propose: true, why: 'six' }, () => rt.run('n.set', 6));
    expect(rt.state.doc.n).toBe(4);
    expect(rt.store.log.pending('main').map((e) => [e.tx.by, e.why])).toEqual([['agent', 'six']]);
    const refused: string[] = [];
    rt.on('refused', (e: { cause2: { code?: string } }) => refused.push(String(e.cause2.code)));
    rt.store.acting({ by: 'agent', refuse: 'the agent is read-only' }, () => {
      rt.run('n.set', 9);
      rt.run('n.half');
    });
    expect([rt.state.doc.n, rt.state.look.split, refused]).toEqual([4, 0.25, ['E_READONLY']]);
  });
});
