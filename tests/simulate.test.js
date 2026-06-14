import { expect, test, describe, beforeEach } from "vitest";
import { Game } from "../js/game.js";
import { FACTION, generateBoard } from "../js/board.js";
import { Piece, PIECE_TYPE } from "../js/pieces.js";
import { Hex } from "../js/hex.js";

describe("simulateMove / undoMove", () => {
  let game;

  beforeEach(() => {
    game = new Game();
    game.init(generateBoard());
    game.pieces = [];
    game._rebuildOccupiedMap();
    game.rpsEnabled = true;
  });

  test("simulateMove: normal move can be undone", () => {
    const p = new Piece(PIECE_TYPE.KNIGHT, FACTION.FIRE, new Hex(0, 0));
    game.pieces = [p];
    game._rebuildOccupiedMap();

    const undo = game.simulateMove(p, new Hex(1, 0));
    expect(p.pos.equals(new Hex(1, 0))).toBe(true);
    expect(p.hasMoved).toBe(true);

    game.undoMove(undo);
    expect(p.pos.equals(new Hex(0, 0))).toBe(true);
    expect(p.hasMoved).toBe(false);
  });

  test("simulateMove: attack (advantage) can be undone", () => {
    const attacker = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1));
    const defender = new Piece(PIECE_TYPE.PAWN, FACTION.NATURE, new Hex(0, 0));
    game.pieces = [attacker, defender];
    game._rebuildOccupiedMap();

    const undo = game.simulateMove(attacker, new Hex(0, 0));
    expect(defender.alive).toBe(false);
    expect(attacker.pos.equals(new Hex(0, 0))).toBe(true);

    game.undoMove(undo);
    expect(defender.alive).toBe(true);
    expect(attacker.pos.equals(new Hex(0, 1))).toBe(true);
  });

  test("simulateMove: attack (disadvantage) can be undone", () => {
    const attacker = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1));
    const defender = new Piece(PIECE_TYPE.PAWN, FACTION.WATER, new Hex(0, 0));
    game.pieces = [attacker, defender];
    game._rebuildOccupiedMap();

    const undo = game.simulateMove(attacker, new Hex(0, 0));
    expect(attacker.alive).toBe(false);
    expect(defender.alive).toBe(true);

    game.undoMove(undo);
    expect(attacker.alive).toBe(true);
    expect(attacker.pos.equals(new Hex(0, 1))).toBe(true);
  });

  test("simulateMove: king elimination can be undone", () => {
    const attacker = new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(0, 1));
    const enemyKing = new Piece(PIECE_TYPE.KING, FACTION.NATURE, new Hex(0, 0));
    const extraPiece = new Piece(
      PIECE_TYPE.PAWN,
      FACTION.NATURE,
      new Hex(1, 0),
    );
    game.pieces = [attacker, enemyKing, extraPiece];
    game._rebuildOccupiedMap();

    const undo = game.simulateMove(attacker, new Hex(0, 0));
    expect(enemyKing.alive).toBe(false);
    expect(extraPiece.alive).toBe(false);
    expect(game.eliminatedFactions.has(FACTION.NATURE)).toBe(true);

    game.undoMove(undo);
    expect(enemyKing.alive).toBe(true);
    expect(extraPiece.alive).toBe(true);
    expect(game.eliminatedFactions.has(FACTION.NATURE)).toBe(false);
  });

  test("simulateMove: turn order advances and restores", () => {
    const p = new Piece(PIECE_TYPE.KNIGHT, FACTION.FIRE, new Hex(0, 0));
    game.pieces = [p];
    game._rebuildOccupiedMap();
    expect(game.currentFaction).toBe(FACTION.FIRE);

    const undo = game.simulateMove(p, new Hex(1, 0));
    expect(game.currentFaction).not.toBe(FACTION.FIRE);

    game.undoMove(undo);
    expect(game.currentFaction).toBe(FACTION.FIRE);
  });

  test("multiple simulate/undo cycles are stable", () => {
    const p = new Piece(PIECE_TYPE.KNIGHT, FACTION.FIRE, new Hex(0, 0));
    game.pieces = [p];
    game._rebuildOccupiedMap();

    for (let i = 0; i < 5; i++) {
      const undo = game.simulateMove(p, new Hex(1, 0));
      game.undoMove(undo);
    }

    expect(p.pos.equals(new Hex(0, 0))).toBe(true);
    expect(p.hasMoved).toBe(false);
  });

  test("capturedPieces restored after undo", () => {
    const attacker = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1));
    const defender = new Piece(PIECE_TYPE.PAWN, FACTION.NATURE, new Hex(0, 0));
    game.pieces = [attacker, defender];
    game._rebuildOccupiedMap();

    const undo = game.simulateMove(attacker, new Hex(0, 0));
    expect(game.capturedPieces[FACTION.FIRE].length).toBe(1);

    game.undoMove(undo);
    expect(game.capturedPieces[FACTION.FIRE].length).toBe(0);
  });
});
