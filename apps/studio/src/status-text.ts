// The status line in the photographer's words (CHB-027 F9). The host's engine label and decode notes are written
// for developers ("reference · CPU f64 (no WebGPU: E_EVAL: no GPU adapter) · 512 px", "W_NO_OPEN_GATE: …"); the
// status line shows a short summary and keeps the technical text as its tooltip. Reads only the strings that
// engines.ts and the shell already produce, so nothing upstream changes.

/** "Fast (graphics card)" or "Compatibility mode: slower (no WebGPU)" for the host's engine label */
export function engineSummary(label: string): string {
  if (/^mock/i.test(label)) return 'Preview only (no film physics)';
  if (/^GPU/.test(label)) return /\(software\)/.test(label) ? 'Graphics card emulated in software: slower' : 'Fast (graphics card)';
  if (/^reference/.test(label)) return /no WebGPU/.test(label) ? 'Compatibility mode: slower (no WebGPU)' : 'Compatibility mode: slower';
  return label;
}

/** the engine's tooltip: what it means first, the technical label second (CHB-031 F9) */
export function engineTip(label: string): string {
  const what = /^mock/i.test(label)
    ? 'A preview without the film and paper model.'
    : /^GPU/.test(label)
      ? /\(software\)/.test(label) ? 'The prints are computed by a graphics card that this browser emulates in software, so it is slower.' : 'The prints are computed on the graphics card.'
      : /^reference/.test(label)
        ? `The prints are computed on the processor, which is slower${/no WebGPU/.test(label) ? ': this browser offers no graphics card to compute on' : ''}. Pictures are previewed smaller.`
        : '';
  return `${what ? `${what}\n` : ''}Technical: ${label}`;
}

/** the decode notes' tooltip: the summary first, the decoder's own notes second (CHB-031 F9) */
export function notesTip(notes: readonly string[]): string {
  if (!notes.length) return '';
  const sum = notesSummary(notes);
  const how = /via LibRaw/.test(notes[0]!) ? (/^photo:/.test(notes[0]!) ? 'Developed from the camera RAW with its own colour.' : 'Read from the camera RAW without developing it, as a scan.') : '';
  return `${sum}${how ? `. ${how}` : ''}\nTechnical: ${notes.join(' · ')}`;
}

/**
 * The render passes in plain words (CHB-031 F35): a draft is the quick preview while a control moves, a screen pass
 * the finished picture at the window's size, a refine pass the finished picture at full detail where it is zoomed.
 */
const PASS_WORDS: Record<string, string> = { draft: 'quick preview', screen: 'done', refine: 'done, full detail' };
export const passWords = (pass: string): string => PASS_WORDS[pass] ?? pass;

/**
 * An error's text without its codes (E_EVAL, W_NO_SURROUND, CB-H401, CK-T440): the plain line of the status bar.
 * The codes stay in the "Technical:" line of the tooltip (CHB-031 F35).
 */
export function plainError(text: string): string {
  const s = text
    .replace(/\b[EW]_[A-Z0-9_]+\b:?\s*/g, '')
    .replace(/\b[A-Z]{2}-[A-Z]\d{3}\b:?\s*/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return s || 'something went wrong';
}

/**
 * The open-mode guess's reason (ingest's noun phrase: "no orange mask and no film edge") as a sentence (CHB-031 F35:
 * the tooltip read "The picture no orange mask and no film edge.").
 */
export function guessWhy(why: string, capital = true): string {
  const w = why.replace(/^film edge\b/, 'a film edge');
  const s = /^too dark\b/.test(w) ? `the picture is ${w}.` : `the picture shows ${w}.`;
  return capital ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const mp = (w: number, h: number): string => {
  const m = (w * h) / 1e6;
  if (m < 0.1) return `${w}×${h} px`;
  return m >= 10 ? `${Math.round(m)} MP` : `${Number(m.toFixed(1))} MP`;
};
const size = (s: string): { w: number; h: number } | null => {
  const m = /(\d+)×(\d+)/.exec(s);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
};

/**
 * One line for a frame's decode notes (the host's strings, in order): "Nikon D750 photo, 24 MP",
 * "Colour negative (Nikon D750 RAW), 6 MP, film edge found", "Colour negative (TIFF), 6 MP, no film edge found".
 * An empty list gives ''.
 */
export function notesSummary(notes: readonly string[]): string {
  if (!notes.length) return '';
  const first = notes[0]!;
  const sz = size(first);
  const px = sz ? `, ${mp(sz.w, sz.h)}` : '';
  const cam = /\(([^)]+)\) via LibRaw/.exec(first)?.[1];
  const fmt = /^(?:photo: )?([A-Z]{3,4}) \d+×\d+/.exec(first)?.[1];
  if (/^photo:/.test(first)) return `${cam ?? fmt ?? 'Digital'} photo${px}`;
  const parts = [`Colour negative (${cam ? `${cam} RAW` : fmt ?? 'scan'})${px}`];
  if (notes.some((n) => /^base .* D \(rebate/.test(n))) parts.push('film edge found');
  else if (notes.some((n) => /^no rebate found/.test(n))) parts.push('no film edge found');
  const dust = notes.map((n) => /^dust: (\d+) specks/.exec(n)?.[1]).find((x) => x !== undefined);
  if (dust && dust !== '0') parts.push(`${dust} dust specks healed`);
  // no film edge, no open gate and no surround: what a photo opened as a negative looks like
  const missing = ['W_NO_OPEN_GATE', 'W_NO_SURROUND', 'W_REBATE_BLANK'].filter((c) => notes.some((n) => n.startsWith(`${c}:`))).length;
  if (missing >= 2 && notes.some((n) => /^no rebate found/.test(n))) parts.push('it may be a photo, not a negative');
  return parts.join(', ');
}
