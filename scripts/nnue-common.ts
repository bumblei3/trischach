/**
 * Shared helpers for NNUE train / verify / benchmark scripts.
 */
import { readFileSync, existsSync } from "fs";
import type { NNUEWeights } from "../js/nnue.ts";
import {
  NNUE_INPUT_DIMS,
  NNUE_H1,
  NNUE_H2,
  assertWeightShapes,
} from "../js/nnue.ts";

export const WEIGHTS_PATH = "public/js/weights/nnue-weights.json";

export function loadWeightsFromDisk(path: string = WEIGHTS_PATH): NNUEWeights {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const w: NNUEWeights = {
    w1: Float32Array.from(raw.w1),
    b1: Float32Array.from(raw.b1),
    w2: Float32Array.from(raw.w2),
    b2: Float32Array.from(raw.b2),
    w3: Float32Array.from(raw.w3),
    b3: Float32Array.from(raw.b3),
  };
  assertWeightShapes(w);
  return w;
}

export function tryLoadWeights(
  path: string = WEIGHTS_PATH,
): NNUEWeights | null {
  if (!existsSync(path)) return null;
  try {
    return loadWeightsFromDisk(path);
  } catch {
    return null;
  }
}

/**
 * Elo from score rate in [0,1] where score = (W + 0.5D) / N.
 * Logistic: elo = 400 * log10(s / (1-s)).
 */
export function eloFromScore(score: number): number {
  if (score <= 0) return -800;
  if (score >= 1) return 800;
  return Math.round((400 * Math.log(score / (1 - score))) / Math.LN10);
}

export function scoreFromWDL(win: number, draw: number, loss: number): number {
  const n = win + draw + loss;
  if (n <= 0) return 0.5;
  return (win + 0.5 * draw) / n;
}

export function describeArch(): string {
  return `NNUE ${NNUE_INPUT_DIMS}→${NNUE_H1}→${NNUE_H2}→1`;
}
