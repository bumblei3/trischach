import { expect, test } from "vitest";
import { playGame } from "../scripts/benchmark-nnue.ts";
import { FACTION } from "../js/board.ts";
import { randomWeights } from "../js/nnue.ts";

test("benchmark playGame returns a valid result without crashing", () => {
  // Pass explicit random weights so the smoke test does not depend on
  // trained disk weights (and stays shape-compatible after encoding changes).
  const r = playGame(FACTION.FIRE, 2, randomWeights(), 30);
  expect(["win", "draw", "loss"]).toContain(r);
});
