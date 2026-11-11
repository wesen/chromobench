// CHB-007 targets of gen-docs: the DSL reference, instructions, .d.ts, and the topic pages
// bundled into a module so cb.docs works in the browser without file access.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { genDts, genInstructions, genReference, genTopicsModule } from '../../packages/dsl/src/docs/generate.ts';

export const INSTRUCTIONS_MAX_CHARS = 4000;

export function dslFiles(root: string): [string, string][] {
  const dir = join(root, 'packages/dsl/src/docs/topics');
  const topics = readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => ({ id: f.replace(/\.md$/, ''), text: readFileSync(join(dir, f), 'utf8') }));
  const instructions = genInstructions();
  if (instructions.length >= INSTRUCTIONS_MAX_CHARS) throw new Error(`DSL instructions are ${instructions.length} characters; the limit is ${INSTRUCTIONS_MAX_CHARS}`);
  return [
    ['packages/dsl/src/docs/topics.generated.ts', genTopicsModule(topics)],
    ['packages/dsl/generated/reference.md', genReference()],
    ['packages/dsl/generated/instructions.md', instructions],
    ['packages/dsl/generated/chromobench-dsl.d.ts', genDts()],
  ];
}
