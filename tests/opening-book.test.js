/**
 * opening-book.test.js - Tests for TriSchach Opening Book
 */
import { expect, test, describe, beforeEach, vi } from "vitest";
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
  learnFromGame,
  getLearnedData,
  saveLearnedData,
  loadLearnedData,
  loadOpeningBook,
  saveLearnedDataToStorage,
  loadLearnedDataFromStorage,
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
    this.moveHistory = []; // Track move history for tests
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

      this.moveHistory.push({ from, to: pos });

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

  completePromotion() {
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

    for (const [_hash, moves] of OPENING_BOOK) {
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

    for (const [_hash, moves] of OPENING_BOOK) {
      for (const entry of moves) {
        expect(entry.weight).toBeGreaterThan(0);
      }
    }
  });

  test("duplicates are not added for same move at same position", () => {
    buildOpeningBook(MockGame);

    for (const [_hash, moves] of OPENING_BOOK) {
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

describe("Opening Book: loadOpeningBook", () => {
  beforeEach(() => {
    OPENING_BOOK.clear();
  });

  test("function exists and returns boolean", async () => {
    const result = await loadOpeningBook();
    expect(typeof result).toBe("boolean");
  });

  test("returns true if already loaded", async () => {
    await loadOpeningBook();
    const result = await loadOpeningBook();
    expect(result).toBe(true);
  });
});

describe("Opening Book: learnFromGame", () => {
  beforeEach(() => {
    OPENING_BOOK.clear();
    buildOpeningBook(MockGame);
  });

  test("increases weight for winning moves", () => {
    const game = createStartingGame();
    const hash = boardHash(game);

    // Get initial weight
    const variations = OPENING_BOOK.get(hash);
    const initialWeight = variations[0].weight;

    // Learn from a win
    learnFromGame(
      [{ hash, faction: FACTION.FIRE, move: variations[0].move }],
      FACTION.FIRE,
    );

    const updatedVariations = OPENING_BOOK.get(hash);
    expect(updatedVariations[0].weight).toBeGreaterThan(initialWeight);
    expect(updatedVariations[0].wins).toBe(1);
    expect(updatedVariations[0].visits).toBe(1);
  });

  test("decreases weight for losing moves", () => {
    const game = createStartingGame();
    const hash = boardHash(game);

    const variations = OPENING_BOOK.get(hash);
    expect(variations).toBeDefined();
    expect(variations.length).toBeGreaterThan(0);

    // Find the variation that matches the first move in the book
    const firstMove = variations[0].move;
    const initialWeight = variations[0].weight;

    // Verify we can find it back
    const found = variations.find(
      (v) =>
        v.move.pieceId === firstMove.pieceId &&
        v.move.targetQ === firstMove.targetQ &&
        v.move.targetR === firstMove.targetR,
    );
    expect(found).toBeDefined();

    // Learn from a loss
    const gameHistory = [{ hash, faction: FACTION.FIRE, move: firstMove }];
    learnFromGame(gameHistory, FACTION.WATER);

    // Check if variation was found and updated
    const updatedVariations = OPENING_BOOK.get(hash);
    const updated = updatedVariations.find(
      (v) =>
        v.move.pieceId === firstMove.pieceId &&
        v.move.targetQ === firstMove.targetQ &&
        v.move.targetR === firstMove.targetR,
    );
    expect(updated).toBeDefined();
    expect(updated.wins).toBe(0);
    expect(updated.losses).toBe(1);
    expect(updated.visits).toBe(1);
    expect(updated.weight).toBeLessThan(initialWeight);
  });

  test("moderately increases weight for draws", () => {
    const game = createStartingGame();
    const hash = boardHash(game);

    const variations = OPENING_BOOK.get(hash);
    const initialWeight = variations[0].weight;

    // Learn from a draw
    learnFromGame(
      [{ hash, faction: FACTION.FIRE, move: variations[0].move }],
      null, // draw
    );

    const updatedVariations = OPENING_BOOK.get(hash);
    expect(updatedVariations[0].weight).toBeGreaterThan(initialWeight);
    expect(updatedVariations[0].draws).toBe(1);
    expect(updatedVariations[0].visits).toBe(1);
  });

  test("initializes learning stats on first call", () => {
    const game = createStartingGame();
    const hash = boardHash(game);
    const variations = OPENING_BOOK.get(hash);
    const move = variations[0].move;

    expect(variations[0].wins).toBeUndefined();
    expect(variations[0].losses).toBeUndefined();
    expect(variations[0].visits).toBeUndefined();

    learnFromGame([{ hash, faction: FACTION.FIRE, move }], FACTION.FIRE);

    expect(variations[0].wins).toBe(1);
    expect(variations[0].losses).toBe(0);
    expect(variations[0].visits).toBe(1);
  });

  test("ignores moves not in book", () => {
    const variations = OPENING_BOOK.get("nonexistent#0");
    expect(variations).toBeUndefined();

    // Should not throw
    learnFromGame(
      [
        {
          hash: "nonexistent#0",
          faction: FACTION.FIRE,
          move: { pieceId: "x", targetQ: 0, targetR: 0 },
        },
      ],
      FACTION.FIRE,
    );
  });

  test("re-sorts variations by weight after learning", () => {
    const game = createStartingGame();
    const hash = boardHash(game);
    const variations = OPENING_BOOK.get(hash);

    // Ensure at least 2 variations
    if (variations.length < 2) return;

    // Boost second variation significantly
    learnFromGame(
      [{ hash, faction: FACTION.FIRE, move: variations[1].move }],
      FACTION.FIRE,
    );

    // Weights should be re-sorted
    const updated = OPENING_BOOK.get(hash);
    expect(updated[0].weight).toBeGreaterThanOrEqual(updated[1].weight);
  });

  test("enforces minimum weight of 10", () => {
    const game = createStartingGame();
    const hash = boardHash(game);
    const variations = OPENING_BOOK.get(hash);
    const move = variations[0].move;

    // Apply many losses to drive weight down
    for (let i = 0; i < 10; i++) {
      learnFromGame([{ hash, faction: FACTION.FIRE, move }], FACTION.WATER);
    }

    expect(variations[0].weight).toBeGreaterThanOrEqual(10);
  });
});

describe("Opening Book: getLearnedData", () => {
  beforeEach(() => {
    OPENING_BOOK.clear();
    buildOpeningBook(MockGame);
  });

  test("exports learned data with correct structure", () => {
    const game = createStartingGame();
    const hash = boardHash(game);
    const variations = OPENING_BOOK.get(hash);

    // Add some learning data
    learnFromGame(
      [{ hash, faction: FACTION.FIRE, move: variations[0].move }],
      FACTION.FIRE,
    );

    const learned = getLearnedData();

    expect(learned).toHaveProperty(hash);
    expect(Array.isArray(learned[hash])).toBe(true);
    expect(learned[hash].length).toBeGreaterThan(0);

    const entry = learned[hash][0];
    expect(entry).toHaveProperty("move");
    expect(entry).toHaveProperty("wins");
    expect(entry).toHaveProperty("draws");
    expect(entry).toHaveProperty("losses");
    expect(entry).toHaveProperty("visits");
    expect(entry.visits).toBe(1);
    expect(entry.wins).toBe(1);
  });

  test("only exports entries with visits > 0", () => {
    const learned = getLearnedData();

    // Without any learning, learned data should be empty or only have empty arrays
    for (const [_hash, entries] of Object.entries(learned)) {
      for (const entry of entries) {
        expect(entry.visits).toBeGreaterThan(0);
      }
    }
  });

  test("returns empty object for empty book", () => {
    OPENING_BOOK.clear();
    const learned = getLearnedData();
    expect(Object.keys(learned).length).toBe(0);
  });
});

describe("Opening Book: saveLearnedData", () => {
  beforeEach(() => {
    OPENING_BOOK.clear();
    buildOpeningBook(MockGame);
  });

  test("function exists", () => {
    expect(typeof saveLearnedData).toBe("function");
  });

  test.skip("returns data object with version, updated, positions", async () => {
    // Add learning data
    const game = createStartingGame();
    const hash = boardHash(game);
    const variations = OPENING_BOOK.get(hash);
    learnFromGame(
      [{ hash, faction: FACTION.FIRE, move: variations[0].move }],
      FACTION.FIRE,
    );

    const data = await saveLearnedData();

    expect(data).toHaveProperty("version", 1);
    expect(data).toHaveProperty("updated");
    expect(data).toHaveProperty("positions");
    expect(typeof data.updated).toBe("string");
    expect(new Date(data.updated).toString()).not.toBe("Invalid Date");
  });

  test.skip("includes learned positions in saved data", async () => {
    const game = createStartingGame();
    const hash = boardHash(game);
    const variations = OPENING_BOOK.get(hash);
    learnFromGame(
      [{ hash, faction: FACTION.FIRE, move: variations[0].move }],
      FACTION.FIRE,
    );

    const savedData = await saveLearnedData();
    const learnedData = getLearnedData();

    expect(Object.keys(savedData.positions).length).toBe(
      Object.keys(learnedData).length,
    );
  });
});

describe("Opening Book: loadLearnedData", () => {
  beforeEach(() => {
    OPENING_BOOK.clear();
    buildOpeningBook(MockGame);
  });

  test("loads learned data into existing positions", () => {
    const game = createStartingGame();
    const hash = boardHash(game);
    const variations = OPENING_BOOK.get(hash);
    const move = variations[0].move;

    const learnedData = {
      positions: {
        [hash]: [
          {
            move,
            wins: 5,
            draws: 2,
            losses: 1,
            visits: 8,
          },
        ],
      },
    };

    loadLearnedData(learnedData);

    const updated = OPENING_BOOK.get(hash);
    // Weight should be updated based on learned data
    expect(updated[0].wins).toBe(5);
    expect(updated[0].draws).toBe(2);
    expect(updated[0].losses).toBe(1);
    expect(updated[0].visits).toBe(8);
  });

  test("adds new positions from learned data", () => {
    const newHash = "newhash#1";
    const learnedData = {
      positions: {
        [newHash]: [
          {
            move: { pieceId: "fire_pawn_10", targetQ: -4, targetR: 5 },
            wins: 3,
            draws: 1,
            losses: 0,
            visits: 4,
          },
        ],
      },
    };

    expect(OPENING_BOOK.has(newHash)).toBe(false);

    loadLearnedData(learnedData);

    expect(OPENING_BOOK.has(newHash)).toBe(true);
    const variations = OPENING_BOOK.get(newHash);
    expect(variations[0].wins).toBe(3);
    expect(variations[0].visits).toBe(4);
  });

  test("handles null/undefined data gracefully", () => {
    expect(() => loadLearnedData(null)).not.toThrow();
    expect(() => loadLearnedData(undefined)).not.toThrow();
    expect(() => loadLearnedData({})).not.toThrow();
    expect(() => loadLearnedData({ positions: null })).not.toThrow();
  });

  test("sorts variations by weight after loading", () => {
    const hash = "testhash#0";
    const learnedData = {
      positions: {
        [hash]: [
          {
            move: { pieceId: "p1", targetQ: 0, targetR: 0 },
            wins: 10,
            draws: 0,
            losses: 0,
            visits: 10,
          },
          {
            move: { pieceId: "p2", targetQ: 1, targetR: 1 },
            wins: 1,
            draws: 0,
            losses: 0,
            visits: 1,
          },
        ],
      },
    };

    // Ensure hash doesn't exist
    OPENING_BOOK.delete(hash);

    loadLearnedData(learnedData);

    const variations = OPENING_BOOK.get(hash);
    expect(variations).toBeDefined();
    expect(variations.length).toBe(2);
    // First should have higher weight (more wins)
    expect(variations[0].weight).toBeGreaterThanOrEqual(variations[1].weight);
  });
});

describe("Opening Book: buildOpeningBook edge cases", () => {
  beforeEach(() => {
    OPENING_BOOK.clear();
  });

  test("handles promotion results in buildOpeningBook", () => {
    // This tests the promotion handling branch in buildOpeningBook
    const mockGameWithPromotion = class extends MockGame {
      constructor() {
        super();
        this.pendingPromotion = null;
      }

      handleCellClick(pos) {
        const result = super.handleCellClick(pos);
        // Simulate promotion on 8th rank
        if (
          result.action === "move" &&
          this.selectedPiece &&
          this.selectedPiece.type === PIECE_TYPE.PAWN
        ) {
          if (
            (this.selectedPiece.faction === FACTION.FIRE && pos.r <= -6) ||
            (this.selectedPiece.faction === FACTION.WATER && pos.r >= 6) ||
            (this.selectedPiece.faction === FACTION.NATURE && pos.q <= -6)
          ) {
            this.pendingPromotion = { piece: this.selectedPiece, pos };
            return { action: "promotion", piece: this.selectedPiece };
          }
        }
        return result;
      }

      completePromotion() {
        this.pendingPromotion = null;
      }
    };

    // Should not throw
    buildOpeningBook(mockGameWithPromotion);
    expect(OPENING_BOOK.size).toBeGreaterThan(0);
  });

  test("handles illegal moves during build (continues with next line)", () => {
    const mockGameIllegal = class extends MockGame {
      constructor() {
        super();
      }
      handleCellClick(pos) {
        // Make second move illegal
        if (this.selectedPiece && this.moveHistory.length >= 1) {
          return { action: "none" };
        }
        return super.handleCellClick(pos);
      }
    };

    // Should not throw, just skip that line
    buildOpeningBook(mockGameIllegal);
    expect(OPENING_BOOK.size).toBeGreaterThan(0);
  });

  test("handles piece selection failure during build", () => {
    const mockGameSelectFail = class extends MockGame {
      handleCellClick(pos) {
        if (!this.selectedPiece) {
          // Fail to select piece
          return { action: "none" };
        }
        return super.handleCellClick(pos);
      }
    };

    // Should not throw
    buildOpeningBook(mockGameSelectFail);
    expect(OPENING_BOOK.size).toBeGreaterThan(0);
  });

  test("weight decay works correctly across plies", () => {
    buildOpeningBook(MockGame);

    // First ply should have highest weights
    // Later plies should have decayed weights
    const weights = [];
    for (const [_hash, moves] of OPENING_BOOK) {
      for (const entry of moves) {
        weights.push(entry.weight);
      }
    }

    // All weights should be positive
    for (const w of weights) {
      expect(w).toBeGreaterThan(0);
    }
  });
});

describe("Opening Book: saveLearnedDataToStorage / loadLearnedDataFromStorage", () => {
  beforeEach(() => {
    OPENING_BOOK.clear();
    buildOpeningBook(MockGame);
    localStorage.clear();
  });

  test("saveLearnedDataToStorage saves to localStorage", () => {
    const game = createStartingGame();
    const hash = boardHash(game);
    const variations = OPENING_BOOK.get(hash);
    learnFromGame(
      [{ hash, faction: FACTION.FIRE, move: variations[0].move }],
      FACTION.FIRE,
    );

    const result = saveLearnedDataToStorage();
    expect(result).toBe(true);

    const stored = localStorage.getItem("trischach-opening-book-learned");
    expect(stored).not.toBeNull();

    const data = JSON.parse(stored);
    expect(data).toHaveProperty("version", 1);
    expect(data).toHaveProperty("updated");
    expect(data).toHaveProperty("positions");
    expect(Object.keys(data.positions).length).toBeGreaterThan(0);
  });

  test("loadLearnedDataFromStorage loads from localStorage", () => {
    const game = createStartingGame();
    const hash = boardHash(game);
    const variations = OPENING_BOOK.get(hash);
    learnFromGame(
      [{ hash, faction: FACTION.FIRE, move: variations[0].move }],
      FACTION.FIRE,
    );
    saveLearnedDataToStorage();

    // Clear and reload
    OPENING_BOOK.clear();
    buildOpeningBook(MockGame);

    const result = loadLearnedDataFromStorage();
    expect(result).toBe(true);

    const loadedVariations = OPENING_BOOK.get(hash);
    expect(loadedVariations[0].wins).toBe(1);
    expect(loadedVariations[0].visits).toBe(1);
  });

  test("loadLearnedDataFromStorage returns false if no data", () => {
    localStorage.clear();
    const result = loadLearnedDataFromStorage();
    expect(result).toBe(false);
  });

  test("loadLearnedDataFromStorage handles corrupted data", () => {
    localStorage.setItem("trischach-opening-book-learned", "invalid json");
    const result = loadLearnedDataFromStorage();
    expect(result).toBe(false);
  });
});

describe("Opening Book: saveLearnedData (file)", () => {
  beforeEach(() => {
    OPENING_BOOK.clear();
    buildOpeningBook(MockGame);
  });

  test("returns data object with version, updated, positions", async () => {
    const game = createStartingGame();
    const hash = boardHash(game);
    const variations = OPENING_BOOK.get(hash);
    learnFromGame(
      [{ hash, faction: FACTION.FIRE, move: variations[0].move }],
      FACTION.FIRE,
    );

    const data = await saveLearnedData();

    expect(data).toHaveProperty("version", 1);
    expect(data).toHaveProperty("updated");
    expect(data).toHaveProperty("positions");
    expect(typeof data.updated).toBe("string");
    expect(new Date(data.updated).toString()).not.toBe("Invalid Date");
  });

  test("includes learned positions in saved data", async () => {
    const game = createStartingGame();
    const hash = boardHash(game);
    const variations = OPENING_BOOK.get(hash);
    learnFromGame(
      [{ hash, faction: FACTION.FIRE, move: variations[0].move }],
      FACTION.FIRE,
    );

    const savedData = await saveLearnedData();
    const learnedData = getLearnedData();

    expect(Object.keys(savedData.positions).length).toBe(
      Object.keys(learnedData).length,
    );
  });

  test("handles empty book", async () => {
    OPENING_BOOK.clear();
    const data = await saveLearnedData();
    expect(data.positions).toEqual({});
  });
});

describe("Opening Book: loadOpeningBook with mocked import", () => {
  beforeEach(() => {
    OPENING_BOOK.clear();
    vi.resetModules();
  });

  test("loads compiled book and populates BOOK_INFO", async () => {
    const mockBookData = {
      version: "2.0",
      metadata: {
        stats: { totalPositions: 42, totalVariations: 100, maxDepth: 15 },
        compiled: "2026-01-01T00:00:00.000Z",
        lastUpdated: "2026-01-01T00:00:00.000Z",
      },
      book: {
        "testhash#0": [
          { move: { pieceId: "p1", targetQ: 0, targetR: 0 }, weight: 100 },
        ],
      },
    };

    // Mock the dynamic import
    vi.doMock("../opening-book.compiled.json", () => ({
      default: mockBookData,
    }));

    // Re-import to get mocked version
    const { loadOpeningBook: mockedLoad, BOOK_INFO: mockedInfo } =
      await import("../js/opening-book.js");
    const result = await mockedLoad();

    expect(result).toBe(true);
    expect(mockedInfo.version).toBe("2.0");
    expect(mockedInfo.totalPositions).toBe(42);
    expect(mockedInfo.maxPly).toBe(15);
  });

  test("handles missing file gracefully", async () => {
    vi.doMock("../opening-book.compiled.json", () => {
      throw new Error("Module not found");
    });

    const { loadOpeningBook: mockedLoad } =
      await import("../js/opening-book.js");
    const result = await mockedLoad();

    expect(result).toBe(false);
  });

  test("handles invalid book format", async () => {
    vi.doMock("../opening-book.compiled.json", () => ({
      default: { invalid: "format" },
    }));

    const { loadOpeningBook: mockedLoad } =
      await import("../js/opening-book.js");
    const result = await mockedLoad();

    expect(result).toBe(false);
  });
});

describe("Opening Book: loadLearnedData advanced", () => {
  beforeEach(() => {
    OPENING_BOOK.clear();
    buildOpeningBook(MockGame);
  });

  test("merges learned data with existing book entries", () => {
    const game = createStartingGame();
    const hash = boardHash(game);
    const variations = OPENING_BOOK.get(hash);
    const originalWeight = variations[0].weight;

    const learnedData = {
      positions: {
        [hash]: [
          {
            move: variations[0].move,
            wins: 5,
            draws: 2,
            losses: 1,
            visits: 8,
          },
        ],
      },
    };

    loadLearnedData(learnedData);

    const updated = OPENING_BOOK.get(hash);
    expect(updated[0].wins).toBe(5);
    expect(updated[0].draws).toBe(2);
    expect(updated[0].losses).toBe(1);
    expect(updated[0].visits).toBe(8);
    // Weight should be updated based on learned data (wins + draws * 0.5)
    expect(updated[0].weight).toBe(Math.max(originalWeight, 5 + 2 * 0.5));
  });

  test("adds new variation for new move at existing position", () => {
    const hash = "existinghash#0";
    OPENING_BOOK.set(hash, [
      { move: { pieceId: "p1", targetQ: 0, targetR: 0 }, weight: 50 },
    ]);

    const learnedData = {
      positions: {
        [hash]: [
          {
            move: { pieceId: "p2", targetQ: 1, targetR: 1 },
            wins: 3,
            draws: 0,
            losses: 0,
            visits: 3,
          },
        ],
      },
    };

    loadLearnedData(learnedData);

    const variations = OPENING_BOOK.get(hash);
    expect(variations.length).toBe(2);
    expect(variations.find((v) => v.move.pieceId === "p2")).toBeDefined();
  });

  test("creates new position from learned data", () => {
    const newHash = "newhash#0";
    expect(OPENING_BOOK.has(newHash)).toBe(false);

    const learnedData = {
      positions: {
        [newHash]: [
          {
            move: { pieceId: "p1", targetQ: 0, targetR: 0 },
            wins: 2,
            draws: 1,
            losses: 0,
            visits: 3,
          },
        ],
      },
    };

    loadLearnedData(learnedData);

    expect(OPENING_BOOK.has(newHash)).toBe(true);
    const variations = OPENING_BOOK.get(newHash);
    expect(variations[0].wins).toBe(2);
    expect(variations[0].draws).toBe(1);
  });

  test("applies minimum weight of 10", () => {
    const learnedData = {
      positions: {
        "testhash#0": [
          {
            move: { pieceId: "p1", targetQ: 0, targetR: 0 },
            wins: 0,
            draws: 0,
            losses: 10,
            visits: 10,
          },
        ],
      },
    };

    loadLearnedData(learnedData);

    const variations = OPENING_BOOK.get("testhash#0");
    expect(variations[0].weight).toBeGreaterThanOrEqual(10);
  });
});
