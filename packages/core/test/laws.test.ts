// The textbook's laws (guide §8.2): each holds with n = 200 and each mutant is caught.
import { describe, expect, it } from 'vitest';
import { interimData } from '../src/index.ts';
import { ch1Laws } from '../src/laws/ch1.laws.ts';
import { ch2Laws } from '../src/laws/ch2.laws.ts';
import { checkLaws, checkMutants, type CoreLaw } from '../src/laws/harness.ts';

const data = interimData();
const suites: [string, () => CoreLaw[], number][] = [['chapter 1', () => ch1Laws(data), 200], ['chapter 2', () => ch2Laws(data), 200]];

for (const [name, make, n] of suites) {
  describe(`${name} laws`, () => {
    const suite = make();
    for (const l of suite) {
      it(`${l.name} holds (${l.section})`, () => {
        const [r] = checkLaws([l], { n, seed: 7 });
        expect(r!.ok, `${r!.message} at ${JSON.stringify(r!.shrunk)}`).toBe(true);
      });
      it(`${l.name} catches mutant "${l.mutant.name}"`, () => {
        const [m] = checkMutants([l], { n, seed: 7 });
        expect(m!.caught).toBe(true);
      });
    }
  });
}
