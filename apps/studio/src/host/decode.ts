// Decoding a file into the studio's working image (CHB-023, moved out of engines.ts by CHB-027 so the engine
// worker runs it): packages/ingest decodes (TIFF, PNG, DNG, camera RAW through LibRaw), linearises and
// area-averages to the working size; a negative scan is then conditioned (film layout, rebate, veil, dust).
// A host file (tools/scripts/check-boundaries.ts names it): it imports core and ingest. Runs in the engine
// worker (host/engine-worker.ts) and, with ?worker=0, on the main thread (host/engines.ts).
import type { Box, Orientation, SourceInfo, Vec3 } from '@chromobench/contract';
import { DEFAULT_SIGMA_D, rebateBox } from '@chromobench/core';
import {
  conditionScan, decodeAsync, detectSpecks, guessOpenMode, heal, linearise, region, rollBase, sigmaD, sourceInfo, spotsMask, stripFrames,
  type FilmLayout, type FrameBase, type RawDecoder, type RawImage,
} from '@chromobench/ingest';
import { orientPixels, type Decoded as DecodedMeta, type OpenGuess } from './studio-engine.ts';
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

/**
 * Working sizes up to this long side read a camera RAW photo binned (CHB-031 F22): one pixel per 2 × 2 Bayer (3 × 3
 * X-Trans) photosites, raw camera colour, as scan mode reads negatives, instead of LibRaw's AHD demosaic at full size.
 * The working image is area-averaged from either, so the picture is the same (channel means within 0.05 % on a D750
 * NEF) while the decode takes ≈ 40 % of the time (24 MP: 2.2 s instead of 5.4 s, Node). The CPU engine works at
 * 640 px; the GPU engine's 4000 px reads the full demosaic.
 */
export const BINNED_PHOTO_MAX_LONG = 1024;

/** EXIF orientation tag → the turn that shows the picture upright (mirrored tags do not occur in camera RAW). */
const EXIF_TURN: Partial<Record<number, Orientation>> = { 3: 'rot180', 6: 'cw90', 8: 'ccw90' };

/** A photo (CHB-012): decode (camera RAW in photo mode) → linear → area-averaged working image; no conditioning. */
export async function decodePhoto(bytes: Uint8Array, sha256: string, name: string, o: Pick<DecodeOptions, 'long' | 'raw'>): Promise<Decoded> {
  const binned = o.long > 0 && o.long <= BINNED_PHOTO_MAX_LONG;
  let raw = await decodeAsync(bytes, { fileName: name, options: binned ? { mode: 'scan', bin: 'cfa-half' } : { mode: 'photo' }, raw: o.raw });
  // binning applies to camera RAW only; a camera whose binned image is smaller than the working size: the demosaic
  const k = raw.meta.format === 'raw' && binned ? (raw.meta.cfa === 'xtrans' ? 3 : 2) : 1;
  let fullW = raw.width * k, fullH = raw.height * k;
  if (k > 1 && Math.max(raw.width, raw.height) < o.long) {
    raw = await decodeAsync(bytes, { fileName: name, options: { mode: 'photo' }, raw: o.raw });
    fullW = raw.width;
    fullH = raw.height;
  }
  const read = raw.width < fullW ? `, read binned ${raw.width}×${raw.height} (${k} × ${k} photosites a pixel)` : '';
  const lin = linearise(raw, { sha256, ir: false });
  const W = lin.width, H = lin.height;
  const s = o.long > 0 ? Math.min(1, o.long / Math.max(W, H)) : 1;
  let w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
  let data = region(lin, { x: 0, y: 0, w: W, h: H }, w, h, { channels: 3 });
  // LibRaw's demosaic (dcraw_make_mem_image) comes out turned by the camera's orientation tag; the binned read is in
  // sensor orientation, so a portrait opened sideways on the CPU engine (CHB-031 session 04, S04-N1): turn it the same way
  const turn = read ? EXIF_TURN[raw.meta.orientationTag ?? 1] : undefined;
  if (turn) {
    const o = orientPixels(turn, data, w, h, 3);
    data = o.data as Float32Array;
    [w, h] = [o.width, o.height];
    if (turn !== 'rot180') [fullW, fullH] = [fullH, fullW];
  }
  const cam = raw.meta.camera;
  const notes = [raw.meta.format === 'raw'
    ? `photo: camera RAW${cam ? ` (${cam.make} ${cam.model})` : ''} via LibRaw, photo mode, ${fullW}×${fullH}${read}${cam?.camToXyz ? `, camera matrix from ${cam.from ?? 'LibRaw'}` : ', no camera matrix (taken as linear sRGB)'}`
    : `photo: ${raw.meta.format.toUpperCase()} ${W}×${H}, ${raw.bits}-bit, taken as linear sRGB scene light`];
  if (s < 1) notes.push(`working image ${w}×${h}`);
  const info0 = sourceInfo(sha256, raw, lin);
  const info: SourceInfo = { ...info0, width: w, height: h, channels: 3, notes: [...info0.notes, { code: 'W_DECODE_NOTE', message: notes.join('; ') }] };
  return { info, data, full: { width: fullW, height: fullH }, notes, rebate: null, kind: 'digital-raw', guess: guessOf(raw, data, w, h, name, 'photo', null) };
}

/** A box (working px) scaled by kx, ky, kept inside its old edges (a strip frame's box is inset already). */
export function scaleBox(b: Box, kx: number, ky: number): Box {
  const x = Math.ceil(b.x * kx), y = Math.ceil(b.y * ky);
  return { x, y, w: Math.max(1, Math.floor((b.x + b.w) * kx) - x), h: Math.max(1, Math.floor((b.y + b.h) * ky) - y) };
}

/**
 * The working scale of a strip (CHB-031 F20, F10): `long` is meant for one picture, so a strip of n frames at that
 * size leaves each frame a fraction of it (the reference engine's 512 px over raw010's three frames left ≈ 220 px a
 * frame: blocky). The strip is sized so its largest frame gets ≈ `long` px on its long side — at most 4 × `long` for
 * the whole strip and never above the file's own size. `s` is the scale the boxes were found at (working / file).
 */
export function stripScale(s: number, boxes: readonly Box[], long: number, W: number, H: number): number {
  if (!(long > 0) || s >= 1 || !boxes.length) return s;
  const frameLong = Math.max(...boxes.map((b) => Math.max(b.w, b.h)));
  return Math.max(s, Math.min(1, (s * long) / Math.max(1, frameLong), (4 * long) / Math.max(W, H)));
}

/** Pixels two boxes share. */
const overlap = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * The film base read on a strip's gaps (CHB-031 F20): the unexposed film between neighbouring frames, across the
 * frames' band, inset by a pixel along and a tenth across (no frame edge, no holder). Per channel the median of the
 * gap pixels (scratches and dust do not move it), veil included as scanned; the box is the largest gap, for
 * scan.rebate. Null when the strip has no gap of at least 2 × 2 px.
 */
export function gapBase(rgb: Float32Array, w: number, boxes: readonly Box[], axis: 'x' | 'y'): { Traw: Vec3; box: Box; pixels: number } | null {
  const along = axis === 'y';
  const a0 = Math.max(...boxes.map((b) => (along ? b.x : b.y))), a1 = Math.min(...boxes.map((b) => (along ? b.x + b.w : b.y + b.h)));
  const inset = Math.floor((a1 - a0) / 10);
  const gaps: Box[] = [];
  for (let i = 1; i < boxes.length; i++) {
    const p = boxes[i - 1]!, n = boxes[i]!;
    const g0 = (along ? p.y + p.h : p.x + p.w) + 1, g1 = (along ? n.y : n.x) - 1;
    if (g1 - g0 < 2 || a1 - a0 - 2 * inset < 2) continue;
    gaps.push(along ? { x: a0 + inset, y: g0, w: a1 - a0 - 2 * inset, h: g1 - g0 } : { x: g0, y: a0 + inset, w: g1 - g0, h: a1 - a0 - 2 * inset });
  }
  if (!gaps.length) return null;
  const ch: number[][] = [[], [], []];
  for (const g of gaps) for (let y = g.y; y < g.y + g.h; y++) for (let x = g.x; x < g.x + g.w; x++) for (let k = 0; k < 3; k++) ch[k]!.push(rgb[(y * w + x) * 3 + k]!);
  const median = (v: number[]): number => Float64Array.from(v).sort()[v.length >> 1]!;
  return { Traw: ch.map(median) as Vec3, box: gaps.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a)), pixels: ch[0]!.length };
}

/** Decode → linear → area-averaged working image → conditioning. */
export async function decodeScan(bytes: Uint8Array, sha256: string, name: string, o: DecodeOptions): Promise<Decoded> {
  const roll = o.roll;
  // Camera RAW (and CFA DNG) go to LibRaw in scan mode: linear camera RGB, no white balance, CFA-binned.
  const raw = await decodeAsync(bytes, { fileName: name, options: { mode: 'scan', bin: 'cfa' }, raw: o.raw });
  const lin = linearise(raw, { sha256, ir: false });
  const W = lin.width, H = lin.height;
  const s = o.long > 0 ? Math.min(1, o.long / Math.max(W, H)) : 1;
  let w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
  let data = region(lin, { x: 0, y: 0, w: W, h: H }, w, h, { channels: 3 });
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
  let boxes = strip?.split ? strip.frames.map((f) => f.box) : null;
  let rebate = c.rebate;
  let baseT = c.scanBaseT;
  if (strip?.split) notes.push(`strip of ${strip.frames.length} frames along ${strip.axis} (confidence ${strip.confidence.toFixed(2)})`);
  // a strip's base where the rebate is not film outside the frames (F20: raw010's "rebate" lay on its thin first frame,
  // a base 0.08 D too dense for all three): the gaps between its frames are unexposed film next to each of them
  const rb0 = c.layout.rebate?.box;
  if (strip?.split && boxes && (!rb0 || boxes.some((b) => overlap(b, rb0) > 0.25 * rb0.w * rb0.h))) {
    const g = gapBase(data, w, boxes, strip.axis);
    if (g) {
      const veil = c.veil ?? [0, 0, 0];
      const T = g.Traw.map((t, k) => Math.max(1e-6, t - veil[k]!)) as Vec3;
      baseT = T.map((t, k) => t / (1 - Math.min(veil[k]!, 0.99))) as Vec3;
      rebate = g.box;
      if (roll.has(sha256)) roll.set(sha256, { ...c.frame, T });
      notes.push(`base ${fmt3(baseT.map((t) => -Math.log10(t)))} D from the gaps between frames (${g.pixels} px)${rb0 ? `: the film edge found lay on a frame (base ${fmt3((c.scanBaseT ?? Treb).map((t) => -Math.log10(t)))} D there)` : ''}`);
    }
  }
  // a strip's working image sized for its frames (F20): the boxes and the rebate scale with it; base, veil and the
  // guess are averages and stay (measured on the smaller image, as for a single frame)
  const s2 = boxes ? stripScale(s, boxes, o.long, W, H) : s;
  if (boxes && s2 > s * 1.05) {
    const w2 = Math.max(1, Math.round(W * s2)), h2 = Math.max(1, Math.round(H * s2));
    const kx = w2 / w, ky = h2 / h;
    data = region(lin, { x: 0, y: 0, w: W, h: H }, w2, h2, { channels: 3 });
    boxes = boxes.map((b) => scaleBox(b, kx, ky));
    rebate = rebate ? scaleBox(rebate, kx, ky) : rebate;
    notes.push(`strip working image ${w2}×${h2} (≈ ${Math.max(...boxes.map((b) => Math.max(b.w, b.h)))} px a frame)`);
    w = w2;
    h = h2;
  }
  if (o.dust) notes.push(`dust: ${healDust(data, w, h, Treb)} specks healed`);
  const info0 = sourceInfo(sha256, raw, lin);
  const info: SourceInfo = {
    ...info0, width: w, height: h, channels: 3,
    notes: [...info0.notes, { code: 'W_DECODE_NOTE', message: notes.join('; ') }],
  };
  return { info, data, full: { width: W, height: H }, notes, rebate, flare: c.flare, baseT, kind: 'negative-scan', guess, frames: boxes };
}

/** Decodes a file in the given mode. */
export function decodeFile(bytes: Uint8Array, sha256: string, name: string, mode: DecodeMode, o: DecodeOptions): Promise<Decoded> {
  if (mode === 'photo') o.roll.delete(sha256);
  return mode === 'photo' ? decodePhoto(bytes, sha256, name, o) : decodeScan(bytes, sha256, name, o);
}
