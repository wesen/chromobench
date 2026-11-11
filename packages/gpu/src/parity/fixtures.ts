// The Gold 200 table configuration (guide §8): scanner xt5-fitted, Kodak Gold 200, Portra Endura, N = 33,
// built from @chromobench/core (CHB-017): the same tables the reference engine's tabulated mode uses.
import { exposeSettings, type ExposeSettings } from '@chromobench/core';
import { CorePhysics, type CurveRow } from '../physics/core.ts';
import { defaultPhysicsData } from '../physics/data.ts';
import type { SolveInputs, SpectralInputs, Vec3 } from '../tables/inputs.ts';

export interface Setup {
  physics: CorePhysics;
  film: string;
  paper: string;
  scanner: string;
  solve: SolveInputs;
  pd: SpectralInputs;
  print: SpectralInputs;
  /** print.expose with the catalog defaults: x = offset − pd(c). */
  expose: ExposeSettings;
  offset: Vec3;
  develop: CurveRow;
}

let physics: CorePhysics | null = null;

export function setup(film = 'kodak_gold_200', paper = 'kodak_portra_endura', scanner = 'xt5-fitted', N = 33): Setup {
  physics ??= new CorePhysics(defaultPhysicsData());
  const expose = exposeSettings({ paper, mode: 'normalised', lamp: 'TH-KG3', filtration: { c: 0, m: 0, y: 0 }, time_s: 10, fstop: 8, aim: 'grey-0.184', aimView: 'D50' }, film);
  const ex = physics.expose(expose, N);
  return {
    physics, film, paper, scanner, expose,
    solve: physics.solveInputs(film, scanner, N), pd: ex.pd, offset: ex.offset, print: physics.printInputs(paper, 'D50', N), develop: physics.developRow(paper, 2),
  };
}
