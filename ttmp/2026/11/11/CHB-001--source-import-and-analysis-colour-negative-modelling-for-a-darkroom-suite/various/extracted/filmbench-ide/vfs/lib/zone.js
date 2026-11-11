// lib/zone.js — a fragment: talk in zones.
// It adds parameters, a macro that measures the picture, a lens, a tile and a note for the agent, in one place:
//   zone.target / zone.probe   where a probe should land, and which probe
//   place                      a macro that renders, measures the probe's L*, and moves camera.ev to put it there
//   zones (lens)               posterises L* into zones so a tile shows the zone map
//   zone histogram (tile)      L* histogram with zone bands
// 'place' is an async apply with phase 'run': it measures by rendering, so it only runs when you let go of the slider.
export const zoneSystem = fragment('zoneSystem', {
  extends: ['ctl', 'ws', 'agent'],

  params: {
    target: p.stepper({ min: 0, max: 10, value: 5, path: 'zone.target' }),
    probe:  p.choice({ of: 'probes', value: 'skin', path: 'zone.probe' }),
  },

  macros: {
    place: (m) => m.apply(async (z, P, ctx) => {
      const L = await ctx.measure(P.zone.probe, ({ out }, pr) => out.crop(pr).lab().mean()[0]);
      return { 'camera.ev': op.add(z - zoneOf(L)) };               // one zone is one stop
    }, { phase: 'run' }),
  },

  lenses: { zones: lens.zones({ n: 11 }) },
  tiles:  { 'zone histogram': (w) => w.hist('out', { channel: 'L*', bands: 'zones' }) },

  decorate: { 'ctl:camera.ev': (c) => c.fmt((v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)} EV`) },

  methods: { placeSkin(z) { this.set('zone.probe', 'skin').set('zone.target', z); } },
  agent:   { brief: 'The user may talk in zones (0 black … 10 white, 5 middle grey). Place a probe and measure it before you quote an EV number.' },
});
