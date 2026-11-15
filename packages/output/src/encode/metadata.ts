// File metadata: what an exported file says about itself (PNG iTXt, TIFF Software/ImageDescription).
import { CONTRACT_VERSION } from '@chromobench/contract';

export interface FileMeta {
  /** sha256 of the canonical document that produced the file (documentSha256). */
  documentSha256?: string;
  /** The document JSON itself (ExportSettings.document = 'embedded'). */
  documentJson?: string;
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
  if (m.documentSha256) t['chromobench:document-sha256'] = m.documentSha256;
  if (m.documentJson) t['chromobench:document'] = m.documentJson;
  return t;
}

/** TIFF ImageDescription (270): one JSON object under the `chromobench` key. */
export function tiffDescription(m: FileMeta): string | undefined {
  const o: Record<string, unknown> = {};
  if (m.space) o['space'] = m.space;
  if (m.rendering) o['rendering'] = m.rendering;
  if (m.documentSha256) o['documentSha256'] = m.documentSha256;
  if (m.documentJson) o['document'] = JSON.parse(m.documentJson) as unknown;
  return Object.keys(o).length ? JSON.stringify({ chromobench: o }) : undefined;
}
