// Variants (guide §8; CHB-016 §10.1): one module whose default export builds a whole studio from ck and cb, which
// it receives as arguments and never imports (so a variant file is self-contained and loadable from a Blob URL).
import { createCk, type BuiltApp, type Ck } from '@chromobench/shell';
import { createCb, type Cb } from './cb.ts';

export interface VariantEnv {
  params: Record<string, unknown>;
  dev: boolean;
  hostVersion: string;
}
export interface VariantDef {
  id: string;
  label: string;
  description?: string;
  build(ck: Ck, cb: Cb, env: VariantEnv): { build(): BuiltApp } | unknown;
}

const isDef = (x: unknown): x is VariantDef => !!x && typeof x === 'object' && typeof (x as VariantDef).id === 'string' && typeof (x as VariantDef).build === 'function';

/** identity, plus a shape check (CB-K520 when the default export is not a variant) */
export function defineVariant<V extends VariantDef>(def: V): V {
  if (!isDef(def)) throw new TypeError('CB-K520 defineVariant: a variant is { id, label, build(ck, cb, env) }');
  return def;
}

export interface BuiltVariant {
  def: VariantDef;
  app: BuiltApp;
  ck: Ck;
  cb: Cb;
}

/** Build a variant headless: a fresh ck and cb per build, so two variants never share registries. */
export function buildVariant(def: unknown, o: { env?: Partial<VariantEnv> } = {}): BuiltVariant {
  if (!isDef(def)) throw new TypeError(`CB-K520: not a variant (expected { id, label, build(ck, cb, env) }, got ${typeof def})`);
  const ck = createCk();
  const cb = createCb(ck);
  const env: VariantEnv = { params: {}, dev: false, hostVersion: '0.1.0', ...o.env };
  const builder = def.build(ck, cb, env) as { build?: () => BuiltApp } | undefined;
  if (!builder || typeof builder.build !== 'function') throw new TypeError(`CB-K520: variant '${def.id}' build() must return a shell builder (cb.studio(…))`);
  const app = builder.build();
  if (!app.ir.kits.some(k => k.name === 'cb.core'))
    app.diagnostics.error('CB-K501', `Variant '${def.id}' does not install cb.core`, { fix: 'Start from cb.studio(name), or call .use(cb.core)' });
  return { def, app, ck, cb };
}
