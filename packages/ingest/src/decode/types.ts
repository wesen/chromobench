// Decoder-side types (guide §5.3). A decoder returns stored samples and facts about them; it never
// interprets them. Interpretation (levels, transfer) happens once, per sample, in linear.ts (DR-1).
import type { CameraColour, Diagnostic, Encoding, SourceInfo } from '@chromobench/contract';

export type { Encoding };
export type EncodingEvidence = SourceInfo['encoding']['evidence'];
export type Plane = Uint8Array | Uint16Array | Uint32Array | Float32Array;

export interface Levels {
  /** Per channel, in native sample units. */
  black: number[];
  /** Saturation per channel, in native sample units. */
  white: number[];
  from: 'file' | 'libraw' | 'default' | 'declared';
}

/** DNG colour tags, read verbatim (DNG 1.6 chapter 6). Matrices are row-major. */
export interface DngColour {
  colorMatrix1?: number[];
  colorMatrix2?: number[];
  cameraCalibration1?: number[];
  cameraCalibration2?: number[];
  forwardMatrix1?: number[];
  forwardMatrix2?: number[];
  analogBalance?: number[];
  asShotNeutral?: number[];
  asShotWhiteXY?: [number, number];
  baselineExposure?: number;
  calibrationIlluminant1?: number;
  calibrationIlluminant2?: number;
}

export interface SourceMeta {
  format: 'tiff' | 'dng' | 'png' | 'raw' | 'image';
  orientationTag?: number;
  camera?: CameraColour;
  cfa?: 'bayer' | 'xtrans' | 'none';
  dng?: DngColour;
  /** DNG DefaultCropOrigin/Size, in pixels of the decoded (active-area) image. */
  defaultCrop?: { x: number; y: number; w: number; h: number };
  /** DNG LinearizationTable, folded into the linearisation LUT. */
  linearization?: number[];
  /** Index of the infrared plane, when one is kept. */
  irPlane?: number;
  /** Per-pixel clipping computed by the decoder (binned RAW: any photosite at its white level). */
  clipped?: Uint8Array;
  /** CFA map (colour 0 R, 1 G, 2 B per cell of the period) for unbinned photosite planes. */
  cfaMap?: { period: number; map: number[] };
  notes: Diagnostic[];
}

/** What a decoder returns: stored samples, planar, in sensor orientation, nothing interpreted. */
export interface RawImage {
  width: number;
  height: number;
  /** 1 = grey, 3 = RGB, 4 = RGB + infrared. */
  channels: 1 | 3 | 4;
  planes: Plane[];
  sample: 'uint' | 'float';
  bits: 8 | 16 | 32;
  levels: Levels;
  encoding: { value: Encoding; evidence: EncodingEvidence };
  meta: SourceMeta;
}

