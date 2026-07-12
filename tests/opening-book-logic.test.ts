/**
 * opening-book-logic.test.js - focused coverage for js/opening-book.ts
 * helpers and book-lookup paths that the AI/UI tests don't isolate:
 *  - buildOpeningBook populates the in-memory OPENING_BOOK (real game hashes)
 *  - inBook / getBookMoves / pickBookMove for "in book" and "not in book"
 *  - parseMove / boardHash branches (also covered lightly in lib-logic.test.js)
 *
 * Uses a real Game so buildOpeningBook's piece-id resolution works.
 */
import { expect, test, describe, beforeEach } from "vitest";
import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import {
  buildOpeningBook,
  inBook,
  getBookMoves,
  pickBookMove,
  boardHash,
  parseMove,
} from "../js/opening-book.ts";
import type { IGame } from "../js/types.ts";

function makeGame() {
  const game = new Game();
  game.init(generateBoard());
  return game;
}

describe("opening book population + lookup", () => {
  beforeEach(() => {
    // buildOpeningBook mutates the module-level OPENING_BOOK; run it once
    // per test so lookups have a populated book to query.
    buildOpeningBook(Game);
  });

  test("a fresh starting position is recognized as being in book", () => {
    const game = makeGame();
    expect(inBook(game)).toBe(true);
  });

  test("getBookMoves returns weighted entries for an in-book position", () => {
    const game = makeGame();
    const moves = getBookMoves(game);
    expect(moves).not.toBeNull();
    expect(Array.isArray(moves)).toBe(true);
    const sorted = moves!;
    expect(sorted.length).toBeGreaterThan(0);
    // Sorted by weight descending
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.weight).toBeLessThanOrEqual(sorted[i - 1]!.weight);
    }
  });

  test("pickBookMove returns a live piece + target for an in-book position", () => {
    const game = makeGame();
    const move = pickBookMove(game);
    expect(move).not.toBeNull();
    const picked = move!;
    expect(picked.piece).toBeDefined();
    expect(picked.piece.alive).toBe(true);
    expect(picked.target).toBeDefined();
    expect(typeof picked.target.q).toBe("number");
  });

  test("a drastically altered position is not in book", () => {
    const game = makeGame();
    // Kill every piece except a single fire king -> hash no longer matches
    // any compiled book position.
    for (const p of game.pieces) {
      if (!(p.faction === FACTION.FIRE && p.type === "king")) {
        p.alive = false;
      }
    }
    game._rebuildOccupiedMap();
    expect(inBook(game)).toBe(false);
    expect(getBookMoves(game)).toBeNull();
    expect(pickBookMove(game)).toBeNull();
  });
});

describe("boardHash / parseMove branches", () => {
  test("boardHash is identical for identical positions", () => {
    const a = makeGame();
    const b = makeGame();
    expect(boardHash(a)).toBe(boardHash(b));
  });

  test("parseMove returns null for an unknown piece id", () => {
    const game = makeGame();
    expect(parseMove(game, "ghost_piece->2,2")).toBeNull();
  });

  test("parseMove returns null for non-numeric coordinates", () => {
    const game = makeGame();
    const pawn = game.pieces.find(
      (p) => p.faction === FACTION.FIRE && p.type === "pawn",
    )!;
    expect(parseMove(game, `${pawn.id}->x,y`)).toBeNull();
  });

  test("boardHash falls back to currentFaction when currentFactionIdx is undefined", () => {
    const game = makeGame();
    // Build a minimal object without currentFactionIdx, with currentFaction set
    const mini = {
      getAlivePieces: () => game.getAlivePieces(),
      pieces: game.pieces,
      currentFaction: FACTION.WATER,
      currentFactionIdx: undefined,
    } as unknown as IGame;
    const hash = boardHash(mini);
    // WATER is index 1 -> hash suffix must be #1
    expect(hash.endsWith("#1")).toBe(true);
  });

  test("boardHash uses index 0 when neither idx nor faction is present", () => {
    const game = makeGame();
    const mini = {
      getAlivePieces: () => game.getAlivePieces(),
      pieces: game.pieces,
      currentFactionIdx: undefined,
      currentFaction: undefined,
    } as unknown as IGame;
    expect(boardHash(mini).endsWith("#0")).toBe(true);
  });
});
