// File metadata: what an exported file says about itself (PNG iTXt, TIFF Software/ImageDescription).
import { CONTRACT_VERSION } from '@chromobench/contract';

export interface FileMeta {
  /** sha256 of the canonical recipe that produced the file. */
  recipeSha256?: string;
  /** The recipe JSON itself (ExportSettings.recipe = 'embedded'). */
  recipeJson?: string;
  /** Output space and rendering, for humans. */
  space?: string;
  rendering?: string;
}

export const SOFTWARE = `chromobench (contract ${CONTRACT_VERSION})`;

/** PNG iTXt entries. */
export function pngText(m: FileMeta): Record<string, string> {
  const t: Record<string, string> = { Software: SOFTWARE };
  if (m.space) t['chromobench:space'] = m.space;
  if (m.rendering) t['chromobench:rendering'] = m.rendering;
  if (m.recipeSha256) t['chromobench:recipe-sha256'] = m.recipeSha256;
  if (m.recipeJson) t['chromobench:recipe'] = m.recipeJson;
  return t;
}

/** TIFF ImageDescription (270): one JSON object under the `chromobench` key. */
export function tiffDescription(m: FileMeta): string | undefined {
  const o: Record<string, unknown> = {};
  if (m.space) o['space'] = m.space;
  if (m.rendering) o['rendering'] = m.rendering;
  if (m.recipeSha256) o['recipeSha256'] = m.recipeSha256;
  if (m.recipeJson) o['recipe'] = JSON.parse(m.recipeJson) as unknown;
  return Object.keys(o).length ? JSON.stringify({ chromobench: o }) : undefined;
}
