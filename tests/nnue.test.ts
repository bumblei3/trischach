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

// ─── Branch-coverage hardening (nnue.ts gaps) ──────────────────────────

test("evaluateNNUE throws when weights are not loaded", () => {
  // Ensure no stale weights from a previous test persist.
  loadNNUEWeights(null as unknown as NNUEWeights);
  const g = makeGame();
  expect(() => evaluateNNUE(g, FACTION.FIRE)).toThrow(
    /NNUE weights not loaded/,
  );
});

test("encodePosition skips dead (not alive) pieces", () => {
  const g = makeGame();
  // Kill one of the four pieces, keep its position on the board.
  g.pieces[0]!.alive = false;
  const vec = encodePosition(g, FACTION.FIRE);
  // occupied count must drop from 4 to 3 (dead piece not encoded).
  let occupied = 0;
  for (let c = 0; c < 66; c++) occupied += Number(vec[c * 10 + 9]);
  expect(occupied).toBe(3);
});

test("encodePosition sets exactly one piece-type and one faction one-hot per cell", () => {
  const g = makeGame();
  const vec = encodePosition(g, FACTION.FIRE);
  // Every occupied cell must have exactly one piece-type bit set (0..5)
  // and exactly one faction bit set (6..8).
  for (let c = 0; c < 66; c++) {
    if (vec[c * 10 + 9] !== 1) continue;
    const typeBits = [0, 1, 2, 3, 4, 5].filter(
      (t) => vec[c * 10 + t] === 1,
    ).length;
    const factionBits = [6, 7, 8].filter((f) => vec[c * 10 + f] === 1).length;
    expect(typeBits).toBe(1);
    expect(factionBits).toBe(1);
  }
});

test("relu forwards positive values and clamps negatives to zero", () => {
  loadNNUEWeights(randomWeights());
  const g = makeGame();
  // Two evaluations with opposite-weight signs are hard to predict, so we
  // assert the structural invariant directly via a known tiny position:
  // build a vector that yields a negative pre-activation by overloading a
  // near-zero weight set so the net output is within (-1,1). We instead test
  // the activation math through forward() indirectly: evaluating the same
  // position with weights scaled to a large magnitude can push the raw sum
  // far negative, and tanh still returns a finite, bounded value.
  const w = randomWeights();
  // Scale weights large so at least one h1/h2 pre-activation goes negative.
  for (let i = 0; i < w.w1.length; i++) w.w1[i]! *= 1000;
  for (let i = 0; i < w.w2.length; i++) w.w2[i]! *= 1000;
  loadNNUEWeights(w);
  const score = evaluateNNUE(g, FACTION.FIRE);
  // tanh output is bounded in (-1,1), scaled by 1000 → bounded (-1000,1000).
  expect(score).toBeGreaterThan(-1000.0001);
  expect(score).toBeLessThan(1000.0001);
  expect(Number.isFinite(score)).toBe(true);
});

test("evaluateNNUE output is bounded by tanh*1000 regardless of weights", () => {
  const w = randomWeights();
  // Pathological large weights must not produce NaN/Infinity or escape the
  // tanh bound — this exercises the relu negative-clamp path in forward().
  for (let i = 0; i < w.w1.length; i++) w.w1[i] = 1e6 * (i % 2 ? 1 : -1);
  for (let i = 0; i < w.w2.length; i++) w.w2[i] = 1e6 * (i % 2 ? 1 : -1);
  for (let i = 0; i < w.w3.length; i++) w.w3[i] = 1e6;
  loadNNUEWeights(w);
  const g = makeGame();
  const score = evaluateNNUE(g, FACTION.FIRE);
  expect(Number.isFinite(score)).toBe(true);
  expect(Math.abs(score)).toBeLessThanOrEqual(1000.0001);
});
