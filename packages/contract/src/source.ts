// Source identity, decode options and decoded-source facts (proposed by CHB-006 §5.13, merged with
// CHB-002 §5.9 and CHB-012 §10). Coordinates of every stored box are sensor pixels of the decoded source.
import type { Diagnostic } from './errors.ts';

export type Encoding = 'linear' | 'srgb' | 'gamma22';

export interface SourceRef {
  kind: 'file' | 'triplet';
  /** Identity. For a triplet: sha256("triplet:v1\n" + R + "\n" + G + "\n" + B). */
  sha256: string;
  /** Last known path, for display and relinking only. */
  path?: string;
  name?: string;
  parts?: { role: 'R' | 'G' | 'B'; sha256: string; path?: string }[];
  /** Transient bytes handed to Engine.open. Never persisted in a recipe. */
  bytes?: ArrayBuffer | Uint8Array;
}

export interface DecodeOptions {
  /** LibRaw mode; TIFF and PNG always behave as 'scan'. */
  mode: 'scan' | 'photo';
  encoding: Encoding;
  /** Override, in native sample units. */
  levels?: { black: number[]; white: number[] };
  bin?: 'none' | 'cfa' | 'cfa-half';
  tripletMode?: 'own' | 'all-photosites';
  /** Keep a fourth (infrared) channel. */
  ir?: boolean;
}

export interface CameraColour {
  make: string;
  model: string;
  iso?: number;
  exposure_s?: number;
  fnumber?: number;
  /** 3×3 camera RGB → XYZ (D50/D65 per `from`). */
  camToXyz?: number[][];
  asShotNeutral?: [number, number, number];
  daylightMultipliers?: [number, number, number];
  from?: 'dng' | 'adobe' | 'libraw';
}

export interface SourceInfo {
  sha256: string;
  format: 'tiff' | 'dng' | 'png' | 'raw' | 'image' | 'triplet';
  width: number;
  height: number;
  channels: 1 | 3 | 4;
  bits: number;
  sample: 'uint' | 'float';
  encoding: { value: Encoding; evidence: 'declared' | 'metadata' | 'chunk' | 'bit-depth' | 'format' };
  levels: { black: number[]; white: number[]; from: 'file' | 'libraw' | 'default' | 'declared' };
  cfa?: 'bayer' | 'xtrans' | 'none';
  orientationTag?: number;
  camera?: CameraColour;
  /** Fraction of samples at the white level. */
  clippedFraction: number;
  notes: Diagnostic[];
}

/**
 * The spectral forward model of a scanner, injected into ingest by core (CHB-006 DR-9),
 * so ingest can rank stocks and check the base without depending on core.
 */
export interface ScannerForward {
  scanner: string;
  readBase(stock: string): [number, number, number];
  sigmaMin(stock: string, c: [number, number, number]): number;
}
