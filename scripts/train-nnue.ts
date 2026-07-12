/**
 * Self-Play Trainer für JS-NNUE.
 *
 * Sammelt Positionen aus Self-Play-Spielen (NNUE-Eval vs. Classic-Eval) und
 * trainiert das Netz (SGD auf MSE gegen Spielergebnis-Label).
 * Gewichte werden als js/weights/nnue-weights.json exportiert.
 *
 * Ausführen: npx tsx scripts/train-nnue.ts
 */

import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import { calculateBestMove, setAIDepth, evaluateBoard } from "../js/ai-core.ts";
import { simulateMove, undoMove } from "../js/ai-core.ts";
import { encodePosition, randomWeights, trainStep, loss } from "../js/nnue.ts";
import { writeFileSync, mkdirSync } from "fs";

const TURNS: Faction[] = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];

// Collect positions from self-play games (classic eval for both sides — no
// NNUE needed here). Each position is labeled by the classic eval from the
// side-to-move perspective (knowledge distillation: NNUE learns to mimic the
// proven handcrafted eval). This avoids the degenerate "always lose" self-play
// label problem and gives real gradient signal immediately.
function collectPositions(n: number): { vec: Float32Array; label: number }[] {
  const out: { vec: Float32Array; label: number }[] = [];
  for (let game = 0; game < n; game++) {
    const g = new Game();
    g.init(generateBoard());
    setAIDepth(1);
    let ply = 0;
    const MAX_PLIES = 40;
    while (ply < MAX_PLIES) {
      const alive = TURNS.filter((f) => !g.eliminatedFactions.has(f));
      if (alive.length <= 1) break;
      const faction = TURNS[g.currentFactionIdx]!;
      const vec = encodePosition(g, faction);
      const classic = evaluateBoard(g, faction); // centipawn-like
      const label = Math.max(-1, Math.min(1, classic / 1000)); // tanh scale
      out.push({ vec, label });
      const move = calculateBestMove(g, faction);
      if (!move) break;
      simulateMove(g, move.piece, move.target);
      ply++;
    }
  }
  return out;
}

function main(): void {
  const w = randomWeights();
  const positions = collectPositions(30);
  console.log(`Collected ${positions.length} training positions`);
  const EPOCHS = 50;
  const LR = 0.005;

  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    // shuffle
    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [positions[i], positions[j]] = [positions[j]!, positions[i]!];
    }
    let totalLoss = 0;
    const BATCH = 32;
    for (let i = 0; i < positions.length; i += BATCH) {
      const batch = positions.slice(i, i + BATCH);
      totalLoss += loss(w, batch);
      trainStep(w, batch, LR);
    }
    if (epoch % 5 === 0) {
      console.log(
        `Epoch ${epoch}: loss ${(totalLoss / Math.ceil(positions.length / BATCH)).toFixed(4)}`,
      );
    }
  }

  mkdirSync("public/js/weights", { recursive: true });
  const exportObj = {
    w1: Array.from(w.w1),
    b1: Array.from(w.b1),
    w2: Array.from(w.w2),
    b2: Array.from(w.b2),
    w3: Array.from(w.w3),
    b3: Array.from(w.b3),
  };
  writeFileSync(
    "public/js/weights/nnue-weights.json",
    JSON.stringify(exportObj),
  );
  console.log("Weights written to public/js/weights/nnue-weights.json");
}

main();
