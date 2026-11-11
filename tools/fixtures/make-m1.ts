// Writes fixtures/synthetic/m1-negative-96x64.tif (the M1 walking-skeleton negative).
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeM1Tiff } from '@chromobench/engine-mock';
import { sha256Hex } from '@chromobench/contract';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'synthetic', 'm1-negative-96x64.tif');
mkdirSync(dirname(out), { recursive: true });
const bytes = makeM1Tiff();
writeFileSync(out, bytes);
console.log(`wrote ${out} (${bytes.length} bytes, sha256 ${sha256Hex(bytes)})`);
