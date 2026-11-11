// tools/dsl-usage (CHB-007 §5.13): aggregates EvalTraces (a JSON array, or JSON lines) into the
// usage report: unused vocabulary, frequent errors, cut rate. Usage: node tools/dsl-usage/main.ts traces.json
import { readFileSync } from 'node:fs';
import { formatUsage, usageReport } from '../../packages/dsl/src/telemetry.ts';
import type { EvalTrace } from '../../packages/dsl/src/session.ts';

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/dsl-usage/main.ts <traces.json | traces.jsonl>');
  process.exit(2);
}
const text = readFileSync(file, 'utf8').trim();
const traces: EvalTrace[] = text.startsWith('[') ? JSON.parse(text) : text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
console.log(formatUsage(usageReport(traces)));
