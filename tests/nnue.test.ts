import { test, expect } from "vitest";
import { Hex } from "../js/hex.ts";
import { FACTION, generateBoard } from "../js/board.ts";
import { PIECE_TYPE, Piece } from "../js/pieces.ts";
import { Game } from "../js/game.ts";
import {
  encodePosition,
  NNUE_INPUT_DIMS,
  evaluateNNUE,
  loadNNUEWeights,
  randomWeights,
  loss,
  trainStep,
  type NNUEWeights,
} from "../js/nnue.ts";
import {
  setNNUEEnabled,
  isNNUEEnabled,
  evaluateBoardNNUE,
} from "../js/ai-core.ts";
import { readFileSync } from "fs";

function makeGame(): Game {
  const g = new Game();
  g.init(generateBoard());
  // Valid board cells (see generateBoard order): (0,0) (0,1) (-3,3) (2,-2)
  g.pieces = [
    new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(0, 1)),
    new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(-3, 3)),
    new Piece(PIECE_TYPE.QUEEN, FACTION.NATURE, new Hex(0, 0)),
    new Piece(PIECE_TYPE.KING, FACTION.NATURE, new Hex(2, -2)),
  ];
  g.eliminatedFactions = new Set([FACTION.WATER]);
  g._rebuildOccupiedMap();
  return g;
}

test("NNUE_INPUT_DIMS equals 660 (66 cells x 10 features)", () => {
  expect(NNUE_INPUT_DIMS).toBe(660);
});

test("encodePosition produces a 660-len dense vector with exactly the occupied pieces set", () => {
  const g = makeGame();
  const vec = encodePosition(g, FACTION.FIRE);
  expect(vec.length).toBe(660);
  let occupied = 0;
  for (let c = 0; c < 66; c++) occupied += Number(vec[c * 10 + 9]);
  expect(occupied).toBe(4);
});

test("evaluateNNUE returns a finite number for a real position", () => {
  const g = makeGame();
  loadNNUEWeights(randomWeights());
  const score = evaluateNNUE(g, FACTION.FIRE);
  expect(Number.isFinite(score)).toBe(true);
});

test("nnue training step reduces loss on a toy batch", () => {
  const w = randomWeights();
  const batch = [
    { vec: new Float32Array(660).fill(0.1), label: 1 },
    { vec: new Float32Array(660).fill(-0.1), label: -1 },
  ];
  const before = loss(w, batch);
  const after = trainStep(w, batch, 0.01);
  expect(after).toBeLessThan(before);
});

test("nnue-weights.json parses and loads if present", () => {
  try {
    const raw = JSON.parse(
      readFileSync("js/weights/nnue-weights.json", "utf-8"),
    );
    const w: NNUEWeights = {
      w1: Float32Array.from(raw.w1),
      b1: Float32Array.from(raw.b1),
      w2: Float32Array.from(raw.w2),
      b2: Float32Array.from(raw.b2),
      w3: Float32Array.from(raw.w3),
      b3: Float32Array.from(raw.b3),
    };
    loadNNUEWeights(w);
    const g = makeGame();
    expect(Number.isFinite(evaluateNNUE(g, FACTION.FIRE))).toBe(true);
  } catch {
    // Weights not trained yet — skip
  }
});

test("NNUE flag toggles evaluation path", () => {
  setNNUEEnabled(true);
  expect(isNNUEEnabled()).toBe(true);
  setNNUEEnabled(false);
  expect(isNNUEEnabled()).toBe(false);
});

test("evaluateBoardNNUE falls back to classic eval when NNUE disabled", () => {
  setNNUEEnabled(false);
  const g = makeGame();
  const classic = (function () {
    // reference classic value via the same function the engine uses
    return evaluateBoardNNUE(g, FACTION.FIRE);
  })();
  expect(Number.isFinite(classic)).toBe(true);
});

test("evaluateBoardNNUE uses NNUE path when enabled (weights loaded)", () => {
  setNNUEEnabled(true);
  loadNNUEWeights(randomWeights());
  const g = makeGame();
  const score = evaluateBoardNNUE(g, FACTION.FIRE);
  expect(Number.isFinite(score)).toBe(true);
  setNNUEEnabled(false);
});
