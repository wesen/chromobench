// Import boundaries (guide §5.1), enforced in CI:
// - packages/values/src imports nothing (the builder core is a leaf: no dependencies, only its own files);
// - packages/contract imports from the workspace only @chromobench/values (besides @noble/hashes and its own files);
// - apps/studio and packages/dsl may import @chromobench/contract (and engines through injection),
//   never @chromobench/core, gpu or ingest directly — except one host file per app, which builds the
//   engines and the decoder and hands them to the UI as contract objects (CHB-019 guide §7.1, CHB-023);
// - packages/shell/src imports only its own files and @chromobench/values (no other @chromobench/*, no
//   dependencies), and its headless half (core, ir, build, app, themes, testing, index.ts) never imports the DOM
//   half (dom/).
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const RULES: { dir: string; forbid: RegExp; why: string; skip?: RegExp; except?: string[] }[] = [
  { dir: 'packages/values/src', forbid: /^(?!\.\.?\/)/, why: 'the builder core imports nothing (a leaf package, no dependencies)' },
  { dir: 'packages/contract/src', forbid: /^@chromobench\/(?!values$)/, why: 'the contract imports nothing from the workspace but the builder core (@chromobench/values)' },
  { dir: 'packages/contract/src', forbid: /^(?!@noble\/hashes|@chromobench\/values$|\.\.?\/)/, why: 'the contract depends only on @noble/hashes and @chromobench/values' },
  {
    dir: 'apps/studio/src', forbid: /^@chromobench\/(core|gpu|ingest)(\/|$)/, why: 'the UI never calls physics code directly',
    except: ['apps/studio/src/host/engines.ts', 'apps/studio/src/host/decode.ts', 'apps/studio/src/host/engine-serve.ts'],
  },
  { dir: 'packages/dsl/src', forbid: /^@chromobench\/(core|gpu|ingest)(\/|$)/, why: 'the DSL never calls physics code directly' },
  // CHB-008: the agent reaches physics only through the injected Engine, and the UI kits never import it
  { dir: 'packages/agent/src', forbid: /^@chromobench\/(core|gpu|ingest|studio-kit|shell)(\/|$)/, why: 'the agent reaches the engine by injection and knows no UI' },
  { dir: 'packages/shell/src', forbid: /^(?!\.\.?\/|@chromobench\/values$)/, why: 'the shell imports only its own files and the builder core (@chromobench/values)' },
  ...['core', 'ir', 'build', 'app', 'themes', 'testing'].map(d => ({ dir: `packages/shell/src/${d}`, forbid: /(^|\/)dom\//, why: 'the headless half of the shell never imports the DOM half' })),
  { dir: 'packages/shell/src', forbid: /^\.\/dom\//, why: 'the shell entry point is headless; the DOM half is @chromobench/shell/dom' },
  // CHB-019 studio-kit: engines arrive by injection; only the shell, the contract and the builder core are imported; the headless
  // half never imports the DOM half
  { dir: 'packages/studio-kit/src', forbid: /^@chromobench\/(?!contract$|values$|shell(\/dom)?$)/, why: 'studio-kit imports only the contract, the builder core and the shell (engines are injected)' },
  { dir: 'packages/studio-kit/src', skip: /\/src\/dom\//, forbid: /^(@chromobench\/shell\/dom|\.\.?\/dom\/)/, why: 'the headless half of studio-kit never imports the DOM half (@chromobench/studio-kit/dom)' },
  // CHB-020 kits on cb.core: the same rule (physics is injected as services.rollPhysics); headless files never import dom.ts
  { dir: 'packages/studio-kit/kits', forbid: /^@chromobench\/(?!contract$|values$|shell(\/dom)?$)/, why: 'studio-kit kits import only the contract, the builder core and the shell (physics is injected)' },
  { dir: 'packages/studio-kit/kits', skip: /\/dom\.ts$/, forbid: /^(@chromobench\/shell\/dom|\.\.?\/.*dom(\.ts|\/))/, why: 'the headless half of a kit never imports the DOM half' },
  // a layout receives ck and cb and imports nothing: no layout imports another (CHB-029 item 4); the registry
  // (index.js) imports the layouts lazily
  { dir: 'packages/studio-kit/variants', skip: /(\.d\.ts|\/index\.js)$/, forbid: /./, why: 'a layout receives ck and cb and imports nothing (no layout imports another)' },
  { dir: 'packages/studio-kit/variants', skip: /\.d\.ts$/, forbid: /^(?!\.\/[a-z-]+\.js$)/, why: 'the layout registry imports only the layouts beside it' },
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
    if (rule.skip?.test(f)) continue;
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
