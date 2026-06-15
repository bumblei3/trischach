/**
 * TriSchach Core Type Definitions
 * Central type definitions for the entire codebase
 */

// ─── Hex Coordinates ────────────────────────────────────────────────

import { Hex as HexClass } from "./hex.ts";

export interface Hex {
  readonly q: number;
  readonly r: number;
  readonly s: number;
  readonly key: string;
  equals(other: Hex): boolean;
  add(other: Hex): Hex;
  subtract(other: Hex): Hex;
  scale(factor: number): Hex;
  distance(other: Hex): number;
  rotateCW(): Hex;
  rotateCCW(): Hex;
  toString(): string;
}

export const Hex = HexClass;

export function createHex(q: number, r: number): Hex {
  return new Hex(q, r);
}

// ─── Factions & RPS ────────────────────────────────────────────────

export type Faction = "fire" | "water" | "nature";

export const FACTIONS: Faction[] = ["fire", "water", "nature"];

export const FACTION_COLORS: Record<
  Faction,
  {
    primary: string;
    secondary: string;
    glow: string;
    name: string;
  }
> &
  Record<
    string,
    { primary: string; secondary: string; glow: string; name: string }
  > = {
  fire: {
    primary: "#FF4500",
    secondary: "#FF6B35",
    glow: "#FF6B3566",
    name: "Feuer 🔥",
  },
  water: {
    primary: "#0099FF",
    secondary: "#00BFFF",
    glow: "#00BFFF66",
    name: "Wasser 🌊",
  },
  nature: {
    primary: "#22CC44",
    secondary: "#32CD32",
    glow: "#32CD3266",
    name: "Natur 🌿",
  },
};

export type RPSResult = "advantage" | "neutral" | "disadvantage";

export const RPS: Record<Faction, Faction> = {
  fire: "nature",
  nature: "water",
  water: "fire",
};

export function getRPSResult(attacker: Faction, defender: Faction): RPSResult {
  if (attacker === defender) return "neutral";
  return RPS[attacker] === defender ? "advantage" : "disadvantage";
}

// ─── Piece Types ──────────────────────────────────────────────────

export type PieceType =
  | "king"
  | "queen"
  | "rook"
  | "bishop"
  | "knight"
  | "pawn";

export const PIECE_TYPES: PieceType[] = [
  "king",
  "queen",
  "rook",
  "bishop",
  "knight",
  "pawn",
];

// PIECE_STRENGTH is defined in pieces.ts with game-specific values
// Type alias provided for other modules
export type PIECE_STRENGTH = Record<PieceType, number>;

export const PIECE_SYMBOLS: Record<Faction, Record<PieceType, string>> = {
  fire: {
    king: "♚",
    queen: "♛",
    rook: "♜",
    bishop: "♝",
    knight: "♞",
    pawn: "♟",
  },
  water: {
    king: "♔",
    queen: "♕",
    rook: "♖",
    bishop: "♗",
    knight: "♘",
    pawn: "♙",
  },
  nature: {
    king: "♚",
    queen: "♛",
    rook: "♜",
    bishop: "♝",
    knight: "♞",
    pawn: "♟",
  },
};

export interface Piece {
  id: string;
  type: PieceType;
  faction: Faction;
  pos: Hex;
  symbol: string;
  alive: boolean;
  hasMoved: boolean;
}

export interface ValidMoves {
  moves: Hex[];
  attacks: Hex[];
  rpsAttacks?: {
    advantage: Hex[];
    neutral: Hex[];
    disadvantage: Hex[];
  };
}

export type PAWN_FORWARD_MAP = Record<Faction, readonly Hex[]>;

export type PAWN_ATTACK_MAP = Record<Faction, readonly Hex[]>;

// ─── Game State ───────────────────────────────────────────────────

export type GameState =
  | "select_piece"
  | "select_target"
  | "game_over"
  | "combat"
  | "promotion"
  | "draw_repetition"
  | "draw_50move";

export const GAME_STATE = {
  SELECT_PIECE: "select_piece" as GameState,
  SELECT_TARGET: "select_target" as GameState,
  GAME_OVER: "game_over" as GameState,
  COMBAT: "combat" as GameState,
  PROMOTION: "promotion" as GameState,
  DRAW_REPETITION: "draw_repetition" as GameState,
  DRAW_50MOVE: "draw_50move" as GameState,
};

export interface Cell {
  hex: Hex;
  zone: "triangle" | "start_fire" | "start_water" | "start_nature";
  faction: Faction | null;
}

export interface Zone {
  TRIANGLE: "triangle";
  START_FIRE: "start_fire";
  START_WATER: "start_water";
  START_NATURE: "start_nature";
}

export const ZONE: Zone = {
  TRIANGLE: "triangle",
  START_FIRE: "start_fire",
  START_WATER: "start_water",
  START_NATURE: "start_nature",
};

export interface TurnOrder {
  FIRE: "fire";
  WATER: "water";
  NATURE: "nature";
}

export const TURN_ORDER: TurnOrder = {
  FIRE: "fire",
  WATER: "water",
  NATURE: "nature",
};

export interface GameResult {
  action: "move" | "combat" | "promotion" | "select" | "deselect";
  piece?: Piece;
  from?: Hex | string;
  to?: Hex | string;
  type?: PieceType;
  notation?: string;
  defender?: Piece;
  rpsResult?: RPSResult;
  winner?: Piece;
  loser?: Piece;
  promotion?: boolean;
  eliminated?: boolean;
  elimination?: Faction;
  eliminatedFaction?: Faction;
  gameOver?: boolean;
  winner_faction?: Faction | null;
  inCheck?: boolean;
  stalemate?: Faction;
  checkmate?: Faction;
  draw?: boolean;
  moves?: Hex[];
  attacks?: Hex[];
  rpsAttacks?: {
    advantage: Hex[];
    neutral: Hex[];
    disadvantage: Hex[];
  } | null;
}

// ─── Snapshot for Undo ──────────────────────────────────────────────

export interface Snapshot {
  pieces: Array<{
    id: string;
    faction: Faction;
    type: PieceType;
    pos: { q: number; r: number };
    alive: boolean;
    hasMoved: boolean;
  }>;
  currentFactionIdx: number;
  eliminatedFactions: Set<Faction>;
  capturedPieces: {
    fire: string[];
    water: string[];
    nature: string[];
  };
  moveHistoryLength: number;
  // AI simulation extras (used by game-check.ts and game.ts simulateMove)
  prevFactionIdx?: number;
  wasAttack?: boolean;
  defender?: Piece;
  defenderWasKilled?: boolean;
  attackerDied?: boolean;
  eliminatedFaction?: Faction;
  promotion?: PieceType;
  promoted?: boolean;
  piece?: Piece;
  from?: Hex;
  pieceHasMoved?: boolean;
}

// Minimal snapshot for AI simulation (used in minimax search)
export interface AISnapshot {
  piece: Piece;
  from: Hex;
  pieceHasMoved: boolean;
  wasAttack: boolean;
  defender?: Piece;
  defenderWasKilled: boolean;
  attackerDied: boolean;
  eliminatedFaction?: Faction;
  promotion?: PieceType;
  prevFactionIdx: number;
  prevZobristHash?: bigint;
}

export interface IGame {
  pieces: Piece[];
  currentFactionIdx: number;
  state: GameState;
  selectedPiece: Piece | null;
  validMoves: Hex[];
  validAttacks: Hex[];
  eliminatedFactions: Set<Faction>;
  moveHistory: GameResult[];
  onUpdate: (() => void) | null;
  onCombat: ((result: GameResult) => void) | null;
  onGameOver: ((winner: Faction | null) => void) | null;
  onElimination: ((faction: Faction) => void) | null;
  onDraw: ((type: "repetition" | "50move") => void) | null;
  onPromotion: ((piece: Piece) => void) | null;
  boardCells: Map<string, Cell> | null;
  rpsEnabled: boolean;
  capturedPieces: Record<Faction, Piece[]>;
  pendingPromotion: Piece | null;
  currentFaction: Faction;
  currentFactionName: string;
  _positionHistory: Map<string, number>;
  _halfmoveClock: number;
  _occupiedMap: Map<string, Piece> | null;
  _zobristHash?: bigint;
  init(boardCells: Map<string, Cell>): void;
  getAlivePieces(): Piece[];
  getPieceAt(hex: Hex): Piece | null;
  _rebuildOccupiedMap(): void;
  isKingInCheck(faction: Faction): boolean;
  getLegalMoves(piece: Piece): { moves: Hex[]; attacks: Hex[] };
  isCheckmate(faction: Faction): boolean;
  isStalemate(faction: Faction): boolean;
  isPromotion(piece: Piece, target: Hex): boolean;
  completePromotion(newType: PieceType): GameResult | null;
  handleCellClick(hex: Hex): GameResult | null;
  _selectPiece(hex: Hex): GameResult;
  _selectTarget(hex: Hex): GameResult;
  _nextTurn(): void;
  simulateMove(piece: Piece, target: Hex): AISnapshot;
  undoMove(undo: AISnapshot): void;
  snapshot(): Snapshot;
  restore(snap: Snapshot): void;
  undo(): Snapshot | null;
  _positionHash(): string;
  _updateDrawState(wasCapture: boolean, wasPawnMove: boolean): boolean;
}

// Export as Game for backward compatibility
export type Game = IGame;

// ─── AI Types ─────────────────────────────────────────────────────

export type AIPersonality =
  | "balanced"
  | "aggressive"
  | "defensive"
  | "tactical";

export interface PersonalityWeights {
  material: number;
  positional: number;
  kingSafety: number;
  kingThreats: number;
  pawnStructure: number;
  endgame: number;
  mobility: number;
}

export interface PersonalityConfig {
  name: string;
  description: string;
  weights: PersonalityWeights;
  aggression: number;
}

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

export interface AIAction {
  piece: Piece;
  target: Hex;
  type: "move" | "attack";
  rps?: RPSResult;
}

export interface SearchResult {
  score: number;
  action?: AIAction | null;
  timeout?: boolean;
}

export interface TranspositionEntry {
  depth: number;
  score: number;
  action: AIAction | null;
  flag: "exact" | "lower" | "upper";
}

// ─── Opening Book ─────────────────────────────────────────────────

export interface BookMoveBase {
  from: [number, number];
  to: [number, number];
  pieceType: PieceType;
  weight?: number;
}

export interface BookVariation {
  moves: BookMoveBase[];
  weight: number;
}

export interface BookPosition {
  hash: string;
  variations: BookVariation[];
}

export interface OpeningBookData {
  positions: BookPosition[];
  metadata: {
    generated: string;
    totalPositions: number;
    totalVariations: number;
    maxDepth: number;
  };
}

// ─── Replay / TSPN ────────────────────────────────────────────────

export interface TSPNMove {
  turn: number;
  faction: Faction;
  pieceId: string;
  pieceType: PieceType;
  from: [number, number];
  to: [number, number];
  action: "move" | "combat" | "promotion";
  rpsResult?: RPSResult;
  promotionTo?: PieceType;
  san?: string; // Standard Algebraic Notation for display
}

export interface TSPNCapturedPiece {
  id: string;
  type: PieceType;
  faction: Faction;
}

export interface TSPNState {
  pieces: Array<{
    id: string;
    type: PieceType;
    faction: Faction;
    pos: [number, number];
    symbol: string;
    alive: boolean;
    hasMoved: boolean;
  }>;
  moveHistory: TSPNMove[];
  capturedPieces: {
    fire: string[];
    water: string[];
    nature: string[];
  };
  eliminatedFactions: Faction[];
  currentFactionIdx: number;
  rpsEnabled: boolean;
  halfmoveClock: number;
  winner?: Faction | null;
}

export interface TSPNGame {
  version: string;
  timestamp: string;
  initialState: TSPNState;
  moves: TSPNMove[];
  metadata?: {
    aiDepth?: number;
    aiPersonality?: AIPersonality;
    players?: Record<Faction, string>;
  };
}

// ─── Settings ─────────────────────────────────────────────────────

export interface GameSettings {
  rpsEnabled: boolean;
  soundEnabled: boolean;
  aiDepth: 1 | 2 | 3 | 4;
  boardRotation: 0 | 120 | 240;
  autoBattle: boolean;
  aiPersonality: AIPersonality;
}

export const DEFAULT_SETTINGS: GameSettings = {
  rpsEnabled: true,
  soundEnabled: true,
  aiDepth: 3,
  boardRotation: 0,
  autoBattle: false,
  aiPersonality: "balanced",
};

// ─── Utility Types ────────────────────────────────────────────────

export type DeepReadonly<T> = {
  readonly [P in keyof T]: DeepReadonly<T[P]>;
};

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

// ─── Event Callbacks ──────────────────────────────────────────────

export interface GameCallbacks {
  onUpdate?: () => void;
  onGameOver?: (winner: Faction | null) => void;
  onElimination?: (faction: Faction) => void;
  onPromotion?: (piece: Piece, newType: PieceType) => void;
  onCheck?: (faction: Faction) => void;
  onStalemate?: (faction: Faction) => void;
}

// ─── Board Renderer ───────────────────────────────────────────────

export interface HexElement {
  hex: Hex;
  polygon: SVGPolygonElement;
  label: SVGTextElement;
  cell: Cell;
}

export interface PieceElement {
  id: string;
  element: SVGGElement;
}
