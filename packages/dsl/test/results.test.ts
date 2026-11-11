// Stage 3 (guide §5.10): number formatting, compact tables, the cap, looks and the context block.
import { describe, expect, it } from 'vitest';
import { docLine, fmtNum, params, renderYaml } from '../src/index.ts';
import { setup } from './helpers.ts';

describe('values', () => {
  it('numbers: five significant digits, trailing zeros dropped, integers exact', () => {
    expect(fmtNum(0.946913)).toBe('0.94691');
    expect(fmtNum(1.5)).toBe('1.5');
    expect(fmtNum(-0)).toBe('0');
    expect(fmtNum(3000)).toBe('3000');
    expect(fmtNum(0.30102999566)).toBe('0.30103');
    expect(fmtNum(12.600000001)).toBe('12.6');
  });

  it('compact tables: header + rows; a cut table pages', () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ cell: i, D: [i / 10, i / 20, i / 30], ok: i % 2 === 0 }));
    const lines = renderYaml({ rows }, { tableChars: 600 });
    expect(lines[0]).toBe('rows: |');
    expect(lines[1]).toMatch(/^ {2}cell {2}D +ok$/);
    expect(lines.at(-1)).toMatch(/^ {2}… rows 1–\d+ of 200 shown\. Next: rows\.slice\(\d+, \d+\)$/);
    const few = renderYaml({ rows }, { tableChars: 0 });
    expect(few.length).toBe(2 + 5 + 1); // key line, header, the 5-row floor, the paging note
  });

  it('function signatures and doc lines (port of describe.go)', () => {
    expect(params('async (h, at = [1, 2]) => { // doc\n return 1 }')).toBe('h, at = [1, 2]');
    expect(docLine('async (h, at = [1, 2]) => { // print densities\n return 1 }')).toBe('print densities');
    expect(params('function f(a, { b, c }) {\n /* block\n doc */ }')).toBe('a, { b, c }');
    expect(docLine('function f(a) {\n /* block\n doc */ }')).toBe('block doc');
    expect(params('x => x + 1')).toBe('x');
    expect(docLine('x => x + 1')).toBe('');
  });
});

describe('the cap', () => {
  it('a long value is cut with a note and a CUT warning; error, warnings and context are never cut', async () => {
    const s = await setup();
    const r = await s.run('mem.keep = 1\nreturn Array.from({ length: 3000 }, (_, i) => "line " + i)');
    expect(r.yaml.length).toBeLessThanOrEqual(9000);
    expect(r.yaml).toMatch(/# CUT: \d+ of \d+ characters shown; return less, or page the array/);
    expect(r.warnings.map((w) => w.code)).toContain('CUT');
    expect(r.yaml).toMatch(/context:\n {2}frame: /);
    expect(r.yaml).toMatch(/mem: '?keep \(number\)'?/);
    s.session.dispose();
  });
});

describe('looks', () => {
  it('at most four per eval in creation order, duplicates once, a LOOKS warning names the rest', async () => {
    const s = await setup();
    const r = await s.run(`const p = frame.print()
p.look('a')
p.look('a')
frame.print({ time_s: 12 }).look('b')
frame.print({ time_s: 14 }).look('c')
frame.negative().look('d')
frame.scan().look('e')
return 1`);
    expect(r.looks.map((l) => l.n)).toEqual([1, 2, 3, 4]);
    expect(r.looks.map((l) => l.caption.split(' — ')[0])).toEqual(['a', 'b', 'c', 'd']);
    const w = r.warnings.find((x) => x.code === 'LOOKS')!;
    expect(w.message).toMatch(/Dropped: look 5 \(line 7\)/);
    // a film-dyes look renders as greyscale; PNG signature
    expect(Array.from(r.looks[3]!.image.bytes.slice(0, 4))).toEqual([137, 80, 78, 71]);
    s.session.dispose();
  });

  it('a look with box and at carries the region stats and the densitometer reading', async () => {
    const s = await setup();
    const r = await s.run("frame.print().look({ label: 'patch', box: [40, 24, 16, 16], at: [48, 32] })\nreturn 1");
    const l = r.looks[0]!;
    expect(l.region).toEqual({ x: 40, y: 24, w: 16, h: 16 });
    expect(l.image.width).toBe(16);
    expect(l.numbers).toHaveProperty('at');
    expect(r.yaml).toMatch(/at:\n {8}at:\n {10}x: 48/);
    s.session.dispose();
  });

  it('cb.compare: one side-by-side look whose halves carry their own numbers', async () => {
    const s = await setup();
    const r = await s.run("cb.compare([frame.print(), frame.print({ time_s: 20 })], 'time 10 vs 20')\nreturn 1");
    expect(r.looks).toHaveLength(1);
    expect(r.looks[0]!.numbers).toHaveProperty('left');
    expect(r.looks[0]!.numbers).toHaveProperty('right');
    s.session.dispose();
  });

  it('a looked-at image is downscaled to 750 px on the long side by default', async () => {
    const s = await setup();
    const r = await s.run("frame.print().look({ label: 'small', size: 64 })\nreturn 1");
    expect(r.looks[0]!.image.width).toBe(64);
    expect(r.looks[0]!.scale).toBeCloseTo(64 / 96, 6);
    s.session.dispose();
  });
});

describe('context block', () => {
  it('lists mem keys by kind, without running getters, and quotes untrusted frame names', async () => {
    const s = await setup();
    const r = await s.run("Object.defineProperty(mem, 'g', { get() { throw new Error('ran') }, enumerable: true })\nmem.h = frame.print()\nmem.a = [1, 2]\nreturn 1");
    expect(r.error).toBeUndefined();
    expect(r.context.mem).toEqual([expect.stringMatching(/^g \(accessor\)$/), expect.stringMatching(/^h \(\[print-xyz #[0-9a-f]{4} view\.adapt\]\)$/), 'a (array of 2)']);
    expect(r.yaml).toMatch(/ {2}frame: 'frame_m1 \(M1 test negative\)/);
    s.session.dispose();
  });
});
