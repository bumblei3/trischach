import { getValidMoves, PIECE_STRENGTH } from './pieces.js';
import { getRPSResult, FACTION } from './board.js';
import { Hex } from './hex.js';
import { isKingdomCheck } from './game-check.js';

const TURN_ORDER = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];

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

// ─── Piece-Square Tables (Hex-adapted) ──────────────────────────────
// PST values are indexed by hex key "q,r". Values in centipawns.
// Boards are small (triangular hex), so we use distance-based formulas
// combined with piece-specific patterns.

// Pre-compute PST for each piece type using hex distance from center
// Center of the board is around (0, 2) in the central triangle
const _pstHex = new Hex(0, 0); // Reusable for key lookups

function hexDistFromCenter(hex) {
  return Math.abs(hex.q) + Math.abs(hex.r - 2) + Math.abs(-hex.q - hex.r + 2);
}

function buildPST(calcFn) {
  const table = new Map();
  for (let q = -7; q <= 2; q++) {
    for (let r = -2; r <= 7; r++) {
      _pstHex.q = q; _pstHex.r = r;
      table.set(`${q},${r}`, calcFn(_pstHex, hexDistFromCenter(_pstHex)));
    }
  }
  return table;
}

// King: prefers edges/corners (defensive)
const KING_PST = buildPST((h, d) => d * 3);

// Queen: center-seeking, values mobility
const QUEEN_PST = buildPST((h, d) => (6 - d) * 5);

// Rook: center-seeking, slightly less than queen
const ROOK_PST = buildPST((h, d) => (5 - d) * 4);

// Bishop: center-seeking (diagonal control)
const BISHOP_PST = buildPST((h, d) => (5 - d) * 4);

// Knight: strongly center-seeking (knights are weak on edges)
const KNIGHT_PST = buildPST((h, d) => (6 - d) * 8);

// Pawn: advancement bonus (toward r=0 and beyond), center columns preferred
const PAWN_PST = buildPST((h, d) => {
  const advancement = Math.max(0, 5 - h.r);
  const centerCol = Math.max(0, 3 - Math.abs(h.q));
  return advancement * 6 + centerCol * 3;
});

function getPSTValue(piece) {
  const table = {
    king: KING_PST,
    queen: QUEEN_PST,
    rook: ROOK_PST,
    bishop: BISHOP_PST,
    knight: KNIGHT_PST,
    pawn: PAWN_PST,
  }[piece.type];
  if (!table) return 0;
  return table.get(piece.pos.key) || 0;
}

// ─── Heuristic Evaluation ───────────────────────────────────────────
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

  // 2. Positional bonus: PST + mobility for own pieces
  const myPieces = pieces.filter(p => p.faction === faction);
  for (const p of myPieces) {
    score += getPSTValue(p);
    const { moves, attacks } = getValidMoves(p, game.boardCells, game._occupiedMap);
    const mobility = moves.length + attacks.length;
    // Mobility bonus varies by piece type
    const mobBonus = { queen: 0.3, rook: 0.2, bishop: 0.2, knight: 0.3, pawn: 0.1, king: 0 };
    score += mobility * (mobBonus[p.type] || 0.1);
  }
  // For enemy pieces: PST penalty + rough positional estimate
  for (const p of pieces) {
    if (p.faction === faction) continue;
    score -= getPSTValue(p) * 0.8; // Slightly less weight for enemy PST
  }

  // 3. King safety: only check threats to our king
  const myKing = pieces.find(p => p.faction === faction && p.type === 'king');
  if (myKing) {
    // Quick threat check: count enemy pieces that can attack king's square
    let kingThreats = 0;
    for (const enemy of pieces) {
      if (enemy.faction === faction || !enemy.alive) continue;
      const { attacks } = getValidMoves(enemy, game.boardCells, game._occupiedMap);
      if (attacks.some(a => a.equals(myKing.pos))) kingThreats++;
    }
    score -= kingThreats * 15;
    const kingDist = Math.max(Math.abs(myKing.pos.q), Math.abs(myKing.pos.r), Math.abs(-myKing.pos.q - myKing.pos.r));
    if (kingDist >= 6) score += 8;
  }

  // 4. King threats: count pieces threatening enemy kings
  const enemyFactions = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE].filter(f => f !== faction);
  for (const ef of enemyFactions) {
    if (game.eliminatedFactions.has(ef)) {
      score += 200;
      continue;
    }
    const eKing = pieces.find(p => p.faction === ef && p.type === 'king');
    if (eKing) {
      for (const attacker of myPieces) {
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

  // 6. Pawn structure analysis
  score += evaluatePawnStructure(pieces, faction);

  return score;
}

/**
 * Evaluate pawn structure for a given faction.
 * Checks for doubled, isolated, and connected pawns.
 * Returns score in centipawns (positive = good for faction).
 */
function evaluatePawnStructure(pieces, faction) {
  const pawns = pieces.filter(p => p.type === 'pawn');
  const myPawns = pawns.filter(p => p.faction === faction);
  const enemyPawns = pawns.filter(p => p.faction !== faction);
  let score = 0;

  // Pawn advancement (existing logic, refined)
  for (const p of myPawns) {
    if (p.r <= 0) score += 15;
    else if (p.r <= 2) score += 5;
    else if (p.r <= 4) score += 2;
  }
  for (const p of enemyPawns) {
    if (p.r <= 0) score -= 15;
    else if (p.r <= 2) score -= 5;
    else if (p.r <= 4) score -= 2;
  }

  // Doubled pawns: penalty for multiple pawns in same column (q)
  const myColumnCounts = {};
  const enemyColumnCounts = {};
  for (const p of myPawns) { myColumnCounts[p.q] = (myColumnCounts[p.q] || 0) + 1; }
  for (const p of enemyPawns) { enemyColumnCounts[p.q] = (enemyColumnCounts[p.q] || 0) + 1; }
  for (const q in myColumnCounts) {
    if (myColumnCounts[q] > 1) score -= (myColumnCounts[q] - 1) * 10;
  }
  for (const q in enemyColumnCounts) {
    if (enemyColumnCounts[q] > 1) score += (enemyColumnCounts[q] - 1) * 10;
  }

  // Isolated pawns: no friendly pawn on adjacent columns (q-1 or q+1)
  for (const p of myPawns) {
    const hasNeighbor = myPawns.some(other => other !== p && Math.abs(other.q - p.q) <= 1);
    if (!hasNeighbor) score -= 8;
  }
  for (const p of enemyPawns) {
    const hasNeighbor = enemyPawns.some(other => other !== p && Math.abs(other.q - p.q) <= 1);
    if (!hasNeighbor) score += 8;
  }

  // Connected pawns: friendly pawn on adjacent column at same or nearby row
  for (const p of myPawns) {
    const hasConnected = myPawns.some(other =>
      other !== p && Math.abs(other.q - p.q) <= 1 && Math.abs(other.r - p.r) <= 1
    );
    if (hasConnected) score += 5;
  }
  for (const p of enemyPawns) {
    const hasConnected = enemyPawns.some(other =>
      other !== p && Math.abs(other.q - p.q) <= 1 && Math.abs(other.r - p.r) <= 1
    );
    if (hasConnected) score -= 5;
  }

  return score;
}

export { evaluateBoard };

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

// ─── Killer Moves & History Heuristic ────────────────────────────────

// killerMoves[depth] = [move1, move2] (two killer slots per depth)
const killerMoves = {};
// historyTable[fromKey][toKey] = cumulative history score
const historyTable = {};

function getKiller(depth) {
  if (!killerMoves[depth]) killerMoves[depth] = [null, null];
  return killerMoves[depth];
}

function storeKiller(depth, action) {
  const killers = getKiller(depth);
  // Don't store duplicates
  if (killers[0] && actionEquals(killers[0], action)) return;
  killers[1] = killers[0];
  killers[0] = action;
}

function actionEquals(a, b) {
  return a && b && a.piece.id === b.piece.id && a.target.equals(b.target);
}

function historyKey(action) {
  return `${action.piece.pos.key}->${action.target.key}`;
}

function getHistoryScore(action) {
  return historyTable[historyKey(action)] || 0;
}

function updateHistory(depth, action) {
  const key = historyKey(action);
  historyTable[key] = (historyTable[key] || 0) + depth * depth;
}

/**
 * Score an action for move ordering. Higher = search first.
 * Order: TT move > winning captures > killer moves > history > losing captures > quiet moves
 */
function scoreAction(action, ttAction, depth) {
  // TT move gets highest priority
  if (ttAction && actionEquals(action, ttAction)) return 100000;

  // Captures: MVV-LVA (Most Valuable Victim - Least Valuable Attacker)
  if (action.type === 'attack') {
    if (action.rps === 'disadvantage') return -1000; // Suicide moves last
    // We don't have direct access to defender piece here without lookup,
    // but the sort in getAllActions already handles capture ordering
    return 5000 + (action.rps === 'advantage' ? 100 : 0);
  }

  // Killer moves
  const killers = getKiller(depth);
  if (killers[0] && actionEquals(action, killers[0])) return 900;
  if (killers[1] && actionEquals(action, killers[1])) return 800;

  // History heuristic
  return getHistoryScore(action);
}

function orderActions(actions, ttAction, depth) {
  return actions.slice().sort((a, b) => scoreAction(b, ttAction, depth) - scoreAction(a, ttAction, depth));
}

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
  if (game.state === 'game_over') {
    return { score: evaluateBoard(game, maximizingFaction), action: null };
  }

  const actions = getAllActions(game, currentFaction);

  if (actions.length === 0) {
    return { score: evaluateBoard(game, maximizingFaction), action: null };
  }

  // Quiescence search: at depth 0, only evaluate if position is "quiet"
  // (no high-value captures available). Otherwise, search captures to a
  // limited depth to avoid the "horizon effect".
  if (depth <= 0) {
    return quiesce(game, alpha, beta, maximizingFaction, currentFaction);
  }

  // Null-Move Pruning: if the current player has more than just the king,
  // try passing the turn. If the position is still good enough for a beta
  // cutoff, prune the tree. Uses R=2 reduction.
  const NULL_MOVE_R = 2;
  const canNullMove =
    depth >= (NULL_MOVE_R + 1) &&
    currentFaction === maximizingFaction &&
    game.getAlivePieces().filter(p => p.faction === currentFaction).length > 1;

  if (canNullMove && !isKingdomCheck(game, currentFaction)) {
    // Make null move by advancing the turn without moving
    const savedIdx = game.currentFactionIdx;
    game._nextTurn();
    const nullResult = minimax(
      game, depth - 1 - NULL_MOVE_R, -beta, -beta + 1,
      maximizingFaction, game.currentFaction
    );
    // Undo null move: restore turn
    game.currentFactionIdx = savedIdx;
    game.currentFaction = TURN_ORDER[savedIdx];

    if (!nullResult.timeout && nullResult.score >= beta) {
      return { score: beta, action: null };
    }
  }

  // Order moves: TT move > captures > killers > history > quiet
  const ttAction = ttEntry ? ttEntry.action : null;
  const ordered = orderActions(actions, ttAction, depth);

  let bestAction = ordered[0];
  let bestScore = currentFaction === maximizingFaction ? -Infinity : Infinity;
  let flag = 'upper';

  if (currentFaction === maximizingFaction) {
    for (const action of ordered) {
      if (action.type === 'attack' && action.rps === 'disadvantage' && ordered.length > 1) continue;

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
      if (alpha >= beta) {
        flag = 'lower';
        // Store killer move (non-capture that caused beta cutoff)
        if (action.type !== 'attack') storeKiller(depth, action);
        // Update history for all quiet moves searched so far
        updateHistory(depth, action);
        break;
      }
      if (bestScore > -Infinity) flag = 'exact';
    }
  } else {
    for (const action of ordered) {
      if (action.type === 'attack' && action.rps === 'disadvantage' && ordered.length > 1) continue;

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
      if (alpha >= beta) {
        flag = 'upper';
        if (action.type !== 'attack') storeKiller(depth, action);
        updateHistory(depth, action);
        break;
      }
      if (bestScore < Infinity) flag = 'exact';
    }
  }

  // Store in transposition table
  if (tt.size < 500000) {
    tt.set(hash, { depth, score: bestScore, action: bestAction, flag });
  }

  return { score: bestScore, action: bestAction };
}

/**
 * Quiescence search: searches capture chains beyond the normal depth limit
 * to avoid the "horizon effect" where the AI misses obvious captures.
 * Searches only attack moves (not quiet moves) to keep it fast.
 * Limited to depth -4 (max 4 plies of quiescence).
 */
function quiesce(game, alpha, beta, maximizingFaction, currentFaction, qDepth = 0) {
  // Stand pat: evaluate the current position
  const standPat = evaluateBoard(game, maximizingFaction);

  // Don't search too deep in quiescence
  if (qDepth >= 4) {
    return { score: standPat };
  }

  if (currentFaction === maximizingFaction) {
    if (standPat >= beta) return { score: beta };
    alpha = Math.max(alpha, standPat);

    // Search only attacks (captures), sorted by value
    const attackActions = getAllActions(game, currentFaction)
      .filter(a => a.type === 'attack' && a.rps !== 'disadvantage');

    for (const action of attackActions) {
      const undo = game.simulateMove(action.piece, action.target);
      const result = quiesce(game, alpha, beta, maximizingFaction, game.currentFaction, qDepth + 1);
      game.undoMove(undo);

      if (result.score >= beta) return { score: beta };
      alpha = Math.max(alpha, result.score);
    }
    return { score: alpha };
  } else {
    if (standPat <= alpha) return { score: alpha };
    beta = Math.min(beta, standPat);

    const attackActions = getAllActions(game, currentFaction)
      .filter(a => a.type === 'attack' && a.rps !== 'disadvantage');

    for (const action of attackActions) {
      const undo = game.simulateMove(action.piece, action.target);
      const result = quiesce(game, alpha, beta, maximizingFaction, game.currentFaction, qDepth + 1);
      game.undoMove(undo);

      if (result.score <= alpha) return { score: alpha };
      beta = Math.min(beta, result.score);
    }
    return { score: beta };
  }
}

// ─── Iterative Deepening ────────────────────────────────────────────

function iterativeDeepening(game, faction) {
  searchDeadline = Date.now() + TIME_LIMIT_MS;
  nodesSearched = 0;
  tt.clear();
  // Clear killer moves and history for fresh search
  for (const key in killerMoves) delete killerMoves[key];
  for (const key in historyTable) delete historyTable[key];

  const actions = getAllActions(game, faction);
  if (actions.length === 0) return null;
  if (actions.length === 1) return actions[0];

  let bestResult = { score: -Infinity, action: actions[0] };
  let prevScore = 0;

  // Iterative deepening: search depth 1, 2, 3... until time runs out
  for (let depth = 1; depth <= MAX_DEPTH; depth++) {
    // Aspiration window: narrow window around previous score
    // First iteration uses full window
    let alpha, beta;
    if (depth <= 1) {
      alpha = -Infinity;
      beta = Infinity;
    } else {
      const windowSize = 50;
      alpha = prevScore - windowSize;
      beta = prevScore + windowSize;
    }

    let result = minimax(game, depth, alpha, beta, faction, faction);

    // If aspiration window fails low or high, re-search with full window
    if (!result.timeout && result.score <= alpha) {
      result = minimax(game, depth, -Infinity, beta, faction, faction);
    } else if (!result.timeout && result.score >= beta) {
      result = minimax(game, depth, alpha, Infinity, faction, faction);
    }

    // If still failing, use full window
    if (!result.timeout && (result.score <= -Infinity + 1 || result.score >= Infinity - 1)) {
      result = minimax(game, depth, -Infinity, Infinity, faction, faction);
    }

    if (!result.timeout) {
      bestResult = result;
      prevScore = result.score;
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
      const pv = getPSTValue({ type: 'pawn', pos: action.target });
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
