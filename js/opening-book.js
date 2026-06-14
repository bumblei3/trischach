/**
 * TriSchach Opening Book - Runtime Loader
 *
 * Loads pre-compiled opening book from JSON.
 * Generation is done via generate-opening-book.js
 */

import { FACTION, generateBoard } from "./board.js";
import { Hex } from "./hex.js";

// Opening book storage (loaded from compiled JSON)
const OPENING_BOOK = new Map();

// Book metadata
export const BOOK_INFO = {
  version: "1.0",
  maxPly: 9,
  totalPositions: 0,
  lastUpdated: null,
  compiledAt: null,
};

// ---------------------------------------------------------------------------
// Helper: Generate board hash (matches ai.js exactly)
// ---------------------------------------------------------------------------
export function boardHash(game) {
  const pieces = game
    .getAlivePieces()
    .filter((p) => p.alive)
    .map((p) => `${p.faction[0]}${p.type[0]}${p.pos.q},${p.pos.r}`)
    .sort()
    .join("|");
  return `${pieces}#${game.currentFactionIdx}`;
}

// ---------------------------------------------------------------------------
// Parse move helper (for buildOpeningBook)
// ---------------------------------------------------------------------------
export function parseMove(game, moveStr) {
  const [piecePart, targetPart] = moveStr.split("->").map((s) => s.trim());
  const piece = game.pieces.find((p) => p.id === piecePart);
  if (!piece) return null;

  const [q, r] = targetPart.split(",").map(Number);
  if (isNaN(q) || isNaN(r)) return null;

  return { piece, target: new Hex(q, r) };
}

// ---------------------------------------------------------------------------
// LOAD COMPILED BOOK FROM JSON (async, for production)
// ---------------------------------------------------------------------------
let _bookLoaded = false;

export async function loadOpeningBook() {
  if (_bookLoaded) return true;

  try {
    // Use dynamic import for ES modules
    const module = await import("../opening-book.compiled.json");
    const data = module.default;

    if (!data || !data.book) {
      console.warn("Opening book: Invalid compiled format");
      return false;
    }

    // Load book into Map
    OPENING_BOOK.clear();
    for (const [hash, variations] of Object.entries(data.book)) {
      OPENING_BOOK.set(hash, variations);
    }

    BOOK_INFO.version = data.version;
    BOOK_INFO.maxPly = data.metadata.stats?.maxDepth || 9;
    BOOK_INFO.totalPositions =
      data.metadata.stats?.totalPositions || OPENING_BOOK.size;
    BOOK_INFO.lastUpdated = data.metadata.lastUpdated;
    BOOK_INFO.compiledAt = data.metadata.compiled;

    _bookLoaded = true;
    console.log(
      `Opening book loaded: ${BOOK_INFO.totalPositions} positions from ${data.metadata.compiled}`,
    );
    return true;
  } catch (error) {
    console.warn("Opening book: Failed to load compiled book:", error.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// BUILD BOOK FROM SOURCE (for testing / development)
// ---------------------------------------------------------------------------

/**
 * Builds the opening book by simulating lines from a Game instance.
 * This is kept for testing and development.
 * Call this once at startup after Game class is loaded.
 */
export function buildOpeningBook(GameClass) {
  OPENING_BOOK.clear();

  // These are the hardcoded opening lines - kept for testing
  const openingLines = [
    // Fire lines
    {
      name: "Fire Main",
      moves: [
        "fire_pawn_10 -> -4,5",
        "water_pawn_25 -> 0,2",
        "nature_pawn_40 -> -1,1",
        "fire_knight_1 -> -5,5",
        "water_knight_16 -> 0,0",
        "nature_knight_31 -> 0,0",
        "fire_pawn_11 -> -3,5",
        "water_pawn_26 -> 0,3",
      ],
      weight: 100,
    },
    {
      name: "Fire Aggressive",
      moves: [
        "fire_pawn_10 -> -4,5",
        "water_pawn_25 -> 0,2",
        "nature_pawn_40 -> -1,1",
        "fire_pawn_10 -> -4,4",
        "water_knight_16 -> 0,0",
        "nature_knight_31 -> 0,0",
        "fire_bishop_2 -> -4,5",
        "water_bishop_17 -> 0,1",
      ],
      weight: 85,
    },
    {
      name: "Fire Solid",
      moves: [
        "fire_knight_1 -> -5,5",
        "water_knight_16 -> 0,0",
        "nature_knight_31 -> 0,0",
        "fire_knight_6 -> 0,5",
        "water_knight_21 -> 0,5",
        "nature_knight_36 -> -5,5",
        "fire_bishop_2 -> -4,5",
        "water_bishop_17 -> 0,1",
      ],
      weight: 90,
    },
    {
      name: "Fire Flank",
      moves: [
        "fire_pawn_14 -> 0,5",
        "water_pawn_29 -> 0,5",
        "nature_pawn_44 -> -5,5",
        "fire_pawn_13 -> -1,5",
        "water_pawn_28 -> 0,4",
        "nature_pawn_43 -> -4,5",
        "fire_rook_7 -> 0,6",
        "water_rook_22 -> 0,5",
      ],
      weight: 75,
    },
    // Water lines
    {
      name: "Water Main",
      moves: [
        "fire_pawn_10 -> -4,5",
        "water_pawn_25 -> 0,2",
        "nature_pawn_40 -> -1,1",
        "fire_knight_1 -> -5,5",
        "water_knight_16 -> 0,0",
        "nature_knight_31 -> 0,0",
        "fire_pawn_11 -> -3,5",
        "water_pawn_26 -> 0,3",
      ],
      weight: 100,
    },
    {
      name: "Water Aggressive",
      moves: [
        "fire_pawn_10 -> -4,5",
        "water_pawn_25 -> 0,2",
        "nature_pawn_40 -> -1,1",
        "fire_pawn_10 -> -4,4",
        "water_pawn_25 -> 0,1",
        "nature_knight_31 -> 0,0",
        "fire_bishop_2 -> -4,5",
        "water_queen_18 -> 0,2",
      ],
      weight: 85,
    },
    {
      name: "Water Solid",
      moves: [
        "fire_knight_1 -> -5,5",
        "water_knight_16 -> 0,0",
        "nature_knight_31 -> 0,0",
        "fire_knight_6 -> 0,5",
        "water_knight_21 -> 0,5",
        "nature_knight_36 -> -5,5",
        "fire_bishop_2 -> -4,5",
        "water_bishop_17 -> 0,1",
      ],
      weight: 90,
    },
    {
      name: "Water Flank",
      moves: [
        "fire_pawn_14 -> 0,5",
        "water_pawn_29 -> 0,5",
        "nature_pawn_44 -> -5,5",
        "fire_pawn_13 -> -1,5",
        "water_pawn_28 -> 0,4",
        "nature_pawn_43 -> -4,5",
        "fire_rook_7 -> 0,6",
        "water_rook_22 -> 0,5",
      ],
      weight: 75,
    },
    // Nature lines
    {
      name: "Nature Main",
      moves: [
        "fire_pawn_10 -> -4,5",
        "water_pawn_25 -> 0,2",
        "nature_pawn_40 -> -1,1",
        "fire_knight_1 -> -5,5",
        "water_knight_16 -> 0,0",
        "nature_knight_31 -> 0,0",
        "fire_pawn_11 -> -3,5",
        "water_pawn_26 -> 0,3",
        "nature_pawn_41 -> -2,2",
      ],
      weight: 100,
    },
    {
      name: "Nature Aggressive",
      moves: [
        "fire_pawn_10 -> -4,5",
        "water_pawn_25 -> 0,2",
        "nature_pawn_40 -> -1,1",
        "fire_pawn_10 -> -4,4",
        "water_knight_16 -> 0,0",
        "nature_pawn_40 -> -2,2",
        "fire_bishop_2 -> -4,5",
        "water_queen_18 -> 0,2",
        "nature_queen_33 -> -1,3",
      ],
      weight: 85,
    },
    {
      name: "Nature Solid",
      moves: [
        "fire_knight_1 -> -5,5",
        "water_knight_16 -> 0,0",
        "nature_knight_31 -> 0,0",
        "fire_knight_6 -> 0,5",
        "water_knight_21 -> 0,5",
        "nature_knight_36 -> -5,5",
        "fire_bishop_2 -> -4,5",
        "water_bishop_17 -> 0,1",
        "nature_bishop_32 -> -1,1",
      ],
      weight: 90,
    },
    {
      name: "Nature Flank",
      moves: [
        "fire_pawn_14 -> 0,5",
        "water_pawn_29 -> 0,5",
        "nature_pawn_38 -> 0,0",
        "fire_pawn_13 -> -1,5",
        "water_pawn_28 -> 0,4",
        "nature_pawn_39 -> -1,1",
        "fire_rook_7 -> 0,6",
        "water_rook_22 -> 0,5",
        "nature_rook_30 -> 0,-1",
      ],
      weight: 75,
    },
  ];

  for (const line of openingLines) {
    // Create a fresh game for each line
    const game = new GameClass();
    const cells = generateBoard();
    game.init(cells);

    let currentWeight = line.weight;

    for (let i = 0; i < line.moves.length; i++) {
      const hash = boardHash(game);
      const moveStr = line.moves[i];
      const parsed = parseMove(game, moveStr);

      if (!parsed) {
        console.warn(
          `Opening book (${line.name}): Invalid move ${moveStr} at ply ${i}`,
        );
        break;
      }

      const entry = {
        pieceId: parsed.piece.id,
        targetQ: parsed.target.q,
        targetR: parsed.target.r,
      };

      if (!OPENING_BOOK.has(hash)) {
        OPENING_BOOK.set(hash, []);
      }
      const variations = OPENING_BOOK.get(hash);

      const exists = variations.some(
        (v) =>
          v.move.pieceId === entry.pieceId &&
          v.move.targetQ === entry.targetQ &&
          v.move.targetR === entry.targetR,
      );

      if (!exists) {
        variations.push({ move: entry, weight: currentWeight });
      }

      // Actually make the move on the game
      const selectResult = game.handleCellClick(parsed.piece.pos);
      if (!selectResult || selectResult.action !== "select") {
        console.warn(
          `Opening book (${line.name}): Failed to select piece ${parsed.piece.id} at ply ${i}`,
        );
        break;
      }
      const result = game.handleCellClick(parsed.target);
      if (result && (result.action === "move" || result.action === "combat")) {
        // Move was made, game state advanced
      } else if (result && result.promotion) {
        game.completePromotion("queen");
      } else {
        // Move failed (illegal) - stop this line
        console.warn(
          `Opening book (${line.name}): Move ${moveStr} failed at ply ${i}`,
        );
        break;
      }

      currentWeight = Math.max(currentWeight * 0.85, 10);
    }
  }

  BOOK_INFO.totalPositions = OPENING_BOOK.size;
  console.log(`Opening book built: ${BOOK_INFO.totalPositions} positions`);
}

// ---------------------------------------------------------------------------
// QUERY FUNCTIONS
// ---------------------------------------------------------------------------

/**
 * Get book moves for current position.
 * Returns array of { move: {pieceId, targetQ, targetR}, weight } sorted by weight desc.
 * Returns null if position not in book.
 */
export function getBookMoves(game) {
  const hash = boardHash(game);
  const moves = OPENING_BOOK.get(hash);
  if (!moves || moves.length === 0) return null;

  // Sort by weight descending
  return [...moves].sort((a, b) => b.weight - a.weight);
}

/**
 * Pick a move from book using weighted random selection.
 * Returns { piece, target } or null if no book move.
 */
export function pickBookMove(game) {
  const bookMoves = getBookMoves(game);
  if (!bookMoves) return null;

  // Weighted random
  const totalWeight = bookMoves.reduce((sum, m) => sum + m.weight, 0);
  let rand = Math.random() * totalWeight;

  for (const entry of bookMoves) {
    rand -= entry.weight;
    if (rand <= 0) {
      const piece = game.pieces.find((p) => p.id === entry.move.pieceId);
      if (piece && piece.alive) {
        return {
          piece,
          target: new Hex(entry.move.targetQ, entry.move.targetR),
        };
      }
    }
  }

  // Fallback to first move
  const entry = bookMoves[0];
  const piece = game.pieces.find((p) => p.id === entry.move.pieceId);
  if (piece && piece.alive) {
    return {
      piece,
      target: new Hex(entry.move.targetQ, entry.move.targetR),
    };
  }

  return null;
}

/**
 * Check if we're still in book (position has entries).
 */
export function inBook(game) {
  const hash = boardHash(game);
  return OPENING_BOOK.has(hash) && OPENING_BOOK.get(hash).length > 0;
}

/**
 * Get book statistics.
 */
export function getBookStats() {
  return {
    positions: OPENING_BOOK.size,
    totalVariations: Array.from(OPENING_BOOK.values()).reduce(
      (sum, arr) => sum + arr.length,
      0,
    ),
    maxPly: BOOK_INFO.maxPly,
  };
}

// ---------------------------------------------------------------------------
// EXPORT FOR DEBUGGING
// ---------------------------------------------------------------------------
export { OPENING_BOOK };

// ---------------------------------------------------------------------------
// LEARNING INTEGRATION
// ---------------------------------------------------------------------------
// Weighted learning from game results

/** Update opening book weights based on a completed game */
export function learnFromGame(gameHistory, winnerFaction) {
  // gameHistory: array of { hash, faction, move: {pieceId, targetQ, targetR} }
  // winnerFaction: 'fire' | 'water' | 'nature' | null (draw)

  for (const entry of gameHistory) {
    const variations = OPENING_BOOK.get(entry.hash);
    if (!variations) continue;

    const variation = variations.find(
      (v) =>
        v.move.pieceId === entry.move.pieceId &&
        v.move.targetQ === entry.move.targetQ &&
        v.move.targetR === entry.move.targetR,
    );

    if (!variation) continue;

    // Initialize learning stats if not present
    if (variation.wins === undefined) {
      variation.wins = 0;
      variation.draws = 0;
      variation.losses = 0;
      variation.visits = 0;
    }

    variation.visits++;
    const isWinner = entry.faction === winnerFaction;
    const isDraw = winnerFaction === null;

    if (isWinner) {
      variation.wins++;
      variation.weight = Math.round(variation.weight * 1.3);
    } else if (isDraw) {
      variation.draws++;
      variation.weight = Math.round(variation.weight * 1.1);
    } else {
      variation.losses++;
      variation.weight = Math.round(variation.weight * 0.7);
    }

    variation.weight = Math.max(variation.weight, 10);
  }

  // Re-sort variations by weight
  for (const [hash, variations] of OPENING_BOOK.entries()) {
    variations.sort((a, b) => b.weight - a.weight);
  }
}

/** Export learned data for persistence */
export function getLearnedData() {
  const learned = {};
  for (const [hash, variations] of OPENING_BOOK.entries()) {
    learned[hash] = variations
      .filter((v) => v.visits > 0)
      .map((v) => ({
        move: v.move,
        wins: v.wins || 0,
        draws: v.draws || 0,
        losses: v.losses || 0,
        visits: v.visits || 0,
      }));
  }
  return learned;
}

const LEARNED_STORAGE_KEY = "trischach-opening-book-learned";

/** Save learned data to localStorage */
export function saveLearnedDataToStorage() {
  const data = {
    version: 1,
    updated: new Date().toISOString(),
    positions: getLearnedData(),
  };
  try {
    localStorage.setItem(LEARNED_STORAGE_KEY, JSON.stringify(data));
    console.log(
      `Opening book: Saved ${Object.keys(data.positions).length} learned positions`,
    );
    return true;
  } catch (e) {
    console.warn("Opening book: Failed to save learned data:", e);
    return false;
  }
}

/** Load learned data from localStorage */
export function loadLearnedDataFromStorage() {
  try {
    const stored = localStorage.getItem(LEARNED_STORAGE_KEY);
    if (!stored) return false;
    const data = JSON.parse(stored);
    if (!data || !data.positions) return false;

    loadLearnedData(data);
    console.log(
      `Opening book: Loaded ${Object.keys(data.positions).length} learned positions from storage`,
    );
    return true;
  } catch (e) {
    console.warn("Opening book: Failed to load learned data:", e);
    return false;
  }
}

/** Save learned data to JSON file (Node/legacy) */
export async function saveLearnedData(filePath = null) {
  const data = {
    version: 1,
    updated: new Date().toISOString(),
    positions: getLearnedData(),
  };

  // In browser/Node, we'd write to file
  // For now, return the data for external saving
  return data;
}

/** Load learned data from JSON */
export function loadLearnedData(data) {
  if (!data || !data.positions) return;

  for (const [hash, variations] of Object.entries(data.positions)) {
    if (!OPENING_BOOK.has(hash)) OPENING_BOOK.set(hash, []);
    const bookVariations = OPENING_BOOK.get(hash);

    for (const learned of variations) {
      const existing = bookVariations.find(
        (v) =>
          v.move.pieceId === learned.move.pieceId &&
          v.move.targetQ === learned.move.targetQ &&
          v.move.targetR === learned.move.targetR,
      );

      if (existing) {
        existing.wins = learned.wins;
        existing.draws = learned.draws;
        existing.losses = learned.losses;
        existing.visits = learned.visits;
        existing.weight = Math.max(
          existing.weight,
          learned.wins + learned.draws * 0.5,
        );
      } else {
        bookVariations.push({
          move: learned.move,
          weight: Math.max(10, learned.wins + learned.draws * 0.5),
          wins: learned.wins,
          draws: learned.draws,
          losses: learned.losses,
          visits: learned.visits,
        });
      }
    }

    bookVariations.sort((a, b) => b.weight - a.weight);
  }

  BOOK_INFO.totalPositions = OPENING_BOOK.size;
  console.log(
    `Opening book: Loaded ${Object.keys(data.positions).length} learned positions`,
  );
}
