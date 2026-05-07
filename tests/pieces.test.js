import { expect, test, describe } from 'vitest';
import { getValidMoves, PIECE_TYPE, Piece } from '../js/pieces.js';
import { Hex } from '../js/hex.js';
import { FACTION, generateBoard } from '../js/board.js';

describe('Piece movements', () => {
  // Mock board logic
  const mockCells = new Map();
  // Create a 5-radius hex grid locally to simulate a board
  for (let q = -5; q <= 5; q++) {
    for (let r = -5; r <= 5; r++) {
      if (Math.abs(-q - r) <= 5) {
        mockCells.set(`${q},${r}`, { hex: new Hex(q, r), zone: 'triangle' });
      }
    }
  }

  test('Pawn basic movement', () => {
    const pawn = { 
      type: PIECE_TYPE.PAWN, 
      faction: FACTION.FIRE, 
      pos: new Hex(0, 5), 
      hasMoved: false,
      forwardDir: new Hex(0, -1) // Fire moves up
    };
    
    const { moves, attacks } = getValidMoves(pawn, mockCells, []);
    
    // Pawn can move 1 step in 2 forward directions, plus 1 double-step in the primary forward direction
    expect(moves.length).toBe(3);
    expect(moves.some(m => m.equals(new Hex(0, 4)))).toBe(true);
    expect(moves.some(m => m.equals(new Hex(0, 3)))).toBe(true);
    expect(attacks.length).toBe(0);
  });

  test('Pawn attacks diagonally', () => {
    const pawn = { 
      type: PIECE_TYPE.PAWN, 
      faction: FACTION.FIRE, 
      pos: new Hex(0, 2), 
      hasMoved: true,
      forwardDir: new Hex(0, -1)
    };
    
    const enemy = {
      type: PIECE_TYPE.PAWN,
      faction: FACTION.WATER,
      pos: new Hex(1, 1), // Diagonal to the right
      alive: true
    };
    
    const { moves, attacks } = getValidMoves(pawn, mockCells, [enemy]);
    
    expect(moves.length).toBe(1); // 1 step forward
    expect(moves[0].equals(new Hex(0, 1))).toBe(true);
    expect(attacks.length).toBe(1); // 1 attack
    expect(attacks[0].equals(new Hex(1, 1))).toBe(true);
  });

  test('Knight movement', () => {
    const knight = { 
      type: PIECE_TYPE.KNIGHT, 
      faction: FACTION.FIRE, 
      pos: new Hex(0, 0),
      hasMoved: true
    };
    
    const { moves, attacks } = getValidMoves(knight, mockCells, []);
    
    // Knight has 6 valid moves on an empty board away from edges
    // Knight has 6 valid moves (excluding straight lines)
    expect(moves.length + attacks.length).toBe(6);
  });

  test('pieces at edge of board have restricted moves', () => {
    const boardCells = generateBoard();
    const alivePieces = [];
    
    // Pawn at the very top vertex (0,0) - Fire pawns move North.
    // (0,0) is in bounds, but (-1,0), (0,-1) might be out.
    // Piece at a very far out-of-bounds coordinate
    const p1 = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(10, 10));
    const moves1 = getValidMoves(p1, boardCells, alivePieces);
    expect(moves1.moves.length).toBe(0);
    
    // Knight at edge
    const p2 = new Piece(PIECE_TYPE.KNIGHT, FACTION.FIRE, new Hex(0, 0));
    const moves2 = getValidMoves(p2, boardCells, alivePieces);
    expect(moves2.moves.length).toBeLessThan(12);
  });

  test('Rook movement', () => {
    const rook = { 
      type: PIECE_TYPE.ROOK, 
      faction: FACTION.FIRE, 
      pos: new Hex(0, 0),
      hasMoved: true
    };
    
    const { moves } = getValidMoves(rook, mockCells, []);
    
    // Rook moves in 6 directions up to the edge of the board (distance 5)
    expect(moves.length).toBe(30); // 5 steps * 6 directions
  });

  test('Bishop movement', () => {
    const bishop = { 
      type: PIECE_TYPE.BISHOP, 
      faction: FACTION.FIRE, 
      pos: new Hex(0, 0),
      hasMoved: true
    };
    
    const { moves } = getValidMoves(bishop, mockCells, []);
    
    // Bishop moves in 6 diagonal directions. Board bounds limit some.
    // At center, max distance for diagonals is bounded by hex grid.
    expect(moves.length).toBeGreaterThan(0);
  });

  test('King movement', () => {
    const king = { 
      type: PIECE_TYPE.KING, 
      faction: FACTION.FIRE, 
      pos: new Hex(0, 0),
      hasMoved: true
    };
    
    const { moves } = getValidMoves(king, mockCells, []);
    
    // King can move exactly 1 step in 6 directions
    expect(moves.length).toBe(6);
    expect(moves.some(m => m.equals(new Hex(1, 0)))).toBe(true);
  });

  test('Knight blocked by friendly piece', () => {
    const boardCells = generateBoard();
    const knight = new Piece(PIECE_TYPE.KNIGHT, FACTION.FIRE, new Hex(0, 0));
    // One of the knight moves from 0,0 is (1, -2) (which is in bounds)
    const friendly = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(1, -2));
    const { moves } = getValidMoves(knight, boardCells, [friendly]);
    expect(moves.some(m => m.equals(new Hex(1, -2)))).toBe(false);
  });

  test('Pawn with unknown faction falls back to empty arrays', () => {
    const boardCells = generateBoard();
    const alienPawn = new Piece(PIECE_TYPE.PAWN, 'alien', new Hex(0, 0));
    const { moves, attacks } = getValidMoves(alienPawn, boardCells, []);
    expect(moves.length).toBe(0);
    expect(attacks.length).toBe(0);
  });
});
