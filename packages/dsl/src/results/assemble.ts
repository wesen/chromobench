// The text the agent reads (guide §5.10): value or error, edits, looks, console, warnings,
// context. Capped at 9000 characters; everything but the value is reserved, the value gets the
// rest (at least 2000) and is cut with a note.
import { EVAL_LIMITS, formatValue, type ContextBlock, type Diagnostic, type Look } from '@chromobench/contract';
import { fmtNum, fmtStr, renderYaml } from './yaml.ts';

export const MIN_VALUE_CHARS = 2000;

export interface AssembleInput {
  value?: unknown;
  error?: Diagnostic;
  errorWhere?: string;
  edits: string[];
  looks: Look[];
  console: string[];
  warnings: Diagnostic[];
  context: ContextBlock;
  cap?: number;
}

function numbersYaml(v: unknown): string[] {
  return renderYaml(v, { tableChars: 1500 }, 'numbers');
}

export function errorBlock(d: Diagnostic, where?: string): string[] {
  const out = ['error:', `  code: ${fmtStr(d.code)}`, `  message: ${fmtStr(d.message)}`];
  if (where) out.push(`  where: ${fmtStr(where)}`);
  if (d.path) out.push(`  path: ${fmtStr(d.path)}`);
  if (d.hint) out.push(`  hint: ${fmtStr(d.hint)}`);
  if (d.fix) out.push(`  fix: ${fmtStr(d.fix)}`);
  if (d.valid?.length) {
    const shown = d.valid.slice(0, 24);
    out.push(`  valid: [${shown.map(fmtStr).join(', ')}${d.valid.length > shown.length ? `, … ${d.valid.length - shown.length} more` : ''}]`);
  }
  return out;
}

function warningLine(w: Diagnostic): string {
  const where = w.where ? `line ${w.where.line}: ` : '';
  const extra = [w.hint ? `hint: ${w.hint}` : '', w.fix ? `fix: ${w.fix}` : ''].filter(Boolean).join('; ');
  return `  - ${fmtStr(`${w.code} ${where}${w.message}${extra ? ` (${extra})` : ''}`)}`;
}

export function contextLines(c: ContextBlock): string[] {
  const out = ['context:'];
  if (c.frame) out.push(`  frame: '${c.frame.replace(/'/g, "''")}'`); // untrusted names: always quoted
  else out.push(`  frame: none (mode ${c.mode})`);
  out.push(`  changed: ${c.changed.length ? fmtStr(c.changed.join(' · ')) : 'none'}`);
  if (c.proposals.length) out.push(`  proposals: ${fmtStr(c.proposals.join(' · '))}`);
  if (c.mem.length) out.push(`  mem: ${fmtStr(c.mem.join(', '))}`);
  if (c.functions.length) out.push(`  functions: ${fmtStr(c.functions.join(', '))}`);
  if (c.newFunctions.length) {
    out.push('  new functions: |-');
    for (const f of c.newFunctions) out.push(`    ${f}`);
  }
  return out;
}

export function assemble(inp: AssembleInput): { yaml: string; cut: boolean } {
  const cap = inp.cap ?? EVAL_LIMITS.yamlChars;
  const tail: string[] = [];
  if (inp.edits.length) tail.push('', 'edits:', ...inp.edits.map((e) => `  - ${fmtStr(e)}`));
  if (inp.looks.length) {
    tail.push('', 'looks:');
    for (const l of inp.looks) {
      tail.push(`  - look: ${fmtStr(`[look ${l.n}: ${l.caption}]`)}`);
      tail.push('    numbers:');
      for (const line of numbersYaml(l.numbers)) tail.push(`      ${line}`);
    }
  }
  if (inp.console.length) tail.push('', 'console:', ...inp.console.map((c) => `  - ${fmtStr(c)}`));
  const ctx = ['', ...contextLines(inp.context)];
  let head: string[];
  let cut = false;
  const warnings = [...inp.warnings];
  const warnBlock = (): string[] => (warnings.length ? ['', 'warnings:', ...warnings.map(warningLine)] : []);
  if (inp.error) {
    head = errorBlock(inp.error, inp.errorWhere);
  } else if (inp.value === undefined || (typeof inp.value === 'object' && inp.value !== null && '__undef' in inp.value)) {
    head = ['# nothing returned: end the code with return …'];
  } else {
    const reserved = [...tail, ...warnBlock(), ...ctx].join('\n').length + 160;
    const budget = Math.max(MIN_VALUE_CHARS, cap - reserved);
    head = renderYaml(inp.value, { tableChars: Math.floor((budget * 2) / 3) }, 'rows');
    const total = head.join('\n').length;
    if (total > budget) {
      const kept: string[] = [];
      let n = 0;
      for (const l of head) {
        if (n + l.length + 1 > budget) break;
        kept.push(l);
        n += l.length + 1;
      }
      kept.push(`# CUT: ${n} of ${total} characters shown; return less, or page the array`);
      head = kept;
      cut = true;
      warnings.push({ code: 'CUT', message: `the returned value was cut to ${n} of ${total} characters` });
    }
  }
  const yaml = [...head, ...tail, ...warnBlock(), ...ctx].join('\n');
  return { yaml, cut };
}

/** "set print.lights.logH = [-0.1125, -0.0125, 0.125] (was [0, 0, 0])" */
export function describeMutation(m: { op: string; path?: string; value?: unknown; exposure?: Record<string, unknown>; id?: string }, was: unknown): string {
  switch (m.op) {
    case 'set': return `set ${m.path} = ${formatValue(m.value)}${was !== undefined ? ` (was ${formatValue(was)})` : ''}`;
    case 'exposure.add': {
      const e = m.exposure ?? {};
      const bits = Object.entries(e).filter(([k, v]) => k !== 'id' && v !== null && v !== undefined).map(([k, v]) => `${k} ${typeof v === 'number' ? fmtNum(v) : formatValue(v)}`);
      return `exposure.add ${String(e['id'])} (${bits.join(', ')})`;
    }
    case 'exposure.remove': return `exposure.remove ${m.id}`;
    case 'mask.set': return `mask.set ${m.id}`;
    default: return m.op;
  }
}
