/**
 * Fast NNUE sanity + mini-Elo check.
 *
 *   1. Perspective sanity: after a move, own eval must not collapse.
 *   2. Mini-Elo: short NNUE-vs-handcrafted games with rotated sides.
 *   3. Optional --gate=N: exit 1 if Elo < N.
 *
 * Run: npx tsx scripts/verify-nnue-fast.ts [games] [depth] [maxPlies] [--gate=0]
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
import type { Faction } from "../js/types.ts";
import type { NNUEWeights } from "../js/nnue.ts";
import {
  describeArch,
  eloFromScore,
  loadWeightsFromDisk,
  scoreFromWDL,
} from "./nnue-common.ts";

const TURNS: Faction[] = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];

export function perspectiveSanity(weights?: NNUEWeights): boolean {
  const g = new Game();
  g.init(generateBoard());
  setNNUEEnabled(true);
  loadNNUEWeights(weights ?? loadWeightsFromDisk());
  const fire = FACTION.FIRE;
  const before = evaluateNNUE(g, fire);
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
  return after > before - 200;
}

export type MiniResult = {
  win: number;
  draw: number;
  loss: number;
  score: number;
  elo: number;
};

/**
 * Wall-clock budget per game (ms). 3-player trischach games rarely end by
 * elimination, so a fixed `maxPlies` cap lets the verify suite run forever
 * once positions get deep (search slows to ~4s/ply). Cap each game by real
 * time: once the budget is spent the game is scored as a draw and we move on.
 * 16 games × 12s = ~192s worst-case — deterministic and CI-friendly.
 */
const GAME_WALL_MS = 12_000;

export function miniElo(
  games = 10,
  depth = 2,
  maxPlies = 40,
  weights?: NNUEWeights,
  gameWallMs = GAME_WALL_MS,
): MiniResult {
  let win = 0;
  let draw = 0;
  let loss = 0;
  const w = weights ?? loadWeightsFromDisk();
  for (let i = 0; i < games; i++) {
    const nnueSide = TURNS[i % TURNS.length]!;
    const g = new Game();
    g.init(generateBoard());
    setAIDepth(depth);
    loadNNUEWeights(w);
    const gameStart = Date.now();
    let ply = 0;
    let timedOut = false;
    while (ply < maxPlies) {
      const alive = TURNS.filter((f) => !g.eliminatedFactions.has(f));
      if (alive.length <= 1) break;
      const faction = TURNS[g.currentFactionIdx]!;
      setNNUEEnabled(faction === nnueSide);
      const mv = calculateBestMove(g, faction);
      if (!mv) break;
      g.handleCellClick(mv.piece.pos);
      g.handleCellClick(mv.target);
      if (g.pendingPromotion) g.completePromotion("queen");
      ply++;
      if (Date.now() - gameStart > gameWallMs) {
        timedOut = true;
        break;
      }
    }
    setNNUEEnabled(false);
    if (g.eliminatedFactions.has(nnueSide)) loss++;
    else if (timedOut || TURNS.filter((f) => !g.eliminatedFactions.has(f)).length > 1)
      draw++;
    else win++;
  }
  const score = scoreFromWDL(win, draw, loss);
  return { win, draw, loss, score, elo: eloFromScore(score) };
}

function parseGate(argv: string[]): number | null {
  for (const a of argv) {
    if (a.startsWith("--gate=")) return Number(a.slice("--gate=".length));
    if (a === "--gate") return 0;
  }
  return null;
}

function main(): void {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const games = Number(positional[0] ?? 12);
  const depth = Number(positional[1] ?? 2);
  const maxPlies = Number(positional[2] ?? 50);
  const gate = parseGate(process.argv);

  console.log(
    `${describeArch()} | verify games=${games} d${depth} plies≤${maxPlies}`,
  );

  const sane = perspectiveSanity();
  console.log(
    `perspective sanity: ${sane ? "OK" : "FAIL (eval not side-relative)"}`,
  );
  if (!sane) {
    process.exit(1);
  }

  const r = miniElo(games, depth, maxPlies);
  console.log(
    `mini-Elo NNUE vs Handcrafted: W${r.win} D${r.draw} L${r.loss} | score ${(r.score * 100).toFixed(0)}% | ~Elo ${r.elo}`,
  );

  if (gate !== null && r.elo < gate) {
    console.error(`GATE FAIL: Elo ${r.elo} < ${gate}`);
    process.exit(1);
  }
  if (gate !== null) {
    console.log(`GATE OK: Elo ${r.elo} ≥ ${gate}`);
  }
}

const isDirectRun =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  /verify-nnue-fast\.ts$/.test(process.argv[1] ?? "");
if (isDirectRun) main();
