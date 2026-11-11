// 05 · A graph when a chain is not enough
// Chains cannot branch. A graph can: here a second, masked exposure is added to the same negative,
// the way you burn the sky in at the enlarger. Open the Graph view afterwards to see the compiled IR.

const wb = bench('burn');
const g = wb.graph('burn the sky');

const src   = g.scene('still');
const neg   = g.film('kodak_portra_400').from(src);
const base  = g.enlarger({ print_exposure: 1.0 }).from(neg);                              // full-frame exposure
const sky   = g.mask('sky', (px) => smoothstep(0.7, 0.95, luma(px))).from(src);          // an eval λ over scene pixels, 0…1
const burn  = g.enlarger({ print_exposure: 0.35 }).from(neg).through(sky);                // same negative, light only where the mask is open
const sum   = g.sum('logH', base, burn);                                                  // light adds in linear exposure
const paper = g.paper('kodak_portra_endura').from(sum);
const out   = g.scan().from(paper);

const ir = g.compile(out);
log(String(ir.summary()));
log(ir.node('sky').source);                             // the λ's source travels with the IR
const ev = ir.eval('out', { w: 320 });
show(ev);
show(ev.at('logH'));                                    // the merged exposure is just another tap

const chain = bench('plain');
chain.pipe('default').scene('still').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();
log(String(ir.irDiff(chain.graph.of(chain.pipe('default')).compile())));
use(wb);
