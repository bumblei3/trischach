import { expect, test, describe } from "vitest";
import {
  eloFromScore,
  scoreFromWDL,
  describeArch,
} from "../scripts/nnue-common.ts";

describe("eloFromScore / scoreFromWDL", () => {
  test("even score is ~0 Elo", () => {
    expect(eloFromScore(0.5)).toBe(0);
    expect(scoreFromWDL(10, 0, 10)).toBe(0.5);
  });

  test("draws count as half points", () => {
    expect(scoreFromWDL(0, 10, 0)).toBe(0.5);
    expect(scoreFromWDL(5, 10, 5)).toBe(0.5);
  });

  test("high win rate maps to positive Elo", () => {
    expect(eloFromScore(0.75)).toBeGreaterThan(100);
    expect(eloFromScore(0.25)).toBeLessThan(-100);
  });

  test("describeArch mentions dimensions", () => {
    expect(describeArch()).toMatch(/NNUE \d+→/);
  });
});
