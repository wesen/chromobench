// Classifies differences between catalog.snapshot.json and a baseline. Breaking changes need a
// migration / redirect and a change note (guide §7). The baseline is, in order: `--base <file>`;
// the snapshot on `main` (via git) when its version differs from the current one; the newest
// released snapshot in packages/contract/baselines/ older than the current version.
//   node tools/gen-docs/contract-check.ts [--base <file>]
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const cur = JSON.parse(readFileSync(join(root, 'packages/contract/catalog.snapshot.json'), 'utf8'));
const bi = process.argv.indexOf('--base');
const semver = (v: string): number[] => v.split('.').map(Number);
const older = (a: string, b: string): boolean => {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < 3; i++) if (x[i]! !== y[i]!) return x[i]! < y[i]!;
  return false;
};
function released(): { snap: any; from: string } | null {
  const dir = join(root, 'packages/contract/baselines');
  if (!existsSync(dir)) return null;
  const all = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ f, snap: JSON.parse(readFileSync(join(dir, f), 'utf8')) }));
  const prior = all.filter((b) => older(b.snap.contractVersion, cur.contractVersion)).sort((a, b) => (older(a.snap.contractVersion, b.snap.contractVersion) ? 1 : -1));
  return prior[0] ? { snap: prior[0].snap, from: `packages/contract/baselines/${prior[0].f}` } : null;
}
let base: any;
let from = '';
if (bi > 0) {
  base = JSON.parse(readFileSync(process.argv[bi + 1]!, 'utf8'));
  from = process.argv[bi + 1]!;
} else {
  try {
    base = JSON.parse(execFileSync('git', ['show', 'main:packages/contract/catalog.snapshot.json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    from = 'main';
    if (base.contractVersion === cur.contractVersion) base = undefined;
  } catch {
    base = undefined;
  }
  if (!base) {
    const r = released();
    if (r) ({ snap: base, from } = r);
  }
}
if (!base) {
  console.log('contract:check: no baseline snapshot (first version); everything is additive.');
  process.exit(0);
}
console.log(`contract:check: ${base.contractVersion} (${from}) → ${cur.contractVersion}`);

type Change = { cls: 'breaking' | 'minor'; what: string };
const out: Change[] = [];
const J = (v: unknown): string => JSON.stringify(v);
for (const [name, op] of Object.entries<any>(base.ops)) {
  const now = cur.ops[name];
  if (!now) { out.push({ cls: 'breaking', what: `op ${name} removed` }); continue; }
  for (const k of ['on', 'returns', 'domainOut', 'class', 'binding']) if (J(op[k]) !== J(now[k])) out.push({ cls: 'breaking', what: `${name}.${k}: ${J(op[k])} → ${J(now[k])}` });
  const dinOld = [op.domainIn ?? []].flat();
  const dinNew = [now.domainIn ?? []].flat();
  if (dinOld.some((d: string) => !dinNew.includes(d) && !dinNew.includes('any'))) out.push({ cls: 'breaking', what: `${name}.domainIn narrowed` });
  else if (J(dinOld) !== J(dinNew)) out.push({ cls: 'minor', what: `${name}.domainIn widened` });
  for (const [a, s] of Object.entries<any>(op.args)) {
    const n = now.args[a];
    if (!n) { out.push({ cls: 'breaking', what: `${name}.${a} removed or renamed` }); continue; }
    for (const k of ['type', 'unit', 'path']) if (J(s[k]) !== J(n[k])) out.push({ cls: 'breaking', what: `${name}.${a}.${k}: ${J(s[k])} → ${J(n[k])}` });
    if ((n.min ?? -Infinity) > (s.min ?? -Infinity) || (n.max ?? Infinity) < (s.max ?? Infinity)) out.push({ cls: 'breaking', what: `${name}.${a} range narrowed` });
    else if (J([s.min, s.max]) !== J([n.min, n.max])) out.push({ cls: 'minor', what: `${name}.${a} range widened` });
    if (J(s.default) !== J(n.default)) out.push({ cls: n.path ? 'breaking' : 'minor', what: `${name}.${a} default ${J(s.default)} → ${J(n.default)}${n.path ? ' (recipe-backed: needs a migration)' : ''}` });
    if ((s.values ?? []).some((v: string) => !(n.values ?? []).includes(v))) out.push({ cls: 'breaking', what: `${name}.${a} enum value removed` });
    else if (J(s.values) !== J(n.values)) out.push({ cls: 'minor', what: `${name}.${a} enum value added (compile-visible)` });
  }
  for (const a of Object.keys(now.args)) if (!op.args[a]) out.push({ cls: now.args[a].default !== undefined || now.args[a].optional ? 'minor' : 'breaking', what: `${name}.${a} added` });
}
for (const name of Object.keys(cur.ops)) if (!base.ops[name]) out.push({ cls: 'minor', what: `op ${name} added` });
for (const p of Object.keys(base.recipeFields)) if (!cur.recipeFields[p]) out.push({ cls: 'breaking', what: `recipe path ${p} removed` });
for (const p of Object.keys(cur.recipeFields)) if (!base.recipeFields[p]) out.push({ cls: 'minor', what: `recipe path ${p} added` });
for (const p of Object.keys(base.recipeFields)) {
  const [o, nRule] = [base.recipeFields[p], cur.recipeFields[p]];
  if (!nRule || J(o) === J(nRule)) continue;
  // an op-owned path is checked by its owning argument: compare against that ArgSpec
  const owner = nRule.kind === 'op' ? Object.values<any>(cur.ops).flatMap((op) => Object.values<any>(op.args)).find((a) => a.path === p) : undefined;
  const n = owner ? { kind: 'op', type: owner.type, unit: owner.unit ?? null, values: owner.values ?? null, min: owner.min ?? null, max: owner.max ?? null } : nRule;
  if (o.kind === 'spec' && n.kind === 'op' && J([o.type, o.unit, o.values, o.min, o.max]) === J([n.type, n.unit, n.values, n.min, n.max])) {
    out.push({ cls: 'minor', what: `recipe path ${p}: now op-owned (${J(owner)}), same values` });
    continue;
  }
  const removed = (o.values ?? []).some((v: string) => !(n.values ?? []).includes(v));
  const narrowed = (n.min ?? -Infinity) > (o.min ?? -Infinity) || (n.max ?? Infinity) < (o.max ?? Infinity);
  out.push({ cls: removed || narrowed || (o.type && n.type && o.type !== n.type) ? 'breaking' : 'minor', what: `recipe path ${p}: ${J(o)} → ${J(n)}` });
}
for (const c of base.errorCodes) if (!cur.errorCodes.includes(c)) out.push({ cls: 'breaking', what: `error code ${c} removed` });
for (const c of cur.errorCodes) if (!base.errorCodes.includes(c)) out.push({ cls: 'minor', what: `error code ${c} added` });
for (const m of base.mutationOps) if (!cur.mutationOps.includes(m)) out.push({ cls: 'breaking', what: `mutation op ${m} removed` });

for (const c of out) console.log(`${c.cls.padEnd(8)} ${c.what}`);
const breaking = out.filter((c) => c.cls === 'breaking').length;
console.log(`contract:check: ${out.length} change(s), ${breaking} breaking`);
if (breaking && cur.contractVersion.split('.')[0] === base.contractVersion.split('.')[0] && !cur.contractVersion.startsWith('0.')) {
  console.error('breaking changes need a major CONTRACT_VERSION bump, a migration and a change note');
  process.exit(1);
}
