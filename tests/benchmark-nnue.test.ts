import { expect, test } from "vitest";
import { playGame } from "../scripts/benchmark-nnue.ts";
import { FACTION } from "../js/board.ts";

test("benchmark playGame returns a valid result without crashing", () => {
  const r = playGame(FACTION.FIRE, 2);
  expect(["win", "draw", "loss"]).toContain(r);
});
