// CraftKit's test/keys.test.mjs (chords and key checks, on both platforms) and the units-and-arithmetic part.
import { describe, expect, it } from 'vitest';
import { parseChord, Keymap, KeyRouter, chordLabel, chordFromEvent } from '../../src/core/keys.ts';
import { Commands } from '../../src/core/commands.ts';
import { Diagnostics } from '../../src/core/diag.ts';
import { parseValue, UNITS, evalArith } from '../../src/core/math.ts';
import { MAC, OTHER } from '../../src/core/util.ts';

for (const platform of [OTHER, MAC]) {
  describe(`chords (${platform.mac ? 'mac' : 'other'})`, () => {
    it('canonical chords', () => {
      expect(parseChord('Mod+Shift+Z', platform)).toBe('mod+shift+z');
      expect(parseChord('shift+mod+z', platform)).toBe('mod+shift+z'); // modifier order is canonical
      expect(parseChord('Alt+Y', platform)).toBe('alt+y');
      expect(parseChord('\\', platform)).toBe('\\');
      expect(parseChord('ArrowRight', platform)).toBe('arrowright');
      expect(parseChord('Mod+=', platform)).toBe('mod+=');
    });
    it('Cmd and Ctrl follow the platform', () => {
      expect(parseChord('Cmd+S', platform)).toBe(platform.mac ? 'mod+s' : 'meta+s');
      expect(parseChord('Ctrl+S', platform)).toBe(platform.mac ? 'ctrl+s' : 'mod+s');
      expect(chordLabel('mod+shift+z', platform)).toBe(platform.mac ? '⇧⌘Z'.replace('⇧⌘', '⌘⇧') : 'Ctrl+Shift+Z');
    });
    it('events become chords from the physical key', () => {
      const e = { key: 'z', code: 'KeyZ', metaKey: platform.mac, ctrlKey: !platform.mac, shiftKey: true };
      expect(chordFromEvent(e, platform)).toBe('mod+shift+z');
    });
    it('letters follow the layout: Ctrl+Z on a German QWERTZ keyboard (code KeyY) is undo', () => {
      const m = { metaKey: platform.mac, ctrlKey: !platform.mac };
      expect(chordFromEvent({ key: 'z', code: 'KeyY', ...m }, platform)).toBe('mod+z');
      expect(chordFromEvent({ key: 'y', code: 'KeyZ', ...m }, platform)).toBe('mod+y');
      expect(chordFromEvent({ key: 'Z', code: 'KeyY', shiftKey: true, ...m }, platform)).toBe('mod+shift+z');
      // no Latin letter typed (Option+K on a Mac types '˚'): the physical key
      expect(chordFromEvent({ key: '˚', code: 'KeyK', altKey: true }, platform)).toBe('alt+k');
    });
    it('key checks: K201 K204 K205 K210 K215', () => {
      const cmds = new Commands();
      cmds.add('photo.pick', { run: () => {} }).add('photo.reject', { run: () => {} }).add('edit.undo', { run: () => {} });
      const km = new Keymap(platform);
      km.bind('module:library', 'P', 'photo.pick');
      km.bind('module:library', 'P', 'photo.reject');
      km.bind('global', 'X', 'photo.reject');
      km.bind('canvas', 'Mod+Z', 'photo.pick');
      km.bind('global', 'Mod+Z', 'edit.undo');
      km.bind('global', 'Mod+W', 'edit.undo');
      km.bind('canvas', 'Q', 'photo.pik');
      const D = new Diagnostics();
      km.check(D, cmds, ['library']);
      const codes = D.list.map(d => d.code).sort();
      expect(codes).toContain('CK-K204'); // conflict in one scope
      expect(codes).toContain('CK-K210'); // single letter in global
      expect(codes).toContain('CK-K205'); // a scope shadowing a global key
      expect(codes).toContain('CK-K215'); // a chord the browser keeps
      const k201 = D.list.find(d => d.code === 'CK-K201');
      expect(k201?.fix).toMatch(/photo.pick/); // unknown command with a suggestion
      const k204 = D.list.find(d => d.code === 'CK-K204')!;
      expect(k204.facts!.length).toBe(2); // both sites
    });
  });
}

describe('headless dispatch', () => {
  const setup = () => {
    const km = new Keymap(OTHER);
    km.bind('module:library', 'P', 'photo.pick');
    km.bind('global', 'Mod+Z', 'edit.undo');
    km.bind('text', 'Mod+B', 'text.bold');
    km.spring('Space', 'hand', { tap: 'view.toggle' });
    const ran: string[] = [];
    const springs: string[] = [];
    let t = 0;
    const r = new KeyRouter(km, {
      chain: () => ['canvas', 'module:library', 'global'],
      run: tg => void ran.push(String(tg)),
      onSpring: (phase, sp, _e, tap) => void springs.push(`${phase}:${sp.tool}${tap ? ':tap' : ''}`),
      now: () => t,
    });
    return { r, ran, springs, tick: (ms: number) => (t += ms) };
  };
  it('walks the chain to the first match', () => {
    const { r, ran } = setup();
    expect(r.dispatch('p')).toBe(true);
    expect(r.dispatch('mod+z')).toBe(true);
    expect(r.dispatch('q')).toBe(false);
    expect(ran).toEqual(['photo.pick', 'edit.undo']);
  });
  it('typing wins in text: single keys do not fire, Mod chords and text scope do', () => {
    const { r, ran } = setup();
    expect(r.dispatch('p', ['text', 'canvas', 'module:library', 'global'])).toBe(false);
    expect(r.dispatch('mod+b', ['text', 'global'])).toBe(true);
    expect(r.dispatch('mod+z', ['text', 'global'])).toBe(true);
    expect(ran).toEqual(['text.bold', 'edit.undo']);
  });
  it('springs: held while down, a quick tap runs its tap', () => {
    const { r, springs, tick } = setup();
    r.dispatch('space');
    r.dispatch('space'); // repeat swallowed
    tick(100);
    r.release('space');
    r.dispatch('space');
    tick(400);
    r.release('space');
    expect(springs).toEqual(['down:hand', 'up:hand:tap', 'down:hand', 'up:hand']);
  });
});

describe('units and arithmetic (no Function())', () => {
  const pv = (t: string, o: Record<string, unknown> = {}) => parseValue(t, { units: UNITS, ...o }) as { ok: boolean; value: number };
  it('ported cases', () => {
    expect(pv('12').value).toBe(12);
    expect(pv('3p6', { unit: 'pt' }).value).toBe(42); // picas: 3p6 = 42 pt
    expect(Math.abs(pv('1in', { unit: 'mm' }).value - 25.4)).toBeLessThan(1e-9); // 1in in a mm field
    expect(pv('*2', { current: 7 }).value).toBe(14); // relative: *2
    expect(pv('50%', { current: 30 }).value).toBe(15); // percent of the current value
    expect(pv('12pt + 6pt', { unit: 'pt' }).value).toBe(18); // arithmetic with units
    expect(pv('250', { max: 200 }).value).toBe(200); // clamped to the range
    expect(pv('abc').ok).toBe(false); // nonsense is refused
  });
  it('the evaluator', () => {
    expect(evalArith('0.5+0.25')).toBe(0.75);
    expect(evalArith('-(2+3)*4')).toBe(-20);
    expect(evalArith('2*(3')).toBeNaN();
    expect(evalArith('alert(1)')).toBeNaN();
    expect(pv('0.5+0.25').value).toBe(0.75);
    expect(pv('−3').value).toBe(-3);
  });
});
