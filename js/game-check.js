import { PIECE_TYPE } from "./pieces.js";
import { getValidMoves } from "./pieces.js";

/**
 * Check if the king of `faction` is currently in check.
 */
export function isKingdomCheck(game, faction) {
  const king = game.pieces.find(
    (p) => p.faction === faction && p.type === PIECE_TYPE.KING && p.alive,
  );
  if (!king) return false;

  const enemies = game.pieces.filter((p) => p.faction !== faction && p.alive);
  for (const enemy of enemies) {
    const { attacks } = getValidMoves(
      enemy,
      game.boardCells,
      game._occupiedMap,
    );
    if (attacks.some((a) => a.equals(king.pos))) return true;
  }
  return false;
}

/**
 * Check if making a move would leave `faction`'s king in check.
 */
export function legalMoveCheck(game, piece, target, faction) {
  const savedIdx = game.currentFactionIdx;
  const undo = game.simulateMove(piece, target);
  game.currentFactionIdx = undo.prevFactionIdx;
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
function hasLegalMoves(game, faction) {
  const myPieces = game.pieces.filter((p) => p.faction === faction && p.alive);
  for (const piece of myPieces) {
    const { moves, attacks } = game.getLegalMoves(piece);
    if (moves.length > 0 || attacks.length > 0) return true;
  }
  return false;
}

/**
 * Check if `faction` is in checkmate.
 */
export function isCheckmateInternal(game, faction) {
  if (!isKingdomCheck(game, faction)) return false;
  return !hasLegalMoves(game, faction);
}

/**
 * Check if `faction` is in stalemate.
 */
export function isStalemateInternal(game, faction) {
  if (isKingdomCheck(game, faction)) return false;
  return !hasLegalMoves(game, faction);
}
