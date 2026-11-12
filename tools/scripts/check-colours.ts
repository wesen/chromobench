// CHB-025: no literal colours outside the theme files. The studio's look comes from the shell's tokens (--panel,
// --text, --accent, --pending, …), defined in packages/shell/src/themes/*.ts and, as the pre-theme defaults, between
// the /* theme:begin */ and /* theme:end */ markers in shell.css. A colour written anywhere else in the UI packages
// (CSS, inline styles in TS/JS strings, HTML) does not follow View ▸ Theme or the interface grays, so it fails here.
// The exceptions are counted per file below — overlays drawn on the picture look the same in every theme — so a new
// literal colour in one of those files fails too. Run by `pnpm lint`.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const DIRS = ['packages/shell/src', 'packages/shell/demo', 'packages/studio-kit/src', 'packages/studio-kit/kits', 'packages/studio-kit/variants', 'packages/studio-kit/demo', 'apps/studio/src', 'apps/studio/index.html'];
/** theme files: literal colours are what they are for */
const THEME = [/^packages\/shell\/src\/themes\//];
/** files allowed a fixed number of literal colours, and why */
const ALLOW: Record<string, { max: number; why: string }> = {
  'packages/shell/src/dom/shell.css': { max: 33, why: 'overlays on the picture (labels, tags, split knob, busy spinner), the colour wheel, the histogram clipping marks, the pick/reject flash' },
  'packages/shell/src/dom/forms/basic.ts': { max: 13, why: "the temperature, tint and hue slider tracks (the colours they set, in every theme)" },
  'packages/shell/src/dom/forms/plane.ts': { max: 7, why: 'curve and histogram channel colours, the colour wheel puck (data colours)' },
  'packages/shell/src/dom/presenter-2d.ts': { max: 2, why: 'the 2D presenter paints the stage colour and the split line on the picture' },
  'packages/studio-kit/src/dom/studio-kit.css': { max: 3, why: "the test strip's bands drawn on the print" },
  'packages/studio-kit/kits/finish/src/kit.ts': { max: 13, why: 'crop frame, thirds, handles and spot circles drawn on the picture (SVG presentation attributes)' },
  'apps/studio/index.html': { max: 1, why: 'meta theme-color is a literal by definition' },
};

const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g;
/** in TS/JS only string literals count (a function named rgb() is not a colour) */
const STRING = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;

function* files(p: string): Generator<string> {
  if (!existsSync(p)) return;
  if (!statSync(p).isDirectory()) {
    yield p;
    return;
  }
  for (const f of readdirSync(p)) {
    if (f === 'node_modules' || f === 'test') continue;
    const q = join(p, f);
    if (statSync(q).isDirectory()) yield* files(q);
    else if (/\.(css|ts|js|mjs|html)$/.test(f) && !/\.d\.ts$/.test(f)) yield q;
  }
}

/** the literal colours in a file's text, with their line numbers */
export function literalColours(path: string, src: string): { line: number; text: string }[] {
  let text = src.replace(/\/\* theme:begin \*\/[\s\S]*?\/\* theme:end \*\//g, m => m.replace(/[^\n]/g, ' '));
  const out: { line: number; text: string }[] = [];
  const lineOf = (i: number): number => text.slice(0, i).split('\n').length;
  if (/\.(css|html)$/.test(path)) {
    text = text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));
    for (const m of text.matchAll(COLOUR)) out.push({ line: lineOf(m.index), text: m[0] });
  } else {
    text = text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
    for (const s of text.matchAll(STRING)) for (const m of s[2]!.matchAll(COLOUR)) out.push({ line: lineOf(s.index + 1 + m.index), text: m[0] });
  }
  return out;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  let bad = 0;
  let checked = 0;
  for (const d of DIRS)
    for (const f of files(join(root, d))) {
      const rel = relative(root, f).split('\\').join('/');
      if (THEME.some(r => r.test(rel))) continue;
      checked++;
      const found = literalColours(rel, readFileSync(f, 'utf8'));
      const allow = ALLOW[rel]?.max ?? 0;
      if (found.length > allow) {
        bad++;
        console.error(`${rel}: ${found.length} literal colour${found.length === 1 ? '' : 's'} (allowed ${allow}) — use the shell's tokens (var(--panel), var(--accent), var(--pending), …) or add the colour to a theme (packages/shell/src/themes/)`);
        for (const x of found.slice(0, 12)) console.error(`  ${rel}:${x.line}  ${x.text}`);
      } else if (found.length < allow) console.warn(`${rel}: ${found.length} literal colours, ${allow} allowed — lower the allowance in tools/scripts/check-colours.ts`);
    }
  if (bad) {
    console.error(`check-colours: ${bad} file(s) with literal colours outside the theme files`);
    process.exit(1);
  }
  console.log(`check-colours: ${checked} files, no literal colours outside the theme files and the counted overlays`);
}
