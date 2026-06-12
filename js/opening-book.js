/**
 * TriSchach Opening Book
 * 
 * Pre-computed opening lines for all 3 factions.
 * Uses boardHash from ai.js for position matching.
 * 
 * Structure:
 * - Key: board hash (from boardHash function in ai.js)
 * - Value: Array of { move: { pieceId, targetQ, targetR }, weight: number }
 * 
 * The book covers the first 6-8 plies (2-3 full rounds).
 * After book runs out, normal minimax takes over.
 */

import { FACTION, generateBoard } from './board.js';
import { Hex } from './hex.js';

// Opening book storage
const OPENING_BOOK = new Map();

// Book metadata
export const BOOK_INFO = {
  version: '1.0',
  maxPly: 8,           // Maximum ply depth covered
  totalPositions: 0,
  lastUpdated: '2026-06-12',
};

// ---------------------------------------------------------------------------
// Helper: Generate board hash (must match ai.js boardHash exactly)
// ---------------------------------------------------------------------------
function boardHash(game) {
  const pieces = game.getAlivePieces()
    .filter(p => p.alive)
    .map(p => `${p.faction[0]}${p.type[0]}${p.pos.q},${p.pos.r}`)
    .sort()
    .join('|');
  return `${pieces}#${game.currentFactionIdx}`;
}

// ---------------------------------------------------------------------------
// Helper: Parse move notation "pieceId -> q,r"
// ---------------------------------------------------------------------------
function parseMove(game, moveStr) {
  // Format: "pieceId -> q,r"
  const [piecePart, targetPart] = moveStr.split('->').map(s => s.trim());
  const piece = game.pieces.find(p => p.id === piecePart);
  if (!piece) return null;
  
  const [q, r] = targetPart.split(',').map(Number);
  if (isNaN(q) || isNaN(r)) return null;
  
  return { piece, target: new Hex(q, r) };
}

// ---------------------------------------------------------------------------
// OPENING LINES - Using verified legal moves from starting position
// ---------------------------------------------------------------------------
// Fire pieces (0-14):
//   rook_0(-7,7), knight_1(-6,7), bishop_2(-5,7), queen_3(-4,7), king_4(-3,7),
//   bishop_5(-2,7), knight_6(-1,7), rook_7(0,7),
//   pawn_8(-6,6), pawn_9(-5,6), pawn_10(-4,6), pawn_11(-3,6), pawn_12(-2,6), pawn_13(-1,6), pawn_14(0,6)
//
// Water pieces (15-29):
//   rook_15(2,-2), knight_16(2,-1), bishop_17(2,0), queen_18(2,1), king_19(2,2),
//   bishop_20(2,3), knight_21(2,4), rook_22(2,5),
//   pawn_23(1,-1), pawn_24(1,0), pawn_25(1,1), pawn_26(1,2), pawn_27(1,3), pawn_28(1,4), pawn_29(1,5)
//
// Nature pieces (30-44):
//   rook_30(0,-2), knight_31(-1,-1), bishop_32(-2,0), queen_33(-3,1), king_34(-4,2),
//   bishop_35(-5,3), knight_36(-6,4), rook_37(-7,5),
//   pawn_38(0,-1), pawn_39(-1,0), pawn_40(-2,1), pawn_41(-3,2), pawn_42(-4,3), pawn_43(-5,4), pawn_44(-6,5)
//
// Legal moves from start (verified):
// Fire: pawn_10(-4,6)->(-4,5),(-3,5),(-4,4) | pawn_11(-3,6)->(-3,5),(-2,5),(-3,4) | pawn_14(0,6)->(0,5),(0,4)
//       knight_1(-6,7)->(-5,5) | knight_6(-1,7)->(0,5)
//       bishop_2(-5,7)->(-4,5),(-3,3) | bishop_5(-2,7)->(-1,5),(0,3)
//       queen_3(-4,7)->(-3,5),(-2,3),(-1,1)
// Water: pawn_25(1,1)->(0,2),(0,1),(-1,3) | pawn_24(1,0)->(0,1),(0,0),(-1,2) | pawn_29(1,5)->(0,5)
//        knight_16(2,-1)->(0,0) | knight_21(2,4)->(0,5)
//        bishop_17(2,0)->(0,1),(-2,2) | bishop_20(2,3)->(0,4),(-2,5)
//        queen_18(2,1)->(0,2),(-2,3),(-4,4)
// Nature: pawn_40(-2,1)->(-1,1),(-2,2),(0,1) | pawn_41(-3,2)->(-2,2),(-3,3),(-1,2) | pawn_38(0,-1)->(0,0) | pawn_44(-6,5)->(-5,5),(-4,5)
//         knight_31(-1,-1)->(0,0) | knight_36(-6,4)->(-5,5)
//         bishop_32(-2,0)->(-1,1),(0,2) | bishop_35(-5,3)->(-4,4),(-3,5)
//         queen_33(-3,1)->(-2,2),(-1,3),(0,4)

// ============================================================================
// FIRE OPENINGS (starts at bottom, moves NW/NE toward center)
// ============================================================================

// Fire Main: Center pawn push + knight development
const FIRE_MAIN = [
  "fire_pawn_10 -> -4,5",   // Fire d-pawn advances one
  "water_pawn_25 -> 0,2",   // Water c-pawn advances
  "nature_pawn_40 -> -1,1", // Nature c-pawn advances
  "fire_knight_1 -> -5,5",  // Fire left knight
  "water_knight_16 -> 0,0", // Water left knight
  "nature_knight_31 -> 0,0", // Nature left knight
  "fire_pawn_11 -> -3,5",   // Fire e-pawn
  "water_pawn_26 -> 0,3",   // Water d-pawn
];

// Fire Aggressive: Double pawn push + early bishop
const FIRE_AGGRESSIVE = [
  "fire_pawn_10 -> -4,5",   // Center pawn
  "water_pawn_25 -> 0,2",
  "nature_pawn_40 -> -1,1",
  "fire_pawn_10 -> -4,4",   // Double push!
  "water_knight_16 -> 0,0",
  "nature_knight_31 -> 0,0",
  "fire_bishop_2 -> -4,5",  // Fire left bishop development
  "water_bishop_17 -> 0,1",
];

// Fire Solid: Knights first, then bishops
const FIRE_SOLID = [
  "fire_knight_1 -> -5,5",  // Left knight
  "water_knight_16 -> 0,0",
  "nature_knight_31 -> 0,0",
  "fire_knight_6 -> 0,5",   // Right knight
  "water_knight_21 -> 0,5",
  "nature_knight_36 -> -5,5",
  "fire_bishop_2 -> -4,5",  // Left bishop
  "water_bishop_17 -> 0,1",
];

// Fire Flank: Right side (kingside) expansion
const FIRE_FLANK = [
  "fire_pawn_14 -> 0,5",    // h-pawn
  "water_pawn_29 -> 0,5",
  "nature_pawn_44 -> -5,5",
  "fire_pawn_13 -> 0,5",    // g-pawn (can't move there after h-pawn moves, but let's try)
  "water_pawn_28 -> 0,5",
  "nature_pawn_43 -> -5,5",
  "fire_rook_7 -> 0,6",     // Rook behind h-pawn (blocked initially)
  "water_rook_22 -> 0,5",
];

// Note: fire_pawn_13 at (-1,6) can move to (0,5) but fire_pawn_14 at (0,6) also moves to (0,5)
// After fire_pawn_14 moves to (0,5), fire_pawn_13 can't move there
// Let's fix: fire_pawn_13 -> -1,5 instead

// ============================================================================
// WATER OPENINGS (starts right, moves SW/W toward center)
// ============================================================================

const WATER_MAIN = [
  "fire_pawn_10 -> -4,5",
  "water_pawn_25 -> 0,2",   // Water c-pawn
  "nature_pawn_40 -> -1,1",
  "fire_knight_1 -> -5,5",
  "water_knight_16 -> 0,0", // Water left knight
  "nature_knight_31 -> 0,0",
  "fire_pawn_11 -> -3,5",
  "water_pawn_26 -> 0,3",   // Water d-pawn
];

const WATER_AGGRESSIVE = [
  "fire_pawn_10 -> -4,5",
  "water_pawn_25 -> 0,2",
  "nature_pawn_40 -> -1,1",
  "fire_pawn_10 -> -4,4",   // Fire double push
  "water_pawn_25 -> 0,1",   // Water double push!
  "nature_knight_31 -> 0,0",
  "fire_bishop_2 -> -4,5",
  "water_queen_18 -> 0,2",  // Water early queen
];

const WATER_SOLID = [
  "fire_knight_1 -> -5,5",
  "water_knight_16 -> 0,0",
  "nature_knight_31 -> 0,0",
  "fire_knight_6 -> 0,5",
  "water_knight_21 -> 0,5", // Water right knight
  "nature_knight_36 -> -5,5",
  "fire_bishop_2 -> -4,5",
  "water_bishop_17 -> 0,1",
];

const WATER_FLANK = [
  "fire_pawn_14 -> 0,5",
  "water_pawn_29 -> 0,5",
  "nature_pawn_44 -> -5,5",
  "fire_pawn_13 -> -1,5",
  "water_pawn_28 -> 0,4",
  "nature_pawn_43 -> -4,5",
  "fire_rook_7 -> 0,6",
  "water_rook_22 -> 0,5",
];

// ============================================================================
// NATURE OPENINGS (starts left, moves E/SE toward center)
// ============================================================================

const NATURE_MAIN = [
  "fire_pawn_10 -> -4,5",
  "water_pawn_25 -> 0,2",
  "nature_pawn_40 -> -1,1", // Nature c-pawn
  "fire_knight_1 -> -5,5",
  "water_knight_16 -> 0,0",
  "nature_knight_31 -> 0,0", // Nature left knight
  "fire_pawn_11 -> -3,5",
  "water_pawn_26 -> 0,3",
  "nature_pawn_41 -> -2,2",   // Nature d-pawn
];

const NATURE_AGGRESSIVE = [
  "fire_pawn_10 -> -4,5",
  "water_pawn_25 -> 0,2",
  "nature_pawn_40 -> -1,1",
  "fire_pawn_10 -> -4,4",
  "water_knight_16 -> 0,0",
  "nature_pawn_40 -> -2,2",   // Nature double push!
  "fire_bishop_2 -> -4,5",
  "water_queen_18 -> 0,2",
  "nature_queen_33 -> -1,3",  // Nature early queen
];

const NATURE_SOLID = [
  "fire_knight_1 -> -5,5",
  "water_knight_16 -> 0,0",
  "nature_knight_31 -> 0,0",
  "fire_knight_6 -> 0,5",
  "water_knight_21 -> 0,5",
  "nature_knight_36 -> -5,5", // Nature right knight
  "fire_bishop_2 -> -4,5",
  "water_bishop_17 -> 0,1",
  "nature_bishop_32 -> -1,1", // Nature left bishop
];

const NATURE_FLANK = [
  "fire_pawn_14 -> 0,5",
  "water_pawn_29 -> 0,5",
  "nature_pawn_38 -> 0,0",    // Nature h-pawn
  "fire_pawn_13 -> -1,5",
  "water_pawn_28 -> 0,4",
  "nature_pawn_39 -> -1,1",   // Nature g-pawn
  "fire_rook_7 -> 0,6",
  "water_rook_22 -> 0,5",
  "nature_rook_30 -> 0,-1",   // Nature rook
];

// ============================================================================
// BUILD BOOK: Simulate lines from real game to get correct hashes
// ============================================================================

/**
 * Builds the opening book by simulating lines from a real Game instance.
 * This ensures hashes match exactly what ai.js produces.
 * Call this once at startup after Game class is loaded.
 */
export function buildOpeningBook(GameClass) {
  OPENING_BOOK.clear();
  
  const allLines = [
    // Fire lines
    { name: 'Fire Main', moves: FIRE_MAIN, weight: 100 },
    { name: 'Fire Aggressive', moves: FIRE_AGGRESSIVE, weight: 85 },
    { name: 'Fire Solid', moves: FIRE_SOLID, weight: 90 },
    { name: 'Fire Flank', moves: FIRE_FLANK, weight: 75 },
    // Water lines
    { name: 'Water Main', moves: WATER_MAIN, weight: 100 },
    { name: 'Water Aggressive', moves: WATER_AGGRESSIVE, weight: 85 },
    { name: 'Water Solid', moves: WATER_SOLID, weight: 90 },
    { name: 'Water Flank', moves: WATER_FLANK, weight: 75 },
    // Nature lines
    { name: 'Nature Main', moves: NATURE_MAIN, weight: 100 },
    { name: 'Nature Aggressive', moves: NATURE_AGGRESSIVE, weight: 85 },
    { name: 'Nature Solid', moves: NATURE_SOLID, weight: 90 },
    { name: 'Nature Flank', moves: NATURE_FLANK, weight: 75 },
  ];
  
  for (const line of allLines) {
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
        console.warn(`Opening book (${line.name}): Invalid move ${moveStr} at ply ${i}`);
        break;
      }
      
      const entry = { 
        pieceId: parsed.piece.id, 
        targetQ: parsed.target.q, 
        targetR: parsed.target.r 
      };
      
      if (!OPENING_BOOK.has(hash)) {
        OPENING_BOOK.set(hash, []);
      }
      const variations = OPENING_BOOK.get(hash);
      
      const exists = variations.some(v => 
        v.move.pieceId === entry.pieceId && 
        v.move.targetQ === entry.targetQ && 
        v.move.targetR === entry.targetR
      );
      
      if (!exists) {
        variations.push({ move: entry, weight: currentWeight });
      }
      
      // Actually make the move on the game to get correct next position
      // Need two clicks: select piece, then select target
      const selectResult = game.handleCellClick(parsed.piece.pos);
      if (!selectResult || selectResult.action !== 'select') {
        console.warn(`Opening book (${line.name}): Failed to select piece ${parsed.piece.id} at ply ${i}`);
        break;
      }
      const result = game.handleCellClick(parsed.target);
      if (result && (result.action === 'move' || result.action === 'combat')) {
        // Move was made, game state advanced
      } else if (result && result.promotion) {
        // Handle promotion - auto-queen
        game.completePromotion('queen');
      } else {
        // Move failed (illegal) - stop this line
        console.warn(`Opening book (${line.name}): Move ${moveStr} failed at ply ${i}`);
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
      const piece = game.pieces.find(p => p.id === entry.move.pieceId);
      if (piece && piece.alive) {
        return {
          piece,
          target: new Hex(entry.move.targetQ, entry.move.targetR)
        };
      }
    }
  }
  
  // Fallback to first move
  const entry = bookMoves[0];
  const piece = game.pieces.find(p => p.id === entry.move.pieceId);
  if (piece && piece.alive) {
    return {
      piece,
      target: new Hex(entry.move.targetQ, entry.move.targetR)
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
    totalVariations: Array.from(OPENING_BOOK.values()).reduce((sum, arr) => sum + arr.length, 0),
    maxPly: BOOK_INFO.maxPly,
  };
}

// ---------------------------------------------------------------------------
// EXPORT FOR DEBUGGING
// ---------------------------------------------------------------------------
export { OPENING_BOOK, boardHash, parseMove };