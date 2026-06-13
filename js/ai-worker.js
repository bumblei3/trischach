/**
 * TriSchach AI Web Worker
 * 
 * Runs minimax search off the main thread to prevent UI freezing.
 * Communicates via postMessage:
 *   - Main -> Worker: { type: 'calculate', gameState, faction, depth }
 *   - Worker -> Main: { type: 'result', move } or { type: 'progress', depth, score, nodes }
 */

import { getValidMoves, PIECE_STRENGTH, PIECE_TYPE } from './pieces.js';
import { getRPSResult, FACTION } from './board.js';
import { Hex } from './hex.js';
import { isKingdomCheck } from './game-check.js';
import { pickBookMove, buildOpeningBook, inBook } from './opening-book.js';

// Import all core AI logic from shared module
import {
  TURN_ORDER,
  RPS_VALUE_MULTIPLIER,
  getDynamicPieceValue,
  getMaterialValue,
  calculateTimeBudget,
  TIME_LIMIT_MS,
  AI_PERSONALITIES,
  getPersonalityWeights,
  getPersonalityAggression,
  setPersonality,
  getPersonality,
  getPersonalities,
  boardHash,
  getPSTValue,
  evaluatePawnStructure,
  evaluateEndgame,
  evaluateBoard,
  getAllActions,
  getLegalMoves,
  legalMoveCheck,
  rebuildOccupiedMap,
  simulateMove,
  undoMove,
  minimax,
  quiesce,
  iterativeDeepening,
  greedyBestMove,
  calculateBestMove,
  deserializeGame,
  setAIDepth,
  // SEE (Static Exchange Evaluation)
  SEE_PIECE_VALUES,
  getSeeValue,
  see,
  quickSee,
} from './ai-core.js';

// Re-export for unit testing (coverage)
export {
  TURN_ORDER,
  RPS_VALUE_MULTIPLIER,
  getDynamicPieceValue,
  getMaterialValue,
  calculateTimeBudget,
  TIME_LIMIT_MS,
  AI_PERSONALITIES,
  getPersonalityWeights,
  getPersonalityAggression,
  setPersonality,
  getPersonality,
  getPersonalities,
  boardHash,
  getPSTValue,
  evaluatePawnStructure,
  evaluateEndgame,
  evaluateBoard,
  getAllActions,
  getLegalMoves,
  legalMoveCheck,
  rebuildOccupiedMap,
  simulateMove,
  undoMove,
  minimax,
  quiesce,
  iterativeDeepening,
  greedyBestMove,
  calculateBestMove,
  deserializeGame,
  // SEE (Static Exchange Evaluation)
  SEE_PIECE_VALUES,
  getSeeValue,
  see,
  quickSee,
};

// ─── Worker Message Handler ────────────────────────────────────────

let _bookBuilt = false;

self.onmessage = function(e) {
  const { type, gameState, faction, depth } = e.data;
  
  if (type === 'calculate') {
    // Reconstruct game object from serialized state
    const game = deserializeGame(gameState);
    if (depth !== undefined) setAIDepth(depth);
    
    const move = calculateBestMove(game, faction);
    
    if (move) {
      self.postMessage({
        type: 'result',
        move: {
          pieceId: move.piece.id,
          targetQ: move.target.q,
          targetR: move.target.r,
          moveType: move.type,
          rps: move.rps
        }
      });
    } else {
      self.postMessage({ type: 'result', move: null });
    }
  } else if (type === 'setDepth') {
    setAIDepth(depth);
  } else if (type === 'setPersonality') {
    // depth parameter carries personality name
    _workerPersonality = depth; 
  } else if (type === 'initBook') {
    // Don't build opening book in worker - piece IDs won't match main thread
    // Worker will use greedy/minimax directly (fast enough for early game)
    _bookBuilt = true;
    self.postMessage({ type: 'bookReady' });
  }
};

// Worker-specific state
let _workerPersonality = 'balanced';

export function getWorkerPersonality() { return _workerPersonality; }
export function setWorkerPersonality(p) { _workerPersonality = p; }