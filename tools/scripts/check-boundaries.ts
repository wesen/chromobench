// Import boundaries (guide §5.1), enforced in CI:
// - packages/contract imports nothing from the workspace (only @noble/hashes and relative files);
// - apps/studio and packages/dsl may import @chromobench/contract (and engines through injection),
//   never @chromobench/core, gpu or ingest directly — except one host file per app, which builds the
//   engines and the decoder and hands them to the UI as contract objects (CHB-019 guide §7.1, CHB-023).
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const RULES: { dir: string; forbid: RegExp; why: string; except?: string[] }[] = [
  { dir: 'packages/contract/src', forbid: /^@chromobench\//, why: 'the contract imports nothing from the workspace' },
  { dir: 'packages/contract/src', forbid: /^(?!@noble\/hashes|\.\.?\/)/, why: 'the contract depends only on @noble/hashes' },
  {
    dir: 'apps/studio/src', forbid: /^@chromobench\/(core|gpu|ingest)(\/|$)/, why: 'the UI never calls physics code directly',
    except: ['apps/studio/src/host/engines.ts'],
  },
  { dir: 'packages/dsl/src', forbid: /^@chromobench\/(core|gpu|ingest)(\/|$)/, why: 'the DSL never calls physics code directly' },
];

function* files(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(ts|tsx|js|mjs)$/.test(f)) yield p;
  }
}

const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
let bad = 0;
let checked = 0;
for (const rule of RULES) {
  for (const f of files(join(root, rule.dir))) {
    if (rule.except?.includes(relative(root, f).split('\\').join('/'))) continue;
    checked++;
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(IMPORT)) {
      const spec = m[1] ?? m[2]!;
      if (rule.forbid.test(spec)) {
        console.error(`${relative(root, f)}: imports "${spec}" — ${rule.why}`);
        bad++;
      }
    }
  }
}
if (bad) process.exit(1);
console.log(`import boundaries ok (${checked} file checks)`);
