// Themes are data: token → CSS value. shell.css carries the CraftKit tokens on :root as the look before a theme is
// applied (and for pages without a shell); applyTheme writes the selected theme's tokens — light or dark following
// prefers-color-scheme, or one of the interface grays — as custom properties on a target element (the app root, or
// the document root when the host frame around the app should follow the theme too). CHB-025: switchable at runtime.

import type { Theme } from '../build/types.ts';
import { DEFAULT_THEME, themeTokens } from '../themes/tokens.ts';

const cssName = (token: string): string => '--' + token;

export interface ThemeHandle {
  /** show another theme and/or interface gray ('auto', '1'…'4') */
  set(theme: Theme | null, gray?: string | null): void;
  /** stop following the colour scheme */
  dispose(): void;
}

/** the colour scheme the viewer asks for: data-theme on <html> wins over prefers-color-scheme */
function wantsDark(mq: MediaQueryList | null): boolean {
  const forced = typeof document !== 'undefined' ? document.documentElement.dataset['theme'] : undefined;
  if (forced === 'dark') return true;
  if (forced === 'light') return false;
  return !!mq?.matches;
}

/** theme a target element; `fallback` is shown for a null theme */
export function themeHandle(target: HTMLElement, fallback: Theme | null = null): ThemeHandle {
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  let theme: Theme | null = fallback;
  let gray = 'auto';
  let written: string[] = [];
  const paint = (): void => {
    target.dataset['ckTheme'] = theme?.name ?? DEFAULT_THEME;
    target.dataset['gray'] = gray;
    const stale = new Set(written);
    written = [];
    if (theme) {
      const { tokens, dark } = themeTokens(theme, { dark: wantsDark(mq), gray });
      for (const [k, v] of Object.entries(tokens)) {
        target.style.setProperty(cssName(k), v);
        stale.delete(cssName(k));
        written.push(cssName(k));
      }
      target.style.colorScheme = dark ? 'dark' : 'light';
    } else target.style.removeProperty('color-scheme');
    for (const k of stale) target.style.removeProperty(k);
  };
  const onScheme = (): void => paint();
  mq?.addEventListener?.('change', onScheme);
  paint();
  return {
    set(t, g) {
      theme = t ?? fallback;
      gray = g && /^[1-4]$/.test(String(g)) ? String(g) : 'auto';
      paint();
    },
    dispose() {
      mq?.removeEventListener?.('change', onScheme);
    },
  };
}

/** apply a theme to an element once (and follow the colour scheme); returns a function that stops following it */
export function applyTheme(root: HTMLElement, theme: Theme | null, gray?: string | null): () => void {
  const h = themeHandle(root, theme);
  if (gray) h.set(theme, gray);
  return () => h.dispose();
}
