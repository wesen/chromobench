// Orchestrator check (session 04, S04-N1): a NEF with EXIF orientation decoded binned (CPU working size) vs
// demosaiced. Private file: reads it in place, prints sizes and the orientation tag only. Skips when absent.
import { existsSync, readFileSync } from 'node:fs';
import { LibRawDecoder } from '@chromobench/ingest';
import { decodePhoto } from '../../../../../../apps/studio/src/host/decode.ts';
const f = process.argv[2] ?? `${process.env.HOME}/Downloads/2026-11-11 - manfred test bilder/DSC_8687.NEF`;
if (!existsSync(f)) { console.log('absent:', f); process.exit(0); }
const bytes = new Uint8Array(readFileSync(f));
const raw = new LibRawDecoder();
for (const long of [640, 2000]) {
  const d = await decodePhoto(bytes, 'c'.repeat(64), 'x.NEF', { long, raw });
  console.log(`long ${long}: working ${d.info.width}×${d.info.height}, full ${d.full.width}×${d.full.height}, orientationTag ${d.info.orientationTag ?? '-'}; ${d.notes[0]?.slice(0, 120)}`);
}
