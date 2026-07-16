/**
 * Tablebase generator for trischach endgames (Syzygy-style result map).
 *
 * Phase 1: solves the K+Queen vs K endgame (one faction has King+Queen, one
 * faction has only its King, the third faction is already eliminated). The
 * generator enumerates all placements, reduces by faction-rotation symmetry,
 * and solves each position with perfect play (full minimax over the real Game
 * rules, including RPS king-capture). Result is written as a hash →
 * {result, dtz} JSON map loaded at runtime by js/tablebase.ts.
 *
 * Win rule (pragmatic for 3-player RPS): the last surviving faction wins;
 * a move that captures the side-to-move's king eliminates that faction.
 *
 * Run:
 *   npx tsx scripts/gen-tablebase.ts
 *   npx tsx scripts/gen-tablebase.ts --out public/js/tablebases/kq-vs-k.json
 */

import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import {
  simulateMove,
  undoMove,
  computeZobristHash,
  getLegalMoves,
} from "../js/ai-core.ts";
import { Piece } from "../js/pieces.ts";
import { Hex } from "../js/hex.ts";
import type { Faction } from "../js/types.ts";
import { writeFileSync, mkdirSync } from "node:fs";

const TURNS: Faction[] = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];

interface Solved {
  result: "win" | "loss" | "draw";
  dtz: number;
}

/**
 * Perfect-play solver. `result` is from the side-to-move perspective.
 * Memoized over Zobrist hash. `depth` caps runaway search (should never be
 * hit for K+Q vs K, which terminates by repetition-move cap or mate).
 */
function solve(game: Game, memo: Map<string, Solved>, depth: number): Solved {
  const hash = computeZobristHash(game).toString();
  const cached = memo.get(hash);
  if (cached) return cached;

  if (depth <= 0) return { result: "draw", dtz: 0 };

  const aliveFactions = Array.from(
    new Set(
      game
        .getAlivePieces()
        .filter((p) => p.alive)
        .map((p) => p.faction),
    ),
  );
  if (aliveFactions.length <= 1) {
    const res: Solved = { result: "loss", dtz: 0 };
    memo.set(hash, res);
    return res;
  }

  const faction = TURNS[game.currentFactionIdx]!;
  const actions = collectActions(game, faction);
  if (actions.length === 0) {
    const res: Solved = { result: "draw", dtz: 0 };
    memo.set(hash, res);
    return res;
  }

  let best: Solved = { result: "loss", dtz: Infinity };
  for (const action of actions) {
    const undo = simulateMove(game, action.piece, action.target);
    const child = solve(game, memo, depth - 1);
    undoMove(game, undo);
    // child is from opponent's perspective; flip for our side.
    const ourResult: "win" | "loss" | "draw" =
      child.result === "win"
        ? "loss"
        : child.result === "loss"
          ? "win"
          : "draw";
    const dtz = child.dtz + 1;
    if (better(ourResult, best.result)) {
      best = { result: ourResult, dtz };
    } else if (
      ourResult === best.result &&
      ourResult !== "draw" &&
      dtz < best.dtz
    ) {
      best = { result: ourResult, dtz };
    }
  }
  memo.set(hash, best);
  return best;
}

function better(
  a: "win" | "loss" | "draw",
  b: "win" | "loss" | "draw",
): boolean {
  const rank = { win: 2, draw: 1, loss: 0 } as const;
  return rank[a] > rank[b];
}

function collectActions(
  game: Game,
  faction: Faction,
): { piece: Piece; target: Hex }[] {
  const out: { piece: Piece; target: Hex }[] = [];
  const pieces = game
    .getAlivePieces()
    .filter((p) => p.alive && p.faction === faction);
  for (const piece of pieces) {
    const { moves, attacks } = getLegalMoves(game as any, piece);
    for (const m of moves) out.push({ piece, target: m });
    for (const a of attacks) out.push({ piece, target: a });
  }
  return out;
}

/** All board cell keys (the 21-cell triangle). */
function allCellKeys(boardCells: Map<string, { zone: string }>): string[] {
  return Array.from(boardCells.keys());
}

/**
 * Build a Game for a specific placement: strongFaction gets K+Q, weakFaction
 * gets only K, third faction eliminated. `sideToMoveIdx` selects who moves.
 */
function buildPosition(
  boardCells: Map<string, { hex: Hex; zone: string; faction: Faction | null }>,
  strong: Faction,
  weak: Faction,
  eliminated: Faction,
  qKey: string,
  kStrongKey: string,
  kWeakKey: string,
  sideToMoveIdx: number,
): Game {
  const g = new Game();
  g.init(boardCells as Map<string, any>);
  g.pieces = [];
  g.eliminatedFactions = new Set<Faction>([eliminated]);
  const mk = (type: any, fac: Faction, key: string) =>
    new Piece(type, fac, boardCells.get(key)!.hex);
  g.pieces.push(mk("queen", strong, qKey));
  g.pieces.push(mk("king", strong, kStrongKey));
  g.pieces.push(mk("king", weak, kWeakKey));
  g.currentFactionIdx = sideToMoveIdx;
  g.currentFaction = TURNS[sideToMoveIdx]!;
  g.state = "select_piece" as any;
  (g as any)._positionHash = undefined;
  return g;
}

function main(): void {
  const outArg = process.argv.find((a) => a.startsWith("--out="));
  const outPath = outArg
    ? outArg.slice("--out=".length)
    : "public/js/tablebases/kq-vs-k.json";
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : Infinity;

  const boardCells = generateBoard();
  const cells = allCellKeys(boardCells);
  if (cells.length > limit) cells.length = Math.floor(limit);

  // Faction rotation symmetry: pick strong=FIRE, weak=WATER, eliminated=NATURE.
  // (Other rotations are equivalent by the RPS-fair board, so we solve one.)
  const STRONG = FACTION.FIRE;
  const WEAK = FACTION.WATER;
  const ELIM = FACTION.NATURE;

  const memo = new Map<string, Solved>();
  const result: Record<string, { r: "win" | "loss" | "draw"; dtz: number }> =
    {};

  let count = 0;
  const total = cells.length * (cells.length - 1) * (cells.length - 2);
  for (const qKey of cells) {
    for (const kStrongKey of cells) {
      if (kStrongKey === qKey) continue;
      for (const kWeakKey of cells) {
        if (kWeakKey === qKey || kWeakKey === kStrongKey) continue;
        for (let side = 0; side < 3; side++) {
          // Only positions where the side to move is STRONG or WEAK (ELIM has no pieces).
          if (TURNS[side] === ELIM) continue;
          const g = buildPosition(
            boardCells as any,
            STRONG,
            WEAK,
            ELIM,
            qKey,
            kStrongKey,
            kWeakKey,
            side,
          );
          // Only count positions that are tablebase-relevant (≤4 pieces always true here).
          if (g.getAlivePieces().filter((p) => p.alive).length > 4) continue;
          const hash = computeZobristHash(g).toString();
          if (result[hash]) continue;
          const solved = solve(g, memo, 40);
          // Store only decisive results (win/loss). Draws are left as
          // "unknown" so the engine falls back to its heuristic (a draw is a
          // draw either way, and omitting them shrinks the file ~8x).
          if (solved.result !== "draw") {
            result[hash] = { r: solved.result, dtz: solved.dtz };
          }
          count++;
        }
      }
    }
    // Incremental flush so partial progress survives timeouts.
    if (count % 500 === 0) {
      mkdirSync("public/js/tablebases", { recursive: true });
      writeFileSync(outPath, JSON.stringify(result));
    }
  }

  mkdirSync("public/js/tablebases", { recursive: true });
  writeFileSync(outPath, JSON.stringify(result));
  console.log(`Solved ${count} unique positions; memo=${memo.size}`);
  console.log(`Wrote ${Object.keys(result).length} entries → ${outPath}`);
  const wins = Object.values(result).filter((v) => v.r === "win").length;
  const losses = Object.values(result).filter((v) => v.r === "loss").length;
  const draws = Object.values(result).filter((v) => v.r === "draw").length;
  console.log(
    `Distribution: win=${wins} loss=${losses} draw=${draws} (of ${total} raw placements)`,
  );
}

main();
