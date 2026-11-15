// cb.help and cb.docs (guide §5.12): the reference from the registry, topics from Markdown pages
// bundled at generation time (topics.generated.ts), read the way goja-cv's cv.docs works.
import { getOp, hasOp, type OpDef } from '@chromobench/contract';
import type { DocsProvider } from '../host.ts';
import { dslOps, layerOps, suggest } from '../host.ts';
import { TOPICS, type Topic } from './topics.generated.ts';
import { VOCABULARY } from './vocabulary.ts';

export function opLine(op: OpDef): string {
  const args = Object.keys(op.args).join(', ');
  const out = op.returns === 'Image' || op.returns === 'Mask' ? op.domainOut ?? '' : 'value';
  const head = op.stages?.length && !op.name.includes('.') ? `layer('${op.name}', { ${args} }) in ${op.stages.join(', ')}` : `h.${op.name}({ ${args} }) → ${out}`;
  return `${head} — ${op.doc.split(/(?<=\.)\s/)[0]}`;
}

export function argLines(op: OpDef): string[] {
  return Object.entries(op.args).map(([n, s]) => {
    const bits = [s.type === 'enum' ? `enum ${(s.values ?? []).join('|')}` : s.type];
    if (s.unit && s.unit !== 'none') bits.push(s.unit);
    if (s.min !== undefined || s.max !== undefined) bits.push(`[${s.min ?? '-∞'}, ${s.max ?? '∞'}]`);
    if (s.default !== undefined) bits.push(`default ${JSON.stringify(s.default)}`);
    if (s.optional) bits.push('optional');
    return `  ${n}: ${bits.join(', ')} — ${s.doc}`;
  });
}

function sections(t: Topic): { title: string; body: string }[] {
  const out: { title: string; body: string }[] = [];
  let cur = { title: '', body: '' };
  for (const line of t.text.split('\n')) {
    const m = /^##\s+(.*)/.exec(line);
    if (m) {
      if (cur.body.trim() || cur.title) out.push(cur);
      cur = { title: m[1]!.trim(), body: '' };
    } else cur.body += `${line}\n`;
  }
  out.push(cur);
  return out;
}

export function docsProvider(topics: readonly Topic[] = TOPICS): DocsProvider {
  return {
    help(name) {
      if (name === null) {
        return ['Globals: cb, frame, units, mem, console; builders layer, group, mask, coll; changes set, insert, remove, move. Call cb.help("burn") for a layer op, cb.help("measure.stats") for a handle op, cb.docs.list() for topics.',
          'Vocabulary:', ...VOCABULARY.map((v) => `  ${v.call} — ${v.doc}`)].join('\n');
      }
      const voc = VOCABULARY.find((v) => v.name === name || v.call.startsWith(`${name}(`));
      if (voc) return `${voc.call} — ${voc.doc}`;
      if (hasOp(name)) {
        const op = getOp(name);
        return [opLine(op), ...argLines(op), ...(op.fields ? [`  returns: ${op.fields.map((f) => f.name).join(', ')}`] : [])].join('\n');
      }
      const names = [...dslOps().map((o) => o.name), ...layerOps().map((o) => o.name), ...VOCABULARY.map((v) => v.name)];
      const g = suggest(name, names);
      return `no entry "${name}"${g ? `; did you mean ${g}?` : ''}`;
    },
    docs(a) {
      const op = a['op'];
      if (op === 'list') return topics.map((t) => ({ id: t.id, title: t.title }));
      if (op === 'search') {
        const q = String(a['text'] ?? '').toLowerCase();
        const words = q.split(/\s+/).filter(Boolean);
        const hits: { id: string; section: string; line: string }[] = [];
        for (const t of topics) {
          for (const s of sections(t)) {
            const lines = s.body.split('\n');
            const hit = lines.find((l) => words.every((w) => l.toLowerCase().includes(w))) ?? (words.every((w) => s.title.toLowerCase().includes(w)) ? s.title : undefined);
            if (hit) hits.push({ id: t.id, section: s.title, line: hit.trim().slice(0, 160) });
          }
        }
        return hits.slice(0, 12);
      }
      if (op === 'read') {
        const t = topics.find((x) => x.id === a['id']);
        if (!t) {
          const g = suggest(String(a['id']), topics.map((x) => x.id));
          return `no topic "${String(a['id'])}"${g ? `; did you mean ${g}?` : ''}; cb.docs.list() lists them`;
        }
        const sec = a['section'];
        if (typeof sec === 'string') {
          const s = sections(t).find((x) => x.title.toLowerCase().includes(sec.toLowerCase()));
          return s ? `## ${s.title}\n${s.body.trim()}` : `no section "${sec}" in ${t.id}; sections: ${sections(t).map((x) => x.title).filter(Boolean).join(', ')}`;
        }
        return t.text;
      }
      return [];
    },
  };
}
