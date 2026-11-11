// @chromobench/data — versioned, hashed data packs and their loader (CHB-004).
// Browser-safe entry point; node file-system helpers are in ./node.ts (`@chromobench/data/node`).
export * from './tensors.ts';
export * from './missing.ts';
export * from './manifest.ts';
export * from './sources.ts';
export * from './pack.ts';
export * from './physics.ts';
export * from './about.ts';
export { sha256Hex } from './hash.ts';

/** The pack engines use by default: spektrafilm at the pinned commit. */
export const DEFAULT_STOCK_PACK = 'spektrafilm@0.3.2+3bb2c2d';
/** Camera and scanner lights until CHB-013 measures the photographer's own (not measured: W_DATA_ILLUSTRATIVE). */
export const DEFAULT_SCANNER_PACK = 'illustrative@1';
/** Every pack committed in packages/data/packs. */
export const PACK_IDS = [DEFAULT_STOCK_PACK, 'interim-chromogen@1', 'interim-filmbench@1', DEFAULT_SCANNER_PACK] as const;
