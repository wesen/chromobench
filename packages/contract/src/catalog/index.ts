// Registers the v0 catalog. Importing @chromobench/contract registers every op once.
import { registerOp, type OpDef } from '../registry.ts';
import { sourceOps, scanOps, invertOps } from './source-scan-invert.ts';
import { captureOps, filmOps, printOps } from './capture-film-print.ts';
import { viewOps, outputOps, maskOps } from './view-output-mask.ts';
import { measureOps, darkroomOps, finishingOps } from './measure-darkroom-finishing.ts';

export const CATALOG: readonly OpDef[] = [
  ...sourceOps, ...scanOps, ...invertOps, ...captureOps, ...filmOps, ...printOps,
  ...viewOps, ...outputOps, ...maskOps, ...measureOps, ...darkroomOps, ...finishingOps,
];

for (const op of CATALOG) registerOp(op);
