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

// ─── Dynamic Piece Values (RPS-aware) ───────────────────────────

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

export function rebuildOccupiedMap(game: IGame): void {
  game._occupiedMap = new Map();
  for (const piece of game.pieces) {
    if (piece.alive) {
      game._occupiedMap.set(piece.pos.key, piece);
    }
  }
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

  const rps = action.rps;
  return see(game, action.piece, defender, action.piece.faction, defender.faction, rps);
}

// ─── Zobrist Hashing / Transposition Table ───────────────────

const ZOBRIST_PIECE_TYPES = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'] as const;
const ZOBRIST_FACTIONS = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];
const NUM_SQUARES = 37; // 7x7 hex board max

const SQUARE_TO_INDEX = new Map<string, number>();
let index = 0;
for (let q = -7; q <= 2; q++) {
  for (let r = -2; r <= 7; r++) {
    if (Math.abs(-q - r) > 5) continue;
    SQUARE_TO_INDEX.set(`${q},${r}`, index++);
  }
}

class ZobristRNG {
  seed = 0x9e3779b97f4a7c15n;
  next(): bigint {
    let z = (this.seed += 0x9e3779b97f4a7c15n);
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

export const ZOBRIST_SIDE_KEYS: bigint[] = ZOBRIST_FACTIONS.map(() => zobristRng.next());
export const ZOBRIST_ELIMINATED_KEYS: bigint[] = ZOBRIST_FACTIONS.map(() => zobristRng.next());
export const ZOBRIST_RPS_KEY = zobristRng.next();

function getZobristKey(pieceTypeIdx: number, factionIdx: number, squareIdx: number): bigint {
  // @ts-ignore - TypeScript doesn't track that pre-filled 3D arrays are fully populated
  return ZOBRIST_PIECE_KEYS[pieceTypeIdx][factionIdx][squareIdx];
}

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
      const elimIdx = ZOBRIST_FACTIONS.indexOf(fac);
      if (elimIdx >= 0) hash ^= ZOBRIST_ELIMINATED_KEYS[elimIdx];
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
    if (capPtIdx >= 0 && capFacIdx >= 0 && toIdx !== undefined) {
      hash ^= getZobristKey(capPtIdx, capFacIdx, toIdx);
    }
    if (capturedPiece.type === 'king' && eliminatedFaction) {
      const elimIdx = ZOBRIST_FACTIONS.indexOf(eliminatedFaction);
      if (elimIdx >= 0) hash ^= ZOBRIST_ELIMINATED_KEYS[elimIdx];
    }
  }

  if (oldSideIdx >= 0) hash ^= ZOBRIST_SIDE_KEYS[oldSideIdx];
  if (newSideIdx >= 0) hash ^= ZOBRIST_SIDE_KEYS[newSideIdx];

  return hash;
}

export type TTProbeResult = {
  kind: 'exact' | 'lower' | 'upper' | 'bounds' | 'none';
  score?: number;
  action?: { pieceId: string; targetKey: string; type: 'move' | 'attack'; rps: 'advantage' | 'neutral' | 'disadvantage' } | null;
  flag?: 'exact' | 'lower' | 'upper';
  alpha?: number;
  beta?: number;
  bestMove?: { pieceId: string; targetKey: string; type: 'move' | 'attack'; rps: 'advantage' | 'neutral' | 'disadvantage' } | null;
};

export function ttProbe(hash: bigint, depth: number, alpha: number, beta: number): TTProbeResult {
  const entry = tt[Number(hash & BigInt(TT_SIZE - 1))];

  if (!entry || entry.key !== hash) return { kind: 'none' };

  ttHits++;

  if (entry.depth >= depth) {
    if (entry.flag === 'exact') return { kind: 'exact', score: entry.score, action: entry.bestMove, flag: 'exact' };
    if (entry.flag === 'lower') alpha = Math.max(alpha, entry.score);
    if (entry.flag === 'upper') beta = Math.min(beta, entry.score);
    if (alpha >= beta) return { kind: entry.flag, score: entry.score, action: entry.bestMove, flag: entry.flag };
  }

  return { kind: 'bounds', alpha, beta, bestMove: entry.bestMove };
}

export function ttStore(
  hash: bigint, depth: number, score: number, 
  flag: 'exact' | 'lower' | 'upper',
  bestMove: { pieceId: string; targetKey: string; type: 'move' | 'attack'; rps: 'advantage' | 'neutral' | 'disadvantage' } | null = null
): void {
  const idx = Number(hash & BigInt(TT_SIZE - 1));
  const entry = tt[idx];
  if (!entry) return;

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
  return advancement * 10 + centerCol * 5 - d;
});

export function getPSTValue(piece: Piece): number {
  const key = `${piece.pos.q},${piece.pos.r}`;
  switch (piece.type) {
    case 'king': return KING_PST.get(key) || 0;
    case 'queen': return QUEEN_PST.get(key) || 0;
    case 'rook': return ROOK_PST.get(key) || 0;
    case 'bishop': return BISHOP_PST.get(key) || 0;
    case 'knight': return KNIGHT_PST.get(key) || 0;
    case 'pawn': return PAWN_PST.get(key) || 0;
    default: return 0;
  }
}

// ─── Personality System ────────────────────────────────────────

export const PERSONALITY_WEIGHTS: Record<AIPersonality, PersonalityWeights> = {
  balanced: { 
    material: 1.0, 
    kingSafety: 1.0, 
    mobility: 1.0, 
    centerControl: 1.0, 
    pieceActivity: 1.0, 
    pawnStructure: 1.0, 
    endgame: 1.0 
  },
  aggressive: { 
    material: 1.2, 
    kingSafety: 0.7, 
    mobility: 1.3, 
    centerControl: 1.2, 
    pieceActivity: 1.4, 
    pawnStructure: 0.8, 
    endgame: 1.0 
  },
  defensive: { 
    material: 0.9, 
    kingSafety: 1.5, 
    mobility: 0.8, 
    centerControl: 1.0, 
    pieceActivity: 0.7, 
    pawnStructure: 1.3, 
    endgame: 1.2 
  },
  tactical: { 
    material: 1.1, 
    kingSafety: 0.9, 
    mobility: 1.5, 
    centerControl: 1.1, 
    pieceActivity: 1.3, 
    pawnStructure: 1.0, 
    endgame: 0.9 
  },
};

export function getPersonalityWeights(personality: AIPersonality): PersonalityWeights {
  return PERSONALITY_WEIGHTS[personality] || PERSONALITY_WEIGHTS.balanced;
}

let currentPersonality: AIPersonality = 'balanced';
export function setPersonality(personality: string): boolean {
  if (personality in PERSONALITY_WEIGHTS) {
    currentPersonality = personality as AIPersonality;
    return true;
  }
  return false;
}
export function getCurrentPersonality(): AIPersonality {
  return currentPersonality;
}

export function getPersonalities(): Array<{ key: AIPersonality; name: string; description: string }> {
  return [
    { key: 'balanced', name: 'Ausgewogen', description: 'Balancierter Spielstil' },
    { key: 'aggressive', name: 'Aggressiv', description: 'Angreifend, taktisch' },
    { key: 'defensive', name: 'Defensiv', description: 'Sicher, positionell' },
    { key: 'tactical', name: 'Taktisch', description: 'Kombinationen, Opfer' },
  ];
}

// ─── Board Evaluation ────────────────────────────────────────

function evaluatePawnStructure(pieces: Piece[], faction: Faction): number {
  const pawns = pieces.filter(p => p.faction === faction && p.type === 'pawn' && p.alive);
  let score = 0;
  for (const pawn of pawns) {
    score += getPSTValue(pawn);
  }
  return score;
}

function evaluateEndgame(game: IGame, pieces: Piece[], faction: Faction): number {
  const totalPieces = pieces.filter(p => p.alive).length;
  if (totalPieces > 15) return 0;

  const king = pieces.find(p => p.faction === faction && p.type === 'king' && p.alive);
  if (!king) return 0;

  let score = 0;
  const centerDist = Math.abs(king.pos.q) + Math.abs(king.pos.r) + Math.abs(-king.pos.q - king.pos.r);
  score += (10 - centerDist) * 20;

  const ownPawns = pieces.filter(p => p.faction === faction && p.type === 'pawn' && p.alive);
  score += ownPawns.length * 50;

  const enemyPieces = pieces.filter(p => p.faction !== faction && p.alive);
  for (const enemy of enemyPieces) {
    if (enemy.type === 'king') {
      const dist = Math.abs(king.pos.q - enemy.pos.q) + Math.abs(king.pos.r - enemy.pos.r) + 
                   Math.abs(-king.pos.q - king.pos.r + enemy.pos.q + enemy.pos.r);
      score += (15 - dist) * 10;
    }
  }

  return score;
}

export function evaluateBoard(game: IGame, faction: Faction): number {
  const W = getPersonalityWeights(currentPersonality);
  const pieces = game.getAlivePieces ? game.getAlivePieces() : game.pieces.filter(p => p.alive);
  const myPieces = pieces.filter(p => p.faction === faction);
  const enemyPieces = pieces.filter(p => p.faction !== faction);

  let score = 0;

  // Material + PST
  for (const piece of myPieces) {
    const baseValue = PIECE_STRENGTH[piece.type];
    const pstValue = getPSTValue(piece);
    score += (baseValue * 10 + pstValue) * W.material;
  }
  for (const piece of enemyPieces) {
    const baseValue = PIECE_STRENGTH[piece.type];
    const pstValue = getPSTValue(piece);
    score -= (baseValue * 10 + pstValue) * W.material;
  }

  // King Safety
  const myKing = myPieces.find(p => p.type === 'king');
  if (myKing) {
    const safety = isKingdomCheck(game, faction) ? -200 : 0;
    score += safety * W.kingSafety;
  }

  // Mobility
  let myMobility = 0;
  for (const piece of myPieces) {
    const { moves, attacks } = getValidMoves(piece, game.boardCells!, game._occupiedMap!);
    myMobility += moves.length + attacks.length;
  }
  let enemyMobility = 0;
  for (const piece of enemyPieces) {
    const { moves, attacks } = getValidMoves(piece, game.boardCells!, game._occupiedMap!);
    enemyMobility += moves.length + attacks.length;
  }
  score += (myMobility - enemyMobility) * 5 * W.mobility;

  // Center Control
  let centerControl = 0;
  for (const piece of myPieces) {
    const dist = Math.abs(piece.pos.q) + Math.abs(piece.pos.r) + Math.abs(-piece.pos.q - piece.pos.r);
    centerControl += Math.max(0, 10 - dist);
  }
  score += centerControl * W.centerControl;

  // Piece Activity
  score += (myMobility - enemyMobility) * 2 * W.pieceActivity;

  // Pawn Structure
  score += evaluatePawnStructure(pieces, faction) * W.pawnStructure;

  // Endgame
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

  if (ttProbeResult.kind === 'exact' || ttProbeResult.kind === 'lower' || ttProbeResult.kind === 'upper') {
    return { score: ttProbeResult.score as number, action: ttProbeResult.action as any };
  }
  alpha = ttProbeResult.alpha as number;
  beta = ttProbeResult.beta as number;

  if (game.state === 'game_over') {
    return { score: evaluateBoard(game, maximizingFaction), action: null };
  }

  const inCheck = isKingdomCheck(game, currentFaction);
  const actions = getAllActions(game, currentFaction);

  if (actions.length === 0) {
    return { score: evaluateBoard(game, maximizingFaction), action: null };
  }

  if (depth <= 0) {
    return quiesce(game, alpha, beta, maximizingFaction, currentFaction);
  }

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

  const ttBestMove = ttProbeResult.kind !== 'none' && ttProbeResult.kind !== 'bounds' 
    ? ttProbeResult.action : null;

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

// ─── Pondering ───────────────────────────────────────────────────────
// AI thinks during opponent's turn to gain extra search time

export interface PonderState {
  game: IGame;
  faction: Faction;
  bestMove: AIAction | null;
  bestScore: number;
  depth: number;
  nodesSearched: number;
  abort: () => void;
  promise: Promise<AIAction | null>;
}

let ponderState: PonderState | null = null;

/**
 * Start pondering - AI thinks during opponent's turn
 * Call this immediately after opponent makes a move
 */
export function startPondering(game: IGame, opponentFaction: Faction): void {
  stopPondering(); // Clean up any previous ponder

  // Clone game state for pondering (don't modify original)
  const ponderGame = cloneGameForSearch(game);
  const maximizingFaction = ponderGame.currentFaction;

  // Create abort controller for cleanup
  let aborted = false;
  const abort = () => { aborted = true; };

  // Run iterative deepening in background with a generous time budget
  const ponderPromise = (async () => {
    const timeBudget = calculateTimeBudget(ponderGame) * 2; // Double time for pondering
    searchDeadline = Date.now() + timeBudget;
    nodesSearched = 0;
    Object.keys(killerMoves).forEach(k => delete killerMoves[k]);
    Object.keys(historyTable).forEach(k => delete historyTable[k]);

    const actions = getAllActions(ponderGame, maximizingFaction);
    if (actions.length === 0) return null;
    if (actions.length === 1) return actions[0] ?? null;

    let bestResult: SearchResult = { score: -Infinity, action: null };
    let prevScore = 0;
    const MAX_DEPTH_CAP = 12;

    for (let depth = 1; depth <= MAX_DEPTH_CAP; depth++) {
      if (aborted) break;
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

      let result = minimax(ponderGame, depth, alpha, beta, maximizingFaction, maximizingFaction);

      if (!result.timeout && result.score <= alpha) {
        result = minimax(ponderGame, depth, -Infinity, beta, maximizingFaction, maximizingFaction);
      } else if (!result.timeout && result.score >= beta) {
        result = minimax(ponderGame, depth, alpha, Infinity, maximizingFaction, maximizingFaction);
      }

      if (!result.timeout && (result.score <= -Infinity + 1 || result.score >= Infinity - 1)) {
        result = minimax(ponderGame, depth, -Infinity, Infinity, maximizingFaction, maximizingFaction);
      }

      if (!result.timeout) {
        bestResult = result;
        prevScore = result.score;
      } else {
        break;
      }
    }

    return bestResult.action ?? null;
  })();

  ponderState = {
    game: ponderGame,
    faction: maximizingFaction,
    bestMove: null,
    bestScore: 0,
    depth: 0,
    nodesSearched: 0,
    abort,
    promise: ponderPromise
  };
}

/**
 * Stop pondering and return the best move found
 * Call this when opponent has made their move
 */
export async function stopPondering(): Promise<AIAction | null> {
  if (!ponderState) return null;

  ponderState.abort();

  // Wait for the ponder promise to resolve (it checks aborted flag)
  const move = await ponderState.promise.catch(() => null);

  ponderState = null;
  return move;
}

/**
 * Get the current ponder move if available (non-blocking)
 */
export function getPonderMove(): AIAction | null {
  return ponderState?.bestMove ?? null;
}

/**
 * Check if currently pondering
 */
export function isPondering(): boolean {
  return ponderState !== null;
}

/**
 * Clone game for search (deep copy without heavy objects)
 */
function cloneGameForSearch(source: IGame): IGame {
  const game: Partial<IGame> = {
    pieces: source.pieces.map(p => ({
      id: p.id,
      type: p.type,
      faction: p.faction,
      pos: new Hex(p.pos.q, p.pos.r),
      symbol: p.symbol,
      alive: p.alive,
      hasMoved: p.hasMoved
    })),
    currentFactionIdx: source.currentFactionIdx,
    currentFaction: source.currentFaction,
    state: source.state,
    eliminatedFactions: new Set(source.eliminatedFactions),
    rpsEnabled: source.rpsEnabled,
    boardCells: source.boardCells,
    _occupiedMap: new Map(source._occupiedMap),
    capturedPieces: { 
      fire: [...source.capturedPieces.fire], 
      water: [...source.capturedPieces.water], 
      nature: [...source.capturedPieces.nature] 
    },
    moveHistory: [...source.moveHistory],
    _positionHistory: new Map(source._positionHistory),
    _halfmoveClock: source._halfmoveClock,
    currentFactionName: source.currentFactionName,
    pendingPromotion: source.pendingPromotion ? { ...source.pendingPromotion } : null,
    onUpdate: source.onUpdate,
    onCombat: source.onCombat,
    onGameOver: source.onGameOver,
    onElimination: source.onElimination,
    onDraw: source.onDraw,
    onPromotion: source.onPromotion,
    _undoStack: [],
    _zobristHash: source._zobristHash
  };

  const cloned = game as IGame;
  cloned.getAlivePieces = source.getAlivePieces.bind(cloned);
  cloned.getPieceAt = source.getPieceAt.bind(cloned);
  cloned.simulateMove = source.simulateMove.bind(cloned);
  cloned.undoMove = source.undoMove.bind(cloned);
  cloned._rebuildOccupiedMap = source._rebuildOccupiedMap.bind(cloned);
  cloned._nextTurn = source._nextTurn.bind(cloned);
  cloned.handleCellClick = source.handleCellClick.bind(cloned);
  cloned.isKingInCheck = source.isKingInCheck.bind(cloned);
  cloned.completePromotion = source.completePromotion.bind(cloned);
  cloned.init = source.init.bind(cloned);
  cloned.undo = source.undo.bind(cloned);

  return cloned;
}

// Pondering exports
export { startPondering, stopPondering, getPonderMove, isPondering };