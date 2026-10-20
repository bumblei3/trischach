import type { GameState, GameResult } from "./types.ts";
import { isKingdomCheck, legalMoveCheck, isCheckmateInternal, isStalemateInternal } from "./game-check.ts";
import { PIECE_TYPE } from "./pieces.ts";
import type { PieceType } from "./types.ts";

// Re-export for backwards compatibility
export {
  isKingdomCheck as isKingInCheck,
  legalMoveCheck as wouldBeInCheck,
  isCheckmateInternal as isCheckmate,
  isStalemateInternal as isStalemate,
};

// Re-export types
export type { GameResult, Piece, GameState } from "./types.ts";

export const GAME_STATE = {
  SELECT_PIECE: "select_piece",
  SELECT_TARGET: "select_target",
  PROMOTION: "promotion",
  GAME_OVER: "game_over",
  DRAW_REPETITION: "draw_repetition",
  DRAW_50MOVE: "draw_50move",
} as const satisfies Record<string, GameState>;

// Promotion: piece types a pawn can promote to (excluding king and pawn)
export const PROMOTION_CHOICES: readonly PieceType[] = [
  PIECE_TYPE.QUEEN,
  PIECE_TYPE.ROOK,
  PIECE_TYPE.BISHOP,
  PIECE_TYPE.KNIGHT,
] as const;
