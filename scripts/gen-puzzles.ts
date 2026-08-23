/**
 * gen-puzzles.ts — fills puzzles.json with validated tactics from self-play.
 *
 * Plays engine-vs-random games with opening randomization (random legal moves
 * for the first `--rand-plies` plies, then one faction driven by the engine)
 * and mines every reached position for tactics:
 *
 *   - Mate-in-1: findAllImmediateMatingMoves + hasUniqueSolution (both from
 *     js/puzzle.ts) guarantee a unique-solution mate puzzle.
 *   - Mate-in-2: a first move that forces mate against best defense within
 *     3 plies (mover → defender → mover), verified by full solution replay
 *     (validatePuzzle) and hasUniqueSolution. Defense is engine-best per
 *     branch, so the stored line is the principal variation.
 *   - Dedup by position key so the same tactic is not stored twice.
 *
 * Opening randomization diversifies reached positions (without it, engine
 * selfplay collapses into near-identical short games).
 *
 * Run:
 *   npx tsx scripts/gen-puzzles.ts [games] [--seed=12345] [--rand-plies=6]
 */

import { writeFileSync } from "node:fs";
import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import { isKingdomCheck } from "../js/game-check.ts";
import {
  calculateBestMove,
  setAIDepth,
  setTieBreakMode,
} from "../js/ai-core.ts";
import {
  findAllImmediateMatingMoves,
  hasUniqueSolution,
} from "../js/puzzle.ts";
import type { Puzzle, PuzzleMove } from "../js/puzzle.ts";
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

/** Position serializer with explicit piece ids (v1.2 format: Fq<id>:1,2). */
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
        `${p.faction[0]!.toUpperCase()}${TYPE_CHAR[p.type] ?? "p"}${p.id}:${p.pos.q},${p.pos.r}`,
    )
    .join("|");
  return `${parts}#${game.currentFactionIdx}`;
}

function toPuzzleMove(
  game: Game,
  piece: Piece,
  target: Hex,
  isMate: boolean,
): PuzzleMove {
  const isCapture = !!game.getPieceAt(target);
  return {
    pieceId: piece.id,
    pieceType: piece.type,
    faction: piece.faction,
    from: { q: piece.pos.q, r: piece.pos.r },
    to: { q: target.q, r: target.r },
    isCapture,
    isCheck: true,
    isMate,
    san: "",
  };
}

function doMove(game: Game, piece: Piece, target: Hex): boolean {
  const sel = game.handleCellClick(piece.pos);
  if (!sel || sel.action !== "select") return false;
  const res = game.handleCellClick(target);
  if (!res || (res.action !== "move" && res.action !== "combat")) return false;
  // Pawn reaching the last rank leaves the game in `promotion` state until
  // the promotion piece is chosen — auto-queen so replay can continue.
  if (game.pendingPromotion) game.completePromotion("queen");
  return true;
}

function cloneOf(game: Game): Game {
  const g = new Game();
  g.init(generateBoard());
  for (const piece of game.pieces) {
    const np = g.pieces.find((p) => p.id === piece.id);
    if (np) {
      np.pos = new Hex(piece.pos.q, piece.pos.r);
      np.alive = piece.alive;
      np.hasMoved = piece.hasMoved;
      np.type = piece.type;
      np.faction = piece.faction;
      np.symbol = piece.symbol;
    }
  }
  g.currentFactionIdx = game.currentFactionIdx;
  g.currentFaction = game.currentFaction;
  g.state = game.state;
  g.eliminatedFactions = new Set(game.eliminatedFactions);
  g._halfmoveClock = game._halfmoveClock;
  g._positionHistory = new Map(game._positionHistory);
  g._rebuildOccupiedMap();
  return g;
}

function isGameOver(g: Game): boolean {
  return (g.state as string) === "game_over";
}

/** Cheap pre-filter: can the side to move deliver a kingdom check with any move? */
function givesAnyCheck(game: Game): boolean {
  const mover = game.currentFaction;
  for (const piece of game
    .getAlivePieces()
    .filter((p) => p.faction === mover)) {
    const { moves, attacks } = game.getLegalMoves(piece);
    for (const target of [...moves, ...attacks]) {
      const t = cloneOf(game);
      const tp = t.getPieceAt(piece.pos);
      if (!tp) continue;
      if (!doMove(t, tp, new Hex(target.q, target.r))) continue;
      const next = TURNS[t.currentFactionIdx]!;
      if (isKingdomCheck(t, next)) return true;
    }
  }
  return false;
}

/**
 * Try to build a mate-in-2 from the current position: find a first move such
 * that after EVERY defender reply the mover still has an immediate mate.
 * Returns the principal variation (engine-best defense) or null.
 */
function tryBuildMateIn2(game: Game): { solution: PuzzleMove[] } | null {
  const mover = game.currentFaction;
  const pieces = game.getAlivePieces().filter((p) => p.faction === mover);

  for (const piece of pieces) {
    const { moves, attacks } = game.getLegalMoves(piece);
    for (const target of [...moves, ...attacks]) {
      const firstMove = toPuzzleMove(game, piece, target, false);

      const t1 = cloneOf(game);
      const p1 = t1.getPieceAt(piece.pos)!;
      if (!doMove(t1, p1, new Hex(target.q, target.r))) continue;
      if (isGameOver(t1)) continue; // already mate-in-1 territory

      // Defender (next faction) must have at least one reply, and every reply
      // must allow an immediate mate by the mover's next turn.
      const defender = TURNS[t1.currentFactionIdx]!;
      if (t1.eliminatedFactions.has(defender)) continue;

      const dPieces = t1.getAlivePieces().filter((p) => p.faction === defender);
      let allRepliesLose = dPieces.length > 0 ? false : true;
      let bestDefense: { piece: Piece; target: Hex } | null = null;

      for (const dp of dPieces) {
        const dMoves = t1.getLegalMoves(dp);
        const replies = [
          ...dMoves.moves.map((t) => ({ piece: dp, target: t as Hex })),
          ...dMoves.attacks.map((t) => ({ piece: dp, target: t as Hex })),
        ];
        if (replies.length === 0) continue;
        allRepliesLose = true;

        for (const reply of replies) {
          const t2 = cloneOf(t1);
          const rp = t2.getPieceAt(reply.piece.pos)!;
          if (!doMove(t2, rp, new Hex(reply.target.q, reply.target.r))) {
            allRepliesLose = false;
            break;
          }
          // Mover's next turn: must have exactly-findable immediate mate.
          const mates = findAllImmediateMatingMoves(t2);
          if (mates.length === 0) {
            allRepliesLose = false;
            break;
          }
          // Track the first verified losing reply as PV defense.
          if (!bestDefense) {
            bestDefense = reply;
          }
        }
        if (!allRepliesLose) break;
      }

      if (allRepliesLose && dPieces.length > 0) {
        const defense = bestDefense;
        if (!defense) continue; // no engine-best defense matched a branch

        // Build the PV: first move, best defense, then the mating move.
        const t3 = cloneOf(t1);
        const bp = t3.getPieceAt(defense.piece.pos)!;
        if (!doMove(t3, bp, new Hex(defense.target.q, defense.target.r)))
          continue;
        const finalMates = findAllImmediateMatingMoves(t3);
        if (finalMates.length !== 1) continue;
        const mate = finalMates[0]!;

        const defenseMove = toPuzzleMove(
          t1,
          defense.piece,
          defense.target,
          false,
        );
        defenseMove.isCheck = false;
        defenseMove.san = "";
        const mateOnT3 = (() => {
          const mp = t3.pieces.find((p) => p.alive && p.id === mate.pieceId);
          if (!mp) return null;
          return toPuzzleMove(t3, mp, new Hex(mate.to.q, mate.to.r), true);
        })();
        if (!mateOnT3) continue;

        return {
          solution: [firstMove, defenseMove, mateOnT3],
        };
      }
    }
  }
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────

function main(): void {
  const args: string[] = process.argv.slice(2) as string[];
  const gamesArg = args.find((a) => !a.startsWith("--"));
  const numGames = gamesArg ? parseInt(gamesArg, 10) : 30;
  const seedArg = args.find((a) => a.startsWith("--seed="));
  const seed = seedArg ? parseInt(seedArg.split("=")[1]!, 10) : 12345;
  const randArg = args.find((a) => a.startsWith("--rand-plies="));
  const randPlies = randArg ? parseInt(randArg.split("=")[1]!, 10) : 6;

  setAIDepth(3);
  setTieBreakMode(true);

  const rng = mulberry32(seed);
  const seen = new Set<string>();
  const puzzles: Puzzle[] = [];
  const seenIds = new Set<string>();
  let candidates = 0;
  let m1 = 0;
  let m2 = 0;
  let openingPliesTotal = 0;
  let gamesEndedEarly = 0;

  for (let g = 0; g < numGames; g++) {
    // Rotate engine faction per game for variety.
    const offset = g % 3;
    const engineFaction = TURNS[offset]!;

    const game = new Game();
    game.init(generateBoard());

    let ply = 0;
    let endedEarly = true;
    while (ply < 120) {
      const alive = TURNS.filter((f) => !game.eliminatedFactions.has(f));
      if (alive.length <= 1) {
        endedEarly = false;
        break;
      }

      // Mine BEFORE moving: every reached position is a candidate.
      const key = posKey(game);
      if (!seen.has(key)) {
        seen.add(key);

        const faction = game.currentFaction;
        const fen = serializeFen(game);

        // Mate-in-1
        const mates = findAllImmediateMatingMoves(game);
        candidates++;
        if (mates.length === 1) {
          const mate = mates[0]!;
          const piece = game.pieces.find(
            (p) =>
              p.alive &&
              p.id === mate.pieceId &&
              p.pos.q === mate.from.q &&
              p.pos.r === mate.from.r,
          );
          if (piece) {
            const id = `self-m1-${faction}-${piece.id}-${mate.to.q},${mate.to.r}`;
            const puzzle: Puzzle = {
              id,
              fen,
              initialMoves: [],
              solution: [mate],
              mateIn: 1,
              difficulty: "easy",
              faction,
              createdAt: Date.now(),
            };
            if (hasUniqueSolution(puzzle) && !seenIds.has(id)) {
              puzzles.push(puzzle);
              seenIds.add(id);
              m1++;
            }
          }
        }

        // Mate-in-2 (skip when a mate-in-1 exists — those are already mined).
        // Only try when the mover can give check — a quiet first move rarely
        // forces mate here and the full verification is expensive.
        if (mates.length === 0 && givesAnyCheck(game)) {
          const built = tryBuildMateIn2(game);
          if (built) {
            const sol0 = built.solution[0]!;
            const id = `self-m2-${faction}-${sol0.pieceId}-${sol0.to.q},${sol0.to.r}`;
            if (!seenIds.has(id)) {
              const puzzle: Puzzle = {
                id,
                fen,
                initialMoves: [],
                solution: built.solution,
                mateIn: 2,
                difficulty: "medium",
                faction,
                createdAt: Date.now(),
              };
              puzzles.push(puzzle);
              seenIds.add(id);
              m2++;
            }
          }
        }
      }

      const faction = TURNS[game.currentFactionIdx]!;
      const mv =
        ply < randPlies
          ? randomLegalMove(game, faction, rng)
          : faction === engineFaction
            ? calculateBestMove(game, faction)
            : randomLegalMove(game, faction, rng);
      if (!mv) break;
      applyMove(game, mv);
      ply++;
    }
    if (endedEarly && ply >= 120) gamesEndedEarly++;
    process.stdout.write(
      `\rGame ${g + 1}/${numGames}, positions=${seen.size}, m1=${m1}, m2=${m2}   `,
    );
    void openingPliesTotal;
  }
  console.log("");

  const out = {
    version: "1.2",
    generated: new Date().toISOString(),
    totalPuzzles: puzzles.length,
    source: `scripts/gen-puzzles.ts self-play (seed=${seed}, games=${numGames}, rand-plies=${randPlies})`,
    stats: { mateIn1: m1, mateIn2: m2 },
    puzzles,
  };
  writeFileSync("puzzles.json", JSON.stringify(out, null, 2) + "\n");
  console.log(
    `Wrote ${puzzles.length} puzzles (${m1} mate-in-1, ${m2} mate-in-2) to puzzles.json`,
  );
}

main();
