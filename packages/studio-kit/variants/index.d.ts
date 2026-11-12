import type { VariantDef } from '../src/variant.ts';
export type VariantId = 'classic' | 'darkroom' | 'simple' | 'lab' | 'tiny' | 'roll' | 'looks';
export declare const VARIANTS: Record<VariantId, () => Promise<{ default: VariantDef }>>;
export declare const DEFAULT_VARIANT: 'classic';
