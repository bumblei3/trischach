/**
 * TriSchach AI Web Worker
 * 
 * Runs minimax search off the main thread to prevent UI freezing.
 * Communicates via postMessage:
 *   - Main -> Worker: { type: 'calculate', gameState, faction, depth }
 *   - Worker -> Main: { type: 'result', move } or { type: 'progress', depth, score, nodes }
 */

import { getValidMoves, PIECE_STRENGTH, PIECE_TYPE } from './pieces.js';
import { getRPSResult, FACTION } from './board.js';
import { Hex } from './hex.js';
import { isKingdomCheck } from './game-check.js';
import { pickBookMove, buildOpeningBook, inBook } from './opening-book.js';

// ============================================================================
// COPIED/ADAPTED FROM ai.js - keep in sync!
// ============================================================================

const TURN_ORDER = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];

let MAX_DEPTH = 3;
const TIME_LIMIT_MS = 5000;

const tt = new Map();

function boardHash(game) {
  const pieces = game.pieces
    .filter(p => p.alive)
    .map(p => `${p.faction[0]}${p.type[0]}${p.pos.q},${p.pos.r}`)
    .sort()
    .join('|');
  return `${pieces}#${game.currentFactionIdx}`;
}

// --- Piece-Square Tables ---
const _pstHex = new Hex(0, 0);

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

const KING_PST = buildPST((h, d) => d * 3);
const QUEEN_PST = buildPST((h, d) => (6 - d) * 5);
const ROOK_PST = buildPST((h, d) => (5 - d) * 4);
const BISHOP_PST = buildPST((h, d) => (5 - d) * 4);
const KNIGHT_PST = buildPST((h, d) => (6 - d) * 8);
const PAWN_PST = buildPST((h, d) => {
  const advancement = Math.max(0, 5 - h.r);
  const centerCol = Math.max(0, 3 - Math.abs(h.q));
  return advancement * 6 + centerCol * 3;
});

function getPSTValue(piece) {
  const table = {
    king: KING_PST, queen: QUEEN_PST, rook: ROOK_PST,
    bishop: BISHOP_PST, knight: KNIGHT_PST, pawn: PAWN_PST,
  }[piece.type];
  if (!table) return 0;
  return table.get(piece.pos.key) || 0;
}

// --- Evaluation ---
function evaluatePawnStructure(pieces, faction) {
  const pawns = pieces.filter(p => p.type === 'pawn');
  const myPawns = pawns.filter(p => p.faction === faction);
  const enemyPawns = pawns.filter(p => p.faction !== faction);
  let score = 0;

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

  const myColumnCounts = {};
  const enemyColumnCounts = {};
  for (const p of myPawns) myColumnCounts[p.q] = (myColumnCounts[p.q] || 0) + 1;
  for (const p of enemyPawns) enemyColumnCounts[p.q] = (enemyColumnCounts[p.q] || 0) + 1;
  for (const q in myColumnCounts) if (myColumnCounts[q] > 1) score -= (myColumnCounts[q] - 1) * 10;
  for (const q in enemyColumnCounts) if (enemyColumnCounts[q] > 1) score += (enemyColumnCounts[q] - 1) * 10;

  for (const p of myPawns) {
    const hasNeighbor = myPawns.some(other => other !== p && Math.abs(other.q - p.q) <= 1);
    if (!hasNeighbor) score -= 8;
  }
  for (const p of enemyPawns) {
    const hasNeighbor = enemyPawns.some(other => other !== p && Math.abs(other.q - p.q) <= 1);
    if (!hasNeighbor) score += 8;
  }

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

function evaluateBoard(game, faction) {
  const pieces = game.pieces.filter(p => p.alive);
  let score = 0;

  // Material
  for (const p of pieces) {
    const val = PIECE_STRENGTH[p.type] * 10;
    score += (p.faction === faction ? val : -val);
  }

  // Positional: PST + mobility for own pieces
  const myPieces = pieces.filter(p => p.faction === faction);
  for (const p of myPieces) {
    score += getPSTValue(p);
    const { moves, attacks } = getValidMoves(p, game.boardCells, game._occupiedMap);
    const mobility = moves.length + attacks.length;
    const mobBonus = { queen: 0.3, rook: 0.2, bishop: 0.2, knight: 0.3, pawn: 0.1, king: 0 };
    score += mobility * (mobBonus[p.type] || 0.1);
  }
  for (const p of pieces) {
    if (p.faction === faction) continue;
    score -= getPSTValue(p) * 0.8;
  }

  // King safety
  const myKing = pieces.find(p => p.faction === faction && p.type === 'king');
  if (myKing) {
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

  // King threats
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

  // RPS endgame
  const aliveEnemies = enemyFactions.filter(f => !game.eliminatedFactions.has(f));
  if (aliveEnemies.length === 1) {
    const rps = getRPSResult(faction, aliveEnemies[0]);
    if (rps === 'advantage') score += 20;
  }

  score += evaluatePawnStructure(pieces, faction);
  return score;
}

// --- Move Generation ---
function getAllActions(game, faction) {
  const pieces = game.pieces.filter(p => p.faction === faction && p.alive);
  const actions = [];

  for (const piece of pieces) {
    const { moves, attacks } = getLegalMoves(game, piece);
    for (const target of attacks) {
      const defender = game.pieces.find(p => p.alive && p.pos.equals(target));
      if (!defender) continue;
      const rps = game.rpsEnabled ? getRPSResult(faction, defender.faction) : 'advantage';
      actions.push({ piece, target, type: 'attack', rps });
    }
    for (const target of moves) {
      actions.push({ piece, target, type: 'move' });
    }
  }

  actions.sort((a, b) => {
    const aVal = a.type === 'attack'
      ? (a.rps !== 'disadvantage' ? PIECE_STRENGTH[game.pieces.find(p => p.alive && p.pos.equals(a.target))?.type || 'pawn'] + 10 : -100)
      : 0;
    const bVal = b.type === 'attack'
      ? (b.rps !== 'disadvantage' ? PIECE_STRENGTH[game.pieces.find(p => p.alive && p.pos.equals(b.target))?.type || 'pawn'] + 10 : -100)
      : 0;
    return bVal - aVal;
  });

  return actions;
}

function getLegalMoves(game, piece) {
  const { moves, attacks } = getValidMoves(piece, game.boardCells, game._occupiedMap);
  const legalMoves = [];
  const legalAttacks = [];
  for (const target of moves) {
    if (legalMoveCheck(game, piece, target, piece.faction)) legalMoves.push(target);
  }
  for (const target of attacks) {
    if (legalMoveCheck(game, piece, target, piece.faction)) legalAttacks.push(target);
  }
  return { moves: legalMoves, attacks: legalAttacks };
}

function legalMoveCheck(game, piece, target, faction) {
  const savedIdx = game.currentFactionIdx;
  const undo = simulateMove(game, piece, target);
  game.currentFactionIdx = undo.prevFactionIdx;
  rebuildOccupiedMap(game);
  const inCheck = isKingdomCheck(game, faction);
  game.currentFactionIdx = savedIdx;
  rebuildOccupiedMap(game);
  undoMove(game, undo);
  game.currentFactionIdx = savedIdx;
  rebuildOccupiedMap(game);
  return !inCheck;
}

// --- Game simulation (simplified, no callbacks) ---
function rebuildOccupiedMap(game) {
  game._occupiedMap = new Map();
  for (const p of game.pieces) {
    if (p.alive) game._occupiedMap.set(p.pos.key, p);
  }
}

function simulateMove(game, piece, target) {
  const undo = {
    piece,
    from: new Hex(piece.pos.q, piece.pos.r),
    pieceHasMoved: piece.hasMoved,
    wasAttack: false,
    defender: null,
    defenderWasKilled: false,
    attackerDied: false,
    eliminatedFaction: null,
    prevFactionIdx: game.currentFactionIdx,
  };

  const defender = game._occupiedMap.get(target.key);

  if (defender) {
    undo.wasAttack = true;
    undo.defender = defender;

    const rps = game.rpsEnabled ? getRPSResult(piece.faction, defender.faction) : 'advantage';

    if (rps === 'advantage' || rps === 'neutral') {
      defender.alive = false;
      undo.defenderWasKilled = true;
      piece.pos = target;
      piece.hasMoved = true;

      if (defender.type === PIECE_TYPE.KING) {
        undo.eliminatedFaction = defender.faction;
        game.eliminatedFactions.add(defender.faction);
        for (const p of game.pieces) {
          if (p.faction === defender.faction) p.alive = false;
        }
      }
    } else {
      piece.alive = false;
      undo.attackerDied = true;

      if (piece.type === PIECE_TYPE.KING) {
        undo.eliminatedFaction = piece.faction;
        game.eliminatedFactions.add(piece.faction);
        for (const p of game.pieces) {
          if (p.faction === piece.faction) p.alive = false;
        }
      }
    }
  } else {
    piece.pos = target;
    piece.hasMoved = true;
  }

  if (piece.alive && piece.type === PIECE_TYPE.PAWN && target.r <= 0) {
    undo.promoted = true;
  }

  rebuildOccupiedMap(game);
  nextTurn(game);
  return undo;
}

function undoMove(game, undo) {
  game.currentFactionIdx = undo.prevFactionIdx;
  game.currentFaction = TURN_ORDER[game.currentFactionIdx];

  if (undo.eliminatedFaction) {
    game.eliminatedFactions.delete(undo.eliminatedFaction);
    for (const p of game.pieces) {
      if (p.faction === undo.eliminatedFaction) p.alive = true;
    }
  }

  if (undo.wasAttack) {
    if (undo.defenderWasKilled && undo.defender) {
      undo.defender.alive = true;
    }
    if (undo.attackerDied) {
      undo.piece.alive = true;
    }
  }

  undo.piece.pos = undo.from;
  undo.piece.hasMoved = undo.pieceHasMoved;

  rebuildOccupiedMap(game);
}

function nextTurn(game) {
  const startIdx = game.currentFactionIdx;
  do {
    game.currentFactionIdx = (game.currentFactionIdx + 1) % 3;
    if (game.currentFactionIdx === startIdx) break;
  } while (game.eliminatedFactions.has(TURN_ORDER[game.currentFactionIdx]));
  game.currentFaction = TURN_ORDER[game.currentFactionIdx];
}

// --- Killer Moves & History ---
const killerMoves = {};
const historyTable = {};

function getKiller(depth) {
  if (!killerMoves[depth]) killerMoves[depth] = [null, null];
  return killerMoves[depth];
}

function storeKiller(depth, action) {
  const killers = getKiller(depth);
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

function scoreAction(action, ttAction, depth) {
  if (ttAction && actionEquals(action, ttAction)) return 100000;
  if (action.type === 'attack') {
    if (action.rps === 'disadvantage') return -1000;
    return 5000 + (action.rps === 'advantage' ? 100 : 0);
  }
  const killers = getKiller(depth);
  if (killers[0] && actionEquals(action, killers[0])) return 900;
  if (killers[1] && actionEquals(action, killers[1])) return 800;
  return getHistoryScore(action);
}

function orderActions(actions, ttAction, depth) {
  return actions.slice().sort((a, b) => scoreAction(b, ttAction, depth) - scoreAction(a, ttAction, depth));
}

// --- Search ---
let searchDeadline = 0;
let nodesSearched = 0;

function minimax(game, depth, alpha, beta, maximizingFaction, currentFaction) {
  nodesSearched++;
  if (nodesSearched % 1000 === 0 && Date.now() > searchDeadline) {
    return { score: evaluateBoard(game, maximizingFaction), action: null, timeout: true };
  }

  const hash = boardHash(game);
  const ttEntry = tt.get(hash);
  if (ttEntry && ttEntry.depth >= depth) {
    if (ttEntry.flag === 'exact') return { score: ttEntry.score, action: ttEntry.action };
    if (ttEntry.flag === 'lower') alpha = Math.max(alpha, ttEntry.score);
    if (ttEntry.flag === 'upper') beta = Math.min(beta, ttEntry.score);
    if (alpha >= beta) return { score: ttEntry.score, action: ttEntry.action };
  }

  if (game.state === 'game_over') {
    return { score: evaluateBoard(game, maximizingFaction), action: null };
  }

  const actions = getAllActions(game, currentFaction);
  if (actions.length === 0) {
    return { score: evaluateBoard(game, maximizingFaction), action: null };
  }

  if (depth <= 0) {
    return quiesce(game, alpha, beta, maximizingFaction, currentFaction);
  }

  const NULL_MOVE_R = 2;
  const canNullMove =
    depth >= (NULL_MOVE_R + 1) &&
    currentFaction === maximizingFaction &&
    game.pieces.filter(p => p.faction === currentFaction && p.alive).length > 1;

  if (canNullMove && !isKingdomCheck(game, currentFaction)) {
    const savedIdx = game.currentFactionIdx;
    nextTurn(game);
    const nullResult = minimax(
      game, depth - 1 - NULL_MOVE_R, -beta, -beta + 1,
      maximizingFaction, game.currentFaction
    );
    game.currentFactionIdx = savedIdx;
    game.currentFaction = TURN_ORDER[savedIdx];
    rebuildOccupiedMap(game);

    if (!nullResult.timeout && nullResult.score >= beta) {
      return { score: beta, action: null };
    }
  }

  const ttAction = ttEntry ? ttEntry.action : null;
  const ordered = orderActions(actions, ttAction, depth);

  let bestAction = ordered[0];
  let bestScore = currentFaction === maximizingFaction ? -Infinity : Infinity;
  let flag = 'upper';

  if (currentFaction === maximizingFaction) {
    for (const action of ordered) {
      if (action.type === 'attack' && action.rps === 'disadvantage' && ordered.length > 1) continue;

      const undo = simulateMove(game, action.piece, action.target);
      const result = minimax(game, depth - 1, alpha, beta, maximizingFaction, game.currentFaction);
      undoMove(game, undo);

      if (result.timeout) return { score: bestScore, action: bestAction, timeout: true };

      const adjustedScore = result.score + (undo.promoted ? 50 * (result.score >= 0 ? 1 : -1) : 0);

      if (adjustedScore > bestScore) {
        bestScore = adjustedScore;
        bestAction = action;
      }
      alpha = Math.max(alpha, adjustedScore);
      if (alpha >= beta) {
        flag = 'lower';
        if (action.type !== 'attack') storeKiller(depth, action);
        updateHistory(depth, action);
        break;
      }
      if (bestScore > -Infinity) flag = 'exact';
    }
  } else {
    for (const action of ordered) {
      if (action.type === 'attack' && action.rps === 'disadvantage' && ordered.length > 1) continue;

      const undo = simulateMove(game, action.piece, action.target);
      const result = minimax(game, depth - 1, alpha, beta, maximizingFaction, game.currentFaction);
      undoMove(game, undo);

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

  if (tt.size < 500000) {
    tt.set(hash, { depth, score: bestScore, action: bestAction, flag });
  }

  return { score: bestScore, action: bestAction };
}

function quiesce(game, alpha, beta, maximizingFaction, currentFaction, qDepth = 0) {
  const standPat = evaluateBoard(game, maximizingFaction);
  if (qDepth >= 4) return { score: standPat };

  if (currentFaction === maximizingFaction) {
    if (standPat >= beta) return { score: beta };
    alpha = Math.max(alpha, standPat);

    const attackActions = getAllActions(game, currentFaction)
      .filter(a => a.type === 'attack' && a.rps !== 'disadvantage');

    for (const action of attackActions) {
      const undo = simulateMove(game, action.piece, action.target);
      const result = quiesce(game, alpha, beta, maximizingFaction, game.currentFaction, qDepth + 1);
      undoMove(game, undo);

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
      const undo = simulateMove(game, action.piece, action.target);
      const result = quiesce(game, alpha, beta, maximizingFaction, game.currentFaction, qDepth + 1);
      undoMove(game, undo);

      if (result.score <= alpha) return { score: alpha };
      beta = Math.min(beta, result.score);
    }
    return { score: beta };
  }
}

// --- Iterative Deepening ---
function iterativeDeepening(game, faction) {
  searchDeadline = Date.now() + TIME_LIMIT_MS;
  nodesSearched = 0;
  tt.clear();
  for (const key in killerMoves) delete killerMoves[key];
  for (const key in historyTable) delete historyTable[key];

  const actions = getAllActions(game, faction);
  if (actions.length === 0) return null;
  if (actions.length === 1) return actions[0];

  let bestResult = { score: -Infinity, action: actions[0] };
  let prevScore = 0;

  for (let depth = 1; depth <= MAX_DEPTH; depth++) {
    let alpha, beta;
    if (depth <= 1) {
      alpha = -Infinity; beta = Infinity;
    } else {
      const windowSize = 50;
      alpha = prevScore - windowSize;
      beta = prevScore + windowSize;
    }

    let result = minimax(game, depth, alpha, beta, faction, faction);

    if (!result.timeout && result.score <= alpha) {
      result = minimax(game, depth, -Infinity, beta, faction, faction);
    } else if (!result.timeout && result.score >= beta) {
      result = minimax(game, depth, alpha, Infinity, faction, faction);
    }

    if (!result.timeout && (result.score <= -Infinity + 1 || result.score >= Infinity - 1)) {
      result = minimax(game, depth, -Infinity, Infinity, faction, faction);
    }

    if (!result.timeout) {
      bestResult = result;
      prevScore = result.score;
      // Report progress
      self.postMessage({ type: 'progress', depth, score: result.score, nodes: nodesSearched });
    } else {
      break;
    }
  }

  return bestResult.action;
}

function greedyBestMove(game, faction, actions) {
  let bestActions = [];
  let bestScore = -Infinity;

  for (const action of actions) {
    let score = 0;
    if (action.type === 'attack') {
      const defender = game.pieces.find(p => p.alive && p.pos.equals(action.target));
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

// --- Entry Point ---
let _bookBuilt = false;

function calculateBestMove(game, faction) {
  if (!_bookBuilt) {
    buildOpeningBook(function() {}); // GameClass not needed in worker
    _bookBuilt = true;
  }

  rebuildOccupiedMap(game);

  const bookMove = pickBookMove(game);
  if (bookMove) {
    const actions = getAllActions(game, faction);
    const isLegal = actions.some(a =>
      a.piece.id === bookMove.piece.id && a.target.equals(bookMove.target)
    );
    if (isLegal) {
      return { piece: bookMove.piece, target: bookMove.target, type: 'move', rps: 'neutral' };
    }
  }

  const actions = getAllActions(game, faction);
  if (actions.length === 0) return null;

  const nonSuicide = actions.filter(a => !(a.type === 'attack' && a.rps === 'disadvantage'));
  const usableActions = nonSuicide.length > 0 ? nonSuicide : actions;
  const pieceCount = game.pieces.filter(p => p.alive).length;

  if (pieceCount > 24 || usableActions.length > 40) {
    return greedyBestMove(game, faction, usableActions);
  }

  return iterativeDeepening(game, faction);
}

// ============================================================================
// WORKER MESSAGE HANDLER
// ============================================================================

self.onmessage = function(e) {
  const { type, gameState, faction, depth } = e.data;

  if (type === 'calculate') {
    // Reconstruct game object from serialized state
    const game = deserializeGame(gameState);
    if (depth !== undefined) MAX_DEPTH = depth;

    const move = calculateBestMove(game, faction);

    if (move) {
      self.postMessage({
        type: 'result',
        move: {
          pieceId: move.piece.id,
          targetQ: move.target.q,
          targetR: move.target.r,
          moveType: move.type,
          rps: move.rps
        }
      });
    } else {
      self.postMessage({ type: 'result', move: null });
    }
  } else if (type === 'setDepth') {
    MAX_DEPTH = depth;
  } else if (type === 'initBook') {
    buildOpeningBook(function() {});
    _bookBuilt = true;
    self.postMessage({ type: 'bookReady' });
  }
};

// Deserialize game state from main thread
function deserializeGame(state) {
  const game = {
    pieces: state.pieces.map(p => ({
      id: p.id,
      type: p.type,
      faction: p.faction,
      pos: new Hex(p.pos.q, p.pos.r),
      symbol: p.symbol,
      alive: p.alive,
      hasMoved: p.hasMoved
    })),
    currentFactionIdx: state.currentFactionIdx,
    currentFaction: state.currentFaction,
    state: state.state,
    eliminatedFactions: new Set(state.eliminatedFactions),
    rpsEnabled: state.rpsEnabled,
    boardCells: new Map(), // Will be rebuilt
    _occupiedMap: new Map(),
    capturedPieces: state.capturedPieces,
    moveHistory: [],
    _positionHistory: new Map(),
    _halfmoveClock: state._halfmoveClock || 0
  };
  rebuildOccupiedMap(game);
  return game;
}