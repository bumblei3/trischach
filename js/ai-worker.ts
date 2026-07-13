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

import { getValidMoves, PIECE_STRENGTH, PIECE_TYPE } from "./pieces.ts";
import { getRPSResult, FACTION } from "./board.ts";
import { Hex } from "./hex.ts";
import { isKingdomCheck } from "./game-check.ts";
import { pickBookMove, buildOpeningBook, inBook } from "./opening-book.ts";

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
  beginSearch,
  quiesce,
  iterativeDeepening,
  greedyBestMove,
  calculateBestMove,
  searchRootSubset,
  calculateBestMoveParallel,
  setAIDepth,
  getAIDepth,
  setNNUEEnabled,
  loadNNUEWeights,
  // Pondering
  startPondering,
  stopPondering,
  getPonderMove,
  isPondering,
  setPonderProgressCallback,
  // SEE (Static Exchange Evaluation)
  SEE_PIECE_VALUES,
  getSeeValue,
  see,
  quickSee,
} from "./ai-core.ts";
import { deserializeGame } from "./ai.ts";

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
  beginSearch,
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
  setPonderProgressCallback,
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

const ctx: Worker = self as unknown as Worker;

// Signal readiness as soon as the worker module has finished loading.
// Relying solely on a `bookReady` reply to an `initBook` message is racy:
// main.ts posts `initBook` immediately after constructing the Worker, but the
// module may still be loading at that point, so the message is dropped and
// `workerReady` never flips to true — which silently forces every AI move
// onto the (blocking) main thread and freezes the UI during Auto-Battle.
ctx.postMessage({ type: "ready" });

ctx.onmessage = function (e: MessageEvent) {
  const { type, gameState, faction, depth, personality } = e.data as any;

  if (type === "calculate") {
    // Reconstruct game object from serialized state
    const game: any = deserializeGame(gameState);
    if (depth !== undefined) setAIDepth(depth);

    const move = calculateBestMove(game, faction);

    if (move) {
      ctx.postMessage({
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
      ctx.postMessage({ type: "result", move: null });
    }
  } else if (type === "searchSubset") {
    // Root-move splitting: search only the assigned subset of root moves.
    const game: any = deserializeGame(gameState);
    if (depth !== undefined) setAIDepth(depth);
    const subset = (e.data.subset as any[])
      .map((s) => {
        const target = new Hex(s.targetQ, s.targetR);
        const actions = getAllActions(game, faction);
        return actions.find(
          (a: any) => a.piece.id === s.pieceId && a.target.equals(target),
        )!;
      })
      .filter(Boolean);
    const timeBudget = e.data.timeBudget ?? calculateTimeBudget(game);
    beginSearch(timeBudget);
    const res = searchRootSubset(
      game,
      faction,
      subset,
      e.data.searchDepth ?? getAIDepth(),
    );
    ctx.postMessage({
      type: "subsetResult",
      score: res.score,
      move: res.action
        ? {
            pieceId: res.action.piece.id,
            targetQ: res.action.target.q,
            targetR: res.action.target.r,
            moveType: res.action.type,
            rps: res.action.rps,
          }
        : null,
    });
  } else if (type === "startPonder") {
    // Stop any existing pondering
    _ponderAbort = true;

    // Start new pondering
    const game: any = deserializeGame(gameState);
    const opponentFaction = faction; // In worker context, faction is the opponent to ponder for
    _ponderAbort = false;

    // Import the ponder state from ai-core (worker has its own module instance)
    // We'll use the startPondering function which manages its own state
    startPondering(game, opponentFaction);

    // Set up progress reporting to send updates to main thread
    setPonderProgressCallback((depth: number, score: number, nodes: number) => {
      if (!_ponderAbort) {
        ctx.postMessage({
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
        ctx.postMessage({ type: "ponderReady" });
      }
    }, 50);
  } else if (type === "stopPonder") {
    _ponderAbort = true;

    // Get the best move from pondering
    stopPondering()
      .then((move) => {
        if (move) {
          ctx.postMessage({
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
          ctx.postMessage({ type: "ponderResult", move: null });
        }

        // Clear progress callback
        setPonderProgressCallback(null as any);
      })
      .catch(() => {
        ctx.postMessage({ type: "ponderResult", move: null });
        setPonderProgressCallback(null as any);
      });
  } else if (type === "setDepth") {
    setAIDepth(depth);
  } else if (type === "setPersonality") {
    _workerPersonality = personality;
  } else if (type === "initBook") {
    _bookBuilt = true;
    ctx.postMessage({ type: "bookReady" });
  }
};

// Worker-specific state
let _workerPersonality = "balanced";

export function getWorkerPersonality(): string {
  return _workerPersonality;
}
export function setWorkerPersonality(p: string): void {
  _workerPersonality = p;
}
