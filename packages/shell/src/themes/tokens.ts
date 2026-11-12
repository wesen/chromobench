// Which tokens a theme gives for a colour scheme and an interface gray (CHB-025). Headless: the DOM half
// (dom/theme.ts) writes the result as custom properties; tests check it directly.
import type { Theme } from '../build/types.ts';

/** the interface grays in menu order; 'auto' follows the viewer's colour scheme */
export const GRAY_IDS = ['auto', '1', '2', '3', '4'] as const;

/** the default theme's name, and old names that still select a theme */
export const DEFAULT_THEME = 'craftkit';
export const THEME_ALIASES: Record<string, string> = { lightroom: 'craftkit' };

export interface ThemeTokens {
  tokens: Record<string, string>;
  dark: boolean;
}

/**
 * The token set for `theme` when the system asks for `dark`, under interface gray `gray` ('auto' or '1'…'4').
 * Gray 4 lies over the light set and grays 1–3 over the dark one; a theme without its own grays shows that set.
 */
export function themeTokens(theme: Theme, o: { dark: boolean; gray?: string | null }): ThemeTokens {
  const g = o.gray && o.gray !== 'auto' && /^[1-4]$/.test(o.gray) ? o.gray : null;
  const dark = g ? g !== '4' : o.dark;
  const tokens = { ...theme.light, ...(dark ? theme.dark ?? {} : {}), ...(g ? theme.grays?.[g] ?? {} : {}) };
  return { tokens, dark: dark && !!theme.dark };
}

/** the theme a name selects among `themes` (aliases resolved), else null */
export function resolveTheme(themes: Map<string, Theme>, name: string | null | undefined): Theme | null {
  if (!name) return null;
  return themes.get(name) ?? themes.get(THEME_ALIASES[name] ?? '') ?? null;
}
