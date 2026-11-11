// Keys: chords, scoped key maps with build-time checks, and the router that turns a keydown into a command.
//
// Scopes, innermost first: text · dialog · tool:<id> · canvas · panel:<id> · module:<id> · global. The router
// builds the chain from where focus and the pointer are, walks it, and runs the first binding it finds. Single
// letters are refused in text and global scope (they would fire while someone types a caption). A held key can be
// a spring: Space is the Hand while it is down and the previous tool again when it comes up.

import { isMac, suggest } from './util.js';
import { site } from './diag.js';

const MOD_ORDER = ['mod', 'ctrl', 'alt', 'shift'];
const NAMES = {
  esc: 'escape', escape: 'escape', return: 'enter', enter: 'enter', space: 'space', ' ': 'space', spacebar: 'space',
  left: 'arrowleft', right: 'arrowright', up: 'arrowup', down: 'arrowdown',
  arrowleft: 'arrowleft', arrowright: 'arrowright', arrowup: 'arrowup', arrowdown: 'arrowdown',
  del: 'delete', delete: 'delete', backspace: 'backspace', tab: 'tab', home: 'home', end: 'end', pageup: 'pageup', pagedown: 'pagedown',
  plus: '=', minus: '-', comma: ',', period: '.', slash: '/', backslash: '\\', bracketleft: '[', bracketright: ']',
};
const CODE_KEYS = { Comma: ',', Period: '.', Slash: '/', Backslash: '\\', BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Semicolon: ';', Quote: "'", Backquote: '`', Space: 'space', NumpadAdd: '=', NumpadSubtract: '-' };

// 'Mod+Shift+Z' → 'mod+shift+z'; also accepts 'Cmd', 'Ctrl', 'Option', 'Alt', '⌘'
export function parseChord(s) {
  const raw = String(s).trim();
  if (!raw) throw new Error('empty chord');
  const parts = raw === '+' ? ['+'] : raw.split(/\+(?!$)/).map(x => x.trim()).filter(Boolean);
  const mods = new Set(); let key = null;
  for (const p of parts) {
    const l = p.toLowerCase();
    if (l === 'mod' || l === 'cmdorctrl' || l === 'primary') mods.add('mod');
    else if (l === 'cmd' || l === 'command' || l === 'meta' || l === '⌘') mods.add(isMac ? 'mod' : 'meta');
    else if (l === 'ctrl' || l === 'control' || l === '⌃') mods.add(isMac ? 'ctrl' : 'mod');
    else if (l === 'alt' || l === 'option' || l === 'opt' || l === '⌥') mods.add('alt');
    else if (l === 'shift' || l === '⇧') mods.add('shift');
    else { if (key) throw new Error(`two keys in one chord: '${raw}'`); key = NAMES[l] || (l.length === 1 ? l : /^f\d{1,2}$/.test(l) ? l : l); }
  }
  if (!key) throw new Error(`no key in chord '${raw}'`);
  return MOD_ORDER.filter(m => mods.has(m)).concat(mods.has('meta') ? ['meta'] : []).concat([key]).join('+');
}

export function chordFromEvent(e) {
  let key;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3).toLowerCase();
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^Numpad\d$/.test(e.code)) key = e.code.slice(6);
  else if (CODE_KEYS[e.code]) key = CODE_KEYS[e.code];
  else key = NAMES[String(e.key).toLowerCase()] || String(e.key).toLowerCase();
  if (key === 'shift' || key === 'control' || key === 'alt' || key === 'meta') return null;
  const mods = [];
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod) mods.push('mod');
  if (isMac && e.ctrlKey) mods.push('ctrl');
  if (e.altKey) mods.push('alt');
  if (e.shiftKey) mods.push('shift');
  if (!isMac && e.metaKey) mods.push('meta');
  return mods.concat([key]).join('+');
}

const GLYPH = { mod: isMac ? '⌘' : 'Ctrl', ctrl: '⌃', alt: isMac ? '⌥' : 'Alt', shift: isMac ? '⇧' : 'Shift', meta: 'Win' };
const KEYLABEL = { arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓', space: 'Space', enter: isMac ? '↩' : 'Enter', escape: 'Esc', backspace: isMac ? '⌫' : 'Backspace', delete: isMac ? '⌦' : 'Del', tab: 'Tab', '\\': '\\', pageup: 'PgUp', pagedown: 'PgDn' };
export function chordLabel(chord) {
  const parts = chord.split('+'); const key = parts.pop();
  const k = keyName(key);
  const m = parts.map(p => GLYPH[p] || p);
  return isMac ? m.join('') + k : m.concat([k]).join('+');
}
const keyName = key => KEYLABEL[key] || (key.length === 1 ? key.toUpperCase() : /^f\d+$/.test(key) ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1));
export const chordParts = chord => { const parts = chord.split('+'); const key = parts.pop(); return parts.map(p => GLYPH[p] || p).concat([keyName(key)]); };

export const isSingle = chord => !chord.includes('+') || /^shift\+[^+]$/.test(chord);
const RESERVED = new Set(['mod+w', 'mod+t', 'mod+n', 'mod+q', 'mod+shift+w', 'mod+shift+t', 'mod+shift+n', 'mod+tab', 'mod+l', 'mod+shift+q', 'f11']);

// ── key maps ─────────────────────────────────────────────────────────────
export class Keymap {
  constructor() { this.bindings = []; this.springs = []; }
  // target: a command id, or a ρ lambda (ctx, e) => …
  bind(scope, chord, target, at, extra = {}) {
    let c;
    try { c = parseChord(chord); } catch (e) { this.bindings.push({ scope, chord: String(chord), bad: e.message, target, at }); return; }
    this.bindings.push(Object.assign({ scope, chord: c, source: String(chord), target, at: at || site() }, extra));
  }
  bindMap(scope, map, at) { for (const [chord, target] of Object.entries(map || {})) this.bind(scope, chord, target, at); }
  spring(chord, tool, opts = {}, at) { this.springs.push({ chord: parseChord(chord), tool, opts, at: at || site() }); }
  table(scope) { const m = new Map(); for (const b of this.bindings) if (!b.bad && b.scope === scope) m.set(b.chord, b); return m; }
  scopes() { return [...new Set(this.bindings.map(b => b.scope))]; }
  // the command ids bound to a chord anywhere (for menus and the sheet): first binding per command
  // the chords that run a command; with scopes, only those that would answer there (a menu shows the key that works
  // in the current module, not one bound in another)
  chordsFor(cmd, scopes) { return this.bindings.filter(b => !b.bad && (!scopes || scopes.includes(b.scope)) && (b.target === cmd || (Array.isArray(b.target) && b.target[0] === cmd && b.target.length === 1))).map(b => b.chord); }

  // Build-time checks, reported as K2xx diagnostics.
  check(diag, commands, moduleIds = []) {
    const byScope = new Map();
    for (const b of this.bindings) {
      if (b.bad) { diag.error({ code: 'K202', title: 'A chord that does not parse', at: b.at, lines: [`'${b.source || b.chord}' in scope "${b.scope}": ${b.bad}`], fix: "Write chords like 'Mod+Shift+Z', 'Alt+Y', '\\\\' or 'ArrowRight'." }); continue; }
      const tid = Array.isArray(b.target) ? b.target[0] : b.target;
      if (typeof tid === 'string' && commands && !commands.has(tid)) {
        const s = commands.suggest(tid);
        diag.error({ code: 'K201', title: 'Key bound to a command that does not exist', at: b.at, lines: [`${chordLabel(b.chord)} → ${tid} in scope "${b.scope}"`], fix: s.length ? `Did you mean ${s.map(x => `'${x}'`).join(' or ')}?` : 'Add the command with .commands(c => c.add(…)) first.' });
      }
      if ((b.scope === 'global' || b.scope === 'text') && isSingle(b.chord) && !/^(escape|enter|tab|f\d+|delete|backspace|arrow\w+|space)$/.test(b.chord.replace(/^shift\+/, ''))) {
        diag.error({ code: 'K210', title: `Single-letter key in ${b.scope} scope`, at: b.at, lines: [`${chordLabel(b.chord)} → ${typeof b.target === 'string' ? b.target : 'a handler'} would fire while someone types.`], fix: `Bind it in a narrower scope: .keys('canvas', …) or a module, or add a modifier.` });
      }
      if (RESERVED.has(b.chord)) diag.warn({ code: 'K215', title: 'The browser keeps this chord', at: b.at, lines: [`${chordLabel(b.chord)} → ${typeof b.target === 'string' ? b.target : 'a handler'}: browsers do not pass it to pages.`], fix: 'Pick another chord; the shortcut sheet shows the free ones per scope.' });
      const scopes = b.scope === 'module:*' ? moduleIds.map(m => 'module:' + m) : [b.scope];
      for (const sc of scopes) {
        const m = byScope.get(sc) || byScope.set(sc, new Map()).get(sc);
        const prev = m.get(b.chord);
        if (prev && prev.target !== b.target && !(b.scope === 'module:*' && prev.scope !== 'module:*') && !(prev.scope === 'module:*' && b.scope !== 'module:*')) {
          diag.error({ code: 'K204', title: `Shortcut conflict in scope "${sc}"`, at: b.at, lines: [`${chordLabel(b.chord)} → ${nameOf(prev.target)}   ${loc(prev.at)}`, `${' '.repeat(chordLabel(b.chord).length)} → ${nameOf(b.target)}   ${loc(b.at)}`], fix: 'Give one of them another chord, or move one to a narrower scope.' });
        } else if (!prev || b.scope !== 'module:*') m.set(b.chord, b);
      }
    }
    // a narrower scope that takes a chord the global map uses: allowed, but said once
    const global = byScope.get('global') || new Map();
    for (const [sc, m] of byScope) {
      if (sc === 'global' || sc === 'text') continue;
      for (const [ch, b] of m) { const g = global.get(ch); if (g && g.target !== b.target && ch !== 'escape') diag.warn({ code: 'K205', title: `Scope "${sc}" shadows a global shortcut`, at: b.at, lines: [`${chordLabel(ch)} → ${nameOf(b.target)} here, ${nameOf(g.target)} everywhere else (${loc(g.at)})`], fix: 'Fine if intended; otherwise move one of them onto another chord.' }); }
    }
    for (const s of this.springs) if (!s.tool) diag.error({ code: 'K220', title: 'A spring with no tool', at: s.at, lines: [`${chordLabel(s.chord)}`], fix: ".spring('Space', 'hand')" });
  }
}
const nameOf = t => (typeof t === 'string' ? t : Array.isArray(t) ? `${t[0]}(${t.slice(1).join(', ')})` : 'a handler');
const loc = at => (at ? `${at.file}:${at.line}` : '');

// ── the router ───────────────────────────────────────────────────────────
// chain(): the active scope chain, innermost first; dispatch(chord, e) → handled?
export class KeyRouter {
  constructor(keymap, { chain, run, onSpring, moduleIds }) {
    this.keymap = keymap; this.chain = chain; this.runTarget = run; this.onSpring = onSpring; this.moduleIds = moduleIds || (() => []);
    this.tables = new Map();
    this.held = new Map();     // spring chord → { t0, used, tool }
    this.rebuild();
  }
  rebuild() {
    this.tables = new Map();
    for (const b of this.keymap.bindings) {
      if (b.bad) continue;
      const scopes = b.scope === 'module:*' ? this.moduleIds().map(m => 'module:' + m) : [b.scope];
      for (const sc of scopes) { const m = this.tables.get(sc) || this.tables.set(sc, new Map()).get(sc); if (b.scope !== 'module:*' || !m.has(b.chord)) m.set(b.chord, b); }
    }
  }
  lookup(chord, chain) {
    for (const sc of chain) { const t = this.tables.get(sc); const b = t && t.get(chord); if (b) return b; }
    return null;
  }
  keydown(e) {
    const chord = chordFromEvent(e);
    if (!chord) return false;
    const chain = this.chain(e);
    const inText = chain[0] === 'text';
    // springs: only outside text fields; a repeat of a held spring is swallowed
    const sp = !inText && !chain.includes('dialog') && this.keymap.springs.find(s => s.chord === chord && (!s.opts.while || s.opts.while(e)));
    if (sp) {
      if (this.held.has(chord)) { e.preventDefault(); return true; }
      this.held.set(chord, { t0: performance.now(), used: false, spring: sp });
      if (this.onSpring) this.onSpring('down', sp, e);
      e.preventDefault();
      return true;
    }
    const b = this.lookup(chord, chain);
    if (!b) return false;
    const ae = typeof document !== 'undefined' && document.activeElement;
    if ((chord === 'enter' || chord === 'space') && ae && ae.matches && ae.matches('button,[role="button"],[role="tab"],[role="menuitem"],a[href],summary') && b.scope !== 'global') return false;
    if (inText && b.scope !== 'text' && !chord.includes('mod+') && !/^(escape|f\d+)$/.test(chord)) return false;   // typing wins
    e.preventDefault(); e.stopPropagation();
    this.runTarget(b.target, e, b);
    return true;
  }
  keyup(e) {
    const chord = chordFromEvent(e);
    // a spring comes up when its key does, whatever modifiers changed meanwhile
    for (const [ch, h] of this.held) {
      const key = ch.split('+').pop();
      if (chord === ch || (chord && chord.split('+').pop() === key) || (!chord && e.key && e.key.toLowerCase() === key)) {
        this.held.delete(ch);
        const tap = !h.used && performance.now() - h.t0 < 250;
        if (this.onSpring) this.onSpring('up', h.spring, e, tap);
      }
    }
  }
  markUsed() { for (const h of this.held.values()) h.used = true; }   // a gesture ran while the spring was held
  releaseAll() { for (const [, h] of this.held) if (this.onSpring) this.onSpring('up', h.spring, null, false); this.held.clear(); }
}

export { suggest };
