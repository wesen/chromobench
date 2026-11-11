// Keyboard shortcuts (guide §5.10). Deliberately no shortcut approves agent changes.
export type Action =
  | 'undo' | 'redo' | 'beforeAfter' | 'snapshot' | 'testStrip' | 'ringAround' | 'mask'
  | 'view1' | 'view2' | 'view3' | 'view4' | 'fit' | 'oneToOne' | 'zoomIn' | 'zoomOut' | 'escape' | 'help';

export const SHORTCUTS: [string, string, Action][] = [
  ['Ctrl/Cmd+Z', 'undo', 'undo'],
  ['Shift+Ctrl/Cmd+Z', 'redo', 'redo'],
  ['\\', 'before / after', 'beforeAfter'],
  ['s', 'snapshot', 'snapshot'],
  ['t', 'test strip', 'testStrip'],
  ['r', 'ring-around', 'ringAround'],
  ['m', 'mask tool ([ ] size, o overlay, b brush)', 'mask'],
  ['1 2 3 4', 'print, negative, dyes, base & gamut', 'view1'],
  ['f', 'fit', 'fit'],
  ['z', 'toggle 1:1', 'oneToOne'],
  ['+ / −', 'zoom in / out', 'zoomIn'],
  ['p (viewer focused)', 'pin a probe at the cursor; arrows move the probe', 'escape'],
  ['i (control focused)', 'why does this control have its value', 'escape'],
  ['← → (film strip focused)', 'previous / next frame', 'escape'],
  ['Esc', 'cancel the drag or close the tool', 'escape'],
  ['?', 'show shortcuts', 'help'],
];

export interface KeyLike { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }

/** The action for a key event, or null. Text fields are filtered by the caller (range inputs excepted). */
export function actionFor(e: KeyLike): Action | null {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (mod || e.altKey) return null;
  switch (e.key) {
    case '\\': return 'beforeAfter';
    case 's': return 'snapshot';
    case 't': return 'testStrip';
    case 'r': return 'ringAround';
    case 'm': return 'mask';
    case '1': return 'view1';
    case '2': return 'view2';
    case '3': return 'view3';
    case '4': return 'view4';
    case 'f': return 'fit';
    case 'z': return 'oneToOne';
    case '+': case '=': return 'zoomIn';
    case '-': case '−': return 'zoomOut';
    case 'Escape': return 'escape';
    case '?': return 'help';
    default: return null;
  }
}

/** True when the event comes from a field where typing must not trigger shortcuts. */
export function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
  if (el.tagName === 'SELECT') return true;
  if (el.tagName === 'INPUT') return !['range', 'checkbox', 'radio', 'button'].includes((el as HTMLInputElement).type);
  return false;
}
