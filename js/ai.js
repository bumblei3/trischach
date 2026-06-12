import { getValidMoves, PIECE_STRENGTH } from './pieces.js';
import { getRPSResult, FACTION } from './board.js';
import { Hex } from './hex.js';
import { isKingdomCheck } from './game-check.js';
import { pickBookMove, buildOpeningBook, inBook } from './opening-book.js';

const TURN_ORDER = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];

// ─── Dynamic Piece Values (RPS-aware) ────────────────────────────────
/**
 * Piece values adjusted for RPS matchups.
 * Base values from PIECE_STRENGTH, multiplied by RPS factor:
 * - Advantage (we beat them): 1.3x
 * - Neutral (same faction): 1.0x
 * - Disadvantage (they beat us): 0.7x
 * King is always high value (game-ending).
 */
const RPS_VALUE_MULTIPLIER = {
  advantage: 1.3,  // Our pieces worth more vs faction we beat
  neutral: 1.0,    // Normal value vs same faction
  disadvantage: 0.7, // Our pieces worth less vs faction that beats us
};

function getDynamicPieceValue(pieceType, attackingFaction, defendingFaction) {
  const baseValue = PIECE_STRENGTH[pieceType];
  if (pieceType === 'king') return baseValue * 100; // King always high
  
  const rps = getRPSResult(attackingFaction, defendingFaction);
  return baseValue * RPS_VALUE_MULTIPLIER[rps];
}

/**
 * Get dynamic piece value for material evaluation from perspective of `faction`.
 * When evaluating our pieces vs enemy faction, use RPS multiplier.
 * When evaluating enemy pieces vs our faction, use inverse RPS multiplier.
 */
function getMaterialValue(piece, perspectiveFaction) {
  const baseValue = PIECE_STRENGTH[piece.type];
  if (piece.type === 'king') return baseValue * 100;
  
  const rps = getRPSResult(perspectiveFaction, piece.faction);
  // From our perspective: if we beat them (advantage), their pieces are easier to capture = lower value
  // If they beat us (disadvantage), their pieces are more dangerous = higher value
  const multiplier = rps === 'advantage' ? 0.85 : (rps === 'disadvantage' ? 1.15 : 1.0);
  return baseValue * multiplier;
}

const PIECE_STRENGTH_DYNAMIC = {}; // Cache for dynamic values if needed

// ─── Adaptive Time Management ────────────────────────────────────────
/**
 * Calculate time budget for the current move based on game phase.
 * Returns time in milliseconds.
 */
function calculateTimeBudget(game) {
  const pieceCount = game.getAlivePieces().length;
  const actions = getAllActions(game, game.currentFaction);
  const legalMoves = actions.length;
  
  // Base time budget: 3 seconds
  let budget = 3000;
  
  // Opening (many pieces): less time needed, use opening book anyway
  if (pieceCount > 35) {
    budget = 1500; // Opening book handles this
  }
  // Early middlegame
  else if (pieceCount > 25) {
    budget = 2500;
  }
  // Middlegame: standard time
  else if (pieceCount > 15) {
    budget = 3500;
  }
  // Late middlegame/early endgame: more time for precision
  else if (pieceCount > 8) {
    budget = 4500;
  }
  // Endgame: more time, fewer branches, deeper search possible
  else {
    budget = 5500;
  }
  
  // Critical position adjustments
  // In check: need accurate defense
  if (isKingdomCheck(game, game.currentFaction)) {
    budget += 1000;
  }
  
  // Very few legal moves: think deeper
  if (legalMoves < 5) {
    budget += 1000;
  }
  // Many legal moves: don't waste time
  else if (legalMoves > 40) {
    budget -= 500;
  }
  
  // Cap budget
  budget = Math.max(1000, Math.min(8000, budget));
  
  return budget;
}

// ─── Configuration ──────────────────────────────────────────────────

// MAX_DEPTH is now dynamic (set per move in iterativeDeepening)
// Kept for backwards compatibility with setAIDepth()
let MAX_DEPTH = 3;
// Base time limit (fallback if calculateTimeBudget not used)
const TIME_LIMIT_MS = 5000;

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

  // 1. Material balance (RPS-aware)
  for (const p of pieces) {
    const val = getMaterialValue(p, faction) * 10;
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

  // 7. Endgame-specific evaluation
  score += evaluateEndgame(game, pieces, faction);

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

// ─── Endgame-Specific Evaluation ──────────────────────────────────────
/**
 * Endgame-specific evaluation for TriSchach.
 * Applies when total pieces <= 20 (roughly endgame threshold).
 * Handles: king activity, pawn promotion pressure, 2-vs-1 dynamics, piece coordination.
 */
function evaluateEndgame(game, pieces, faction) {
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
  
  // Enemy factions still alive
  const enemyFactions = aliveFactions.filter(f => f !== faction);
  
  // 1. KING ACTIVITY: In endgame, king should be centralized/active, not hiding in corners
  if (myKing) {
    const kingDistFromCenter = Math.max(
      Math.abs(myKing.pos.q), 
      Math.abs(myKing.pos.r), 
      Math.abs(-myKing.pos.q - myKing.pos.r)
    );
    
    if (isLateEndgame) {
      // Late endgame: king MUST be active (negative score for hiding)
      score -= kingDistFromCenter * 8; // Penalize distance from center
    } else if (isEndgame) {
      // Early endgame: mild encouragement to centralize
      score -= kingDistFromCenter * 3;
    } else if (aliveFactions.length === 2) {
      // 2-vs-1: king activity matters more
      score -= kingDistFromCenter * 5;
    }
    
    // King safety vs activity trade-off
    // If we have significant material advantage, king safety matters less
    const myMaterial = myPieces.reduce((sum, p) => sum + (PIECE_STRENGTH[p.type] || 0), 0);
    const enemyPieces = pieces.filter(p => p.faction !== faction);
    const enemyMaterial = enemyPieces.reduce((sum, p) => sum + (PIECE_STRENGTH[p.type] || 0), 0);
    
    if (myMaterial > enemyMaterial * 1.5) {
      // Winning: king safety less important
      // (kingThreats penalty in main eval already reduced by this logic)
    }
  }
  
  // 2. PAWN PROMOTION PRESSURE: pawns near r<=0 are extremely valuable
  for (const pawn of myPawns) {
    if (pawn.r <= 0) {
      // Already in promotion zone
      score += isLateEndgame ? 200 : 100; // Huge bonus - almost promoted
    } else if (pawn.r === 1) {
      score += isLateEndgame ? 80 : 40; // One step away
    } else if (pawn.r === 2) {
      score += isLateEndgame ? 40 : 20; // Two steps away
    } else if (pawn.r <= 4) {
      score += 10; // Approaching promotion zone
    }
    
    // Passed pawn bonus: no enemy pawns blocking file
    const blockingPawns = pieces.filter(p => 
      p.type === 'pawn' && 
      p.faction !== faction &&
      Math.abs(p.q - pawn.q) <= 1 && // Same or adjacent file
      (faction === FACTION.FIRE ? p.r < pawn.r : // Fire moves toward r<=0
       faction === FACTION.WATER ? (p.r > pawn.r || p.q < pawn.q) : // Water moves toward q>=0
       faction === FACTION.NATURE ? (p.r > pawn.r || p.q > pawn.q) : false) // Nature moves toward q<=0
    );
    if (blockingPawns.length === 0) {
      score += isLateEndgame ? 60 : 30; // Passed pawn!
    }
  }
  
  // 3. 2-vs-1 DYNAMICS: When one faction is eliminated
  if (aliveFactions.length === 2) {
    const otherFaction = enemyFactions[0];
    if (!otherFaction) return score;
    
    // RPS relationship is CRITICAL in 2-player endgame
    const rps = getRPSResult(faction, otherFaction);
    if (rps === 'advantage') {
      score += 150; // We beat them - huge advantage
    } else if (rps === 'disadvantage') {
      score -= 200; // They beat us - huge disadvantage, play for draw
    } else {
      // Neutral: pure skill endgame
    }
    
    // In advantage: simplify (trade pieces), king activity critical
    if (rps === 'advantage') {
      const myKing = myPieces.find(p => p.type === 'king');
      if (myKing) {
        const enemyKing = pieces.find(p => p.faction === otherFaction && p.type === 'king');
        if (enemyKing) {
          // Distance between kings - in advantage we WANT opposition
          const kingDist = myKing.pos.distance(enemyKing.pos);
          if (kingDist <= 3) score += 30; // Close kings = we can force progress
        }
      }
    }
    
    // In disadvantage: avoid trades, complicate, king safety
    if (rps === 'disadvantage') {
      // Avoid piece trades - every piece counts for defense
      // (This is implicitly handled by search, but we can penalize trades here)
    }
  }
  
  // 4. PIECE COORDINATION: pieces working together
  if (isEndgame) {
    // Rooks/Queens on same file/rank as pawns = support
    for (const piece of myPieces) {
      if (piece.type === 'rook' || piece.type === 'queen') {
        // Support our pawns
        const supportingPawns = myPawns.filter(p => 
          p.q === piece.pos.q || // Same file
          p.r === piece.pos.r || // Same rank (simplified for hex)
          Math.abs(p.q - piece.pos.q) <= 1 && Math.abs(p.r - piece.pos.r) <= 1
        );
        score += supportingPawns.length * 15;
      }
      
      // Knights near king = protection
      if (piece.type === 'knight' && myKing) {
        if (piece.pos.distance(myKing.pos) <= 2) score += 20;
      }
    }
  }
  
  // 5. ELIMINATION PROXIMITY: close to eliminating a faction
  for (const ef of enemyFactions) {
    const enemyPieces = pieces.filter(p => p.faction === ef);
    const enemyKing = enemyPieces.find(p => p.type === 'king');
    
    if (enemyPieces.length <= 3) {
      // Enemy nearly eliminated
      score += (4 - enemyPieces.length) * 100;
      
      // If we can checkmate their king this turn/next
      if (enemyKing) {
        for (const attacker of myPieces) {
          const { attacks } = getValidMoves(attacker, game.boardCells, game._occupiedMap);
          if (attacks.some(a => a.equals(enemyKing.pos))) {
            score += 500; // Mate threat!
          }
        }
      }
    }
  }
  
  // 6. ZUGZWANG / OPPOSITION in pure king endgames
  if (aliveFactions.length === 2 && totalPieces <= 6) {
    const myKing = myPieces.find(p => p.type === 'king');
    const otherFaction = enemyFactions[0];
    const enemyKing = pieces.find(p => p.faction === otherFaction && p.type === 'king');
    
    if (myKing && enemyKing) {
      const dist = myKing.pos.distance(enemyKing.pos);
      // Odd distance = we have opposition (good in king endgames)
      if (dist % 2 === 1) score += 25;
      else score -= 15; // Even = they have opposition
    }
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

// ─── Static Exchange Evaluation (SEE) ─────────────────────────────────
/**
 * Static Exchange Evaluation for TriSchach.
 * Evaluates a capture sequence without making moves on the board.
 * Returns score in centipawns from attacker's perspective.
 * Positive = winning material, negative = losing material.
 * 
 * Accounts for RPS mechanics: advantage/neutral = attacker wins,
 * disadvantage = attacker loses.
 */
const SEE_PIECE_VALUES = {
  king: 10000,  // King is infinitely valuable (game ends)
  queen: 900,
  rook: 500,
  bishop: 300,
  knight: 300,
  pawn: 100,
};

function see(game, attacker, victim, attackerFaction, victimFaction, rpsResult) {
  // If RPS disadvantage, attacker dies immediately - very bad
  if (rpsResult === 'disadvantage') {
    return -SEE_PIECE_VALUES[attacker.type] * 10; // Lose attacker, gain nothing
  }
  
  // RPS advantage or neutral: attacker wins the capture
  // Start with victim's value
  let score = SEE_PIECE_VALUES[victim.type] * 10;
  
  // Track pieces involved in the exchange
  const attackers = [{ piece: attacker, faction: attackerFaction }];
  const defenders = [{ piece: victim, faction: victimFaction }];
  
  // Current side to move in the exchange (defender recaptures first)
  let currentAttackerFaction = victimFaction;
  let currentDefenderFaction = attackerFaction;
  let currentAttackers = [...defenders];
  let currentDefenders = [...attackers];
  
  // Simulate capture sequence
  // In SEE, we alternate: attacker captures, defender recaptures, etc.
  // But in TriSchach, RPS determines outcome of each capture
  // Simplified: assume each capture follows RPS rules
  
  let depth = 0;
  const maxDepth = 10; // Prevent infinite loops
  
  while (depth < maxDepth) {
    // Find least valuable attacker for current side
    let bestAttacker = null;
    let bestAttackerIdx = -1;
    let bestValue = Infinity;
    
    for (let i = 0; i < currentAttackers.length; i++) {
      const att = currentAttackers[i];
      const val = SEE_PIECE_VALUES[att.piece.type] || 0;
      if (val < bestValue) {
        bestValue = val;
        bestAttacker = att;
        bestAttackerIdx = i;
      }
    }
    
    if (!bestAttacker) break; // No more attackers
    
    // Find best victim for this attacker (most valuable defender piece that can be captured)
    // In real SEE, we'd check legal moves. Here we approximate.
    let bestVictim = null;
    let bestVictimIdx = -1;
    let bestVictimValue = -Infinity;
    
    for (let i = 0; i < currentDefenders.length; i++) {
      const def = currentDefenders[i];
      // Check if attacker can capture defender (simplified: assume yes if on board)
      const val = SEE_PIECE_VALUES[def.piece.type] || 0;
      if (val > bestVictimValue) {
        bestVictimValue = val;
        bestVictim = def;
        bestVictimIdx = i;
      }
    }
    
    if (!bestVictim) break; // No more victims
    
    // Determine RPS result for this capture
    const captureRps = game.rpsEnabled 
      ? getRPSResult(bestAttacker.faction, bestVictim.faction)
      : 'advantage';
    
    if (captureRps === 'disadvantage') {
      // Attacker loses - swap sides and continue
      score -= bestValue * 10;
      // Remove attacker
      currentAttackers.splice(bestAttackerIdx, 1);
      // Swap sides
      [currentAttackers, currentDefenders] = [currentDefenders, currentAttackers];
      [currentAttackerFaction, currentDefenderFaction] = [currentDefenderFaction, currentAttackerFaction];
    } else {
      // Attacker wins - gain victim value
      score += bestVictimValue * 10;
      // Remove victim
      currentDefenders.splice(bestVictimIdx, 1);
      // Swap sides
      [currentAttackers, currentDefenders] = [currentDefenders, currentAttackers];
      [currentAttackerFaction, currentDefenderFaction] = [currentDefenderFaction, currentAttackerFaction];
    }
    
    depth++;
  }
  
  return score;
}

/**
 * Get SEE score for an action (used in move ordering).
 * Returns score in centipawns.
 */
function getSeeScore(game, action) {
  if (action.type !== 'attack') return 0;
  
  const victim = game.getPieceAt(action.target);
  if (!victim) return 0;
  
  return see(game, action.piece, victim, action.piece.faction, victim.faction, action.rps);
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
 * Order: TT move > winning captures (SEE) > killer moves > history > losing captures > quiet moves
 */
function scoreAction(action, ttAction, depth, game) {
  // TT move gets highest priority
  if (ttAction && actionEquals(action, ttAction)) return 100000;

  // Captures: Use SEE for accurate capture evaluation
  if (action.type === 'attack') {
    if (action.rps === 'disadvantage') return -1000; // Suicide moves last
    
    // Use SEE score for precise capture ordering
    const seeScore = game ? getSeeScore(game, action) : 0;
    if (seeScore > 0) {
      // Winning capture: high priority + SEE score
      return 10000 + seeScore;
    } else if (seeScore === 0) {
      // Equal capture (neutral)
      return 5000 + (action.rps === 'advantage' ? 100 : 0);
    } else {
      // Losing capture but not disadvantage (should be rare)
      return 1000;
    }
  }

  // Killer moves
  const killers = getKiller(depth);
  if (killers[0] && actionEquals(action, killers[0])) return 900;
  if (killers[1] && actionEquals(action, killers[1])) return 800;

  // History heuristic
  return getHistoryScore(action);
}

function orderActions(actions, ttAction, depth, game) {
  return actions.slice().sort((a, b) => scoreAction(b, ttAction, depth, game) - scoreAction(a, ttAction, depth, game));
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

  // ─── Futility Pruning & Razoring ────────────────────────────────────
  // Futility Pruning: at shallow depths, if a quiet move cannot possibly
  // raise score above alpha (even with optimistic margin), skip it.
  // Razoring: at depth <= 3, if we're far below beta, reduce depth aggressively.
  const FUTILITY_MARGINS = [0, 150, 300, 500]; // Depth 1, 2, 3
  const RAZOR_MARGINS = [0, 300, 500]; // Depth 1, 2

  let futilityMargin = 0;
  let razorMargin = 0;
  let doFutility = false;
  let doRazoring = false;

  if (currentFaction === maximizingFaction) {
    if (depth <= 3 && depth > 0) {
      futilityMargin = FUTILITY_MARGINS[depth];
      doFutility = true;
    }
    if (depth <= 2 && depth > 0) {
      razorMargin = RAZOR_MARGINS[depth];
      doRazoring = true;
    }
  } else {
    if (depth <= 3 && depth > 0) {
      futilityMargin = FUTILITY_MARGINS[depth];
      doFutility = true;
    }
    if (depth <= 2 && depth > 0) {
      razorMargin = RAZOR_MARGINS[depth];
      doRazoring = true;
    }
  }

  // ─── Move Ordering ──────────────────────────────────────────────────
  // Order moves: TT move > captures > killers > history > quiet
  const ttAction = ttEntry ? ttEntry.action : null;
  const ordered = orderActions(actions, ttAction, depth, game);

  let bestAction = ordered[0];
  let bestScore = currentFaction === maximizingFaction ? -Infinity : Infinity;
  let flag = 'upper';

  if (currentFaction === maximizingFaction) {
    for (const action of ordered) {
      if (action.type === 'attack' && action.rps === 'disadvantage' && ordered.length > 1) continue;

      // ─── Futility Pruning ──────────────────────────────────────────
      // Skip quiet moves that cannot possibly raise score above alpha
      if (doFutility && action.type !== 'attack' && depth <= 3) {
        const staticScore = evaluateBoard(game, maximizingFaction);
        if (staticScore + futilityMargin <= alpha) {
          continue; // Prune this move
        }
      }

      // ─── Razoring ──────────────────────────────────────────────────
      // At depth <= 2, if static eval is far below beta, search with reduced depth
      let razorReduction = 0;
      if (doRazoring && action.type !== 'attack' && depth <= 2) {
        const staticScore = evaluateBoard(game, maximizingFaction);
        if (staticScore + razorMargin <= alpha) {
          razorReduction = 1; // Reduce depth by 1 for this move
        }
      }

      const undo = game.simulateMove(action.piece, action.target);
      const searchDepth = depth - 1 - razorReduction;
      const result = minimax(game, searchDepth, alpha, beta, maximizingFaction, game.currentFaction);
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

      // ─── Futility Pruning ──────────────────────────────────────────
      if (doFutility && action.type !== 'attack' && depth <= 3) {
        const staticScore = evaluateBoard(game, maximizingFaction);
        if (staticScore - futilityMargin >= beta) {
          continue; // Prune this move
        }
      }

      // ─── Razoring ──────────────────────────────────────────────────
      let razorReduction = 0;
      if (doRazoring && action.type !== 'attack' && depth <= 2) {
        const staticScore = evaluateBoard(game, maximizingFaction);
        if (staticScore - razorMargin >= beta) {
          razorReduction = 1;
        }
      }

      const undo = game.simulateMove(action.piece, action.target);
      const searchDepth = depth - 1 - razorReduction;
      const result = minimax(game, searchDepth, alpha, beta, maximizingFaction, game.currentFaction);
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
  // Calculate adaptive time budget for this position
  const timeBudget = calculateTimeBudget(game);
  searchDeadline = Date.now() + timeBudget;
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
  // Max depth cap to prevent infinite loops in simple positions
  const MAX_DEPTH_CAP = 12;
  for (let depth = 1; depth <= MAX_DEPTH_CAP; depth++) {
    // Time check: if we're past 80% of budget, don't start deeper search
    if (Date.now() > searchDeadline - timeBudget * 0.2) {
      break;
    }
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

let _bookBuilt = false;

/**
 * Calculates the best move for a given faction using iterative deepening
 * minimax with alpha-beta pruning and transposition table.
 */
export function calculateBestMove(game, faction) {
  // Build opening book on first call (fallback for direct API usage)
  if (!_bookBuilt) {
    buildOpeningBook(game.constructor);
    _bookBuilt = true;
  }
  
  game._rebuildOccupiedMap();
  
  // Check opening book first
  const bookMove = pickBookMove(game);
  if (bookMove) {
    // Verify the book move is actually legal
    const actions = getAllActions(game, faction);
    const isLegal = actions.some(a => 
      a.piece.id === bookMove.piece.id && a.target.equals(bookMove.target)
    );
    if (isLegal) {
      console.log(`Opening book: ${bookMove.piece.id} -> ${bookMove.target.q},${bookMove.target.r}`);
      return { piece: bookMove.piece, target: bookMove.target, type: 'move', rps: 'neutral' };
    }
  }

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
