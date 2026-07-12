// @ts-nocheck
/**
 * game-callbacks.test.js — exercises the optional event callbacks on Game
 * (onUpdate / onGameOver / onElimination / onPromotion). These `if (cb)` guard
 * branches were uncovered, so they never ran in the suite before.
 */
import { expect, test, describe, beforeEach, vi } from "vitest";
import { Game, GAME_STATE } from "../js/game.ts";
import { FACTION, generateBoard } from "../js/board.ts";
import { Piece, PIECE_TYPE } from "../js/pieces.ts";
import { Hex } from "../js/hex.ts";

describe("Game event callbacks", () => {
  let game;
  let boardCells;

  beforeEach(() => {
    game = new Game();
    boardCells = generateBoard();
    game.init(boardCells);
  });

  test("onUpdate fires after a normal move", () => {
    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 5));
    game.pieces = [firePawn];
    game._rebuildOccupiedMap();

    const onUpdate = vi.fn();
    game.onUpdate = onUpdate;

    game.handleCellClick(firePawn.pos);
    game.handleCellClick(new Hex(0, 4));
    expect(onUpdate).toHaveBeenCalled();
  });

  test("onPromotion fires when a pawn reaches its last rank", () => {
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1));
    game.pieces = [pawn];
    game._rebuildOccupiedMap();

    const onPromotion = vi.fn();
    game.onPromotion = onPromotion;

    game.handleCellClick(pawn.pos);
    const result = game.handleCellClick(new Hex(0, 0));
    expect(result.promotion).toBe(true);
    expect(onPromotion).toHaveBeenCalledTimes(1);
    expect(onPromotion).toHaveBeenCalledWith(pawn);
  });

  test("onGameOver fires with the winning faction when only one remains", () => {
    // Eliminate water + nature up front, fire is the sole survivor
    game.eliminatedFactions.add(FACTION.WATER);
    game.eliminatedFactions.add(FACTION.NATURE);
    game._rebuildOccupiedMap();

    const onGameOver = vi.fn();
    game.onGameOver = onGameOver;

    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 5));
    game.pieces = [firePawn];
    game._rebuildOccupiedMap();

    game.handleCellClick(firePawn.pos);
    const result = game.handleCellClick(new Hex(0, 4));

    expect(result.gameOver).toBe(true);
    expect(result.winner_faction).toBe(FACTION.FIRE);
    expect(onGameOver).toHaveBeenCalledTimes(1);
    expect(onGameOver).toHaveBeenCalledWith(FACTION.FIRE);
  });

  test("onElimination fires when a king is captured in combat", () => {
    // Fire beats Nature (advantage) -> the nature king dies
    const fireRook = new Piece(PIECE_TYPE.ROOK, FACTION.FIRE, new Hex(0, 4));
    const enemyKing = new Piece(PIECE_TYPE.KING, FACTION.NATURE, new Hex(0, 3));
    game.rpsEnabled = true;
    game.pieces = [fireRook, enemyKing];
    game.currentFactionIdx = 0; // fire to move
    game.currentFaction = FACTION.FIRE;
    game._rebuildOccupiedMap();

    const onElimination = vi.fn();
    game.onElimination = onElimination;

    game.handleCellClick(fireRook.pos);
    const result = game.handleCellClick(enemyKing.pos);

    expect(result.action).toBe("combat");
    expect(result.elimination).toBe(FACTION.NATURE);
    expect(onElimination).toHaveBeenCalledTimes(1);
    expect(onElimination).toHaveBeenCalledWith(FACTION.NATURE);
    expect(game.eliminatedFactions.has(FACTION.NATURE)).toBe(true);
  });

  test("callbacks are no-ops (never throw) when left unset", () => {
    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 5));
    game.pieces = [firePawn];
    game._rebuildOccupiedMap();
    game.onUpdate = null;
    game.onGameOver = null;
    game.onPromotion = null;
    game.onElimination = null;

    expect(() => {
      game.handleCellClick(firePawn.pos);
      game.handleCellClick(new Hex(0, 4));
    }).not.toThrow();
  });

  test("onDraw fires with 'repetition' on a threefold-repetition draw", () => {
    // The onDraw callback (game.ts) must report the draw type. Repetition is
    // one of the two draw outcomes; it was never exercised by the callback
    // suite, so the `if (this.onDraw) this.onDraw("repetition")` branch in
    // _updateDrawState stayed dark. Drive a 4-ply loop that returns to the
    // start position a 3rd time (Nature already eliminated, so the turn order
    // is just Fire -> Water) and assert onDraw received "repetition".
    game.rpsEnabled = false;
    game.eliminatedFactions.add(FACTION.NATURE);

    const fireKnight = new Piece(
      PIECE_TYPE.KNIGHT,
      FACTION.FIRE,
      new Hex(0, 0),
    );
    const waterKnight = new Piece(
      PIECE_TYPE.KNIGHT,
      FACTION.WATER,
      new Hex(0, 3),
    );
    game.pieces = [fireKnight, waterKnight];
    game._rebuildOccupiedMap();
    game.currentFactionIdx = 0; // FIRE
    game.currentFaction = FACTION.FIRE;
    game.state = GAME_STATE.SELECT_PIECE;

    const onDraw = vi.fn();
    game.onDraw = onDraw;

    // Seed the start position (as seen by _updateDrawState, currentFactionIdx
    // still 1 when it runs) twice, so the loop's return is the 3rd occurrence.
    game.currentFactionIdx = 1;
    const startHash = game._positionHash();
    game.currentFactionIdx = 0;
    game._positionHistory = new Map([
      [startHash, 2],
      ["some-other-pos", 1],
    ]);

    const play = (from, to) => {
      game.handleCellClick(from);
      return game.handleCellClick(to);
    };
    play(new Hex(0, 0), new Hex(-2, 1)); // Fire out
    play(new Hex(0, 3), new Hex(-1, 2)); // Water out
    play(new Hex(-2, 1), new Hex(0, 0)); // Fire back
    const last = play(new Hex(-1, 2), new Hex(0, 3)); // Water back -> start again

    expect(game.state).toBe(GAME_STATE.DRAW_REPETITION);
    expect(last.draw).toBe(true);
    expect(onDraw).toHaveBeenCalledTimes(1);
    expect(onDraw).toHaveBeenCalledWith("repetition");
  });

  test("onDraw fires with '50move' when the 50-move rule triggers", () => {
    // The second draw outcome: a quiet move that reaches 100 half-moves must
    // invoke onDraw("50move"). Mirrors the repetition case above for the
    // other branch of _updateDrawState. Seed the clock at 99 and play one
    // quiet knight move so it hits 100.
    game.rpsEnabled = false;
    game.eliminatedFactions.add(FACTION.NATURE);

    const fireKnight = new Piece(
      PIECE_TYPE.KNIGHT,
      FACTION.FIRE,
      new Hex(0, 0),
    );
    const waterKnight = new Piece(
      PIECE_TYPE.KNIGHT,
      FACTION.WATER,
      new Hex(0, 3),
    );
    game.pieces = [fireKnight, waterKnight];
    game._rebuildOccupiedMap();
    game.currentFactionIdx = 0; // FIRE
    game.currentFaction = FACTION.FIRE;
    game.state = GAME_STATE.SELECT_PIECE;
    game._halfmoveClock = 99; // one more half-move reaches the 100 limit

    const onDraw = vi.fn();
    game.onDraw = onDraw;

    game.handleCellClick(new Hex(0, 0));
    const result = game.handleCellClick(new Hex(-2, 1));

    expect(result.action).toBe("move");
    expect(game.state).toBe(GAME_STATE.DRAW_50MOVE);
    expect(result.draw).toBe(true);
    expect(onDraw).toHaveBeenCalledTimes(1);
    expect(onDraw).toHaveBeenCalledWith("50move");
  });
});
