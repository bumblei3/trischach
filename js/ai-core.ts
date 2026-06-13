/**
 * TriSchach AI Core - Shared Logic
 * 
 * Contains all shared AI logic used by both main thread (ai.ts)
 * and Web Worker (ai-worker.ts).
 * 
 * DO NOT MODIFY ai.ts or ai-worker.ts directly for shared logic!
 * Add/modify here, then both consumers stay in sync.
 */

// @ts-nocheck - Temporary: Disable type checking during final migration
import { getValidMoves, PIECE_STRENGTH } from './pieces.ts';
import { getRPSResult, FACTION } from './board.ts';
import { Hex } from './hex.ts';
import { isKingdomCheck, legalMoveCheck, getLegalMoves } from './game-check.ts';
import { pickBookMove, buildOpeningBook } from './opening-book.ts';
import type { 
  IGame, 
  Faction, 
  Piece, 
  PieceType, 
  AIAction, 
  AISnapshot, 
  SearchResult,
  PersonalityWeights,
  PersonalityConfig,
  AIPersonality
} from './types.ts';

// ─── getAllActions (AI-specific move generation with ordering) ────────────
// Generates all legal actions for a faction, sorted by quickSee (MVV-LVA + RPS)
export function getAllActions(game: IGame, faction: Faction): AIAction[] {
  const pieces = game.pieces.filter(p => p.faction === faction && p.alive);
  const actions: AIAction[] = [];

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
    const aSee = a.type === 'attack' ? quickSee(game, a) : 0;
    const bSee = b.type === 'attack' ? quickSee(game, b) : 0;
    if (aSee !== bSee) return bSee - aSee;
    if (a.type !== b.type) return a.type === 'attack' ? -1 : 1;
    return 0;
  });

  return actions;
}

// ─── Constants ────────────────────────────────────────────────────

export const TURN_ORDER: readonly Faction[] = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];

// ─── Dynamic Piece Values (RPS-aware) ────────────────────────

export const RPS_VALUE_MULTIPLIER: Record<'advantage' | 'neutral' | 'disadvantage', number> = {
  advantage: 1.3,
  neutral: 1.0,
  disadvantage: 0.7,
};

export function getDynamicPieceValue(pieceType: PieceType, attackingFaction: Faction, defendingFaction: Faction): number {
  const baseValue = PIECE_STRENGTH[pieceType];
  if (pieceType === 'king') return baseValue * 100;
  
  const rps = getRPSResult(attackingFaction, defendingFaction);
  return baseValue * RPS_VALUE_MULTIPLIER[rps];
}

export function getMaterialValue(piece: Piece, perspectiveFaction: Faction): number {
  const baseValue = PIECE_STRENGTH[piece.type];
  if (piece.type === 'king') return baseValue * 100;
  
  const rps = getRPSResult(perspectiveFaction, piece.faction);
  const multiplier = rps === 'advantage' ? 0.85 : (rps === 'disadvantage' ? 1.15 : 1.0);
  return baseValue * multiplier;
}

// ─── Adaptive Time Management ────────────────────────────────

export function calculateTimeBudget(game: IGame): number {
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

// ─── Configuration ────────────────────────────────────────────

export let MAX_DEPTH = 3;
export const TIME_LIMIT_MS = 5000;

export function setAIDepth(depth: number): void {
  MAX_DEPTH = Math.max(1, Math.min(12, depth));
}

// ─── SEE (Static Exchange Evaluation) ────────────────────────

export const SEE_PIECE_VALUES: Record<PieceType, number> = {
  king: 10000,
  queen: 900,
  rook: 500,
  bishop: 300,
  knight: 300,
  pawn: 100,
};

export function getSeeValue(pieceType: PieceType): number {
  return SEE_PIECE_VALUES[pieceType] || 0;
}

export function see(
  _game: IGame, 
  attacker: Piece, 
  victim: Piece, 
  attackerFaction: Faction, 
  victimFaction: Faction, 
  rpsResult: 'advantage' | 'neutral' | 'disadvantage'
): number {
  if (rpsResult === 'disadvantage') {
    return -getSeeValue(attacker.type) * 10;
  }
  
  let score = getSeeValue(victim.type) * 10;
  
  let currentAttacker = { ...victim, type: attacker.type };
  let currentVictim = { ...attacker };
  let currentAttackerFaction = attackerFaction;
  let currentVictimFaction = victimFaction;
  let moveCount = 1;
  
  while (moveCount < 6) {
    moveCount++;
    const recaptureValue = getSeeValue(currentAttacker.type);
    if (recaptureValue <= 0) break;
    score -= recaptureValue * 10;
    moveCount++;
    if (moveCount >= 6) break;
    const counterValue = getSeeValue(currentVictim.type);
    if (counterValue <= 0) break;
    score += counterValue * 10;
    const temp = currentAttacker;
    currentAttacker = currentVictim;
    currentVictim = temp;
    const tempF = currentAttackerFaction;
    currentAttackerFaction = currentVictimFaction;
    currentVictimFaction = tempF;
  }
  
  return score;
}

export function quickSee(game: IGame, action: AIAction): number {
  if (action.type !== 'attack') return 0;
  
  const defender = game.pieces.find(p => p.alive && p.pos.equals(action.target));
  if (!defender) return 0;
  
  const attackerFaction = action.piece.faction;
  const victimFaction = defender.faction;
  const rps = game.rpsEnabled ? getRPSResult(attackerFaction, victimFaction) : 'advantage';
  
  if (rps === 'disadvantage') return -10000;
  
  const attackerVal = getSeeValue(action.piece.type);
  const victimVal = getSeeValue(defender.type);
  
  if (rps === 'advantage') {
    return (victimVal - attackerVal / 10) * 100;
  }
  return (victimVal - attackerVal / 10) * 50;
}

// ─── AI Personalities ────────────────────────────────────────

export const AI_PERSONALITIES: Record<AIPersonality, PersonalityConfig> = {
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

let _currentPersonality: AIPersonality = 'balanced';

export function getPersonalityWeights(): PersonalityWeights {
  return AI_PERSONALITIES[_currentPersonality]?.weights || AI_PERSONALITIES.balanced.weights;
}

export function getPersonalityAggression(): number {
  return AI_PERSONALITIES[_currentPersonality]?.aggression || 0;
}

export function setPersonality(personality: string): boolean {
  if (AI_PERSONALITIES[personality as AIPersonality]) {
    _currentPersonality = personality as AIPersonality;
    return true;
  }
  return false;
}

export function getPersonality(): AIPersonality {
  return _currentPersonality;
}

export function getPersonalities(): Array<{ key: AIPersonality; name: string; description: string }> {
  return Object.keys(AI_PERSONALITIES).map(key => ({
    key: key as AIPersonality,
    name: AI_PERSONALITIES[key as AIPersonality].name,
    description: AI_PERSONALITIES[key as AIPersonality].description,
  }));
}

// ─── Zobrist Transposition Table ────────────────────────────

const ZOBRIST_PIECE_TYPES = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'] as const;
const ZOBRIST_FACTIONS = ['fire', 'water', 'nature'] as const;

function generateValidSquares(): string[] {
  const squares: string[] = [];
  for (let q = -7; q <= 2; q++) {
    for (let r = -2; r <= 7; r++) {
      const s = -q - r;
      if (q >= -7 && q <= 2 && r >= -2 && r <= 7 && s >= -5 && s <= 5) {
        squares.push(`${q},${r}`);
      }
    }
  }
  return squares;
}

const VALID_SQUARES = generateValidSquares();
const SQUARE_TO_INDEX = new Map(VALID_SQUARES.map((sq, i) => [sq, i]));
const NUM_SQUARES = VALID_SQUARES.length;

class ZobristRNG {
  private state: bigint;
  constructor(seed = 0x9e3779b97f4a7c15n) {
    this.state = seed;
  }
  next(): bigint {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & 0xFFFFFFFFFFFFFFFFn;
    let z = this.state;
    z = (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n;
    z = (z ^ (z >> 27n)) * 0x94d049bb133111ebn;
    z = z ^ (z >> 31n);
    return z & 0xFFFFFFFFFFFFFFFFn;
  }
}

const zobristRng = new ZobristRNG();

export const ZOBRIST_PIECE_KEYS: bigint[][][] = Array.from({ length: ZOBRIST_PIECE_TYPES.length }, () => 
  Array.from({ length: ZOBRIST_FACTIONS.length }, () => 
    Array.from({ length: NUM_SQUARES }, () => zobristRng.next())
  )
);

function getZobristKey(pieceTypeIdx: number, factionIdx: number, squareIdx: number): bigint {
  // @ts-ignore - TypeScript doesn't track that pre-filled 3D arrays are fully populated
  return ZOBRIST_PIECE_KEYS[pieceTypeIdx][factionIdx][squareIdx];
}
export const ZOBRIST_SIDE_KEYS: bigint[] = ZOBRIST_FACTIONS.map(() => zobristRng.next());
export const ZOBRIST_ELIMINATED_KEYS: bigint[] = ZOBRIST_FACTIONS.map(() => zobristRng.next());
export const ZOBRIST_RPS_KEY = zobristRng.next();

export class TTEntry {
  key = 0n;
  depth = 0;
  score = 0;
  flag: 'exact' | 'lower' | 'upper' = 'exact';
  bestMove: { pieceId: string; targetKey: string; type: 'move' | 'attack'; rps: 'advantage' | 'neutral' | 'disadvantage' } | null = null;
  age = 0;
}

const TT_SIZE = 1 << 18;
export const tt: TTEntry[] = new Array(TT_SIZE).fill(0).map(() => new TTEntry());

let ttAge = 0;
export let ttHits = 0;
export let ttStores = 0;
export let ttCollisions = 0;

export function computeZobristHash(game: IGame): bigint {
  let hash = 0n;
  const pieces = game.getAlivePieces ? game.getAlivePieces() : game.pieces.filter(p => p.alive);
  
  for (const piece of pieces) {
    const ptIdx = ZOBRIST_PIECE_TYPES.indexOf(piece.type);
    const facIdx = ZOBRIST_FACTIONS.indexOf(piece.faction);
    const sqIdx = SQUARE_TO_INDEX.get(piece.pos.key);
    if (ptIdx >= 0 && facIdx >= 0 && sqIdx !== undefined) {
      hash ^= getZobristKey(ptIdx, facIdx, sqIdx);
    }
  }
  
  const sideIdx = game.currentFactionIdx !== undefined ? game.currentFactionIdx :
                  (game.currentFaction ? ZOBRIST_FACTIONS.indexOf(game.currentFaction) : 0);
  if (sideIdx >= 0) hash ^= ZOBRIST_SIDE_KEYS[sideIdx];
  
  for (const fac of ZOBRIST_FACTIONS) {
    if (game.eliminatedFactions.has(fac)) {
      const elimIdx = ZOBRIST_FACTIONS.indexOf(fac)!;
      hash ^= ZOBRIST_ELIMINATED_KEYS[elimIdx];
    }
  }
  
  if (game.rpsEnabled) hash ^= ZOBRIST_RPS_KEY;
  
  return hash;
}

export function updateZobristHash(
  hash: bigint, piece: Piece, fromKey: string, toKey: string,
  capturedPiece: Piece | null, eliminatedFaction: Faction | null,
  isPromotion: boolean, oldSideIdx: number, newSideIdx: number
): bigint {
  const ptIdx = ZOBRIST_PIECE_TYPES.indexOf(piece.type);
  const facIdx = ZOBRIST_FACTIONS.indexOf(piece.faction);
  
  const fromIdx = SQUARE_TO_INDEX.get(fromKey);
  if (fromIdx !== undefined) hash ^= getZobristKey(ptIdx, facIdx, fromIdx);
  
  const finalType = isPromotion ? 'queen' : piece.type;
  const finalPtIdx = ZOBRIST_PIECE_TYPES.indexOf(finalType);
  const toIdx = SQUARE_TO_INDEX.get(toKey);
  if (toIdx !== undefined) hash ^= getZobristKey(finalPtIdx, facIdx, toIdx);
  
  if (capturedPiece) {
    const capPtIdx = ZOBRIST_PIECE_TYPES.indexOf(capturedPiece.type);
    const capFacIdx = ZOBRIST_FACTIONS.indexOf(capturedPiece.faction);
    if (capPtIdx >= 0 && capFacIdx >= 0) {
      hash ^= getZobristKey(capPtIdx, capFacIdx, toIdx);
    }
    if (capturedPiece.type === 'king' && eliminatedFaction) {
      const elimIdx = ZOBRIST_FACTIONS.indexOf(eliminatedFaction)!;
      hash ^= ZOBRIST_ELIMINATED_KEYS[elimIdx];
    }
  }
  
  if (oldSideIdx >= 0) hash ^= ZOBRIST_SIDE_KEYS[oldSideIdx];
  if (newSideIdx >= 0) hash ^= ZOBRIST_SIDE_KEYS[newSideIdx];
  
  return hash;
}

export function ttProbe(hash: bigint, depth: number, alpha: number, beta: number): 
  { score: number; action: { pieceId: string; targetKey: string; type: 'move' | 'attack'; rps: 'advantage' | 'neutral' | 'disadvantage' } | null; flag: 'exact' | 'lower' | 'upper' } |
  { alpha: number; beta: number; bestMove: { pieceId: string; targetKey: string; type: 'move' | 'attack'; rps: 'advantage' | 'neutral' | 'disadvantage' } | null } | null {
  const entry = tt[Number(hash & BigInt(TT_SIZE - 1))];
  
  if (!entry || entry.key !== hash) return null;
  
  ttHits++;
  
  if (entry.depth >= depth) {
    if (entry.flag === 'exact') return { score: entry.score, action: entry.bestMove, flag: 'exact' };
    if (entry.flag === 'lower') alpha = Math.max(alpha, entry.score);
    if (entry.flag === 'upper') beta = Math.min(beta, entry.score);
    if (alpha >= beta) return { score: entry.score, action: entry.bestMove, flag: entry.flag };
  }
  
  return { alpha, beta, bestMove: entry.bestMove };
}

export function ttStore(
  hash: bigint, depth: number, score: number, 
  flag: 'exact' | 'lower' | 'upper',
  bestMove: { pieceId: string; targetKey: string; type: 'move' | 'attack'; rps: 'advantage' | 'neutral' | 'disadvantage' } | null = null
): void {
  const idx = Number(hash & BigInt(TT_SIZE - 1));
  const entry = tt[idx];
  if (!entry) return; // Should never happen, but satisfies TypeScript
  
  const shouldReplace = entry.key === 0n || entry.key === hash || entry.depth <= depth || entry.age < ttAge - 4;
  
  if (shouldReplace) {
    if (entry.key !== 0n && entry.key !== hash) ttCollisions++;
    entry.key = hash;
    entry.depth = depth;
    entry.score = score;
    entry.flag = flag;
    entry.bestMove = bestMove;
    entry.age = ttAge;
    ttStores++;
  }
}

export function ttNewSearch(): void {
  ttAge++;
  if (ttAge % 32 === 0) {
    for (let i = 0; i < TT_SIZE; i++) {
      if (tt[i].age < ttAge - 8) tt[i].key = 0n;
    }
  }
}

export function ttClear(): void {
  for (let i = 0; i < TT_SIZE; i++) tt[i].key = 0n;
  ttAge = 0;
  ttHits = 0;
  ttStores = 0;
  ttCollisions = 0;
}

export function ttStats(): { size: number; used: number; loadFactor: string; hits: number; stores: number; collisions: number; hitRate: string } {
  let used = 0;
  for (let i = 0; i < TT_SIZE; i++) if (tt[i].key !== 0n) used++;
  return {
    size: TT_SIZE,
    used,
    loadFactor: (used / TT_SIZE * 100).toFixed(1) + '%',
    hits: ttHits,
    stores: ttStores,
    collisions: ttCollisions,
    hitRate: ttStores > 0 ? (ttHits / ttStores * 100).toFixed(1) + '%' : '0%'
  };
}

export const boardHash = computeZobristHash;

// ─── Piece-Square Tables ────────────────────────────────────

function hexDistFromCenter(hex: Hex): number {
  return Math.abs(hex.q) + Math.abs(hex.r - 2) + Math.abs(-hex.q - hex.r + 2);
}

function buildPST(calcFn: (hex: Hex, d: number) => number): Map<string, number> {
  const table = new Map<string, number>();
  for (let q = -7; q <= 2; q++) {
    for (let r = -2; r <= 7; r++) {
      const hex = new Hex(q, r);
      table.set(`${q},${r}`, calcFn(hex, hexDistFromCenter(hex)));
    }
  }
  return table;
}

const KING_PST = buildPST((_h, d) => d * 3);
const QUEEN_PST = buildPST((_h, d) => (6 - d) * 5);
const ROOK_PST = buildPST((_h, d) => (5 - d) * 4);
const BISHOP_PST = buildPST((_h, d) => (5 - d) * 4);
const KNIGHT_PST = buildPST((_h, d) => (6 - d) * 8);
const PAWN_PST = buildPST((_h, d) => {
  const advancement = Math.max(0, 5 - _h.r);
  const centerCol = Math.max(0, 3 - Math.abs(_h.q));
  return advancement * 6 + centerCol * 3;
});

const PST_TABLES: Record<PieceType, Map<string, number>> = {
  king: KING_PST,
  queen: QUEEN_PST,
  rook: ROOK_PST,
  bishop: BISHOP_PST,
  knight: KNIGHT_PST,
  pawn: PAWN_PST,
};

export function getPSTValue(piece: Piece): number {
  const table = PST_TABLES[piece.type];
  if (!table) return 0;
  return table.get(piece.pos.key) || 0;
}

function getBoardCenter(): { q: number; r: number } {
  return { q: 0, r: 2 };
}

export function evaluatePawnStructure(pieces: Piece[], faction: Faction): number {
  const pawns = pieces.filter(p => p.type === 'pawn');
  const myPawns = pawns.filter(p => p.faction === faction);
  const enemyPawns = pawns.filter(p => p.faction !== faction);
  let score = 0;
  
  for (const p of myPawns) {
    if (p.pos.r <= 0) score += 15;
    else if (p.pos.r <= 2) score += 5;
    else if (p.pos.r <= 4) score += 2;
  }
  for (const p of enemyPawns) {
    if (p.pos.r <= 0) score -= 15;
    else if (p.pos.r <= 2) score -= 5;
    else if (p.pos.r <= 4) score -= 2;
  }
  
  const myColumnCounts: Record<number, number> = {};
  const enemyColumnCounts: Record<number, number> = {};
  for (const p of myPawns) myColumnCounts[p.pos.q] = (myColumnCounts[p.pos.q] || 0) + 1;
  for (const p of enemyPawns) enemyColumnCounts[p.pos.q] = (enemyColumnCounts[p.pos.q] || 0) + 1;
  for (const q in myColumnCounts) if ((myColumnCounts[q] ?? 0) > 1) score -= ((myColumnCounts[q] ?? 0) - 1) * 10;
  for (const q in enemyColumnCounts) if ((enemyColumnCounts[q] ?? 0) > 1) score += ((enemyColumnCounts[q] ?? 0) - 1) * 10;
  
  for (const p of myPawns) {
    const hasNeighbor = myPawns.some(other => other !== p && Math.abs(other.pos.q - p.pos.q) <= 1);
    if (!hasNeighbor) score -= 8;
  }
  for (const p of enemyPawns) {
    const hasNeighbor = enemyPawns.some(other => other !== p && Math.abs(other.pos.q - p.pos.q) <= 1);
    if (!hasNeighbor) score += 8;
  }
  
  for (const p of myPawns) {
    const hasConnected = myPawns.some(other =>
      other !== p && Math.abs(other.pos.q - p.pos.q) <= 1 && Math.abs(other.pos.r - p.pos.r) <= 1
    );
    if (hasConnected) score += 5;
  }
  for (const p of enemyPawns) {
    const hasConnected = enemyPawns.some(other =>
      other !== p && Math.abs(other.pos.q - p.pos.q) <= 1 && Math.abs(other.pos.r - p.pos.r) <= 1
    );
    if (hasConnected) score -= 5;
  }
  
  return score;
}

export function evaluateEndgame(game: IGame, pieces: Piece[], faction: Faction): number {
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
  
  if (myKing) {
    const kingDistFromCenter = Math.max(
      Math.abs(myKing.pos.q), 
      Math.abs(myKing.pos.r), 
      Math.abs(-myKing.pos.q - myKing.pos.r)
    );
    
    if (isLateEndgame) score -= kingDistFromCenter * 8;
    else if (isEndgame) score -= kingDistFromCenter * 3;
    else if (aliveFactions.length === 2) score -= kingDistFromCenter * 5;
    
    const myMaterial = myPieces.reduce((sum, p) => sum + (PIECE_STRENGTH[p.type] || 0), 0);
    const enemyPieces = pieces.filter(p => p.faction !== faction);
    const enemyMaterial = enemyPieces.reduce((sum, p) => sum + (PIECE_STRENGTH[p.type] || 0), 0);
    
    if (myMaterial > enemyMaterial * 1.5) {}
  }
  
  for (const pawn of myPawns) {
    if (pawn.pos.r <= 0) score += isLateEndgame ? 200 : 100;
    else if (pawn.pos.r === 1) score += isLateEndgame ? 80 : 40;
    else if (pawn.pos.r === 2) score += isLateEndgame ? 40 : 20;
    else if (pawn.pos.r <= 4) score += 10;
    
    const blockingPawns = pieces.filter(p => 
      p.type === 'pawn' && p.faction !== faction &&
      Math.abs(p.pos.q - pawn.pos.q) <= 1 &&
      (faction === FACTION.FIRE ? p.pos.r < pawn.pos.r :
       faction === FACTION.WATER ? (p.pos.r > pawn.pos.r || p.pos.q < pawn.pos.q) :
       faction === FACTION.NATURE ? (p.pos.r > pawn.pos.r || p.pos.q > pawn.pos.q) : false)
    );
    if (blockingPawns.length === 0) score += isLateEndgame ? 60 : 30;
  }
  
  if (aliveFactions.length === 2) {
    const otherFaction = enemyFactions[0];
    if (otherFaction) {
      const rps = getRPSResult(faction, otherFaction);
      if (rps === 'advantage') score += 150;
      else if (rps === 'disadvantage') score -= 200;
      
      if (rps === 'advantage' && myKing) {
        const enemyKing = pieces.find(p => p.faction === otherFaction && p.type === 'king');
        if (enemyKing) {
          const kingDist = myKing.pos.distance(enemyKing.pos);
          if (kingDist <= 3) score += 30;
        }
      }
    }
  }
  
  if (pieces.length <= 20) {
    for (const piece of pieces.filter(p => p.faction === faction)) {
      if (piece.type === 'rook' || piece.type === 'queen') {
        const supportingPawns = pieces.filter(p => 
          p.faction === faction && p.type === 'pawn' && (
            p.pos.q === piece.pos.q || p.pos.r === piece.pos.r ||
            (Math.abs(p.pos.q - piece.pos.q) <= 1 && Math.abs(p.pos.r - piece.pos.r) <= 1)
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
  
  for (const ef of enemyFactions) {
    const enemyPieces = pieces.filter(p => p.faction === ef);
    const enemyKing = enemyPieces.find(p => p.type === 'king');
    
    if (enemyPieces.length <= 3) {
      score += (4 - enemyPieces.length) * 100;
      if (enemyKing) {
        for (const attacker of pieces.filter(p => p.faction === faction)) {
          const { attacks } = getValidMoves(attacker, game.boardCells!, game._occupiedMap!);
          if (attacks.some(a => a.equals(enemyKing.pos))) score += 500;
        }
      }
    }
  }
  
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

// ─── Heuristic Evaluation ──────────────────────────────────

export function evaluateBoard(game: IGame, faction: Faction): number {
  const W = getPersonalityWeights();
  const aggression = getPersonalityAggression();
  
  const pieces = game.getAlivePieces ? game.getAlivePieces() : game.pieces.filter(p => p.alive);
  let score = 0;
  
  for (const p of pieces) {
    const val = getMaterialValue(p, faction) * 10;
    score += (p.faction === faction ? val : -val) * W.material;
  }
  
  const myPieces = pieces.filter(p => p.faction === faction);
  for (const p of myPieces) {
    score += getPSTValue(p) * W.positional;
    const { moves, attacks } = getValidMoves(p, game.boardCells!, game._occupiedMap!);
    const mobility = moves.length + attacks.length;
    const mobBonus: Record<PieceType, number> = { queen: 0.3, rook: 0.2, bishop: 0.2, knight: 0.3, pawn: 0.1, king: 0 };
    score += mobility * (mobBonus[p.type] || 0.1) * W.mobility;
  }
  
  for (const p of pieces) {
    if (p.faction === faction) continue;
    score -= getPSTValue(p) * 0.8 * W.positional;
  }
  
  const myKing = myPieces.find(p => p.type === 'king');
  if (myKing) {
    let kingThreats = 0;
    for (const enemy of pieces) {
      if (enemy.faction === faction || !enemy.alive) continue;
      const { attacks } = getValidMoves(enemy, game.boardCells!, game._occupiedMap!);
      if (attacks.some(a => a.equals(myKing.pos))) kingThreats++;
    }
    score -= kingThreats * 15 * W.kingSafety;
    const kingDist = Math.max(Math.abs(myKing.pos.q), Math.abs(myKing.pos.r), Math.abs(-myKing.pos.q - myKing.pos.r));
    if (kingDist >= 6) score += 8 * W.kingSafety;
  }
  
  const enemyFactions = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE].filter(f => f !== faction);
  for (const ef of enemyFactions) {
    if (game.eliminatedFactions.has(ef)) {
      score += 200 * W.kingThreats;
      continue;
    }
    const eKing = pieces.find(p => p.faction === ef && p.type === 'king');
    if (eKing) {
      for (const attacker of pieces.filter(p => p.faction === faction)) {
        const { attacks } = getValidMoves(attacker, game.boardCells!, game._occupiedMap!);
        if (attacks.some(a => a.equals(eKing.pos))) score += 10 * W.kingThreats * (1 + aggression);
      }
    }
  }
  
  const aliveEnemies = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE]
    .filter(f => !game.eliminatedFactions.has(f) && f !== faction);
  if (aliveEnemies.length === 1) {
    const enemy = aliveEnemies[0];
    if (enemy) {
      const rps = getRPSResult(faction, enemy);
      if (rps === 'advantage') score += 20 * W.endgame;
    }
  }
  
  score += evaluatePawnStructure(pieces, faction) * W.pawnStructure;
  score += evaluateEndgame(game, pieces.filter(p => p.alive), faction) * W.endgame;
  
  return score;
}

export function simulateMove(game: IGame, piece: Piece, target: Hex): AISnapshot {
  const undo: AISnapshot = {
    piece,
    from: new Hex(piece.pos.q, piece.pos.r),
    pieceHasMoved: piece.hasMoved,
    wasAttack: false,
    defenderWasKilled: false,
    attackerDied: false,
    prevFactionIdx: game.currentFactionIdx,
    prevZobristHash: game._zobristHash !== undefined ? game._zobristHash : computeZobristHash(game),
  };
  
  const defender = game._occupiedMap!.get(target.key);
  
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
  
  const oldSideIdx = game.currentFactionIdx;
  const factions = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];
  let nextIdx = (game.currentFactionIdx + 1) % 3;
  while (game.eliminatedFactions.has(factions[nextIdx] ?? FACTION.FIRE)) {
    nextIdx = (nextIdx + 1) % 3;
  }
  game.currentFactionIdx = nextIdx;
  game.currentFaction = factions[nextIdx] ?? FACTION.FIRE;
  
  const prevHash = undo.prevZobristHash ?? computeZobristHash(game);
  game._zobristHash = updateZobristHash(
    prevHash,
    piece,
    undo.from.key,
    target.key,
    defender,
    undo.eliminatedFaction,
    piece.type === 'pawn' && piece.pos.r <= 0,
    oldSideIdx,
    game.currentFactionIdx
  );
  
  return undo;
}

export function undoMove(game: IGame, undo: AISnapshot): void {
  const { piece, from, pieceHasMoved, wasAttack, defender, defenderWasKilled, attackerDied, eliminatedFaction, prevFactionIdx, prevZobristHash } = undo;
  
  piece.pos = from;
  piece.hasMoved = pieceHasMoved;
  
  if (wasAttack && defenderWasKilled && defender) {
    defender.alive = true;
    if (eliminatedFaction) {
      game.eliminatedFactions.delete(eliminatedFaction);
      for (const p of game.pieces) {
        if (p.faction === eliminatedFaction) p.alive = true;
      }
    }
  } else if (wasAttack && attackerDied) {
    piece.alive = true;
  }
  
  if (undo.promotion) {
    piece.type = undo.promotion;
    piece.symbol = piece.faction === 'fire' ? 'P' : (piece.faction === 'water' ? 'P' : 'P');
  }
  
  game.currentFactionIdx = prevFactionIdx;
  game.currentFaction = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE][prevFactionIdx];
  rebuildOccupiedMap(game);
  
  if (prevZobristHash !== undefined) {
    game._zobristHash = prevZobristHash;
  }
}

// ─── Search Algorithms ────────────────────────────────────────

export const killerMoves: Record<string, boolean> = {};
export const historyTable: Record<string, number> = {};

export const FUTILITY_MARGINS = [0, 150, 300, 500];
export const RAZOR_MARGINS = [0, 300, 500];

export const LMR_BASE_REDUCTION = 0.6;
export const LMR_MIN_DEPTH = 3;
export const LMR_MOVE_THRESHOLD = 3;

export const PROBCUT_DEPTH = 5;
export const PROBCUT_MARGIN = 150;
export const PROBCUT_REDUCTION = 3;

let searchDeadline = 0;
export let nodesSearched = 0;

export function minimax(game: IGame, depth: number, alpha: number, beta: number, maximizingFaction: Faction, currentFaction: Faction): SearchResult {
  nodesSearched++;
  if (nodesSearched % 1000 === 0 && Date.now() > searchDeadline) {
    return { score: evaluateBoard(game, maximizingFaction), action: null, timeout: true };
  }

  const hash = game._zobristHash !== undefined ? game._zobristHash : computeZobristHash(game);
  const ttProbeResult = ttProbe(hash, depth, alpha, beta);
  
  if (ttProbeResult) {
    if (ttProbeResult.flag === 'exact' || ttProbeResult.flag === 'lower' || ttProbeResult.flag === 'upper') {
      return { score: ttProbeResult.score, action: ttProbeResult.action };
    }
    alpha = ttProbeResult.alpha;
    beta = ttProbeResult.beta;
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

  const inCheck = isKingdomCheck(game, currentFaction);
  const myPieces = game.pieces.filter(p => p.faction === currentFaction && p.alive);
  const canNullMove = depth >= 3 && !inCheck && myPieces.length > 1;

  if (canNullMove) {
    const savedFactionIdx = game.currentFactionIdx;
    const factions = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];
    let nextIdx = (game.currentFactionIdx + 1) % 3;
    while (game.eliminatedFactions.has(factions[nextIdx] ?? FACTION.FIRE)) {
      nextIdx = (nextIdx + 1) % 3;
    }
    game.currentFactionIdx = nextIdx;
    game.currentFaction = factions[nextIdx] ?? FACTION.FIRE;
    rebuildOccupiedMap(game);

    const R = 2;
    const nullResult = minimax(game, depth - 1 - R, -beta, -beta + 1, maximizingFaction, game.currentFaction);

    game.currentFactionIdx = savedFactionIdx;
    game.currentFaction = factions[savedFactionIdx] ?? FACTION.FIRE;
    rebuildOccupiedMap(game);

    if (!nullResult.timeout && -nullResult.score >= beta) {
      return { score: beta, action: null };
    }
  }

  const ttBestMove = ttProbeResult && ttProbeResult.bestMove ? ttProbeResult.bestMove : null;

  let bestScore = -Infinity;
  let bestAction: AIAction | null = null;

  actions.sort((a, b) => {
    if (ttBestMove) {
      const aIsTT = a.piece.id === ttBestMove.pieceId && a.target.key === ttBestMove.targetKey && a.type === ttBestMove.type;
      const bIsTT = b.piece.id === ttBestMove.pieceId && b.target.key === ttBestMove.targetKey && b.type === ttBestMove.type;
      if (aIsTT !== bIsTT) return aIsTT ? -1 : 1;
    }
    if (inCheck) {
      const aCheckEscape = getCheckEscapeType(game, currentFaction, a);
      const bCheckEscape = getCheckEscapeType(game, currentFaction, b);
      if (aCheckEscape !== bCheckEscape) return bCheckEscape - aCheckEscape;
    }
    const aSee = a.type === 'attack' ? quickSee(game, a) : 0;
    const bSee = b.type === 'attack' ? quickSee(game, b) : 0;
    if (aSee !== bSee) return bSee - aSee;
    const aKiller = killerMoves[`${depth},${a.piece.id},${a.target.key}`] ? 10000 : 0;
    const bKiller = killerMoves[`${depth},${b.piece.id},${b.target.key}`] ? 10000 : 0;
    const aHistory = historyTable[`${a.piece.id},${a.target.key}`] || 0;
    const bHistory = historyTable[`${b.piece.id},${b.target.key}`] || 0;
    return (bKiller + bHistory) - (aKiller + aHistory);
  });

  const actionsArray = [...actions];

  for (let moveIndex = 0; moveIndex < actionsArray.length; moveIndex++) {
    const action = actionsArray[moveIndex];
    const isQuiet = action.type !== 'attack';

    if (isQuiet && depth <= 3) {
      const staticScore = evaluateBoard(game, maximizingFaction);
      const futilityMargin = FUTILITY_MARGINS[depth] ?? 0;
      if (staticScore + futilityMargin <= alpha) continue;
    }

    let razorReduction = 0;
    if (isQuiet && depth <= 2) {
      const staticScore = evaluateBoard(game, maximizingFaction);
      const razorMargin = RAZOR_MARGINS[depth] ?? 0;
      if (staticScore + razorMargin <= alpha) razorReduction = 1;
    }

    let lmrReduction = 0;
    if (depth >= LMR_MIN_DEPTH && moveIndex >= LMR_MOVE_THRESHOLD && isQuiet) {
      const lmrFactor = Math.log2(depth) * Math.log2(moveIndex + 1) * LMR_BASE_REDUCTION;
      lmrReduction = Math.min(Math.floor(lmrFactor), depth - 1);
    }

    let probcutScore: number | null = null;
    if (depth >= PROBCUT_DEPTH && !isQuiet && !inCheck) {
      const staticScore = evaluateBoard(game, maximizingFaction);
      if (staticScore >= beta + PROBCUT_MARGIN) {
        const probeDepth = depth - PROBCUT_REDUCTION;
        const undo = simulateMove(game, action.piece, action.target);
        const nextFaction = game.currentFaction;
        const probeResult = minimax(game, probeDepth, beta - 1, beta, maximizingFaction, nextFaction);
        undoMove(game, undo);
        
        if (!probeResult.timeout && probeResult.score >= beta) {
          probcutScore = beta;
        }
      }
    }

    let searchDepth = depth - 1 - razorReduction - lmrReduction;
    let result: SearchResult;

    if (probcutScore !== null) {
      result = { score: probcutScore };
    } else {
      const undo = simulateMove(game, action.piece, action.target);
      const nextFaction = game.currentFaction;
      result = minimax(game, searchDepth, alpha, beta, maximizingFaction, nextFaction);
      undoMove(game, undo);
    }

    if (lmrReduction > 0 && !result.timeout && result.score > alpha && result.score < beta) {
      const undo = simulateMove(game, action.piece, action.target);
      const nextFaction = game.currentFaction;
      const fullDepthResult = minimax(game, depth - 1 - razorReduction, alpha, beta, maximizingFaction, nextFaction);
      undoMove(game, undo);
      if (!fullDepthResult.timeout) result = fullDepthResult;
    }

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
  ttStore(hash, depth, bestScore, flag, bestAction ? {
    pieceId: bestAction.piece.id,
    targetKey: bestAction.target.key,
    type: bestAction.type,
    rps: bestAction.rps
  } : null);

  return { score: bestScore, action: bestAction };
}

export function quiesce(game: IGame, alpha: number, beta: number, maximizingFaction: Faction, currentFaction: Faction, qDepth = 0): SearchResult {
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

export function getCheckEscapeType(game: IGame, faction: Faction, action: AIAction): number {
  if (!isKingdomCheck(game, faction)) return 0;
  
  const king = game.pieces.find(p => p.faction === faction && p.type === 'king' && p.alive);
  if (!king) return 0;
  
  const checkers = game.pieces.filter(p => {
    if (p.faction === faction || !p.alive) return false;
    const { attacks } = getValidMoves(p, game.boardCells!, game._occupiedMap!);
    return attacks.some(a => a.equals(king.pos));
  });
  
  if (checkers.length === 0) return 0;
  
  if (action.piece.id === king.id) return 2;
  
  for (const checker of checkers) {
    if (action.target.equals(checker.pos)) return 3;
  }
  
  if (action.type === 'attack') return 1;
  return 1;
}

function checkEscapeOrdering(game: IGame, faction: Faction, actions: AIAction[]): AIAction[] {
  const inCheck = isKingdomCheck(game, faction);
  if (!inCheck) return actions;
  
  return [...actions].sort((a, b) => {
    const aEscape = getCheckEscapeType(game, faction, a);
    const bEscape = getCheckEscapeType(game, faction, b);
    return bEscape - aEscape;
  });
}

export function iterativeDeepening(game: IGame, faction: Faction): AIAction | null {
  const timeBudget = calculateTimeBudget(game);
  searchDeadline = Date.now() + timeBudget;
  nodesSearched = 0;
  // Keep TT across moves - only age out old entries via ttNewSearch()
  Object.keys(killerMoves).forEach(k => delete killerMoves[k]);
  Object.keys(historyTable).forEach(k => delete historyTable[k]);

  const actions = getAllActions(game, faction);
  if (actions.length === 0) return null;
  if (actions.length === 1) return actions[0] ?? null;

  let bestResult: SearchResult = { score: -Infinity, action: null };
  let prevScore = 0;

  const MAX_DEPTH_CAP = 12;
  for (let depth = 1; depth <= MAX_DEPTH_CAP; depth++) {
    ttNewSearch();
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

  return bestResult.action ?? null;
}

export function greedyBestMove(game: IGame, _faction: Faction, actions: AIAction[]): AIAction | null {
  let bestActions: AIAction[] = [];
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
      const pv = getPSTValue({ type: 'pawn', pos: action.target } as Piece);
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
  return bestActions[Math.floor(Math.random() * bestActions.length)] ?? null;
}

let _bookBuilt = false;

export function calculateBestMove(game: IGame, faction: Faction): AIAction | null {
  if (!_bookBuilt) {
    buildOpeningBook(game.constructor as new () => IGame);
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
  
  // Check escape move ordering when in check
  if (isKingdomCheck(game, faction)) {
    return iterativeDeepening(game, faction);
  }
  
  return iterativeDeepening(game, faction);
}

export function getAIDepth(): number {
  return MAX_DEPTH;
}

export function setAIPersonality(personality: string): boolean {
  return setPersonality(personality);
}

export function getAIPersonalities(): Array<{ key: AIPersonality; name: string; description: string }> {
  return getPersonalities();
}

export function deserializeGame(state: {
  pieces: Array<{ id: string; type: PieceType; faction: Faction; pos: { q: number; r: number }; symbol: string; alive: boolean; hasMoved: boolean }>;
  currentFactionIdx: number;
  currentFaction: Faction;
  state: string;
  eliminatedFactions: Faction[];
  rpsEnabled: boolean;
  capturedPieces: Record<string, string[]>;
  _halfmoveClock?: number;
}): IGame {
  const game: Partial<IGame> = {
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
    state: state.state as any,
    eliminatedFactions: new Set(state.eliminatedFactions),
    rpsEnabled: state.rpsEnabled,
    boardCells: new Map(),
    _occupiedMap: new Map(),
    capturedPieces: { fire: [], water: [], nature: [] },
    moveHistory: [],
    _positionHistory: new Map(),
    _halfmoveClock: state._halfmoveClock || 0,
    currentFactionName: '',
    pendingPromotion: null,
    onUpdate: null,
    onCombat: null,
    onGameOver: null,
    onElimination: null,
    onDraw: null,
    onPromotion: null,
    _undoStack: [],
  };
  
  game.capturedPieces = {
    fire: (state.capturedPieces.fire ?? []).map(id => game.pieces!.find(p => p.id === id)!).filter((p): p is Piece => p !== undefined),
    water: (state.capturedPieces.water ?? []).map(id => game.pieces!.find(p => p.id === id)!).filter((p): p is Piece => p !== undefined),
    nature: (state.capturedPieces.nature ?? []).map(id => game.pieces!.find(p => p.id === id)!).filter((p): p is Piece => p !== undefined),
  };
  
  rebuildOccupiedMap(game as IGame);
  return game as IGame;
}