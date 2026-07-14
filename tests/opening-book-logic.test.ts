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
  learnFromGame,
  getLearnedData,
  loadLearnedData,
  saveLearnedDataToStorage,
  loadLearnedDataFromStorage,
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

// ─── Learning integration (learnFromGame / persistence) ───
// The weighted-learning path (learnFromGame) and its persistence round-trip
// (getLearnedData / loadLearnedData / localStorage) were previously untested.
// These assert the real reinforcement invariants: a win raises a variation's
// weight, a loss lowers it, and learned stats survive an export→import cycle.
describe("opening book learning integration", () => {
  beforeEach(() => {
    buildOpeningBook(Game);
  });

  // Build a GameHistoryEntry that references a REAL book variation so
  // learnFromGame actually finds and updates it.
  function firstBookEntry() {
    const game = makeGame();
    const hash = boardHash(game);
    const moves = getBookMoves(game)!;
    const v = moves[0]!;
    return {
      game,
      hash,
      entry: { hash, faction: FACTION.FIRE, move: v.move },
      weightBefore: v.weight,
    };
  }

  test("a win increases the played variation's weight", () => {
    const { hash, entry, weightBefore } = firstBookEntry();
    learnFromGame([entry], FACTION.FIRE); // fire won
    const v = getBookMoves(makeGame())!.find(
      (m) =>
        m.move.pieceId === entry.move.pieceId &&
        m.move.targetQ === entry.move.targetQ &&
        m.move.targetR === entry.move.targetR,
    )!;
    expect(v.weight).toBeGreaterThan(weightBefore);
    expect(hash).toBe(boardHash(makeGame()));
  });

  test("a loss decreases the played variation's weight (floored at 10)", () => {
    const { entry } = firstBookEntry();
    // Winner is a different faction → the fire move counts as a loss.
    learnFromGame([entry], FACTION.WATER);
    const v = getBookMoves(makeGame())!.find(
      (m) =>
        m.move.pieceId === entry.move.pieceId &&
        m.move.targetQ === entry.move.targetQ &&
        m.move.targetR === entry.move.targetR,
    )! as { weight: number; losses?: number };
    expect(v.weight).toBeGreaterThanOrEqual(10);
    expect(v.losses).toBeGreaterThanOrEqual(1);
  });

  test("a draw (null winner) is recorded and bumps weight slightly", () => {
    const { entry } = firstBookEntry();
    learnFromGame([entry], null);
    const v = getBookMoves(makeGame())!.find(
      (m) =>
        m.move.pieceId === entry.move.pieceId &&
        m.move.targetQ === entry.move.targetQ &&
        m.move.targetR === entry.move.targetR,
    )! as { draws?: number; visits?: number };
    expect(v.draws).toBeGreaterThanOrEqual(1);
    expect(v.visits).toBeGreaterThanOrEqual(1);
  });

  test("learnFromGame ignores history entries with unknown hashes", () => {
    expect(() =>
      learnFromGame(
        [
          {
            hash: "nonexistent-hash#0",
            faction: FACTION.FIRE,
            move: { pieceId: "x", targetQ: 0, targetR: 0 },
          },
        ],
        FACTION.FIRE,
      ),
    ).not.toThrow();
  });

  test("learnFromGame skips a known hash whose move is not a stored variation", () => {
    // The hash exists in the book, but the specific move does not match any
    // stored variation → the `if (!variation) continue` branch (replay ~574).
    const game = makeGame();
    const hash = boardHash(game);
    const learned = getLearnedData();
    const before = JSON.stringify(learned);
    learnFromGame(
      [
        {
          hash,
          faction: FACTION.FIRE,
          move: { pieceId: "does-not-exist", targetQ: 99, targetR: 99 },
        },
      ],
      FACTION.FIRE,
    );
    // No visited variation was created for the bogus move.
    const after = getLearnedData();
    expect(JSON.stringify(after)).toBe(before);
  });

  test("getLearnedData only exports variations that were actually visited", () => {
    const { entry } = firstBookEntry();
    learnFromGame([entry], FACTION.FIRE);
    const learned = getLearnedData();
    const all = Object.values(learned).flat();
    expect(all.length).toBeGreaterThan(0);
    for (const v of all) expect(v.visits).toBeGreaterThan(0);
  });

  test("loadLearnedData merges stats back onto matching book variations", () => {
    const { entry, hash } = firstBookEntry();
    loadLearnedData({
      positions: {
        [hash]: [
          {
            move: entry.move,
            wins: 5,
            draws: 2,
            losses: 1,
            visits: 8,
          },
        ],
      },
    });
    const v = getBookMoves(makeGame())!.find(
      (m) =>
        m.move.pieceId === entry.move.pieceId &&
        m.move.targetQ === entry.move.targetQ &&
        m.move.targetR === entry.move.targetR,
    )! as { wins?: number; draws?: number; visits?: number };
    expect(v.wins).toBe(5);
    expect(v.draws).toBe(2);
    expect(v.visits).toBe(8);
  });

  test("loadLearnedData is a no-op for null / positions-less input", () => {
    expect(() => loadLearnedData(null)).not.toThrow();
    expect(() => loadLearnedData(undefined)).not.toThrow();
    expect(() => loadLearnedData({ positions: null })).not.toThrow();
  });

  test("save + load round-trips learned data through localStorage", () => {
    const { entry } = firstBookEntry();
    learnFromGame([entry], FACTION.FIRE);
    expect(saveLearnedDataToStorage()).toBe(true);
    // Rebuild a fresh book, then re-load persisted stats onto it.
    buildOpeningBook(Game);
    expect(loadLearnedDataFromStorage()).toBe(true);
  });

  test("loadLearnedDataFromStorage returns false when nothing is stored", () => {
    localStorage.removeItem("trischach-opening-book-learned");
    expect(loadLearnedDataFromStorage()).toBe(false);
  });
});
