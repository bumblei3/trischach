import { Hex, HEX_DIRECTIONS, HEX_DIAGONALS, hexKnightMoves } from "./hex.js";
import type {
  Faction,
  PieceType,
  ValidMoves,
  PAWN_FORWARD_MAP,
  PAWN_ATTACK_MAP,
} from "./types.js";

export const PIECE_TYPE = {
  KING: "king",
  QUEEN: "queen",
  ROOK: "rook",
  BISHOP: "bishop",
  KNIGHT: "knight",
  PAWN: "pawn",
} as const;

const SYMBOLS: Record<PieceType, string> = {
  king: "♚",
  queen: "♛",
  rook: "♜",
  bishop: "♝",
  knight: "♞",
  pawn: "♟",
};

export const PIECE_STRENGTH: Record<PieceType, number> = {
  king: 100,
  queen: 9,
  rook: 5,
  bishop: 3,
  knight: 3,
  pawn: 1,
};

let _pieceIdCounter = 0;

export class Piece {
  public readonly id: string;
  public readonly type: PieceType;
  public readonly faction: Faction;
  public pos: Hex;
  public readonly symbol: string;
  public alive: boolean;
  public hasMoved: boolean;

  constructor(type: PieceType, faction: Faction, pos: Hex) {
    this.id = `${faction}_${type}_${_pieceIdCounter++}`;
    this.type = type;
    this.faction = faction;
    this.pos = pos;
    this.symbol = SYMBOLS[type];
    this.alive = true;
    this.hasMoved = false;
  }
}

// Forward directions per faction (toward the center/enemy)
// Perfectly symmetric 120-degree rotations
const PAWN_FORWARD: PAWN_FORWARD_MAP = {
  fire: [new Hex(0, -1), new Hex(1, -1)], // NW, NE
  nature: [new Hex(1, 0), new Hex(0, 1)], // E, SE
  water: [new Hex(-1, 1), new Hex(-1, 0)], // SW, W
};

// Attacks are the same as forward moves (like checkers/draughts) for simplicity
const PAWN_ATTACK: PAWN_ATTACK_MAP = PAWN_FORWARD;

/**
 * Get valid moves for a piece, given the board and occupied map.
 */
export function getValidMoves(
  piece: Piece,
  boardCells: Map<string, { hex: Hex; zone: string; faction: Faction | null }>,
  occupied: Map<string, Piece>,
): ValidMoves {
  const moves: Hex[] = [];
  const attacks: Hex[] = [];

  const isOnBoard = (h: Hex): boolean => boardCells.has(h.key);
  const isBlocked = (h: Hex): boolean => occupied.has(h.key);
  const isEnemy = (h: Hex): boolean => {
    const p = occupied.get(h.key);
    return p !== undefined && p.faction !== piece.faction;
  };
  const isFriendly = (h: Hex): boolean => {
    const p = occupied.get(h.key);
    return p !== undefined && p.faction === piece.faction;
  };

  const addSliding = (directions: readonly Hex[]) => {
    for (const dir of directions) {
      for (let i = 1; i <= 12; i++) {
        const target = piece.pos.add(dir.scale(i));
        if (!isOnBoard(target)) break;
        if (isFriendly(target)) break;
        if (isEnemy(target)) {
          attacks.push(target);
          break;
        }
        moves.push(target);
      }
    }
  };

  switch (piece.type) {
    case PIECE_TYPE.KING:
      for (const dir of HEX_DIRECTIONS) {
        const t = piece.pos.add(dir);
        if (!isOnBoard(t)) continue;
        if (isFriendly(t)) continue;
        if (isEnemy(t)) attacks.push(t);
        else moves.push(t);
      }
      break;
    case PIECE_TYPE.QUEEN:
      addSliding(HEX_DIRECTIONS);
      addSliding(HEX_DIAGONALS);
      break;
    case PIECE_TYPE.ROOK:
      addSliding(HEX_DIRECTIONS);
      break;
    case PIECE_TYPE.BISHOP:
      addSliding(HEX_DIAGONALS);
      break;
    case PIECE_TYPE.KNIGHT: {
      const targets = hexKnightMoves(piece.pos);
      for (const t of targets) {
        if (!isOnBoard(t)) continue;
        if (isFriendly(t)) continue;
        if (isEnemy(t)) attacks.push(t);
        else moves.push(t);
      }
      break;
    }
    case PIECE_TYPE.PAWN: {
      const fwds = PAWN_FORWARD[piece.faction] ?? [];
      for (const dir of fwds) {
        const t = piece.pos.add(dir);
        if (isOnBoard(t) && !isBlocked(t)) moves.push(t);
      }
      const atks = PAWN_ATTACK[piece.faction] ?? [];
      for (const dir of atks) {
        const t = piece.pos.add(dir);
        if (isOnBoard(t) && isEnemy(t)) attacks.push(t);
      }
      // First move: can move 2 forward
      if (!piece.hasMoved && fwds.length > 0) {
        const firstDir = fwds[0];
        if (firstDir) {
          const t = piece.pos.add(firstDir.scale(2));
          const mid = piece.pos.add(firstDir);
          if (isOnBoard(t) && !isBlocked(t) && !isBlocked(mid)) moves.push(t);
        }
      }
      break;
    }
  }
  return { moves, attacks };
}

/**
 * Create initial pieces for all 3 factions.
 */
export function createInitialPieces(): Piece[] {
  _pieceIdCounter = 0;
  const pieces: Piece[] = [];
  const N = 5;

  // Back row order
  const pieceOrder: PieceType[] = [
    PIECE_TYPE.ROOK,
    PIECE_TYPE.KNIGHT,
    PIECE_TYPE.BISHOP,
    PIECE_TYPE.QUEEN,
    PIECE_TYPE.KING,
    PIECE_TYPE.BISHOP,
    PIECE_TYPE.KNIGHT,
    PIECE_TYPE.ROOK,
  ];

  // Fire (bottom zone): attached to base r=N
  // d=1 (Front, r=6): q from -6 to 0 (7 pawns)
  // d=2 (Back, r=7): q from -7 to 0 (8 pieces)
  for (let i = 0; i < 8; i++) {
    const type = pieceOrder[i]!;
    pieces.push(new Piece(type, "fire", new Hex(-7 + i, N + 2)));
  }
  for (let q = -N - 1; q <= 0; q++) {
    pieces.push(new Piece(PIECE_TYPE.PAWN, "fire", new Hex(q, N + 1)));
  }

  // Water (right zone): attached to right edge q=0
  // d=1 (Front, q=1): r from -1 to 5 (7 pawns)
  // d=2 (Back, q=2): r from -2 to 5 (8 pieces)
  for (let i = 0; i < 8; i++) {
    const type = pieceOrder[i]!;
    pieces.push(new Piece(type, "water", new Hex(2, -2 + i)));
  }
  for (let r = -1; r <= N; r++) {
    pieces.push(new Piece(PIECE_TYPE.PAWN, "water", new Hex(1, r)));
  }

  // Nature (left zone): attached to left edge s=0 (q=-r)
  // d=1 (Front, s=1): r from -1 to 5 (7 pawns). q = -r - 1
  // d=2 (Back, s=2): r from -2 to 5 (8 pieces). q = -r - 2
  for (let i = 0; i < 8; i++) {
    const r = -2 + i;
    const type = pieceOrder[i]!;
    pieces.push(new Piece(type, "nature", new Hex(-r - 2, r)));
  }
  for (let r = -1; r <= N; r++) {
    pieces.push(new Piece(PIECE_TYPE.PAWN, "nature", new Hex(-r - 1, r)));
  }

  return pieces;
}
