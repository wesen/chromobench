// Orchestrator check (session 04, S04-N2): the as-shot neutral a camera RAW decode carries (private NEFs read in
// place; prints the neutral only). Skips files that are absent.
import { existsSync, readFileSync } from 'node:fs';
import { decodeAsync, LibRawDecoder } from '@chromobench/ingest';
const dir = `${process.env.HOME}/Downloads/2026-11-11 - manfred test bilder`;
const raw = new LibRawDecoder();
for (const n of ['DSC_8559', 'DSC_8541', 'DSC_8536', 'DSC_8655']) {
  const f = `${dir}/${n}.NEF`;
  if (!existsSync(f)) { console.log('absent', n); continue; }
  const img = await decodeAsync(new Uint8Array(readFileSync(f)), { fileName: `${n}.NEF`, options: { mode: 'scan', bin: 'cfa-half' }, raw });
  const s = img.meta.camera?.asShotNeutral;
  console.log(n, s ? `as-shot neutral R ${s[0].toFixed(3)} G ${s[1].toFixed(3)} B ${s[2].toFixed(3)} (B/R ${(s[2] / s[0]).toFixed(2)})` : 'none');
}
