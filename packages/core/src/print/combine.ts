// The darkroom's light law on images (contract 1.0 print.combine, design §22). The per-pixel formula is the
// contract's lightH (packages/contract pixel.ts), shared with packages/gpu's WGSL; this module holds what the
// reference engine adds around it: the seconds ratio of a term in normalised mode.
//
// Every contribution (the main exposure, each burn, dodge and flash) is its own print.expose node, so its seconds
// and its pack are already in its x. In real mode that is the whole story (time is an exact log offset of the
// optics). In normalised mode print.expose ignores time (the grey card always prints at the aim), so a term of
// t_i seconds on a t_main main exposure is weighted r = t_i / t_main here.

/** The print.expose arguments combineRatio reads (a node's args). */
export interface ExposeArgsLike { mode?: unknown; time_s?: unknown }

/** Seconds ratio r of a term's print.expose relative to the main one: 1 in real mode, t_i / t_main in normalised mode. */
export function combineRatio(main: ExposeArgsLike | undefined, term: ExposeArgsLike | undefined): number {
  if (!main || !term || term.mode !== 'normalised') return 1;
  const tm = Number(main.time_s), te = Number(term.time_s);
  return tm > 0 && te > 0 ? te / tm : 1;
}
