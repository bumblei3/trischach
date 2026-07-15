/**
 * TD(0) Self-Play Trainer for JS-NNUE (encoding v2).
 *
 * Plays games, labels every side-to-move position with the terminal outcome
 * from that side's perspective, and SGD-updates the net.
 *
 * Diversity: half the games are pure NNUE self-play; half are mixed
 * (NNUE on one rotating side, handcrafted on the others) so the net sees
 * positions that stronger classical play produces.
 *
 * Run:
 *   npx tsx scripts/train-nnue-td.ts [games] [epochsPerGame]
 *   npx tsx scripts/train-nnue-td.ts 80 4 --fresh
 *   npx tsx scripts/train-nnue-td.ts 40 3 --depth=2
 *
 * Default: resume existing weights if shape matches, else random init.
 * Writes: public/js/weights/nnue-weights.json
 */

import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import type { Faction } from "../js/types.ts";
import {
  calculateBestMove,
  setAIDepth,
  setNNUEEnabled,
  loadNNUEWeights,
  simulateMove,
} from "../js/ai-core.ts";
import {
  encodePosition,
  randomWeights,
  trainStep,
  loss,
  type NNUEWeights,
} from "../js/nnue.ts";
import { writeFileSync, mkdirSync } from "fs";
import { describeArch, tryLoadWeights, WEIGHTS_PATH } from "./nnue-common.ts";

const TURNS: Faction[] = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];

function outcomeToLabel(g: Game, faction: Faction): number {
  if (g.eliminatedFactions.has(faction)) return -1;
  const alive = TURNS.filter((f) => !g.eliminatedFactions.has(f));
  if (alive.length <= 1) return 1;
  return 0;
}

/**
 * Play one game. If `nnueOnlySide` is set, only that faction uses NNUE;
 * otherwise all sides use NNUE (self-play).
 */
function playAndCollect(
  g: Game,
  w: NNUEWeights,
  depth: number,
  nnueOnlySide: Faction | null,
  maxPlies = 120,
): { vec: Float32Array; faction: Faction }[] {
  loadNNUEWeights(w);
  setAIDepth(depth);
  const traj: { vec: Float32Array; faction: Faction }[] = [];
  let ply = 0;
  while (ply < maxPlies) {
    const alive = TURNS.filter((f) => !g.eliminatedFactions.has(f));
    if (alive.length <= 1) break;
    const faction = TURNS[g.currentFactionIdx]!;
    traj.push({ vec: encodePosition(g, faction), faction });
    setNNUEEnabled(nnueOnlySide === null ? true : faction === nnueOnlySide);
    const mv = calculateBestMove(g, faction);
    if (!mv) break;
    simulateMove(g, mv.piece, mv.target);
    ply++;
  }
  setNNUEEnabled(false);
  return traj;
}

function saveWeights(w: NNUEWeights, path = WEIGHTS_PATH): void {
  mkdirSync("public/js/weights", { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      w1: Array.from(w.w1),
      b1: Array.from(w.b1),
      w2: Array.from(w.w2),
      b2: Array.from(w.b2),
      w3: Array.from(w.w3),
      b3: Array.from(w.b3),
      meta: {
        arch: describeArch(),
        trainedAt: new Date().toISOString(),
        encoding: "v2-rps-support-pressure",
      },
    }),
  );
}

function parseFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

function parseOpt(argv: string[], name: string, fallback: number): number {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return Number(hit.slice(name.length + 3));
}

function main(): void {
  const argv = process.argv.slice(2);
  const positional = argv.filter((a) => !a.startsWith("--"));
  const GAMES = Number(positional[0] ?? 80);
  const EPOCHS = Number(positional[1] ?? 4);
  const depth = parseOpt(argv, "depth", 2);
  const fresh = parseFlag(argv, "fresh");
  const LR0 = 0.025;

  let w: NNUEWeights;
  if (!fresh) {
    const existing = tryLoadWeights();
    if (existing) {
      w = existing;
      console.log(`Resuming weights from ${WEIGHTS_PATH}`);
    } else {
      w = randomWeights();
      console.log("No compatible weights — random init");
    }
  } else {
    w = randomWeights();
    console.log("Fresh random init (--fresh)");
  }

  console.log(
    `${describeArch()} | TD train games=${GAMES} epochs=${EPOCHS} depth=${depth}`,
  );

  let lastLoss = Infinity;
  for (let game = 0; game < GAMES; game++) {
    const g = new Game();
    g.init(generateBoard());
    // Alternate pure self-play and mixed (NNUE on one side only).
    const mixed = game % 2 === 1;
    const nnueOnlySide = mixed ? TURNS[game % TURNS.length]! : null;
    const traj = playAndCollect(g, w, depth, nnueOnlySide);
    const batch = traj.map((t) => ({
      vec: t.vec,
      label: outcomeToLabel(g, t.faction),
    }));
    if (batch.length === 0) continue;

    // Mild LR decay over the run.
    const lr = LR0 * (1 - game / (GAMES + 1));
    for (let e = 0; e < EPOCHS; e++) {
      lastLoss = trainStep(w, batch, lr);
    }

    if (game % 10 === 0 || game === GAMES - 1) {
      const terminal = outcomeToLabel(g, FACTION.FIRE);
      console.log(
        `Game ${game}: traj=${traj.length} mode=${mixed ? "mixed" : "self"} outcome(FIRE)=${terminal} loss=${lastLoss.toFixed(4)} lr=${lr.toFixed(4)}`,
      );
    }

    // Checkpoint every 20 games so long runs are not lost.
    if (game > 0 && game % 20 === 0) {
      saveWeights(w);
      console.log(`  checkpoint → ${WEIGHTS_PATH}`);
    }
  }

  // Final polish: one pass of residual loss report on a fresh start position.
  {
    const g = new Game();
    g.init(generateBoard());
    const probe = [
      { vec: encodePosition(g, FACTION.FIRE), label: 0 },
      { vec: encodePosition(g, FACTION.WATER), label: 0 },
      { vec: encodePosition(g, FACTION.NATURE), label: 0 },
    ];
    console.log(`probe loss (neutral labels): ${loss(w, probe).toFixed(4)}`);
  }

  saveWeights(w);
  console.log(`TD-trained weights written to ${WEIGHTS_PATH}`);
}

main();
