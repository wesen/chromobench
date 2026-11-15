// Every js block of every topic page, and every OpDef.examples entry, runs against engine-mock
// (port of goja-cv pkg/cvsession/docs_test.go). Info strings: `js` (no error, no warnings),
// `js warns=CODE`, `js error=CODE`, `js shows=N` (N images shown), `js fragment` (skipped). A floor on the block
// count keeps a broken extractor from passing silently.
import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { allOps } from '@chromobench/contract';
import { genInstructions } from '../src/docs/generate.ts';
import { TOPICS } from '../src/docs/topics.generated.ts';
import { setup } from './helpers.ts';

const FLOOR = 30;
let executed = 0;

interface Block { info: string; code: string; line: number }

export function blocks(md: string): Block[] {
  const out: Block[] = [];
  const re = /^```(js[^\n]*)\n([\s\S]*?)^```/gm;
  for (const m of md.matchAll(re)) out.push({ info: m[1]!.trim(), code: m[2]!.replace(/\n$/, ''), line: md.slice(0, m.index).split('\n').length });
  return out;
}

function tags(info: string): Record<string, string> {
  const t: Record<string, string> = {};
  for (const p of info.split(/\s+/).slice(1)) {
    const [k, v] = p.split('=');
    t[k!] = v ?? 'true';
  }
  return t;
}

const dir = new URL('../src/docs/topics/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();

describe('topic pages', () => {
  it('the bundled topics match the Markdown files (run pnpm gen)', () => {
    expect(TOPICS.map((t) => t.id)).toEqual(files.map((f) => f.replace(/\.md$/, '')));
    for (const t of TOPICS) expect(t.text).toBe(readFileSync(new URL(`${t.id}.md`, dir), 'utf8'));
  });

  for (const f of files) {
    it(`${f}: every js block runs as tagged`, async () => {
      const s = await setup();
      for (const b of blocks(readFileSync(new URL(f, dir), 'utf8'))) {
        const t = tags(b.info);
        if (t['fragment']) continue;
        const r = await s.run(b.code);
        const label = `${f}:${b.line} (${b.info})\n${r.yaml}`;
        executed++;
        if (t['error']) {
          expect(r.error?.code, label).toBe(t['error']);
        } else {
          expect(r.error, label).toBeUndefined();
          const codes = r.warnings.map((w) => w.code);
          if (t['warns']) expect(codes, label).toContain(t['warns']);
          else expect(codes, label).toEqual([]);
        }
        if (t['shows']) expect(r.looks.length, label).toBe(Number(t['shows']));
      }
      s.session.dispose();
    });
  }
});

describe('OpDef.examples', () => {
  // the catalogue's own DSL snippets (contract 1.0 ships none; an op that adds one is run here)
  it('every example runs without an error', async () => {
    const examples = allOps().flatMap((o) => (o.examples ?? []).map((code) => ({ op: o.name, code })));
    const s = await setup();
    for (const ex of examples) {
      const r = await s.run(ex.code);
      expect(r.error, `${ex.op}: ${ex.code}\n${r.yaml}`).toBeUndefined();
      executed++;
    }
    s.session.dispose();
  });
});

describe('instructions', () => {
  it('stay under 4000 characters', () => {
    expect(genInstructions().length).toBeLessThan(4000);
  });
});

afterAll(() => {
  // the floor: a broken block extractor must not pass silently
  if (executed < FLOOR) throw new Error(`only ${executed} doc blocks ran; the floor is ${FLOOR}`);
});
