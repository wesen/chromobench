// CHB-031 round 2 WS-C (F30): the first print of a scan frame, as the studio makes it, against Negative Lab Pro's
// positive of the same frame, colour-managed. For the owner's decision on the first print's colour aim.
//
//   node ttmp/2026/11/12/CHB-031--*/scripts/wsc-01-compare-nlp.ts [--scan <strip.dng>] [--nlp <positive.tif>]
//        [--frame 2] [--long 640] [--shots <dir in the scratchpad>] [--json <file>]
//
// The scan is opened the way the studio's CPU engine opens it (apps/studio/src/host/decode.ts decodeScan at the
// reference engine's 640 px, no dust healing; core's RefEngine with tabulated previews, as TabulatedPreviews runs
// them), the strip frame gets the studio's recipe (stripFrameRecipe with the strip's orientation, withMeasured, real
// enlarger mode) and its automatic first print (host/first-print.ts firstPrint) under each aim variant: alpha 1
// (today's default), 0.75, 0.5, 0.25, 0, and LAB_SUBJECT_FAILURE with alpha 1 and 0.75. Each print is read as the
// display shows it (sRGB-encoded, below output.frame, over the frame's crop, oriented).
// Negative Lab Pro's positive (16-bit, ProPhoto RGB) is converted as its embedded profile says: ROMM decode
// (v < 16/512 → v/16, else v^1.8), ProPhoto → XYZ (D50), Bradford D50 → D65, XYZ → linear sRGB, clipped, sRGB encode.
// Statistics over the central 80 % of each picture (NLP crops tighter): mean R/G/B (8-bit), B/R of the means, HSV
// saturation (max − min)/max averaged over pixels with max ≥ 8/255, Rec. 601 luma mean and std, luma 1 % and 99 %.
// The scans are private: they are read in place, only numbers are printed; --shots writes PPM pictures for looking
// (keep them in the scratchpad, never in the repository). Skips (exit 0) when the files are absent.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const MAIN = join(ROOT, '..', '..', '..'); // the main checkout when this runs in a worktree (.claude/worktrees/<id>)
const arg = (k: string, d: string): string => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const scansDir = [join(ROOT, '.playwright-mcp/scans'), join(MAIN, '.playwright-mcp/scans')].find((p) => existsSync(p)) ?? join(ROOT, '.playwright-mcp/scans');
const SCAN = arg('scan', join(scansDir, '2025-08-09_raw000.dng'));
const NLP = arg('nlp', SCAN.replace(/\.dng$/i, '-positive.tif'));
const FRAME = Number(arg('frame', '2'));
const LONG = Number(arg('long', '640'));
const SHOTS = arg('shots', '');
const JSON_OUT = arg('json', '');
if (!existsSync(SCAN) || !existsSync(NLP)) {
  console.log(`skipped: private test files absent (${SCAN}, ${NLP})`);
  process.exit(0);
}

const { compile, defaultRecipe, Graph } = await import(join(ROOT, 'packages/contract/src/index.ts'));
const { integrateToGrey, Lights, nodePacksData, RefEngine } = await import(join(ROOT, 'packages/core/src/index.ts'));
const { decodeAsync, LibRawDecoder } = await import(join(ROOT, 'packages/ingest/src/index.ts'));
const { stripFrameRecipe } = await import(join(ROOT, 'packages/studio-kit/src/bridge/frames.ts'));
const { stripOrientation } = await import(join(ROOT, 'packages/studio-kit/src/model/orient.ts'));
const { decodeScan } = await import(join(ROOT, 'apps/studio/src/host/decode.ts'));
const { FIRST_PRINT_AIM, firstPrint, LAB_SUBJECT_FAILURE, withMeasured } = await import(join(ROOT, 'apps/studio/src/host/first-print.ts'));
const { orientPixels } = await import(join(ROOT, 'apps/studio/src/host/studio-engine.ts'));

type Img = { w: number; h: number; rgb: Uint8Array };

/** Statistics of an 8-bit sRGB picture over its central 80 %. */
function stats(im: Img) {
  const x0 = Math.round(im.w * 0.1), y0 = Math.round(im.h * 0.1), x1 = Math.round(im.w * 0.9), y1 = Math.round(im.h * 0.9);
  const m = [0, 0, 0];
  const L: number[] = [];
  let sat = 0, ns = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * im.w + x) * 3;
    const r = im.rgb[i]!, g = im.rgb[i + 1]!, b = im.rgb[i + 2]!;
    m[0]! += r; m[1]! += g; m[2]! += b;
    L.push(0.299 * r + 0.587 * g + 0.114 * b);
    const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
    if (hi >= 8) { sat += (hi - lo) / hi; ns++; }
  }
  const n = L.length;
  const mean = L.reduce((a, v) => a + v, 0) / n;
  const std = Math.sqrt(L.reduce((a, v) => a + (v - mean) ** 2, 0) / n);
  L.sort((a, b) => a - b);
  const rgb = m.map((v) => v / n);
  return { rgb: rgb.map((v) => +v.toFixed(1)), BR: +(rgb[2]! / rgb[0]!).toFixed(3), sat: +(sat / Math.max(1, ns)).toFixed(3), luma: +mean.toFixed(1), lumaStd: +std.toFixed(1), p1: +L[Math.floor(0.01 * (n - 1))]!.toFixed(1), p99: +L[Math.floor(0.99 * (n - 1))]!.toFixed(1) };
}

const enc = (v: number): number => {
  const c = Math.min(1, Math.max(0, v));
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
};
const mul = (M: number[][], v: number[]): number[] => M.map((r) => r[0]! * v[0]! + r[1]! * v[1]! + r[2]! * v[2]!);
const mm = (A: number[][], B: number[][]): number[][] => A.map((r) => [0, 1, 2].map((j) => r[0]! * B[0]![j]! + r[1]! * B[1]![j]! + r[2]! * B[2]![j]!));
const PROPHOTO_XYZ = [[0.7976749, 0.1351917, 0.0313534], [0.2880402, 0.7118741, 0.0000857], [0, 0, 0.82521]];
const BRADFORD_D50_D65 = [[0.9555766, -0.0230393, 0.0631636], [-0.0282895, 1.0099416, 0.0210077], [0.0122982, -0.020483, 1.3299098]];
const XYZ_SRGB = [[3.2404542, -1.5371385, -0.4985314], [-0.969266, 1.8760108, 0.041556], [0.0556434, -0.2040259, 1.0572252]];
const PROPHOTO_SRGB = mm(XYZ_SRGB, mm(BRADFORD_D50_D65, PROPHOTO_XYZ));

/** NLP's positive, colour-managed from its embedded ProPhoto RGB profile to sRGB (8-bit). */
async function nlpPicture(): Promise<Img> {
  const raw = await decodeAsync(new Uint8Array(readFileSync(NLP)), { fileName: NLP.split('/').pop() });
  const max = raw.sample === 'float' ? 1 : 2 ** raw.bits - 1;
  const w = raw.width, h = raw.height, rgb = new Uint8Array(w * h * 3);
  const romm = (v: number): number => (v < 16 / 512 ? v / 16 : v ** 1.8);
  for (let i = 0; i < w * h; i++) {
    const lin = [0, 1, 2].map((k) => romm(Number(raw.planes[raw.channels === 1 ? 0 : k]![i]) / max));
    mul(PROPHOTO_SRGB, lin).forEach((v, k) => (rgb[i * 3 + k] = enc(v)));
  }
  return { w, h, rgb };
}

// ── the studio's first print of the frame ──
const name = SCAN.split('/').pop()!;
const sha = 'a'.repeat(64);
const d = await decodeScan(new Uint8Array(readFileSync(SCAN)), sha, name, { long: LONG, dust: false, roll: new Map(), raw: new LibRawDecoder() });
const boxes = d.frames;
if (!boxes || !boxes[FRAME - 1]) throw new Error(`${name}: no frame ${FRAME} (${boxes ? `${boxes.length} frames` : 'not a strip'})`);
const box = boxes[FRAME - 1]!;
const turn = stripOrientation(boxes);
const e = new RefEngine({ data: nodePacksData(), mode: 'tabulated', sampled: true });
e.openDecoded(d.info, d.data);
const g = new Graph();
g.registerSource(d.info);
const base = withMeasured(stripFrameRecipe(defaultRecipe('negative-scan', { sha256: sha, name }), `frame-${FRAME}`, box, turn), d);
const integrate = (latd: number[], alpha: number) => [...integrateToGrey(latd, { latd: [0, 0, 0], lights: Lights.zero() }, alpha).logH];

/** The print as the display shows it: sRGB below output.frame over the frame's crop, then the frame's orientation. */
async function picture(r: any): Promise<Img> {
  const top = compile(r, g);
  const n = top.op === 'output.frame' ? g.get(top.inputs[0]) : top;
  e.adopt(g.closure(n.id));
  const res = await e.evaluate(n, { scale: 'full', precision: 'preview', region: r.view.frame.crop });
  const px = await res.read();
  const o = orientPixels(r.view.frame.orientation ?? 'none', px, res.width, res.height, res.info.channels);
  const rgb = new Uint8Array(o.width * o.height * 3);
  for (let i = 0; i < o.width * o.height; i++) for (let k = 0; k < 3; k++) rgb[i * 3 + k] = Math.round(255 * Math.min(1, Math.max(0, o.data[i * res.info.channels + k]!)));
  return { w: o.width, h: o.height, rgb };
}

const ppm = (file: string, im: Img): void => writeFileSync(file, Buffer.concat([Buffer.from(`P6\n${im.w} ${im.h}\n255\n`), Buffer.from(im.rgb)]));

const variants = [
  { key: 'a1', label: 'alpha 1 (default)', aim: { ...FIRST_PRINT_AIM['negative-scan'] } },
  { key: 'a0.75', label: 'alpha 0.75', aim: { alpha: 0.75 } },
  { key: 'a0.5', label: 'alpha 0.5', aim: { alpha: 0.5 } },
  { key: 'a0.25', label: 'alpha 0.25', aim: { alpha: 0.25 } },
  { key: 'a0', label: 'alpha 0 (density only)', aim: { alpha: 0 } },
  { key: 'a1sf', label: 'alpha 1 + subject failure', aim: { alpha: 1, subjectFailure: LAB_SUBJECT_FAILURE } },
  { key: 'a0.75sf', label: 'alpha 0.75 + subject failure', aim: { alpha: 0.75, subjectFailure: LAB_SUBJECT_FAILURE } },
  // not a setting today: the first print aimed at a warm grey instead of a neutral one (lights red −w, blue +w log H
  // on top of alpha 1), to show how far the aim would have to move to print as warm as Negative Lab Pro
  { key: 'warm0.05', label: 'alpha 1, aim warmed 0.05 log H', aim: { alpha: 1 }, warm: 0.05 },
  { key: 'warm0.1', label: 'alpha 1, aim warmed 0.10 log H', aim: { alpha: 1 }, warm: 0.1 },
  { key: 'warm0.15', label: 'alpha 1, aim warmed 0.15 log H', aim: { alpha: 1 }, warm: 0.15 },
];
const rows: any[] = [];
for (const v of variants) {
  let r = await firstPrint(e, g, base, { integrate, aim: { subjectFailure: null, ...v.aim } });
  const w = (v as { warm?: number }).warm ?? 0;
  if (w) {
    const l = r.print.lights.logH;
    r = { ...r, print: { ...r.print, lights: { ...r.print.lights, logH: [l[0] - w, l[1], l[2] + w] } } };
  }
  const im = await picture(r);
  if (SHOTS) ppm(join(SHOTS, `${name}-f${FRAME}-${v.key}.ppm`), im);
  rows.push({ variant: v.label, time_s: r.print.enlarger.time_s, lights: r.print.lights.logH, size: `${im.w}×${im.h}`, ...stats(im) });
}
const nlp = await nlpPicture();
if (SHOTS) ppm(join(SHOTS, `${name}-f${FRAME}-nlp.ppm`), nlp);
rows.push({ variant: 'Negative Lab Pro (colour-managed)', time_s: null, lights: null, size: `${nlp.w}×${nlp.h}`, ...stats(nlp) });

console.log(`${name} frame ${FRAME}/${boxes.length} (box ${box.w}×${box.h} at ${box.x},${box.y}, orientation ${turn}); working image ${d.info.width}×${d.info.height}`);
console.log('| Variant | Time s | Lights (log H) | Mean R/G/B | B/R | Saturation | Luma mean | Luma std | Luma 1 % / 99 % |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.variant} | ${r.time_s ?? '–'} | ${r.lights ? r.lights.map((x: number) => x.toFixed(3)).join(' ') : '–'} | ${r.rgb.join('/')} | ${r.BR} | ${r.sat} | ${r.luma} | ${r.lumaStd} | ${r.p1} / ${r.p99} |`);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ scan: name, frame: FRAME, rows }, null, 2));
