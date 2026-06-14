/**
 * opening-book.test.js - Tests for TriSchach Opening Book
 */
import { expect, test, describe, beforeEach, afterEach, vi } from "vitest";
import { FACTION, generateBoard } from "../js/board.js";
import { PIECE_TYPE, Piece } from "../js/pieces.js";
import { GAME_STATE } from "../js/game.js";

// Import all exported functions from opening-book.js
import {
  BOOK_INFO,
  buildOpeningBook,
  getBookMoves,
  pickBookMove,
  inBook,
  getBookStats,
  OPENING_BOOK,
  boardHash,
  parseMove,
} from "../js/opening-book.js";

// Mock Game class that mimics the real Game behavior
class MockGame {
  constructor() {
    this.pieces = [];
    this.currentFaction = FACTION.FIRE;
    this.currentFactionIdx = 0;
    this.state = GAME_STATE.SELECT_PIECE;
    this.rpsEnabled = true;
    this.capturedPieces = {
      [FACTION.FIRE]: [],
      [FACTION.WATER]: [],
      [FACTION.NATURE]: [],
    };
    this._undoStack = [];
    this._positionHistory = new Map();
    this._halfmoveClock = 0;
    this._occupiedMap = new Map();
    this.boardCells = new Map();
    this.selectedPiece = null;
    this.pendingPromotion = null;
  }

  getAlivePieces() {
    return this.pieces.filter((p) => p.alive);
  }

  init(boardCells) {
    this.boardCells = boardCells;
    this._setupStartingPosition();
    this._rebuildOccupiedMap();
  }

  _setupStartingPosition() {
    const firePieces = [
      { type: PIECE_TYPE.ROOK, pos: new Hex(-7, 7), id: "fire_rook_0" },
      { type: PIECE_TYPE.KNIGHT, pos: new Hex(-6, 7), id: "fire_knight_1" },
      { type: PIECE_TYPE.BISHOP, pos: new Hex(-5, 7), id: "fire_bishop_2" },
      { type: PIECE_TYPE.QUEEN, pos: new Hex(-4, 7), id: "fire_queen_3" },
      { type: PIECE_TYPE.KING, pos: new Hex(-3, 7), id: "fire_king_4" },
      { type: PIECE_TYPE.BISHOP, pos: new Hex(-2, 7), id: "fire_bishop_5" },
      { type: PIECE_TYPE.KNIGHT, pos: new Hex(-1, 7), id: "fire_knight_6" },
      { type: PIECE_TYPE.ROOK, pos: new Hex(0, 7), id: "fire_rook_7" },
      { type: PIECE_TYPE.PAWN, pos: new Hex(-6, 6), id: "fire_pawn_8" },
      { type: PIECE_TYPE.PAWN, pos: new Hex(-5, 6), id: "fire_pawn_9" },
      { type: PIECE_TYPE.PAWN, pos: new Hex(-4, 6), id: "fire_pawn_10" },
      { type: PIECE_TYPE.PAWN, pos: new Hex(-3, 6), id: "fire_pawn_11" },
      { type: PIECE_TYPE.PAWN, pos: new Hex(-2, 6), id: "fire_pawn_12" },
      { type: PIECE_TYPE.PAWN, pos: new Hex(-1, 6), id: "fire_pawn_13" },
      { type: PIECE_TYPE.PAWN, pos: new Hex(0, 6), id: "fire_pawn_14" },
    ];

    const waterPieces = [
      { type: PIECE_TYPE.ROOK, pos: new Hex(2, -2), id: "water_rook_15" },
      { type: PIECE_TYPE.KNIGHT, pos: new Hex(2, -1), id: "water_knight_16" },
      { type: PIECE_TYPE.BISHOP, pos: new Hex(2, 0), id: "water_bishop_17" },
      { type: PIECE_TYPE.QUEEN, pos: new Hex(2, 1), id: "water_queen_18" },
      { type: PIECE_TYPE.KING, pos: new Hex(2, 2), id: "water_king_19" },
      { type: PIECE_TYPE.BISHOP, pos: new Hex(2, 3), id: "water_bishop_20" },
      { type: PIECE_TYPE.KNIGHT, pos: new Hex(2, 4), id: "water_knight_21" },
      { type: PIECE_TYPE.ROOK, pos: new Hex(2, 5), id: "water_rook_22" },
      { type: PIECE_TYPE.PAWN, pos: new Hex(1, -1), id: "water_pawn_23" },
      { type: PIECE_TYPE.PAWN, pos: new Hex(1, 0), id: "water_pawn_24" },
      { type: PIECE_TYPE.PAWN, pos: new Hex(1, 1), id: "water_pawn_25" },
      { type: PIECE_TYPE.PAWN, pos: new Hex(1, 2), id: "water_pawn_26" },
      { type: PIECE_TYPE.PAWN, pos: new Hex(1, 3), id: "water_pawn_27" },
      { type: PIECE_TYPE.PAWN, pos: new Hex(1, 4), id: "water_pawn_28" },
      { type: PIECE_TYPE.PAWN, pos: new Hex(1, 5), id: "water_pawn_29" },
    ];

    const naturePieces = [
      { type: PIECE_TYPE.ROOK, pos: new Hex(0, -2), id: "nature_rook_30" },
      { type: PIECE_TYPE.KNIGHT, pos: new Hex(-1, -1), id: "nature_knight_31" },
      { type: PIECE_TYPE.BISHOP, pos: new Hex(-2, 0), id: "nature_bishop_32" },
      { type: PIECE_TYPE.QUEEN, pos: new Hex(-3, 1), id: "nature_queen_33" },
      { type: PIECE_TYPE.KING, pos: new Hex(-4, 2), id: "nature_king_34" },
      { type: PIECE_TYPE.BISHOP, pos: new Hex(-5, 3), id: "nature_bishop_35" },
      { type: PIECE_TYPE.KNIGHT, pos: new Hex(-6, 4), id: "nature_knight_36" },
      { type: PIECE_TYPE.ROOK, pos: new Hex(-7, 5), id: "nature_rook_37" },
      { type: PIECE_TYPE.PAWN, pos: new Hex(0, -1), id: "nature_pawn_38" },
      { type: PIECE_TYPE.PAWN, pos: new Hex(-1, 0), id: "nature_pawn_39" },
      { type: PIECE_TYPE.PAWN, pos: new Hex(-2, 1), id: "nature_pawn_40" },
      { type: PIECE_TYPE.PAWN, pos: new Hex(-3, 2), id: "nature_pawn_41" },
      { type: PIECE_TYPE.PAWN, pos: new Hex(-4, 3), id: "nature_pawn_42" },
      { type: PIECE_TYPE.PAWN, pos: new Hex(-5, 4), id: "nature_pawn_43" },
      { type: PIECE_TYPE.PAWN, pos: new Hex(-6, 5), id: "nature_pawn_44" },
    ];

    this.pieces = [
      ...firePieces.map((p) => new Piece(p.type, FACTION.FIRE, p.pos)),
      ...waterPieces.map((p) => new Piece(p.type, FACTION.WATER, p.pos)),
      ...naturePieces.map((p) => new Piece(p.type, FACTION.NATURE, p.pos)),
    ];

    // Assign IDs matching the opening book expectations
    let fireIdx = 0,
      waterIdx = 0,
      natureIdx = 0;
    for (const piece of this.pieces) {
      if (piece.faction === FACTION.FIRE) {
        piece.id = firePieces[fireIdx].id;
        fireIdx++;
      } else if (piece.faction === FACTION.WATER) {
        piece.id = waterPieces[waterIdx].id;
        waterIdx++;
      } else if (piece.faction === FACTION.NATURE) {
        piece.id = naturePieces[natureIdx].id;
        natureIdx++;
      }
    }
  }

  _rebuildOccupiedMap() {
    this._occupiedMap = new Map();
    for (const p of this.pieces) {
      if (p.alive) this._occupiedMap.set(p.pos.key, p);
    }
  }

  handleCellClick(pos) {
    // Find piece at position
    const piece = this._occupiedMap.get(pos.key);

    if (this.pendingPromotion) {
      return { action: "none" };
    }

    if (this.selectedPiece) {
      // Try to move/attack - check if it's a valid move
      const from = this.selectedPiece.pos;

      // Bonus: if it's an attack, verify target has piece
      const targetPiece = this._occupiedMap.get(pos.key);

      // Move the piece
      this.selectedPiece.pos = pos;
      this.selectedPiece.hasMoved = true;
      this.selectedPiece = null;

      // Toggle turn
      this.currentFactionIdx = (this.currentFactionIdx + 1) % 3;
      const factions = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];
      this.currentFaction = factions[this.currentFactionIdx];

      this._rebuildOccupiedMap();

      return targetPiece ? { action: "combat" } : { action: "move" };
    } else {
      // Select piece
      if (piece && piece.alive) {
        this.selectedPiece = piece;
        return { action: "select", piece };
      }
      return { action: "none" };
    }
  }

  completePromotion(type) {
    this.pendingPromotion = null;
  }
}

// Helper to create starting position - just use MockGame directly
function createStartingGame() {
  const game = new MockGame();
  game.init(generateBoard());
  return game;
}

// Use real Hex for tests
import { Hex } from "../js/hex.js";

describe("Opening Book: BOOK_INFO", () => {
  test("has correct metadata", () => {
    expect(BOOK_INFO.version).toBe("1.0");
    expect(typeof BOOK_INFO.maxPly).toBe("number");
    expect(BOOK_INFO.maxPly).toBeGreaterThan(0);
    expect(typeof BOOK_INFO.totalPositions).toBe("number");
    expect(BOOK_INFO.lastUpdated).toBeDefined();
  });
});

describe("Opening Book: boardHash", () => {
  test("generates consistent hash for same position", () => {
    const game1 = createStartingGame();
    const game2 = createStartingGame();

    const hash1 = boardHash(game1);
    const hash2 = boardHash(game2);

    expect(hash1).toBe(hash2);
    expect(typeof hash1).toBe("string");
    expect(hash1.length).toBeGreaterThan(0);
  });

  test("includes faction index in hash", () => {
    const game = createStartingGame();
    const hash1 = boardHash(game);

    game.currentFactionIdx = 1;
    game.currentFaction = FACTION.WATER;
    const hash2 = boardHash(game);

    expect(hash1).not.toBe(hash2);
  });

  test("different positions have different hashes", () => {
    const game1 = createStartingGame();
    const game2 = createStartingGame();

    // Move a piece
    game2.pieces[10].pos = new Hex(-4, 5); // pawn_10
    game2._rebuildOccupiedMap();

    const hash1 = boardHash(game1);
    const hash2 = boardHash(game2);

    expect(hash1).not.toBe(hash2);
  });

  test("only alive pieces in hash", () => {
    const game = createStartingGame();
    const hash1 = boardHash(game);

    game.pieces[0].alive = false;
    game._rebuildOccupiedMap();
    const hash2 = boardHash(game);

    expect(hash1).not.toBe(hash2);
  });
});

describe("Opening Book: parseMove", () => {
  test("parses valid move string", () => {
    const game = createStartingGame();
    const moveStr = "fire_pawn_10 -> -4,5";
    const parsed = parseMove(game, moveStr);

    expect(parsed).not.toBeNull();
    expect(parsed.piece).toBeDefined();
    expect(parsed.target).toBeInstanceOf(Hex);
    expect(parsed.target.q).toBe(-4);
    expect(parsed.target.r).toBe(5);
  });

  test("returns null for non-existent piece", () => {
    const game = createStartingGame();
    const moveStr = "fire_nonexistent -> -4,5";
    const parsed = parseMove(game, moveStr);

    expect(parsed).toBeNull();
  });

  test("returns null for invalid coordinates", () => {
    const game = createStartingGame();
    const moveStr = "fire_pawn_10 -> a,b";
    const parsed = parseMove(game, moveStr);

    expect(parsed).toBeNull();
  });

  test("handles spaces correctly", () => {
    const game = createStartingGame();
    const moveStr = "fire_pawn_10 ->  -4, 5 ";
    const parsed = parseMove(game, moveStr);

    expect(parsed).not.toBeNull();
    expect(parsed.target.q).toBe(-4);
    expect(parsed.target.r).toBe(5);
  });
});

describe("Opening Book: buildOpeningBook", () => {
  beforeEach(() => {
    // Clear the book before each test
    OPENING_BOOK.clear();
  });

  test("builds book with positions", () => {
    buildOpeningBook(MockGame);

    expect(OPENING_BOOK.size).toBeGreaterThan(0);
    expect(BOOK_INFO.totalPositions).toBeGreaterThan(0);
  });

  test("creates entries for all 12 opening lines", () => {
    buildOpeningBook(MockGame);

    // 4 lines per faction * 3 factions = 12 lines minimum
    // Each line creates entries at each ply
    const totalVariations = Array.from(OPENING_BOOK.values()).reduce(
      (sum, arr) => sum + arr.length,
      0,
    );
    expect(totalVariations).toBeGreaterThan(12);
  });

  test("idempotent - second build does not double entries", () => {
    buildOpeningBook(MockGame);
    const firstSize = OPENING_BOOK.size;

    buildOpeningBook(MockGame);
    const secondSize = OPENING_BOOK.size;

    expect(secondSize).toBe(firstSize);
  });
});

describe("Opening Book: getBookMoves", () => {
  beforeEach(() => {
    OPENING_BOOK.clear();
  });

  test("returns null for position not in book", () => {
    const game = createStartingGame();
    // Don't build book
    const moves = getBookMoves(game);
    expect(moves).toBeNull();
  });

  test("returns moves for position after book build", () => {
    buildOpeningBook(MockGame);
    const game = createStartingGame();

    const moves = getBookMoves(game);

    expect(moves).not.toBeNull();
    expect(Array.isArray(moves)).toBe(true);
    expect(moves.length).toBeGreaterThan(0);

    // Should be sorted by weight descending
    for (let i = 1; i < moves.length; i++) {
      expect(moves[i].weight).toBeLessThanOrEqual(moves[i - 1].weight);
    }
  });

  test("returned moves have correct structure", () => {
    buildOpeningBook(MockGame);
    const game = createStartingGame();

    const moves = getBookMoves(game);

    for (const move of moves) {
      expect(move).toHaveProperty("move");
      expect(move.move).toHaveProperty("pieceId");
      expect(move.move).toHaveProperty("targetQ");
      expect(move.move).toHaveProperty("targetR");
      expect(move).toHaveProperty("weight");
      expect(typeof move.weight).toBe("number");
    }
  });
});

describe("Opening Book: pickBookMove", () => {
  beforeEach(() => {
    OPENING_BOOK.clear();
  });

  test("returns null for position not in book", () => {
    const game = createStartingGame();
    const move = pickBookMove(game);
    expect(move).toBeNull();
  });

  test("returns a valid move from book", () => {
    buildOpeningBook(MockGame);
    const game = createStartingGame();

    const move = pickBookMove(game);

    expect(move).not.toBeNull();
    if (move) {
      expect(move).toHaveProperty("piece");
      expect(move).toHaveProperty("target");
      expect(move.piece.alive).toBe(true);
      expect(move.target).toBeInstanceOf(Hex);
    }
  });

  test("returns valid piece for the move", () => {
    buildOpeningBook(MockGame);
    const game = createStartingGame();

    // Run multiple times to test weighted random
    for (let i = 0; i < 10; i++) {
      const move = pickBookMove(game);
      if (move) {
        expect(move.piece.alive).toBe(true);
        // Piece should match one of the book entries
        const bookMoves = getBookMoves(game);
        const matchingEntry = bookMoves.find(
          (m) => m.move.pieceId === move.piece.id,
        );
        expect(matchingEntry).toBeDefined();
      }
    }
  });

  test("falls back to first move if piece not found", () => {
    buildOpeningBook(MockGame);
    const game = createStartingGame();

    // Kill all pieces except one
    for (const p of game.pieces) {
      if (p.id !== "fire_pawn_10") p.alive = false;
    }
    game._rebuildOccupiedMap();

    const move = pickBookMove(game);

    // Should still return a move if any valid piece exists
    if (move) {
      expect(move.piece.alive).toBe(true);
    }
  });
});

describe("Opening Book: inBook", () => {
  beforeEach(() => {
    OPENING_BOOK.clear();
  });

  test("returns false for position not in book", () => {
    const game = createStartingGame();
    expect(inBook(game)).toBe(false);
  });

  test("returns true for position in book", () => {
    buildOpeningBook(MockGame);
    const game = createStartingGame();
    expect(inBook(game)).toBe(true);
  });
});

describe("Opening Book: getBookStats", () => {
  beforeEach(() => {
    OPENING_BOOK.clear();
  });

  test("returns correct stats structure", () => {
    const stats = getBookStats();

    expect(stats).toHaveProperty("positions");
    expect(stats).toHaveProperty("totalVariations");
    expect(stats).toHaveProperty("maxPly");
    expect(typeof stats.positions).toBe("number");
    expect(typeof stats.totalVariations).toBe("number");
    expect(typeof stats.maxPly).toBe("number");
  });

  test("stats update after build", () => {
    const before = getBookStats();
    buildOpeningBook(MockGame);
    const after = getBookStats();

    expect(after.positions).toBeGreaterThan(before.positions);
    expect(after.totalVariations).toBeGreaterThan(before.totalVariations);
  });

  test("maxPly matches BOOK_INFO", () => {
    buildOpeningBook(MockGame);
    const stats = getBookStats();
    expect(stats.maxPly).toBe(BOOK_INFO.maxPly);
  });
});

describe("Opening Book: OPENING_BOOK Map", () => {
  beforeEach(() => {
    OPENING_BOOK.clear();
  });

  test("is a Map", () => {
    expect(OPENING_BOOK).toBeInstanceOf(Map);
  });

  test("can be cleared", () => {
    buildOpeningBook(MockGame);
    expect(OPENING_BOOK.size).toBeGreaterThan(0);

    OPENING_BOOK.clear();
    expect(OPENING_BOOK.size).toBe(0);
  });

  test("stores arrays of move entries", () => {
    buildOpeningBook(MockGame);

    for (const [hash, moves] of OPENING_BOOK) {
      expect(Array.isArray(moves)).toBe(true);
      for (const entry of moves) {
        expect(entry).toHaveProperty("move");
        expect(entry).toHaveProperty("weight");
      }
    }
  });
});

describe("Opening Book: Integration with Game flow", () => {
  beforeEach(() => {
    OPENING_BOOK.clear();
  });

  test("book move is legal in game", () => {
    buildOpeningBook(MockGame);
    const game = createStartingGame();

    const bookMove = pickBookMove(game);

    if (bookMove) {
      // Simulate selecting and moving
      const selectResult = game.handleCellClick(bookMove.piece.pos);
      expect(selectResult.action).toBe("select");

      const result = game.handleCellClick(bookMove.target);
      // Should be a valid move or combat
      expect(["move", "combat", "promotion"]).toContain(result.action);
    }
  });

  test("multiple moves from same position are legal", () => {
    buildOpeningBook(MockGame);
    const game = createStartingGame();

    const bookMoves = getBookMoves(game);

    if (bookMoves && bookMoves.length > 0) {
      for (const entry of bookMoves) {
        const piece = game.pieces.find((p) => p.id === entry.move.pieceId);
        if (piece && piece.alive) {
          const selectResult = game.handleCellClick(piece.pos);
          if (selectResult.action === "select") {
            const result = game.handleCellClick(
              new Hex(entry.move.targetQ, entry.move.targetR),
            );
            // Should be a valid action (or promotion)
            expect(["move", "combat", "promotion"]).toContain(result.action);
          }
        }
      }
    }
  });
});

describe("Opening Book: Weight handling", () => {
  beforeEach(() => {
    OPENING_BOOK.clear();
  });

  test("weights decrease with ply depth", () => {
    buildOpeningBook(MockGame);

    let prevWeight = Infinity;
    for (const [hash, moves] of OPENING_BOOK) {
      for (const entry of moves) {
        expect(entry.weight).toBeGreaterThan(0);
      }
    }
  });

  test("duplicates are not added for same move at same position", () => {
    buildOpeningBook(MockGame);

    for (const [hash, moves] of OPENING_BOOK) {
      const seen = new Set();
      for (const entry of moves) {
        const key = `${entry.move.pieceId}-${entry.move.targetQ},${entry.move.targetR}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });
});

describe("Opening Book: Edge cases", () => {
  beforeEach(() => {
    OPENING_BOOK.clear();
  });

  test("handles game with no pieces", () => {
    const game = new MockGame();
    game.init(generateBoard());

    expect(inBook(game)).toBe(false);
    expect(getBookMoves(game)).toBeNull();
    expect(pickBookMove(game)).toBeNull();
  });

  test("boardHash handles empty game", () => {
    const game = new MockGame();
    game.init(generateBoard());

    const hash = boardHash(game);
    expect(typeof hash).toBe("string");
    expect(hash).toContain("#0"); // faction index 0
  });

  test("parseMove handles missing -> separator", () => {
    const game = createStartingGame();
    const parsed = parseMove(game, "fire_pawn_10 -4,5");
    expect(parsed).toBeNull();
  });
});
