/**
 * JS-NNUE Evaluation — neuronales Netz in reinem JS (kein WASM).
 *
 * Input-Encoding: PIECE-CENTRIC (dense, always fully populated). Instead of a
 * 660-D one-hot over 66 cells (only ~4 cells ever occupied → sparse, dead
 * hidden layer), we encode up to MAX_PIECES pieces, each as a dense feature
 * vector (type, faction, coords, king distances, promo, material, alive,
 * RPS advantage, local support, RPS-pressure). Alive pieces are sorted for a
 * stable slot order. Empty slots stay zero.
 *
 * Netz: NNUE_INPUT_DIMS → 128 (ReLU) → 32 (ReLU) → 1 (tanh × 1000 / T).
 * Inference via Float32Array MatMul (~0.02ms/Eval).
 *
 * Training: offline TD self-play (`scripts/train-nnue-td.ts`) + benchmark gate.
 * Weights: `public/js/weights/nnue-weights.json` (copied to dist on build).
 */

import { FACTION, getRPSResult } from "./board.ts";
import type { Faction, IGame, Piece } from "./types.ts";
import { Hex } from "./hex.ts";

// Piece-centric dense encoding. Every occupied slot has alive=1 so the net
// always receives real signal for living pieces.
const MAX_PIECES = 18;
export const FEATURES_PER_PIECE = 12;
// feature offsets within a slot
const F_TYPE = 0; // 0..5 (king..pawn)
const F_FACTION = 1; // 0..2
const F_Q = 2; // q normalised to [-1,1]  (q range -7..7)
const F_R = 3; // r normalised to [-1,1]  (r range -7..7)
const F_OWNKING = 4; // distance to own king, normalised [0,1] (0=on king)
const F_ENEMYKING = 5; // distance to nearest enemy king, normalised [0,1]
const F_PROMO = 6; // 1 if on its last promotion rank, else 0
const F_MATERIAL = 7; // material value normalised [-1,1]
const F_ALIVE = 8; // always 1 for occupied slots
const F_RPS = 9; // mean RPS advantage of piece's faction vs remaining enemies
const F_SUPPORT = 10; // friendly pieces within dist≤2, /6
const F_PRESSURE = 11; // RPS-aware local pressure vs nearby enemies, /4
export const NNUE_INPUT_DIMS = MAX_PIECES * FEATURES_PER_PIECE;
const H1 = 128;
const H2 = 32;
export const NNUE_H1 = H1;
export const NNUE_H2 = H2;
// Temperature: keeps the output pre-activation in the near-linear tanh region.
// Shared by forward AND backward — the backward pass MUST divide the output
// gradient by T (and multiply by the tanh derivative), otherwise the gradient
// is ~T× too large and training diverges (loss goes UP, weights saturate tanh
// to ±1 → every eval collapses to ±1000). See backward().
const T = 80;
const PIECE_TYPES = [
  "king",
  "queen",
  "rook",
  "bishop",
  "knight",
  "pawn",
] as const;
const FACTIONS = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE] as const;
const MATERIAL: Record<string, number> = {
  king: 0,
  queen: 1,
  rook: 0.5,
  bishop: 0.33,
  knight: 0.33,
  pawn: 0.1,
};
// Promotion rank per faction (last rank the pawn reaches). Mirrors isPromotionCell.
function promoRank(faction: Faction): number {
  if (faction === FACTION.FIRE) return -2;
  if (faction === FACTION.WATER) return -7;
  return 2; // nature
}
export interface NNUEWeights {
  w1: Float32Array; // [H1 × NNUE_INPUT_DIMS]
  b1: Float32Array; // [H1]
  w2: Float32Array; // [H2 × H1]
  b2: Float32Array; // [H2]
  w3: Float32Array; // [1 × H2]
  b3: Float32Array; // [1]
}

let WEIGHTS: NNUEWeights | null = null;

/** Expected w1 length for the current architecture (guards stale weight files). */
export function expectedW1Length(): number {
  return H1 * NNUE_INPUT_DIMS;
}

export function assertWeightShapes(w: NNUEWeights): void {
  if (w.w1.length !== H1 * NNUE_INPUT_DIMS) {
    throw new Error(
      `NNUE w1 length ${w.w1.length} != expected ${H1 * NNUE_INPUT_DIMS} (encoding v2 / ${FEATURES_PER_PIECE} feats)`,
    );
  }
  if (w.b1.length !== H1 || w.w2.length !== H2 * H1 || w.b2.length !== H2) {
    throw new Error("NNUE hidden-layer weight shapes mismatch");
  }
  if (w.w3.length !== H2 || w.b3.length !== 1) {
    throw new Error("NNUE output-layer weight shapes mismatch");
  }
}

export function loadNNUEWeights(w: NNUEWeights): void {
  assertWeightShapes(w);
  WEIGHTS = w;
}

/** Clear loaded weights (tests). */
export function clearNNUEWeights(): void {
  WEIGHTS = null;
}

function rpsMeanAdvantage(faction: Faction, livingFactions: Faction[]): number {
  let sum = 0;
  let n = 0;
  for (const other of livingFactions) {
    if (other === faction) continue;
    const r = getRPSResult(faction, other);
    sum += r === "advantage" ? 1 : r === "disadvantage" ? -1 : 0;
    n++;
  }
  return n > 0 ? sum / n : 0;
}

function localSupport(piece: Piece, alive: Piece[]): number {
  let c = 0;
  for (const o of alive) {
    if (o === piece || o.faction !== piece.faction) continue;
    if (piece.pos.distance(o.pos) <= 2) c++;
  }
  return Math.min(1, c / 6);
}

/** RPS-aware pressure: nearby enemies we beat (+) vs enemies that beat us (−). */
function localPressure(piece: Piece, alive: Piece[]): number {
  let s = 0;
  for (const o of alive) {
    if (o.faction === piece.faction) continue;
    if (piece.pos.distance(o.pos) > 2) continue;
    const r = getRPSResult(piece.faction, o.faction);
    s += r === "advantage" ? 1 : r === "disadvantage" ? -1 : 0;
  }
  return Math.max(-1, Math.min(1, s / 4));
}

function sortPiecesStable(alive: Piece[]): Piece[] {
  return alive.slice().sort((a, b) => {
    const fa = FACTIONS.indexOf(a.faction);
    const fb = FACTIONS.indexOf(b.faction);
    if (fa !== fb) return fa - fb;
    const ta = PIECE_TYPES.indexOf(a.type as (typeof PIECE_TYPES)[number]);
    const tb = PIECE_TYPES.indexOf(b.type as (typeof PIECE_TYPES)[number]);
    if (ta !== tb) return ta - tb;
    if (a.pos.q !== b.pos.q) return a.pos.q - b.pos.q;
    return a.pos.r - b.pos.r;
  });
}

export function encodePosition(
  game: IGame,
  perspective: Faction,
): Float32Array {
  const vec = new Float32Array(NNUE_INPUT_DIMS);
  const alive = sortPiecesStable(game.pieces.filter((p) => p.alive));
  const livingFactions = FACTIONS.filter((f) =>
    alive.some((p) => p.faction === f),
  );
  // King positions per faction (for distance features).
  const kingPos: Partial<Record<string, Hex>> = {};
  for (const p of alive) {
    if (p.type === "king") kingPos[p.faction] = p.pos;
  }
  const n = Math.min(alive.length, MAX_PIECES);
  for (let s = 0; s < n; s++) {
    const p = alive[s]!;
    const base = s * FEATURES_PER_PIECE;
    const ti = PIECE_TYPES.indexOf(p.type as (typeof PIECE_TYPES)[number]);
    const fi = FACTIONS.indexOf(p.faction);
    // Perspective-relative sign: own pieces positive, enemy negative.
    // Without this the eval is perspective-blind (~-800 Elo in search).
    const sign = p.faction === perspective ? 1 : -1;
    vec[base + F_TYPE] = ti >= 0 ? ti : 0;
    vec[base + F_FACTION] = fi >= 0 ? fi : 0;
    vec[base + F_Q] = sign * Math.max(-1, Math.min(1, p.pos.q / 7));
    vec[base + F_R] = sign * Math.max(-1, Math.min(1, p.pos.r / 7));
    const ok = kingPos[p.faction];
    vec[base + F_OWNKING] = ok
      ? Math.max(0, Math.min(1, ok.distance(p.pos) / 12))
      : 0;
    let dk = 12;
    for (const f of FACTIONS) {
      if (f === p.faction) continue;
      const ek = kingPos[f];
      if (ek) dk = Math.min(dk, ek.distance(p.pos));
    }
    vec[base + F_ENEMYKING] = Math.max(0, Math.min(1, dk / 12));
    vec[base + F_PROMO] = p.pos.r === promoRank(p.faction) ? 1 : 0;
    vec[base + F_MATERIAL] = sign * (MATERIAL[p.type] ?? 0);
    vec[base + F_ALIVE] = 1;
    vec[base + F_RPS] = sign * rpsMeanAdvantage(p.faction, livingFactions);
    vec[base + F_SUPPORT] = sign * localSupport(p, alive);
    vec[base + F_PRESSURE] = sign * localPressure(p, alive);
  }
  return vec;
}

function relu(x: number): number {
  return x > 0 ? x : 0;
}

// Forward pass — returns { out, h1, h2 } for training (keeps activations).
// `out` is in tanh-space (-1..1); inference scales by 1000.
function forward(
  w: NNUEWeights,
  x: Float32Array,
): { out: number; h1: Float32Array; h2: Float32Array } {
  const h1 = new Float32Array(H1);
  for (let i = 0; i < H1; i++) {
    let s = w.b1[i]!;
    const off = i * NNUE_INPUT_DIMS;
    for (let j = 0; j < NNUE_INPUT_DIMS; j++) s += w.w1[off + j]! * x[j]!;
    h1[i] = relu(s);
  }
  const h2 = new Float32Array(H2);
  for (let i = 0; i < H2; i++) {
    let s = w.b2[i]!;
    const off = i * H1;
    for (let j = 0; j < H1; j++) s += w.w2[off + j]! * h1[j]!;
    h2[i] = relu(s);
  }
  let out = w.b3[0]!;
  for (let j = 0; j < H2; j++) out += w.w3[j]! * h2[j]!;
  // Temperature T keeps the pre-activation in the linear tanh region so the
  // network produces graded (position-dependent) scores instead of saturating
  // to ±1. Without it, large trained weights push out to ±1 for every
  // position (all scores => ±1000), making NNUE useless. T is chosen so a
  // typical pre-activation (~±8) maps to a near-linear tanh slope.
  return { out: Math.tanh(out / T), h1, h2 };
}

export function evaluateNNUE(game: IGame, _perspective: Faction): number {
  if (!WEIGHTS) throw new Error("NNUE weights not loaded");
  const x = encodePosition(game, _perspective);
  return forward(WEIGHTS, x).out * 1000;
}

// ─── Training (used by scripts/train-nnue.mjs, tested in tests/nnue.test.ts) ──

export function loss(
  w: NNUEWeights,
  batch: { vec: Float32Array; label: number }[],
): number {
  let s = 0;
  for (const { vec, label } of batch) {
    const pred = forward(w, vec).out; // -1..1
    const d = pred - label;
    s += d * d;
  }
  return s / batch.length;
}

interface Grads {
  w1: Float32Array;
  b1: Float32Array;
  w2: Float32Array;
  b2: Float32Array;
  w3: Float32Array;
  b3: Float32Array;
}

function zeroGrads(): Grads {
  return {
    w1: new Float32Array(H1 * NNUE_INPUT_DIMS),
    b1: new Float32Array(H1),
    w2: new Float32Array(H2 * H1),
    b2: new Float32Array(H2),
    w3: new Float32Array(H2),
    b3: new Float32Array(1),
  };
}

function backward(
  w: NNUEWeights,
  vec: Float32Array,
  label: number,
  g: Grads,
): void {
  const { out, h1, h2 } = forward(w, vec);
  // dL/dout = 2*(out-label), where out = tanh(pre / T). Chain rule through the
  // output nonlinearity: dL/dpre = dL/dout * d(tanh(pre/T))/dpre
  //                              = 2*(out-label) * (1 - out^2) / T.
  // Omitting the (1-out^2)/T factor (the previous bug) made the gradient ~T×
  // too large and ignored tanh saturation → training diverged, loss rose, and
  // the net saturated to ±1000 for every position. dOut below is dL/dpre.
  const dOut = (2 * (out - label) * (1 - out * out)) / T;
  // output layer
  g.b3[0]! += dOut;
  for (let j = 0; j < H2; j++) g.w3[j]! += dOut * h2[j]!;
  // hidden 2
  const dH2 = new Float32Array(H2);
  for (let i = 0; i < H2; i++) {
    dH2[i] = (h2[i]! > 0 ? 1 : 0) * dOut * w.w3[i]!;
    g.b2[i]! += dH2[i]!;
    const off = i * H1;
    for (let j = 0; j < H1; j++) g.w2[off + j]! += dH2[i]! * h1[j]!;
  }
  // hidden 1 (accumulate contributions from all h2)
  for (let i = 0; i < H1; i++) {
    let dH1 = 0;
    for (let k = 0; k < H2; k++) {
      dH1 += dH2[k]! * w.w2[k * H1 + i]!;
    }
    dH1 *= h1[i]! > 0 ? 1 : 0;
    g.b1[i]! += dH1;
    const off = i * NNUE_INPUT_DIMS;
    for (let j = 0; j < NNUE_INPUT_DIMS; j++) g.w1[off + j]! += dH1 * vec[j]!;
  }
}

function applyGrads(w: NNUEWeights, g: Grads, lr: number): void {
  for (let i = 0; i < w.w1.length; i++) w.w1[i]! -= lr * g.w1[i]!;
  for (let i = 0; i < H1; i++) w.b1[i]! -= lr * g.b1[i]!;
  for (let i = 0; i < w.w2.length; i++) w.w2[i]! -= lr * g.w2[i]!;
  for (let i = 0; i < H2; i++) w.b2[i]! -= lr * g.b2[i]!;
  for (let i = 0; i < H2; i++) w.w3[i]! -= lr * g.w3[i]!;
  w.b3[0]! -= lr * g.b3[0]!;
}

export function trainStep(
  w: NNUEWeights,
  batch: { vec: Float32Array; label: number }[],
  lr: number,
): number {
  const g = zeroGrads();
  for (const { vec, label } of batch) backward(w, vec, label, g);
  applyGrads(w, g, lr / batch.length);
  return loss(w, batch);
}

// For tests / trainer init
// Glorot/Xavier initialization: scale = sqrt(2 / (fanIn + fanOut)). This keeps
// pre-activations in a non-saturated, gradient-flowing range so the net can
// actually learn. (The previous (Math.random()-0.5)*0.02 init was ~10x too
// small, causing dead activations and a vanishing gradient during training.)
export function randomWeights(): NNUEWeights {
  const glorot = (fanIn: number, fanOut: number) => {
    const scale = Math.sqrt(2 / (fanIn + fanOut));
    const a = new Float32Array(fanIn * fanOut);
    for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 2 - 1) * scale;
    return a;
  };
  return {
    w1: glorot(NNUE_INPUT_DIMS, H1),
    b1: new Float32Array(H1), // biases zero
    w2: glorot(H1, H2),
    b2: new Float32Array(H2),
    w3: glorot(H2, 1),
    b3: new Float32Array(1),
  };
}
