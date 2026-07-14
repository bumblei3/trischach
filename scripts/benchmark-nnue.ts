/**
 * Elo benchmark: NNUE (enabled) vs Handcrafted (disabled) over N games.
 * Run: npx tsx scripts/benchmark-nnue.ts [games]
 * Prints win/draw/loss for the NNUE side + approximate Elo from win-rate.
 *
 * Used to measure whether a trained NNUE is actually stronger than the
 * handcrafted eval (real Elo gain), instead of just mirroring it.
 */

import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import type { Faction } from "../js/types.ts";
import {
  calculateBestMove,
  setAIDepth,
  setNNUEEnabled,
  loadNNUEWeights,
} from "../js/ai-core.ts";
import { readFileSync } from "fs";
import type { NNUEWeights } from "../js/nnue.ts";

const TURNS: Faction[] = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];

function loadWeights(): NNUEWeights {
  const raw = JSON.parse(
    readFileSync("public/js/weights/nnue-weights.json", "utf8"),
  );
  return {
    w1: Float32Array.from(raw.w1),
    b1: Float32Array.from(raw.b1),
    w2: Float32Array.from(raw.w2),
    b2: Float32Array.from(raw.b2),
    w3: Float32Array.from(raw.w3),
    b3: Float32Array.from(raw.b3),
  };
}

export type BenchmarkResult = "win" | "draw" | "loss";

/**
 * Play one game where `nnueSide` uses the NNUE eval and the other sides use the
 * classic handcrafted eval. Returns the result from nnueSide's perspective.
 */
export function playGame(nnueSide: Faction, depth = 3): BenchmarkResult {
  const g = new Game();
  g.init(generateBoard());
  setAIDepth(depth);
  loadNNUEWeights(loadWeights());

  let ply = 0;
  while (ply < 200) {
    const alive = TURNS.filter((f) => !g.eliminatedFactions.has(f));
    if (alive.length <= 1) {
      setNNUEEnabled(false);
      return g.eliminatedFactions.has(nnueSide) ? "loss" : "win";
    }
    const faction = TURNS[g.currentFactionIdx]!;
    // NNUE only on its own turns; opponents use handcrafted eval.
    setNNUEEnabled(faction === nnueSide);
    const mv = calculateBestMove(g, faction);
    if (!mv) {
      setNNUEEnabled(false);
      return "draw";
    }
    g.handleCellClick(mv.piece.pos);
    g.handleCellClick(mv.target);
    if (g.pendingPromotion) g.completePromotion("queen");
    ply++;
  }
  setNNUEEnabled(false);
  return "draw";
}

function eloFromWinRate(wr: number): number {
  if (wr <= 0) return -800;
  if (wr >= 1) return 800;
  return Math.round(-400 * Math.log(1 / wr - 1));
}

function main(): void {
  const N = Number(process.argv[2] ?? 40);
  let win = 0;
  let draw = 0;
  let loss = 0;
  for (let i = 0; i < N; i++) {
    const r = playGame(FACTION.FIRE); // NNUE = FIRE
    if (r === "win") win++;
    else if (r === "draw") draw++;
    else loss++;
  }
  const wr = win / N;
  console.log(
    `NNUE(FIRE) vs Handcrafted: W${win} D${draw} L${loss} | winrate ${(wr * 100).toFixed(1)}% | ~Elo ${eloFromWinRate(wr)}`,
  );
}

main();
