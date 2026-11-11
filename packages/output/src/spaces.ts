// The five output spaces (guide §2.1, §5.3), each tied to the bundled CC0 Compact ICC v4 profile it
// embeds. The pixel maths (matrix, TRC) is @chromobench/core's outputSpace(), whose constants are
// these profiles' own s15Fixed16 values; test/icc.test.ts parses the files and checks the agreement,
// so the numbers in a file and the profile it carries cannot drift apart (decision D3).
import type { OutputSpaceId } from '@chromobench/contract';
import { outputSpace, type Mat3, type OutputSpaceDef, type ParametricCurve, type Vec3 } from '@chromobench/core';
import type { PngColour } from './encode/png16.ts';
import { BUNDLED_PROFILES } from './icc/profiles/bundled.ts';

export interface OutputSpace {
  id: OutputSpaceId;
  /** For people and the iCCP profile name: 'Adobe RGB (1998) compatible', not 'Adobe RGB'. */
  label: string;
  /** The bytes that will be embedded (v4 profile). */
  icc: Uint8Array;
  iccSha256: string;
  /** The v2 variant of the same space, for older readers (not used for the maths; see notes). */
  iccV2: Uint8Array;
  white: Vec3;
  toXYZ: Mat3;
  fromXYZ: Mat3;
  curve: ParametricCurve;
  encode(v: number): number;
  decode(v: number): number;
  /** ITU-T H.273 code points (primaries, transfer, matrix 0, full range) where they exist. */
  cicp?: readonly [number, number, number, number];
  /** Usable as a WebGPU canvas colour space. */
  canvas?: 'srgb' | 'display-p3';
}

const PROFILE_FILES: Record<OutputSpaceId, { v4: string; v2: string; label: string }> = {
  'srgb': { v4: 'sRGB-v4', v2: 'sRGB-v2-micro', label: 'sRGB IEC61966-2.1' },
  'display-p3': { v4: 'DisplayP3-v4', v2: 'DisplayP3-v2-micro', label: 'Display P3' },
  'rec2020': { v4: 'Rec2020-v4', v2: 'Rec2020-v2-micro', label: 'ITU-R BT.2020' },
  'adobe-rgb': { v4: 'AdobeCompat-v4', v2: 'AdobeCompat-v2', label: 'Adobe RGB (1998) compatible' },
  'prophoto': { v4: 'ProPhoto-v4', v2: 'ProPhoto-v2-micro', label: 'ProPhoto RGB (ROMM)' },
};

/**
 * cICP code points (H.273 Table 2 primaries, Table 3 transfer): sRGB is BT.709 primaries (1) with the
 * IEC 61966-2-1 transfer (13); Display P3 is SMPTE EG 432-1 primaries (12) with the same transfer. None
 * for Adobe RGB and ProPhoto (H.273 has no code points), and none for Rec.2020 until its transfer is
 * decided (guide §9). Review note (task bk2k): the sRGB value (1, 13, 0, 1) is from H.273 as recalled,
 * not checked against the recommendation's text.
 */
const CICP: Partial<Record<OutputSpaceId, readonly [number, number, number, number]>> = {
  'srgb': [1, 13, 0, 1],
  'display-p3': [12, 13, 0, 1],
};

export function base64Bytes(b64: string): Uint8Array {
  if (typeof atob === 'function') return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

export function bundledProfile(name: string): Uint8Array {
  const p = BUNDLED_PROFILES[name];
  if (!p) throw new Error(`no bundled profile ${name}`);
  return base64Bytes(p.base64);
}

const CACHE = new Map<OutputSpaceId, OutputSpace>();

export function getSpace(id: OutputSpaceId): OutputSpace {
  let s = CACHE.get(id);
  if (s) return s;
  const f = PROFILE_FILES[id];
  if (!f) throw new Error(`unknown output space ${String(id)}`);
  const def: OutputSpaceDef = outputSpace(id);
  const cicp = CICP[id];
  s = {
    id, label: f.label, icc: bundledProfile(f.v4), iccSha256: BUNDLED_PROFILES[f.v4]!.sha256, iccV2: bundledProfile(f.v2),
    white: def.white, toXYZ: def.toXYZ, fromXYZ: def.fromXYZ, curve: def.curve, encode: def.encode, decode: def.decode,
    ...(cicp ? { cicp } : {}),
    ...(id === 'srgb' || id === 'display-p3' ? { canvas: id } : {}),
  };
  CACHE.set(id, s);
  return s;
}

export const SPACE_IDS: readonly OutputSpaceId[] = ['srgb', 'display-p3', 'rec2020', 'adobe-rgb', 'prophoto'];

/** All five spaces (sync: the profiles are bundled). */
export function loadSpaces(): Record<OutputSpaceId, OutputSpace> {
  return Object.fromEntries(SPACE_IDS.map((id) => [id, getSpace(id)])) as Record<OutputSpaceId, OutputSpace>;
}

/**
 * PNG colour chunks by space (guide §5.6 policy table): sRGB → the sRGB chunk alone (perceptual
 * intent); Display P3 → iCCP and cICP (12, 13, 0, 1); Rec.2020, Adobe RGB, ProPhoto → iCCP. `signal`
 * 'icc' drops cICP, 'none' writes no colour chunk at all (the file is then ambiguous; for tests).
 * iCCP and sRGB are never both present (PNG-3 §4.3).
 */
export function pngColour(space: OutputSpace, signal: 'icc' | 'icc+cicp' | 'none' = 'icc+cicp'): PngColour {
  if (signal === 'none') return {};
  if (space.id === 'srgb') return { srgbIntent: 0 };
  const out: PngColour = { icc: { name: space.label, bytes: space.icc } };
  if (signal === 'icc+cicp' && space.cicp) out.cicp = space.cicp;
  return out;
}
