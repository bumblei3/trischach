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
import { expect, test, describe, beforeEach, vi } from "vitest";
import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import { Piece, PIECE_TYPE } from "../js/pieces.ts";
import { Hex } from "../js/hex.ts";
import { GAME_STATE } from "../js/game.ts";
import {
  serializeGame,
  parseTSPN,
  parseMoveText,
  getResultString,
  cloneGameState,
  ReplayController,
  reconstructGameFromTSPN,
  downloadGame,
  copyGameToClipboard,
  loadGameFromString,
  loadGameFromFile,
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
      {
        id: "p1",
        type: "pawn",
        faction: "fire",
        pos: { q: 0, r: 0 },
        alive: true,
      },
      {
        id: "p2",
        type: "king",
        faction: "water",
        pos: { q: 3, r: 3 },
        alive: true,
      },
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

  test("cloneGameState copies captured pieces for all three factions", () => {
    // Exercises the water/nature branches of the capturedPieces
    // serialization (replay.ts:623-624) that the fire-only move
    // fixtures skip.
    const game = makeGameLike({
      capturedPieces: {
        fire: [{ id: "np1", type: "pawn", faction: "nature" }],
        water: [{ id: "fp1", type: "rook", faction: "fire" }],
        nature: [{ id: "wp1", type: "bishop", faction: "water" }],
      },
    });
    const clone = cloneGameState(game);
    expect(clone.capturedPieces.fire).toEqual(["np1"]);
    expect(clone.capturedPieces.water).toEqual(["fp1"]);
    expect(clone.capturedPieces.nature).toEqual(["wp1"]);
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
      moveHistory: [...makeMoves(), { winner_faction: "fire" }],
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

describe("ReplayController TSPN export", () => {
  let controller;
  beforeEach(() => {
    // Empty history avoids precomputeStates replay; exportTSPN serializes
    // the initial game state, which is what we want to assert here.
    controller = new ReplayController(makeEmptyGame(), []);
  });

  test("exportTSPN emits a parseable TSPN for the initial position", () => {
    const tspn = controller.exportTSPN();
    expect(typeof tspn).toBe("string");
    const parsed = parseTSPN(tspn);
    expect(parsed.headers.Variant).toBe("TriSchach");
  });

  test("exportTSPNFull marks the game over and is parseable", () => {
    const tspn = controller.exportTSPNFull();
    const parsed = parseTSPN(tspn);
    expect(parsed.headers.Variant).toBe("TriSchach");
    expect(parsed.headers.Result).toBeDefined();
  });
});

describe("downloadGame / copyGameToClipboard / loadGameFromString / loadGameFromFile", () => {
  let clickSpy;
  let writeTextSpy;

  beforeEach(() => {
    clickSpy = vi.fn();
    const mockAnchor = {
      click: clickSpy,
      set href(_v) {},
      set download(_v) {},
    };
    vi.spyOn(document, "createElement").mockReturnValue(mockAnchor);
    globalThis.URL = {
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    };
    writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextSpy },
      configurable: true,
    });
  });

  test("downloadGame serializes and triggers a download anchor", () => {
    const game = makeEmptyGame();
    game.moveHistory = makeMoves();
    downloadGame(game, "test.tspn");
    expect(globalThis.URL.createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalled();
  });

  test("copyGameToClipboard writes the serialized TSPN", async () => {
    const game = makeEmptyGame();
    game.moveHistory = makeMoves();
    await copyGameToClipboard(game);
    expect(writeTextSpy).toHaveBeenCalledOnce();
    const written = writeTextSpy.mock.calls[0][0];
    expect(written).toContain('[Variant "TriSchach"]');
  });

  test("loadGameFromString round-trips a serialized game", () => {
    const game = makeEmptyGame();
    game.moveHistory = makeMoves();
    const tspn = serializeGame(game);
    const parsed = loadGameFromString(tspn);
    expect(parsed.moves.length).toBe(2);
  });

  test("loadGameFromFile resolves parsed TSPN via FileReader", async () => {
    const game = makeEmptyGame();
    game.moveHistory = makeMoves();
    const tspn = serializeGame(game);

    const fakeReader = {
      readAsText: vi.fn(function (_file) {
        // Simulate async load
        queueMicrotask(() => this.onload({ target: { result: tspn } }));
      }),
    };
    vi.stubGlobal("FileReader", function () {
      return fakeReader;
    });

    const parsed = await loadGameFromFile({});
    expect(parsed.moves.length).toBe(2);
    vi.unstubAllGlobals();
  });

  test("eliminated faction is preserved through serialize -> parse (real game)", () => {
    // Drive a REAL game to a state where one faction is eliminated, then
    // confirm the elimination marker is written into the TSPN AND correctly
    // round-trips through parseTSPN. This guards the parser against splitting
    // the trailing "[nature eliminated]" annotation into bogus tokens
    // (regression: the annotation used to be shredded into "[nature" /
    // "eliminated]"). Mock-based serialize tests don't exercise the real
    // elimination path through handleCellClick.
    const game = new Game();
    game.init(generateBoard());
    game.rpsEnabled = true;
    // Fire queen captures the Nature king (Fire beats Nature = advantage) ->
    // Nature is eliminated; Water alive so not game over.
    const fireQueen = new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(0, 0));
    const natureKing = new Piece(
      PIECE_TYPE.KING,
      FACTION.NATURE,
      new Hex(0, 1),
    );
    const waterKing = new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(-3, 3));
    game.pieces = [fireQueen, natureKing, waterKing];
    game._rebuildOccupiedMap();
    game.currentFactionIdx = 0;
    game.currentFaction = FACTION.FIRE;
    game.state = GAME_STATE.SELECT_PIECE;

    game.handleCellClick(new Hex(0, 0));
    game.handleCellClick(new Hex(0, 1));
    expect(game.eliminatedFactions.has(FACTION.NATURE)).toBe(true);

    const tspn = serializeGame(game);
    // The elimination must be encoded in the move notation.
    expect(tspn).toContain("[nature eliminated]");

    // Parse back: exactly ONE move, and it carries the elimination marker.
    const parsed = parseTSPN(tspn);
    expect(parsed.moves.length).toBe(1);
    expect(parsed.moves[0].elimination).toBe("nature");
  });

  test("serialize -> reconstruct round-trip replays a saved game (real game)", () => {
    // A TSPN file loaded via parseTSPN carries only faction/pieceName/target
    // (no source square). reconstructGameFromTSPN + ReplayController must still
    // replay it to the final position. Regression guard for the previously
    // broken replay path that required `move.piece` AND passed a non-Hex
    // {q,r} target straight into handleCellClick (which set piece.pos to a
    // plain object and crashed the post-move check detection).
    const game = new Game();
    game.init(generateBoard());
    game.rpsEnabled = true;
    // Play a real opening pawn move on the full starting board.
    const firePawn = game.pieces.find(
      (p) => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.PAWN,
    );
    const startKey = firePawn.pos.key;
    game.handleCellClick(firePawn.pos);
    const target = game.validMoves[0];
    game.handleCellClick(target);
    expect(firePawn.pos.key).toBe(target.key);

    const tspn = serializeGame(game);
    const parsed = parseTSPN(tspn);
    const { controller } = reconstructGameFromTSPN(
      parsed,
      Game,
      generateBoard(),
    );
    controller.goToEnd();
    const finalState = controller.getCurrentState();

    // The reconstructed game replayed the move: the pawn left its start square
    // and now sits on the recorded target square. NOTE: cloneGameState returns
    // pos as a plain {q,r} object (no .key), so compare q/r explicitly.
    const replayedPawn = finalState.pieces.find((p) => p.id === firePawn.id);
    expect(`${replayedPawn.pos.q},${replayedPawn.pos.r}`).toBe(
      `${target.q},${target.r}`,
    );
    // The start square is now empty (pawn moved away).
    const occupant = finalState.pieces.find(
      (p) => `${p.pos.q},${p.pos.r}` === startKey && p.alive,
    );
    expect(occupant?.id === firePawn.id).toBe(false);
  });
});
