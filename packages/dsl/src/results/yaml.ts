// Deterministic YAML for the agent (guide §5.10). No dependency: the format is part of the
// contract with the model, so every byte is decided here. Values arrive "shaped" by the prelude:
// handles as {__h}, functions as {__fn}, shown images as {__show}, non-finite numbers as {__num},
// undefined as {__undef}.
//
// Compact tables follow goja-cv pkg/cvsession/tables.go: an array of ≥ 2 flat records renders as
// a literal block with a header line (union of keys) and one line per record.

export const MIN_TABLE_ROWS = 5;

/** At most five significant digits, trailing zeros dropped; integers print exactly. */
export function fmtNum(x: number): string {
  if (Object.is(x, -0) || x === 0) return '0';
  if (Number.isInteger(x) && Math.abs(x) < 1e15) return String(x);
  const v = Number(x.toPrecision(5));
  return Object.is(v, -0) ? '0' : String(v);
}

const RESERVED = /^(true|false|null|yes|no|on|off|~|y|n)$/i;

export function fmtStr(s: string): string {
  if (s === '') return "''";
  const plain = /^[A-Za-z_./#\[\]][\w .\-/#()×→·=,+]*$/.test(s) && !RESERVED.test(s) && !/[ ]$/.test(s) && !s.startsWith('[') && !/: |\s#/.test(s);
  if (plain && !/^[-?:,\[\]{}#&*!|>'"%@`]/.test(s)) return s;
  return `'${s.replace(/'/g, "''")}'`;
}

function fmtKey(k: string): string {
  return /^[A-Za-z_$][\w$.\-]*$/.test(k) && !RESERVED.test(k) ? k : `'${k.replace(/'/g, "''")}'`;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A shaped leaf: anything that prints on one line. */
function special(v: Record<string, unknown>): string | undefined {
  if ('__h' in v) return fmtStr(String(v['__h']));
  if ('__num' in v) return String(v['__num']);
  if ('__undef' in v) return '~';
  if ('__show' in v) return fmtStr(`[image ${String(v['__show'])}: ${String(v['caption'] ?? '')}]`);
  if ('__err' in v) return fmtStr(String(v['__err']));
  if ('__fn' in v) {
    const f = v['__fn'] as { name: string; src: string };
    return fmtStr(`[function ${signature(f.name, f.src)}]`);
  }
  return undefined;
}

function isScalar(v: unknown): boolean {
  return v === null || typeof v !== 'object' || (isObj(v) && special(v) !== undefined);
}

function scalar(v: unknown): string {
  if (v === null) return '~';
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return v.includes('\n') ? fmtStr(v.replace(/\n/g, '\\n')) : fmtStr(v);
  if (isObj(v)) return special(v) ?? '{}';
  return fmtStr(String(v));
}

function flowScalarArray(a: unknown[]): string {
  return `[${a.map(scalar).join(', ')}]`;
}

const isFlatArray = (v: unknown): v is unknown[] => Array.isArray(v) && v.every(isScalar);

/** A cell of a compact table: a scalar or a flat array of scalars. */
function isCell(v: unknown): boolean {
  return isScalar(v) || (isFlatArray(v) && (v as unknown[]).length <= 8);
}

export function isTable(v: unknown): v is Record<string, unknown>[] {
  return Array.isArray(v) && v.length >= 2 && v.every((r) => isObj(r) && special(r) === undefined && Object.values(r).every(isCell));
}

export interface TableBudget {
  /** Characters still available to tables in this result. */
  chars: number;
}

/** Renders a table as lines (no indentation). Cuts rows to the budget, never below MIN_TABLE_ROWS. */
export function tableLines(rows: Record<string, unknown>[], budget: TableBudget, path: string): string[] {
  const keys: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  const cell = (v: unknown): string => (v === undefined ? '' : isFlatArray(v) ? flowScalarArray(v) : scalar(v));
  const cells = rows.map((r) => keys.map((k) => cell(r[k])));
  const widths = keys.map((k, i) => Math.max(k.length, ...cells.map((c) => c[i]!.length)));
  const line = (c: string[]): string => c.map((x, i) => (i === c.length - 1 ? x : x.padEnd(widths[i]!))).join('  ').trimEnd();
  const out = [line(keys)];
  let used = out[0]!.length + 1;
  let shown = 0;
  for (const c of cells) {
    const l = line(c);
    if (shown >= MIN_TABLE_ROWS && used + l.length + 1 > budget.chars) break;
    out.push(l);
    used += l.length + 1;
    shown++;
  }
  budget.chars -= used;
  if (shown < rows.length) out.push(`… rows 1–${shown} of ${rows.length} shown. Next: ${path}.slice(${shown}, ${2 * shown})`);
  return out;
}

export interface RenderOptions {
  /** Characters all tables in this result may share. */
  tableChars: number;
}

/** Renders a shaped value as YAML lines. `path` names the value for paging hints. */
export function renderYaml(v: unknown, opts: RenderOptions, rootName = 'rows'): string[] {
  const budget: TableBudget = { chars: opts.tableChars };
  const join = (path: string, k: string): string => (path ? `${path}.${k}` : k);
  const out: string[] = [];
  const emit = (val: unknown, indent: string, path: string): void => {
    if (isTable(val)) {
      out.push(`${indent}|`);
      for (const l of tableLines(val, budget, path || rootName)) out.push(`${indent}  ${l}`);
      return;
    }
    out.push(...block(val, indent, path));
  };
  const block = (val: unknown, indent: string, path: string): string[] => {
    const lines: string[] = [];
    if (isScalar(val)) {
      const s = typeof val === 'string' && val.includes('\n') ? null : scalar(val);
      if (s !== null) return [`${indent}${s}`];
      lines.push(`${indent}|-`);
      for (const l of (val as string).split('\n')) lines.push(`${indent}  ${l}`);
      return lines;
    }
    if (Array.isArray(val)) {
      if (val.length === 0) return [`${indent}[]`];
      if (isFlatArray(val)) {
        const f = flowScalarArray(val);
        if (f.length + indent.length <= 100) return [`${indent}${f}`];
      }
      val.forEach((item, i) => {
        if (isScalar(item) || (isFlatArray(item) && flowScalarArray(item).length < 90)) {
          lines.push(`${indent}- ${isScalar(item) ? scalar(item) : flowScalarArray(item as unknown[])}`);
          return;
        }
        const sub: string[] = [];
        const saved = out.length;
        emitInto(sub, item, `${indent}  `, `${path || rootName}[${i}]`);
        void saved;
        sub[0] = `${indent}- ${sub[0]!.slice(indent.length + 2)}`;
        lines.push(...sub);
      });
      return lines;
    }
    const o = val as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 0) return [`${indent}{}`];
    for (const k of keys) {
      const x = o[k];
      const key = `${indent}${fmtKey(k)}:`;
      if (isScalar(x) && !(typeof x === 'string' && x.includes('\n'))) {
        lines.push(`${key} ${scalar(x)}`);
      } else if (isFlatArray(x) && x.length > 0 && flowScalarArray(x).length + key.length < 100) {
        lines.push(`${key} ${flowScalarArray(x)}`);
      } else if (typeof x === 'string') {
        lines.push(`${key} |-`);
        for (const l of x.split('\n')) lines.push(`${indent}  ${l}`);
      } else if (isTable(x)) {
        lines.push(`${key} |`);
        for (const l of tableLines(x, budget, join(path, k))) lines.push(`${indent}  ${l}`);
      } else if ((Array.isArray(x) && x.length === 0) || (isObj(x) && Object.keys(x).length === 0)) {
        lines.push(`${key} ${Array.isArray(x) ? '[]' : '{}'}`);
      } else {
        lines.push(key);
        const sub: string[] = [];
        emitInto(sub, x, `${indent}  `, join(path, k));
        lines.push(...sub);
      }
    }
    return lines;
  };
  const emitInto = (sink: string[], val: unknown, indent: string, path: string): void => {
    if (isTable(val)) {
      sink.push(`${indent}|`);
      for (const l of tableLines(val, budget, path || rootName)) sink.push(`${indent}  ${l}`);
      return;
    }
    sink.push(...block(val, indent, path));
  };
  emit(v, '', '');
  return out;
}

/**
 * Signature and doc line of a function from its source (port of goja-cv describe.go 11–20,
 * 213–235): the parameter list, and the comment that opens the body, cut at 120 characters.
 */
export function signature(name: string, src: string): string {
  return `${name}(${params(src)})`;
}

export function params(src: string): string {
  const s = src.trim();
  let i = 0;
  if (s.startsWith('async')) i = 5;
  const rest = s.slice(i).trimStart();
  const arrowSingle = /^([A-Za-z_$][\w$]*)\s*=>/.exec(rest);
  if (arrowSingle) return arrowSingle[1]!;
  const open = s.indexOf('(');
  if (open < 0) return '';
  let depth = 0;
  for (let j = open; j < s.length; j++) {
    const c = s[j];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return s.slice(open + 1, j).replace(/\s+/g, ' ').trim();
    }
  }
  return '';
}

export function docLine(src: string): string {
  const s = src.trim();
  // body start: the first '{' after the parameter list (arrow or function)
  const p = params(s);
  const pIdx = p ? s.indexOf(p) + p.length : 0;
  const brace = s.indexOf('{', pIdx);
  if (brace < 0) return '';
  const body = s.slice(brace + 1).replace(/^[ \t]*/, '');
  let doc = '';
  const lineDoc = /^\s*\/\/\s?(.*)/.exec(body);
  const blockDoc = /^\s*\/\*\s*([\s\S]*?)\*\//.exec(body);
  if (lineDoc && body.trimStart().startsWith('//')) doc = lineDoc[1]!.trim();
  else if (blockDoc) doc = blockDoc[1]!.replace(/\s*\n\s*\*?\s*/g, ' ').trim();
  return [...doc].length > 120 ? `${[...doc].slice(0, 119).join('')}…` : doc;
}
