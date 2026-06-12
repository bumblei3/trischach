/**
 * TriSchach AI Core - Shared Logic
 * 
 * Contains all shared AI logic used by both main thread (ai.js)
 * and Web Worker (ai-worker.js).
 * 
 * DO NOT MODIFY ai.js or ai-worker.js directly for shared logic!
 * Add/modify here, then both consumers stay in sync.
 */

import { getValidMoves, PIECE_STRENGTH } from './pieces.js';
import { getRPSResult, FACTION } from './board.js';
import { Hex } from './hex.js';
import { isKingdomCheck } from './game-check.js';
import { pickBookMove, buildOpeningBook, inBook } from './opening-book.js';

// ─── Constants ────────────────────────────────────────────────────

export const TURN_ORDER = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];

// ─── Dynamic Piece Values (RPS-aware) ────────────────────────────

export const RPS_VALUE_MULTIPLIER = {
  advantage: 1.3,  // Our pieces worth more vs faction we beat
  neutral: 1.0,    // Normal value vs same faction
  disadvantage: 0.7, // Our pieces worth less vs faction that beats us
};

export function getDynamicPieceValue(pieceType, attackingFaction, defendingFaction) {
  const baseValue = PIECE_STRENGTH[pieceType];
  if (pieceType === 'king') return baseValue * 100;
  
  const rps = getRPSResult(attackingFaction, defendingFaction);
  return baseValue * RPS_VALUE_MULTIPLIER[rps];
}

export function getMaterialValue(piece, perspectiveFaction) {
  const baseValue = PIECE_STRENGTH[piece.type];
  if (piece.type === 'king') return baseValue * 100;
  
  const rps = getRPSResult(perspectiveFaction, piece.faction);
  const multiplier = rps === 'advantage' ? 0.85 : (rps === 'disadvantage' ? 1.15 : 1.0);
  return baseValue * multiplier;
}

// ─── Adaptive Time Management ────────────────────────────────────

export function calculateTimeBudget(game) {
  const pieceCount = game.getAlivePieces ? game.getAlivePieces().length : game.pieces.filter(p => p.alive).length;
  const actions = getAllActions(game, game.currentFaction);
  const legalMoves = actions.length;
  
  let budget = 3000;
  
  if (pieceCount > 35) {
    budget = 1500;
  } else if (pieceCount > 25) {
    budget = 2500;
  } else if (pieceCount > 15) {
    budget = 3500;
  } else if (pieceCount > 8) {
    budget = 4500;
  } else {
    budget = 5500;
  }
  
  if (isKingdomCheck(game, game.currentFaction)) {
    budget += 1000;
  }
  
  if (legalMoves < 5) {
    budget += 1000;
  } else if (legalMoves > 40) {
    budget -= 500;
  }
  
  budget = Math.max(1000, Math.min(8000, budget));
  return budget;
}

// ─── Configuration ──────────────────────────────────────────────

export let MAX_DEPTH = 3;
export const TIME_LIMIT_MS = 5000;

export function setAIDepth(depth) {
  MAX_DEPTH = Math.max(1, Math.min(12, depth));
}

// ─── AI Personalities ──────────────────────────────────────────────

export const AI_PERSONALITIES = {
  balanced: {
    name: 'Ausgewogen',
    description: 'Standard-Spielweise, ausgewogene Bewertung',
    weights: {
      material: 1.0,
      positional: 1.0,
      kingSafety: 1.0,
      kingThreats: 1.0,
      pawnStructure: 1.0,
      endgame: 1.0,
      mobility: 1.0,
    },
    aggression: 0.0,
  },
  aggressive: {
    name: 'Aggressiv',
    description: 'Angreifend, sucht taktische Komplikationen, opfert Material für Initiative',
    weights: {
      material: 0.8,
      positional: 1.3,
      kingSafety: 0.7,
      kingThreats: 1.5,
      pawnStructure: 0.7,
      endgame: 1.2,
      mobility: 1.4,
    },
    aggression: 0.3,
  },
  defensive: {
    name: 'Defensiv',
    description: 'Solid, minimiert Risiken, wartet auf Fehler des Gegners',
    weights: {
      material: 1.2,
      positional: 0.8,
      kingSafety: 1.5,
      kingThreats: 0.7,
      pawnStructure: 1.3,
      endgame: 0.9,
      mobility: 0.8,
    },
    aggression: -0.3,
  },
  tactical: {
    name: 'Taktisch',
    description: 'Fokus auf Taktik, Opfersuchend, scharfes Spiel',
    weights: {
      material: 0.7,
      positional: 1.4,
      kingSafety: 0.6,
      kingThreats: 1.6,
      pawnStructure: 0.5,
      endgame: 1.1,
      mobility: 1.5,
    },
    aggression: 0.5,
  },
};

let _currentPersonality = 'balanced';

export function getPersonalityWeights() {
  return AI_PERSONALITIES[_currentPersonality]?.weights || AI_PERSONALITIES.balanced.weights;
}

export function getPersonalityAggression() {
  return AI_PERSONALITIES[_currentPersonality]?.aggression || 0;
}

export function setPersonality(personality) {
  if (AI_PERSONALITIES[personality]) {
    _currentPersonality = personality;
    return true;
  }
  return false;
}

export function getPersonality() {
  return _currentPersonality;
}

export function getPersonalities() {
  return Object.keys(AI_PERSONALITIES).map(key => ({
    key,
    name: AI_PERSONALITIES[key].name,
    description: AI_PERSONALITIES[key].description,
  }));
}


// ─── Transposition Table ──────────────────────────────────────────

export const tt = new Map();

export function boardHash(game) {
  const pieces = game.getAlivePieces ? game.getAlivePieces() : game.pieces.filter(p => p.alive);
  const piecesStr = pieces
    .filter(p => p.alive)
    .map(p => `${p.faction[0]}${p.type[0]}${p.pos.q},${p.pos.r}`)
    .sort()
    .join('|');
  const factionIdx = game.currentFactionIdx !== undefined ? game.currentFactionIdx : 
                     (game.currentFaction ? [FACTION.FIRE, FACTION.WATER, FACTION.NATURE].indexOf(game.currentFaction) : 0);
  return `${piecesStr}#${factionIdx}`;
}

// ─── Piece-Square Tables ──────────────────────────────────────────

const _pstHex = new Hex(0, 0);

export function hexDistFromCenter(hex) {
  return Math.abs(hex.q) + Math.abs(hex.r - 2) + Math.abs(-hex.q - hex.r + 2);
}

export function buildPST(calcFn) {
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

export function getPSTValue(piece) {
  const table = {
    king: KING_PST, queen: QUEEN_PST, rook: ROOK_PST,
    bishop: BISHOP_PST, knight: KNIGHT_PST, pawn: PAWN_PST,
  }[piece.type];
  if (!table) return 0;
  return table.get(piece.pos.key) || 0;
}

// ─── Pawn Structure Evaluation ────────────────────────────────────

export function evaluatePawnStructure(pieces, faction) {
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

// ─── Endgame Evaluation ────────────────────────────────────────────

export function evaluateEndgame(game, pieces, faction) {
  const totalPieces = pieces.length;
  const aliveFactions = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE]
    .filter(f => !game.eliminatedFactions.has(f));
  const isEndgame = totalPieces <= 20;
  const isLateEndgame = totalPieces <= 10;
  
  if (!isEndgame && aliveFactions.length === 3) return 0;
  
  let score = 0;
  const myPieces = pieces.filter(p => p.faction === faction);
  const myKing = myPieces.find(p => p.type === 'king');
  const myPawns = myPieces.filter(p => p.type === 'pawn');
  
  const enemyFactions = aliveFactions.filter(f => f !== faction);
  
  // 1. KING ACTIVITY
  if (myKing) {
    const kingDistFromCenter = Math.max(
      Math.abs(myKing.pos.q), 
      Math.abs(myKing.pos.r), 
      Math.abs(-myKing.pos.q - myKing.pos.r)
    );
    
    if (isLateEndgame) {
      score -= kingDistFromCenter * 8;
    } else if (isEndgame) {
      score -= kingDistFromCenter * 3;
    } else if (aliveFactions.length === 2) {
      score -= kingDistFromCenter * 5;
    }
    
    const myMaterial = myPieces.reduce((sum, p) => sum + (PIECE_STRENGTH[p.type] || 0), 0);
    const enemyPieces = pieces.filter(p => p.faction !== faction);
    const enemyMaterial = enemyPieces.reduce((sum, p) => sum + (PIECE_STRENGTH[p.type] || 0), 0);
    
    if (myMaterial > enemyMaterial * 1.5) {
      // Winning: king safety less important
    }
  }
  
  // 2. PAWN PROMOTION PRESSURE
  for (const pawn of myPawns) {
    if (pawn.r <= 0) score += isLateEndgame ? 200 : 100;
    else if (pawn.r === 1) score += isLateEndgame ? 80 : 40;
    else if (pawn.r === 2) score += isLateEndgame ? 40 : 20;
    else if (pawn.r <= 4) score += 10;
    
    const blockingPawns = pieces.filter(p => 
      p.type === 'pawn' && 
      p.faction !== faction &&
      Math.abs(p.q - pawn.q) <= 1 &&
      (faction === FACTION.FIRE ? p.r < pawn.r :
       faction === FACTION.WATER ? (p.r > pawn.r || p.q < pawn.q) :
       faction === FACTION.NATURE ? (p.r > pawn.r || p.q > pawn.q) : false)
    );
    if (blockingPawns.length === 0) score += isLateEndgame ? 60 : 30;
  }
  
  // 3. 2-vs-1 DYNAMICS
  if (aliveFactions.length === 2) {
    const otherFaction = enemyFactions[0];
    if (!otherFaction) return score;
    
    const rps = getRPSResult(faction, otherFaction);
    if (rps === 'advantage') score += 150;
    else if (rps === 'disadvantage') score -= 200;
    
    if (rps === 'advantage') {
      const myKing = myPieces.find(p => p.type === 'king');
      if (myKing) {
        const enemyKing = pieces.find(p => p.faction === otherFaction && p.type === 'king');
        if (enemyKing) {
          const kingDist = myKing.pos.distance(enemyKing.pos);
          if (kingDist <= 3) score += 30;
        }
      }
    }
  }
  
  // 4. PIECE COORDINATION
  if (pieces.length <= 20) {
    for (const piece of pieces.filter(p => p.faction === faction)) {
      if (piece.type === 'rook' || piece.type === 'queen') {
        const supportingPawns = pieces.filter(p => 
          p.faction === faction && p.type === 'pawn' && (
            p.q === piece.pos.q || 
            p.r === piece.pos.r || 
            (Math.abs(p.q - piece.pos.q) <= 1 && Math.abs(p.r - piece.pos.r) <= 1)
          )
        );
        score += supportingPawns.length * 15;
      }
      
      if (piece.type === 'knight') {
        const myKing = pieces.find(p => p.faction === faction && p.type === 'king');
        if (myKing && piece.pos.distance(myKing.pos) <= 2) score += 20;
      }
    }
  }
  
  // 5. ELIMINATION PROXIMITY
  for (const ef of enemyFactions) {
    const enemyPieces = pieces.filter(p => p.faction === ef);
    const enemyKing = enemyPieces.find(p => p.type === 'king');
    
    if (enemyPieces.length <= 3) {
      score += (4 - enemyPieces.length) * 100;
      
      if (enemyKing) {
        for (const attacker of pieces.filter(p => p.faction === faction)) {
          const { attacks } = getValidMoves(attacker, game.boardCells, game._occupiedMap);
          if (attacks.some(a => a.equals(enemyKing.pos))) score += 500;
        }
      }
    }
  }
  
  // 6. ZUGZWANG / OPPOSITION
  if (aliveFactions.length === 2 && pieces.length <= 6) {
    const myKing = pieces.find(p => p.faction === faction && p.type === 'king');
    const otherFaction = aliveFactions.find(f => f !== faction);
    const enemyKing = pieces.find(p => p.faction === otherFaction && p.type === 'king');
    
    if (myKing && enemyKing) {
      const dist = myKing.pos.distance(enemyKing.pos);
      if (dist % 2 === 1) score += 25;
      else score -= 15;
    }
  }
  
  return score;
}

// ─── Heuristic Evaluation ──────────────────────────────────────────

export function evaluateBoard(game, faction) {
  const W = getPersonalityWeights();
  const aggression = getPersonalityAggression();
  
  const pieces = game.getAlivePieces ? game.getAlivePieces() : game.pieces.filter(p => p.alive);
  let score = 0;
  
  // 1. Material balance (RPS-aware)
  for (const p of pieces) {
    const val = getMaterialValue(p, faction) * 10;
    score += (p.faction === faction ? val : -val) * W.material;
  }
  
  // 2. Positional bonus: PST + mobility
  const myPieces = pieces.filter(p => p.faction === faction);
  for (const p of myPieces) {
    score += getPSTValue(p) * W.positional;
    const { moves, attacks } = getValidMoves(p, game.boardCells, game._occupiedMap);
    const mobility = moves.length + attacks.length;
    const mobBonus = { queen: 0.3, rook: 0.2, bishop: 0.2, knight: 0.3, pawn: 0.1, king: 0 };
    score += mobility * (mobBonus[p.type] || 0.1) * W.mobility;
  }
  
  // Enemy pieces PST penalty
  for (const p of pieces) {
    if (p.faction === faction) continue;
    score -= getPSTValue(p) * 0.8 * W.positional;
  }
  
  // 3. King safety
  const myKing = myPieces.find(p => p.type === 'king');
  if (myKing) {
    let kingThreats = 0;
    for (const enemy of pieces) {
      if (enemy.faction === faction || !enemy.alive) continue;
      const { attacks } = getValidMoves(enemy, game.boardCells, game._occupiedMap);
      if (attacks.some(a => a.equals(myKing.pos))) kingThreats++;
    }
    score -= kingThreats * 15 * W.kingSafety;
    const kingDist = Math.max(Math.abs(myKing.pos.q), Math.abs(myKing.pos.r), Math.abs(-myKing.pos.q - myKing.pos.r));
    if (kingDist >= 6) score += 8 * W.kingSafety;
  }
  
  // 4. King threats
  const enemyFactions = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE].filter(f => f !== faction);
  for (const ef of enemyFactions) {
    if (game.eliminatedFactions.has(ef)) {
      score += 200 * W.kingThreats;
      continue;
    }
    const eKing = pieces.find(p => p.faction === ef && p.type === 'king');
    if (eKing) {
      for (const attacker of pieces.filter(p => p.faction === faction)) {
        const { attacks } = getValidMoves(attacker, game.boardCells, game._occupiedMap);
        if (attacks.some(a => a.equals(eKing.pos))) score += 10 * W.kingThreats * (1 + aggression);
      }
    }
  }
  
  // 5. RPS advantage in endgame
  const aliveEnemies = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE]
    .filter(f => !game.eliminatedFactions.has(f) && f !== faction);
  if (aliveEnemies.length === 1) {
    const rps = getRPSResult(faction, aliveEnemies[0]);
    if (rps === 'advantage') score += 20 * W.endgame;
  }
  
  // 6. Pawn structure
  score += evaluatePawnStructure(pieces, faction) * W.pawnStructure;
  
  // 7. Endgame evaluation
  score += evaluateEndgame(game, pieces.filter(p => p.alive), faction) * W.endgame;
  
  return score;
}

// ─── Movement Generation ──────────────────────────────────────────

export function getAllActions(game, faction) {
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

export function getLegalMoves(game, piece) {
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

export function legalMoveCheck(game, piece, target, faction) {
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

// ─── Game Simulation ───────────────────────────────────────────────

export function rebuildOccupiedMap(game) {
  game._occupiedMap = new Map();
  for (const p of game.pieces) {
    if (p.alive) game._occupiedMap.set(p.pos.key, p);
  }
}

export function simulateMove(game, piece, target) {
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
      
      if (defender.type === 'king') {
        undo.eliminatedFaction = defender.faction;
        game.eliminatedFactions.add(defender.faction);
        for (const p of game.pieces) {
          if (p.faction === defender.faction) p.alive = false;
        }
      }
    } else {
      piece.alive = false;
      undo.attackerDied = true;
    }
  } else {
    piece.pos = target;
    piece.hasMoved = true;
  }
  
  if (piece.type === 'pawn' && piece.pos.r <= 0) {
    undo.promotion = piece.type;
    piece.type = 'queen';
    piece.symbol = 'Q';
  }
  
  const factions = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];
  let nextIdx = (game.currentFactionIdx + 1) % 3;
  while (game.eliminatedFactions.has(factions[nextIdx])) {
    nextIdx = (nextIdx + 1) % 3;
  }
  game.currentFactionIdx = nextIdx;
  game.currentFaction = factions[nextIdx];
  
  return undo;
}

export function undoMove(game, undo) {
  const { piece, from, pieceHasMoved, wasAttack, defender, defenderWasKilled, attackerDied, eliminatedFaction, prevFactionIdx } = undo;
  
  piece.pos = from;
  piece.hasMoved = pieceHasMoved;
  
  if (wasAttack) {
    if (defenderWasKilled) {
      defender.alive = true;
      if (eliminatedFaction) {
        game.eliminatedFactions.delete(eliminatedFaction);
        for (const p of game.pieces) {
          if (p.faction === eliminatedFaction) p.alive = true;
        }
      }
    } else if (attackerDied) {
      piece.alive = true;
    }
  }
  
  if (undo.promotion) {
    piece.type = undo.promotion;
    piece.symbol = piece.faction === 'fire' ? 'P' : (piece.faction === 'water' ? 'P' : 'P');
  }
  
  game.currentFactionIdx = prevFactionIdx;
  game.currentFaction = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE][prevFactionIdx];
  rebuildOccupiedMap(game);
}

// ─── Search Algorithms ────────────────────────────────────────────

export const killerMoves = {};
export const historyTable = {};

let searchDeadline = 0;
let nodesSearched = 0;

export function minimax(game, depth, alpha, beta, maximizingFaction, currentFaction) {
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
  
  let bestScore = -Infinity;
  let bestAction = null;
  
  actions.sort((a, b) => {
    const aKiller = killerMoves[`${depth},${a.piece.id},${a.target.key}`] ? 10000 : 0;
    const bKiller = killerMoves[`${depth},${b.piece.id},${b.target.key}`] ? 10000 : 0;
    const aHistory = historyTable[`${a.piece.id},${a.target.key}`] || 0;
    const bHistory = historyTable[`${b.piece.id},${b.target.key}`] || 0;
    return (bKiller + bHistory) - (aKiller + aHistory);
  });
  
  
  for (const action of actions) {
    const undo = simulateMove(game, action.piece, action.target);
    const nextFaction = game.currentFaction;
    const result = minimax(game, depth - 1, alpha, beta, maximizingFaction, nextFaction);
    undoMove(game, undo);
    
    if (result.score > bestScore) {
      bestScore = result.score;
      bestAction = action;
    }
    alpha = Math.max(alpha, bestScore);
    if (alpha >= beta) {
      if (!killerMoves[`${depth},${action.piece.id},${action.target.key}`]) {
        killerMoves[`${depth},${action.piece.id},${action.target.key}`] = true;
      }
      historyTable[`${action.piece.id},${action.target.key}`] = (historyTable[`${action.piece.id},${action.target.key}`] || 0) + depth * depth;
      break;
    }
  }
  
  const flag = bestScore <= alpha ? 'upper' : (bestScore >= beta ? 'lower' : 'exact');
  if (flag !== 'upper' && flag !== 'lower') {
    tt.set(hash, { depth, score: bestScore, action: bestAction, flag });
  }
  
  return { score: bestScore, action: bestAction };
}

export function quiesce(game, alpha, beta, maximizingFaction, currentFaction, qDepth = 0) {
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

export function iterativeDeepening(game, faction) {
  const timeBudget = calculateTimeBudget(game);
  searchDeadline = Date.now() + timeBudget;
  nodesSearched = 0;
  tt.clear();
  Object.keys(killerMoves).forEach(k => delete killerMoves[k]);
  Object.keys(historyTable).forEach(k => delete historyTable[k]);
  
  const actions = getAllActions(game, faction);
  if (actions.length === 0) return null;
  if (actions.length === 1) return actions[0];
  
  let bestResult = { score: -Infinity, action: actions[0] };
  let prevScore = 0;
  
  const MAX_DEPTH_CAP = 12;
  for (let depth = 1; depth <= MAX_DEPTH_CAP; depth++) {
    if (Date.now() > searchDeadline - timeBudget * 0.2) break;
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
    } else {
      break;
    }
  }
  
  return bestResult.action;
}

export function greedyBestMove(game, faction, actions) {
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

// ─── Entry Point ──────────────────────────────────────────────────

let _bookBuilt = false;

export function calculateBestMove(game, faction) {
  if (!_bookBuilt) {
    buildOpeningBook(game.constructor);
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


export function getAIDepth() {
  return MAX_DEPTH;
}
export function setAIPersonality(personality) {
  return setPersonality(personality);
}

export function getAIPersonalities() {
  return getPersonalities();
}

export function deserializeGame(state) {
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
    boardCells: new Map(),
    _occupiedMap: new Map(),
    capturedPieces: state.capturedPieces,
    moveHistory: [],
    _positionHistory: new Map(),
    _halfmoveClock: state._halfmoveClock || 0
  };
  rebuildOccupiedMap(game);
  return game;
}
