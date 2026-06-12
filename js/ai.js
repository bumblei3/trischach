import { getValidMoves, PIECE_STRENGTH } from './pieces.js';
import { getRPSResult, FACTION } from './board.js';

// ─── Configuration ──────────────────────────────────────────────────

let MAX_DEPTH = 3;
const TIME_LIMIT_MS = 5000; // 5 seconds per move

// ─── Transposition Table ────────────────────────────────────────────

const tt = new Map();

function boardHash(game) {
  // Simple hash: piece positions + current faction
  const pieces = game.getAlivePieces()
    .filter(p => p.alive)
    .map(p => `${p.faction[0]}${p.type[0]}${p.pos.q},${p.pos.r}`)
    .sort()
    .join('|');
  return `${pieces}#${game.currentFactionIdx}`;
}

// ─── Heuristic Evaluation ───────────────────────────────────────────

function posValue(hex) {
  const dist = Math.max(Math.abs(hex.q), Math.abs(hex.r), Math.abs(-hex.q - hex.r));
  return 5 - dist;
}

const PST_BONUS = {
  king:   { center: -2, mobility: 0 },
  queen:  { center: 3,  mobility: 0.3 },
  rook:   { center: 2,  mobility: 0.2 },
  bishop: { center: 2,  mobility: 0.2 },
  knight: { center: 3,  mobility: 0.3 },
  pawn:   { center: 4,  mobility: 0.1 },
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
    score += (p.faction === faction ? val : -val);
  }

  // 2. Positional bonus (center control + piece activity)
  for (const p of pieces) {
    const pst = PST_BONUS[p.type];
    if (!pst) continue;
    const pv = posValue(p.pos);
    const { moves, attacks } = getValidMoves(p, game.boardCells, game._occupiedMap);
    const mobility = moves.length + attacks.length;
    const bonus = pv * pst.center + mobility * pst.mobility;
    score += (p.faction === faction ? bonus : -bonus);
  }

  // 3. King safety
  const myKing = pieces.find(p => p.faction === faction && p.type === 'king');
  if (myKing) {
    const enemyAttackers = pieces.filter(p => p.faction !== faction && p.alive);
    let kingThreats = 0;
    for (const enemy of enemyAttackers) {
      const { attacks } = getValidMoves(enemy, game.boardCells, game._occupiedMap);
      if (attacks.some(a => a.equals(myKing.pos))) kingThreats++;
    }
    score -= kingThreats * 15;
    const kingDist = Math.max(Math.abs(myKing.pos.q), Math.abs(myKing.pos.r), Math.abs(-myKing.pos.q - myKing.pos.r));
    if (kingDist >= 6) score += 8;
  }

  // 4. Threaten enemy kings
  const enemyFactions = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE].filter(f => f !== faction);
  for (const ef of enemyFactions) {
    if (game.eliminatedFactions.has(ef)) {
      score += 200;
      continue;
    }
    const eKing = pieces.find(p => p.faction === ef && p.type === 'king');
    if (eKing) {
      const myAttackers = pieces.filter(p => p.faction === faction);
      for (const attacker of myAttackers) {
        const { attacks } = getValidMoves(attacker, game.boardCells, game._occupiedMap);
        if (attacks.some(a => a.equals(eKing.pos))) score += 10;
      }
    }
  }

  // 5. RPS advantage in endgame
  const aliveEnemies = enemyFactions.filter(f => !game.eliminatedFactions.has(f));
  if (aliveEnemies.length === 1) {
    const rps = getRPSResult(faction, aliveEnemies[0]);
    if (rps === 'advantage') score += 20;
  }

  // 6. Pawn advancement
  for (const p of pieces) {
    if (p.type !== 'pawn') continue;
    const pv = p.faction === faction ? 1 : -1;
    if (p.r <= 0) score += pv * 15;
    else if (p.r <= 2) score += pv * 5;
  }

  return score;
}

// ─── Move Generation ────────────────────────────────────────────────

function getAllActions(game, faction) {
  const pieces = game.getAlivePieces().filter(p => p.faction === faction);
  const actions = [];

  for (const piece of pieces) {
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

  // Sort: attacks first (high-value captures), then moves
  actions.sort((a, b) => {
    const aVal = a.type === 'attack'
      ? (a.rps !== 'disadvantage' ? PIECE_STRENGTH[game.getPieceAt(a.target)?.type || 'pawn'] + 10 : -100)
      : 0;
    const bVal = b.type === 'attack'
      ? (b.rps !== 'disadvantage' ? PIECE_STRENGTH[game.getPieceAt(b.target)?.type || 'pawn'] + 10 : -100)
      : 0;
    return bVal - aVal;
  });

  return actions;
}

// ─── Minimax with Alpha-Beta + Transposition Table ─────────────────

let searchDeadline = 0;
let nodesSearched = 0;

function minimax(game, depth, alpha, beta, maximizingFaction, currentFaction) {
  // Time check
  nodesSearched++;
  if (nodesSearched % 1000 === 0 && Date.now() > searchDeadline) {
    return { score: evaluateBoard(game, maximizingFaction), action: null, timeout: true };
  }

  // Transposition table lookup
  const hash = boardHash(game);
  const ttEntry = tt.get(hash);
  if (ttEntry && ttEntry.depth >= depth) {
    if (ttEntry.flag === 'exact') return { score: ttEntry.score, action: ttEntry.action };
    if (ttEntry.flag === 'lower') alpha = Math.max(alpha, ttEntry.score);
    if (ttEntry.flag === 'upper') beta = Math.min(beta, ttEntry.score);
    if (alpha >= beta) return { score: ttEntry.score, action: ttEntry.action };
  }

  // Terminal conditions
  if (depth === 0 || game.state === 'game_over') {
    return { score: evaluateBoard(game, maximizingFaction), action: null };
  }

  const actions = getAllActions(game, currentFaction);

  if (actions.length === 0) {
    return { score: evaluateBoard(game, maximizingFaction), action: null };
  }

  let bestAction = actions[0];
  let bestScore = currentFaction === maximizingFaction ? -Infinity : Infinity;
  let flag = 'upper';

  if (currentFaction === maximizingFaction) {
    for (const action of actions) {
      if (action.type === 'attack' && action.rps === 'disadvantage' && actions.length > 1) continue;

      const undo = game.simulateMove(action.piece, action.target);
      const result = minimax(game, depth - 1, alpha, beta, maximizingFaction, game.currentFaction);
      game.undoMove(undo);

      if (result.timeout) return { score: bestScore, action: bestAction, timeout: true };

      const adjustedScore = result.score + (undo.promoted ? 50 * (result.score >= 0 ? 1 : -1) : 0);

      if (adjustedScore > bestScore) {
        bestScore = adjustedScore;
        bestAction = action;
      }
      alpha = Math.max(alpha, adjustedScore);
      if (alpha >= beta) { flag = 'lower'; break; }
      if (bestScore > -Infinity) flag = 'exact';
    }
  } else {
    for (const action of actions) {
      if (action.type === 'attack' && action.rps === 'disadvantage' && actions.length > 1) continue;

      const undo = game.simulateMove(action.piece, action.target);
      const result = minimax(game, depth - 1, alpha, beta, maximizingFaction, game.currentFaction);
      game.undoMove(undo);

      if (result.timeout) return { score: bestScore, action: bestAction, timeout: true };

      const adjustedScore = result.score - (undo.promoted ? 50 * (result.score >= 0 ? 1 : -1) : 0);

      if (adjustedScore < bestScore) {
        bestScore = adjustedScore;
        bestAction = action;
      }
      beta = Math.min(beta, adjustedScore);
      if (alpha >= beta) { flag = 'upper'; break; }
      if (bestScore < Infinity) flag = 'exact';
    }
  }

  // Store in transposition table
  if (tt.size < 500000) {
    tt.set(hash, { depth, score: bestScore, action: bestAction, flag });
  }

  return { score: bestScore, action: bestAction };
}

// ─── Iterative Deepening ────────────────────────────────────────────

function iterativeDeepening(game, faction) {
  searchDeadline = Date.now() + TIME_LIMIT_MS;
  nodesSearched = 0;
  tt.clear();

  const actions = getAllActions(game, faction);
  if (actions.length === 0) return null;
  if (actions.length === 1) return actions[0];

  let bestResult = { score: -Infinity, action: actions[0] };

  // Iterative deepening: search depth 1, 2, 3... until time runs out
  for (let depth = 1; depth <= MAX_DEPTH; depth++) {
    const result = minimax(game, depth, -Infinity, Infinity, faction, faction);

    if (!result.timeout) {
      bestResult = result;
    } else {
      // Time ran out - use best result from previous depth
      break;
    }
  }

  return bestResult.action;
}

// ─── Greedy Fallback ────────────────────────────────────────────────

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
        score += (10 - PIECE_STRENGTH[action.piece.type]);
        if (defender.type === 'king') score += 500;
      } else {
        score = -1000;
      }
    } else {
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

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Calculates the best move for a given faction using iterative deepening
 * minimax with alpha-beta pruning and transposition table.
 */
export function calculateBestMove(game, faction) {
  game._rebuildOccupiedMap();

  const actions = getAllActions(game, faction);
  if (actions.length === 0) return null;

  const nonSuicide = actions.filter(a => !(a.type === 'attack' && a.rps === 'disadvantage'));
  const usableActions = nonSuicide.length > 0 ? nonSuicide : actions;

  const pieceCount = game.getAlivePieces().length;

  // Use greedy for very large search spaces (opening)
  if (pieceCount > 24 || usableActions.length > 40) {
    return greedyBestMove(game, faction, usableActions);
  }

  // Use iterative deepening minimax for mid/late game
  return iterativeDeepening(game, faction);
}

/**
 * Set the maximum search depth for the AI (1-5).
 * Higher = stronger but slower.
 */
export function setAIDepth(depth) {
  if (depth >= 1 && depth <= 5) {
    MAX_DEPTH = depth;
  }
}
