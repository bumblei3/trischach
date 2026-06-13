import { PIECE_TYPE, getValidMoves } from './pieces.js';
import type { IGame, Faction, Piece, Hex } from './types.js';

/**
 * Check if the king of `faction` is currently in check.
 */
export function isKingdomCheck(game: IGame, faction: Faction): boolean {
  const king = game.pieces.find((p: Piece) => p.faction === faction && p.type === PIECE_TYPE.KING && p.alive);
  if (!king) return false;

  const enemies = game.pieces.filter((p: Piece) => p.faction !== faction && p.alive);
  for (const enemy of enemies) {
    const { attacks } = getValidMoves(enemy, game.boardCells!, game._occupiedMap!);
    if (attacks.some((a: Hex) => a.equals(king.pos))) return true;
  }
  return false;
}

/**
 * Check if making a move would leave `faction`'s king in check.
 */
export function legalMoveCheck(game: IGame, piece: Piece, target: Hex, faction: Faction): boolean {
  const savedIdx = game.currentFactionIdx;
  const undo = game.simulateMove(piece, target);
  game.currentFactionIdx = undo.prevFactionIdx ?? savedIdx;
  game._rebuildOccupiedMap();
  const inCheck = isKingdomCheck(game, faction);
  game.currentFactionIdx = savedIdx;
  game._rebuildOccupiedMap();
  game.undoMove(undo);
  game.currentFactionIdx = savedIdx;
  game._rebuildOccupiedMap();
  return !inCheck;
}

/**
 * Check if `faction` has any legal moves at all.
 */
function hasLegalMoves(game: IGame, faction: Faction): boolean {
  const myPieces = game.pieces.filter((p: Piece) => p.faction === faction && p.alive);
  for (const piece of myPieces) {
    const { moves, attacks } = game.getLegalMoves(piece);
    if (moves.length > 0 || attacks.length > 0) return true;
  }
  return false;
}

/**
 * Check if `faction` is in checkmate.
 */
export function isCheckmateInternal(game: IGame, faction: Faction): boolean {
  if (!isKingdomCheck(game, faction)) return false;
  return !hasLegalMoves(game, faction);
}

/**
 * Check if `faction` is in stalemate.
 */
export function isStalemateInternal(game: IGame, faction: Faction): boolean {
  if (isKingdomCheck(game, faction)) return false;
  return !hasLegalMoves(game, faction);
}