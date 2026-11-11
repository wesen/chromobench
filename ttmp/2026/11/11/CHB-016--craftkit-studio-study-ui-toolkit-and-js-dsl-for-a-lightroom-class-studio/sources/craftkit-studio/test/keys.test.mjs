import assert from 'node:assert/strict';
import { parseChord, Keymap } from '../src/shell/core/keys.js';
import { Commands } from '../src/shell/core/commands.js';
import { Diagnostics } from '../src/shell/core/diag.js';
import { parseValue, UNITS } from '../src/shell/ui/habits.js';

assert.equal(parseChord('Mod+Shift+Z'), 'mod+shift+z');
assert.equal(parseChord('shift+mod+z'), 'mod+shift+z', 'modifier order is canonical');
assert.equal(parseChord('Alt+Y'), 'alt+y');
assert.equal(parseChord('\\'), '\\');
assert.equal(parseChord('ArrowRight'), 'arrowright');
assert.equal(parseChord('Mod+='), 'mod+=');

// key checks
const cmds = new Commands();
cmds.add('photo.pick', { run: () => {} }).add('photo.reject', { run: () => {} }).add('edit.undo', { run: () => {} });
const km = new Keymap();
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
assert.ok(codes.includes('CK-K204'), 'conflict in one scope');
assert.ok(codes.includes('CK-K210'), 'single letter in global');
assert.ok(codes.includes('CK-K205'), 'a scope shadowing a global key');
assert.ok(codes.includes('CK-K215'), 'a chord the browser keeps');
const k201 = D.list.find(d => d.code === 'CK-K201');
assert.ok(k201 && /photo.pick/.test(k201.fix), 'unknown command with a suggestion: ' + (k201 && k201.fix));

// units and arithmetic
const pv = (t, o) => parseValue(t, Object.assign({ units: UNITS }, o));
assert.equal(pv('12').value, 12);
assert.equal(pv('3p6', { unit: 'pt' }).value, 42, 'picas: 3p6 = 42 pt');
assert.ok(Math.abs(pv('1in', { unit: 'mm' }).value - 25.4) < 1e-9, '1in in a mm field');
assert.equal(pv('*2', { current: 7 }).value, 14, 'relative: *2');
assert.equal(pv('50%', { current: 30 }).value, 15, 'percent of the current value');
assert.equal(pv('12pt + 6pt', { unit: 'pt' }).value, 18, 'arithmetic with units');
assert.equal(pv('250', { max: 200 }).value, 200, 'clamped to the range');
assert.equal(pv('abc').ok, false, 'nonsense is refused');
console.log('keys and fields: all passed');
