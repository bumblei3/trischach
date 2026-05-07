import { expect, test, describe, beforeEach } from 'vitest';
import { calculateBestMove } from '../js/ai.js';
import { Game } from '../js/game.js';
import { FACTION, generateBoard } from '../js/board.js';
import { Piece, PIECE_TYPE } from '../js/pieces.js';
import { Hex } from '../js/hex.js';

describe('AI Decision Making', () => {
  let game;

  beforeEach(() => {
    game = new Game();
    game.init(generateBoard());
    // Clear board of all pieces for precise testing
    game.pieces = [];
    game.rpsEnabled = true;
  });

  test('returns null if no pieces or valid moves', () => {
    expect(calculateBestMove(game, FACTION.FIRE)).toBeNull();
  });

  test('prioritizes advantageous attack over moving', () => {
    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 0));
    const naturePawn = new Piece(PIECE_TYPE.PAWN, FACTION.NATURE, new Hex(0, 1));
    // Provide a valid attack direction for Fire Pawn (NW: 0,-1 | NE: 1,-1 | SW... wait, Fire is attached to bottom, moves up. NW: 0,-1, NE: 1,-1)
    // Actually, PAWN_ATTACK for FIRE is [0,-1] and [1,-1].
    // If firePawn is at (0,1) and naturePawn is at (0,0), Fire can attack NW to (0,0)!
    firePawn.pos = new Hex(0, 1);
    naturePawn.pos = new Hex(0, 0);
    game.pieces = [firePawn, naturePawn];

    const action = calculateBestMove(game, FACTION.FIRE);
    
    expect(action).not.toBeNull();
    expect(action.type).toBe('attack');
    expect(action.target.equals(new Hex(0, 0))).toBe(true);
    expect(action.piece).toBe(firePawn);
  });

  test('avoids disadvantageous attack (suicide)', () => {
    // Fire loses to Water.
    // Place a Fire pawn at (0,1) and Water pawn at (0,0).
    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1));
    const waterPawn = new Piece(PIECE_TYPE.PAWN, FACTION.WATER, new Hex(0, 0));
    game.pieces = [firePawn, waterPawn];

    const action = calculateBestMove(game, FACTION.FIRE);
    
    // Even though it CAN attack Water at (0,0), it should prefer a normal move over suicide.
    // Fire pawn can also move to (1,0) [NE] which is empty.
    expect(action).not.toBeNull();
    expect(action.type).toBe('move');
    expect(action.target.equals(new Hex(1, 0))).toBe(true);
  });

  test('moves towards the center heuristic', () => {
    // Knight at distance 4 from center
    const fireKnight = new Piece(PIECE_TYPE.KNIGHT, FACTION.FIRE, new Hex(0, 4));
    game.pieces = [fireKnight];

    const action = calculateBestMove(game, FACTION.FIRE);
    
    expect(action).not.toBeNull();
    expect(action.type).toBe('move');
    
    // The target should be closer to the center than (0,4)
    const distFromCenter = Math.max(Math.abs(fireKnight.pos.q), Math.abs(fireKnight.pos.r), Math.abs(-fireKnight.pos.q - fireKnight.pos.r));
    const distToCenter = Math.max(Math.abs(action.target.q), Math.abs(action.target.r), Math.abs(-action.target.q - action.target.r));
    
    expect(distToCenter).toBeLessThan(distFromCenter);
  });

  test('handles tied scores by picking randomly from best actions', () => {
    // Mock Math.random to return 0 so all moves with same heuristic get the same score
    const originalRandom = Math.random;
    Math.random = () => 0;
    
    // Give King multiple valid moves that are exactly same distance from center (radius 1 circle around origin)
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0));
    game.pieces = [fireKing];
    
    const action = calculateBestMove(game, FACTION.FIRE);
    
    expect(action).not.toBeNull();
    expect(action.type).toBe('move');
    // It should pick one of the 6 directions
    expect(action.target.distance(new Hex(0, 0))).toBe(1);
    
    Math.random = originalRandom;
  });
});
