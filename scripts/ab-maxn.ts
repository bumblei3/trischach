/**
 * Ad-hoc A/B: shipped routing vs. Max^n search, both sides with the opening
 * book loaded (the deployed app loads it; the old Max^n experiment measured
 * without it and is therefore not comparable).
 *
 * `minimax()` (js/ai-core.ts) is *maximax*: every node maximises OUR score, so
 * the opponents are modelled as helpers. The paranoid variant models both
 * opponents as minimisers of our score. Max^n is the third, textbook-correct
 * model for a 3-faction game: every faction node maximises the eval of the
 * faction TO MOVE, so a faction does not care about the other two except as
 * competitors for the single "last one standing" win. In a kingmaker game
 * that is a different (and arguably the right) model — and it has never been
 * measured against the shipped path with identical book / budget / opponent.
 *
 * Run:
 *   npx tsx scripts/ab-maxn.ts [--games=10] [--depth=2] [--repeats=1]
 */

import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import type { Faction } from "../js/types.ts";
import {
  calculateBestMove,
  setAIDepth,
  setAITimeLimit,
  setTieBreakMode,
  getAllActions,
  simulateMove,
  undoMove,
  rebuildOccupiedMap,
  evaluateBoard,
  kingmakerTerm,
  captureReplyPenalty,
  calculateTimeBudget,
  MAX_SEARCH_MS,
  applyPostMoveEliminations,
  restorePostMoveEliminations,
  searchPositionKey,
} from "../js/ai-core.ts";
import type { AIAction } from "../js/types.ts";
import { Piece } from "../js/pieces.ts";
import type { Hex } from "../js/hex.ts";
import { eloFromScore } from "./elo-common.ts";
import { loadOpeningBook } from "../js/opening-book.ts";

const TURNS: Faction[] = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];

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
): { piece: Piece; target: Hex }[] {
  const moves: { piece: Piece; target: Hex }[] = [];
  for (const piece of g.getAlivePieces()) {
    if (!piece.alive || piece.faction !== faction) continue;
    const lm = g.getLegalMoves(piece);
    for (const m of lm.moves) moves.push({ piece, target: m });
    for (const a of lm.attacks) moves.push({ piece, target: a });
  }
  return moves;
}

function randomMove(
  g: Game,
  faction: Faction,
  rng: () => number,
): { piece: Piece; target: Hex } | null {
  const moves = legalMovesFor(g, faction);
  if (moves.length === 0) return null;
  const i = Math.floor(rng() * moves.length);
  return moves[i]!;
}

// ─── Max^n ────────────────────────────────────────────────────────

function maxnLeaf(game: Game, seen: Map<string, number>): number {
  // Own-faction eval for the side to move, plus the kingmaker / capture-reply
  // terms the shipped leaf uses. Per-node eval is evaluated for the mover, so
  // the parent sees a value in the mover's own frame.
  const mover = game.currentFaction;
  let score = evaluateBoard(game as any, mover);
  score += kingmakerTerm(game as any, mover);
  score -= captureReplyPenalty(game as any, mover);
  const key = searchPositionKey(game as any);
  const visits = seen.get(key) || 0;
  if (visits > 0) score -= 200 * visits;
  return score;
}

interface MaxnCtx {
  deadline: number;
  start: number;
  nodes: number;
  timedOut: boolean;
}

/**
 * Max^n: the returned score is from `faction`'s frame. A node maximises the
 * own eval of the faction to move; child values are converted into that frame
 * by negation (the parent's opponent-of-mover value).
 */
function maxn(
  game: Game,
  faction: Faction,
  depth: number,
  ctx: MaxnCtx,
  seen: Map<string, number>,
): { score: number; action: AIAction | null } {
  ctx.nodes++;
  if ((ctx.nodes & 255) === 0 && Date.now() > ctx.deadline) ctx.timedOut = true;
  if (ctx.timedOut || Date.now() - ctx.start > MAX_SEARCH_MS) {
    return { score: maxnLeaf(game, seen), action: null };
  }

  const alive = TURNS.filter((f) => !game.eliminatedFactions.has(f));
  if (alive.length <= 1) {
    const own = maxnLeaf(game, seen);
    if (!alive.includes(faction)) return { score: own - 500000, action: null };
    return { score: own + 500000, action: null };
  }

  const mover = game.currentFaction;
  const actions = getAllActions(game as any, mover);
  if (actions.length === 0)
    return { score: maxnLeaf(game, seen), action: null };
  if (depth <= 0) return { score: maxnLeaf(game, seen), action: null };

  let bestScore = -Infinity;
  let bestAction: AIAction | null = null;

  for (const action of actions) {
    const undo = simulateMove(game as any, action.piece, action.target);
    rebuildOccupiedMap(game as any);
    const killed = applyPostMoveEliminations(game as any);
    const key = searchPositionKey(game as any);
    seen.set(key, (seen.get(key) || 0) + 1);

    const child = maxn(game, faction, depth - 1, ctx, seen);

    seen.set(key, (seen.get(key) || 0) - 1);
    restorePostMoveEliminations(game as any, killed);
    undoMove(game as any, undo);
    rebuildOccupiedMap(game as any);

    // Child value is in `faction`'s frame; the mover's own value is the
    // negation (max^n: zero-sum between the mover's gain and our gain).
    const value = mover === faction ? child.score : -child.score;
    if (value > bestScore) {
      bestScore = value;
      bestAction = action;
    }
  }

  return { score: bestScore, action: bestAction };
}

function maxnMove(game: Game, faction: Faction, depth: number) {
  const budget = calculateTimeBudget(game as any);
  const start = Date.now();
  const ctx: MaxnCtx = {
    deadline: start + Math.min(budget, MAX_SEARCH_MS),
    start,
    nodes: 0,
    timedOut: false,
  };
  const r = maxn(game, faction, depth, ctx, new Map());
  return r.action as { piece: Piece; target: Hex } | null;
}

// ─── Play one game ────────────────────────────────────────────────

function playGame(
  engineFaction: Faction,
  depth: number,
  opponent: "random" | "depth1",
  rng: () => number,
  maxPlies: number,
  engine: "shipped" | "maxn",
): "engine" | "opp" | "draw" {
  const g = new Game();
  g.init(generateBoard());
  setAIDepth(depth);
  setTieBreakMode(true);

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
      mv =
        engine === "maxn"
          ? maxnMove(g, faction, depth)
          : calculateBestMove(g, faction);
    } else if (opponent === "random") {
      mv = randomMove(g, faction, rng);
    } else {
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

function runSet(
  games: number,
  depth: number,
  opponent: "random" | "depth1",
  seed: number,
  engine: "shipped" | "maxn",
) {
  let w = 0;
  let l = 0;
  let d = 0;
  const rng = mulberry32(seed);
  for (let i = 0; i < games; i++) {
    const ef = TURNS[i % TURNS.length]!;
    const r = playGame(ef, depth, opponent, rng, 200, engine);
    if (r === "engine") w++;
    else if (r === "opp") l++;
    else d++;
  }
  return { w, l, d, score: (w + 0.5 * d) / games };
}

function parse(argv: string[]) {
  let games = 10;
  let depth = 2;
  let opponent: "random" | "depth1" = "depth1";
  let seed = 12345;
  let repeats = 1;
  for (const a of argv) {
    if (a.startsWith("--games=")) games = Number(a.slice(8));
    else if (a.startsWith("--depth=")) depth = Number(a.slice(8));
    else if (a.startsWith("--opponent=")) opponent = a.slice(11) as any;
    else if (a.startsWith("--seed=")) seed = Number(a.slice(7));
    else if (a.startsWith("--repeats=")) repeats = Number(a.slice(10));
    else if (a.startsWith("--budget=")) setAITimeLimit(Number(a.slice(9)));
  }
  return { games, depth, opponent, seed, repeats };
}

async function main() {
  const { games, depth, opponent, seed, repeats } = parse(process.argv);
  await loadOpeningBook();
  console.log(
    `A/B shipped vs maxn | depth=${depth} vs ${opponent} | games=${games} repeats=${repeats} seed=${seed} book=on`,
  );

  for (let r = 1; r <= repeats; r++) {
    const s = runSet(games, depth, opponent, seed, "shipped");
    const m = runSet(games, depth, opponent, seed, "maxn");
    console.log(
      `run ${r}/${repeats}: shipped ${(s.score * 100).toFixed(1)}% (W${s.w}/L${s.l}/D${s.d}, elo ${eloFromScore(s.score)})` +
        `  |  maxn ${(m.score * 100).toFixed(1)}% (W${m.w}/L${m.l}/D${m.d}, elo ${eloFromScore(m.score)})`,
    );
  }
}

const isDirectRun =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  /ab-maxn\.ts$/.test(process.argv[1] ?? "");
if (isDirectRun) void main();
