// CHB-033 step 5: validate the ported Adobe pipeline (lib-adobe.ts) against Adobe's own renderer. Input: samples from
// 04a-sample-dng-validate.py — dng_validate 1.7.1's stage-3 image (Adobe's demosaiced linear camera RGB) and its final
// render (-cs3 -16: ProPhoto RGB, gamma 1.8) on the same pixel grid. The port renders the stage-3 values; both results
// are compared in linear ProPhoto (Adobe's decoded with x^1.8, valid above its spline toe at 0.0193) and in Lab(D50).
// Also: our colour (colour-matrix path, as chromobench decodes) through Adobe's exposure and tone, against Adobe.
// Usage: node 04-validate-port.ts [name…] (DNGs in .playwright-mcp/dng/, samples in .playwright-mcp/dngv/)
import { existsSync, readFileSync } from 'node:fs';
import { readDngColour } from '@chromobench/ingest';
import { de2000 } from './lib-colour.ts';
import { CCT, D50, type M3, PCS_TO_PP, PP_TO_PCS, ROOT, type Table, acr3, app, bradford, hueSat, inv, labPP, m3, mccamy, mul, nums, ramp, rgbTone, xyOf } from './lib-adobe.ts';
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['DSC_8559', 'DSC_8541', 'DSC_8536', 'DSC_8655'];
const q = (v: number[], p: number) => [...v].sort((a, b) => a - b)[Math.floor(p * (v.length - 1))]!;
for (const name of names) {
  const dng = `${ROOT}/.playwright-mcp/dng/${name}.dng`, smp = `${ROOT}/.playwright-mcp/dngv/${name}-samples.f32`;
  if (!existsSync(dng) || !existsSync(smp)) { console.log('absent', name); continue; }
  const dc = readDngColour(new Uint8Array(readFileSync(dng)))!;
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
  const clip = neutral.map((v) => v / Math.max(...neutral)); // RefBaselineABCtoRGB: camera values capped at the camera white
  const h1 = nums(dng, 'ProfileHueSatMapData1'), h2 = nums(dng, 'ProfileHueSatMapData2'), lt = nums(dng, 'ProfileLookTableData');
  const hsm: Table = { H: 90, S: 30, V: 1, d: Float64Array.from(h1, (v, i) => g * v + (1 - g) * h2[i]!) };
  const look: Table = { H: 36, S: 8, V: 16, d: Float64Array.from(lt) };
  const be = dc.baselineExposure ?? 0, R = ramp(1 / 2 ** Math.max(0, be), Math.min(0.005, 0.99 / 2 ** Math.max(0, be)));
  const buf = readFileSync(smp), f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4), n = f32.length / 6;
  const dCode: number[] = [], dePort: number[] = [], deOurs: number[] = [], deFM: number[] = [];
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const cam = [f32[i * 6]!, f32[i * 6 + 1]!, f32[i * 6 + 2]!].map((v, k) => Math.min(v, clip[k]!));
    const adobeEnc = [f32[i * 6 + 3]!, f32[i * 6 + 4]!, f32[i * 6 + 5]!];
    const s1 = app(FM_PP, cam).map((x) => Math.max(0, x));
    const port = rgbTone(hueSat(look, hueSat(hsm, s1).map(R)), acr3);
    const portEnc = port.map((x) => x ** (1 / 1.8));
    dCode.push(Math.max(...portEnc.map((v, k) => Math.abs(v - adobeEnc[k]!))) * 65535);
    if (Math.min(...adobeEnc) < 0.0193 || Math.max(...adobeEnc) > 0.999) continue; // spline toe / clipped
    const adobe = adobeEnc.map((v) => v ** 1.8);
    const LA = labPP(adobe);
    const e = de2000(labPP(port), LA); dePort.push(e); if (e > 3) bad++;
    deOurs.push(de2000(labPP(rgbTone(app(CM_PP, cam).map((x) => R(Math.max(0, x))), acr3)), LA));
    deFM.push(de2000(labPP(rgbTone(s1.map(R), acr3)), LA));
  }
  const s = (v: number[]) => `${q(v, 0.5).toFixed(3)} / ${q(v, 0.9).toFixed(3)} / ${q(v, 0.99).toFixed(3)} / max ${q(v, 1).toFixed(2)}`;
  console.log(`${name}: ${n} samples, ${dePort.length} compared (Adobe output above the toe, unclipped); cct ${cct.toFixed(0)} K, g ${g.toFixed(4)}`);
  console.log(`  port vs dng_validate: |Δ| in 16-bit ProPhoto codes ${s(dCode)} (median / p90 / p99 / max, all samples)`);
  console.log(`  port vs dng_validate: ΔE2000 ${s(dePort)}; samples > 3: ${bad}`);
  console.log(`  ours (CM path + Adobe exposure/tone) vs dng_validate: ΔE2000 ${s(deOurs)}`);
  console.log(`  Adobe FM without tables vs dng_validate: ΔE2000 ${s(deFM)}`);
}
