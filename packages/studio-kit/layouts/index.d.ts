import type { LayoutDef } from '../src/layout.ts';
export type LayoutId = 'classic' | 'darkroom' | 'simple' | 'lab' | 'tiny' | 'roll' | 'finish' | 'looks';
export declare const LAYOUTS: Record<LayoutId, () => Promise<{ default: LayoutDef }>>;
export declare const DEFAULT_LAYOUT: 'classic';
