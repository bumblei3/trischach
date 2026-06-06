import { getValidMoves, PIECE_STRENGTH } from './pieces.js';
import { getRPSResult } from './board.js';

/**
 * Calculates the best move for a given faction using a simple greedy heuristic.
 */
export function calculateBestMove(game, faction) {
  const pieces = game.getAlivePieces().filter(p => p.faction === faction);
  const occupied = game._occupiedMap;
  let bestActions = [];
  let bestScore = -Infinity;

  for (const piece of pieces) {
    const { moves, attacks } = getValidMoves(piece, game.boardCells, occupied);
    
    // Evaluate attacks
    for (const target of attacks) {
      const defender = occupied.get(target.key);
      if (!defender) continue;
      const rps = game.rpsEnabled ? getRPSResult(faction, defender.faction) : 'advantage';
      let score = 0;
      
      if (rps === 'advantage' || rps === 'neutral') {
        // High priority to capture valuable pieces
        score = 100 + PIECE_STRENGTH[defender.type];
        // Bonus if our piece is cheap (e.g. Pawn taking a Queen)
        score += (10 - PIECE_STRENGTH[piece.type]); 
      } else {
        // Suicide attack (disadvantage) - avoid at all costs
        score = -1000;
      }
      
      // Random jitter to make it less deterministic
      score += Math.random();

      if (score > bestScore) {
        bestScore = score;
        bestActions = [{ piece, target, type: 'attack' }];
      } else if (score === bestScore) {
        bestActions.push({ piece, target, type: 'attack' });
      }
    }
    
    // Evaluate moves
    for (const target of moves) {
      // Heuristic: move towards the center (0,0,0) to engage
      const distToCenter = Math.max(Math.abs(target.q), Math.abs(target.r), Math.abs(-target.q - target.r));
      const distFromCenter = Math.max(Math.abs(piece.pos.q), Math.abs(piece.pos.r), Math.abs(-piece.pos.q - piece.pos.r));
      
      let score = (distFromCenter - distToCenter) * 10;
      
      // Random jitter
      score += Math.random() * 5;

      if (score > bestScore) {
        bestScore = score;
        bestActions = [{ piece, target, type: 'move' }];
      } else if (score === bestScore) {
        bestActions.push({ piece, target, type: 'move' });
      }
    }
  }
  
  if (bestActions.length === 0) return null;
  // Return a random best action
  return bestActions[Math.floor(Math.random() * bestActions.length)];
}
