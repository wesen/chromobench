// Fragments, kits, passes and explain.
import { describe, expect, it } from 'vitest';
import { BuildError, createCk, type Diag, type FormNode } from '../../src/index.ts';
import { manualClock } from '../../src/testing/index.ts';
import { miniStudio, type MiniState } from '../fixtures/mini-studio.ts';

declare module '../../src/index.ts' {
  interface FormMethods<S> {
    slider: { stepped(n: number): FormNode<'slider', S> };
  }
}

/** the ratings kit of guide §5.2: a state slice, a command, keys, a slider fragment, a pass, docs */
const ratingsKit = (ck: ReturnType<typeof createCk>) =>
  ck
    .kit('ratings')
    .version('0.1')
    .state('ratings', { init: { stars: {} as Record<string, number> }, view: ['shown'] })
    .commands({
      'rate.set': {
        label: 'Set Rating',
        run: (ctx: any, n: number) => ctx.tx(`Rate ${n}`, (t: any) => void (t.ratings.stars[ctx.state.ui.photo] = n)),
      },
    })
    // a kit's keys bind in every module (scope kit:ratings)
    .keys(ck.digits(0, 5, 'rate.set'))
    .fragments(
      ck.fragment('slider', {
        methods: { stepped: (n: number) => ({ step: n }) },
        explain: n => (n.props['step'] ? `stepped ${n.props['step']}` : null),
      }),
    )
    .passes(
      ck.pass('ratings.reachable', { on: 'ui', after: 'keys' }, (ui: any, p) => {
        if (!ui.menus.some((m: any) => m.items.includes('rate.set'))) p.diag('RT-001', 'rate.set is in no menu', { level: 'info' });
      }),
    )
    .docs('## Ratings\nPress 0–5 to rate the current photo.');
const one = (ck: ReturnType<typeof createCk>, n: unknown) => ck.module('main').center(n as any);

describe('kits and fragments', () => {
  it('a kit adds a slice, a command, keys, a fragment method and a pass to a shell', () => {
    const ck = createCk();
    const ratings = ratingsKit(ck);
    // the kit's fragment methods are registered before the nodes are made; the method is a modifier
    ck.extend(ratings);
    const slider = ck.ui.slider({ min: 0, max: 100, bind: (s: any) => s.dev.vibrance }).stepped(5);
    expect(slider.props['step']).toBe(5);
    expect(Object.isFrozen(slider) && Object.isFrozen(slider.props)).toBe(true);
    const app = ck
      .shell('Studio')
      .state({ dev: { vibrance: 0 }, ui: { photo: 'a' } })
      .use(ratings)
      .module(ck.module('m').center(ck.panel.define('basic', {}, slider)))
      .build();
    expect(app.errors).toEqual([]);
    expect(app.codes('info')).toContain('RT-001');
    const placed = app.ir.modules[0]!.regions.center!.kids[0]!;
    expect(placed.props['step']).toBe(5);
    expect(app.ir.view).toContain('ratings.shown');
    const rt = app.start({ clock: manualClock() });
    rt.press('4');
    expect(rt.state.ratings.stars.a).toBe(4);
    rt.press('Mod+Z');
    expect(rt.state.ratings.stars.a).toBe(undefined);
    expect(app.explain()).toMatch(/slider 0…100 {2}bind dev\.vibrance {2}step 5 {2}stepped 5/);
    expect(app.ir.docs[0]!.source).toBe('ratings');
  });
  it('X120: an unknown method throws where it is called, with a suggestion from the receiver; X121 when `when` refuses', () => {
    const ck = createCk();
    const kit = ck.kit('strip').fragments(
      ck.fragment('slider', {
        when: n => n.props['unit'] === 's',
        methods: { testStrip: () => ({ aside: ck.text('strip') }) },
      }),
    );
    ck.extend(kit);
    const thrown = (f: () => unknown): Diag => {
      try {
        f();
      } catch (e) {
        expect(e).toBeInstanceOf(BuildError);
        return (e as BuildError).diagnostic;
      }
      throw new Error('did not throw');
    };
    const typo = thrown(() => (ck.ui.slider({ min: 0, max: 9, bind: (s: any) => s.t, unit: 's' }) as any).testStip());
    expect(typo.code).toBe('CK-X120');
    expect(typo.fix).toBe('Did you mean .testStrip() (kit strip)?');
    expect(typo.at?.file).toBe('build/extend.test.ts');
    const other = thrown(() => (ck.ui.number({ bind: (s: any) => s.t }) as any).testStrip());
    expect(other.code).toBe('CK-X120');
    expect(other.facts![0]).toMatch(/exists for slider/);
    expect(thrown(() => (ck.ui.slider({ min: 0, max: 9, bind: (s: any) => s.g }) as any).testStrip()).code).toBe('CK-X121');
    expect((ck.ui.slider({ min: 0, max: 9, bind: (s: any) => s.t, unit: 's' }) as any).testStrip().props['aside'].$).toBe('text');
  });
  it('X110: two kits adding the same method, naming both', () => {
    const ck = createCk();
    const f = (name: string) => ck.kit(name).fragments(ck.fragment('slider', { methods: { stepped: (n: number) => ({ step: n }) } }));
    const app = ck.shell('x').use(f('a')).use(f('b')).module(one(ck, ck.text('x'))).build();
    const d = app.diagnostics.list.find(x => x.code === 'CK-X110')!;
    expect(d.facts!.join(' ')).toMatch(/kit a.*kit b/);
  });
  it('dependencies install first, each once; X130 missing, X131 cycle; X101 conflicts; replace: true wins', () => {
    const ck = createCk();
    const x = one(ck, ck.text('x'));
    const base = ck.kit('base').commands({ 'base.x': { run: () => 1 } });
    const feat = ck.kit('feat').requires(base).commands({ 'feat.y': { run: () => 2 } });
    const app = ck.shell('x').use(feat).use(base).module(x).build();
    expect(app.ir.kits.map(k => k.name)).toEqual(['base', 'feat']);
    expect(app.errors).toEqual([]);
    const lonely = ck.kit('lonely').requires('nothere');
    expect(ck.shell('x').use(lonely).module(x).build().codes()).toContain('CK-X130');
    const a = ck.kit('a').requires('b');
    const b = ck.kit('b').requires('a');
    expect(ck.shell('x').use(a).use(b).module(x).build().codes()).toContain('CK-X131');
    const c1 = ck.kit('c1').commands({ same: { run: () => 1 } });
    const c2 = ck.kit('c2').commands({ same: { run: () => 2 } });
    expect(ck.shell('x').use(c1).use(c2).module(x).build().codes()).toContain('CK-X101');
    const c3 = ck.kit('c3').commands({ same: { run: () => 3, replace: true } });
    const ok = ck.shell('x').use(c1).use(c3).module(x).build();
    expect(ok.codes()).not.toContain('CK-X101');
    expect(ok.start({ clock: manualClock() }).run('same')).toBe(3);
  });
  it('builder fragments: a kit offers a whole module as one call, once it is registered with ck.extend', () => {
    const ck = createCk();
    const kit = ck.kit('mods').fragments(
      ck.fragment('shell', {
        methods: { simpleModule: (id: string) => (s: any) => s.module(ck.module(id).center(ck.text(id))) },
      }),
    );
    expect(() => (ck.shell('x') as any).simpleModule('early')).toThrow(/CK-X120/);
    ck.extend(kit);
    const app = (ck.shell('x') as any).simpleModule('late').use(kit).build();
    expect(app.ir.modules.map((m: any) => m.id)).toEqual(['late']);
    expect(() => (ck.shell('x') as any).nope()).toThrow(/No method \.nope\(\) on the shell/);
  });
  it('routes declared by a kit check bindings under them with the key as a wildcard', () => {
    const ck = createCk();
    const FIELDS = ['print.time_s', 'print.grade'];
    const kit = ck
      .kit('cb')
      .state('recipes', { init: {} })
      .route('recipes', {
        keyDepth: 1,
        checkPath: rest => (FIELDS.includes(rest.join('.')) ? null : { message: `no recipe field ${rest.join('.')}`, fix: `Did you mean ${FIELDS[0]}?` }),
      });
    const app = ck
      .shell('x')
      .state({ ui: { frame: null as string | null } })
      .use(kit)
      .module(one(ck, ck.column({}, ck.ui.slider({ min: 1, max: 60, bind: (s: any) => s.recipes[s.ui.frame].print.time_s }), ck.ui.slider({ min: 1, max: 60, bind: (s: any) => s.recipes[s.ui.frame].print.time }))))
      .build();
    const d = app.diagnostics.list.filter(x => x.code === 'CK-B114');
    expect(d.length).toBe(1);
    expect(d[0]!.path).toBe('recipes.*.print.time');
    expect(app.codes()).not.toContain('CK-B110');
    expect(app.codes()).not.toContain('CK-B111');
  });
});

describe('passes and IRs', () => {
  it('passes are ordered by after/before; a cycle is X140', () => {
    const ck = createCk();
    const order: string[] = [];
    const p1 = ck.pass('one', { on: 'recipe', after: 'two' }, () => void order.push('one'));
    const p2 = ck.pass('two', { on: 'recipe' }, () => void order.push('two'));
    const p3 = ck.pass('three', { on: 'recipe', before: 'two' }, () => void order.push('three'));
    const r = ck.run('recipe', { a: 1 }, { passes: [p1, p2, p3] });
    expect(order).toEqual(['three', 'two', 'one']);
    expect(r.order).toEqual(['three', 'two', 'one']);
    const c1 = ck.pass('c1', { on: 'recipe', after: 'c2' }, () => {});
    const c2 = ck.pass('c2', { on: 'recipe', after: 'c1' }, () => {});
    expect(ck.run('recipe', {}, { passes: [c1, c2] }).diagnostics.codes()).toContain('CK-X140');
  });
  it('a pass may rewrite (lower) the IR; diagnostics carry the pass as source', () => {
    const ck = createCk();
    ck.ir('patch', { explain: (p: any) => Object.entries(p).map(([k, v]) => `${k} = ${v}`).join('\n') });
    const amount = ck.pass('amount', { on: 'patch', options: { amount: 0.5 } }, (p: any, ctx) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, (v as number) * (ctx.options['amount'] as number)])));
    const check = ck.pass('range', { on: 'patch', after: 'amount' }, (p: any, ctx) => {
      if (p.grade > 2) ctx.warn('CB-L001', 'grade above 2');
    });
    const r = ck.run('patch', { grade: 5, time: 10 }, { passes: [amount, check] });
    expect(r.ir).toEqual({ grade: 2.5, time: 5 });
    expect(r.diagnostics.list[0]!.source).toBe('range');
    expect(ck.explain(r.ir, { ir: 'patch' })).toBe('grade = 2.5\ntime = 5');
  });
});

describe('explain', () => {
  it('the mini studio explains deterministically (snapshot)', () => {
    const ck = createCk<MiniState>();
    const app = miniStudio(ck).build();
    const text = app.explain();
    expect(text).toBe(miniStudio(createCk<MiniState>()).build().explain());
    expect(text).toMatchSnapshot();
  });
  it('live explain evaluates τ props and says why commands are disabled', () => {
    const ck = createCk<MiniState>();
    const rt = miniStudio(ck).build().start({ clock: manualClock() });
    rt.go('develop');
    const live = rt.explain({ live: true });
    expect(live).toMatch(/dev\.reset "Reset Develop Settings — disabled, why: Nothing to reset"/);
    expect(live).toMatch(/viewport main "Photo 1"/);
    expect(live).toMatch(/bind dev\.p0\.light\.exposure = 0/);
  });
  it('a node, a kit, a pass', () => {
    const ck = createCk();
    expect(ck.explain(ck.ui.slider({ min: -5, max: 5, bind: (s: any) => s.dev.light.exposure, label: 'Exposure', step: 0.05 }))).toBe('slider -5…5 "Exposure"  bind dev.light.exposure  step 0.05');
    expect(ck.explain(ratingsKit(ck))).toMatch(/^kit ratings@0.1\n {2}state ratings \(view: shown\)/);
    expect(ck.explain(ck.pass('p', { on: 'ui', after: 'keys' }, () => {}))).toBe('pass p on ui after keys');
  });
});
