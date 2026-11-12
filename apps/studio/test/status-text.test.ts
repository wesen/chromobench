// CHB-027 F9: the status line's engine label and decode notes, in the photographer's words.
import { describe, expect, it } from 'vitest';
import { engineSummary, notesSummary } from '../src/status-text.ts';

describe('engineSummary', () => {
  it('says fast or compatibility mode; the technical label goes to the tooltip', () => {
    expect(engineSummary('GPU · NVIDIA RTX · 512 px')).toBe('Fast (graphics card)');
    expect(engineSummary('GPU · SwiftShader (software) · 512 px')).toBe('Graphics card emulated in software: slower');
    expect(engineSummary('reference · CPU f64 (no WebGPU: E_EVAL: no GPU adapter) · 512 px')).toBe('Compatibility mode: slower (no WebGPU)');
    expect(engineSummary('mock engine (no physics)')).toBe('Preview only (no film physics)');
  });
});

describe('notesSummary', () => {
  it('a camera RAW opened as a photo', () => {
    expect(notesSummary(['photo: camera RAW (Nikon D750) via LibRaw, photo mode, 6032×4032, camera matrix from LibRaw', 'working image 512×342'])).toBe('Nikon D750 photo, 24 MP');
    expect(notesSummary(['photo: TIFF 3000×2000, 16-bit, taken as linear sRGB scene light'])).toBe('TIFF photo, 6 MP');
  });
  it('a negative scan, with and without a film edge', () => {
    expect(notesSummary([
      'camera RAW (Nikon D850) via LibRaw, scan mode, CFA-binned to 4128×2752', 'working image 512×341',
      'base 0.12 0.41 0.71 D (rebate 18×150 at 196,22, edge)', 'scan.flare 0.13 0.06 0.04 % from the veil 1.0e-3 (holder), removed by the engine', 'W_NO_OPEN_GATE: no open gate',
    ])).toBe('Colour negative (Nikon D850 RAW), 11 MP, film edge found');
    expect(notesSummary(['TIFF 96×64, 16-bit', 'no rebate found: the base is the brightest 5 % of columns (scan.density default)', 'no veil measured: scan.flare 0', 'dust: 3 specks healed']))
      .toBe('Colour negative (TIFF), 96×64 px, no film edge found, 3 dust specks healed');
  });
  it('a photo opened as a negative says so', () => {
    const s = notesSummary([
      'camera RAW (Nikon D750) via LibRaw, scan mode, CFA-binned to 3016×2016', 'working image 512×342',
      'no rebate found: the base is the brightest 5 % of columns (scan.density default)', 'no veil measured: scan.flare 0',
      'W_NO_OPEN_GATE: no open gate', 'W_NO_SURROUND: no surround', 'W_REBATE_BLANK: blank',
    ]);
    expect(s).toBe('Colour negative (Nikon D750 RAW), 6.1 MP, no film edge found, it may be a photo, not a negative');
  });
  it('no notes, no summary', () => expect(notesSummary([])).toBe(''));
});
