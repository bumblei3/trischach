/**
 * TD(0) Self-Play Trainer for JS-NNUE.
 *
 * The previous trainer (train-nnue.ts) used knowledge distillation: it labelled
 * every position with the handcrafted eval and trained the net to *mimic* it.
 * That yields ~0 Elo — the net says the same thing as the handcrafted eval,
 * only slower. This trainer instead learns from actual game outcomes:
 *
 *   1. Play self-play games with NNUE as the eval for BOTH sides.
 *   2. Record every visited position (from the side-to-move perspective).
 *   3. Label every position with the final game outcome (TD(0), terminal label).
 *   4. Run SGD (trainStep) on those labels so the net's prediction at each
 *      position converges toward the result — teaching it real winning/losing
 *      patterns, not just an imitation of the handcrafted eval.
 *
 * Run: npx tsx scripts/train-nnue-td.ts [games] [epochsPerGame]
 * Weights exported to public/js/weights/nnue-weights.json.
 */

import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import {
  calculateBestMove,
  setAIDepth,
  setNNUEEnabled,
  loadNNUEWeights,
  simulateMove,
} from "../js/ai-core.ts";
import { encodePosition, randomWeights, trainStep } from "../js/nnue.ts";
import { writeFileSync, mkdirSync } from "fs";
import type { NNUEWeights } from "../js/nnue.ts";

const TURNS: Faction[] = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];

/** Terminal outcome from FIRE's perspective: +1 win, -1 loss, 0 draw. */
function outcomeToLabel(g: Game): number {
  if (g.eliminatedFactions.has(FACTION.FIRE)) return -1;
  const alive = TURNS.filter((f) => !g.eliminatedFactions.has(f));
  if (alive.length <= 1) return 1;
  return 0;
}

/**
 * Play one self-play game with NNUE as the eval for both sides, collecting the
 * trajectory of encoded positions (side-to-move perspective) for TD training.
 */
function playAndCollect(g: Game, w: NNUEWeights): Float32Array[] {
  setNNUEEnabled(true);
  loadNNUEWeights(w);
  setAIDepth(2);
  const traj: Float32Array[] = [];
  let ply = 0;
  while (ply < 120) {
    const alive = TURNS.filter((f) => !g.eliminatedFactions.has(f));
    if (alive.length <= 1) break;
    const faction = TURNS[g.currentFactionIdx]!;
    traj.push(encodePosition(g, faction));
    const mv = calculateBestMove(g, faction);
    if (!mv) break;
    simulateMove(g, mv.piece, mv.target);
    ply++;
  }
  setNNUEEnabled(false);
  return traj;
}

function main(): void {
  const GAMES = Number(process.argv[2] ?? 120);
  const EPOCHS = Number(process.argv[3] ?? 4);
  const LR = 0.02;
  let w = randomWeights();

  for (let game = 0; game < GAMES; game++) {
    const g = new Game();
    g.init(generateBoard());
    const traj = playAndCollect(g, w);
    const terminal = outcomeToLabel(g);
    // TD(0): label every position with the terminal outcome.
    const batch = traj.map((vec) => ({ vec, label: terminal }));
    for (let e = 0; e < EPOCHS; e++) {
      trainStep(w, batch, LR);
    }
    if (game % 20 === 0) {
      console.log(`Game ${game}: traj=${traj.length} outcome=${terminal}`);
    }
  }

  mkdirSync("public/js/weights", { recursive: true });
  writeFileSync(
    "public/js/weights/nnue-weights.json",
    JSON.stringify({
      w1: Array.from(w.w1),
      b1: Array.from(w.b1),
      w2: Array.from(w.w2),
      b2: Array.from(w.b2),
      w3: Array.from(w.w3),
      b3: Array.from(w.b3),
    }),
  );
  console.log("TD-trained weights written to public/js/weights/nnue-weights.json");
}

main();
