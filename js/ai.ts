import { getValidMoves, PIECE_STRENGTH, PIECE_TYPE } from "./pieces.ts";
import { getRPSResult, FACTION, generateBoard } from "./board.ts";
import { Hex } from "./hex.ts";
import { isKingdomCheck } from "./game-check.ts";
import {
  pickBookMove,
  buildOpeningBook,
  inBook,
  learnFromGame,
  getLearnedData,
  loadLearnedData,
  loadOpeningBook,
  loadLearnedDataFromFile,
  loadLearnedDataFromStorage,
  saveLearnedDataToStorage,
} from "./opening-book.ts";

// Import all core AI logic from shared module
import {
  TURN_ORDER,
  RPS_VALUE_MULTIPLIER,
  getDynamicPieceValue,
  getMaterialValue,
  calculateTimeBudget,
  MAX_DEPTH,
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
  searchRootSubset,
  calculateBestMoveParallel,
  setAIDepth,
  getAIDepth,
  setAITimeLimit,
  setAIPersonality,
  getAIPersonalities,
  // Pondering
  startPondering,
  stopPondering,
  getPonderMove,
  isPondering,
  PonderState,
  setPonderProgressCallback,
  // SEE (Static Exchange Evaluation)
  SEE_PIECE_VALUES,
  getSeeValue,
  see,
  quickSee,
  // Search stats
  nodesSearched,
} from "./ai-core.ts";

/**
 * Reconstruct a Game-like object from a serialized state.
 * Ported from ai-core.js (which lacks a TS counterpart for this function).
 */
export function deserializeGame(state: any) {
  const game = {
    pieces: state.pieces.map((p: any) => ({
      id: p.id,
      type: p.type,
      faction: p.faction,
      pos: new Hex(p.pos.q, p.pos.r),
      symbol: p.symbol,
      alive: p.alive,
      hasMoved: p.hasMoved,
    })),
    currentFactionIdx: state.currentFactionIdx,
    currentFaction: state.currentFaction,
    state: state.state,
    eliminatedFactions: new Set(state.eliminatedFactions),
    rpsEnabled: state.rpsEnabled,
    _occupiedMap: new Map(),
    capturedPieces: state.capturedPieces,
    moveHistory: [] as any[],
    _positionHistory: new Map(),
    _halfmoveClock: state._halfmoveClock || 0,
    // Rebuild the static board geometry. The serialized state omits
    // boardCells (it's constant), but move generation needs it to know
    // which target hexes are on the board.
    boardCells: generateBoard(),
  };

  // Provide Game methods that the AI/search code calls directly
  // (the main-thread Game instance has these; the deserialized
  //  worker-side object must mirror them or getAlivePieces() etc. throw).
  (game as any).getAlivePieces = () => game.pieces.filter((p: any) => p.alive);
  (game as any).getPieces = () => game.pieces;

  rebuildOccupiedMap(game as any);
  return game;
}

// Re-export for backward compatibility
export {
  TURN_ORDER,
  RPS_VALUE_MULTIPLIER,
  getDynamicPieceValue,
  getMaterialValue,
  calculateTimeBudget,
  MAX_DEPTH,
  TIME_LIMIT_MS,
  AI_PERSONALITIES,
  getPersonalityWeights,
  getPersonalityAggression,
  setPersonality,
  setAIPersonality,
  getPersonality,
  getPersonalities,
  getAIPersonalities,
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
  searchRootSubset,
  calculateBestMoveParallel,
  setAIDepth,
  getAIDepth,
  setAITimeLimit,
  // Pondering
  startPondering,
  stopPondering,
  getPonderMove,
  isPondering,
  PonderState,
  setPonderProgressCallback,
  // SEE (Static Exchange Evaluation)
  SEE_PIECE_VALUES,
  getSeeValue,
  see,
  quickSee,
  // Search stats
  nodesSearched,
  // Opening book learning
  learnFromGame,
  getLearnedData,
  loadLearnedData,
  loadOpeningBook,
  buildOpeningBook,
  loadLearnedDataFromFile,
  loadLearnedDataFromStorage,
  saveLearnedDataToStorage,
};
