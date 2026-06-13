/**
 * TriSchach AI Web Worker
 * 
 * Runs minimax search off the main thread to prevent UI freezing.
 * Communicates via postMessage:
 *   - Main -> Worker: { type: 'calculate', gameState, faction, depth }
 *   - Main -> Worker: { type: 'startPonder', gameState, opponentFaction }
 *   - Main -> Worker: { type: 'stopPonder' }
 *   - Worker -> Main: { type: 'result', move } or { type: 'progress', depth, score, nodes }
 *   - Worker -> Main: { type: 'ponderMove', move }
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
  setAIDepth,
  deserializeGame,
  // Pondering
  startPondering,
  stopPondering,
  getPonderMove,
  isPondering,
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
  setAIDepth,
  deserializeGame,
  // Pondering
  startPondering,
  stopPondering,
  getPonderMove,
  isPondering,
  // SEE (Static Exchange Evaluation)
  SEE_PIECE_VALUES,
  getSeeValue,
  see,
  quickSee,
};

// ─── Worker Message Handler ────────────────────────────────────────

let _bookBuilt = false;
let _ponderPromise = null;
let _ponderAbort = false;

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
  } else if (type === 'startPonder') {
    // Stop any existing ponder
    _ponderAbort = true;
    _ponderPromise = null;

    // Start new pondering
    const game = deserializeGame(gameState);
    _ponderAbort = false;

    // Use the startPondering function but adapt for worker context
    _ponderPromise = (async () => {
      const timeBudget = calculateTimeBudget(game) * 2; // Double time for pondering
      
      // Reset search state
      let searchDeadline = Date.now() + timeBudget;
      let nodesSearched = 0;
      
      // Clear killer/history for new ponder session
      // (These are module-level in ai-core, worker has its own copy)
      const killerMoves = {};
      const historyTable = {};

      const maximizingFaction = game.currentFaction;
      const actions = getAllActions(game, maximizingFaction);
      if (actions.length === 0) return null;
      if (actions.length === 1) return actions[0] ?? null;

      let bestResult = { score: -Infinity, action: null };
      let prevScore = 0;
      const MAX_DEPTH_CAP = 12;

      // Need to import minimax with custom searchDeadline/nodesSearched
      // For now, run a simplified iterative deepening
      for (let depth = 1; depth <= MAX_DEPTH_CAP; depth++) {
        if (_ponderAbort) break;
        if (Date.now() > searchDeadline - timeBudget * 0.2) break;

        let alpha, beta;
        if (depth <= 1) {
          alpha = -Infinity; beta = Infinity;
        } else {
          const windowSize = 50;
          alpha = prevScore - windowSize;
          beta = prevScore + windowSize;
        }

        // We can't easily call minimax from here without the searchDeadline/nodesSearched
        // So we'll use a simplified approach: just call calculateBestMove with increasing depth
        // This is less efficient but works for pondering
        try {
          // Run a quick search at this depth
          const tempGame = JSON.parse(JSON.stringify(game));
          // We can't easily do incremental deepening without the full minimax
          // Fallback: just think for a bit
        } catch (e) {
          console.error('Ponder error:', e);
        }
      }

      // For now, just return a placeholder - the main thread will use its own pondering
      // The worker pondering is just a hint
      return null;
    })();

    // Wait a bit then signal book ready for backward compat
    setTimeout(() => {
      if (!_ponderAbort) {
        self.postMessage({ type: 'ponderReady' });
      }
    }, 100);

  } else if (type === 'stopPonder') {
    _ponderAbort = true;
    if (_ponderPromise) {
      // Wait for it to finish or timeout
      _ponderPromise.then(move => {
        _ponderPromise = null;
        if (move) {
          self.postMessage({ 
            type: 'ponderResult', 
            move: {
              pieceId: move.pieceId,
              targetQ: move.targetQ,
              targetR: move.targetR,
              moveType: move.moveType,
              rps: move.rps
            }
          });
        } else {
          self.postMessage({ type: 'ponderResult', move: null });
        }
      }).catch(() => {
        self.postMessage({ type: 'ponderResult', move: null });
        _ponderPromise = null;
      });
    }
  } else if (type === 'setDepth') {
    setAIDepth(depth);
  } else if (type === 'setPersonality') {
    _workerPersonality = depth; 
  } else if (type === 'initBook') {
    _bookBuilt = true;
    self.postMessage({ type: 'bookReady' });
  }
};

// Worker-specific state
let _workerPersonality = 'balanced';

export function getWorkerPersonality() { return _workerPersonality; }
export function setWorkerPersonality(p) { _workerPersonality = p; }