/**
 * TriSchach AI Core - Shared Logic
 *
 * Contains all shared AI logic used by both main thread (ai.ts)
 * and Web Worker (ai-worker.ts).
 *
 * DO NOT MODIFY ai.ts or ai-worker.ts directly for shared logic!
 * Add/modify here, then both consumers stay in sync.
 */

import { getValidMoves, PIECE_STRENGTH } from "./pieces.ts";
import { getRPSResult, FACTION } from "./board.ts";
import { Hex } from "./hex.ts";
import { isKingdomCheck } from "./game-check.ts";
import {
  pickBookMove,
  buildOpeningBook,
  inBook,
  learnFromGame,
  getLearnedData,
  loadLearnedData,
} from "./opening-book.ts";
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
  AIPersonality,
  RPSResult,
} from "./types.ts";

// ─── Constants ────────────────────────────────────────────────────

export const TURN_ORDER: Faction[] = [
  FACTION.FIRE,
  FACTION.WATER,
  FACTION.NATURE,
];

// ─── Dynamic Piece Values (RPS-aware) ────────────────────────────

export const RPS_VALUE_MULTIPLIER: Record<RPSResult, number> = {
  advantage: 1.3, // Our pieces worth more vs faction we beat
  neutral: 1.0, // Normal value vs same faction
  disadvantage: 0.7, // Our pieces worth less vs faction that beats us
};

export function getDynamicPieceValue(
  pieceType: PieceType,
  attackingFaction: Faction,
  defendingFaction: Faction,
): number {
  const baseValue = PIECE_STRENGTH[pieceType];
  if (pieceType === "king") return baseValue * 100;

  const rps = getRPSResult(attackingFaction, defendingFaction);
  return baseValue * RPS_VALUE_MULTIPLIER[rps];
}

export function getMaterialValue(
  piece: Piece,
  perspectiveFaction: Faction,
): number {
  const baseValue = PIECE_STRENGTH[piece.type];
  if (piece.type === "king") return baseValue * 100;

  const rps = getRPSResult(perspectiveFaction, piece.faction);
  const multiplier =
    rps === "advantage" ? 0.85 : rps === "disadvantage" ? 1.15 : 1.0;
  return baseValue * multiplier;
}

// ─── Adaptive Time Management ────────────────────────────────────

export function calculateTimeBudget(game: IGame): number {
  const pieceCount = game.getAlivePieces
    ? game.getAlivePieces().length
    : game.pieces.filter((p) => p.alive).length;
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

export function setAIDepth(depth: number): void {
  MAX_DEPTH = Math.max(1, Math.min(12, depth));
}

export function getAIDepth(): number {
  return MAX_DEPTH;
}

// ─── SEE (Static Exchange Evaluation) ────────────────────────────

// Piece values for SEE (centipawns)
export const SEE_PIECE_VALUES: Record<PieceType, number> = {
  king: 10000,
  queen: 900,
  rook: 500,
  bishop: 300,
  knight: 300,
  pawn: 100,
};

export function getSeeValue(pieceType: PieceType): number {
  return SEE_PIECE_VALUES[pieceType] ?? 0;
}

/**
 * Static Exchange Evaluation for Trischach with RPS mechanics.
 * Returns score in centipawns from attacker's perspective.
 * Positive = winning capture sequence, Negative = losing.
 */
export function see(
  game: IGame,
  attacker: Piece,
  victim: Piece,
  attackerFaction: Faction,
  victimFaction: Faction,
  rpsResult: RPSResult,
): number {
  // RPS disadvantage = attacker dies immediately, huge penalty
  if (rpsResult === "disadvantage") {
    return -getSeeValue(attacker.type) * 10;
  }

  // RPS advantage/neutral: attacker wins initial capture
  let score = getSeeValue(victim.type) * 10;

  // Simulate recapture sequence (alternating sides)
  // We track the current "attacker" and "victim" as pieces are captured
  // For Trischach 3-player, we simplify: assume recapture by victim's faction
  // then counter-recapture by original attacker's faction, etc.

  let currentAttacker = { ...victim, type: attacker.type }; // The piece that just moved/attacked
  let currentVictim = { ...attacker }; // The piece that could be recaptured
  let currentAttackerFaction = attackerFaction;
  let currentVictimFaction = victimFaction;
  let moveCount = 1;

  // Board state simulation for SEE - we remove captured pieces
  // Simplified: just track what's left and alternate
  // Full implementation would need board copy; this is fast heuristic

  while (moveCount < 6) {
    // Limit depth of SEE
    moveCount++;

    // Find best recapture for the defending side
    let bestRecapture = -Infinity;
    let recapturePiece: Piece | null = null;

    // In real SEE, we'd iterate all pieces of currentVictimFaction that can capture currentAttacker
    // Simplified: just use the victim's value as proxy for recapture quality
    const recaptureValue = getSeeValue(currentAttacker.type);

    if (recaptureValue <= 0) break; // Nothing to recapture

    // Alternate: defending side recaptures
    score -= recaptureValue * 10;
    moveCount++;

    if (moveCount >= 6) break;

    // Original attacker side counter-recaptures
    const counterValue = getSeeValue(currentVictim.type);
    if (counterValue <= 0) break;
    score += counterValue * 10;

    // Swap roles for next iteration
    const temp = currentAttacker;
    currentAttacker = currentVictim;
    currentVictim = temp;
    const tempF = currentAttackerFaction;
    currentAttackerFaction = currentVictimFaction;
    currentVictimFaction = tempF;
  }

  return score;
}

/**
 * Quick SEE for move ordering - just evaluates if capture is winning/equal/losing
 */
export function quickSee(game: IGame, action: AIAction): number {
  if (action.type !== "attack") return 0;

  const defender = game.pieces.find(
    (p) => p.alive && p.pos.equals(action.target),
  );
  if (!defender) return 0;

  const attackerFaction = action.piece.faction;
  const victimFaction = defender.faction;
  const rps = game.rpsEnabled
    ? getRPSResult(attackerFaction, victimFaction)
    : "advantage";

  if (rps === "disadvantage") return -10000; // Suicidal

  const attackerVal = getSeeValue(action.piece.type);
  const victimVal = getSeeValue(defender.type);

  // Simple MVV-LVA with RPS
  if (rps === "advantage") {
    return (victimVal - attackerVal / 10) * 100;
  }
  // Neutral
  return (victimVal - attackerVal / 10) * 50;
}

// ─── AI Personalities ────────────────────────────────────────────

export const AI_PERSONALITIES: Record<AIPersonality, PersonalityConfig> = {
  balanced: {
    name: "Ausgewogen",
    description: "Standard-Spielweise, ausgewogene Bewertung",
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
    name: "Aggressiv",
    description:
      "Angreifend, sucht taktische Komplikationen, opfert Material für Initiative",
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
    name: "Defensiv",
    description: "Solid, minimiert Risiken, wartet auf Fehler des Gegners",
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
    name: "Taktisch",
    description: "Fokus auf Taktik, Opfersuchend, scharfes Spiel",
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

let _currentPersonality: AIPersonality = "balanced";

export function getPersonalityWeights(): PersonalityWeights {
  return (
    AI_PERSONALITIES[_currentPersonality]?.weights ??
    AI_PERSONALITIES.balanced.weights
  );
}

export function getPersonalityAggression(): number {
  return AI_PERSONALITIES[_currentPersonality]?.aggression ?? 0;
}

export function setPersonality(personality: AIPersonality): boolean {
  if (AI_PERSONALITIES[personality]) {
    _currentPersonality = personality;
    return true;
  }
  return false;
}

export function getPersonality(): AIPersonality {
  return _currentPersonality;
}

export function getPersonalities(): Array<{
  key: AIPersonality;
  name: string;
  description: string;
}> {
  return Object.keys(AI_PERSONALITIES).map((key) => ({
    key: key as AIPersonality,
    name: AI_PERSONALITIES[key as AIPersonality].name,
    description: AI_PERSONALITIES[key as AIPersonality].description,
  }));
}

export function setAIPersonality(personality: AIPersonality): boolean {
  return setPersonality(personality);
}

export function getAIPersonalities(): Array<{
  key: AIPersonality;
  name: string;
  description: string;
}> {
  return getPersonalities();
}

// ─── Zobrist Transposition Table ────────────────────────────────

// Zobrist Keys: [PIECE_TYPE][FACTION][SQUARE_INDEX] -> 64-bit random number
// We use BigInt for 64-bit arithmetic in JavaScript
const ZOBRIST_PIECE_TYPES: PieceType[] = [
  "king",
  "queen",
  "rook",
  "bishop",
  "knight",
  "pawn",
];
const ZOBRIST_FACTIONS: Faction[] = ["fire", "water", "nature"];

// Board squares: axial coordinates on triangular board
// q: -7 to 2, r: -2 to 7 (with constraints forming triangle)
// Total valid squares = 91 (for standard TriSchach board)
function generateValidSquares(): string[] {
  const squares: string[] = [];
  for (let q = -7; q <= 2; q++) {
    for (let r = -2; r <= 7; r++) {
      const s = -q - r;
      // Valid triangle constraint
      if (q >= -7 && q <= 2 && r >= -2 && r <= 7 && s >= -5 && s <= 5) {
        squares.push(`${q},${r}`);
      }
    }
  }
  return squares;
}

const VALID_SQUARES = generateValidSquares();
const SQUARE_TO_INDEX = new Map(VALID_SQUARES.map((sq, i) => [sq, i]));
const NUM_SQUARES = VALID_SQUARES.length; // 91

// Mersenne Twister for deterministic random 64-bit keys (seeded for reproducibility)
class ZobristRNG {
  constructor(seed = 0x9e3779b97f4a7c15n) {
    this.state = seed;
  }
  next(): bigint {
    // SplitMix64
    this.state = (this.state + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
    let z = this.state;
    z = (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n;
    z = (z ^ (z >> 27n)) * 0x94d049bb133111ebn;
    z = z ^ (z >> 31n);
    return z & 0xffffffffffffffffn;
  }
  private state: bigint;
}

const zobristRng = new ZobristRNG();

// Zobrist Keys: piece_key[pieceTypeIndex][factionIndex][squareIndex]
export const ZOBRIST_PIECE_KEYS = new Array(ZOBRIST_PIECE_TYPES.length)
  .fill(null)
  .map(() =>
    new Array(ZOBRIST_FACTIONS.length)
      .fill(null)
      .map(() =>
        new Array(NUM_SQUARES).fill(null).map(() => zobristRng.next()),
      ),
  );

// Side-to-move keys (3 factions)
export const ZOBRIST_SIDE_KEYS = ZOBRIST_FACTIONS.map(() => zobristRng.next());

// Castling/En-passant not applicable in TriSchach, but we have:
// - Eliminated factions (3 bits)
export const ZOBRIST_ELIMINATED_KEYS = ZOBRIST_FACTIONS.map(() =>
  zobristRng.next(),
);

// RPS enabled flag
export const ZOBRIST_RPS_KEY = zobristRng.next();

// ─── Zobrist Key Access Helpers ──────────────────────────────────
// TypeScript doesn't track array bounds, so we use these helpers for safe access

// Get piece key from 3D array with bounds checking
function getZobristPieceKey(
  ptIdx: number,
  facIdx: number,
  sqIdx: number,
): bigint {
  // ptIdx, facIdx, sqIdx already validated by callers
  const pieceKeys = ZOBRIST_PIECE_KEYS[ptIdx]! as bigint[][];
  const factionKeys = pieceKeys[facIdx]! as bigint[];
  // sqIdx validated by callers
  return factionKeys[sqIdx] as bigint;
}

// Get piece key for updateZobristHash (from destination index)
function getZobristPieceKeyAt(
  ptIdx: number,
  facIdx: number,
  sqIdx: number,
): bigint {
  const pieceKeys = ZOBRIST_PIECE_KEYS[ptIdx]! as bigint[][];
  const factionKeys = pieceKeys[facIdx]! as bigint[];
  return factionKeys[sqIdx] as bigint;
}

// ─── Helper: Reconstruct full AIAction from TT storage ─────────────

function reconstructAction(
  game: IGame,
  storedMove: {
    pieceId: string;
    targetKey: string;
    type: "move" | "attack";
    rps?: RPSResult;
  } | null,
): AIAction | null {
  if (!storedMove) return null;
  const piece = game.pieces.find((p) => p.id === storedMove.pieceId && p.alive);
  if (!piece) return null;
  // Parse targetKey (format "q,r")
  const parts = storedMove.targetKey.split(",");
  const q = parseInt(parts[0]!, 10);
  const r = parseInt(parts[1]!, 10);
  if (isNaN(q) || isNaN(r)) return null;
  const target = new Hex(q, r);
  return { piece, target, type: storedMove.type, rps: storedMove.rps };
}

// Transposition Table Entry
export class TTEntry {
  key: bigint = 0n;
  depth: number = 0;
  score: number = 0;
  flag: "none" | "exact" | "lower" | "upper" = "none";
  bestMove: {
    pieceId: string;
    targetKey: string;
    type: "move" | "attack";
    rps?: RPSResult;
  } | null = null;
  age: number = 0;
}

// Transposition Table with fixed-size array (power of 2 for fast modulo)
const TT_SIZE = 1 << 18; // 262,144 entries (~2MB)
export const tt: TTEntry[] = new Array(TT_SIZE);
for (let i = 0; i < TT_SIZE; i++) tt[i] = new TTEntry();

let ttAge = 0;
export let ttHits = 0;
export let ttStores = 0;
export let ttCollisions = 0;

// Compute full Zobrist hash from game state
export function computeZobristHash(game: IGame): bigint {
  let hash = 0n;
  const pieces = game.getAlivePieces
    ? game.getAlivePieces()
    : game.pieces.filter((p) => p.alive);

  for (const piece of pieces) {
    const ptIdx = ZOBRIST_PIECE_TYPES.indexOf(piece.type);
    const facIdx = ZOBRIST_FACTIONS.indexOf(piece.faction);
    const sqIdx = SQUARE_TO_INDEX.get(piece.pos.key);
    if (ptIdx >= 0 && facIdx >= 0 && sqIdx !== undefined) {
      const pieceKeys = ZOBRIST_PIECE_KEYS[ptIdx] as bigint[][];
      const factionKeys = pieceKeys[facIdx] as bigint[];
      // sqIdx is validated non-undefined by the if condition above
      hash ^= factionKeys[sqIdx] as bigint;
    }
  }

  // Side to move
  const sideIdx =
    game.currentFactionIdx !== undefined
      ? game.currentFactionIdx
      : game.currentFaction
        ? ZOBRIST_FACTIONS.indexOf(game.currentFaction)
        : 0;
  if (sideIdx >= 0) {
    hash ^= ZOBRIST_SIDE_KEYS[sideIdx]!;
  }

  // Eliminated factions
  for (const fac of ZOBRIST_FACTIONS) {
    if (game.eliminatedFactions.has(fac)) {
      hash ^= ZOBRIST_ELIMINATED_KEYS[ZOBRIST_FACTIONS.indexOf(fac)]!;
    }
  }

  // RPS enabled
  if (game.rpsEnabled) hash ^= ZOBRIST_RPS_KEY;

  return hash;
}

// Incremental hash update (for make/unmake move)
export function updateZobristHash(
  hash: bigint,
  piece: Piece,
  fromKey: string,
  toKey: string,
  capturedPiece: Piece | null,
  eliminatedFaction: Faction | null,
  isPromotion: boolean,
  oldSideIdx: number,
  newSideIdx: number,
): bigint {
  const ptIdx = ZOBRIST_PIECE_TYPES.indexOf(piece.type);
  const facIdx = ZOBRIST_FACTIONS.indexOf(piece.faction);

  // Remove piece from source square
  const fromIdx = SQUARE_TO_INDEX.get(fromKey);
  if (fromIdx !== undefined) {
    hash ^= getZobristPieceKeyAt(ptIdx, facIdx, fromIdx);
  }

  // Add piece to destination square (handle promotion)
  const finalType = isPromotion ? "queen" : piece.type;
  const finalPtIdx = ZOBRIST_PIECE_TYPES.indexOf(finalType);
  const toIdx = SQUARE_TO_INDEX.get(toKey);
  if (toIdx !== undefined) {
    hash ^= getZobristPieceKeyAt(finalPtIdx, facIdx, toIdx);
  }

  // Remove captured piece
  if (capturedPiece) {
    const capPtIdx = ZOBRIST_PIECE_TYPES.indexOf(capturedPiece.type);
    const capFacIdx = ZOBRIST_FACTIONS.indexOf(capturedPiece.faction);
    if (capPtIdx >= 0 && capFacIdx >= 0 && toIdx !== undefined) {
      hash ^= getZobristPieceKeyAt(capPtIdx, capFacIdx, toIdx);
    }
    // If king captured -> faction eliminated
    if (capturedPiece.type === "king" && eliminatedFaction) {
      hash ^=
        ZOBRIST_ELIMINATED_KEYS[ZOBRIST_FACTIONS.indexOf(eliminatedFaction)]!;
    }
  }

  // Side to move changes
  if (oldSideIdx >= 0) hash ^= ZOBRIST_SIDE_KEYS[oldSideIdx]!;
  if (newSideIdx >= 0) hash ^= ZOBRIST_SIDE_KEYS[newSideIdx]!;

  return hash;
}

// TT Probe result types
interface TTProbeHit {
  score: number;
  action: {
    pieceId: string;
    targetKey: string;
    type: "move" | "attack";
    rps?: RPSResult;
  } | null;
  flag: "exact" | "lower" | "upper";
}

interface TTProbeBounds {
  alpha: number;
  beta: number;
  bestMove: {
    pieceId: string;
    targetKey: string;
    type: "move" | "attack";
    rps?: RPSResult;
  } | null;
}

type TTProbeResult = TTProbeHit | TTProbeBounds | null;

function isTTProbeHit(result: TTProbeResult): result is TTProbeHit {
  return result !== null && "flag" in result;
}

function isTTProbeBounds(result: TTProbeResult): result is TTProbeBounds {
  return result !== null && "alpha" in result;
}

// TT Probe
export function ttProbe(
  hash: bigint,
  depth: number,
  alpha: number,
  beta: number,
): TTProbeResult {
  const idx = Number(hash & BigInt(TT_SIZE - 1));
  const entry = tt[idx]!;
  // entry is always initialized (TTEntry constructor called for all slots)

  if (entry.key !== hash) return null;

  ttHits++;

  if (entry.depth >= depth) {
    if (entry.flag === "exact")
      return { score: entry.score, action: entry.bestMove, flag: "exact" };
    if (entry.flag === "lower") alpha = Math.max(alpha, entry.score);
    if (entry.flag === "upper") beta = Math.min(beta, entry.score);
    if (alpha >= beta)
      return {
        score: entry.score,
        action: entry.bestMove,
        flag: entry.flag as "lower" | "upper",
      };
  }

  return { alpha, beta, bestMove: entry.bestMove }; // Return bestMove for move ordering
}

// TT Store
export function ttStore(
  hash: bigint,
  depth: number,
  score: number,
  flag: "exact" | "lower" | "upper" | "none",
  bestMove: {
    pieceId: string;
    targetKey: string;
    type: "move" | "attack";
    rps?: RPSResult;
  } | null = null,
): void {
  const idx = Number(hash & BigInt(TT_SIZE - 1));
  const entry = tt[idx]!;

  // Always replace if empty or same position (key match)
  // Otherwise: depth-preferred replacement
  const shouldReplace =
    entry.key === 0n ||
    entry.key === hash ||
    entry.depth <= depth ||
    entry.age < ttAge - 4; // Age-based replacement

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

// New search iteration - increment age
export function ttNewSearch(): void {
  ttAge++;
  // Optional: clear old entries every N searches to prevent stale data
  if (ttAge % 32 === 0) {
    for (let i = 0; i < TT_SIZE; i++) {
      if (tt[i]!.age < ttAge - 8) {
        tt[i]!.key = 0n;
      }
    }
  }
}

// Clear entire TT
export function ttClear(): void {
  for (let i = 0; i < TT_SIZE; i++) {
    tt[i]!.key = 0n;
  }
  ttAge = 0;
  ttHits = 0;
  ttStores = 0;
  ttCollisions = 0;
}

// Get TT stats for debugging
export function ttStats(): {
  size: number;
  used: number;
  loadFactor: string;
  hits: number;
  stores: number;
  collisions: number;
  hitRate: string;
} {
  let used = 0;
  for (let i = 0; i < TT_SIZE; i++) if (tt[i]!.key !== 0n) used++;
  return {
    size: TT_SIZE,
    used,
    loadFactor: ((used / TT_SIZE) * 100).toFixed(1) + "%",
    hits: ttHits,
    stores: ttStores,
    collisions: ttCollisions,
    hitRate: ttStores > 0 ? ((ttHits / ttStores) * 100).toFixed(1) + "%" : "0%",
  };
}

// Backward compatibility alias
export const boardHash = computeZobristHash;

// ─── Piece-Square Tables ────────────────────────────────────────

export function hexDistFromCenter(hex: Hex): number {
  return Math.abs(hex.q) + Math.abs(hex.r - 2) + Math.abs(-hex.q - hex.r + 2);
}

export function buildPST(
  calcFn: (hex: Hex, dist: number) => number,
): Map<string, number> {
  const table = new Map<string, number>();
  for (let q = -7; q <= 2; q++) {
    for (let r = -2; r <= 7; r++) {
      const hex = new Hex(q, r);
      table.set(`${q},${r}`, calcFn(hex, hexDistFromCenter(hex)));
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

export function getPSTValue(piece: Piece): number {
  const table: Record<PieceType, Map<string, number>> = {
    king: KING_PST,
    queen: QUEEN_PST,
    rook: ROOK_PST,
    bishop: BISHOP_PST,
    knight: KNIGHT_PST,
    pawn: PAWN_PST,
  };
  return table[piece.type]?.get(piece.pos.key) ?? 0;
}

// ─── Pawn Structure Evaluation ────────────────────────────────

export function evaluatePawnStructure(
  pieces: Piece[],
  faction: Faction,
): number {
  const pawns = pieces.filter((p) => p.type === "pawn");
  const myPawns = pawns.filter((p) => p.faction === faction);
  const enemyPawns = pawns.filter((p) => p.faction !== faction);
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
  for (const p of myPawns)
    myColumnCounts[p.pos.q] = (myColumnCounts[p.pos.q] ?? 0) + 1;
  for (const p of enemyPawns)
    enemyColumnCounts[p.pos.q] = (enemyColumnCounts[p.pos.q] ?? 0) + 1;
  for (const q in myColumnCounts) {
    const count = myColumnCounts[q] as number;
    if (count > 1) score -= (count - 1) * 10;
  }
  for (const q in enemyColumnCounts) {
    const count = enemyColumnCounts[q] as number;
    if (count > 1) score += (count - 1) * 10;
  }

  for (const p of myPawns) {
    const hasNeighbor = myPawns.some(
      (other) => other !== p && Math.abs(other.pos.q - p.pos.q) <= 1,
    );
    if (!hasNeighbor) score -= 8;
  }
  for (const p of enemyPawns) {
    const hasNeighbor = enemyPawns.some(
      (other) => other !== p && Math.abs(other.pos.q - p.pos.q) <= 1,
    );
    if (!hasNeighbor) score += 8;
  }

  for (const p of myPawns) {
    const hasConnected = myPawns.some(
      (other) =>
        other !== p &&
        Math.abs(other.pos.q - p.pos.q) <= 1 &&
        Math.abs(other.pos.r - p.pos.r) <= 1,
    );
    if (hasConnected) score += 5;
  }
  for (const p of enemyPawns) {
    const hasConnected = enemyPawns.some(
      (other) =>
        other !== p &&
        Math.abs(other.pos.q - p.pos.q) <= 1 &&
        Math.abs(other.pos.r - p.pos.r) <= 1,
    );
    if (hasConnected) score -= 5;
  }

  return score;
}

// ─── Endgame Evaluation ──────────────────────────────────────

export function evaluateEndgame(
  game: IGame,
  pieces: Piece[],
  faction: Faction,
): number {
  const totalPieces = pieces.length;
  const aliveFactions = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE].filter(
    (f) => !game.eliminatedFactions.has(f),
  );
  const isEndgame = totalPieces <= 20;
  const isLateEndgame = totalPieces <= 10;

  if (!isEndgame && aliveFactions.length === 3) return 0;

  let score = 0;
  const myPieces = pieces.filter((p) => p.faction === faction);
  const myKing = myPieces.find((p) => p.type === "king");
  const myPawns = myPieces.filter((p) => p.type === "pawn");

  const enemyFactions = aliveFactions.filter((f) => f !== faction);

  // 1. KING ACTIVITY
  if (myKing) {
    const kingDistFromCenter = Math.max(
      Math.abs(myKing.pos.q),
      Math.abs(myKing.pos.r),
      Math.abs(-myKing.pos.q - myKing.pos.r),
    );

    if (isLateEndgame) {
      score -= kingDistFromCenter * 8;
    } else if (isEndgame) {
      score -= kingDistFromCenter * 3;
    } else if (aliveFactions.length === 2) {
      score -= kingDistFromCenter * 5;
    }

    const myMaterial = myPieces.reduce(
      (sum, p) => sum + (PIECE_STRENGTH[p.type] ?? 0),
      0,
    );
    const enemyPieces = pieces.filter((p) => p.faction !== faction);
    const enemyMaterial = enemyPieces.reduce(
      (sum, p) => sum + (PIECE_STRENGTH[p.type] ?? 0),
      0,
    );

    if (myMaterial > enemyMaterial * 1.5) {
      // Winning: king safety less important
    }
  }

  // 2. PAWN PROMOTION PRESSURE
  for (const pawn of myPawns) {
    if (pawn.pos.r <= 0) score += isLateEndgame ? 200 : 100;
    else if (pawn.pos.r === 1) score += isLateEndgame ? 80 : 40;
    else if (pawn.pos.r === 2) score += isLateEndgame ? 40 : 20;
    else if (pawn.pos.r <= 4) score += 10;

    const blockingPawns = pieces.filter(
      (p) =>
        p.type === "pawn" &&
        p.faction !== faction &&
        Math.abs(p.pos.q - pawn.pos.q) <= 1 &&
        (faction === FACTION.FIRE
          ? p.pos.r < pawn.pos.r
          : faction === FACTION.WATER
            ? p.pos.r > pawn.pos.r || p.pos.q < pawn.pos.q
            : faction === FACTION.NATURE
              ? p.pos.r > pawn.pos.r || p.pos.q > pawn.pos.q
              : false),
    );
    if (blockingPawns.length === 0) score += isLateEndgame ? 60 : 30;
  }

  // 3. 2-vs-1 DYNAMICS
  if (aliveFactions.length === 2) {
    const otherFaction = enemyFactions[0];
    if (!otherFaction) return score;

    const rps = getRPSResult(faction, otherFaction);
    if (rps === "advantage") score += 150;
    else if (rps === "disadvantage") score -= 200;

    if (rps === "advantage") {
      const myKing = myPieces.find((p) => p.type === "king");
      if (myKing) {
        const enemyKing = pieces.find(
          (p) => p.faction === otherFaction && p.type === "king",
        );
        if (enemyKing) {
          const kingDist = myKing.pos.distance(enemyKing.pos);
          if (kingDist <= 3) score += 30;
        }
      }
    }
  }

  // 4. PIECE COORDINATION
  if (pieces.length <= 20) {
    for (const piece of pieces.filter((p) => p.faction === faction)) {
      if (piece.type === "rook" || piece.type === "queen") {
        const supportingPawns = pieces.filter(
          (p) =>
            p.faction === faction &&
            p.type === "pawn" &&
            (p.pos.q === piece.pos.q ||
              p.pos.r === piece.pos.r ||
              (Math.abs(p.pos.q - piece.pos.q) <= 1 &&
                Math.abs(p.pos.r - piece.pos.r) <= 1)),
        );
        score += supportingPawns.length * 15;
      }

      if (piece.type === "knight") {
        const myKing = pieces.find(
          (p) => p.faction === faction && p.type === "king",
        );
        if (myKing && piece.pos.distance(myKing.pos) <= 2) score += 20;
      }
    }
  }

  // 5. ELIMINATION PROXIMITY
  for (const ef of enemyFactions) {
    const enemyPieces = pieces.filter((p) => p.faction === ef);
    const enemyKing = enemyPieces.find((p) => p.type === "king");

    if (enemyPieces.length <= 3) {
      score += (4 - enemyPieces.length) * 100;

      if (enemyKing) {
        for (const attacker of pieces.filter((p) => p.faction === faction)) {
          const { attacks } = getValidMoves(
            attacker,
            game.boardCells as Map<
              string,
              { hex: Hex; zone: string; faction: Faction | null }
            >,
            game._occupiedMap!,
          );
          if (attacks.some((a) => a.equals(enemyKing.pos))) score += 500;
        }
      }
    }
  }

  // 6. ZUGZWANG / OPPOSITION
  if (aliveFactions.length === 2 && pieces.length <= 6) {
    const myKing = pieces.find(
      (p) => p.faction === faction && p.type === "king",
    );
    const otherFaction = aliveFactions.find((f) => f !== faction);
    const enemyKing = pieces.find(
      (p) => p.faction === otherFaction && p.type === "king",
    );

    if (myKing && enemyKing) {
      const dist = myKing.pos.distance(enemyKing.pos);
      if (dist % 2 === 1) score += 25;
      else score -= 15;
    }
  }

  return score;
}

// ─── Heuristic Evaluation ──────────────────────────────────────

export function evaluateBoard(game: IGame, faction: Faction): number {
  const W = getPersonalityWeights();
  const aggression = getPersonalityAggression();

  const pieces = game.getAlivePieces
    ? game.getAlivePieces()
    : game.pieces.filter((p) => p.alive);
  let score = 0;

  // 1. Material balance (RPS-aware)
  for (const p of pieces) {
    const val = getMaterialValue(p, faction) * 10;
    score += (p.faction === faction ? val : -val) * W.material;
  }

  // 2. Positional bonus: PST + mobility
  const myPieces = pieces.filter((p) => p.faction === faction);
  for (const p of myPieces) {
    score += getPSTValue(p) * W.positional;
    const { moves, attacks } = getValidMoves(
      p,
      game.boardCells as Map<
        string,
        { hex: Hex; zone: string; faction: Faction | null }
      >,
      game._occupiedMap as Map<string, Piece>,
    );
    const mobility = moves.length + attacks.length;
    const mobBonus: Record<PieceType, number> = {
      queen: 0.3,
      rook: 0.2,
      bishop: 0.2,
      knight: 0.3,
      pawn: 0.1,
      king: 0,
    };
    score += mobility * (mobBonus[p.type] ?? 0.1) * W.mobility;
  }

  // Enemy pieces PST penalty
  for (const p of pieces) {
    if (p.faction === faction) continue;
    score -= getPSTValue(p) * 0.8 * W.positional;
  }

  // 3. King safety
  const myKing = myPieces.find((p) => p.type === "king");
  if (myKing) {
    let kingThreats = 0;
    for (const enemy of pieces) {
      if (enemy.faction === faction || !enemy.alive) continue;
      const { attacks } = getValidMoves(
        enemy,
        game.boardCells as Map<
          string,
          { hex: Hex; zone: string; faction: Faction | null }
        >,
        game._occupiedMap as Map<string, Piece>,
      );
      if (attacks.some((a) => a.equals(myKing.pos))) kingThreats++;
    }
    score -= kingThreats * 15 * W.kingSafety;
    const kingDist = Math.max(
      Math.abs(myKing.pos.q),
      Math.abs(myKing.pos.r),
      Math.abs(-myKing.pos.q - myKing.pos.r),
    );
    if (kingDist >= 6) score += 8 * W.kingSafety;
  }

  // 4. King threats
  const enemyFactions = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE].filter(
    (f) => f !== faction,
  );
  for (const ef of enemyFactions) {
    if (game.eliminatedFactions.has(ef)) {
      score += 200 * W.kingThreats;
      continue;
    }
    const eKing = pieces.find((p) => p.faction === ef && p.type === "king");
    if (eKing) {
      for (const attacker of pieces.filter((p) => p.faction === faction)) {
        const { attacks } = getValidMoves(
          attacker,
          game.boardCells as Map<
            string,
            { hex: Hex; zone: string; faction: Faction | null }
          >,
          game._occupiedMap as Map<string, Piece>,
        );
        if (attacks.some((a) => a.equals(eKing.pos)))
          score += 10 * W.kingThreats * (1 + aggression);
      }
    }
  }

  // 5. RPS advantage in endgame
  const aliveEnemies = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE].filter(
    (f) => !game.eliminatedFactions.has(f) && f !== faction,
  );
  if (aliveEnemies.length === 1) {
    const rps = getRPSResult(faction, aliveEnemies[0]!);
    if (rps === "advantage") score += 20 * W.endgame;
  }

  // 6. Pawn structure
  score += evaluatePawnStructure(pieces, faction) * W.pawnStructure;

  // 7. Endgame evaluation
  score +=
    evaluateEndgame(
      game,
      pieces.filter((p) => p.alive),
      faction,
    ) * W.endgame;

  return score;
}

// ─── Check Escape Detection ────────────────────────────────────

/**
 * Determines if a move resolves check for the given faction.
 * Returns true if the move is a check escape (king move, capture attacker, or block).
 */
export function isCheckEscape(
  game: IGame,
  faction: Faction,
  action: AIAction,
): boolean {
  // Only relevant if the faction is currently in check
  if (!isKingdomCheck(game, faction)) return false;

  // Simulate the move and check if the king is still in check
  const undo = simulateMove(game, action.piece, action.target);
  const stillInCheck = isKingdomCheck(game, faction);
  undoMove(game, undo);

  return !stillInCheck;
}

/**
 * Normalizes a hex vector to a unit step direction.
 * Returns a Hex representing one of the 6 axial directions.
 */
function normalizeDirection(hex: Hex): Hex | null {
  if (hex.q === 0 && hex.r === 0) return null;

  const steps = [
    new Hex(1, 0), // +q
    new Hex(0, 1), // +r
    new Hex(-1, 1), // -q+r
    new Hex(-1, 0), // -q
    new Hex(0, -1), // -r
    new Hex(1, -1), // +q-r
  ];

  // Check if the vector is aligned with any of the 6 directions
  // by checking if all steps are multiples of the same unit step
  for (const step of steps) {
    // Check if hex is a positive multiple of this step
    const kq = step.q !== 0 ? hex.q / step.q : null;
    const kr = step.r !== 0 ? hex.r / step.r : null;

    // Both non-null and equal (and positive integer)
    if (
      kq !== null &&
      kr !== null &&
      kq === kr &&
      Number.isInteger(kq) &&
      kq > 0
    ) {
      return step;
    }
    // Handle cases where one component is zero
    if (
      kq !== null &&
      kr === null &&
      step.r === 0 &&
      hex.r === 0 &&
      Number.isInteger(kq) &&
      kq > 0
    ) {
      return step;
    }
    if (
      kr !== null &&
      kq === null &&
      step.q === 0 &&
      hex.q === 0 &&
      Number.isInteger(kr) &&
      kr > 0
    ) {
      return step;
    }
  }

  return null;
}

/**
 * Classifies a move's check-escape type for move ordering priority.
 * Returns: 3 = captures checking piece, 2 = king moves, 1 = blocks, 0 = not check escape
 */
export function getCheckEscapeType(
  game: IGame,
  faction: Faction,
  action: AIAction,
): number {
  if (!isKingdomCheck(game, faction)) return 0;

  // Find the checking piece(s) - enemy pieces attacking our king
  const king = game.pieces.find(
    (p) => p.faction === faction && p.type === "king" && p.alive,
  );
  if (!king) return 0;

  const checkers = game.pieces.filter((p) => {
    if (p.faction === faction || !p.alive) return false;
    const { attacks } = getValidMoves(
      p,
      game.boardCells as Map<
        string,
        { hex: Hex; zone: string; faction: Faction | null }
      >,
      game._occupiedMap as Map<string, Piece>,
    );
    return attacks.some((a) => a.equals(king.pos));
  });

  // If capturing a checking piece
  if (action.type === "attack") {
    const defender = game.pieces.find(
      (p) => p.alive && p.pos.equals(action.target),
    );
    if (defender && checkers.some((c) => c.id === defender.id)) {
      return 3; // Capturing the checking piece - highest priority
    }
  }

  // If king moves
  if (action.piece.type === "king") {
    return 2; // King move - high priority
  }

  // Check if blocking a sliding attack (bishop, rook, queen)
  // The block must be on the line between king and checker, closer than checker
  for (const checker of checkers) {
    if (
      checker.type === "bishop" ||
      checker.type === "rook" ||
      checker.type === "queen"
    ) {
      const kingToChecker = checker.pos.subtract(king.pos);
      const kingToTarget = action.target.subtract(king.pos);

      // Check if they're in the same direction (king, target, checker aligned)
      const dir = normalizeDirection(kingToChecker);
      const targetDir = normalizeDirection(kingToTarget);

      if (dir && targetDir && dir.equals(targetDir)) {
        // Target must be between king and checker (closer than checker)
        const checkerDist = king.pos.distance(checker.pos);
        const targetDist = king.pos.distance(action.target);
        if (targetDist < checkerDist && targetDist > 0) {
          return 1; // Blocking move
        }
      }
    }
  }

  return 0;
}

// ─── Movement Generation ────────────────────────────────────────

export function getAllActions(game: IGame, faction: Faction): AIAction[] {
  const pieces = game.pieces.filter((p) => p.faction === faction && p.alive);
  const actions: AIAction[] = [];

  for (const piece of pieces) {
    const { moves, attacks } = getLegalMoves(game, piece);
    for (const target of attacks) {
      const defender = game.pieces.find((p) => p.alive && p.pos.equals(target));
      if (!defender) continue;
      const rps = game.rpsEnabled
        ? getRPSResult(faction, defender.faction)
        : "advantage";
      actions.push({ piece, target, type: "attack", rps });
    }
    for (const target of moves) {
      actions.push({ piece, target, type: "move" });
    }
  }

  actions.sort((a, b) => {
    // PRIMARY: Check escape moves (highest priority when in check)
    const aCheckEscape = getCheckEscapeType(game, faction, a);
    const bCheckEscape = getCheckEscapeType(game, faction, b);
    if (aCheckEscape !== bCheckEscape) return bCheckEscape - aCheckEscape;

    // Use quickSee for capture ordering (MVV-LVA + RPS aware)
    const aSee = a.type === "attack" ? quickSee(game, a) : 0;
    const bSee = b.type === "attack" ? quickSee(game, b) : 0;
    if (aSee !== bSee) return bSee - aSee;
    // Fallback: prioritize attacks over moves
    if (a.type !== b.type) return a.type === "attack" ? -1 : 1;
    return 0;
  });

  return actions;
}

export function getLegalMoves(
  game: IGame,
  piece: Piece,
): { moves: Hex[]; attacks: Hex[] } {
  const { moves, attacks } = getValidMoves(
    piece,
    game.boardCells! as Map<
      string,
      { hex: Hex; zone: string; faction: Faction | null }
    >,
    game._occupiedMap! as Map<string, Piece>,
  );
  const legalMoves: Hex[] = [];
  const legalAttacks: Hex[] = [];
  for (const target of moves) {
    if (legalMoveCheck(game, piece, target, piece.faction))
      legalMoves.push(target);
  }
  for (const target of attacks) {
    if (legalMoveCheck(game, piece, target, piece.faction))
      legalAttacks.push(target);
  }
  return { moves: legalMoves, attacks: legalAttacks };
}

export function legalMoveCheck(
  game: IGame,
  piece: Piece,
  target: Hex,
  faction: Faction,
): boolean {
  const savedIdx = game.currentFactionIdx;
  const undo = simulateMove(game, piece, target);
  game.currentFactionIdx = undo.prevFactionIdx;
  rebuildOccupiedMap(game);
  const inCheck = isKingdomCheck(game, faction);
  game.currentFactionIdx = savedIdx;
  rebuildOccupiedMap(game);
  undoMove(game, undo);
  return !inCheck;
}

// ─── Game Simulation ───────────────────────────────────────────

export function rebuildOccupiedMap(game: IGame): void {
  game._occupiedMap = new Map();
  for (const p of game.pieces) {
    if (p.alive) game._occupiedMap.set(p.pos.key, p);
  }
}

export function simulateMove(
  game: IGame,
  piece: Piece,
  target: Hex,
): AISnapshot {
  const undo: AISnapshot = {
    piece,
    from: new Hex(piece.pos.q, piece.pos.r),
    pieceHasMoved: piece.hasMoved,
    wasAttack: false,
    defender: undefined,
    defenderWasKilled: false,
    attackerDied: false,
    eliminatedFaction: undefined,
    prevFactionIdx: game.currentFactionIdx,
    prevZobristHash:
      game._zobristHash !== undefined
        ? game._zobristHash
        : computeZobristHash(game),
  };

  const defender = game._occupiedMap!.get(target.key);

  if (defender) {
    undo.wasAttack = true;
    undo.defender = defender;

    const rps = game.rpsEnabled
      ? getRPSResult(piece.faction, defender.faction)
      : "advantage";

    if (rps === "advantage" || rps === "neutral") {
      defender.alive = false;
      undo.defenderWasKilled = true;
      piece.pos = target;
      piece.hasMoved = true;

      if (defender.type === "king") {
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

  const isPromotion = piece.type === "pawn" && piece.pos.r <= 0;
  if (isPromotion) {
    undo.promotion = piece.type;
    piece.type = "queen";
    piece.symbol = "Q";
  }

  const oldSideIdx = game.currentFactionIdx;
  const factions: Faction[] = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];
  let nextIdx = (game.currentFactionIdx + 1) % 3;
  let nextFaction = factions[nextIdx]!;
  while (game.eliminatedFactions.has(nextFaction)) {
    nextIdx = (nextIdx + 1) % 3;
    nextFaction = factions[nextIdx]!;
  }
  game.currentFactionIdx = nextIdx;
  game.currentFaction = nextFaction;

  const prevHash =
    undo.prevZobristHash ?? game._zobristHash ?? computeZobristHash(game);
  const eliminatedFaction = undo.eliminatedFaction ?? null;

  // Incremental Zobrist hash update
  game._zobristHash = updateZobristHash(
    prevHash,
    piece,
    undo.from.key,
    target.key,
    (defender ?? null) as Piece | null,
    eliminatedFaction,
    isPromotion,
    oldSideIdx,
    game.currentFactionIdx,
  );

  return undo;
}

export function undoMove(game: IGame, undo: AISnapshot): void {
  const {
    piece,
    from,
    pieceHasMoved,
    wasAttack,
    defender,
    defenderWasKilled,
    attackerDied,
    eliminatedFaction,
    prevFactionIdx,
    prevZobristHash,
  } = undo;

  piece.pos = from;
  piece.hasMoved = pieceHasMoved;

  if (wasAttack) {
    if (defenderWasKilled) {
      defender!.alive = true;
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
    piece.symbol =
      piece.faction === "fire" ? "P" : piece.faction === "water" ? "P" : "P";
  }

  game.currentFactionIdx = prevFactionIdx;
  game.currentFaction = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE][
    prevFactionIdx
  ]!;
  rebuildOccupiedMap(game);

  // Restore Zobrist hash (incremental reverse)
  if (prevZobristHash !== undefined) {
    game._zobristHash = prevZobristHash;
  }
}

// ─── Search Algorithms ────────────────────────────────────────

export const killerMoves: Record<string, boolean> = {};
export const historyTable: Record<string, number> = {};

// Futility margins (centipawns) - depth 1, 2, 3 (extend for depths up to 12)
export const FUTILITY_MARGINS = [
  0, 150, 300, 500, 700, 900, 1100, 1300, 1500, 1700, 1900, 2100, 2300,
];
// Razoring margins (centipawns) - depth 1, 2 (extend for depths up to 12)
export const RAZOR_MARGINS = [
  0, 300, 500, 700, 900, 1100, 1300, 1500, 1700, 1900, 2100, 2300, 2500,
];

// ─── Late Move Reductions (LMR) ───────────────────────────────
// Reduce depth for moves later in the move list (less likely to be best)
// Formula: reduction = log2(depth) * log2(moveIndex) / scalingFactor
export const LMR_BASE_REDUCTION = 0.6; // Base reduction factor
export const LMR_MIN_DEPTH = 3; // Minimum depth to apply LMR
export const LMR_MOVE_THRESHOLD = 3; // First N moves get full depth

// ─── Probcut ───────────────────────────────────────────────────
// At high depths, if static eval suggests a move is way above beta,
// do a reduced-depth search to verify before full search
export const PROBCUT_DEPTH = 5; // Minimum depth for probcut
export const PROBCUT_MARGIN = 150; // Centipawns above beta to trigger
export const PROBCUT_REDUCTION = 3; // Depth reduction for probcut search

let searchDeadline = 0;
export let nodesSearched = 0;

/**
 * Alpha-beta minimax search with iterative deepening support
 * @param game - The game state (will be mutated during search)
 * @param depth - Search depth remaining
 * @param alpha - Alpha bound
 * @param beta - Beta bound
 * @param maximizingFaction - Faction we're evaluating from
 * @param currentFaction - Faction to move
 * @param deadline - Optional custom deadline (for pondering)
 */
export function minimax(
  game: IGame,
  depth: number,
  alpha: number,
  beta: number,
  maximizingFaction: Faction,
  currentFaction: Faction,
  deadline: number | null = null,
): SearchResult {
  nodesSearched++;
  const effectiveDeadline = deadline !== null ? deadline : searchDeadline;
  if (nodesSearched % 1000 === 0 && Date.now() > effectiveDeadline) {
    return {
      score: evaluateBoard(game, maximizingFaction),
      action: null,
      timeout: true,
    };
  }

  // Use incremental Zobrist hash if available, otherwise compute
  const hash =
    game._zobristHash !== undefined
      ? game._zobristHash
      : computeZobristHash(game);
  const ttProbeResult = ttProbe(hash, depth, alpha, beta);
  if (ttProbeResult) {
    if (isTTProbeHit(ttProbeResult)) {
      // Exact hit or depth-sufficient bound
      const action = reconstructAction(game, ttProbeResult.action);
      return { score: ttProbeResult.score, action };
    }
    // TT hit but depth not sufficient - use narrowed bounds
    if (isTTProbeBounds(ttProbeResult)) {
      alpha = ttProbeResult.alpha;
      beta = ttProbeResult.beta;
    }
  }

  if (game.state === "game_over") {
    return { score: evaluateBoard(game, maximizingFaction), action: null };
  }

  const actions = getAllActions(game, currentFaction);
  if (actions.length === 0) {
    return { score: evaluateBoard(game, maximizingFaction), action: null };
  }

  if (depth <= 0) {
    return quiesce(game, alpha, beta, maximizingFaction, currentFaction);
  }

  // ─── Null-Move Pruning (R=2) ───────────────────────────────────────
  // Only when: depth >= 3, not in check, current faction has > 1 piece
  const inCheck = isKingdomCheck(game, currentFaction);
  const myPieces = game.pieces.filter(
    (p) => p.faction === currentFaction && p.alive,
  );
  const canNullMove = depth >= 3 && !inCheck && myPieces.length > 1;

  if (canNullMove) {
    // Save current faction index, switch to next faction (pass turn)
    const savedFactionIdx = game.currentFactionIdx;
    const factions: Faction[] = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];
    let nextIdx = (game.currentFactionIdx + 1) % 3;
    let nextFaction = factions[nextIdx]!;
    while (game.eliminatedFactions.has(nextFaction)) {
      nextIdx = (nextIdx + 1) % 3;
      nextFaction = factions[nextIdx]!;
    }
    game.currentFactionIdx = nextIdx;
    game.currentFaction = nextFaction;
    rebuildOccupiedMap(game);

    const R = 2; // Null-move reduction
    const nullResult = minimax(
      game,
      depth - 1 - R,
      -beta,
      -beta + 1,
      maximizingFaction,
      game.currentFaction,
      effectiveDeadline,
    );

    // Restore
    game.currentFactionIdx = savedFactionIdx;
    game.currentFaction = factions[savedFactionIdx]!;
    rebuildOccupiedMap(game);

    if (!nullResult.timeout && -nullResult.score >= beta) {
      return { score: beta, action: null }; // Null-move refutation: position is too good
    }
  }

  // Get TT best move for move ordering (from probe result)
  const ttBestMove =
    ttProbeResult && ttProbeResult.bestMove ? ttProbeResult.bestMove : null;

  let bestScore = -Infinity;
  let bestAction: AIAction | null = null;

  actions.sort((a, b) => {
    // Primary: TT move (highest priority)
    if (ttBestMove) {
      const aIsTT =
        a.piece.id === ttBestMove.pieceId &&
        a.target.key === ttBestMove.targetKey &&
        a.type === ttBestMove.type;
      const bIsTT =
        b.piece.id === ttBestMove.pieceId &&
        b.target.key === ttBestMove.targetKey &&
        b.type === ttBestMove.type;
      if (aIsTT !== bIsTT) return aIsTT ? -1 : 1;
    }
    // Secondary: Check escape moves (high priority when in check)
    const inCheck = isKingdomCheck(game, currentFaction);
    if (inCheck) {
      const aCheckEscape = getCheckEscapeType(game, currentFaction, a);
      const bCheckEscape = getCheckEscapeType(game, currentFaction, b);
      if (aCheckEscape !== bCheckEscape) return bCheckEscape - aCheckEscape;
    }
    // Tertiary: quickSee for captures (MVV-LVA + RPS aware)
    const aSee = a.type === "attack" ? quickSee(game, a) : 0;
    const bSee = b.type === "attack" ? quickSee(game, b) : 0;
    if (aSee !== bSee) return bSee - aSee;
    // Quaternary: Killer moves
    const aKiller = killerMoves[`${depth},${a.piece.id},${a.target.key}`]
      ? 10000
      : 0;
    const bKiller = killerMoves[`${depth},${b.piece.id},${b.target.key}`]
      ? 10000
      : 0;
    // Quinary: History heuristic
    const aHistory = historyTable[`${a.piece.id},${a.target.key}`] || 0;
    const bHistory = historyTable[`${b.piece.id},${b.target.key}`] || 0;
    return bKiller + bHistory - (aKiller + aHistory);
  });

  // Convert to array and track move index for LMR
  const actionsArray = [...actions];

  for (let moveIndex = 0; moveIndex < actionsArray.length; moveIndex++) {
    const action = actionsArray[moveIndex];
    // actionsArray has no holes (created from getAllActions result)
    if (!action) continue;
    const isQuiet = action.type !== "attack";

    // ─── Futility Pruning (depth <= 3, quiet moves only) ─────────
    if (isQuiet && depth <= 3) {
      const staticScore = evaluateBoard(game, maximizingFaction);
      const futilityMargin = FUTILITY_MARGINS[depth] ?? 0;
      if (staticScore + futilityMargin <= alpha) {
        continue; // Prune: even with margin, can't raise score above alpha
      }
    }

    // ─── Razoring (depth <= 2, quiet moves far below beta) ───────
    let razorReduction = 0;
    if (isQuiet && depth <= 2) {
      const staticScore = evaluateBoard(game, maximizingFaction);
      const razorMargin = RAZOR_MARGINS[depth] ?? 0;
      if (staticScore + razorMargin <= alpha) {
        razorReduction = 1; // Reduce depth by 1 instead of pruning entirely
      }
    }

    // ─── Late Move Reductions (LMR) ────────────────────────────────
    // Reduce depth for later moves (less likely to be best)
    // Skip LMR for: first few moves, captures, depth too low
    let lmrReduction = 0;
    if (depth >= LMR_MIN_DEPTH && moveIndex >= LMR_MOVE_THRESHOLD && isQuiet) {
      const lmrFactor =
        Math.log2(depth) * Math.log2(moveIndex + 1) * LMR_BASE_REDUCTION;
      lmrReduction = Math.min(Math.floor(lmrFactor), depth - 1); // Cap at depth-1
    }

    // ─── Probcut ───────────────────────────────────────────────────
    // If static eval suggests score >> beta, do a reduced-depth probe search
    let probcutScore: number | null = null;
    if (depth >= PROBCUT_DEPTH && !isQuiet && !inCheck) {
      const staticScore = evaluateBoard(game, maximizingFaction);
      if (staticScore >= beta + PROBCUT_MARGIN) {
        // Probe with reduced depth
        const probeDepth = depth - PROBCUT_REDUCTION;
        const undo = simulateMove(game, action.piece, action.target);
        const nextFaction = game.currentFaction;
        const probeResult = minimax(
          game,
          probeDepth,
          beta - 1,
          beta,
          maximizingFaction,
          nextFaction,
          effectiveDeadline,
        );
        undoMove(game, undo);

        if (!probeResult.timeout && probeResult.score >= beta) {
          // Probcut confirmed: this move beats beta, return beta immediately
          probcutScore = beta;
        }
      }
    }

    // If probcut didn't trigger or wasn't applicable, do normal search
    let searchDepth = depth - 1 - razorReduction - lmrReduction;
    let result: SearchResult;

    if (probcutScore !== null) {
      result = { score: probcutScore };
    } else {
      const undo = simulateMove(game, action.piece, action.target);
      const nextFaction = game.currentFaction;
      result = minimax(
        game,
        searchDepth,
        alpha,
        beta,
        maximizingFaction,
        nextFaction,
        effectiveDeadline,
      );
      undoMove(game, undo);
    }

    // LMR re-search: if reduced search beats alpha, re-search at full depth
    // (Only if LMR was applied and we didn't already hit beta)
    if (
      lmrReduction > 0 &&
      !result.timeout &&
      result.score > alpha &&
      result.score < beta
    ) {
      const undo = simulateMove(game, action.piece, action.target);
      const nextFaction = game.currentFaction;
      const fullDepthResult = minimax(
        game,
        depth - 1 - razorReduction,
        alpha,
        beta,
        maximizingFaction,
        nextFaction,
        effectiveDeadline,
      );
      undoMove(game, undo);
      if (!fullDepthResult.timeout) {
        result = fullDepthResult;
      }
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
      historyTable[`${action.piece.id},${action.target.key}`] =
        (historyTable[`${action.piece.id},${action.target.key}`] || 0) +
        depth * depth;
      break;
    }
  }

  const flag =
    bestScore <= alpha ? "upper" : bestScore >= beta ? "lower" : "exact";
  ttStore(
    hash,
    depth,
    bestScore,
    flag,
    bestAction
      ? {
          pieceId: bestAction.piece.id,
          targetKey: bestAction.target.key,
          type: bestAction.type,
          rps: bestAction.rps,
        }
      : null,
  );

  return { score: bestScore, action: bestAction };
}

export function quiesce(
  game: IGame,
  alpha: number,
  beta: number,
  maximizingFaction: Faction,
  currentFaction: Faction,
  qDepth = 0,
): SearchResult {
  const standPat = evaluateBoard(game, maximizingFaction);
  if (qDepth >= 4) return { score: standPat };

  if (currentFaction === maximizingFaction) {
    if (standPat >= beta) return { score: beta };
    alpha = Math.max(alpha, standPat);

    const attackActions = getAllActions(game, currentFaction).filter(
      (a) => a.type === "attack" && a.rps !== "disadvantage",
    );

    for (const action of attackActions) {
      const undo = simulateMove(game, action.piece, action.target);
      const result = quiesce(
        game,
        alpha,
        beta,
        maximizingFaction,
        game.currentFaction,
        qDepth + 1,
      );
      undoMove(game, undo);

      if (result.score >= beta) return { score: beta };
      alpha = Math.max(alpha, result.score);
    }
    return { score: alpha };
  } else {
    if (standPat <= alpha) return { score: alpha };
    beta = Math.min(beta, standPat);

    const attackActions = getAllActions(game, currentFaction).filter(
      (a) => a.type === "attack" && a.rps !== "disadvantage",
    );

    for (const action of attackActions) {
      const undo = simulateMove(game, action.piece, action.target);
      const result = quiesce(
        game,
        alpha,
        beta,
        maximizingFaction,
        game.currentFaction,
        qDepth + 1,
      );
      undoMove(game, undo);

      if (result.score <= alpha) return { score: alpha };
      beta = Math.min(beta, result.score);
    }
    return { score: beta };
  }
}

export function iterativeDeepening(
  game: IGame,
  faction: Faction,
): AIAction | null {
  const timeBudget = calculateTimeBudget(game);
  searchDeadline = Date.now() + timeBudget;
  nodesSearched = 0;
  // Keep TT across moves - only age out old entries via ttNewSearch()
  Object.keys(killerMoves).forEach((k) => delete killerMoves[k]);
  Object.keys(historyTable).forEach((k) => delete historyTable[k]);

  const actions = getAllActions(game, faction);
  if (actions.length === 0) return null;
  if (actions.length === 1) return actions[0] ?? null;

  let bestResult: SearchResult = { score: -Infinity, action: actions[0] };
  let prevScore = 0;

  const MAX_DEPTH_CAP = 12;
  for (let depth = 1; depth <= MAX_DEPTH_CAP; depth++) {
    ttNewSearch(); // Increment TT age for this depth
    if (Date.now() > searchDeadline - timeBudget * 0.2) break;
    let alpha, beta;
    if (depth <= 1) {
      alpha = -Infinity;
      beta = Infinity;
    } else {
      const windowSize = 50;
      alpha = prevScore - windowSize;
      beta = prevScore + windowSize;
    }

    let result = minimax(
      game,
      depth,
      alpha,
      beta,
      faction,
      faction,
      searchDeadline,
    );

    if (!result.timeout && result.score <= alpha) {
      result = minimax(
        game,
        depth,
        -Infinity,
        beta,
        faction,
        faction,
        searchDeadline,
      );
    } else if (!result.timeout && result.score >= beta) {
      result = minimax(
        game,
        depth,
        alpha,
        Infinity,
        faction,
        faction,
        searchDeadline,
      );
    }

    if (
      !result.timeout &&
      (result.score <= -Infinity + 1 || result.score >= Infinity - 1)
    ) {
      result = minimax(
        game,
        depth,
        -Infinity,
        Infinity,
        faction,
        faction,
        searchDeadline,
      );
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

export function greedyBestMove(
  game: IGame,
  faction: Faction,
  actions: AIAction[],
): AIAction | null {
  let bestActions: AIAction[] = [];
  let bestScore = -Infinity;

  for (const action of actions) {
    let score = 0;
    if (action.type === "attack") {
      const defender = game.pieces.find(
        (p) => p.alive && p.pos.equals(action.target),
      );
      if (!defender) continue;
      if (action.rps === "advantage" || action.rps === "neutral") {
        score = 100 + PIECE_STRENGTH[defender.type] * 10;
        score += 10 - PIECE_STRENGTH[action.piece.type];
        if (defender.type === "king") score += 500;
      } else {
        score = -1000;
      }
    } else {
      // Create a proper pawn piece for PST evaluation
      const pawnPiece: Piece = {
        id: "",
        faction: "fire", // faction doesn't matter for PST, only type and pos
        type: "pawn",
        pos: action.target,
        symbol: "P",
        alive: true,
        hasMoved: false,
      };
      const pv = getPSTValue(pawnPiece);
      const distFromCenter = Math.max(
        Math.abs(action.piece.pos.q),
        Math.abs(action.piece.pos.r),
        Math.abs(-action.piece.pos.q - action.piece.pos.r),
      );
      const distToCenter = Math.max(
        Math.abs(action.target.q),
        Math.abs(action.target.r),
        Math.abs(-action.target.q - action.target.r),
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

// ─── Entry Point ────────────────────────────────────────────────

let _bookBuilt = false;

export function calculateBestMove(
  game: IGame,
  faction: Faction,
): AIAction | null {
  if (!_bookBuilt) {
    buildOpeningBook(game.constructor as new () => IGame);
    _bookBuilt = true;
  }

  rebuildOccupiedMap(game);

  const bookMove = pickBookMove(game);
  if (bookMove) {
    const actions = getAllActions(game, faction);
    const isLegal = actions.some(
      (a) =>
        a.piece.id === bookMove.piece.id && a.target.equals(bookMove.target),
    );
    if (isLegal) {
      return {
        piece: bookMove.piece,
        target: bookMove.target,
        type: "move",
        rps: "neutral",
      };
    }
  }

  const actions = getAllActions(game, faction);
  if (actions.length === 0) return null;

  const nonSuicide = actions.filter(
    (a) => !(a.type === "attack" && a.rps === "disadvantage"),
  );
  const usableActions = nonSuicide.length > 0 ? nonSuicide : actions;
  const pieceCount = game.pieces.filter((p) => p.alive).length;

  if (pieceCount > 24 || usableActions.length > 40) {
    return greedyBestMove(game, faction, usableActions);
  }

  return iterativeDeepening(game, faction);
}

// ─── Pondering ──────────────────────────────────────────────────
// AI thinks during opponent's turn to gain extra search time

// Pondering state (shared between main thread and worker)
interface PonderState {
  active: boolean;
  game: IGame | null;
  opponentFaction: Faction | null;
  maximizingFaction: Faction | null;
  searchDeadline: number;
  timeBudget: number;
  bestMove: AIAction | null;
  bestScore: number;
  currentDepth: number;
  nodesSearched: number;
  aborted: boolean;
  killerMoves: Record<string, boolean>;
  historyTable: Record<string, number>;
}

const ponderState: PonderState = {
  active: false,
  game: null,
  opponentFaction: null,
  maximizingFaction: null,
  searchDeadline: 0,
  timeBudget: 0,
  bestMove: null,
  bestScore: -Infinity,
  currentDepth: 0,
  nodesSearched: 0,
  aborted: false,
  killerMoves: {},
  historyTable: {},
};

export const PonderState = ponderState;

/**
 * Start pondering - begins background search for the opponent's likely moves.
 * Called when it's the opponent's turn (after human move or in auto-battle).
 * The search runs with extended time budget and can be interrupted.
 */
export function startPondering(game: IGame, opponentFaction: Faction): void {
  // Stop any existing pondering
  if (ponderState.active) {
    stopPondering();
  }

  // Validate game state
  const actions = getAllActions(game, opponentFaction);
  if (actions.length === 0) {
    return; // No legal moves for opponent
  }

  // Set up pondering state
  ponderState.active = true;
  ponderState.game = game;
  ponderState.opponentFaction = opponentFaction;
  ponderState.maximizingFaction = opponentFaction; // We evaluate from opponent's perspective
  ponderState.timeBudget = calculateTimeBudget(game) * 3; // 3x normal budget for pondering
  ponderState.searchDeadline = Date.now() + ponderState.timeBudget;
  ponderState.bestMove = null;
  ponderState.bestScore = -Infinity;
  ponderState.currentDepth = 0;
  ponderState.nodesSearched = 0;
  ponderState.aborted = false;
  ponderState.killerMoves = {};
  ponderState.historyTable = {};

  // Start the pondering search asynchronously
  // We use a microtask to not block the caller
  queueMicrotask(() => runPonderSearch());
}

/**
 * Internal: Run iterative deepening search for pondering.
 * This is a simplified version of iterativeDeepening that updates shared state.
 * Uses setTimeout to yield control back to the event loop.
 */
async function runPonderSearch(): Promise<void> {
  const { game, opponentFaction, maximizingFaction, timeBudget } = ponderState;

  // These should be non-null when pondering is active
  if (!game || !opponentFaction || !maximizingFaction || ponderState.aborted)
    return;

  const actions = getAllActions(game, opponentFaction);
  if (actions.length === 0) {
    ponderState.active = false;
    return;
  }

  // Quick check: if only one move, store it immediately
  if (actions.length === 1) {
    ponderState.bestMove = actions[0] ?? null;
    ponderState.bestScore = evaluateBoard(game, maximizingFaction);
    return;
  }

  // Estimate max depth we can reach (similar to iterativeDeepening)
  const MAX_DEPTH_CAP = 12;
  let prevScore = 0;

  for (let depth = 1; depth <= MAX_DEPTH_CAP; depth++) {
    if (
      ponderState.aborted ||
      Date.now() > ponderState.searchDeadline - timeBudget * 0.15
    ) {
      break;
    }

    ponderState.currentDepth = depth;

    // Aspiration windows
    let alpha, beta;
    if (depth <= 1) {
      alpha = -Infinity;
      beta = Infinity;
    } else {
      const windowSize = 50;
      alpha = prevScore - windowSize;
      beta = prevScore + windowSize;
    }

    // Search at this depth
    let result: SearchResult;
    try {
      result = minimax(
        game,
        depth,
        alpha,
        beta,
        maximizingFaction,
        opponentFaction,
        ponderState.searchDeadline,
      );
    } catch (e) {
      if (e instanceof Error && e.message === "ponder-aborted") {
        break;
      }
      throw e;
    }

    if (result.timeout) {
      break;
    }

    // Research if aspiration window failed
    if (result.score <= alpha) {
      result = minimax(
        game,
        depth,
        -Infinity,
        beta,
        maximizingFaction,
        opponentFaction,
        ponderState.searchDeadline,
      );
    } else if (result.score >= beta) {
      result = minimax(
        game,
        depth,
        alpha,
        Infinity,
        maximizingFaction,
        opponentFaction,
        ponderState.searchDeadline,
      );
    }

    if (
      !result.timeout &&
      (result.score <= -Infinity + 1 || result.score >= Infinity - 1)
    ) {
      result = minimax(
        game,
        depth,
        -Infinity,
        Infinity,
        maximizingFaction,
        opponentFaction,
        ponderState.searchDeadline,
      );
    }

    if (!result.timeout && result.action) {
      ponderState.bestMove = result.action;
      ponderState.bestScore = result.score;
      prevScore = result.score;

      // Progress callback for UI (optional)
      if (typeof reportPonderProgress === "function") {
        reportPonderProgress(depth, result.score, ponderState.nodesSearched);
      }
    } else if (result.timeout) {
      break;
    }

    // Increment TT age for next depth (same as iterativeDeepening)
    ttNewSearch();

    // Yield control back to event loop to allow stopPondering to be called
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  // Pondering complete (either finished depths or time ran out / aborted)
  // Keep bestMove in state for stopPondering() to retrieve
}

/**
 * Stop pondering and return the best move found so far.
 * When the opponent actually moves, we call this to get the pre-computed move.
 */
export async function stopPondering(): Promise<AIAction | null> {
  if (!ponderState.active) {
    return null;
  }

  // Signal abort to search loop
  ponderState.aborted = true;
  ponderState.active = false;

  // Small delay to allow search loop to exit gracefully
  await new Promise((resolve) => setTimeout(resolve, 0));

  const move = ponderState.bestMove;

  // Clear state
  ponderState.game = null;
  ponderState.opponentFaction = null;
  ponderState.maximizingFaction = null;
  ponderState.killerMoves = {};
  ponderState.historyTable = {};

  return move;
}

/**
 * Get the current best ponder move without stopping pondering.
 * Useful for UI display or debugging.
 */
export function getPonderMove(): AIAction | null {
  return ponderState.bestMove;
}

/**
 * Check if pondering is currently active.
 */
export function isPondering(): boolean {
  return ponderState.active;
}

/**
 * Optional progress callback - can be set by consumer (main thread or worker)
 * to receive depth/score updates during pondering.
 */
export let reportPonderProgress:
  | ((depth: number, score: number, nodes: number) => void)
  | null = null;

export function setPonderProgressCallback(
  callback: (depth: number, score: number, nodes: number) => void,
): void {
  reportPonderProgress = callback;
}

// Re-export learning functions
export { learnFromGame, getLearnedData, loadLearnedData };
