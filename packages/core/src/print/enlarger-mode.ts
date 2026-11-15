// The exposure between the enlarger's two modes (CHB-046, CHB-028 F44). Real mode fixes κ at the calibration pack and
// counts the optics (time, aperture, magnification); normalised mode takes κ at the current pack and ignores the
// optics, so the grey card prints at the aim whatever the time. For the same settings the two differ by one scalar
// log exposure, the same on every layer and every pixel (enlarger.ts):
//   shift = offset(real) − offset(normalised) = κ(calibration pack) − κ(current pack) + optics(t, N, m).
// A mode switch that adds it to the printer lights (real → normalised) or takes it off (normalised → real) keeps the
// print's density: the studio's switch (studio-kit modeSwitch) does that with this number.
import type { ExposeSettings, PhysicsEnv } from '../ops/ops.ts';

/** log H the real enlarger gives the paper beyond the normalised one, for a main exposure's settings (`mode` ignored). */
export function modeShiftLogH(env: PhysicsEnv, s: Omit<ExposeSettings, 'mode'>): number {
  const real = env.chain({ ...s, mode: 'real' }).enlarger.offset_logH;
  const normalised = env.chain({ ...s, mode: 'normalised' }).enlarger.offset_logH;
  return real - normalised;
}
