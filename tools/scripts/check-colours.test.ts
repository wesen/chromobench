// CHB-025: the literal-colour check finds colours in CSS and in TS strings, and skips the theme block and comments.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { literalColours } from './check-colours.ts';

describe('check-colours', () => {
  it('finds literal colours in CSS, outside comments and the theme block', () => {
    const css = '/* theme:begin */\n:root { --panel: #ececec; }\n/* theme:end */\n/* #fff in a comment */\n.a { color: var(--text); }\n.b { background: #1d1d1d; border-color: rgba(0, 0, 0, .2); }\n';
    expect(literalColours('x.css', css)).toEqual([
      { line: 6, text: '#1d1d1d' },
      { line: 6, text: 'rgba(' },
    ]);
  });
  it('in TS and JS, only string literals count', () => {
    const ts = "const rgb = (x: number[]) => x;\nrgb([1, 2, 3]);\n// '#fff' in a comment\nel.style.color = '#e77';\nconst id = '#file';\nconst s = `rgba(0,0,0,${a})`;\n";
    expect(literalColours('x.ts', ts)).toEqual([
      { line: 4, text: '#e77' },
      { line: 6, text: 'rgba(' },
    ]);
  });
  it('the repository passes', () => {
    const script = fileURLToPath(new URL('./check-colours.ts', import.meta.url));
    expect(execFileSync(process.execPath, [script], { encoding: 'utf8' })).toContain('no literal colours outside the theme files');
  });
});
