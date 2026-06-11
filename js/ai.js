import { getValidMoves, PIECE_STRENGTH } from './pieces.js';
import { getRPSResult, FACTION } from './board.js';

// ─── Heuristic Evaluation ───────────────────────────────────────────

// Position value table: center hexes are more valuable
// Precomputed for the TriSchach board (distance from center)
function posValue(hex) {
  const dist = Math.max(Math.abs(hex.q), Math.abs(hex.r), Math.abs(-hex.q - hex.r));
  // Closer to center = higher value (0 at edge, 5 at center)
  return 5 - dist;
}

// Piece-square tables per piece type (simplified for hex board)
// Encourages pieces to be active and centralized
const PST_BONUS = {
  king:   { center: -2, mobility: 0 },   // King: stay safe early
  queen:  { center: 3,  mobility: 0.3 },
  rook:   { center: 2,  mobility: 0.2 },
  bishop: { center: 2,  mobility: 0.2 },
  knight: { center: 3,  mobility: 0.3 },
  pawn:   { center: 4,  mobility: 0.1 },  // Pawns want to advance
};

/**
 * Evaluate the board from the perspective of `faction`.
 * Positive = good for faction, negative = bad.
 */
function evaluateBoard(game, faction) {
  const pieces = game.getAlivePieces();
  let score = 0;

  // 1. Material balance
  for (const p of pieces) {
    const val = PIECE_STRENGTH[p.type] * 10;
    if (p.faction === faction) {
      score += val;
    } else {
      score -= val;
    }
  }

  // 2. Positional bonus (center control + piece activity)
  for (const p of pieces) {
    const pst = PST_BONUS[p.type];
    if (!pst) continue;

    const pv = posValue(p.pos);
    const { moves, attacks } = getValidMoves(p, game.boardCells, game._occupiedMap);
    const mobility = moves.length + attacks.length;

    const bonus = pv * pst.center + mobility * pst.mobility;
    if (p.faction === faction) {
      score += bonus;
    } else {
      score -= bonus;
    }
  }

  // 3. King safety: penalize if our king is exposed (enemies nearby)
  const myKing = pieces.find(p => p.faction === faction && p.type === 'king');
  if (myKing) {
    const enemyAttackers = pieces.filter(p =>
      p.faction !== faction && p.alive
    );
    let kingThreats = 0;
    for (const enemy of enemyAttackers) {
      const { attacks } = getValidMoves(enemy, game.boardCells, game._occupiedMap);
      if (attacks.some(a => a.equals(myKing.pos))) {
        kingThreats++;
      }
    }
    score -= kingThreats * 15; // Heavy penalty for each threat to our king

    // Bonus for king being in a safe corner (start zone)
    const kingDist = Math.max(Math.abs(myKing.pos.q), Math.abs(myKing.pos.r), Math.abs(-myKing.pos.q - myKing.pos.r));
    if (kingDist >= 6) score += 8; // King in start zone = safer
  }

  // 4. Threaten enemy kings
  const enemyFactions = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE].filter(f => f !== faction);
  for (const ef of enemyFactions) {
    if (game.eliminatedFactions.has(ef)) {
      score += 200; // Enemy eliminated = very good
      continue;
    }
    const eKing = pieces.find(p => p.faction === ef && p.type === 'king');
    if (eKing) {
      const myAttackers = pieces.filter(p => p.faction === faction);
      for (const attacker of myAttackers) {
        const { attacks } = getValidMoves(attacker, game.boardCells, game._occupiedMap);
        if (attacks.some(a => a.equals(eKing.pos))) {
          score += 10; // We threaten their king
        }
      }
    }
  }

  // 5. RPS advantage awareness: bonus for having pieces that counter
  //    the strongest remaining enemy faction
  const aliveEnemies = enemyFactions.filter(f => !game.eliminatedFactions.has(f));
  if (aliveEnemies.length === 1) {
    // Endgame: focus all fire on the last enemy
    const lastEnemy = aliveEnemies[0];
    const rps = getRPSResult(faction, lastEnemy);
    if (rps === 'advantage') {
      score += 20; // We counter the last enemy
    }
  }

  // 6. Pawn advancement bonus: pawns closer to promotion (r <= 0) are more valuable
  for (const p of pieces) {
    if (p.type !== 'pawn') continue;
    const pv = p.faction === faction ? 1 : -1;
    if (p.r <= 0) {
      score += pv * 15; // About to promote!
    } else if (p.r <= 2) {
      score += pv * 5;  // Getting close
    }
  }

  return score;
}

// ─── Minimax with Alpha-Beta Pruning ───────────────────────────────

let MAX_DEPTH = 2; // Configurable: 2=fast, 3=stronger but slower

/**
 * Get all possible actions for a faction.
 */
function getAllActions(game, faction) {
  const pieces = game.getAlivePieces().filter(p => p.faction === faction);
  const actions = [];

  for (const piece of pieces) {
    // Use getLegalMoves (checks for king safety) instead of raw getValidMoves
    const { moves, attacks } = game.getLegalMoves(piece);
    for (const target of attacks) {
      const defender = game.getPieceAt(target);
      if (!defender) continue;
      const rps = game.rpsEnabled ? getRPSResult(faction, defender.faction) : 'advantage';
      actions.push({ piece, target, type: 'attack', rps });
    }
    for (const target of moves) {
      actions.push({ piece, target, type: 'move' });
    }
  }

  // Sort actions for better alpha-beta pruning:
  // Attacks first (especially high-value captures), then moves
  actions.sort((a, b) => {
    const aVal = a.type === 'attack' ? (a.rps !== 'disadvantage' ? PIECE_STRENGTH[game.getPieceAt(a.target)?.type || 'pawn'] + 10 : -100) : 0;
    const bVal = b.type === 'attack' ? (b.rps !== 'disadvantage' ? PIECE_STRENGTH[game.getPieceAt(b.target)?.type || 'pawn'] + 10 : -100) : 0;
    return bVal - aVal;
  });

  return actions;
}

/**
 * Minimax with alpha-beta pruning.
 * Returns { score, action } where action is the best move found.
 */
function minimax(game, depth, alpha, beta, maximizingFaction, currentFaction) {
  // Terminal conditions
  if (depth === 0 || game.state === 'game_over') {
    return { score: evaluateBoard(game, maximizingFaction), action: null };
  }

  const actions = getAllActions(game, currentFaction);

  if (actions.length === 0) {
    // No valid moves - evaluate current position
    return { score: evaluateBoard(game, maximizingFaction), action: null };
  }

  let bestAction = actions[0]; // Default to first action

  if (currentFaction === maximizingFaction) {
    // Maximizing player
    let maxScore = -Infinity;
    for (const action of actions) {
      // Skip suicide attacks unless no other option
      if (action.type === 'attack' && action.rps === 'disadvantage') {
        if (actions.length > 1) continue;
      }

      const undo = game.simulateMove(action.piece, action.target);
      const nextFaction = game.currentFaction;
      const result = minimax(game, depth - 1, alpha, beta, maximizingFaction, nextFaction);
      game.undoMove(undo);

      // Boost score for promotion moves
      const adjustedScore = result.score + (undo.promoted ? 50 * (result.score >= 0 ? 1 : -1) : 0);

      if (adjustedScore > maxScore) {
        maxScore = adjustedScore;
        bestAction = action;
      }
      alpha = Math.max(alpha, adjustedScore);
      if (beta <= alpha) break; // Beta cutoff
    }
    return { score: maxScore, action: bestAction };
  } else {
    // Minimizing player (opponent)
    let minScore = Infinity;
    for (const action of actions) {
      if (action.type === 'attack' && action.rps === 'disadvantage') {
        if (actions.length > 1) continue;
      }

      const undo = game.simulateMove(action.piece, action.target);
      const nextFaction = game.currentFaction;
      const result = minimax(game, depth - 1, alpha, beta, maximizingFaction, nextFaction);
      game.undoMove(undo);

      // Penalize for letting opponent promote
      const adjustedScore = result.score - (undo.promoted ? 50 * (result.score >= 0 ? 1 : -1) : 0);

      if (adjustedScore < minScore) {
        minScore = adjustedScore;
        bestAction = action;
      }
      beta = Math.min(beta, adjustedScore);
      if (beta <= alpha) break; // Alpha cutoff
    }
    return { score: minScore, action: bestAction };
  }
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Calculates the best move for a given faction using minimax with alpha-beta pruning.
 * Falls back to greedy heuristic if minimax is too expensive.
 */
export function calculateBestMove(game, faction) {
  // Safety: ensure occupied map is up to date
  game._rebuildOccupiedMap();

  const actions = getAllActions(game, faction);
  if (actions.length === 0) return null;

  // Filter out suicide attacks if alternatives exist
  const nonSuicide = actions.filter(a => !(a.type === 'attack' && a.rps === 'disadvantage'));
  const usableActions = nonSuicide.length > 0 ? nonSuicide : actions;

  // For small action spaces, use minimax
  // For large spaces (opening), limit depth or use greedy
  const pieceCount = game.getAlivePieces().length;
  const depth = pieceCount > 20 ? 1 : MAX_DEPTH;

  if (depth === 1 || usableActions.length > 30) {
    // Fallback to improved greedy for large search spaces
    return greedyBestMove(game, faction, usableActions);
  }

  const result = minimax(game, depth, -Infinity, Infinity, faction, faction);
  if (!result.action) {
    return usableActions[0];
  }
  return result.action;
}

/**
 * Improved greedy heuristic (fallback for large search spaces).
 */
function greedyBestMove(game, faction, actions) {
  let bestActions = [];
  let bestScore = -Infinity;

  for (const action of actions) {
    let score = 0;

    if (action.type === 'attack') {
      const defender = game.getPieceAt(action.target);
      if (!defender) continue;

      if (action.rps === 'advantage' || action.rps === 'neutral') {
        score = 100 + PIECE_STRENGTH[defender.type] * 10;
        score += (10 - PIECE_STRENGTH[action.piece.type]); // Cheap attacker bonus

        // Extra bonus for king capture
        if (defender.type === 'king') score += 500;
      } else {
        score = -1000; // Suicide
      }
    } else {
      // Move: center control + advancement
      const pv = posValue(action.target);
      const distFromCenter = Math.max(
        Math.abs(action.piece.pos.q), Math.abs(action.piece.pos.r),
        Math.abs(-action.piece.pos.q - action.piece.pos.r)
      );
      const distToCenter = Math.max(
        Math.abs(action.target.q), Math.abs(action.target.r),
        Math.abs(-action.target.q - action.target.r)
      );
      score = (distFromCenter - distToCenter) * 10 + pv * 2;
    }

    // Small random jitter for variety
    score += Math.random() * 0.5;

    if (score > bestScore) {
      bestScore = score;
      bestActions = [action];
    } else if (Math.abs(score - bestScore) < 0.01) {
      bestActions.push(action);
    }
  }

  if (bestActions.length === 0) return null;
  return bestActions[Math.floor(Math.random() * bestActions.length)];
}

/**
 * Set the search depth for the AI (1-4).
 * Higher = stronger but slower.
 */
export function setAIDepth(depth) {
  if (depth >= 1 && depth <= 4) {
    MAX_DEPTH = depth;
  }
}
