// Builds the catalog snapshot: a sorted, canonical dump of everything a consumer could depend on.
import {
  allOps, argPath, canonicalJSON, CONTRACT_VERSION, DOMAINS, ERROR_CODES, MUTATION_OPS, RECIPE_FIELDS, RECIPE_VERSION, UNITS,
  type ArgSpec, type OpDef,
} from '@chromobench/contract';

function argSnapshot(op: OpDef, name: string, s: ArgSpec): Record<string, unknown> {
  const out: Record<string, unknown> = { type: s.type };
  for (const k of ['unit', 'min', 'max', 'usual', 'values', 'valuesFrom', 'default', 'optional', 'integer'] as const) {
    if (s[k] !== undefined) out[k] = s[k];
  }
  const p = argPath(op, name, s);
  if (p !== undefined) out['path'] = p;
  if (s.redirects) out['redirects'] = Object.fromEntries(Object.entries(s.redirects).map(([k, r]) => [k, r.scale ?? null]));
  return out;
}

export function buildSnapshot(): Record<string, unknown> {
  const ops = allOps({ includeInternal: true }).map((op) => {
    const o: Record<string, unknown> = {
      area: op.area, owner: op.owner, on: op.on, returns: op.returns, class: op.class, binding: op.binding,
      args: Object.fromEntries(Object.entries(op.args).map(([n, s]) => [n, argSnapshot(op, n, s)])),
    };
    for (const k of ['domainIn', 'domainOut', 'domainFromArg', 'channels', 'recipePath', 'internal', 'dsl'] as const) if (op[k] !== undefined) o[k] = op[k];
    if (op.fields) o['fields'] = op.fields.map((f) => ({ name: f.name, type: f.type, ...(f.unit ? { unit: f.unit } : {}), ...(f.optional ? { optional: true } : {}) }));
    return [op.name, o];
  });
  const snap = {
    contractVersion: CONTRACT_VERSION,
    recipeVersion: RECIPE_VERSION,
    ops: Object.fromEntries(ops),
    mutationOps: [...MUTATION_OPS],
    recipeFields: Object.fromEntries(Object.entries(RECIPE_FIELDS).map(([p, r]) => [p, r.kind === 'spec' ? { kind: 'spec', type: r.spec.type, unit: r.spec.unit ?? null, values: r.spec.values ?? null, min: r.spec.min ?? null, max: r.spec.max ?? null, nullable: r.nullable ?? false } : { kind: r.kind }])),
    errorCodes: Object.keys(ERROR_CODES).sort(),
    domains: Object.fromEntries(Object.entries(DOMAINS).map(([d, i]) => [d, { channels: i.channels, unit: i.unit, range: i.range }])),
    units: [...UNITS],
  };
  return JSON.parse(canonicalJSON(snap)) as Record<string, unknown>;
}
