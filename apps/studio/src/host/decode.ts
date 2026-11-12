// Decoding a file into the studio's working image (CHB-023, moved out of engines.ts by CHB-027 so the engine
// worker runs it): packages/ingest decodes (TIFF, PNG, DNG, camera RAW through LibRaw), linearises and
// area-averages to the working size; a negative scan is then conditioned (film layout, rebate, veil, dust).
// A host file (tools/scripts/check-boundaries.ts names it): it imports core and ingest. Runs in the engine
// worker (host/engine-worker.ts) and, with ?worker=0, on the main thread (host/engines.ts).
import type { Box, SourceInfo, Vec3 } from '@chromobench/contract';
import { DEFAULT_SIGMA_D, rebateBox } from '@chromobench/core';
import {
  conditionScan, decodeAsync, detectSpecks, guessOpenMode, heal, linearise, region, rollBase, sigmaD, sourceInfo, spotsMask, stripFrames,
  type FilmLayout, type FrameBase, type RawDecoder, type RawImage,
} from '@chromobench/ingest';
import type { Decoded as DecodedMeta, OpenGuess } from './studio-engine.ts';
import type { DecodeMode } from './worker-protocol.ts';

export type { DecodeMode };
/** A decoded file with its working image. */
type Decoded = DecodedMeta & { data: Float32Array };

export interface DecodeOptions {
  /** Working image long side (0 = the file's own size). */
  long: number;
  /** Detect and heal dust specks in a scan (slow on big scans). */
  dust: boolean;
  /** The bases of the roll opened so far (conditioning reads the roll's veil; the new frame is added). */
  roll: Map<string, FrameBase>;
  /** Camera RAW decoder (LibRaw, in a worker or in this thread). */
  raw: RawDecoder;
}

const fmt3 = (v: ArrayLike<number>): string => Array.from(v, (x) => x.toFixed(2)).join(' ');

/** Photo or negative from the working image (ingest's classifier); scan-mode camera data is white-balanced first. */
function guessOf(raw: RawImage, data: Float32Array, w: number, h: number, name: string, mode: DecodeMode, layout: FilmLayout | null): OpenGuess {
  const wb = mode === 'scan' && raw.meta.format === 'raw' ? raw.meta.camera?.daylightMultipliers ?? null : null;
  const g = guessOpenMode(data, w, h, { name, format: raw.meta.format, wb, layout });
  return { kind: g.kind, confident: g.confident, why: g.why };
}

/** Dust in scanner density: detect (ingest detectSpecks), heal (patch), back to transmittance. */
export function healDust(rgb: Float32Array, w: number, h: number, Treb: Vec3): number {
  const n = w * h;
  const D = [0, 1, 2].map((k) => {
    const p = new Float32Array(n);
    for (let i = 0; i < n; i++) p[i] = -Math.log10(Math.max(rgb[i * 3 + k]!, 1e-6) / Treb[k]!);
    return p;
  });
  const sigma = sigmaD(rgb, w, h, Treb) ?? DEFAULT_SIGMA_D;
  const found = detectSpecks(D, w, h, sigma).spots.filter((s) => s.score >= 0.5);
  if (!found.length) return 0;
  const healed = heal(D, w, h, spotsMask(found, w, h), { marginPx: 1, method: 'patch' }).planes;
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) rgb[i * 3 + k] = Treb[k]! * 10 ** -healed[k]![i]!;
  return found.length;
}

/** A photo (CHB-012): decode (camera RAW in photo mode) → linear → area-averaged working image; no conditioning. */
export async function decodePhoto(bytes: Uint8Array, sha256: string, name: string, o: Pick<DecodeOptions, 'long' | 'raw'>): Promise<Decoded> {
  const raw = await decodeAsync(bytes, { fileName: name, options: { mode: 'photo' }, raw: o.raw });
  const lin = linearise(raw, { sha256, ir: false });
  const W = lin.width, H = lin.height;
  const s = o.long > 0 ? Math.min(1, o.long / Math.max(W, H)) : 1;
  const w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
  const data = region(lin, { x: 0, y: 0, w: W, h: H }, w, h, { channels: 3 });
  const cam = raw.meta.camera;
  const notes = [raw.meta.format === 'raw'
    ? `photo: camera RAW${cam ? ` (${cam.make} ${cam.model})` : ''} via LibRaw, photo mode, ${W}×${H}${cam?.camToXyz ? `, camera matrix from ${cam.from ?? 'LibRaw'}` : ', no camera matrix (taken as linear sRGB)'}`
    : `photo: ${raw.meta.format.toUpperCase()} ${W}×${H}, ${raw.bits}-bit, taken as linear sRGB scene light`];
  if (s < 1) notes.push(`working image ${w}×${h}`);
  const info0 = sourceInfo(sha256, raw, lin);
  const info: SourceInfo = { ...info0, width: w, height: h, channels: 3, notes: [...info0.notes, { code: 'W_DECODE_NOTE', message: notes.join('; ') }] };
  return { info, data, full: { width: W, height: H }, notes, rebate: null, kind: 'digital-raw', guess: guessOf(raw, data, w, h, name, 'photo', null) };
}

/** Decode → linear → area-averaged working image → conditioning. */
export async function decodeScan(bytes: Uint8Array, sha256: string, name: string, o: DecodeOptions): Promise<Decoded> {
  const roll = o.roll;
  // Camera RAW (and CFA DNG) go to LibRaw in scan mode: linear camera RGB, no white balance, CFA-binned.
  const raw = await decodeAsync(bytes, { fileName: name, options: { mode: 'scan', bin: 'cfa' }, raw: o.raw });
  const lin = linearise(raw, { sha256, ir: false });
  const W = lin.width, H = lin.height;
  const s = o.long > 0 ? Math.min(1, o.long / Math.max(W, H)) : 1;
  const w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
  const data = region(lin, { x: 0, y: 0, w: W, h: H }, w, h, { channels: 3 });
  const cam = raw.meta.camera ? ` (${raw.meta.camera.make} ${raw.meta.camera.model})` : '';
  const notes: string[] = [raw.meta.format === 'raw'
    ? `camera RAW${cam} via LibRaw, scan mode, CFA-binned to ${W}×${H}`
    : `${raw.meta.format.toUpperCase()} ${W}×${H}, ${raw.bits}-bit`];
  if (s < 1) notes.push(`working image ${w}×${h}`);
  // Film layout (CHB-020, contract 0.3): the pixels stay as scanned. The holder's veil goes into the recipe as
  // scan.flare (per channel, percent) and the measured base as scan.baseT, so the engine removes the flare and
  // the preview, the export and the roll analysis all see the same chain; the rebate box (film outside the image
  // frame, never a sprocket hole or the holder) goes into scan.rebate. A frame with no holder gets the veil of
  // the roll opened so far.
  const rollVeil = rollBase([...roll.values()].filter((f) => f.id !== sha256)).veil;
  const c = conditionScan(data, w, h, { id: sha256, rollVeil, subtract: false });
  const guess = guessOf(raw, data, w, h, name, 'scan', c.layout);
  // a photo opened as a negative must not lend its "base" to the roll
  if (guess.kind === 'negative' || !guess.confident) roll.set(sha256, c.frame);
  else roll.delete(sha256);
  const rb: Box = c.rebate ?? rebateBox(w, h, 3, data);
  // the base as scanned (veil still in): the dust healer measures density against it
  const Treb: Vec3 = c.layout.rebate?.Traw ?? ([0, 1, 2].map((k) => {
    let t = 0, m = 0;
    for (let y = rb.y; y < rb.y + rb.h; y++) for (let x = rb.x; x < rb.x + rb.w; x++) { t += data[(y * w + x) * 3 + k]!; m++; }
    return Math.max(t / Math.max(m, 1), 1e-6);
  }) as Vec3);
  if (c.rebate) notes.push(`base ${fmt3((c.baseT ?? Treb).map((t) => -Math.log10(t)))} D (rebate ${rb.w}×${rb.h} at ${rb.x},${rb.y}, ${c.layout.rebate?.from})`);
  else notes.push('no rebate found: the base is the brightest 5 % of columns (scan.density default)');
  if (c.flare) notes.push(`scan.flare ${fmt3(c.flare)} % from the veil ${c.veil!.map((v) => v.toExponential(1)).join(' ')} (${c.veilFrom}), removed by the engine`);
  else notes.push('no veil measured: scan.flare 0');
  for (const n of c.notes) notes.push(`${n.code}: ${n.message}`);
  // a strip of several frames (CHB-027 WS-D, F16): one frame per box, all on this decode (shared base and veil)
  const strip = guess.kind === 'negative' || !guess.confident ? stripFrames(data, w, h, { layout: c.layout }) : null;
  if (strip?.split) notes.push(`strip of ${strip.frames.length} frames along ${strip.axis} (confidence ${strip.confidence.toFixed(2)})`);
  if (o.dust) notes.push(`dust: ${healDust(data, w, h, Treb)} specks healed`);
  const info0 = sourceInfo(sha256, raw, lin);
  const info: SourceInfo = {
    ...info0, width: w, height: h, channels: 3,
    notes: [...info0.notes, { code: 'W_DECODE_NOTE', message: notes.join('; ') }],
  };
  return { info, data, full: { width: W, height: H }, notes, rebate: c.rebate, flare: c.flare, baseT: c.scanBaseT, kind: 'negative-scan', guess, frames: strip?.split ? strip.frames.map((f) => f.box) : null };
}

/** Decodes a file in the given mode. */
export function decodeFile(bytes: Uint8Array, sha256: string, name: string, mode: DecodeMode, o: DecodeOptions): Promise<Decoded> {
  if (mode === 'photo') o.roll.delete(sha256);
  return mode === 'photo' ? decodePhoto(bytes, sha256, name, o) : decodeScan(bytes, sha256, name, o);
}
