// Themes are data: token → CSS value. shell.css carries the lightroom tokens on :root (with its dark variant and
// the four interface greys); another theme sets its tokens as custom properties on the app root, light or dark
// following prefers-color-scheme.

import type { Theme } from '../build/types.ts';

const cssName = (token: string): string => '--' + token;

/** apply a theme to the app root; returns a function that stops following the colour scheme */
export function applyTheme(root: HTMLElement, theme: Theme | null): () => void {
  root.dataset['ckTheme'] = theme?.name ?? 'lightroom';
  if (!theme || theme.name === 'lightroom') return () => {};
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  const set = (): void => {
    const dark = !!mq?.matches && !!theme.dark && document.documentElement.dataset['theme'] !== 'light';
    const tokens = { ...theme.light, ...(dark ? theme.dark : {}) };
    for (const [k, v] of Object.entries(tokens)) root.style.setProperty(cssName(k), v);
    root.style.colorScheme = dark ? 'dark' : 'light';
  };
  set();
  mq?.addEventListener?.('change', set);
  return () => mq?.removeEventListener?.('change', set);
}
