// Keys (port of CraftKit core/keys.js): chords, scoped key maps with build-time checks, and the router that turns a
// keydown into a command.
//
// Scopes, innermost first: text · dialog · tool:<id> · panel:<id> · canvas · module:<id> · global. A key's scope is
// where it was declared: a shell's keys are global, a module's module:<id>, a kit's kit:<name>; kit:<name> (like the
// built-in module:*) binds in every module, under the module's own keys. The router walks the chain it is given and
// runs the first binding it finds. Single letters are refused in text and global
// scope (they would fire while someone types a caption). A held key can be a spring: Space is the Hand while it
// is down and the previous tool again when it comes up.
//
// New in the port: the platform is a parameter (Mod is ⌘ on macOS, Ctrl elsewhere), and dispatch(chord, chain)
// works without a DOM, so key handling is testable headless.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { OTHER, type Platform } from './util.ts';
import type { CallSite, Diagnostics } from './diag.ts';
import type { Commands } from './commands.ts';

const MOD_ORDER = ['mod', 'ctrl', 'alt', 'shift'];
const NAMES: Record<string, string> = {
  esc: 'escape',
  escape: 'escape',
  return: 'enter',
  enter: 'enter',
  space: 'space',
  ' ': 'space',
  spacebar: 'space',
  left: 'arrowleft',
  right: 'arrowright',
  up: 'arrowup',
  down: 'arrowdown',
  arrowleft: 'arrowleft',
  arrowright: 'arrowright',
  arrowup: 'arrowup',
  arrowdown: 'arrowdown',
  del: 'delete',
  delete: 'delete',
  backspace: 'backspace',
  tab: 'tab',
  home: 'home',
  end: 'end',
  pageup: 'pageup',
  pagedown: 'pagedown',
  plus: '=',
  minus: '-',
  comma: ',',
  period: '.',
  slash: '/',
  backslash: '\\',
  bracketleft: '[',
  bracketright: ']',
};
const CODE_KEYS: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Space: 'space',
  NumpadAdd: '=',
  NumpadSubtract: '-',
};

/** 'Mod+Shift+Z' → 'mod+shift+z'; also accepts 'Cmd', 'Ctrl', 'Option', 'Alt', '⌘' */
export function parseChord(s: string, platform: Platform = OTHER): string {
  const raw = String(s).trim();
  if (!raw) throw new Error('empty chord');
  const parts = raw === '+' ? ['+'] : raw.split(/\+(?!$)/).map(x => x.trim()).filter(Boolean);
  const mods = new Set<string>();
  let key: string | null = null;
  for (const p of parts) {
    const l = p.toLowerCase();
    if (l === 'mod' || l === 'cmdorctrl' || l === 'primary') mods.add('mod');
    else if (l === 'cmd' || l === 'command' || l === 'meta' || l === '⌘') mods.add(platform.mac ? 'mod' : 'meta');
    else if (l === 'ctrl' || l === 'control' || l === '⌃') mods.add(platform.mac ? 'ctrl' : 'mod');
    else if (l === 'alt' || l === 'option' || l === 'opt' || l === '⌥') mods.add('alt');
    else if (l === 'shift' || l === '⇧') mods.add('shift');
    else {
      if (key) throw new Error(`two keys in one chord: '${raw}'`);
      key = NAMES[l] || l;
    }
  }
  if (!key) throw new Error(`no key in chord '${raw}'`);
  return MOD_ORDER.filter(m => mods.has(m))
    .concat(mods.has('meta') ? ['meta'] : [])
    .concat([key])
    .join('+');
}

export interface KeyEventLike {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  preventDefault?(): void;
  stopPropagation?(): void;
}

export function chordFromEvent(e: KeyEventLike, platform: Platform = OTHER): string | null {
  let key: string;
  const code = e.code || '';
  const typed = String(e.key ?? '');
  // letters follow the keyboard layout (CHB-027): Ctrl+Z on a German QWERTZ keyboard is the key labelled Z, whose
  // physical code is KeyY. A key that types no Latin letter (Option on a Mac, Cyrillic) falls back to the code.
  if (/^[a-z]$/i.test(typed) && /^Key[A-Z]$/.test(code)) key = typed.toLowerCase();
  else if (/^Key[A-Z]$/.test(code)) key = code.slice(3).toLowerCase();
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^Numpad\d$/.test(code)) key = code.slice(6);
  else if (CODE_KEYS[code]) key = CODE_KEYS[code]!;
  else key = NAMES[String(e.key).toLowerCase()] || String(e.key).toLowerCase();
  if (key === 'shift' || key === 'control' || key === 'alt' || key === 'meta') return null;
  const mods: string[] = [];
  const mod = platform.mac ? e.metaKey : e.ctrlKey;
  if (mod) mods.push('mod');
  if (platform.mac && e.ctrlKey) mods.push('ctrl');
  if (e.altKey) mods.push('alt');
  if (e.shiftKey) mods.push('shift');
  if (!platform.mac && e.metaKey) mods.push('meta');
  return mods.concat([key]).join('+');
}

const glyphs = (mac: boolean): Record<string, string> => ({ mod: mac ? '⌘' : 'Ctrl', ctrl: '⌃', alt: mac ? '⌥' : 'Alt', shift: mac ? '⇧' : 'Shift', meta: 'Win' });
const keyLabels = (mac: boolean): Record<string, string> => ({
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  space: 'Space',
  enter: mac ? '↩' : 'Enter',
  escape: 'Esc',
  backspace: mac ? '⌫' : 'Backspace',
  delete: mac ? '⌦' : 'Del',
  tab: 'Tab',
  '\\': '\\',
  pageup: 'PgUp',
  pagedown: 'PgDn',
});
const keyName = (key: string, mac: boolean): string =>
  keyLabels(mac)[key] || (key.length === 1 ? key.toUpperCase() : /^f\d+$/.test(key) ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1));

/** a canonical chord as the platform writes it: ⇧⌘Z on a Mac, Ctrl+Shift+Z elsewhere */
export function chordLabel(chord: string, platform: Platform = OTHER): string {
  const parts = chord.split('+');
  const key = parts.pop()!;
  const g = glyphs(platform.mac);
  const k = keyName(key, platform.mac);
  const m = parts.map(p => g[p] || p);
  return platform.mac ? m.join('') + k : m.concat([k]).join('+');
}
export const chordParts = (chord: string, platform: Platform = OTHER): string[] => {
  const parts = chord.split('+');
  const key = parts.pop()!;
  const g = glyphs(platform.mac);
  return parts.map(p => g[p] || p).concat([keyName(key, platform.mac)]);
};

export const isSingle = (chord: string): boolean => !chord.includes('+') || /^shift\+[^+]$/.test(chord);
const RESERVED = new Set(['mod+w', 'mod+t', 'mod+n', 'mod+q', 'mod+shift+w', 'mod+shift+t', 'mod+shift+n', 'mod+tab', 'mod+l', 'mod+shift+q', 'f11']);

/** a command id, a command with arguments (['photo.rate', 3]) or a ρ lambda (…, ctx) => … */
export type KeyTarget = string | [string, ...unknown[]] | ((...a: any[]) => unknown);
export interface Binding {
  scope: string;
  chord: string;
  source?: string;
  target: KeyTarget;
  at: CallSite | null;
  bad?: string;
  label?: string;
  [k: string]: unknown;
}
export interface Spring {
  chord: string;
  tool: string | { down?: KeyTarget; up?: KeyTarget } | null;
  opts: { label?: string; tap?: KeyTarget; while?: (e: KeyEventLike) => boolean };
  at: CallSite | null;
}

/** a scope that binds in every module (a module's own binding for the chord wins): module:* and kit:<name> */
export const everyModule = (scope: string): boolean => scope === 'module:*' || scope.startsWith('kit:');

const nameOf = (t: KeyTarget): string => (typeof t === 'string' ? t : Array.isArray(t) ? `${t[0]}(${t.slice(1).join(', ')})` : 'a handler');
const loc = (at: CallSite | null | undefined): string => (at ? `${at.file}:${at.line}` : '');

// ── key maps ─────────────────────────────────────────────────────────────
export class Keymap {
  bindings: Binding[] = [];
  springs: Spring[] = [];
  readonly platform: Platform;
  constructor(platform: Platform = OTHER) {
    this.platform = platform;
  }
  bind(scope: string, chord: string, target: KeyTarget, at: CallSite | null = null, extra: Record<string, unknown> = {}): void {
    let c: string;
    try {
      c = parseChord(chord, this.platform);
    } catch (e) {
      this.bindings.push({ scope, chord: String(chord), bad: (e as Error).message, target, at });
      return;
    }
    this.bindings.push(Object.assign({ scope, chord: c, source: String(chord), target, at }, extra));
  }
  bindMap(scope: string, map: Record<string, KeyTarget> | undefined, at: CallSite | null = null): void {
    for (const [chord, target] of Object.entries(map || {})) this.bind(scope, chord, target, at);
  }
  spring(chord: string, tool: Spring['tool'], opts: Spring['opts'] = {}, at: CallSite | null = null): void {
    this.springs.push({ chord: parseChord(chord, this.platform), tool, opts, at });
  }
  table(scope: string): Map<string, Binding> {
    const m = new Map<string, Binding>();
    for (const b of this.bindings) if (!b.bad && b.scope === scope) m.set(b.chord, b);
    return m;
  }
  scopes(): string[] {
    return [...new Set(this.bindings.map(b => b.scope))];
  }
  /** the chords that run a command; with scopes, only those that would answer there */
  chordsFor(cmd: string, scopes?: string[]): string[] {
    return this.bindings
      .filter(b => !b.bad && (!scopes || scopes.includes(b.scope)) && (b.target === cmd || (Array.isArray(b.target) && b.target[0] === cmd && b.target.length === 1)))
      .map(b => b.chord);
  }

  /** Build-time checks, reported as K2xx diagnostics. */
  check(D: Diagnostics, commands: Commands | null, moduleIds: string[] = []): void {
    const L = (c: string): string => chordLabel(c, this.platform);
    const byScope = new Map<string, Map<string, Binding>>();
    for (const b of this.bindings) {
      if (b.bad) {
        D.error('CK-K202', 'A chord that does not parse', {
          at: b.at,
          facts: [`'${b.source || b.chord}' in scope "${b.scope}": ${b.bad}`],
          fix: "Write chords like 'Mod+Shift+Z', 'Alt+Y', '\\\\' or 'ArrowRight'.",
        });
        continue;
      }
      const tid = Array.isArray(b.target) ? b.target[0] : b.target;
      if (typeof tid === 'string' && commands && !commands.has(tid)) {
        const s = commands.suggest(tid);
        D.error('CK-K201', 'Key bound to a command that does not exist', {
          at: b.at,
          facts: [`${L(b.chord)} → ${tid} in scope "${b.scope}"`],
          fix: s.length ? `Did you mean ${s.map(x => `'${x}'`).join(' or ')}?` : 'Add the command with .commands(c => c.add(…)) first.',
        });
      }
      if ((b.scope === 'global' || b.scope === 'text') && isSingle(b.chord) && !/^(escape|enter|tab|f\d+|delete|backspace|arrow\w+|space)$/.test(b.chord.replace(/^shift\+/, ''))) {
        D.error('CK-K210', `Single-letter key in ${b.scope} scope`, {
          at: b.at,
          facts: [`${L(b.chord)} → ${nameOf(b.target)} would fire while someone types.`],
          fix: `Bind it in a module (ck.module(…).keys({ … })) or a kit, or add a modifier.`,
        });
      }
      if (RESERVED.has(b.chord))
        D.warn('CK-K215', 'The browser keeps this chord', {
          at: b.at,
          facts: [`${L(b.chord)} → ${nameOf(b.target)}: browsers do not pass it to pages.`],
          fix: 'Pick another chord; the shortcut sheet shows the free ones per scope.',
        });
      const scopes = everyModule(b.scope) ? moduleIds.map(m => 'module:' + m) : [b.scope];
      for (const sc of scopes) {
        const m = byScope.get(sc) || byScope.set(sc, new Map()).get(sc)!;
        const prev = m.get(b.chord);
        if (prev && !sameTarget(prev.target, b.target) && !(everyModule(b.scope) && !everyModule(prev.scope)) && !(everyModule(prev.scope) && !everyModule(b.scope))) {
          D.error('CK-K204', `Shortcut conflict in scope "${sc}"`, {
            at: b.at,
            facts: [`${L(b.chord)} → ${nameOf(prev.target)}   ${loc(prev.at)}`, `${' '.repeat(L(b.chord).length)} → ${nameOf(b.target)}   ${loc(b.at)}`],
            fix: 'Give one of them another chord, or move one to a narrower scope.',
          });
        } else if (!prev || !everyModule(b.scope)) m.set(b.chord, b);
      }
    }
    // a narrower scope that takes a chord the global map uses: allowed, but said once
    const global = byScope.get('global') || new Map<string, Binding>();
    for (const [sc, m] of byScope) {
      if (sc === 'global' || sc === 'text') continue;
      for (const [ch, b] of m) {
        const g = global.get(ch);
        if (g && !sameTarget(g.target, b.target) && ch !== 'escape')
          D.warn('CK-K205', `Scope "${sc}" shadows a global shortcut`, {
            at: b.at,
            facts: [`${L(ch)} → ${nameOf(b.target)} here, ${nameOf(g.target)} everywhere else (${loc(g.at)})`],
            fix: 'Fine if intended; otherwise move one of them onto another chord.',
          });
      }
    }
    for (const s of this.springs) if (!s.tool) D.error('CK-K220', 'A spring with no tool', { at: s.at, facts: [L(s.chord)], fix: ".spring('Space', 'hand')" });
  }
}
const sameTarget = (a: KeyTarget, b: KeyTarget): boolean =>
  a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]));

// ── the router ───────────────────────────────────────────────────────────
export interface RouterOpts {
  /** the active scope chain, innermost first */
  chain: (e: KeyEventLike | null) => string[];
  run: (target: KeyTarget, e: KeyEventLike | null, b: Binding) => void;
  onSpring?: (phase: 'down' | 'up', sp: Spring, e: KeyEventLike | null, tap?: boolean) => void;
  moduleIds?: () => string[];
  now?: () => number;
  /** the focused element is a button-like thing (Enter/Space activate it rather than a non-global binding) */
  focusIsButton?: () => boolean;
}

export class KeyRouter {
  tables = new Map<string, Map<string, Binding>>();
  /** spring chord → { t0, used, spring } */
  held = new Map<string, { t0: number; used: boolean; spring: Spring }>();
  readonly keymap: Keymap;
  readonly opts: RouterOpts;
  constructor(keymap: Keymap, opts: RouterOpts) {
    this.keymap = keymap;
    this.opts = opts;
    this.rebuild();
  }
  rebuild(): void {
    this.tables = new Map();
    const ids = this.opts.moduleIds ? this.opts.moduleIds() : [];
    for (const b of this.keymap.bindings) {
      if (b.bad) continue;
      const scopes = everyModule(b.scope) ? ids.map(m => 'module:' + m) : [b.scope];
      for (const sc of scopes) {
        const m = this.tables.get(sc) || this.tables.set(sc, new Map()).get(sc)!;
        if (!everyModule(b.scope) || !m.has(b.chord)) m.set(b.chord, b);
      }
    }
  }
  lookup(chord: string, chain: string[]): Binding | null {
    for (const sc of chain) {
      const t = this.tables.get(sc);
      const b = t && t.get(chord);
      if (b) return b;
    }
    return null;
  }
  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }
  /** Headless dispatch: a canonical chord and the chain the DOM would compute. Returns whether it was handled. */
  dispatch(chord: string, chain?: string[], e: KeyEventLike | null = null): boolean {
    const ch = chain || this.opts.chain(e);
    const inText = ch[0] === 'text';
    // springs: only outside text fields; a repeat of a held spring is swallowed
    const sp = !inText && !ch.includes('dialog') && this.keymap.springs.find(s => s.chord === chord && (!s.opts.while || (e && s.opts.while(e))));
    if (sp) {
      if (this.held.has(chord)) return true;
      this.held.set(chord, { t0: this.now(), used: false, spring: sp });
      if (this.opts.onSpring) this.opts.onSpring('down', sp, e);
      return true;
    }
    const b = this.lookup(chord, ch);
    if (!b) return false;
    if ((chord === 'enter' || chord === 'space') && this.opts.focusIsButton && this.opts.focusIsButton() && b.scope !== 'global') return false;
    if (inText && b.scope !== 'text' && !chord.includes('mod+') && !/^(escape|f\d+)$/.test(chord)) return false; // typing wins
    this.opts.run(b.target, e, b);
    return true;
  }
  keydown(e: KeyEventLike, platform: Platform = this.keymap.platform): boolean {
    const chord = chordFromEvent(e, platform);
    if (!chord) return false;
    const handled = this.dispatch(chord, this.opts.chain(e), e);
    if (handled) {
      e.preventDefault?.();
      e.stopPropagation?.();
    }
    return handled;
  }
  /** release: a spring comes up when its key does, whatever modifiers changed meanwhile */
  release(chordOrKey: string | null, e: KeyEventLike | null = null): void {
    for (const [ch, h] of this.held) {
      const key = ch.split('+').pop();
      if (chordOrKey === ch || (chordOrKey && chordOrKey.split('+').pop() === key)) {
        this.held.delete(ch);
        const tap = !h.used && this.now() - h.t0 < 250;
        if (this.opts.onSpring) this.opts.onSpring('up', h.spring, e, tap);
      }
    }
  }
  keyup(e: KeyEventLike, platform: Platform = this.keymap.platform): void {
    const chord = chordFromEvent(e, platform);
    this.release(chord || (e.key ? e.key.toLowerCase() : null), e);
  }
  /** a gesture ran while the spring was held */
  markUsed(): void {
    for (const h of this.held.values()) h.used = true;
  }
  releaseAll(): void {
    for (const [, h] of this.held) if (this.opts.onSpring) this.opts.onSpring('up', h.spring, null, false);
    this.held.clear();
  }
}
