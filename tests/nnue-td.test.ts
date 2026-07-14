import { expect, test } from "vitest";
import { randomWeights, trainStep, loss, encodePosition } from "../js/nnue.ts";
import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";

test("TD step reduces loss on a labelled trajectory", () => {
  const w = randomWeights();
  const g = new Game();
  g.init(generateBoard());
  const batch = [
    { vec: encodePosition(g, FACTION.FIRE), label: 1 },
    { vec: encodePosition(g, FACTION.WATER), label: -1 },
  ];
  const before = loss(w, batch);
  for (let i = 0; i < 10; i++) trainStep(w, batch, 0.05);
  const after = loss(w, batch);
  expect(after).toBeLessThan(before);
});
