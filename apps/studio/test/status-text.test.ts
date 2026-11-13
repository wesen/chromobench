// CHB-027 F9: the status line's engine label and decode notes, in the photographer's words.
import { describe, expect, it } from 'vitest';
import { engineSummary, engineTip, notesSummary, notesTip } from '../src/status-text.ts';

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
    ])).toBe('Colour negative (Nikon D850 RAW), 11 MP, film base read on the film edge');
    expect(notesSummary(['TIFF 96×64, 16-bit', 'no rebate found: the base is the brightest 5 % of columns (scan.density default)', 'no veil measured: scan.flare 0', 'dust: 3 specks healed']))
      .toBe('Colour negative (TIFF), 96×64 px, no film edge found, 3 dust specks healed');
  });
  it('a strip whose base came from the gaps between its frames says so, not "film edge found" (CHB-031 ko8e)', () => {
    // the notes of his Epson strip 2025-08-09_raw000.dng (CHB-031 diary 04), its edge found on frame 1
    const notes = [
      'DNG 1608×3638, 16-bit', 'working image 283×640', 'base 0.08 0.37 0.69 D (rebate 98×31 at 15,22, edge)',
      'scan.flare 0.82 0.36 0.15 % from the veil 8.1e-3 3.5e-3 1.5e-3 (frame), removed by the engine', 'W_NO_OPEN_GATE: No open gate in view',
      'strip of 3 frames along y (confidence 1.00)',
      'base 0.04 0.33 0.63 D from the gaps between frames (10105 px): the film edge found lay on a frame (base 0.07 0.37 0.69 D there)',
      'strip working image 678×1534 (≈ 639 px a frame)',
    ];
    expect(notesSummary(notes)).toBe('Colour negative (DNG), 5.8 MP, strip of 3 frames, film base read between the frames');
    expect(notesTip(notes)).toContain('Technical: DNG 1608×3638');
    // no edge found at all, the base from the gaps: not "it may be a photo"
    expect(notesSummary(['TIFF 96×64, 16-bit', 'no rebate found: the base is the brightest 5 % of columns (scan.density default)', 'W_NO_OPEN_GATE: a', 'W_NO_SURROUND: b',
      'strip of 3 frames along y (confidence 0.90)', 'base 0.10 0.40 0.70 D from the gaps between frames (300 px)'])).toBe('Colour negative (TIFF), 96×64 px, strip of 3 frames, film base read between the frames');
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

describe('tooltips: what it means first, the technical text second (CHB-031 F9)', () => {
  it('engineTip', () => {
    const t = engineTip('reference · CPU f64 (no WebGPU: E_EVAL: no GPU adapter) · 512 px');
    expect(t.split('\n')[0]).toBe('The prints are computed on the processor, which is slower: this browser offers no graphics card to compute on. Pictures are previewed smaller.');
    expect(t.split('\n')[1]).toBe('Technical: reference · CPU f64 (no WebGPU: E_EVAL: no GPU adapter) · 512 px');
    expect(engineTip('GPU · NVIDIA RTX · 512 px')).toMatch(/^The prints are computed on the graphics card\.\nTechnical: GPU/);
    expect(engineTip('mock engine (no physics)')).toMatch(/^A preview without the film and paper model\./);
  });
  it('notesTip', () => {
    const notes = ['photo: camera RAW (Nikon D750) via LibRaw, photo mode, 6032×4032, camera matrix from LibRaw', 'working image 512×342'];
    const t = notesTip(notes);
    expect(t.split('\n')[0]).toBe('Nikon D750 photo, 24 MP. Developed from the camera RAW with its own colour.');
    expect(t.split('\n')[1]).toBe(`Technical: ${notes.join(' · ')}`);
    expect(notesTip([])).toBe('');
  });
});
