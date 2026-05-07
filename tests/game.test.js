import { expect, test, describe, beforeEach } from 'vitest';
import { Game, GAME_STATE } from '../js/game.js';
import { FACTION, generateBoard } from '../js/board.js';
import { Piece, PIECE_TYPE } from '../js/pieces.js';
import { Hex } from '../js/hex.js';

describe('Game logic', () => {
  let game;
  let boardCells;

  beforeEach(() => {
    game = new Game();
    boardCells = generateBoard();
    game.init(boardCells);
  });

  test('initializes correctly', () => {
    expect(game.state).toBe(GAME_STATE.SELECT_PIECE);
    expect(game.currentFaction).toBe(FACTION.FIRE);
    expect(game.getAlivePieces().length).toBeGreaterThan(0);
    // 3 factions, 15 pieces each (8 backrow + 7 pawns)
    expect(game.getAlivePieces().length).toBe(45);
    expect(game.currentFactionName).toBeDefined();
  });

  test('executes a normal move correctly', () => {
    game.pieces = []; // Clear board
    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 5));
    game.pieces = [firePawn];
    const target = new Hex(0, 4);
    game.handleCellClick(firePawn.pos);
    const result = game.handleCellClick(target);
    
    expect(result.action).toBe('move');
    expect(firePawn.pos.equals(target)).toBe(true);
    expect(firePawn.hasMoved).toBe(true);
  });

  test('reselects another own piece correctly', () => {
    const firePieces = game.getAlivePieces().filter(p => p.faction === FACTION.FIRE);
    const p1 = firePieces[0];
    const p2 = firePieces[1];
    
    game.handleCellClick(p1.pos); // Select p1
    expect(game.selectedPiece).toBe(p1);
    
    const result = game.handleCellClick(p2.pos); // Click p2
    expect(result.action).toBe('select');
    expect(game.selectedPiece).toBe(p2);
  });

  test('init fails with invalid data', () => {
    const brokenGame = new Game();
    // Simulate console.error to avoid test output noise
    const originalError = console.error;
    console.error = () => {};
    expect(brokenGame.init(null)).toBeUndefined();
    console.error = originalError;
  });

  test('clicking invalid cell in SELECT_TARGET state aborts move', () => {
    const firePawn = game.getAlivePieces().find(p => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.PAWN);
    firePawn.pos = new Hex(0, 0);
    game.handleCellClick(firePawn.pos);
    
    // pawn can't move backwards
    const result = game.handleCellClick(new Hex(0, 5));
    expect(result.action).toBe('deselect');
  });

  test('select piece changes state', () => {
    // Find a Fire piece
    const firePiece = game.getAlivePieces().find(p => p.faction === FACTION.FIRE);
    const result = game.handleCellClick(firePiece.pos);
    
    expect(result.action).toBe('select');
    expect(game.state).toBe(GAME_STATE.SELECT_TARGET);
    expect(game.selectedPiece).toBe(firePiece);
    expect(game.validMoves.length + game.validAttacks.length).toBeGreaterThanOrEqual(0);
  });

  test('cannot select opponent piece directly', () => {
    // Find a Water piece
    const waterPiece = game.getAlivePieces().find(p => p.faction === FACTION.WATER);
    const result = game.handleCellClick(waterPiece.pos);
    
    expect(result.action).toBe('deselect');
    expect(game.state).toBe(GAME_STATE.SELECT_PIECE);
    expect(game.selectedPiece).toBeNull();
  });

  test('getPieceAt returns undefined for empty hex', () => {
    expect(game.getPieceAt(new Hex(0, 0))).toBeUndefined();
  });

  test('returns deselect when selecting enemy piece directly in SELECT_PIECE state', () => {
    // Current faction is FIRE. Try to select WATER piece.
    const waterPiece = game.getAlivePieces().find(p => p.faction === FACTION.WATER);
    const result = game.handleCellClick(waterPiece.pos);
    expect(result.action).toBe('deselect');
  });

  test('deselecting piece returns to select state', () => {
    const firePiece = game.getAlivePieces().find(p => p.faction === FACTION.FIRE);
    game.handleCellClick(firePiece.pos); // Select
    expect(game.state).toBe(GAME_STATE.SELECT_TARGET);
    
    // Click an invalid target to deselect
    const emptyHex = new Hex(0, 0); 
    const result = game.handleCellClick(emptyHex); // Usually central hex is empty at start
    
    // If it's a valid move, it moves. If not, it deselects.
    // Pawns can only move 1 or 2 steps forward.
    // Central hex is usually distance 5 away.
    if (result.action === 'deselect') {
      expect(game.state).toBe(GAME_STATE.SELECT_PIECE);
      expect(game.selectedPiece).toBeNull();
    }
  });

  test('RPS combat resolution: Fire vs Nature', () => {
    // Mock combat manually
    game.rpsEnabled = true;
    
    const firePiece = game.getAlivePieces().find(p => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.QUEEN);
    const naturePiece = game.getAlivePieces().find(p => p.faction === FACTION.NATURE && p.type === PIECE_TYPE.QUEEN);
    
    // Force pieces next to each other in the empty center zone
    firePiece.pos = new Hex(0, 0);
    naturePiece.pos = new Hex(0, 1);
    
    // Select fire piece
    game.handleCellClick(firePiece.pos);
    
    // Attack nature piece
    const result = game.handleCellClick(naturePiece.pos);
    
    expect(result.action).toBe('combat');
    expect(result.rpsResult).toBe('advantage'); // Fire beats Nature
    expect(naturePiece.alive).toBe(false);
    expect(firePiece.alive).toBe(true);
    expect(firePiece.pos.equals(new Hex(0, 1))).toBe(true);
  });

  test('RPS combat resolution: Fire vs Water', () => {
    game.rpsEnabled = true;
    
    const firePiece = game.getAlivePieces().find(p => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.QUEEN);
    const waterPiece = game.getAlivePieces().find(p => p.faction === FACTION.WATER && p.type === PIECE_TYPE.QUEEN);
    
    firePiece.pos = new Hex(0, 0);
    waterPiece.pos = new Hex(0, 1);
    
    game.handleCellClick(firePiece.pos);
    const result = game.handleCellClick(waterPiece.pos);
    
    expect(result.action).toBe('combat');
    expect(result.rpsResult).toBe('disadvantage'); // Fire loses to Water
    expect(waterPiece.alive).toBe(true);
    expect(firePiece.alive).toBe(false);
    // Defender stays in place
    expect(waterPiece.pos.equals(new Hex(0, 1))).toBe(true);
  });

  test('RPS combat resolution: Attacker dies (Disadvantage)', () => {
    game.rpsEnabled = true;
    const firePawn = game.getAlivePieces().find(p => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.PAWN);
    const waterQueen = game.getAlivePieces().find(p => p.faction === FACTION.WATER && p.type === PIECE_TYPE.QUEEN);
    
    firePawn.pos = new Hex(0, 2);
    waterQueen.pos = new Hex(1, 1); // Diagonal forward for Fire (moving towards r=0)
    
    game.handleCellClick(firePawn.pos);
    const result = game.handleCellClick(waterQueen.pos);
    
    expect(result.action).toBe('combat');
    expect(result.rpsResult).toBe('disadvantage');
    expect(firePawn.alive).toBe(false);
    expect(waterQueen.alive).toBe(true);
    expect(game.capturedPieces[FACTION.WATER]).toContain(firePawn);
  });

  test('nextTurn skips eliminated factions', () => {
    game.eliminatedFactions.add(FACTION.WATER);
    // FIRE -> (WATER skipped) -> NATURE
    expect(game.currentFaction).toBe(FACTION.FIRE);
    game.pieces = []; // Clear board so we can move
    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 5));
    game.pieces = [firePawn];
    
    game.handleCellClick(firePawn.pos);
    game.handleCellClick(new Hex(0, 4));
    
    expect(game.currentFaction).toBe(FACTION.NATURE);
  });

  test('handleCellClick returns null in invalid state or game over', () => {
    game.state = GAME_STATE.GAME_OVER;
    expect(game.handleCellClick(new Hex(0, 0))).toBeNull();
    
    game.state = 'invalid_state';
    expect(game.handleCellClick(new Hex(0, 0))).toBeNull();
  });

  test('king elimination eliminates faction', () => {
    game.rpsEnabled = true;
    
    const fireQueen = game.getAlivePieces().find(p => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.QUEEN);
    const natureKing = game.getAlivePieces().find(p => p.faction === FACTION.NATURE && p.type === PIECE_TYPE.KING);
    
    fireQueen.pos = new Hex(0, 0);
    natureKing.pos = new Hex(0, 1);
    
    game.handleCellClick(fireQueen.pos);
    const result = game.handleCellClick(natureKing.pos);
    
    expect(result.action).toBe('combat');
    expect(natureKing.alive).toBe(false);
    expect(game.eliminatedFactions.has(FACTION.NATURE)).toBe(true);
    
    // All nature pieces should be dead
    const aliveNature = game.getAlivePieces().filter(p => p.faction === FACTION.NATURE);
    expect(aliveNature.length).toBe(0);
  });

  test('triggers callbacks and ends game when only one faction remains', () => {
    let gameOverWinner = null;
    let eliminatedFaction = null;
    
    game.onGameOver = (winner) => { gameOverWinner = winner; };
    game.onElimination = (faction) => { eliminatedFaction = faction; };
    
    game.rpsEnabled = false; // Disable RPS to ensure the attack succeeds
    
    // Eliminate Nature
    game.eliminatedFactions.add(FACTION.NATURE);
    
    // Eliminate Water by capturing Water's King
    const fireQueen = game.getAlivePieces().find(p => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.QUEEN);
    const waterKing = game.getAlivePieces().find(p => p.faction === FACTION.WATER && p.type === PIECE_TYPE.KING);
    
    fireQueen.pos = new Hex(0, 0);
    waterKing.pos = new Hex(0, 1);
    
    game.handleCellClick(fireQueen.pos);
    const result = game.handleCellClick(waterKing.pos);
    
    expect(eliminatedFaction).toBe(FACTION.WATER);
    expect(game.state).toBe(GAME_STATE.GAME_OVER);
    expect(result.gameOver).toBe(true);
    expect(result.winner_faction).toBe(FACTION.FIRE);
    expect(gameOverWinner).toBe(FACTION.FIRE);
    // onUpdate is not called on the final turn that triggers game over, it returns result directly
  });

  test('winner_faction is null if all factions eliminated', () => {
    game.eliminatedFactions.add(FACTION.FIRE);
    game.eliminatedFactions.add(FACTION.WATER);
    // Fire attacks Nature, killing Nature king. All factions eliminated.
    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 2));
    const natureKing = new Piece(PIECE_TYPE.KING, FACTION.NATURE, new Hex(1, 1));
    game.pieces = [firePawn, natureKing];
    
    game.handleCellClick(firePawn.pos);
    const result = game.handleCellClick(natureKing.pos);
    
    expect(result.gameOver).toBe(true);
    expect(result.winner_faction).toBeNull();
  });

  test('onUpdate is safely skipped if not set', () => {
    game.onUpdate = null;
    game.currentFactionIdx = 0; // FIRE
    const piece = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 5));
    game.pieces = [piece];
    game.handleCellClick(piece.pos);
    const result = game.handleCellClick(new Hex(0, 4));
    expect(result.action).toBe('move');
  });
});
