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

import { getValidMoves, PIECE_STRENGTH, PIECE_TYPE } from "./pieces.js";
import { getRPSResult, FACTION } from "./board.js";
import { Hex } from "./hex.js";
import { isKingdomCheck } from "./game-check.js";
import { pickBookMove, buildOpeningBook, inBook } from "./opening-book.js";

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
} from "./ai-core.js";

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

// Worker-internal pondering state (separate from main thread due to Worker scope)
let _ponderAbort = false;
let _ponderWorkerState = null; // Will hold the ponder state object from ai-core

self.onmessage = function (e) {
  const { type, gameState, faction, depth } = e.data;

  if (type === "calculate") {
    // Reconstruct game object from serialized state
    const game = deserializeGame(gameState);
    if (depth !== undefined) setAIDepth(depth);

    const move = calculateBestMove(game, faction);

    if (move) {
      self.postMessage({
        type: "result",
        move: {
          pieceId: move.piece.id,
          targetQ: move.target.q,
          targetR: move.target.r,
          moveType: move.type,
          rps: move.rps,
        },
      });
    } else {
      self.postMessage({ type: "result", move: null });
    }
  } else if (type === "startPonder") {
    // Stop any existing pondering
    _ponderAbort = true;

    // Start new pondering
    const game = deserializeGame(gameState);
    const opponentFaction = faction; // In worker context, faction is the opponent to ponder for
    _ponderAbort = false;

    // Import the ponder state from ai-core (worker has its own module instance)
    // We'll use the startPondering function which manages its own state
    startPondering(game, opponentFaction);

    // Set up progress reporting to send updates to main thread
    setPonderProgressCallback((depth, score, nodes) => {
      if (!_ponderAbort) {
        self.postMessage({
          type: "ponderProgress",
          depth,
          score,
          nodes,
        });
      }
    });

    // The startPondering function runs asynchronously via queueMicrotask
    // We don't wait for it here - it runs in background until stopPonder or abort

    // Signal ready for backward compat
    setTimeout(() => {
      if (!_ponderAbort) {
        self.postMessage({ type: "ponderReady" });
      }
    }, 50);
  } else if (type === "stopPonder") {
    _ponderAbort = true;

    // Get the best move from pondering
    stopPondering()
      .then((move) => {
        if (move) {
          self.postMessage({
            type: "ponderResult",
            move: {
              pieceId: move.piece.id,
              targetQ: move.target.q,
              targetR: move.target.r,
              moveType: move.type,
              rps: move.rps,
            },
          });
        } else {
          self.postMessage({ type: "ponderResult", move: null });
        }

        // Clear progress callback
        setPonderProgressCallback(null);
      })
      .catch(() => {
        self.postMessage({ type: "ponderResult", move: null });
        setPonderProgressCallback(null);
      });
  } else if (type === "setDepth") {
    setAIDepth(depth);
  } else if (type === "setPersonality") {
    _workerPersonality = depth; // Note: bug in original - should be faction/personality param
  } else if (type === "initBook") {
    _bookBuilt = true;
    self.postMessage({ type: "bookReady" });
  }
};

// Worker-specific state
let _workerPersonality = "balanced";

export function getWorkerPersonality() {
  return _workerPersonality;
}
export function setWorkerPersonality(p) {
  _workerPersonality = p;
}
