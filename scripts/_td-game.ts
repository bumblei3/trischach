/**
 * TD worker: plays ONE self-play game with NNUE as the eval for both sides,
 * collects the trajectory (encoded positions + side-relative labels), and
 * writes it to a temp file. Run by the parallel orchestrator:
 *   npx tsx scripts/_td-game.ts <weightsPath> <outPath> <gameId>
 *
 * The eval is perspective-relative (encodePosition(g, faction)) and the TD
 * label is computed from the SAME side-to-move perspective, so the net learns
 * consistent signal.
 */

import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import {
  calculateBestMove,
  setAIDepth,
  setNNUEEnabled,
  loadNNUEWeights,
} from "../js/ai-core.ts";
import { encodePosition } from "../js/nnue.ts";
import { readFileSync, writeFileSync } from "fs";
import type { NNUEWeights } from "../js/nnue.ts";

const TURNS: Faction[] = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];

function loadWeights(path: string): NNUEWeights {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return {
    w1: Float32Array.from(raw.w1),
    b1: Float32Array.from(raw.b1),
    w2: Float32Array.from(raw.w2),
    b2: Float32Array.from(raw.b2),
    w3: Float32Array.from(raw.w3),
    b3: Float32Array.from(raw.b3),
  };
}

/** Terminal outcome from `faction`'s perspective: +1 win, -1 loss, 0 draw. */
function outcomeToLabel(g: Game, faction: Faction): number {
  if (g.eliminatedFactions.has(faction)) return -1;
  const alive = TURNS.filter((f) => !g.eliminatedFactions.has(f));
  if (alive.length <= 1) return 1;
  return 0;
}

function playOne(weightsPath: string): { vec: number[]; label: number }[] {
  const w = loadWeights(weightsPath);
  setNNUEEnabled(true);
  loadNNUEWeights(w);
  setAIDepth(2);
  const traj: { vec: number[]; label: number }[] = [];
  const g = new Game();
  g.init(generateBoard());
  let ply = 0;
  while (ply < 120) {
    const alive = TURNS.filter((f) => !g.eliminatedFactions.has(f));
    if (alive.length <= 1) break;
    const faction = TURNS[g.currentFactionIdx]!;
    const vec = encodePosition(g, faction);
    traj.push({ vec: Array.from(vec), label: outcomeToLabel(g, faction) });
    const mv = calculateBestMove(g, faction);
    if (!mv) break;
    // Use simulateMove for speed (no promotion handling mid-search).
    // Note: simulateMove doesn't trigger promotion, which is fine for training
    // data — we only need position eval labels.
    simulateMoveLocal(g, mv.piece, mv.target);
    ply++;
  }
  setNNUEEnabled(false);
  return traj;
}

// Local simulateMove to avoid importing the internal name collision.
// Reuse ai-core's simulateMove via dynamic import would be cleaner, but we
// import it directly below.
import { simulateMove } from "../js/ai-core.ts";
function simulateMoveLocal(g: Game, piece: any, target: any): void {
  simulateMove(g, piece, target);
}

function main(): void {
  const [, , weightsPath, outPath, gameId] = process.argv;
  if (!weightsPath || !outPath) {
    console.error("usage: _td-game.ts <weightsPath> <outPath> <gameId>");
    process.exit(1);
  }
  const traj = playOne(weightsPath);
  writeFileSync(outPath, JSON.stringify({ gameId, traj }));
}

main();
