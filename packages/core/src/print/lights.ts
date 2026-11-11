// Printer lights: log-exposure offsets per paper layer (§2.6). 1 point = 0.025 log H (US 6,985,253).
// A density is refused (Hunt 14.17), as in Chromogen print.js Lights.shift (05-inline.js 809–819).
import { fail, HUNT_MESSAGE } from '@chromobench/contract';
import type { Vec3 } from '../spectral/linalg.ts';
import { toLogH, type Quantity } from '../spectral/units.ts';

import { LOGH_PER_POINT } from '../spectral/units.ts';

export class Lights {
  readonly logH: Vec3;
  private constructor(v: Vec3) {
    this.logH = [v[0], v[1], v[2]];
  }
  static fromLogH(v: ArrayLike<number>): Lights {
    return new Lights([v[0]!, v[1]!, v[2]!]);
  }
  static fromPoints(p: ArrayLike<number>): Lights {
    return new Lights([p[0]! * LOGH_PER_POINT, p[1]! * LOGH_PER_POINT, p[2]! * LOGH_PER_POINT]);
  }
  static zero(): Lights {
    return new Lights([0, 0, 0]);
  }
  points(): Vec3 {
    return this.logH.map((v) => v / LOGH_PER_POINT) as Vec3;
  }
  /** Accepts logH, point or stop; throws E_UNIT on a density. */
  shift(o: { R?: Quantity; G?: Quantity; B?: Quantity }): Lights {
    const v = this.logH.slice() as Vec3;
    (['R', 'G', 'B'] as const).forEach((k, i) => {
      const qv = o[k];
      if (!qv) return;
      if (qv.unit === 'D' || qv.unit === 'CC') fail('E_UNIT', `printer lights are log exposures; cannot shift by ${qv.unit} (${HUNT_MESSAGE})`);
      v[i] = v[i]! + toLogH(qv);
    });
    return new Lights(v);
  }
  plus(o: Lights): Lights {
    return new Lights([this.logH[0] + o.logH[0], this.logH[1] + o.logH[1], this.logH[2] + o.logH[2]]);
  }
  apply(x: ArrayLike<number>): Vec3 {
    return [x[0]! + this.logH[0], x[1]! + this.logH[1], x[2]! + this.logH[2]];
  }
}
