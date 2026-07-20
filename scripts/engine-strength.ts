/**
 * engine-strength.ts — absolute engine-strength baseline.
 *
 * The existing benchmarks (benchmark-nnue, compare-nnue) only compare *two
 * eval/search configurations against each other* (NNUE vs classic, depth N vs
 * N+1). They answer "is config A better than B?" but NOT "how strong is the
 * shipped engine in absolute terms?" — and most importantly they never expose
 * a real strength regression/improvement of the WHOLE engine.
 *
 * This script measures the engine's absolute playing strength by pitting it
 * against controlled weaker baselines that are cheap to compute and need no
 * second trained model:
 *
 *   opponent=random : each non-engine faction picks a uniformly random legal
 *                     move (a floor; any real engine should crush this)
 *   opponent=depth1 : each non-engine faction searches to depth 1 (greedy
 *                     material/RPS — a weak-but-not-random opponent)
 *
 * For each opponent we rotate the engine side across all three factions and
 * report score + Elo + 95% CI (same Wald/logistic method as compare-nnue).
 *
 * The resulting numbers ARE the baseline every future engine change must be
 * measured against — run this before/after any search/tablebase/heuristic
 * change to prove (or park) the improvement.
 *
 * Run:
 *   npx tsx scripts/engine-strength.ts [games] [depth] [opponent]
 *   npx tsx scripts/engine-strength.ts 60 3 random
 *   npx tsx scripts/engine-strength.ts 60 3 depth1
 * Flags:
 *   --games=N         number of games (default 40)
 *   --depth=N         engine search depth (default 3)
 *   --opponent=random|depth1   (default random)
 *   --max-plies=N     hard cap per game (default 200)
 *   --seed=N          PRNG seed for the random opponent (default 12345)
 */

import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import type { Faction } from "../js/types.ts";
import {
  calculateBestMove,
  setAIDepth,
  setTieBreakMode,
  getLegalMoves,
} from "../js/ai-core.ts";
import { Piece } from "../js/pieces.ts";
import type { Hex } from "../js/hex.ts";
import { eloFromScore } from "./nnue-common.ts";

const TURNS: Faction[] = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];

type Opponent = "random" | "depth1" | "material";

export interface StrengthSummary {
  games: number;
  engineWins: number;
  engineLosses: number;
  draws: number;
  score: number; // engine score (W + 0.5D)/N
  elo: number;
  eloLo: number;
  eloHi: number;
  depth: number;
  opponent: Opponent;
}

// ── Seeded PRNG (mulberry32) for the random opponent ──
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (a >>> 7), 61 | t)) ^ t;
    return ((t ^ (a >>> 14)) >>> 0) / 4294967296;
  };
}

function legalMovesFor(
  g: Game,
  faction: Faction,
): { piece: Piece; target: Hex; isAttack: boolean }[] {
  const pieces = g
    .getAlivePieces()
    .filter((p) => p.alive && p.faction === faction);
  const moves: { piece: Piece; target: Hex; isAttack: boolean }[] = [];
  for (const piece of pieces) {
    const lm = getLegalMoves(g as any, piece);
    for (const m of lm.moves) moves.push({ piece, target: m, isAttack: false });
    for (const a of lm.attacks)
      moves.push({ piece, target: a, isAttack: true });
  }
  return moves;
}

function randomLegalMove(
  g: Game,
  faction: Faction,
  rng: () => number,
): { piece: Piece; target: Hex } | null {
  const moves = legalMovesFor(g, faction);
  if (moves.length === 0) return null;
  const idx = Math.floor(rng() * moves.length);
  return { piece: moves[idx]!.piece, target: moves[idx]!.target };
}

// Material-aware but RPS-blind opponent: grabs the best capture (by raw piece
// value, ignoring RPS), otherwise moves randomly. This isolates whether the
// engine's weakness is specific to RPS-overfitting (it should still lose to a
// material-greedy mover if it throws away material for RPS advantages) vs. a
// general middlegame weakness.
const PIECE_VAL: Record<string, number> = {
  pawn: 1,
  knight: 3,
  bishop: 3,
  rook: 5,
  queen: 9,
  king: 0,
};

function materialMove(
  g: Game,
  faction: Faction,
  rng: () => number,
): { piece: Piece; target: Hex } | null {
  const moves = legalMovesFor(g, faction);
  if (moves.length === 0) return null;
  const captures = moves.filter((m) => m.isAttack);
  if (captures.length > 0) {
    // Pick the capture with the highest victim material value (RPS-blind).
    let best = captures[0]!;
    let bestVal = -1;
    for (const c of captures) {
      const victim = g
        .getAlivePieces()
        .find((p) => p.alive && p.pos.equals(c.target));
      const v = victim ? (PIECE_VAL[victim.type] ?? 0) : 0;
      if (v > bestVal) {
        bestVal = v;
        best = c;
      }
    }
    return { piece: best.piece, target: best.target };
  }
  const idx = Math.floor(rng() * moves.length);
  return { piece: moves[idx]!.piece, target: moves[idx]!.target };
}

function playGame(
  engineFaction: Faction,
  depth: number,
  opponent: Opponent,
  rng: () => number,
  maxPlies = 200,
): "engine" | "opp" | "draw" {
  const g = new Game();
  g.init(generateBoard());
  setAIDepth(depth);
  setTieBreakMode(true); // deterministic engine side

  let ply = 0;
  while (ply < maxPlies) {
    const alive = TURNS.filter((f) => !g.eliminatedFactions.has(f));
    if (alive.length <= 1) {
      if (alive.length === 1)
        return alive[0] === engineFaction ? "engine" : "opp";
      return "draw";
    }
    const faction = TURNS[g.currentFactionIdx]!;
    let mv: { piece: Piece; target: Hex } | null;
    if (faction === engineFaction) {
      mv = calculateBestMove(g, faction);
    } else if (opponent === "random") {
      mv = randomLegalMove(g, faction, rng);
    } else if (opponent === "material") {
      mv = materialMove(g, faction, rng);
    } else {
      // depth1: greedy 1-ply via the engine at depth 1
      setAIDepth(1);
      mv = calculateBestMove(g, faction);
      setAIDepth(depth);
    }
    if (!mv) return "draw";
    g.handleCellClick(mv.piece.pos);
    g.handleCellClick(mv.target);
    if (g.pendingPromotion) g.completePromotion("queen");
    ply++;
  }
  return "draw";
}

export function runStrength(
  games: number,
  depth: number,
  opponent: Opponent,
  seed = 12345,
  maxPlies = 200,
): StrengthSummary {
  let eWins = 0;
  let eLosses = 0;
  let draws = 0;

  const rng = mulberry32(seed);
  for (let i = 0; i < games; i++) {
    const engineFaction = TURNS[i % TURNS.length]!;
    const r = playGame(engineFaction, depth, opponent, rng, maxPlies);
    if (r === "engine") eWins++;
    else if (r === "opp") eLosses++;
    else draws++;
  }

  const n = games;
  const score = (eWins + 0.5 * draws) / n;
  const elo = eloFromScore(score);

  let eloLo = elo;
  let eloHi = elo;
  const denom = score * (1 - score);
  if (denom > 1e-9 && n > 0) {
    const seScore = Math.sqrt(denom / n);
    const dEloDs = 400 / (denom * Math.LN10);
    const seElo = seScore * dEloDs;
    const z = 1.96;
    eloLo = Math.round(elo - z * seElo);
    eloHi = Math.round(elo + z * seElo);
  }

  return {
    games,
    engineWins: eWins,
    engineLosses: eLosses,
    draws,
    score,
    elo,
    eloLo,
    eloHi,
    depth,
    opponent,
  };
}

function parseFlags(argv: string[]): {
  games: number;
  depth: number;
  opponent: Opponent;
  seed: number;
  maxPlies: number;
} {
  let games = 40;
  let depth = 3;
  let opponent: Opponent = "random";
  let seed = 12345;
  let maxPlies = 200;
  for (const a of argv) {
    if (a.startsWith("--games=")) games = Number(a.slice(8));
    else if (a.startsWith("--depth=")) depth = Number(a.slice(8));
    else if (a.startsWith("--opponent=")) opponent = a.slice(11) as Opponent;
    else if (a.startsWith("--seed=")) seed = Number(a.slice(7));
    else if (a.startsWith("--max-plies=")) maxPlies = Number(a.slice(12));
  }
  return { games, depth, opponent, seed, maxPlies };
}

function main(): void {
  const positional = process.argv.slice(2).filter((x) => !x.startsWith("--"));
  const flags = parseFlags(process.argv);
  // positional overrides: games [depth] [opponent]
  const games = positional[0] ? Number(positional[0]) : flags.games;
  const depth = positional[1] ? Number(positional[1]) : flags.depth;
  const opponent = (positional[2] as Opponent) ?? flags.opponent;

  console.log(
    `Engine strength baseline | engine depth=${depth} vs ${opponent} | games=${games} seed=${flags.seed}`,
  );
  const s = runStrength(games, depth, opponent, flags.seed, flags.maxPlies);
  console.log(`Engine W${s.engineWins} | Opp W${s.engineLosses} | D${s.draws}`);
  console.log(
    `Engine score ${(s.score * 100).toFixed(1)}% | rel-Elo(engine vs ${opponent}) ${s.elo} [95% CI ${s.eloLo}..${s.eloHi}]`,
  );
}

const isDirectRun =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  /engine-strength\.ts$/.test(process.argv[1] ?? "");
if (isDirectRun) main();
