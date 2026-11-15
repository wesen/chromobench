// The workbench in the sandbox (CHB-037 P6b): every wb call is awaited and answered by the host's Workbench; layouts
// are recorded as data (paths of names and arguments, spreads, selectors, state paths, command ids), never as
// functions; cb.looks.define registers an agent-written look here and at the host.
import { describe, expect, it } from 'vitest';
import { getLook } from '@chromobench/contract';
import type { Workbench, WbLayoutData, WbRun } from '../src/index.ts';
import { setup } from './helpers.ts';

const val = (r: { yaml: string; error?: unknown }): any => {
  if (r.error) throw new Error(r.yaml);
  const line = r.yaml.split('\n')[0]!;
  const s = line.startsWith("'") ? line.slice(1, -1).replace(/''/g, "'") : line.startsWith('"') ? JSON.parse(line) : line;
  return JSON.parse(s);
};

function fakeWorkbench() {
  const calls: string[] = [];
  const built: WbLayoutData[] = [];
  const run = (id: string, args: readonly unknown[]): WbRun => ({ ok: id !== 'off', ...(id === 'off' ? { why: 'Open a frame first' } : {}), entries: [], how: 'none', module: 'print', frame: null, result: args });
  const wb: Workbench = {
    commands: () => [
      { id: 'frame.rate', label: 'Set Stars', keys: [{ chord: '1', scope: 'global', args: [1] }], args: ['n'], enabled: true, hidden: false, builtin: false },
      { id: 'layer.add', label: 'Add Layer', keys: [], args: ['op'], enabled: false, why: 'Open a frame first', hidden: false, builtin: false },
    ],
    run: (id, args, o) => (calls.push(`run ${id} ${JSON.stringify(args)} ${o.eval}`), run(id, args)),
    set: (path, value) => (calls.push(`set ${path} ${JSON.stringify(value)}`), run('set', [value])),
    selectors: () => [{ name: 'current', args: [] }, { name: 'frame', args: ['id'] }],
    state: (name, args) => ({ name, args }),
    screen: (o) => ({ layout: { id: 'tiny', label: 'Tiny', agent: false }, module: o.module ?? 'main', modules: [{ id: 'main', label: 'Main' }], frame: null, tool: null, text: 'module main "Main"', controls: [] }),
    layouts: () => ({ current: { id: 'tiny', label: 'Tiny', agent: false }, available: [{ id: 'tiny', label: 'Tiny' }] }),
    build: (l) => (built.push(l), { ok: true, layout: l, errors: [], warnings: [], explain: 'shell', controls: [] }),
    use: (l, o) => ({ status: 'proposed', id: l.id, label: l.label, note: `asked${o.why ? `: ${o.why}` : ''}` }),
    defineLook: (src) => (calls.push(`look ${src.length}`), { name: 'x', version: 1, label: 'X' }),
  };
  return { wb, calls, built };
}

describe('wb: the workbench from the sandbox', () => {
  it('commands (filtered), run with arguments and the eval as provenance, set, selectors, state, screen().explain()', async () => {
    const f = fakeWorkbench();
    const s = await setup({ workbench: f.wb });
    const r = await s.run(`
      const all = await wb.commands();
      const layer = await wb.commands('layer');
      const ran = await wb.run('frame.rate', 3);
      const off = await wb.run('off');
      await wb.set('view.view', 'loupe');
      const st = await wb.state('frame', 'f1');
      const text = await wb.screen().explain();
      const sc = await wb.screen({ module: 'main' });
      return JSON.stringify({ n: all.length, layer: layer.map((c) => c.id + ':' + c.enabled + ':' + c.why), ran: ran.result, off: off.why, st, text, again: sc.explain(), sel: (await wb.selectors()).map((x) => x.name), cur: (await wb.layout()).id });`);
    expect(val(r)).toEqual({ n: 2, layer: ['layer.add:false:Open a frame first'], ran: [3], off: 'Open a frame first', st: { name: 'frame', args: ['f1'] }, text: 'module main "Main"', again: 'module main "Main"', sel: ['current', 'frame'], cur: 'tiny' });
    expect(f.calls).toEqual(['run frame.rate [3] eval-1', 'run off [] eval-1', 'set view.view "loupe"']);
  });

  it('without a workbench: E_WORKBENCH with a hint; an unawaited call is UNHANDLED', async () => {
    const s = await setup();
    const r = await s.run('return await wb.commands()');
    expect(r.error?.code).toBe('E_WORKBENCH');
    const f = fakeWorkbench();
    const s2 = await setup({ workbench: f.wb });
    const u = await s2.run(`wb.commands(); return 1`);
    expect(u.warnings.map((w) => w.code)).toContain('UNHANDLED');
  });

  it('a layout is recorded as data: calls, spreads, selectors, state paths, command ids, .with at build time', async () => {
    const f = fakeWorkbench();
    const s = await setup({ workbench: f.wb });
    const r = await s.run(`
      const b = await wb.layouts.build({ id: 'mine', label: 'Mine', build: (ck, cb) => cb.studio('Mine')
        .menus(...cb.menus.standard())
        .with((x) => x.theme('craftkit'))
        .module(ck.module('main', { label: 'Main', stages: ['darkroom'] })
          .center(cb.viewer(cb.sel.frame.print(), { tools: ['probe', ...cb.kits.stack.maskTools] }))
          .right(ck.dock.column({ width: 300 }, cb.panels.history().hidden(cb.sel.doc.not()), ck.ui.button({ run: ['frame.rate', 3], text: 'Three' })))
          .keys({ ...cb.keys.darkroom, P: 'frame.pick' })
          .top(ck.match(cb.state.view.step, { a: ck.text('a') }, { of: ['a'] }))) });
      mem.layout = b.layout;
      return JSON.stringify({ ok: b.ok, id: b.layout.id, kind: b.layout.kind });`);
    expect(val(r)).toEqual({ ok: true, id: 'mine', kind: 'layout' });
    const tree = JSON.stringify(f.built[0]!.tree);
    expect(tree).toContain('"$spread');
    expect(tree).toContain('["cb","sel","frame","print",{"args":[]');
    expect(tree).toContain('"cb","state","view","step"');
    expect(tree).toContain('["frame.rate",3]');
    expect(tree).not.toContain('"with"');
    // the layout is data: kept on mem and proposed in a later eval
    const u = await s.run(`return JSON.stringify(await wb.layouts.use(mem.layout, { why: 'a simpler screen' }))`);
    expect(val(u)).toEqual({ status: 'proposed', id: 'mine', label: 'Mine', note: 'asked: a simpler screen' });
  });

  it('a lambda where an option goes is E_LAYOUT with the selector form as the fix; a bad id and no shell too', async () => {
    const f = fakeWorkbench();
    const s = await setup({ workbench: f.wb });
    const r = await s.run(`return await wb.layouts.build({ id: 'x', label: 'X', build: (ck, cb) => cb.studio('X').module(ck.module('m').center(cb.viewer((st) => cb.sel.frame(st)))) })`);
    expect(r.error?.code).toBe('E_LAYOUT');
    expect(r.error?.fix).toBe('cb.viewer(cb.sel.frame.print())');
    expect(r.error?.where?.line).toBe(1);
    expect((await s.run(`return await wb.layouts.build({ id: 'Bad Id', build: (ck, cb) => cb.studio('X') })`)).error?.code).toBe('E_LAYOUT');
    expect((await s.run(`return await wb.layouts.build({ id: 'x', build: () => 1 })`)).error?.code).toBe('E_LAYOUT');
    expect(f.built).toHaveLength(0);
  });

  it('use in read-only mode is refused', async () => {
    const f = fakeWorkbench();
    const s = await setup({ workbench: f.wb, mode: 'read-only' });
    const r = await s.run(`const b = await wb.layouts.build((ck, cb) => cb.studio('X')); return await wb.layouts.use(b)`);
    expect(r.error?.code).toBe('E_READONLY');
  });

  it('cb.looks.define registers an agent-written look here and at the host', async () => {
    const f = fakeWorkbench();
    const s = await setup({ workbench: f.wb });
    const src = `defineLook({ name: 'agent-warm', version: 1, label: 'Agent warm', group: 'Mine', doc: '', params: {}, stages: ['darkroom'], fn: () => ({ stacks: { darkroom: { order: ['f'], items: { f: { kind: 'layer', op: 'filter', params: { logH: [-0.05, 0, 0.05] }, name: 'Warm', enabled: true, amount: 1, mask: null, blend: 'normal', source: { kind: 'look' } } } } } }) })`;
    const r = await s.run(`const d = await cb.looks.define(${JSON.stringify(src)}); const p = cb.looks.whatIf(frame, 'agent-warm'); return JSON.stringify({ host: d.name, look: p.look })`);
    expect(val(r)).toEqual({ host: 'x', look: 'agent-warm' });
    expect(getLook('agent-warm', 1).label).toBe('Agent warm');
    expect(f.calls.some((c) => c.startsWith('look '))).toBe(true);
  });
});
