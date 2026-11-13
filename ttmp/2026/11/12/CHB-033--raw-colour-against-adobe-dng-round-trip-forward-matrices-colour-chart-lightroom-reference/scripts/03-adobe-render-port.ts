// CHB-033 step 4: Adobe's DNG rendering (DNG SDK 1.7.1, dng_render.cpp dng_render_task::ProcessArea) ported stage by
// stage, applied to Adobe DNG Converter's DNGs, against our colour. Stages (SDK source references):
//   S1 ABCtoRGB:  linear ProPhoto = ProPhoto.MatrixFromPCS · FM(g) · diag(1/AsShotNeutral) · camera RGB (dng_render.cpp
//                 Start: fCameraToRGB = ProPhoto.MatrixFromPCS() * spec->CameraToPCS(); DNG spec 1.4 ch. 6)
//   S2 HueSatMap: profile.HueSatMapForWhite(white): entry-wise g·map1 + (1−g)·map2 (dng_camera_profile.cpp), applied in
//                 HSV by RefBaselineHueSatMap (dng_reference.cpp:1508), 2.5D (90 hue × 30 sat × 1 val)
//   S3 exposure:  dng_function_exposure_ramp(white = 2^−max(0, BaselineExposure), black = Shadows 5 · 0.001) on R, G, B
//   S4 LookTable: RefBaselineHueSatMap with the 36 × 8 × 16 LookTable (linear value encoding: no encoding tag)
//   S5 tone:      RefBaselineRGBTone (dng_reference.cpp:1868) with dng_tone_curve_acr3_default (dng_render.cpp:164);
//                 the exposure tone is a no-op for exposure ≥ 0
//   S6 output:    linear ProPhoto → XYZ(D50) → sRGB (D50-adapted matrix) → sRGB curve
// g = share of calibration illuminant 1 at the as-shot white, 1/T interpolation (the SDK uses dng_temperature
// (Robertson); McCamy here, a known approximation). Tables: exiftool -m -b (ProfileHueSatMapData1/2,
// ProfileLookTableData); the ACR3 table: .playwright-mcp/dng/acr3-tone.json, parsed from the SDK source.
// Private files read in place; numbers and renders (various/shots, this ticket only). Usage: node 03-…ts [name…]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { LibRawDecoder, readDngColour } from '@chromobench/ingest';
import { decodePhoto } from '../../../../../../apps/studio/src/host/decode.ts';
import { de2000 } from './lib-colour.ts';
import { ACR3, BRAD, CCT, D50, type M3, PCS_TO_PP, PCS_TO_SRGB, PP_TO_PCS, ROOT, type Table, acr3, app, bradford, f, hsv2rgb, hueSat, inv, lab, labPP, m3, mccamy, mul, nums, pin, ramp, rgb2hsv, rgbTone, xyOf } from './lib-adobe.ts';
const raw = new LibRawDecoder();
const OUT = `${ROOT}/ttmp/2026/11/12/CHB-033--raw-colour-against-adobe-dng-round-trip-forward-matrices-colour-chart-lightroom-reference/various/shots`;
const enc = (v: number) => Math.round(255 * pin(v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
const toSrgb8 = (pp: number[]) => app(PCS_TO_SRGB, app(PP_TO_PCS, pp)).map(enc);
const ppm = (path: string, w: number, h: number, px: (i: number) => number[]) => {
  const head = Buffer.from(`P6\n${w} ${h}\n255\n`), body = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) { const c = px(i); body[i * 3] = c[0]!; body[i * 3 + 1] = c[1]!; body[i * 3 + 2] = c[2]!; }
  writeFileSync(path, Buffer.concat([head, body]));
};
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['DSC_8559', 'DSC_8541', 'DSC_8536', 'DSC_8655'];
for (const name of names) {
  const path = `${ROOT}/.playwright-mcp/dng/${name}.dng`;
  if (!existsSync(path)) { console.log('absent', name); continue; }
  const bytes = new Uint8Array(readFileSync(path));
  const dc = readDngColour(bytes)!;
  const neutral = dc.asShotNeutral!, t1 = CCT[dc.calibrationIlluminant1!]!, t2 = CCT[dc.calibrationIlluminant2!]!;
  const weight = (cct: number) => (cct <= t1 ? 1 : cct >= t2 ? 0 : (1 / cct - 1 / t2) / (1 / t1 - 1 / t2));
  const lerp = (A: M3, B: M3, g: number): M3 => A.map((r, i) => r.map((v, j) => g * v + (1 - g) * B[i]![j]!));
  const CM1 = m3(dc.colorMatrix1!), CM2 = m3(dc.colorMatrix2!), FM1 = m3(dc.forwardMatrix1!), FM2 = m3(dc.forwardMatrix2!);
  let xy = [0.3457, 0.3585], cct = 5000;
  for (let it = 0; it < 30; it++) { xy = xyOf(app(inv(lerp(CM1, CM2, weight(cct))), neutral)); cct = mccamy(xy[0]!, xy[1]!); }
  const g = weight(cct);
  const FM_PP = mul(PCS_TO_PP, mul(lerp(FM1, FM2, g), [[1 / neutral[0]!, 0, 0], [0, 1 / neutral[1]!, 0], [0, 0, 1 / neutral[2]!]]));
  const camToXyz = inv(lerp(CM1, CM2, g)), Wc = app(camToXyz, neutral);
  const CM_PP = mul(PCS_TO_PP, mul(bradford([Wc[0]! / Wc[1]!, 1, Wc[2]! / Wc[1]!], D50), camToXyz.map((r) => r.map((v) => v / Wc[1]!))));
  const h1 = nums(path, 'ProfileHueSatMapData1'), h2 = nums(path, 'ProfileHueSatMapData2'), lt = nums(path, 'ProfileLookTableData');
  const hsm: Table = { H: 90, S: 30, V: 1, d: Float64Array.from(h1, (v, i) => g * v + (1 - g) * h2[i]!) };
  const look: Table = { H: 36, S: 8, V: 16, d: Float64Array.from(lt) };
  const baseline = dc.baselineExposure ?? 0;
  const R = ramp(1 / 2 ** Math.max(0, baseline), Math.min(5 * 0.001, 0.99 / 2 ** Math.max(0, baseline)));
  const d = await decodePhoto(bytes, 'f'.repeat(64), `${name}.dng`, { long: 384, raw });
  const w = d.info.width, h = d.info.height, n = w * h;
  const C = { s1: 0, s2: 0, s4: 0, s5: 0, cm: 0, fm: 0 }; let nC = 0;
  const adobe: number[][] = [], cmT: number[][] = [], fmT: number[][] = [];
  const deCM: number[] = [], deFM: number[] = [], deMap = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const cam = [d.data[i * 3]!, d.data[i * 3 + 1]!, d.data[i * 3 + 2]!];
    const s1 = app(FM_PP, cam).map((x) => Math.max(0, x));
    const s2 = hueSat(hsm, s1);
    const s3 = s2.map(R);
    const s4 = hueSat(look, s3);
    const s5 = rgbTone(s4, acr3);
    const cm5 = rgbTone(app(CM_PP, cam).map((x) => R(Math.max(0, x))), acr3); // our colour, Adobe's exposure and tone, no tables
    const fm5 = rgbTone(s1.map(R), acr3);                                      // Adobe's matrix, exposure and tone, no tables
    adobe.push(s5); cmT.push(cm5); fmT.push(fm5);
    const Y = app(PP_TO_PCS, s5)[1]!;
    if (Y < 0.01 || Y > 0.95) { deMap[i] = NaN; continue; }
    const LA = labPP(s5), Lc = labPP(cm5), Lf = labPP(fm5);
    const ch = (L: number[]) => Math.hypot(L[1]!, L[2]!);
    C.s1 += ch(labPP(s1.map(R))); C.s2 += ch(labPP(s2.map(R))); C.s4 += ch(labPP(s4)); C.s5 += ch(LA); C.cm += ch(Lc); C.fm += ch(Lf); nC++;
    const e = de2000(Lc, LA); deCM.push(e); deFM.push(de2000(Lf, LA)); deMap[i] = e;
  }
  const q = (v: number[], p: number) => [...v].sort((a, b) => a - b)[Math.floor(p * (v.length - 1))]!.toFixed(2);
  const c = (k: keyof typeof C) => (C[k] / nC).toFixed(2);
  console.log(`${name}: cct ${cct.toFixed(0)} K, StdA share ${g.toFixed(3)}, BaselineExposure ${baseline}`);
  console.log(`  mean C*ab (Lab D50): Adobe S1 FM ${c('s1')} → S2 +HueSatMap ${c('s2')} → S4 +LookTable ${c('s4')} → S5 +tone ${c('s5')}; references with Adobe's exposure+tone, no tables: our CM ${c('cm')}, Adobe FM ${c('fm')}`);
  console.log(`  ΔE2000 vs Adobe's full render: our CM colour ${q(deCM, 0.5)} / ${q(deCM, 0.9)} / ${q(deCM, 0.99)}; Adobe FM without tables ${q(deFM, 0.5)} / ${q(deFM, 0.9)} / ${q(deFM, 0.99)} (median / p90 / p99, n ${deCM.length})`);
  const W3 = w * 3 + 16;
  ppm(`${OUT}/03-${name}-adobe-ours-de.ppm`, W3, h, (i) => {
    const y = Math.floor(i / W3), x = i % W3;
    if (x < w) return toSrgb8(adobe[y * w + x]!);
    if (x < w + 8) return [40, 40, 40];
    if (x < 2 * w + 8) return toSrgb8(cmT[y * w + x - w - 8]!);
    if (x < 2 * w + 16) return [40, 40, 40];
    const e = deMap[y * w + x - 2 * w - 16]!; const v = Number.isNaN(e) ? 0 : Math.round(255 * Math.min(1, e / 10)); return [v, v, Number.isNaN(e) ? 60 : v];
  });
}
