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
});
