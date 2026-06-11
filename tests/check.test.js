import { expect, test, describe, beforeEach } from 'vitest';
import { Game, GAME_STATE } from '../js/game.js';
import { FACTION, generateBoard } from '../js/board.js';
import { Piece, PIECE_TYPE } from '../js/pieces.js';
import { Hex } from '../js/hex.js';

describe('Check Detection', () => {
  let game;
  let boardCells;

  beforeEach(() => {
    game = new Game();
    boardCells = generateBoard();
    game.init(boardCells);
    game.rpsEnabled = false; // Disable RPS for predictable combat
  });

  test('king is not in check at game start', () => {
    expect(game.isKingInCheck(FACTION.FIRE)).toBe(false);
    expect(game.isKingInCheck(FACTION.WATER)).toBe(false);
    expect(game.isKingInCheck(FACTION.NATURE)).toBe(false);
  });

  test('king is in check when enemy queen attacks', () => {
    // Clear board, set up simple position
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0));
    const waterQueen = new Piece(PIECE_TYPE.QUEEN, FACTION.WATER, new Hex(2, 0));
    game.pieces = [fireKing, waterQueen];
    game._rebuildOccupiedMap();

    expect(game.isKingInCheck(FACTION.FIRE)).toBe(true);
    expect(game.isKingInCheck(FACTION.WATER)).toBe(false);
  });

  test('king is in check when enemy rook attacks', () => {
    const natureKing = new Piece(PIECE_TYPE.KING, FACTION.NATURE, new Hex(0, 0));
    const fireRook = new Piece(PIECE_TYPE.ROOK, FACTION.FIRE, new Hex(0, 3));
    game.pieces = [natureKing, fireRook];
    game._rebuildOccupiedMap();

    expect(game.isKingInCheck(FACTION.NATURE)).toBe(true);
  });

  test('king is NOT in check when blocked by friendly piece', () => {
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0));
    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1));
    const waterRook = new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(0, 3));
    game.pieces = [fireKing, firePawn, waterRook];
    game._rebuildOccupiedMap();

    expect(game.isKingInCheck(FACTION.FIRE)).toBe(false);
  });

  test('isKingInCheck returns false when king is dead', () => {
    const waterQueen = new Piece(PIECE_TYPE.QUEEN, FACTION.WATER, new Hex(0, 0));
    game.pieces = [waterQueen];
    game._rebuildOccupiedMap();

    expect(game.isKingInCheck(FACTION.FIRE)).toBe(false);
  });

  test('wouldBeInCheck detects moving into check', () => {
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0));
    const waterRook = new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(0, 3));
    game.pieces = [fireKing, waterRook];
    game._rebuildOccupiedMap();

    // Moving king to (0,1) would put it in rook's line of attack
    expect(game.wouldBeInCheck(fireKing, new Hex(0, 1), FACTION.FIRE)).toBe(true);
    // Moving king to (1,0) is safe (rook attacks along r-axis)
    expect(game.wouldBeInCheck(fireKing, new Hex(1, 0), FACTION.FIRE)).toBe(false);
  });

  test('getLegalMoves excludes moves that leave king in check', () => {
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0));
    const waterRook = new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(0, 3));
    game.pieces = [fireKing, waterRook];
    game._rebuildOccupiedMap();

    const legal = game.getLegalMoves(fireKing);
    // King at (0,0) has 6 neighbors, but (0,1) and (0,-1) are in rook's line
    // Only moves that escape the rook's attack are legal
    const illegalTargets = legal.moves.filter(m => m.equals(new Hex(0, 1)) || m.equals(new Hex(0, -1)));
    expect(illegalTargets.length).toBe(0);
  });

  test('getLegalMoves excludes attacks that leave king in check', () => {
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0));
    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(1, 0));
    const waterRook = new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(0, 3));
    const waterPawn = new Piece(PIECE_TYPE.PAWN, FACTION.WATER, new Hex(2, 0));
    game.pieces = [fireKing, firePawn, waterRook, waterPawn];
    game._rebuildOccupiedMap();

    // Pawn at (1,0) could attack waterPawn at (2,0), but that would expose king
    const legal = game.getLegalMoves(firePawn);
    expect(legal.attacks.some(a => a.equals(new Hex(2, 0)))).toBe(false);
  });
});

describe('Checkmate Detection', () => {
  let game;
  let boardCells;

  beforeEach(() => {
    game = new Game();
    boardCells = generateBoard();
    game.init(boardCells);
    game.rpsEnabled = false;
  });

  test('isCheckmate returns false when king can escape', () => {
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0));
    const waterQueen = new Piece(PIECE_TYPE.QUEEN, FACTION.WATER, new Hex(2, 0));
    game.pieces = [fireKing, waterQueen];
    game._rebuildOccupiedMap();

    expect(game.isKingInCheck(FACTION.FIRE)).toBe(true);
    expect(game.isCheckmate(FACTION.FIRE)).toBe(false); // King can move to (1,0) etc.
  });

  test('isCheckmate returns true in back-rank mate', () => {
    // King at (0,0), enemy rook at (0,2) giving check along r-axis
    // Block 5 of 6 king escape routes with friendly pieces, leave (0,1) open
    // but (0,1) is attacked by the rook, so king can't go there either
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0));
    const firePawn1 = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(1, 0));
    const firePawn2 = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(1, -1));
    const firePawn3 = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, -1));
    const firePawn4 = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(-1, 0));
    const firePawn5 = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(-1, 1));
    // (0,1) is NOT blocked by friendly piece — but it's in rook's line, so moving there is illegal
    const waterRook = new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(0, 2));
    game.pieces = [fireKing, firePawn1, firePawn2, firePawn3, firePawn4, firePawn5, waterRook];
    game._rebuildOccupiedMap();

    expect(game.isKingInCheck(FACTION.FIRE)).toBe(true);
    expect(game.isCheckmate(FACTION.FIRE)).toBe(true);
  });

  test('isCheckmate returns false when piece can block', () => {
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0));
    const fireRook = new Piece(PIECE_TYPE.ROOK, FACTION.FIRE, new Hex(5, 5));
    const waterQueen = new Piece(PIECE_TYPE.QUEEN, FACTION.WATER, new Hex(0, 3));
    game.pieces = [fireKing, fireRook, waterQueen];
    game._rebuildOccupiedMap();

    expect(game.isKingInCheck(FACTION.FIRE)).toBe(true);
    // Fire rook can block at (0,1) or (0,2)
    expect(game.isCheckmate(FACTION.FIRE)).toBe(false);
  });

  test('isStalemate returns false when king has legal moves', () => {
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0));
    const natureKing = new Piece(PIECE_TYPE.KING, FACTION.NATURE, new Hex(5, 5));
    const waterKing = new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(-5, -5));
    game.pieces = [fireKing, natureKing, waterKing];
    game._rebuildOccupiedMap();

    expect(game.isKingInCheck(FACTION.FIRE)).toBe(false);
    expect(game.isStalemate(FACTION.FIRE)).toBe(false); // King can move
  });

  test('isStalemate returns false when in check', () => {
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0));
    const waterRook = new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(0, 2));
    game.pieces = [fireKing, waterRook];
    game._rebuildOccupiedMap();

    expect(game.isKingInCheck(FACTION.FIRE)).toBe(true);
    expect(game.isStalemate(FACTION.FIRE)).toBe(false);
  });
});

describe('Check Resolution in Game Flow', () => {
  let game;
  let boardCells;

  beforeEach(() => {
    game = new Game();
    boardCells = generateBoard();
    game.init(boardCells);
    game.rpsEnabled = false;
  });

  test('move that puts own king in check is blocked', () => {
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0));
    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1));
    const waterRook = new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(0, 3));
    game.pieces = [fireKing, firePawn, waterRook];
    game._rebuildOccupiedMap();

    // Select fire pawn
    game.handleCellClick(firePawn.pos);
    // Try to move pawn away, exposing king to rook
    const result = game.handleCellClick(new Hex(1, 1));

    // The pawn move should be blocked (deselect) because it's not a legal move
    // OR the pawn stays and king remains safe
    expect(game.isKingInCheck(FACTION.FIRE)).toBe(false);
  });

  test('result.inCheck is set after a move that gives check', () => {
    const fireQueen = new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(2, 0));
    const natureKing = new Piece(PIECE_TYPE.KING, FACTION.NATURE, new Hex(0, 0));
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(-5, -5));
    const naturePawn = new Piece(PIECE_TYPE.PAWN, FACTION.NATURE, new Hex(5, 5));
    game.pieces = [fireQueen, natureKing, fireKing, naturePawn];
    game._rebuildOccupiedMap();

    // Fire moves queen to give check to nature king
    game.handleCellClick(fireQueen.pos);
    const result = game.handleCellClick(new Hex(0, 1));

    expect(result.action).toBe('move');
    // After fire's move, it's nature's turn and nature king should be in check
    expect(result.inCheck).toBe(true);
  });

  test('checkmate eliminates the mated faction', () => {
    // Nature King at (0,0), surrounded by 5 friendly pawns on 5 of 6 neighbors.
    // Fire Rook at (0,2) gives check along r-axis.
    // (0,1) is NOT blocked — but it's in rook's line, so king can't go there.
    // Fire Queen at (2,0) moves to (1,0) delivering check on the remaining escape.
    // Nature King has no legal moves = checkmate.
    const natureKing = new Piece(PIECE_TYPE.KING, FACTION.NATURE, new Hex(0, 0));
    const naturePawn2 = new Piece(PIECE_TYPE.PAWN, FACTION.NATURE, new Hex(1, -1));
    const naturePawn3 = new Piece(PIECE_TYPE.PAWN, FACTION.NATURE, new Hex(0, -1));
    const naturePawn4 = new Piece(PIECE_TYPE.PAWN, FACTION.NATURE, new Hex(-1, 0));
    const naturePawn5 = new Piece(PIECE_TYPE.PAWN, FACTION.NATURE, new Hex(-1, 1));
    const naturePawn6 = new Piece(PIECE_TYPE.PAWN, FACTION.NATURE, new Hex(0, 1));
    const fireRook = new Piece(PIECE_TYPE.ROOK, FACTION.FIRE, new Hex(0, 2));
    const fireQueen = new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(2, 0));
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(-5, -5));
    const waterKing = new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(5, 5));
    game.pieces = [natureKing, naturePawn2, naturePawn3, naturePawn4, naturePawn5, naturePawn6, fireRook, fireQueen, fireKing, waterKing];
    game._rebuildOccupiedMap();

    // Fire's turn: move queen from (2,0) to (1,0) delivering checkmate
    // (1,0) is adjacent to nature king — queen gives check
    // King's escape routes: (1,0) [queen], (1,-1) [pawn], (0,-1) [pawn], (-1,0) [pawn], (-1,1) [pawn], (0,1) [pawn]
    // All blocked! And rook at (0,2) covers (0,1) too.
    game.handleCellClick(fireQueen.pos);
    const result = game.handleCellClick(new Hex(1, 0));

    expect(result.action).toBe('move');
    expect(result.checkmate).toBe(FACTION.NATURE);
    expect(game.eliminatedFactions.has(FACTION.NATURE)).toBe(true);
  });
});
