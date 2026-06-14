/**
 * TriSchach AI Core - Shared Logic
 * 
 * Contains all shared AI logic used by both main thread (ai.ts)
 * and Web Worker (ai-worker.ts).
 * 
 * DO NOT MODIFY ai.ts or ai-worker.ts directly for shared logic!
 * Add/modify here, then both consumers stay in sync.
 */

// @ts-nocheck
import { getValidMoves, PIECE_STRENGTH } from './pieces.ts';
import { getRPSResult, FACTION } from './board.ts';
import { Hex } from './hex.ts';
import { isKingdomCheck, legalMoveCheck, getLegalMoves } from './game-check.ts';
import { pickBookMove, buildOpeningBook } from './opening-book.ts';
import type { 
  IGame, 
  Faction, 
  Piece, 
  PieceType, 
  AIAction, 
  AISnapshot, 
  SearchResult,
  PersonalityWeights,
  PersonalityConfig,
  AIPersonality
} from './types.ts';