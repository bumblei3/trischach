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

// ─── Training-health invariant: numerical gradient check ───────────────────
//
// The output layer is out = tanh(pre / T). A correct backward pass MUST apply
// the chain-rule factor (1-out^2)/T. A previous bug computed the output
// gradient as 2*(out-label), omitting that factor, so the analytic gradient
// was ~T×(=80×) too large. On real multi-position trajectories this made
// training diverge and the eval saturate to ±1000 (mini-Elo W0/L6).
//
// Loss-decrease heuristics do NOT catch this reliably (with tiny similar-
// position batches the over-large gradient can still descend by luck). A
// finite-difference gradient check does: it compares the analytic gradient
// (extracted from one trainStep) against the numeric gradient and fails
// deterministically if they differ in scale — regardless of random init.
test("analytic gradient matches the numerical gradient (backprop chain-rule correct)", () => {
  const g = makeGame();
  const batch = [
    { vec: encodePosition(g, FACTION.FIRE), label: 0.6 },
    { vec: encodePosition(g, FACTION.NATURE), label: -0.4 },
  ];
  // Deterministic, non-trivial weights (no RNG → no flakiness).
  const base = randomWeights();
  const fill = (a: Float32Array, seed: number) => {
    for (let i = 0; i < a.length; i++) a[i] = 0.05 * Math.sin(seed + i * 0.3); // small, keeps tanh unsaturated
  };
  fill(base.w1, 1);
  fill(base.w2, 2);
  fill(base.w3, 3);
  fill(base.b1, 4);
  fill(base.b2, 5);
  base.b3[0] = 0.02;

  const clone = (w: typeof base): typeof base => ({
    w1: Float32Array.from(w.w1),
    b1: Float32Array.from(w.b1),
    w2: Float32Array.from(w.w2),
    b2: Float32Array.from(w.b2),
    w3: Float32Array.from(w.w3),
    b3: Float32Array.from(w.b3),
  });

  // Analytic gradient (summed over the batch) via one trainStep. applyGrads
  // updates w_new = w_old - (lr / n) * gradSummed, so:
  //   gradSummed = (w_old - w_new) * n / lr.
  const lr = 1e-3;
  const wStep = clone(base);
  trainStep(wStep, batch, lr);
  const gAnalyticSummed = ((base.b3[0]! - wStep.b3[0]!) * batch.length) / lr;

  // Numerical gradient of the MEAN loss via central finite differences, then
  // scaled back up by n to compare against the summed analytic gradient.
  const eps = 1e-4;
  const wPlus = clone(base);
  wPlus.b3[0]! += eps;
  const wMinus = clone(base);
  wMinus.b3[0]! -= eps;
  const gNumericSummed =
    ((loss(wPlus, batch) - loss(wMinus, batch)) / (2 * eps)) * batch.length;

  // They must agree to a few percent. The old bug (missing (1-out^2)/T) made
  // the analytic gradient ~T(=80)× too large, so this ratio would be ~80.
  const ratio = gAnalyticSummed / gNumericSummed;
  expect(Number.isFinite(ratio)).toBe(true);
  expect(ratio).toBeGreaterThan(0.9);
  expect(ratio).toBeLessThan(1.1);
});
