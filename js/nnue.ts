/**
 * JS-NNUE Evaluation — neuronales Netz in reinem JS (kein WASM).
 *
 * Input-Encoding: 66 Zellen × 10 Features (6 Piece-Type-OneHot + 3
 * Faction-OneHot + 1 Occupied) = 660 dimensionale dichte Feature-Vektoren.
 *
 * Netz: 660 → 128 (ReLU) → 32 (ReLU) → 1 (tanh × 1000).
 * ~88k Parameter, Inference via Float32Array MatMul (~0.02ms/Eval).
 *
 * Training erfolgt offline (scripts/train-nnue.mjs, Self-Play). Gewichte
 * werden zur Laufzeit aus js/weights/nnue-weights.json geladen.
 */

import { FACTION } from "./board.ts";
import type { Faction, IGame } from "./types.ts";
import { PIECE_TYPE } from "./pieces.ts";
import { Hex } from "./hex.ts";

export const NNUE_INPUT_DIMS = 660; // 66 cells × 10 features
const CELL_COUNT = 66;
const H1 = 128;
const H2 = 32;
const PIECE_TYPES = [
  "king",
  "queen",
  "rook",
  "bishop",
  "knight",
  "pawn",
] as const;
const FACTIONS = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE] as const;

// Canonical cell ordering — identical to generateBoard() iteration order.
function buildCellOrder(): Hex[] {
  const cells: Hex[] = [];
  const N = 5;
  for (let r = 0; r <= N; r++)
    for (let q = -r; q <= 0; q++) cells.push(new Hex(q, r));
  for (let d = 1; d <= 2; d++) {
    const r = N + d;
    for (let q = -N - d; q <= 0; q++) cells.push(new Hex(q, r));
  }
  for (let d = 1; d <= 2; d++) {
    const q = d;
    for (let r = -d; r <= N; r++) cells.push(new Hex(q, r));
  }
  for (let d = 1; d <= 2; d++) {
    const s = d;
    for (let r = -d; r <= N; r++) cells.push(new Hex(-r - s, r));
  }
  return cells;
}
const CELL_ORDER = buildCellOrder();
const CELL_INDEX = new Map(CELL_ORDER.map((h, i) => [h.key, i]));

export interface NNUEWeights {
  w1: Float32Array; // [H1 × 660]
  b1: Float32Array; // [H1]
  w2: Float32Array; // [H2 × H1]
  b2: Float32Array; // [H2]
  w3: Float32Array; // [1 × H2]
  b3: Float32Array; // [1]
}

let WEIGHTS: NNUEWeights | null = null;

export function loadNNUEWeights(w: NNUEWeights): void {
  WEIGHTS = w;
}

export function encodePosition(
  game: IGame,
  _perspective: Faction,
): Float32Array {
  const vec = new Float32Array(NNUE_INPUT_DIMS);
  for (const p of game.pieces) {
    if (!p.alive) continue;
    const ci = CELL_INDEX.get(p.pos.key);
    if (ci === undefined) continue;
    const base = ci * 10;
    vec[base + 9] = 1; // occupied
    const ti = PIECE_TYPES.indexOf(p.type as (typeof PIECE_TYPES)[number]);
    if (ti >= 0) vec[base + ti] = 1;
    const fi = FACTIONS.indexOf(p.faction);
    if (fi >= 0) vec[base + 6 + fi] = 1;
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
  return { out: Math.tanh(out), h1, h2 };
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
  // dL/dout = 2*(out-label), out in tanh-space
  const dOut = 2 * (out - label);
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
export function randomWeights(): NNUEWeights {
  const r = (n: number) => {
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = (Math.random() - 0.5) * 0.02;
    return a;
  };
  return {
    w1: r(H1 * NNUE_INPUT_DIMS),
    b1: r(H1),
    w2: r(H2 * H1),
    b2: r(H2),
    w3: r(H2),
    b3: r(1),
  };
}
