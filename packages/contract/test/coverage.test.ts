// Compiled.coverage (contract 1.4, CHB-039): the coverage an entry acts through is the node the stage law uses
// (the light law's product of group masks and the layer's own), and output.frame puts a mask where the picture is.
import { describe, expect, it } from 'vitest';
import { insert } from '@chromobench/values';
import { compile, edit } from '@chromobench/contract';
import { G, L, camDoc, graph, linear, maskOf, push, scanDoc } from './helpers.ts';
import { diagOf } from './helpers.ts';

describe('Compiled.coverage', () => {
  const doc = () => edit(scanDoc(), [
    insert('masks', 'sky', maskOf([['c1', linear()]])),
    insert('masks', 'card', maskOf([['c2', linear(1, 7)]], { invert: true })),
    push('darkroom', 'cardg', G('card', [['b1', L('burn', { stops: 1 }, { mask: 'sky' })], ['b2', L('burn', { stops: 0.5 })]], { mask: 'card' })),
    push('darkroom', 'd1', L('dodge', { stops: 1 }, { mask: 'sky', enabled: false })),
    push('darkroom', 'plain', L('burn', { stops: 1 })),
  ]).doc;

  it('is the node the light law multiplies into the term: group mask × own mask', () => {
    const g = graph();
    const c = compile(doc(), g);
    const a = c.cuts['darkroom.H']!.args as Record<string, any>;
    const b1 = a['terms'].find((t: any) => t.amount === 1 && t.mask && g.get(t.mask)!.op === 'mask.combine');
    expect(c.coverage('b1')!.id).toBe(b1.mask);
    expect(c.coverage('b1')!.op).toBe('mask.combine');
  });

  it('a layer without a mask in a masked group has the group\'s; the group its own; none: null', () => {
    const g = graph();
    const c = compile(doc(), g);
    expect(c.coverage('b2')!.op).toBe('mask.invert');
    expect(c.coverage('cardg')!.id).toBe(c.coverage('b2')!.id);
    expect(c.coverage('plain')).toBeNull();
    expect(c.coverage('nope')).toBeNull();
  });

  it('a disabled entry\'s mask compiles too', () => {
    const c = compile(doc(), graph());
    expect(c.coverage('d1')!.op).toBe('mask.linear');
    expect(c.coverage('d1')!.info).toMatchObject({ kind: 'Image', domain: 'mask', channels: 1 });
  });

  it('works on the composite stages (a print layer, a scene layer)', () => {
    const d = edit(camDoc(), [
      insert('masks', 'm', maskOf([['c1', linear()]])),
      push('print', 'p1', L('exposure', { stops: 0.5 }, { mask: 'm' })),
      push('scene', 's1', L('exposure', { stops: 0.5 }, { mask: 'm' })),
    ]).doc;
    const c = compile(d, graph());
    expect(c.coverage('p1')!.op).toBe('mask.linear');
    expect(c.coverage('s1')!.op).toBe('mask.linear');
  });

  it('output.frame takes a mask: the display geometry on one channel', () => {
    const g = graph();
    const d = edit(doc(), [{ op: 'set', path: 'geometry.orientation', value: 'cw90' }, { op: 'set', path: 'geometry.crop', value: { x: 1, y: 2, w: 8, h: 6 } }]).doc;
    const c = compile(d, g);
    const m = c.coverage('b1')!;
    const top = c.display;
    const f = g.intern('output.frame', [m.id], top.args).node;
    expect(f.info).toMatchObject({ domain: 'mask', channels: 1, width: 6, height: 8 });
    expect((top.info as any).domain).toBe('display-rgb');
    // other domains are still refused
    expect(diagOf(() => g.intern('output.frame', [c.cuts['print']!.id], {})).code).toBe('E_DOMAIN');
  });
});
