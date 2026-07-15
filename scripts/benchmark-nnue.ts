/**
 * Elo benchmark: NNUE vs Handcrafted over N games.
 *
 * Run:
 *   npx tsx scripts/benchmark-nnue.ts [games] [depth]
 *   npx tsx scripts/benchmark-nnue.ts 60 3 --gate=0
 *
 * Rotates the NNUE side across Fire/Water/Nature so results are not
 * faction-biased. Score = (W + 0.5D) / N → Elo via logistic mapping.
 * With --gate=N exit 1 if Elo < N (default no gate).
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
import type { NNUEWeights } from "../js/nnue.ts";
import {
  eloFromScore,
  loadWeightsFromDisk,
  scoreFromWDL,
  describeArch,
} from "./nnue-common.ts";

const TURNS: Faction[] = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];

export type BenchmarkResult = "win" | "draw" | "loss";

export interface BenchmarkSummary {
  win: number;
  draw: number;
  loss: number;
  games: number;
  score: number;
  elo: number;
  depth: number;
}

/**
 * Play one game where `nnueSide` uses NNUE and the others use handcrafted eval.
 */
export function playGame(
  nnueSide: Faction,
  depth = 3,
  weights?: NNUEWeights,
  maxPlies = 200,
): BenchmarkResult {
  const g = new Game();
  g.init(generateBoard());
  setAIDepth(depth);
  loadNNUEWeights(weights ?? loadWeightsFromDisk());

  let ply = 0;
  while (ply < maxPlies) {
    const alive = TURNS.filter((f) => !g.eliminatedFactions.has(f));
    if (alive.length <= 1) {
      setNNUEEnabled(false);
      return g.eliminatedFactions.has(nnueSide) ? "loss" : "win";
    }
    const faction = TURNS[g.currentFactionIdx]!;
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

export function runBenchmark(
  games: number,
  depth = 3,
  weights?: NNUEWeights,
): BenchmarkSummary {
  let win = 0;
  let draw = 0;
  let loss = 0;
  for (let i = 0; i < games; i++) {
    const nnueSide = TURNS[i % TURNS.length]!;
    const r = playGame(nnueSide, depth, weights);
    if (r === "win") win++;
    else if (r === "draw") draw++;
    else loss++;
  }
  const score = scoreFromWDL(win, draw, loss);
  return {
    win,
    draw,
    loss,
    games,
    score,
    elo: eloFromScore(score),
    depth,
  };
}

function parseGate(argv: string[]): number | null {
  for (const a of argv) {
    if (a.startsWith("--gate=")) {
      return Number(a.slice("--gate=".length));
    }
    if (a === "--gate") return 0;
  }
  return null;
}

function main(): void {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const N = Number(positional[0] ?? 40);
  const depth = Number(positional[1] ?? 3);
  const gate = parseGate(process.argv);

  console.log(`${describeArch()} | games=${N} depth=${depth}`);
  const s = runBenchmark(N, depth);
  console.log(
    `NNUE vs Handcrafted: W${s.win} D${s.draw} L${s.loss} | score ${(s.score * 100).toFixed(1)}% | ~Elo ${s.elo}`,
  );

  if (gate !== null && s.elo < gate) {
    console.error(`GATE FAIL: Elo ${s.elo} < ${gate}`);
    process.exit(1);
  }
  if (gate !== null) {
    console.log(`GATE OK: Elo ${s.elo} ≥ ${gate}`);
  }
}

const isDirectRun =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  /benchmark-nnue\.ts$/.test(process.argv[1] ?? "");
if (isDirectRun) main();
