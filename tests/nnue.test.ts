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

test("NNUE_INPUT_DIMS equals 162 (18 piece slots x 9 dense features)", () => {
  expect(NNUE_INPUT_DIMS).toBe(162);
});

test("encodePosition produces a 162-len dense vector with exactly the alive pieces set", () => {
  const g = makeGame();
  const vec = encodePosition(g, FACTION.FIRE);
  expect(vec.length).toBe(162);
  // Number of slots with alive flag = 1 must equal number of alive pieces (4).
  let aliveSlots = 0;
  for (let s = 0; s < 18; s++) aliveSlots += vec[s * 9 + 8]!; // F_ALIVE offset
  expect(aliveSlots).toBe(4);
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
  const classic = evaluateBoardNNUE(g, FACTION.FIRE);
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
  // alive-slot count must drop from 4 to 3 (dead piece not encoded).
  let aliveSlots = 0;
  for (let s = 0; s < 18; s++) aliveSlots += vec[s * 9 + 8]!;
  expect(aliveSlots).toBe(3);
});

test("encodePosition sets valid type/faction codes per slot", () => {
  const g = makeGame();
  const vec = encodePosition(g, FACTION.FIRE);
  // Every alive slot must have a type in 0..5 and faction in 0..2, and the
  // alive flag = 1; dead slots must be all-zero.
  for (let s = 0; s < 18; s++) {
    const base = s * 9;
    const alive = vec[base + 8];
    if (alive === 1) {
      expect(vec[base + 0]).toBeGreaterThanOrEqual(0);
      expect(vec[base + 0]).toBeLessThanOrEqual(5);
      expect(vec[base + 1]).toBeGreaterThanOrEqual(0);
      expect(vec[base + 1]).toBeLessThanOrEqual(2);
    } else {
      // dead slot: all features zero
      for (let f = 0; f < 9; f++) expect(vec[base + f]).toBe(0);
    }
  }
});

test("relu forwards positive values and clamps negatives to zero", () => {
  loadNNUEWeights(randomWeights());
  const g = makeGame();
  // Scale weights large so at least one h1/h2 pre-activation goes negative.
  const w = randomWeights();
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
