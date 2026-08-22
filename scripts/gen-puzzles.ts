/**
 * gen-puzzles.ts — fills puzzles.json with validated tactics from self-play.
 *
 * The shipped puzzle generator (generatePuzzlesFromBook) depends on the
 * opening book, which holds only 3 entries — so the puzzle mode always showed
 * "Keine Puzzles gefunden". This script plays deterministic engine-vs-random
 * games and mines every reached position for mate-in-1 tactics:
 *
 *   - findAllImmediateMatingMoves + hasUniqueSolution (both from
 *     js/puzzle.ts) guarantee a unique-solution mate puzzle.
 *   - Dedup by position key so the same tactic is not stored twice.
 *
 * Run:
 *   npx tsx scripts/gen-puzzles.ts [games] [--seed=12345]
 */

import { writeFileSync } from "node:fs";
import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import {
  calculateBestMove,
  setAIDepth,
  setTieBreakMode,
} from "../js/ai-core.ts";
import {
  findAllImmediateMatingMoves,
  hasUniqueSolution,
} from "../js/puzzle.ts";
import type { Puzzle } from "../js/puzzle.ts";
import type { Faction, Piece } from "../js/types.ts";
import { Hex } from "../js/hex.ts";

const TURNS: Faction[] = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 14), 0)) >>> 0;
    return t / 4294967296;
  };
}

function randomLegalMove(
  game: Game,
  faction: Faction,
  rng: () => number,
): { piece: Piece; target: Hex } | null {
  const pieces = game
    .getAlivePieces()
    .filter((p) => p.alive && p.faction === faction);
  const moves: { piece: Piece; target: Hex }[] = [];
  for (const p of pieces) {
    const { moves: m, attacks: a } = game.getLegalMoves(p);
    for (const t of m) moves.push({ piece: p, target: t as Hex });
    for (const t of a) moves.push({ piece: p, target: t as Hex });
  }
  if (moves.length === 0) return null;
  return moves[Math.floor(rng() * moves.length)]!;
}

function applyMove(game: Game, mv: { piece: Piece; target: Hex }): void {
  game.handleCellClick(mv.piece.pos);
  game.handleCellClick(mv.target);
  if (game.pendingPromotion) game.completePromotion("queen");
}

/** Minimal position key for dedup (pieces + side to move). */
function posKey(game: Game): string {
  const parts = game
    .getAlivePieces()
    .filter((p) => p.alive)
    .map((p) => `${p.faction[0]}${p.type[0]}${p.id}@${p.pos.q},${p.pos.r}`)
    .sort();
  return `${parts.join("|")}#${game.currentFactionIdx}`;
}

/** Position serializer matching js/puzzle.ts reconstructGameFromHash format. */
function serializeFen(game: Game): string {
  // Distinct type chars: king=k, queen=q, rook=r, bishop=b, knight=n, pawn=p.
  const TYPE_CHAR: Record<string, string> = {
    king: "k",
    queen: "q",
    rook: "r",
    bishop: "b",
    knight: "n",
    pawn: "p",
  };
  const parts = game
    .getAlivePieces()
    .filter((p) => p.alive)
    .map(
      (p) =>
        `${p.faction[0]!.toUpperCase()}${TYPE_CHAR[p.type] ?? "p"}${p.pos.q},${p.pos.r}`,
    )
    .join("|");
  return `${parts}#${game.currentFactionIdx}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────

function main(): void {
  const args: string[] = process.argv.slice(2) as string[];
  const gamesArg = args.find((a) => !a.startsWith("--"));
  const numGames = gamesArg ? parseInt(gamesArg, 10) : 30;
  const seedArg = args.find((a) => a.startsWith("--seed="));
  const seed = seedArg ? parseInt(seedArg.split("=")[1]!, 10) : 12345;

  setAIDepth(3);
  setTieBreakMode(true);

  const rng = mulberry32(seed);
  const seen = new Set<string>();
  const puzzles: Puzzle[] = [];
  let candidates = 0;

  for (let g = 0; g < numGames; g++) {
    // Rotate engine faction per game for variety.
    const offset = g % 3;
    const engineFaction = TURNS[offset]!;

    const game = new Game();
    game.init(generateBoard());

    let ply = 0;
    while (ply < 120) {
      const alive = TURNS.filter((f) => !game.eliminatedFactions.has(f));
      if (alive.length <= 1) break;

      // Mine BEFORE moving: every reached position is a candidate.
      const key = posKey(game);
      if (!seen.has(key)) {
        seen.add(key);

        const mates = findAllImmediateMatingMoves(game);
        candidates++;
        if (mates.length === 1) {
          const mate = mates[0]!;
          const faction = game.currentFaction;
          const piece = game.pieces.find(
            (p) =>
              p.alive &&
              p.id === mate.pieceId &&
              p.pos.q === mate.from.q &&
              p.pos.r === mate.from.r,
          );
          if (piece) {
            const puzzle: Puzzle = {
              id: `self-${faction}-${piece.id}-${mate.to.q},${mate.to.r}`,
              fen: serializeFen(game),
              initialMoves: [],
              solution: [mate],
              mateIn: 1,
              difficulty: "easy",
              faction,
              createdAt: Date.now(),
            };
            if (hasUniqueSolution(puzzle)) {
              puzzles.push(puzzle);
            }
          }
        }
      }

      const faction = TURNS[game.currentFactionIdx]!;
      const mv =
        faction === engineFaction
          ? calculateBestMove(game, faction)
          : randomLegalMove(game, faction, rng);
      if (!mv) break;
      applyMove(game, mv);
      ply++;
    }
    process.stdout.write(
      `\rGame ${g + 1}/${numGames}, positions=${seen.size}, puzzles=${puzzles.length}   `,
    );
  }
  console.log("");

  const out = {
    version: "1.1",
    generated: new Date().toISOString(),
    totalPuzzles: puzzles.length,
    source: `scripts/gen-puzzles.ts self-play (seed=${seed}, games=${numGames})`,
    puzzles,
  };
  writeFileSync("puzzles.json", JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${puzzles.length} puzzles to puzzles.json`);
}

main();
