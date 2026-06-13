#!/usr/bin/env node
/**
 * Puzzle Generator for TriSchach
 * Generates "Mate in N" puzzles by running the engine on endgame positions
 */

import { Game } from './js/game.js';
import { generateBoard } from './js/board.js';
import { calculateBestMove, setAIDepth, setAIPersonality, greedyBestMove } from './js/ai.js';
import { Hex } from './js/hex.js';
import { FACTION } from './js/board.js';
import { getValidMoves } from './js/pieces.js';
import fs from 'fs';
import path from 'path';

// Puzzle configuration
const PUZZLE_CONFIG = {
  aiDepth: 3,
  aiPersonality: 'tactical',
  outputFile: path.resolve('./puzzles.json'),
};

// Helper: Create a fresh game
function createGame() {
  const game = new Game();
  game.init(generateBoard());
  game.rpsEnabled = true;
  return game;
}

// Helper: Get all legal actions for a faction
function getAllLegalActions(game, faction) {
  const actions = [];
  const pieces = game.pieces.filter(p => p.faction === faction && p.alive);
  
  for (const piece of pieces) {
    const { moves, attacks } = getValidMoves(piece, game.boardCells, game._occupiedMap);
    for (const target of attacks) {
      const defender = game.pieces.find(p => p.alive && p.pos.equals(target));
      if (!defender) continue;
      actions.push({ piece, target, type: 'attack' });
    }
    for (const target of moves) {
      actions.push({ piece, target, type: 'move' });
    }
  }
  return actions;
}

// Generate endgame positions for puzzle creation
function generateEndgamePositions() {
  // Proper mate-in-1 positions for TriSchach
  
  return [
    // Mate in 1: Fire Queen delivers checkmate to Water King
    // Fire Queen on (0, -1), Fire King on (0, 0), Water King on (-2, 3)
    // Queen moves to (0, -2) delivering checkmate
    {
      name: "Mate in 1: Queen delivers checkmate",
      pieces: [
        { id: 'fire_king', type: 'king', faction: 'fire', pos: new Hex(0, 0), symbol: '♚', alive: true, hasMoved: false },
        { id: 'fire_queen', type: 'queen', faction: 'fire', pos: new Hex(0, -1), symbol: '♛', alive: true, hasMoved: false },
        { id: 'water_king', type: 'king', faction: 'water', pos: new Hex(-2, 3), symbol: '♔', alive: true, hasMoved: false },
      ],
      currentFaction: 'fire',
      eliminated: ['nature'],
      expectedMateIn: 1,
      solutionMove: { from: { q: 0, r: -1 }, to: { q: 0, r: -2 }, pieceId: 'fire_queen' },
    },
    
    // Mate in 1: Fire Rook delivers checkmate
    {
      name: "Mate in 1: Rook delivers checkmate",
      pieces: [
        { id: 'fire_king', type: 'king', faction: 'fire', pos: new Hex(0, 0), symbol: '♚', alive: true, hasMoved: false },
        { id: 'fire_rook', type: 'rook', faction: 'fire', pos: new Hex(-3, 0), symbol: '♜', alive: true, hasMoved: false },
        { id: 'water_king', type: 'king', faction: 'water', pos: new Hex(-2, 0), symbol: '♔', alive: true, hasMoved: false },
      ],
      currentFaction: 'fire',
      eliminated: ['nature'],
      expectedMateIn: 1,
      solutionMove: { from: { q: -3, r: 0 }, to: { q: -1, r: 0 }, pieceId: 'fire_rook' },
    },
    
    // Mate in 2: Fire Queen forces mate in 2
    {
      name: "Mate in 2: Queen forces mate",
      pieces: [
        { id: 'fire_king', type: 'king', faction: 'fire', pos: new Hex(0, -1), symbol: '♚', alive: true, hasMoved: false },
        { id: 'fire_queen', type: 'queen', faction: 'fire', pos: new Hex(-2, 0), symbol: '♛', alive: true, hasMoved: false },
        { id: 'water_king', type: 'king', faction: 'water', pos: new Hex(2, -2), symbol: '♔', alive: true, hasMoved: false },
      ],
      currentFaction: 'fire',
      eliminated: ['nature'],
      expectedMateIn: 2,
    },
    
    // K+R vs K forced mate
    {
      name: "Mate in 3: Rook forces mate",
      pieces: [
        { id: 'fire_king', type: 'king', faction: 'fire', pos: new Hex(0, 0), symbol: '♚', alive: true, hasMoved: false },
        { id: 'fire_rook', type: 'rook', faction: 'fire', pos: new Hex(0, -3), symbol: '♜', alive: true, hasMoved: false },
        { id: 'water_king', type: 'king', faction: 'water', pos: new Hex(-5, 5), symbol: '♔', alive: true, hasMoved: false },
      ],
      currentFaction: 'fire',
      eliminated: ['nature'],
      expectedMateIn: 3,
    },
    
    // K+B+B vs K
    {
      name: "Mate in 4: Two Bishops force mate",
      pieces: [
        { id: 'fire_king', type: 'king', faction: 'fire', pos: new Hex(0, -1), symbol: '♚', alive: true, hasMoved: false },
        { id: 'fire_bishop1', type: 'bishop', faction: 'fire', pos: new Hex(1, -2), symbol: '♝', alive: true, hasMoved: false },
        { id: 'fire_bishop2', type: 'bishop', faction: 'fire', pos: new Hex(-1, -2), symbol: '♝', alive: true, hasMoved: false },
        { id: 'water_king', type: 'king', faction: 'water', pos: new Hex(-3, 3), symbol: '♔', alive: true, hasMoved: false },
      ],
      currentFaction: 'fire',
      eliminated: ['nature'],
      expectedMateIn: 4,
    solutionMove: { from: { q: 1, r: -2 }, to: { q: 0, r: -1 }, pieceId: 'fire_bishop1' },
    },
  ];
}

// Create a game from position data
function createGameFromPosition(posData) {
  const game = new Game();
  game.init(generateBoard());
  game.rpsEnabled = true;
  game.pieces = posData.pieces.map(p => ({
    ...p,
    pos: p.pos instanceof Hex ? p.pos : new Hex(p.pos.q, p.pos.r),
  }));
  game.currentFaction = posData.currentFaction;
  game.currentFactionIdx = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE].indexOf(posData.currentFaction);
  game.eliminatedFactions = new Set(posData.eliminated);
  game.state = 'select_piece';
  game._rebuildOccupiedMap();
  return game;
}

// Export position to FEN-like format
function exportPositionToFEN(posData) {
  const pieces = posData.pieces.map(p => {
    const pieceChar = p.faction[0].toUpperCase() + p.type[0].toUpperCase();
    return `${pieceChar}@${p.pos.q},${p.pos.r}`;
  }).join(';');
  return `TSPN:${pieces}#${posData.currentFaction}`;
}

// Main puzzle generation
async function generatePuzzles() {
  console.log('🔍 Generating puzzles...\n');
  
  // Use greedy search for puzzle generation (fast, no opening book)
  const puzzles = [];
  
  for (const posData of generateEndgamePositions()) {
    console.log(`\nAnalyzing: ${posData.name}`);
    
    const game = createGameFromPosition(posData);
    
    console.log(`  Current faction: ${game.currentFaction}`);
    console.log(`  Pieces: ${game.pieces.filter(p => p.alive).length}`);
    console.log(`  State: ${game.state}`);
    
    const { isKingdomCheck } = await import('./js/game-check.js');
    console.log(`  In check: ${isKingdomCheck(game, game.currentFaction)}`);
    
    const legalActions = getAllLegalActions(game, game.currentFaction);
    console.log(`  Legal actions: ${legalActions.length}`);
    
    // Use greedy best move (fast, no search, no opening book)
    let result = null;
    try {
      const greedyResult = greedyBestMove(game, game.currentFaction, legalActions);
      console.log(`  greedyBestMove result: ${greedyResult ? 'found' : 'null'}`);
      if (greedyResult) {
        console.log(`  Move: ${greedyResult.piece.id} -> ${greedyResult.target.q},${greedyResult.target.r}`);
      }
      result = greedyResult;
    } catch (err) {
      console.error(`  Error in greedyBestMove: ${err.message}`);
    }
    
    if (!result) {
      console.log('  ❌ No move found');
      const allActions = getAllLegalActions(game, game.currentFaction);
      for (const a of allActions.slice(0, 10)) {
        console.log(`    ${a.piece.id} -> ${a.target.q},${a.target.r} (${a.type})`);
      }
      continue;
    }
    
    // Simulate the move
    game.handleCellClick(result.piece.pos);
    const moveResult = game.handleCellClick(result.target);
    
    if (moveResult && moveResult.checkmate) {
      const puzzle = {
        id: `puzzle_${puzzles.length + 1}`,
        name: posData.name,
        fen: exportPositionToFEN(posData),
        initialPosition: posData,
        solution: [{
          pieceId: result.piece.id,
          from: { q: result.piece.pos.q, r: result.piece.pos.r },
          to: { q: result.target.q, r: result.target.r },
          type: moveResult.action,
        }],
        mateIn: 1,
        difficulty: 'easy',
        tags: ['mate-in-1', posData.currentFaction],
      };
      
      puzzles.push(puzzle);
      console.log(`  ✅ Found mate in 1`);
    } else {
      console.log(`  ⚠️ Not immediate mate, needs deeper search`);
    }
  }
  
  // Save puzzles
  const output = {
    version: '1.0',
    generated: new Date().toISOString(),
    totalPuzzles: puzzles.length,
    puzzles: puzzles,
  };
  
  fs.writeFileSync(PUZZLE_CONFIG.outputFile, JSON.stringify(output, null, 2));
  console.log(`\n💾 Saved ${puzzles.length} puzzles to ${PUZZLE_CONFIG.outputFile}`);
  
  return puzzles;
}

// Run if called directly
generatePuzzles().catch(console.error);

// Export for module usage
export { generatePuzzles, createGameFromPosition, exportPositionToFEN };