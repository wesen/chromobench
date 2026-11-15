// The typed selectors: one current, one way to read the studio's state (CHB-035 §32, CHB-029 item 7).
import { describe, expect, it } from 'vitest';
import { createCk } from '@chromobench/shell';
import { createCb, sel, type CbState } from '../src/index.ts';
import { started } from './helpers.ts';

describe('cb.sel', () => {
  it('is the one set of selectors: cb.sel is sel, and nothing else defines current', () => {
    const cb = createCb(createCk());
    expect(cb.sel).toBe(sel);
    expect('current' in cb).toBe(false);
  });
  it('reads the current frame, the targets, the handle and the document', async () => {
    const { rt, f } = await started();
    const s = rt.state as CbState;
    expect(sel.current(s)).toBe(f);
    expect(sel.targets(s)).toEqual([f]);
    expect(sel.doc(s)).toEqual(s.docs[f]);
    expect(sel.proposals(s)).toEqual([]);
    expect(sel.logVersion(s)).toBeGreaterThan(0);
    expect(sel.frame(s)?.print().frame).toBe(f);
    expect(sel.name(s)).toBe('m1.tif');
    expect(sel.visible(s).map(x => x.id)).toEqual([f]);
    expect(sel.isOffline(s, f)).toBe(false);
    expect(sel.kind(s, f)).toBe('negative');
  });
  it('is total on a partial or empty state', () => {
    expect(sel.current(undefined)).toBe(null);
    expect(sel.targets({})).toEqual([]);
    expect(sel.frame({})).toBe(null);
    expect(sel.library(null)).toEqual([]);
    expect(sel.name({}, 'x')).toBe('');
  });
});
