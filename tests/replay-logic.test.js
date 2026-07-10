/**
 * replay-logic.test.js - focused coverage for the TSPN replay/export
 * subsystem in js/replay.ts that the broader UI tests don't exercise:
 *  - serializeGame / parseTSPN / parseMoveText round-trip + edge cases
 *  - getResultString (game-over vs in-progress, winner mapping)
 *  - cloneGameState (independent deep copy)
 *  - ReplayController navigation bounds (next/previous/goTo/goToStart/End)
 *
 * Deterministic and fast (no AI, no DOM).
 */
import { expect, test, describe, beforeEach } from "vitest";
import { Game } from "../js/game.ts";
import { generateBoard } from "../js/board.ts";
import {
  serializeGame,
  parseTSPN,
  parseMoveText,
  getResultString,
  cloneGameState,
  ReplayController,
} from "../js/replay.ts";

// A real Game instance so ReplayController.precomputeStates() can call
// handleCellClick without throwing. Used with an EMPTY move history so the
// navigation bounds are deterministic (no state replay needed).
function makeEmptyGame() {
  const game = new Game();
  game.init(generateBoard());
  return game;
}

// Move-history entries in the SHAPE serializeGame/formatMove expect:
//   move.piece = { faction, type, ... } ; move.to = { q, r } ; move.action
function makeMoves() {
  return [
    {
      piece: { faction: "fire", type: "pawn" },
      to: { q: 1, r: 1 },
      action: "move",
    },
    {
      piece: { faction: "water", type: "king" },
      to: { q: 2, r: 2 },
      action: "move",
    },
  ];
}

function makeGameLike(overrides = {}) {
  return {
    pieces: [
      { id: "p1", type: "pawn", faction: "fire", pos: { q: 0, r: 0 }, alive: true },
      { id: "p2", type: "king", faction: "water", pos: { q: 3, r: 3 }, alive: true },
    ],
    currentFaction: "fire",
    currentFactionIdx: 0,
    state: "playing",
    eliminatedFactions: new Set(),
    rpsEnabled: true,
    capturedPieces: { fire: [], water: [], nature: [] },
    moveHistory: makeMoves(),
    ...overrides,
  };
}

describe("serializeGame / parseTSPN round-trip", () => {
  test("serializeGame emits TSPN headers and move text", () => {
    const game = makeGameLike();
    const tspn = serializeGame(game);
    expect(tspn).toContain('[Event "Casual Game"]');
    expect(tspn).toContain('[RPS "on"]');
    expect(tspn).toContain('[Variant "TriSchach"]');
    expect(tspn).toContain("[Version");
    // The two moves should appear in the body (faction_pieceType_q,r)
    expect(tspn).toContain("fire_Pawn_1,1");
    expect(tspn).toContain("water_King_2,2");
  });

  test("parseTSPN recovers headers and moves", () => {
    const game = makeGameLike();
    const tspn = serializeGame(game);
    const parsed = parseTSPN(tspn);
    expect(parsed.headers.Event).toBe("Casual Game");
    expect(parsed.headers.RPS).toBe("on");
    expect(parsed.moves.length).toBe(2);
    expect(parsed.moves[0].faction).toBe("fire");
    expect(parsed.moves[1].faction).toBe("water");
  });

  test("parseTSPN handles a header-less / move-less string", () => {
    const parsed = parseTSPN("");
    expect(parsed.headers).toEqual({});
    expect(parsed.moves).toEqual([]);
  });

  test("parseMoveText parses the real faction_PieceType_q,r format", () => {
    const moves = parseMoveText("1. fire_Pawn_0,1 2. water_King_2,2");
    expect(moves.length).toBe(2);
    expect(moves[0].faction).toBe("fire");
    expect(moves[0].pieceName).toBe("pawn");
    expect(moves[1].faction).toBe("water");
  });

  test("parseMoveText returns [] for empty input", () => {
    expect(parseMoveText("")).toEqual([]);
    expect(parseMoveText("   ")).toEqual([]);
  });
});

describe("getResultString", () => {
  test("returns * while the game is in progress", () => {
    expect(getResultString(makeGameLike({ state: "playing" }))).toBe("*");
  });

  test("maps the winning faction once the game is over", () => {
    const game = makeGameLike({
      state: "game_over",
      moveHistory: [
        ...makeMoves(),
        { winner_faction: "fire" },
      ],
    });
    expect(getResultString(game)).toBe("1-0-0");
  });

  test("falls back to a draw string when no winner is recorded", () => {
    const game = makeGameLike({
      state: "game_over",
      moveHistory: [...makeMoves()],
    });
    expect(getResultString(game)).toBe("1/2-1/2-1/2");
  });
});

describe("cloneGameState", () => {
  test("produces an independent copy of pieces and factions", () => {
    const game = makeGameLike();
    const clone = cloneGameState(game);
    expect(clone.pieces.length).toBe(2);
    // Mutating the clone must not affect the original
    clone.pieces[0].alive = false;
    clone.eliminatedFactions = ["water"];
    expect(game.pieces[0].alive).toBe(true);
    expect(Array.from(game.eliminatedFactions)).toEqual([]);
  });
});

describe("ReplayController navigation bounds", () => {
  let controller;
  beforeEach(() => {
    // Empty history -> canGoForward is false, getCurrentState returns the
    // single precomputed initial state (states[0]).
    controller = new ReplayController(makeEmptyGame(), []);
  });

  test("getTotalMoves reflects the move history length", () => {
    expect(controller.getTotalMoves()).toBe(0);
  });

  test("getCurrentMoveNumber starts at 0 (index -1)", () => {
    expect(controller.getCurrentMoveNumber()).toBe(0);
  });

  test("next() returns null when already at the end (empty history)", () => {
    expect(controller.next()).toBeNull();
  });

  test("previous() returns null at the start", () => {
    expect(controller.previous()).toBeNull();
  });

  test("goTo rejects out-of-range indices", () => {
    expect(controller.goTo(99)).toBeNull();
    expect(controller.goTo(-5)).toBeNull();
  });

  test("goToStart returns the initial state (not null)", () => {
    const state = controller.goToStart();
    expect(state).not.toBeNull();
    expect(controller.getCurrentMoveNumber()).toBe(0);
  });

  test("goToEnd on empty history lands on the initial state", () => {
    const state = controller.goToEnd();
    expect(state).not.toBeNull();
    expect(controller.getCurrentMoveNumber()).toBe(0);
  });
});
