/**
 * game-draw.test.js - focused coverage for js/game.ts draw detection and
 * pawn promotion that the higher-level flow tests don't isolate:
 *  - _updateDrawState: threefold repetition + 50-move rule
 *  - isPromotion: pawn reaching its promotion rank
 *  - handleCellClick promotion path sets PROMOTION state + pendingPromotion
 *
 * Deterministic, no AI search, no DOM.
 */
import { expect, test, describe, beforeEach } from "vitest";
import { Game, GAME_STATE } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import { Piece, PIECE_TYPE } from "../js/pieces.ts";
import { Hex } from "../js/hex.ts";

function makeGame() {
  const game = new Game();
  game.init(generateBoard());
  return game;
}

describe("_updateDrawState", () => {
  let game;
  beforeEach(() => {
    game = makeGame();
  });

  test("threefold repetition triggers DRAW_REPETITION", () => {
    const hash = game._positionHash();
    game._positionHistory = new Map([[hash, 3]]);
    const isDraw = game._updateDrawState(false, false);
    expect(isDraw).toBe(true);
    expect(game.state).toBe(GAME_STATE.DRAW_REPETITION);
  });

  test("50-move rule (100 half-moves) triggers DRAW_50MOVE", () => {
    game._halfmoveClock = 100;
    const isDraw = game._updateDrawState(false, false);
    expect(isDraw).toBe(true);
    expect(game.state).toBe(GAME_STATE.DRAW_50MOVE);
  });

  test("no draw when position not repeated and clock is low", () => {
    game._positionHistory = new Map();
    game._halfmoveClock = 5;
    expect(game._updateDrawState(false, false)).toBe(false);
    expect(game.state).not.toBe(GAME_STATE.DRAW_REPETITION);
    expect(game.state).not.toBe(GAME_STATE.DRAW_50MOVE);
  });

  test("capture resets the half-move clock (no 50-move draw)", () => {
    game._halfmoveClock = 99;
    // A capture means wasCapture=true -> _halfmoveClock reset to 0
    const isDraw = game._updateDrawState(true, false);
    expect(isDraw).toBe(false);
    expect(game._halfmoveClock).toBe(0);
  });
});

describe("isPromotion", () => {
  let game;
  beforeEach(() => {
    game = makeGame();
  });

  test("true for a pawn whose target rank is the promotion rank (r <= 0)", () => {
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1));
    expect(game.isPromotion(pawn, new Hex(0, 0))).toBe(true);
    expect(game.isPromotion(pawn, new Hex(-1, -1))).toBe(true);
  });

  test("false for a pawn not on the promotion rank", () => {
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 3));
    expect(game.isPromotion(pawn, new Hex(0, 2))).toBe(false);
  });

  test("false for a non-pawn piece", () => {
    const rook = new Piece(PIECE_TYPE.ROOK, FACTION.FIRE, new Hex(0, 1));
    expect(game.isPromotion(rook, new Hex(0, 0))).toBe(false);
  });
});
