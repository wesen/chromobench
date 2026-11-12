// The offline demo model: a scripted assistant that runs a real grey balance on the open frame through the same
// loop, DSL session and approval cards as Claude would, without a network or a key. Each turn: measure and look
// at the centre of the print, then solve printer lights that neutralise it (in log exposure, half points) and
// propose them, then summarise from the numbers the evals returned.
import { lastToolResult, type ChatModel, type ModelReply, type ModelRequest, type ModelSink, type ScriptReply, ScriptedModel } from './model.ts';

export interface DemoOptions {
  /** the open frame's size, for the centre probe */
  size(): { width: number; height: number } | null;
  delayMs?: number;
}

const measure = (x: number, y: number): string => `// what does the centre of the print read now?
const at = [${x}, ${y}]
const d = await frame.print().measure.densitometer({ at, aperture_px: 15 })
frame.print().look('the print now')
return { at, D: d.D, visual: d.visual, lights_pt: units.toPt(frame.recipe.print.lights.logH) }`;

const balance = (x: number, y: number): string => `// printer lights that make the centre neutral: solve per layer in log exposure
const at = [${x}, ${y}]
const now = await frame.print().measure.densitometer({ at, aperture_px: 15 })
const probe = await frame.print({ lights: [0.05, 0.05, 0.05] }).measure.densitometer({ at, aperture_px: 15 })
const slope = now.D.map((d, k) => (probe.D[k] - d) / 0.05)
const mean = (now.D[0] + now.D[1] + now.D[2]) / 3
const pts = units.toPt(now.D.map((d, k) => (mean - d) / slope[k])).map(p => Math.round(p * 2) / 2)
const lights = units.pt(pts).map((v, k) => v + frame.recipe.print.lights.logH[k])
const e = frame.edit({ 'print.lights.logH': lights }, { why: \`neutral centre: \${pts.join(' / ')} pt\` })
const after = await e.preview.measure.densitometer({ at, aperture_px: 15 })
return { before: now.D, points: pts, after: after.D }`;

/** Tool results since the last plain user message (how far this turn is). */
function stepOfTurn(req: ModelRequest): number {
  let n = 0;
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i]!;
    if (m.role === 'assistant') n++;
    const fresh = m.role === 'user' && (typeof m.content === 'string' || m.content.some((b) => b.type === 'text' && !/^(context:|Step limit reached)/.test((b as { text: string }).text)));
    if (fresh) break;
  }
  return n;
}

export function demoModel(o: DemoOptions): ChatModel {
  const reply = (req: ModelRequest): ScriptReply => {
    const s = o.size();
    const x = Math.round((s?.width ?? 96) / 2);
    const y = Math.round((s?.height ?? 64) / 2);
    const step = stepOfTurn(req);
    if (!s) return { text: 'Open a negative first; then I can measure its print.' };
    if (step === 0) return { thinking: 'Measure the centre of the print and look at it before changing anything.', text: 'Let me measure the centre of the print and look at it.', evals: [{ code: measure(x, y) }] };
    if (step === 1) return { text: 'Now I solve printer lights that make the centre neutral, in log exposure, and propose them.', evals: [{ code: balance(x, y) }] };
    const last = lastToolResult(req);
    const pts = /points:\s*(\[[^\]]*\]|.*)/.exec(last)?.[1]?.trim();
    const decided = /\[the photographer ([^\]]*)\]/.exec(last)?.[1];
    return { text: `I proposed printer lights of ${pts ?? 'a few points'} (red / green / blue) to neutralise the centre.${decided ? ` You ${decided.replace(/^approved/, 'approved').replace(/: .*/, '')}.` : ' In auto mode they are applied; Revert undoes them.'} This is the scripted demo; connect Claude for real conversations.` };
  };
  const inner = new ScriptedModel([], { label: 'scripted demo', chunk: 6, record: false, ...(o.delayMs !== undefined ? { delayMs: o.delayMs } : { delayMs: 8 }), after: reply });
  return {
    label: 'scripted demo',
    send: (req: ModelRequest, sink: ModelSink, signal: AbortSignal): Promise<ModelReply> => inner.send(req, sink, signal),
  };
}
