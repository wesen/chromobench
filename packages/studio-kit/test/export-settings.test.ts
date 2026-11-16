// CHB-047 OUT-1, OUT-5: his export settings as the Output panel and the agent's output.set see them: defaults, checks
// in his words, the summary line, the contract's size, and the file names of an export.
import { describe, expect, it } from 'vitest';
import { EXPORT_DEFAULTS, exportFileNames, exportPrefsOf, exportPrefsProblem, exportSizeOf, exportSummary } from '../src/model/export.ts';

describe('export settings (CHB-047)', () => {
  it('defaults: JPEG, sRGB, original size, quality 90, the file name; prefs fill only what is missing', () => {
    expect(exportPrefsOf(null)).toEqual(EXPORT_DEFAULTS);
    expect(exportPrefsOf({ prefs: { export: { format: 'tiff16' } } })).toEqual({ ...EXPORT_DEFAULTS, format: 'tiff16' });
    expect(exportSizeOf({ size: 'long', longPx: 2048, pct: 50 })).toEqual({ by: 'long', px: 2048 });
    expect(exportSizeOf({ size: 'percent', longPx: 2048, pct: 25 })).toEqual({ by: 'percent', pct: 25 });
    expect(exportSizeOf({ size: 'original', longPx: 2048, pct: 50 })).toEqual({ by: 'original' });
  });

  it('refuses values out of range in his words', () => {
    expect(exportPrefsProblem({ quality: 0 })).toMatch(/JPEG quality/);
    expect(exportPrefsProblem({ quality: 90.5 })).toMatch(/whole number/);
    expect(exportPrefsProblem({ longPx: 8 })).toMatch(/Long edge/);
    expect(exportPrefsProblem({ pct: 120 })).toMatch(/Percentage/);
    expect(exportPrefsProblem({ format: 'gif' as never })).toMatch(/Format/);
    expect(exportPrefsProblem({ space: 'rec2020' })).toMatch(/Colour space/);
    expect(exportPrefsProblem({ name: ' ' })).toMatch(/file name/);
    expect(exportPrefsProblem({ printer: { profile: 'x', intent: 'relative', bpc: true } })).toMatch(/SHA-256/);
    expect(exportPrefsProblem({ printer: { profile: 'a'.repeat(64), intent: 'saturation' as never, bpc: true } })).toMatch(/intent/);
    expect(exportPrefsProblem({ printer: null, format: 'png16', quality: 100, longPx: 6000, pct: 1 })).toBeNull();
  });

  it('the summary line says what the file will be', () => {
    expect(exportSummary({ ...EXPORT_DEFAULTS, size: 'long', longPx: 2048 })).toBe('JPEG · sRGB · long edge 2048 px · quality 90');
    expect(exportSummary({ ...EXPORT_DEFAULTS, format: 'tiff16', space: 'prophoto', size: 'percent', pct: 50 })).toBe('TIFF 16-bit · ProPhoto RGB · 50 % of the original');
    const printer = { profile: 'b'.repeat(64), intent: 'perceptual' as const, bpc: true };
    expect(exportSummary({ ...EXPORT_DEFAULTS, format: 'tiff16', printer }, [{ sha256: 'b'.repeat(64), description: 'Baryta' }])).toBe('TIFF 16-bit · printer Baryta (perceptual, black point compensation) · original size');
  });

  it('file names: the pattern, the extension, a strip frame\'s number, characters a file system refuses, no two alike', () => {
    const day = new Date(2026, 10, 15);
    expect(exportFileNames([{ name: 'roll 3.dng' }], { name: '{name}', format: 'jpeg' }, day)).toEqual(['roll 3.jpg']);
    expect(exportFileNames([{ name: 'a.tif' }, { name: 'b.tif' }], { name: '{name}-{n} {date}', format: 'tiff16' }, day)).toEqual(['a-1 2026-11-15.tif', 'b-2 2026-11-15.tif']);
    expect(exportFileNames([{ name: 'strip.dng', strip: { index: 2 } }], { name: '{name}', format: 'png8' }, day)).toEqual(['strip-2.png']);
    expect(exportFileNames([{ name: 'x.tif' }], { name: 'a/b:c?', format: 'jpeg' }, day)).toEqual(['a-b-c-.jpg']);
    expect(exportFileNames([{ name: 'x.tif' }, { name: 'x.dng' }, { name: 'X.png' }], { name: '{name}', format: 'jpeg' }, day)).toEqual(['x.jpg', 'x (2).jpg', 'X (3).jpg']);
  });
});
