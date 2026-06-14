import { expect, test, describe, beforeEach } from "vitest";
import { calculateBestMove } from "../js/ai.js";
import { Game } from "../js/game.js";
import { FACTION, generateBoard } from "../js/board.js";
import { Piece, PIECE_TYPE } from "../js/pieces.js";
import { Hex } from "../js/hex.js";

describe("AI Decision Making (Minimax)", () => {
  let game;

  beforeEach(() => {
    game = new Game();
    game.init(generateBoard());
    game.pieces = [];
    game._rebuildOccupiedMap();
    game.rpsEnabled = true;
  });

  test("returns null if no pieces or valid moves", () => {
    expect(calculateBestMove(game, FACTION.FIRE)).toBeNull();
  });

  test("prioritizes advantageous attack over moving", () => {
    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1));
    const naturePawn = new Piece(
      PIECE_TYPE.PAWN,
      FACTION.NATURE,
      new Hex(0, 0),
    );
    game.pieces = [firePawn, naturePawn];
    game._rebuildOccupiedMap();

    const action = calculateBestMove(game, FACTION.FIRE);

    expect(action).not.toBeNull();
    expect(action.type).toBe("attack");
    expect(action.target.equals(new Hex(0, 0))).toBe(true);
    expect(action.piece).toBe(firePawn);
  });

  test("avoids disadvantageous attack (suicide)", () => {
    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1));
    const waterPawn = new Piece(PIECE_TYPE.PAWN, FACTION.WATER, new Hex(0, 0));
    game.pieces = [firePawn, waterPawn];
    game._rebuildOccupiedMap();

    const action = calculateBestMove(game, FACTION.FIRE);

    expect(action).not.toBeNull();
    expect(action.type).toBe("move");
    expect(action.target.equals(new Hex(1, 0))).toBe(true);
  });

  test("moves towards the center heuristic", () => {
    const fireKnight = new Piece(
      PIECE_TYPE.KNIGHT,
      FACTION.FIRE,
      new Hex(0, 4),
    );
    game.pieces = [fireKnight];
    game._rebuildOccupiedMap();

    const action = calculateBestMove(game, FACTION.FIRE);

    expect(action).not.toBeNull();
    expect(action.type).toBe("move");

    const distFromCenter = Math.max(
      Math.abs(fireKnight.pos.q),
      Math.abs(fireKnight.pos.r),
      Math.abs(-fireKnight.pos.q - fireKnight.pos.r),
    );
    const distToCenter = Math.max(
      Math.abs(action.target.q),
      Math.abs(action.target.r),
      Math.abs(-action.target.q - action.target.r),
    );

    expect(distToCenter).toBeLessThan(distFromCenter);
  });

  test("handles tied scores by picking randomly from best actions", () => {
    const originalRandom = Math.random;
    Math.random = () => 0;

    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0));
    game.pieces = [fireKing];
    game._rebuildOccupiedMap();

    const action = calculateBestMove(game, FACTION.FIRE);

    expect(action).not.toBeNull();
    expect(action.type).toBe("move");
    expect(action.target.distance(new Hex(0, 0))).toBe(1);

    Math.random = originalRandom;
  });

  test("handles tied attack scores", () => {
    const originalRandom = Math.random;
    Math.random = () => 0;

    const fireQueen = new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(0, 0));
    const n1 = new Piece(PIECE_TYPE.PAWN, FACTION.NATURE, new Hex(1, 0));
    const n2 = new Piece(PIECE_TYPE.PAWN, FACTION.NATURE, new Hex(0, 1));
    game.pieces = [fireQueen, n1, n2];
    game._rebuildOccupiedMap();

    const action = calculateBestMove(game, FACTION.FIRE);
    expect(action.type).toBe("attack");

    Math.random = originalRandom;
  });

  test("handles pieces with no valid attacks", () => {
    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 0));
    game.pieces = [firePawn];
    game._rebuildOccupiedMap();

    const action = calculateBestMove(game, FACTION.FIRE);
    expect(action.type).toBe("move");
  });

  test("handles missing defender in attack loop (branch coverage)", () => {
    // Single pawn with no enemies at all - no attacks possible
    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 0));
    game.pieces = [firePawn];
    game._rebuildOccupiedMap();

    const action = calculateBestMove(game, FACTION.FIRE);
    // No enemies = no attacks, should move
    expect(action).not.toBeNull();
    expect(action.type).toBe("move");
  });

  // ─── New Minimax-specific tests ─────────────────────────────────

  test("minimax: finds winning capture when available", () => {
    // Fire Queen can capture Nature King (advantage) – should do it
    const fireQueen = new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(0, 1));
    const natureKing = new Piece(
      PIECE_TYPE.KING,
      FACTION.NATURE,
      new Hex(0, 0),
    );
    game.pieces = [fireQueen, natureKing];
    game._rebuildOccupiedMap();

    const action = calculateBestMove(game, FACTION.FIRE);
    expect(action).not.toBeNull();
    expect(action.type).toBe("attack");
    expect(action.target.equals(new Hex(0, 0))).toBe(true);
  });

  test("minimax: avoids move that leads to immediate king loss", () => {
    // Fire King at (0,0), Water Queen at (2,0) threatening
    // Fire should move away from the threat
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0));
    const waterQueen = new Piece(
      PIECE_TYPE.QUEEN,
      FACTION.WATER,
      new Hex(2, 0),
    );
    game.pieces = [fireKing, waterQueen];
    game._rebuildOccupiedMap();

    const action = calculateBestMove(game, FACTION.FIRE);
    expect(action).not.toBeNull();
    expect(action.piece).toBe(fireKing);
    // Should move away from Water Queen
    const dist = action.target.distance(waterQueen.pos);
    expect(dist).toBeGreaterThan(1);
  });

  test("minimax: prefers capturing high-value piece over low-value", () => {
    const fireRook = new Piece(PIECE_TYPE.ROOK, FACTION.FIRE, new Hex(0, 0));
    const naturePawn = new Piece(
      PIECE_TYPE.PAWN,
      FACTION.NATURE,
      new Hex(1, 0),
    );
    const natureQueen = new Piece(
      PIECE_TYPE.QUEEN,
      FACTION.NATURE,
      new Hex(-1, 0),
    );
    // Add a dummy king so the game isn't immediately over
    const natureKing = new Piece(
      PIECE_TYPE.KING,
      FACTION.NATURE,
      new Hex(5, 5),
    );
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(-5, 5));
    game.pieces = [fireRook, naturePawn, natureQueen, natureKing, fireKing];
    game._rebuildOccupiedMap();

    const action = calculateBestMove(game, FACTION.FIRE);
    expect(action).not.toBeNull();
    expect(action.type).toBe("attack");
    // Should capture the Queen (higher value) not the Pawn
    const target = game.getPieceAt(action.target);
    expect(target.type).toBe(PIECE_TYPE.QUEEN);
  });

  test("minimax: game state unchanged after AI calculation", () => {
    const fireKnight = new Piece(
      PIECE_TYPE.KNIGHT,
      FACTION.FIRE,
      new Hex(0, 0),
    );
    const naturePawn = new Piece(
      PIECE_TYPE.PAWN,
      FACTION.NATURE,
      new Hex(1, 1),
    );
    game.pieces = [fireKnight, naturePawn];
    game._rebuildOccupiedMap();

    const factionBefore = game.currentFaction;
    const stateBefore = {
      pieces: game.getAlivePieces().map((p) => ({
        type: p.type,
        faction: p.faction,
        q: p.pos.q,
        r: p.pos.r,
        alive: p.alive,
      })),
      eliminated: new Set(game.eliminatedFactions),
      captured: {
        fire: game.capturedPieces[FACTION.FIRE].length,
        water: game.capturedPieces[FACTION.WATER].length,
        nature: game.capturedPieces[FACTION.NATURE].length,
      },
    };

    calculateBestMove(game, FACTION.FIRE);

    // Game state should be unchanged
    expect(game.currentFaction).toBe(factionBefore);
    const stateAfter = {
      pieces: game.getAlivePieces().map((p) => ({
        type: p.type,
        faction: p.faction,
        q: p.pos.q,
        r: p.pos.r,
        alive: p.alive,
      })),
      eliminated: new Set(game.eliminatedFactions),
      captured: {
        fire: game.capturedPieces[FACTION.FIRE].length,
        water: game.capturedPieces[FACTION.WATER].length,
        nature: game.capturedPieces[FACTION.NATURE].length,
      },
    };
    expect(stateAfter).toEqual(stateBefore);
  });

  test("minimax: full game simulation completes without crash", () => {
    // Reset to full board
    game.pieces = [];
    game._rebuildOccupiedMap();
    game.init(generateBoard());

    let moveCount = 0;
    while (game.state !== "game_over" && moveCount < 50) {
      const action = calculateBestMove(game, game.currentFaction);
      if (!action) break;
      game.handleCellClick(action.piece.pos);
      game.handleCellClick(action.target);
      moveCount++;
    }

    expect(moveCount).toBeGreaterThan(0);
  });
});
