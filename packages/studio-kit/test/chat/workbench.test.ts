// The studio as the agent's workbench (CHB-037 P6b, design §34): `wb` in a real DSL session over a started studio
// (MockEngine, the M1 fixture), and the two completeness tests over every built layout:
//   1. every command a key, a menu, a toolbar or a button reaches is in wb.commands();
//   2. every control of every built layout maps to a document path, a state path or a command.
import { describe, expect, it } from 'vitest';
import { DslSession, historyOf, type Workbench } from '@chromobench/dsl';
import { buildLayout, sel, type LayoutDef } from '../../src/index.ts';
import { LAYOUTS, type LayoutId } from '../../layouts/index.js';
import { studioWorkbench, type WorkbenchHost } from '../../kits/chat/src/workbench.ts';
import { started } from '../helpers.ts';
import { Journal } from '@chromobench/shell';

const val = (r: { yaml: string; error?: unknown }): any => {
  if (r.error) throw new Error(r.yaml);
  const line = r.yaml.split('\n')[0]!;
  const s = line.startsWith("'") ? line.slice(1, -1).replace(/''/g, "'") : line.startsWith('"') ? JSON.parse(line) : line;
  return JSON.parse(s);
};

async function bench(o: { def?: LayoutDef } = {}) {
  const s = await started(o.def ? { def: o.def } : {});
  const proposed: { def: LayoutDef; why?: string }[] = [];
  const host: WorkbenchHost = {
    rt: () => s.rt,
    studio: s.studio,
    layout: () => ({ id: o.def?.id ?? 'tiny', label: o.def?.label ?? 'Tiny', agent: false }),
    available: () => Object.keys(LAYOUTS).map((id) => ({ id, label: id })),
    propose: (def, p) => (proposed.push({ def, ...(p.why ? { why: p.why } : {}) }), { status: 'proposed', note: 'the photographer is asked' }),
  };
  const wb = studioWorkbench(host);
  const e = s.studio.frames.get(s.f)!;
  const session = await DslSession.create({
    engine: s.studio.engine,
    history: historyOf({ log: () => s.studio.log, mode: () => s.studio.mode, change: (f) => void s.studio.change(f) }),
    frames: { [s.f]: { source: e.info, name: 'M1' } },
    workbench: wb as unknown as Workbench,
  });
  return { ...s, wb, session, proposed, run: (code: string) => session.eval({ code, frame: s.f }) };
}

describe('wb over the studio', () => {
  it('commands, state through selectors, the screen with live values, set as a bound control writes', async () => {
    const b = await bench();
    const r = await b.run(`
      const cmds = await wb.commands('frame.');
      const pick = cmds.find((c) => c.id === 'frame.pick');
      const cur = await wb.state('current');
      const screen = await wb.screen();
      const time = screen.controls.find((c) => c.path === 'main.params.time_s');
      await wb.set('view.view', 'loupe');
      return JSON.stringify({ pick: { label: pick.label, enabled: pick.enabled, menu: pick.menu, keys: pick.keys.map((k) => k.chord) }, cur, layout: screen.layout.id, time: time && { frame: time.frame, value: time.value }, text: screen.text.split('\\n')[1], view: await wb.state('view') });`);
    const v = val(r);
    expect(v.pick).toMatchObject({ label: 'Flag as Pick', enabled: true });
    expect(v.cur).toBe(b.f);
    expect(v.layout).toBe('tiny');
    expect(v.time).toEqual({ frame: b.f, value: expect.any(Number) });
    expect(v.text).toMatch(/^module main/);
    expect(v.view.view).toBe('loupe');
  });

  it('wb.run is the command a key runs, by the agent: ask proposes, auto commits with the reason, read-only refuses', async () => {
    const b = await bench();
    b.studio.mode = 'ask';
    const r = await b.run(`return JSON.stringify(await wb.run('frame.rate', 4))`);
    const ask = val(r);
    expect(ask).toMatchObject({ ok: true, how: 'proposed' });
    expect(r.transactions.map((e) => [e.tx.by, e.tx.status, e.tx.source['command']])).toEqual([['agent', 'pending', 'frame.rate']]);
    expect(sel.rating(b.rt.state as never, b.f).stars).toBe(0);
    b.studio.mode = 'auto';
    const a = await b.session.eval({ code: `return JSON.stringify(await wb.run('frame.rate', 3))`, frame: b.f });
    expect(val(a)).toMatchObject({ ok: true, how: 'committed' });
    expect(sel.rating(b.rt.state as never, b.f).stars).toBe(3);
    expect(b.studio.log.inEffect('main').at(-1)!.tx.by).toBe('agent');
    b.studio.mode = 'read-only';
    const ro = val(await b.run(`return JSON.stringify(await wb.run('frame.rate', 1))`));
    expect(ro).toMatchObject({ ok: false, how: 'refused' });
    expect(sel.rating(b.rt.state as never, b.f).stars).toBe(3);
    // an unknown command is the agent's error, with a did-you-mean; a disabled one says why
    const u = await b.run(`return await wb.run('frame.rat', 1)`);
    expect([u.error?.code, u.error?.fix]).toEqual(['E_WORKBENCH', "wb.run('frame.rate')"]);
  });

  it('an agent builds a layout in the sandbox, the passes check it, and use proposes it', async () => {
    const b = await bench();
    b.studio.mode = 'ask';
    const r = await b.run(`
      const built = await wb.layouts.build({ id: 'just-print', label: 'Just the print', build: (ck, cb) => cb.studio('Chromobench')
        .menus(...cb.menus.standard())
        .module(ck.module('main', { label: 'Print', stages: ['darkroom'] })
          .center(cb.viewer(cb.sel.frame.print(), { tools: ['probe'] }))
          .right(ck.dock.column({ width: 300 }, cb.panels.controls('darkroom'), cb.panels.history().hidden(cb.sel.doc.not())))) });
      const bad = await wb.layouts.build({ id: 'bad', label: 'Bad', build: (ck, cb) => cb.studio('X').module(ck.module('m', { label: 'M' }).center(cb.nope())) });
      const used = await wb.layouts.use(built, { why: 'fewer panels' });
      return JSON.stringify({ ok: built.ok, errors: built.errors, controls: built.controls.filter((c) => c.path).map((c) => c.path), explain: built.explain.split('\\n')[1], bad: bad.ok, badMsg: bad.errors[0].message, used });`);
    const v = val(r);
    expect(v.ok, JSON.stringify(v.errors)).toBe(true);
    expect(v.controls).toContain('main.params.time_s');
    expect(v.explain).toMatch(/^module main "Print"/);
    expect(v.bad).toBe(false);
    expect(v.badMsg).toMatch(/cb has no nope/);
    expect(v.used).toMatchObject({ status: 'proposed', id: 'just-print' });
    // what the host was asked to mount is a layout definition that builds with the real ck and cb
    expect(b.proposed).toHaveLength(1);
    const app = buildLayout(b.proposed[0]!.def).app;
    expect(app.diagnostics.list.filter((d) => d.level === 'error')).toEqual([]);
    expect(b.proposed[0]!.why).toBe('fewer panels');
  });

  it('a layout that shows a stage its module does not declare gets the stage policy warning', async () => {
    const b = await bench();
    const r = await b.run(`
      const built = await wb.layouts.build({ id: 'odd', label: 'Odd', build: (ck, cb) => cb.studio('Chromobench')
        .module(ck.module('main', { label: 'Main', stages: ['darkroom'] }).center(cb.viewer(cb.sel.frame.print())).right(cb.kits.stack.panels.layers('print'))) });
      return JSON.stringify(built.warnings.map((w) => w.code));`);
    expect(val(r)).toContain('CB-S101');
  });
});

describe('wb.diagnostics (CHB-038)', () => {
  it('reads the journal: rows with counts, filters, totals, the environment and the explain text', async () => {
    const b = await bench();
    const none = await b.run(`return await wb.diagnostics()`);
    expect(none.yaml).toMatch(/E_WORKBENCH|no diagnostics journal/);
    const j = new Journal({ session: 'p1' });
    (b.rt.services as Record<string, unknown>)['diagnostics'] = { journal: j, environment: () => ({ gpu: { engine: { name: 'synthetic' } } }), show() {}, report() {}, openReport() {}, copySummary() {} };
    j.error('gpu', 'engine: validation error: Destroyed texture used in a submit', { code: 'GPU_VALIDATION', data: { during: 'film.grain' } });
    j.error('gpu', 'engine: validation error: Destroyed texture used in a submit', { code: 'GPU_VALIDATION', data: { during: 'film.grain' } });
    j.info('command', 'frame.next');
    const d = val(await b.run(`const d = await wb.diagnostics({ level: 'warn' }); const all = await wb.diagnostics(); return JSON.stringify({ rows: d.rows.map((r) => r.code + ' x' + r.count), all: all.rows.length, err: d.totals.error, gpu: d.environment.gpu.engine.name, text: (await wb.diagnostics().explain()).split('\\n')[1] })`));
    expect(d).toEqual({ rows: ['GPU_VALIDATION x2'], all: 2, err: 2, gpu: 'synthetic', text: 'this session: 2 errors, 0 warnings, 1 info' });
    const bad = await b.run(`return await wb.diagnostics({ level: 'loud' })`);
    expect(bad.yaml).toMatch(/no level loud/);
  });
});

describe('completeness (design §34): the agent surface and the screen agree', () => {
  const ids = Object.keys(LAYOUTS) as LayoutId[];

  it('1. every command a key, a menu, a toolbar or a button reaches is in wb.commands()', async () => {
    const missing: string[] = [];
    for (const id of ids) {
      const def = (await LAYOUTS[id]()).default;
      const b = await bench({ def });
      const listed = new Set(b.wb.commands().map((c) => (c as { id: string }).id));
      for (const r of b.rt.reachable()) if (!listed.has(r.id)) missing.push(`${id}: ${r.from} ${r.where} → ${r.id}`);
      // and through the sandbox, for one layout: the eval sees the same table
      if (id === 'classic') {
        const n = val(await b.run(`return JSON.stringify((await wb.commands()).length)`));
        expect(n).toBe(listed.size);
      }
    }
    expect(missing).toEqual([]);
  });

  it('2. every control of every built layout maps to a document path, a state path or a command', async () => {
    const bad: string[] = [];
    let n = 0;
    for (const id of ids) {
      const def = (await LAYOUTS[id]()).default;
      const b = await bench({ def });
      const commands = new Set(b.wb.commands().map((c) => (c as { id: string }).id));
      for (const m of b.rt.app.ir.modules) {
        const screen = b.wb.screen({ module: m.id }) as { controls: { form: string; label?: string; path?: string; state?: string; command?: string }[] };
        for (const c of screen.controls) {
          n++;
          const ok = !!c.path || !!c.state || (!!c.command && commands.has(c.command));
          if (!ok) bad.push(`${id}/${m.id}: ${c.form} ${c.label ?? ''} ${JSON.stringify(c)}`);
        }
      }
    }
    expect(bad).toEqual([]);
    expect(n).toBeGreaterThan(100);
  });
});
