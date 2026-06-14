import { expect, test, describe, beforeEach } from "vitest";
import { Game } from "../js/game.js";
import { FACTION, generateBoard, getRPSResult } from "../js/board.js";
import { Piece, PIECE_TYPE } from "../js/pieces.js";
import { Hex } from "../js/hex.js";

describe("RPS Attack Categorization", () => {
  let game;
  let boardCells;

  beforeEach(() => {
    game = new Game();
    boardCells = generateBoard();
    game.init(boardCells);
    game.rpsEnabled = true;
  });

  test("select returns rpsAttacks when RPS is enabled", () => {
    // Set up: Fire queen adjacent to both Nature (advantage) and Water (disadvantage)
    const fireQueen = new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(0, 0));
    const naturePawn = new Piece(
      PIECE_TYPE.PAWN,
      FACTION.NATURE,
      new Hex(1, 0),
    );
    const waterPawn = new Piece(PIECE_TYPE.PAWN, FACTION.WATER, new Hex(-1, 1));
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(5, 5));
    const natureKing = new Piece(
      PIECE_TYPE.KING,
      FACTION.NATURE,
      new Hex(5, -5),
    );
    const waterKing = new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(-5, 5));
    game.pieces = [
      fireQueen,
      naturePawn,
      waterPawn,
      fireKing,
      natureKing,
      waterKing,
    ];
    game._rebuildOccupiedMap();

    const result = game.handleCellClick(fireQueen.pos);

    expect(result.action).toBe("select");
    expect(result.rpsAttacks).not.toBeNull();
    expect(result.rpsAttacks.advantage.length).toBeGreaterThan(0);
    expect(result.rpsAttacks.disadvantage.length).toBeGreaterThan(0);
    // Nature is advantage for Fire
    expect(
      result.rpsAttacks.advantage.some((h) => h.equals(new Hex(1, 0))),
    ).toBe(true);
    // Water is disadvantage for Fire
    expect(
      result.rpsAttacks.disadvantage.some((h) => h.equals(new Hex(-1, 1))),
    ).toBe(true);
  });

  test("select returns null rpsAttacks when RPS is disabled", () => {
    game.rpsEnabled = false;

    const fireQueen = new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(0, 0));
    const naturePawn = new Piece(
      PIECE_TYPE.PAWN,
      FACTION.NATURE,
      new Hex(1, 0),
    );
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(5, 5));
    const natureKing = new Piece(
      PIECE_TYPE.KING,
      FACTION.NATURE,
      new Hex(5, -5),
    );
    const waterKing = new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(-5, 5));
    game.pieces = [fireQueen, naturePawn, fireKing, natureKing, waterKing];
    game._rebuildOccupiedMap();

    const result = game.handleCellClick(fireQueen.pos);

    expect(result.action).toBe("select");
    expect(result.rpsAttacks).toBeNull();
  });

  test("rpsAttacks is null when no attacks possible", () => {
    // Queen completely surrounded by friendly pieces on all 12 sliding paths
    const fireQueen = new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(0, 0));
    // Block all 6 hex directions
    const f1 = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(1, 0));
    const f2 = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(1, -1));
    const f3 = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, -1));
    const f4 = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(-1, 0));
    const f5 = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(-1, 1));
    const f6 = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1));
    // Block all 6 diagonals
    const f7 = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(2, -1));
    const f8 = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(1, -2));
    const f9 = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(-1, -1));
    const f10 = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(-2, 1));
    const f11 = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(-1, 2));
    const f12 = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(1, 1));
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(5, 5));
    const natureKing = new Piece(
      PIECE_TYPE.KING,
      FACTION.NATURE,
      new Hex(5, -5),
    );
    const waterKing = new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(-5, 5));
    game.pieces = [
      fireQueen,
      f1,
      f2,
      f3,
      f4,
      f5,
      f6,
      f7,
      f8,
      f9,
      f10,
      f11,
      f12,
      fireKing,
      natureKing,
      waterKing,
    ];
    game._rebuildOccupiedMap();

    const result = game.handleCellClick(fireQueen.pos);

    // All paths blocked = no attacks
    expect(result.attacks.length).toBe(0);
    expect(result.rpsAttacks.advantage.length).toBe(0);
    expect(result.rpsAttacks.disadvantage.length).toBe(0);
    expect(result.rpsAttacks.neutral.length).toBe(0);
  });

  test("rpsAttacks correctly categorizes multiple enemies", () => {
    // Fire queen at (0,0), Nature pawn at (1,0) [advantage], Water pawn at (-1,1) [disadvantage]
    const fireQueen = new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(0, 0));
    const naturePawn = new Piece(
      PIECE_TYPE.PAWN,
      FACTION.NATURE,
      new Hex(1, 0),
    );
    const waterPawn = new Piece(PIECE_TYPE.PAWN, FACTION.WATER, new Hex(-1, 1));
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(5, 5));
    const natureKing = new Piece(
      PIECE_TYPE.KING,
      FACTION.NATURE,
      new Hex(5, -5),
    );
    const waterKing = new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(-5, 5));
    game.pieces = [
      fireQueen,
      naturePawn,
      waterPawn,
      fireKing,
      natureKing,
      waterKing,
    ];
    game._rebuildOccupiedMap();

    const result = game.handleCellClick(fireQueen.pos);

    expect(result.rpsAttacks.advantage.length).toBe(1);
    expect(result.rpsAttacks.advantage[0].equals(new Hex(1, 0))).toBe(true);
    expect(result.rpsAttacks.disadvantage.length).toBe(1);
    expect(result.rpsAttacks.disadvantage[0].equals(new Hex(-1, 1))).toBe(true);
    expect(result.rpsAttacks.neutral.length).toBe(0);
  });

  test("getRPSResult is consistent with categorizeAttacks", () => {
    // Verify that the RPS results match expectations
    expect(getRPSResult(FACTION.FIRE, FACTION.NATURE)).toBe("advantage");
    expect(getRPSResult(FACTION.FIRE, FACTION.WATER)).toBe("disadvantage");
    expect(getRPSResult(FACTION.FIRE, FACTION.FIRE)).toBe("neutral");
    expect(getRPSResult(FACTION.WATER, FACTION.FIRE)).toBe("advantage");
    expect(getRPSResult(FACTION.NATURE, FACTION.WATER)).toBe("advantage");
    expect(getRPSResult(FACTION.WATER, FACTION.NATURE)).toBe("disadvantage");
  });
});
