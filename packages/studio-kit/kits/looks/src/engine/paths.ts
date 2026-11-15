// The document paths a look may name (CHB-037: looks edit format-3 documents): a medium field
// (`stages.darkroom.medium.grade`), the geometry or the output (`geometry.crop`), or a layer's argument by the
// layer's id (`main.params.time_s`, `lights.params.logH`, `b1.params.stops`). The ArgSpec of a path is the
// schema's (the consuming op's) for the fixed parts and the op's for a layer; Amount picks its rule from it.
import { closest, fail, getOp, ROOT_KEYS, ruleAt, schemas, type ArgSpec, type Document } from '@chromobench/contract';
import { layerOps } from '../../../../src/model/controls.ts';
import { strip } from '@chromobench/shell';
import { opOfId } from '../../../../src/model/doc.ts';

const isSpec = (r: unknown): r is ArgSpec => !!r && typeof (r as ArgSpec).type === 'string' && typeof (r as ArgSpec).doc === 'string';
const PARAM = /^([A-Za-z0-9_-]+)\.params\.([A-Za-z_]\w*)$/;

/** The first segment names a layer (not a root key of the document). */
export const isLayerPath = (path: string): boolean => !ROOT_KEYS.includes(path.split('.')[0]!);
/** The layer id a path starts with, or null for a path of the fixed parts. */
export const layerIdOf = (path: string): string | null => (isLayerPath(path) ? path.split('.')[0]! : null);

/** The ArgSpec of a document path (against `doc` for a layer's op when given), or undefined when no field is there. */
export function specAt(path: string, doc?: Document | null): ArgSpec | undefined {
  const s = schemas();
  const m = /^stages\.(\w+)\.medium\.(.+)$/.exec(path);
  let r: unknown;
  const media = m ? (s.media as Record<string, Parameters<typeof ruleAt>[0] | undefined>)[m[1]!] : undefined;
  if (m) r = media ? ruleAt(media, m[2]!) : undefined;
  else if (path.startsWith('geometry.')) r = ruleAt(s.geometry, path.slice(9));
  else if (path.startsWith('output.')) r = ruleAt(s.output, path.slice(7));
  else {
    const p = PARAM.exec(path);
    if (!p) return undefined;
    const op = opOfId(doc, p[1]!) ?? layerOps().find((o) => o.args[p[2]!])?.name;
    r = op ? getOp(op).args[p[2]!] : undefined;
  }
  return isSpec(r) ? r : undefined;
}

let SETTABLE: string[] | null = null;
/** Every path of the fixed parts with an ArgSpec, and the main exposure's and the printer lights' arguments. */
export function settablePaths(): string[] {
  if (SETTABLE) return SETTABLE;
  const out: string[] = [];
  const walk = (rule: unknown, path: string): void => {
    if (isSpec(rule)) return void out.push(path);
    if (!rule || typeof rule !== 'object' || typeof (rule as { check?: unknown }).check === 'function') return;
    for (const [k, r] of Object.entries(rule)) walk(r, `${path}.${k}`);
  };
  const s = schemas();
  for (const [stage, m] of Object.entries(s.media)) walk(m, `stages.${stage}.medium`);
  walk(s.geometry, 'geometry');
  walk(s.output, 'output');
  for (const a of Object.keys(getOp('expose').args)) out.push(`main.params.${a}`);
  out.push('lights.params.logH');
  return (SETTABLE = out);
}

/** E_PATH (with did-you-mean) unless the path names a field. */
export function checkPath(path: string, doc?: Document | null): void {
  if (specAt(path, doc)) return;
  const guess = closest(path, settablePaths());
  fail('E_PATH', `unknown document path "${path}"`, { path, ...(guess ? { hint: `did you mean ${guess}?`, fix: guess } : {}) });
}

/**
 * A frame's document as the state shows it, unwrapped: handlers and cells see the state through read-only
 * (tracking) views, and a document is edited (previewed) as the plain value it is.
 */
export const docAt = (s: any, f: string | null | undefined): Document | undefined => (f ? (strip(s?.docs?.[f]) as Document | undefined) : undefined); // eslint-disable-line @typescript-eslint/no-explicit-any
