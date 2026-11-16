// The Edit Mask tool's geometry (CHB-049, MASK-3): which handle a pointer takes, and what a drag of it does to a
// gradient's or a shape's parameters — move, the ends, a side or a corner (the opposite one stays), the knob — with
// snapping to the picture's guides (Alt: none) and Shift for 15° steps and a square.
import { describe, expect, it } from 'vitest';
import { dragHandle, handlesOf, hitHandle, snapPoint, wrapAngle } from '../../kits/stack/src/handles.ts';

const M = { W: 300, H: 200, snap: 4 };
const box = (x: number, y: number, w: number, h: number, angle_deg = 0) => ({ box: { x, y, w, h }, angle_deg });

describe('Edit Mask handles', () => {
  it('a shape has eight sides and corners, a knob above its top and its middle; a gradient its two ends and middle', () => {
    const hs = handlesOf('ellipse', box(100, 50, 80, 40), 20);
    expect(hs.map((h) => h.id).sort()).toEqual(['e', 'move', 'n', 'ne', 'nw', 'rotate', 's', 'se', 'sw', 'w']);
    expect(hs.find((h) => h.id === 'rotate')).toMatchObject({ x: 140, y: 30 });
    expect(hs.find((h) => h.id === 'se')).toMatchObject({ x: 180, y: 90 });
    expect(handlesOf('linear', { from: { x: 10, y: 10 }, to: { x: 30, y: 50 } }).map((h) => h.id)).toEqual(['from', 'to', 'move']);
  });

  it('the pointer takes the nearest handle within reach, else moves the part from inside, else nothing', () => {
    const p = box(100, 50, 80, 40);
    expect(hitHandle('rect', p, 181, 89, 5)).toBe('se');
    expect(hitHandle('rect', p, 140, 31, 5, 20)).toBe('rotate');
    expect(hitHandle('rect', p, 120, 60, 5)).toBe('move');
    expect(hitHandle('rect', p, 20, 20, 5)).toBeNull();
    expect(hitHandle('linear', { from: { x: 10, y: 10 }, to: { x: 110, y: 10 } }, 60, 12, 5)).toBe('move');
  });

  it('move: the centre follows and snaps to the picture\'s centre lines (not with Alt)', () => {
    const p = box(100, 50, 80, 40);
    expect(dragHandle('radial', p, 'move', { x: 140, y: 70 }, { x: 150, y: 80 }, M)).toMatchObject({ box: { x: 110, y: 60, w: 80, h: 40 } });
    // the centre lands 2 px from the picture's centre (150, 100): it snaps there
    expect(dragHandle('radial', p, 'move', { x: 140, y: 70 }, { x: 152, y: 98 }, M)).toMatchObject({ box: { x: 110, y: 80 } });
    expect(dragHandle('radial', p, 'move', { x: 140, y: 70 }, { x: 152, y: 98 }, { ...M, alt: true })).toMatchObject({ box: { x: 112, y: 78 } });
  });

  it('a side moves alone, the opposite side stays; a corner with Shift makes a square', () => {
    const p = box(100, 50, 80, 40);
    expect(dragHandle('rect', p, 'e', { x: 180, y: 70 }, { x: 210, y: 75 }, M)).toMatchObject({ box: { x: 100, y: 50, w: 110, h: 40 } });
    expect(dragHandle('rect', p, 'n', { x: 140, y: 50 }, { x: 140, y: 30 }, M)).toMatchObject({ box: { x: 100, y: 30, w: 80, h: 60 } });
    expect(dragHandle('rect', p, 'se', { x: 180, y: 90 }, { x: 185, y: 120 }, { ...M, shift: true })).toMatchObject({ box: { x: 100, y: 50, w: 85, h: 85 } });
    // a side of a turned shape moves along the shape's own axis
    const t = dragHandle('ellipse', box(100, 50, 80, 40, 90), 'e', { x: 140, y: 110 }, { x: 140, y: 130 }, { ...M, alt: true });
    expect(t['box']).toMatchObject({ w: 100, h: 40 });
    expect(t['angle_deg']).toBe(90);
  });

  it('the knob turns the shape about its centre, Shift in 15° steps, within −90…90', () => {
    const p = box(100, 50, 80, 40);
    expect(dragHandle('rect', p, 'rotate', { x: 140, y: 30 }, { x: 160, y: 50 }, M)['angle_deg']).toBe(45);
    expect(dragHandle('rect', p, 'rotate', { x: 140, y: 30 }, { x: 161, y: 52 }, { ...M, shift: true })['angle_deg']).toBe(45);
    expect(dragHandle('rect', p, 'rotate', { x: 140, y: 30 }, { x: 140, y: 110 }, M)['angle_deg']).toBe(0); // upside down is the same shape
    expect(wrapAngle(135)).toBe(-45);
    expect(wrapAngle(90)).toBe(90);
  });

  it('a gradient\'s end moves alone, Shift keeps its angle in 15° steps; the middle moves both ends', () => {
    const p = { from: { x: 50, y: 50 }, to: { x: 150, y: 50 } };
    expect(dragHandle('linear', p, 'to', { x: 150, y: 50 }, { x: 160, y: 62 }, { ...M, alt: true })).toMatchObject({ from: { x: 50, y: 50 }, to: { x: 160, y: 62 } });
    const s = dragHandle('linear', p, 'to', { x: 150, y: 50 }, { x: 160, y: 62 }, { ...M, alt: true, shift: true })['to'] as { x: number; y: number };
    expect(s.y).toBeCloseTo(50, 1);
    expect(dragHandle('linear', p, 'move', { x: 100, y: 50 }, { x: 110, y: 40 }, { ...M, alt: true })).toMatchObject({ from: { x: 60, y: 40 }, to: { x: 160, y: 40 } });
  });

  it('snaps each axis to the nearest guide within reach: edges, thirds, centre lines', () => {
    expect(snapPoint(101, 3, 300, 200, 4)).toEqual({ x: 100, y: 0 });
    expect(snapPoint(120, 70, 300, 200, 4)).toEqual({ x: 120, y: 200 / 3 });
  });
});
