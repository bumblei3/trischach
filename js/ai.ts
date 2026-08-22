import { getValidMoves, PIECE_STRENGTH, PIECE_TYPE } from "./pieces.ts";
import { getRPSResult, FACTION, generateBoard } from "./board.ts";
import { Hex } from "./hex.ts";
import { isKingdomCheck } from "./game-check.ts";
import type { IGame, Faction, GameState } from "./types.ts";
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

/** A single piece as it appears in a serialized (postMessage) game state. */
interface SerializedPiece {
  id: string;
  type: string;
  faction: Faction | string;
  pos: { q: number; r: number };
  symbol: string;
  alive: boolean;
  hasMoved: boolean;
}

/** The plain-object game state sent from the main thread to the AI worker. */
export interface SerializedGameState {
  pieces: SerializedPiece[];
  currentFactionIdx: number;
  currentFaction: Faction | string;
  state: GameState | string;
  eliminatedFactions: (Faction | string)[];
  rpsEnabled: boolean;
  capturedPieces: Record<string, unknown[]> | unknown[];
  _halfmoveClock?: number;
}

/**
 * Reconstruct a Game-like object from a serialized state.
 * Ported from ai-core.js (which lacks a TS counterpart for this function).
 *
 * The reconstructed object mirrors the subset of the `IGame` surface that the
 * AI search touches (pieces, factions, occupied map, getAlivePieces/getPieces).
 * It is cast to `IGame` at the single deserialization boundary; the search code
 * never calls the UI/DOM methods that this lightweight object omits.
 */
export function deserializeGame(state: SerializedGameState): IGame {
  const game = {
    pieces: state.pieces.map((p) => ({
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
    moveHistory: [] as unknown[],
    _positionHistory: new Map(),
    _halfmoveClock: state._halfmoveClock || 0,
    // Rebuild the static board geometry. The serialized state omits
    // boardCells (it's constant), but move generation needs it to know
    // which target hexes are on the board.
    boardCells: generateBoard(),
    getAlivePieces: () => game.pieces.filter((p) => p.alive),
    getPieces: () => game.pieces,
  };

  rebuildOccupiedMap(game as unknown as IGame);
  return game as unknown as IGame;
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
