/**
 * lib-logic.test.js - focused coverage for small, deterministic helper
 * functions in the TriSchach engine that the broader game/AI tests don't
 * exercise on their own branches:
 *  - opening-book.ts: boardHash (stable hashing, faction-idx resolution),
 *    parseMove (valid / missing-piece / NaN-coordinate paths)
 *  - ai.ts: deserializeGame (state -> Game-like object with methods)
 *  - game-check.ts: isCheckmateInternal / isStalemateInternal early-return
 *    branches when the king is NOT in the expected check state
 *
 * These are fast, dependency-light, and close the last few percentage points
 * on already-high-coverage modules.
 */
import { expect, test, describe, beforeEach } from "vitest";
import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import { Piece, PIECE_TYPE } from "../js/pieces.ts";
import { Hex } from "../js/hex.ts";
import { IGame } from "../js/types.ts";
import { boardHash, parseMove } from "../js/opening-book.ts";
import { deserializeGame } from "../js/ai.ts";
import { isCheckmateInternal, isStalemateInternal } from "../js/game-check.ts";

type DeserializedGame = IGame & { getPieces(): Piece[] };

function makeGame() {
  const game = new Game();
  game.init(generateBoard());
  return game;
}

describe("boardHash (opening-book)", () => {
  test("is stable for the same position", () => {
    const game = makeGame();
    expect(boardHash(game)).toBe(boardHash(game));
  });

  test("encodes the current faction index after the '#'", () => {
    const game = makeGame();
    expect(boardHash(game)).toContain(`#${game.currentFactionIdx}`);
  });

  test("falls back to deriving the faction index from currentFaction", () => {
    const game = makeGame();
    // Drop currentFactionIdx so the resolver uses currentFaction instead.
    const probe = {
      pieces: game.pieces,
      getAlivePieces: () => game.pieces.filter((p: Piece) => p.alive),
      currentFaction: game.currentFaction,
      currentFactionIdx: undefined,
    } as unknown as IGame;
    const hash = boardHash(probe);
    const expectedIdx = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE].indexOf(
      game.currentFaction,
    );
    expect(hash).toContain(`#${expectedIdx}`);
  });

  test("works when getAlivePieces is absent (uses pieces directly)", () => {
    const game = makeGame();
    const probe = {
      pieces: game.pieces,
      currentFactionIdx: game.currentFactionIdx,
    } as unknown as IGame;
    // Should not throw and should still produce a hash with a faction suffix.
    expect(boardHash(probe)).toContain("#");
  });
});

describe("parseMove (opening-book)", () => {
  let game: Game;
  beforeEach(() => {
    game = makeGame();
  });

  test("parses a valid 'pieceId->q,r' move string", () => {
    const pawn = game.pieces.find(
      (p: Piece) => p.type === PIECE_TYPE.PAWN && p.faction === FACTION.FIRE,
    );
    const parsed = parseMove(game, `${pawn!.id}->2,2`);
    expect(parsed).not.toBeNull();
    expect(parsed!.piece.id).toBe(pawn!.id);
    expect(parsed!.target.q).toBe(2);
    expect(parsed!.target.r).toBe(2);
  });

  test("returns null when the piece id is unknown", () => {
    expect(parseMove(game, "does-not-exist->2,2")).toBeNull();
  });

  test("returns null when target coordinates are not numbers", () => {
    const pawn = game.pieces.find(
      (p: Piece) => p.type === PIECE_TYPE.PAWN && p.faction === FACTION.FIRE,
    );
    expect(parseMove(game, `${pawn!.id}->x,y`)).toBeNull();
  });
});

describe("deserializeGame (ai)", () => {
  test("reconstructs a Game-like object with working methods", () => {
    const state = {
      pieces: [
        {
          id: "a",
          type: "pawn",
          faction: "fire",
          pos: { q: 0, r: 0 },
          symbol: "P",
          alive: true,
          hasMoved: false,
        },
        {
          id: "b",
          type: "king",
          faction: "water",
          pos: { q: 3, r: 3 },
          symbol: "K",
          alive: false,
          hasMoved: true,
        },
      ],
      currentFactionIdx: 0,
      currentFaction: "fire",
      state: "playing",
      eliminatedFactions: ["nature"],
      rpsEnabled: true,
      capturedPieces: [],
      _halfmoveClock: 0,
    };

    const game = deserializeGame(state) as unknown as DeserializedGame;
    expect(game.pieces.length).toBe(2);
    expect(game.getAlivePieces().length).toBe(1);
    expect(game.getPieces().length).toBe(2);
    // boardCells is rebuilt from generateBoard() (66 hex cells)
    expect(game.boardCells!.size).toBe(66);
    expect(game.eliminatedFactions.has("nature")).toBe(true);
  });

  test("defaults halfmove clock to 0 when omitted", () => {
    const state = {
      pieces: [
        {
          id: "a",
          type: "pawn",
          faction: "fire",
          pos: { q: 0, r: 0 },
          symbol: "P",
          alive: true,
          hasMoved: false,
        },
      ],
      currentFactionIdx: 1,
      currentFaction: "water",
      state: "playing",
      eliminatedFactions: [],
      rpsEnabled: false,
      capturedPieces: [],
    };
    const game = deserializeGame(state) as unknown as DeserializedGame;
    expect(game._halfmoveClock).toBe(0);
    expect(game.currentFactionIdx).toBe(1);
  });
});

describe("game-check early-return branches", () => {
  let game: Game;
  beforeEach(() => {
    game = new Game();
    game.init(generateBoard());
    game.rpsEnabled = false;
  });

  function setPieces(pieces: Piece[]) {
    game!.pieces = pieces;
    game!._rebuildOccupiedMap();
  }

  test("isCheckmateInternal is false when the king is not in check", () => {
    // Fire king at (0,0); a water rook far away -> no check -> not mate.
    setPieces([
      new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0)),
      new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(5, 5)),
    ]);
    expect(isCheckmateInternal(game, FACTION.FIRE)).toBe(false);
  });

  test("isStalemateInternal is false when the king IS in check", () => {
    // Fire king in check from a rook -> this is check, not stalemate.
    setPieces([
      new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0)),
      new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(0, 2)),
    ]);
    expect(isStalemateInternal(game, FACTION.FIRE)).toBe(false);
  });
});
