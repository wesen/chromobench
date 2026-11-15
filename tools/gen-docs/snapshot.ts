// Builds the catalog snapshot: a sorted, canonical dump of everything a consumer could depend on (contract 1.0: the
// ops with their stages and encodings, the document format's stages, cuts, laws and media fields, the mutations).
import { MUTATION_OPS } from '@chromobench/values';
import {
  allLaws, allOps, BLEND_MODES, canonicalJSON, CONTRACT_VERSION, CUTS, DOCUMENT_FORMAT, DOMAINS, ERROR_CODES, MASK_COMPONENT_KINDS, schemas, STAGES, UNITS,
  type ArgSpec, type Schema,
} from '@chromobench/contract';

function argSnapshot(s: ArgSpec): Record<string, unknown> {
  const out: Record<string, unknown> = { type: s.type };
  for (const k of ['unit', 'min', 'max', 'usual', 'values', 'valuesFrom', 'default', 'optional', 'integer', 'perChannel', 'minItems', 'maxItems'] as const) {
    if (s[k] !== undefined) out[k] = s[k];
  }
  if (s.of) out['of'] = Object.fromEntries(Object.entries(s.of).map(([n, f]) => [n, argSnapshot(f)]));
  if (s.redirects) out['redirects'] = Object.fromEntries(Object.entries(s.redirects).map(([k, r]) => [k, r.scale ?? null]));
  return out;
}

/** Field path → spec summary of a schema (custom rules show as 'custom'). */
function fields(schema: Schema, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, r] of Object.entries(schema)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof (r as ArgSpec).type === 'string' && typeof (r as ArgSpec).doc === 'string') out[p] = argSnapshot(r as ArgSpec);
    else if (typeof (r as { check?: unknown }).check === 'function') out[p] = { type: 'custom' };
    else Object.assign(out, fields(r as Schema, p));
  }
  return out;
}

export function buildSnapshot(): Record<string, unknown> {
  const ops = allOps({ includeInternal: true }).map((op) => {
    const o: Record<string, unknown> = {
      area: op.area, owner: op.owner, on: op.on, returns: op.returns, class: op.class, binding: op.binding,
      args: Object.fromEntries(Object.entries(op.args).map(([n, s]) => [n, argSnapshot(s)])),
    };
    for (const k of ['domainIn', 'domainOut', 'domainFromArg', 'channels', 'internal', 'dsl', 'stages', 'encoding', 'term', 'coalesce'] as const) if (op[k] !== undefined) o[k] = op[k];
    if (op.fields) o['fields'] = op.fields.map((f) => ({ name: f.name, type: f.type, ...(f.unit ? { unit: f.unit } : {}), ...(f.optional ? { optional: true } : {}) }));
    return [op.name, o];
  });
  const s = schemas();
  const snap = {
    contractVersion: CONTRACT_VERSION,
    documentFormat: DOCUMENT_FORMAT,
    ops: Object.fromEntries(ops),
    mutationOps: [...MUTATION_OPS],
    stages: Object.fromEntries(Object.values(STAGES).map((st) => [st.name, { kinds: st.kinds, law: st.law, input: st.input, output: st.output, mediumAfter: st.mediumAfter, medium: fields(s.media[st.name]) }])),
    geometry: fields(s.geometry),
    output: fields(s.output),
    cuts: Object.fromEntries(CUTS.map((c) => [c.name, { order: c.order, kinds: c.kinds, domain: c.domain }])),
    laws: Object.fromEntries(allLaws().map((l) => [l.name, { blend: l.blend, groups: l.groups, amount: l.amount, amountRange: l.amountRange, order: l.order, coalesce: l.coalesce }])),
    blendModes: [...BLEND_MODES],
    maskComponents: [...MASK_COMPONENT_KINDS],
    errorCodes: Object.keys(ERROR_CODES).sort(),
    domains: Object.fromEntries(Object.entries(DOMAINS).map(([d, i]) => [d, { channels: i.channels, unit: i.unit, range: i.range }])),
    units: [...UNITS],
  };
  return JSON.parse(canonicalJSON(snap)) as Record<string, unknown>;
}
