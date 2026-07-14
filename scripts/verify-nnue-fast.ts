/**
 * Fast NNUE sanity + mini-Elo check (seconds, not 30 min).
 *
 * Two checks:
 *   1. Perspective sanity: after a side makes a move, its own eval should not
 *      get worse (the eval is side-relative now). Catches perspective-blind nets.
 *   2. Mini-Elo: N short self-play games (NNUE vs handcrafted, low depth) and
 *      reports win-rate. Fast enough to run after every training tweak.
 *
 * Run: npx tsx scripts/verify-nnue-fast.ts [games] [depth] [maxPlies]
 */

import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import {
  calculateBestMove,
  setAIDepth,
  setNNUEEnabled,
  loadNNUEWeights,
} from "../js/ai-core.ts";
import { evaluateNNUE } from "../js/nnue.ts";
import { readFileSync } from "fs";
import type { Faction } from "../js/types.ts";
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

export function perspectiveSanity(): boolean {
  const g = new Game();
  g.init(generateBoard());
  setNNUEEnabled(true);
  loadNNUEWeights(loadWeights());
  const fire = FACTION.FIRE;
  const before = evaluateNNUE(g, fire);
  // FIRE makes one of its best moves; its own eval should not drop much.
  const mv = calculateBestMove(g, fire);
  if (!mv) return false;
  g.handleCellClick(mv.piece.pos);
  g.handleCellClick(mv.target);
  if (g.pendingPromotion) g.completePromotion("queen");
  const after = evaluateNNUE(g, fire);
  setNNUEEnabled(false);
  console.log(
    `perspective sanity: eval(FIRE) ${before.toFixed(1)} -> ${after.toFixed(1)}`,
  );
  // A reasonable move should keep own eval from collapsing (~within -200).
  return after > before - 200;
}

export type MiniResult = { win: number; draw: number; loss: number };

export function miniElo(games = 10, depth = 2, maxPlies = 40): MiniResult {
  let win = 0;
  let draw = 0;
  let loss = 0;
  for (let i = 0; i < games; i++) {
    const g = new Game();
    g.init(generateBoard());
    setAIDepth(depth);
    loadNNUEWeights(loadWeights());
    let ply = 0;
    while (ply < maxPlies) {
      const alive = TURNS.filter((f) => !g.eliminatedFactions.has(f));
      if (alive.length <= 1) break;
      const faction = TURNS[g.currentFactionIdx]!;
      setNNUEEnabled(faction === FACTION.FIRE); // NNUE only on FIRE's turns
      const mv = calculateBestMove(g, faction);
      if (!mv) break;
      g.handleCellClick(mv.piece.pos);
      g.handleCellClick(mv.target);
      if (g.pendingPromotion) g.completePromotion("queen");
      ply++;
    }
    setNNUEEnabled(false);
    if (g.eliminatedFactions.has(FACTION.FIRE)) loss++;
    else if (TURNS.filter((f) => !g.eliminatedFactions.has(f)).length <= 1)
      win++;
    else draw++;
  }
  return { win, draw, loss };
}

function main(): void {
  const games = Number(process.argv[2] ?? 10);
  const depth = Number(process.argv[3] ?? 2);
  const maxPlies = Number(process.argv[4] ?? 40);

  const sane = perspectiveSanity();
  console.log(
    `perspective sanity: ${sane ? "OK" : "FAIL (eval not side-relative)"}`,
  );

  const r = miniElo(games, depth, maxPlies);
  const wr = r.win / games;
  console.log(
    `mini-Elo NNUE(FIRE) vs Handcrafted [${games}g d${depth}]: W${r.win} D${r.draw} L${r.loss} | winrate ${(wr * 100).toFixed(0)}%`,
  );
}

main();
