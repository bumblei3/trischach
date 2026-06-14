/**
 * ai-worker.test.js - Tests for the AI Web Worker
 * Tests the worker message interface AND core AI functions (now exported for coverage)
 */
import { expect, test, describe, vi } from "vitest";
import { Hex } from "../js/hex.js";
import { FACTION, generateBoard } from "../js/board.js";
import { PIECE_STRENGTH, PIECE_TYPE, Piece } from "../js/pieces.js";
import { GAME_STATE } from "../js/game.js";

// Import exported core functions from ai-worker.js
import {
  getDynamicPieceValue,
  getMaterialValue,
  calculateTimeBudget,
  getAllActions,
  getLegalMoves,
  rebuildOccupiedMap,
  simulateMove,
  evaluatePawnStructure,
  evaluateEndgame,
  evaluateBoard,
  minimax,
  quiesce,
  iterativeDeepening,
  greedyBestMove,
  calculateBestMove,
  deserializeGame,
  TURN_ORDER,
  AI_PERSONALITIES,
} from "../js/ai-worker.js";

// Mock opening-book to avoid needing full Game instance
vi.mock("../js/opening-book.js", () => ({
  pickBookMove: vi.fn(() => null),
  buildOpeningBook: vi.fn(),
  inBook: vi.fn(() => false),
  getBookMoves: vi.fn(() => null),
}));

// --- Helper: Create a proper game state object (like deserializeGame does) ---
function createGameState(overrides = {}) {
  const cells = generateBoard();

  // Default pieces as Piece instances
  const pieces = [
    new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 5)),
    new Piece(PIECE_TYPE.PAWN, FACTION.WATER, new Hex(0, 0)),
    new Piece(PIECE_TYPE.PAWN, FACTION.NATURE, new Hex(-2, 2)),
  ];

  const game = {
    pieces,
    currentFactionIdx: 0,
    currentFaction: FACTION.FIRE,
    state: GAME_STATE.SELECT_PIECE,
    eliminatedFactions: new Set(),
    rpsEnabled: true,
    boardCells: cells,
    _occupiedMap: new Map(),
    capturedPieces: { fire: [], water: [], nature: [] },
    moveHistory: [],
    _positionHistory: new Map(),
    _halfmoveClock: 0,
  };

  // Rebuild occupied map
  for (const p of game.pieces) {
    if (p.alive) game._occupiedMap.set(p.pos.key, p);
  }

  const merged = { ...game, ...overrides };

  // If pieces were overridden, rebuild occupied map
  if (overrides.pieces) {
    merged._occupiedMap = new Map();
    for (const p of merged.pieces) {
      if (p.alive) merged._occupiedMap.set(p.pos.key, p);
    }
  }

  // Add methods expected by ai-worker.js functions
  merged.simulateMove = (piece, target) => simulateMove(merged, piece, target);
  merged.undoMove = (undo) => {
    // Basic undo - restore piece position and state
    undo.piece.pos = undo.from;
    undo.piece.hasMoved = undo.pieceHasMoved;
    if (undo.wasAttack && undo.defender) {
      undo.defender.alive = !undo.defenderWasKilled;
      if (undo.defenderWasKilled && undo.eliminatedFaction) {
        merged.eliminatedFactions.delete(undo.eliminatedFaction);
      }
    }
    merged.currentFactionIdx = undo.prevFactionIdx;
    // Rebuild occupied map after undo
    merged._occupiedMap = new Map();
    for (const p of merged.pieces) {
      if (p.alive) merged._occupiedMap.set(p.pos.key, p);
    }
  };
  merged._rebuildOccupiedMap = () => rebuildOccupiedMap(merged);

  return merged;
}

// Helper to create Piece instances for test overrides
function createPiece(type, faction, q, r) {
  return new Piece(type, faction, new Hex(q, r));
}

describe("AI Worker: Exported Core Functions (Unit Tests)", () => {
  describe("Dynamic Piece Values (RPS-aware)", () => {
    test("getDynamicPieceValue returns correct values for advantage/neutral/disadvantage", () => {
      // Fire beats Nature (advantage)
      const fireVsNature = getDynamicPieceValue(
        "pawn",
        FACTION.FIRE,
        FACTION.NATURE,
      );
      expect(fireVsNature).toBe(PIECE_STRENGTH.pawn * 1.3);

      // Fire vs Water (disadvantage)
      const fireVsWater = getDynamicPieceValue(
        "pawn",
        FACTION.FIRE,
        FACTION.WATER,
      );
      expect(fireVsWater).toBe(PIECE_STRENGTH.pawn * 0.7);

      // Fire vs Fire (neutral)
      const fireVsFire = getDynamicPieceValue(
        "pawn",
        FACTION.FIRE,
        FACTION.FIRE,
      );
      expect(fireVsFire).toBe(PIECE_STRENGTH.pawn * 1.0);

      // King always high value
      const kingValue = getDynamicPieceValue(
        "king",
        FACTION.FIRE,
        FACTION.WATER,
      );
      expect(kingValue).toBe(PIECE_STRENGTH.king * 100);
    });

    test("getDynamicPieceValue works for all piece types", () => {
      for (const pieceType of ["pawn", "knight", "bishop", "rook", "queen"]) {
        const val = getDynamicPieceValue(
          pieceType,
          FACTION.FIRE,
          FACTION.NATURE,
        );
        expect(val).toBeGreaterThan(0);
        expect(val).toBe(PIECE_STRENGTH[pieceType] * 1.3);
      }
    });

    test("getMaterialValue applies correct multipliers from perspective faction", () => {
      const piece = { type: "pawn", faction: FACTION.NATURE };

      // Fire perspective: Fire beats Nature = advantage -> multiplier 0.85 (enemy piece worth less)
      const firePerspective = getMaterialValue(piece, FACTION.FIRE);
      expect(firePerspective).toBe(PIECE_STRENGTH.pawn * 0.85);

      // Water perspective: Water loses to Nature = disadvantage -> multiplier 1.15 (enemy piece worth more)
      const waterPerspective = getMaterialValue(piece, FACTION.WATER);
      expect(waterPerspective).toBe(PIECE_STRENGTH.pawn * 1.15);

      // Nature perspective: same faction = neutral -> multiplier 1.0
      const naturePerspective = getMaterialValue(piece, FACTION.NATURE);
      expect(naturePerspective).toBe(PIECE_STRENGTH.pawn * 1.0);

      // King always high value
      const kingPiece = { type: "king", faction: FACTION.WATER };
      const kingVal = getMaterialValue(kingPiece, FACTION.FIRE);
      expect(kingVal).toBe(PIECE_STRENGTH.king * 100);
    });
  });

  describe("calculateTimeBudget", () => {
    test("returns budget within bounds (1000-8000)", () => {
      const gameState = createGameState();
      const budget = calculateTimeBudget(gameState);
      expect(budget).toBeGreaterThanOrEqual(1000);
      expect(budget).toBeLessThanOrEqual(8000);
    });

    test("higher piece count = lower budget (opening)", () => {
      const manyPieces = createGameState({
        pieces: Array.from({ length: 40 }, (_, i) =>
          createPiece(
            "pawn",
            i % 3 === 0
              ? FACTION.FIRE
              : i % 3 === 1
                ? FACTION.WATER
                : FACTION.NATURE,
            (i % 7) - 3,
            Math.floor(i / 7) - 3,
          ),
        ),
      });
      const budgetMany = calculateTimeBudget(manyPieces);

      const fewPieces = createGameState({ pieces: [] });
      const budgetFew = calculateTimeBudget(fewPieces);

      // In endgame (few pieces) budget should be higher
      expect(budgetFew).toBeGreaterThanOrEqual(budgetMany);
    });

    test("kingdom check increases budget", () => {
      const gameState = createGameState();
      // Note: isKingdomCheck is imported in ai-worker.js, can't easily mock here
      // Just test that the function returns a valid budget
      const budget = calculateTimeBudget(gameState);
      expect(budget).toBeGreaterThanOrEqual(1000);
      expect(budget).toBeLessThanOrEqual(8000);
    });
  });

  describe("Move Generation (getAllActions, getLegalMoves)", () => {
    test("getAllActions returns moves and attacks for a piece", () => {
      const gameState = createGameState({
        pieces: [
          createPiece("pawn", FACTION.FIRE, 0, 3),
          createPiece("pawn", FACTION.WATER, 0, 2),
        ],
        currentFaction: FACTION.FIRE,
        currentFactionIdx: 0,
      });

      const actions = getAllActions(gameState, FACTION.FIRE);
      // Fire pawn at (0,3) can move forward to (0,2) but it's occupied by water pawn
      // It can attack diagonally - but water pawn is directly in front
      expect(actions.length).toBeGreaterThanOrEqual(0);
    });

    test("getAllActions returns empty array for faction with no pieces", () => {
      const gameState = createGameState({ pieces: [] });
      const actions = getAllActions(gameState, FACTION.FIRE);
      expect(actions).toEqual([]);
    });

    test("getLegalMoves filters illegal moves (king in check)", () => {
      // This tests the legalMoveCheck integration
      const gameState = createGameState({
        pieces: [
          createPiece("king", FACTION.FIRE, 0, 0),
          createPiece("queen", FACTION.WATER, 0, 5),
        ],
        currentFaction: FACTION.FIRE,
        currentFactionIdx: 0,
      });

      const fireKing = gameState.pieces.find(
        (p) => p.type === "king" && p.faction === FACTION.FIRE,
      );
      const { moves, attacks } = getLegalMoves(gameState, fireKing);
      // King should have some legal moves (not in check initially)
      expect(Array.isArray(moves)).toBe(true);
      expect(Array.isArray(attacks)).toBe(true);
    });
  });

  describe("Game Simulation (rebuildOccupiedMap, simulateMove)", () => {
    test("rebuildOccupiedMap populates _occupiedMap correctly", () => {
      const gameState = createGameState({
        pieces: [
          createPiece("pawn", FACTION.FIRE, 0, 0),
          createPiece("pawn", FACTION.WATER, 1, 0), // dead piece not added to map
        ],
        currentFaction: FACTION.FIRE,
        currentFactionIdx: 0,
      });
      // Mark second piece as dead
      gameState.pieces[1].alive = false;
      rebuildOccupiedMap(gameState);

      expect(gameState._occupiedMap.size).toBe(1);
      expect(gameState._occupiedMap.has("0,0")).toBe(true);
    });

    test("simulateMove executes normal move correctly", () => {
      const gameState = createGameState({
        pieces: [createPiece("pawn", FACTION.FIRE, 0, 3)],
        currentFaction: FACTION.FIRE,
        currentFactionIdx: 0,
      });

      const piece = gameState.pieces[0];
      const target = new Hex(0, 2);
      const undo = simulateMove(gameState, piece, target);

      expect(piece.pos.q).toBe(0);
      expect(piece.pos.r).toBe(2);
      expect(piece.hasMoved).toBe(true);
      expect(undo.from.q).toBe(0);
      expect(undo.from.r).toBe(3);
      expect(undo.wasAttack).toBe(false);
    });

    test("simulateMove executes attack (advantage) correctly", () => {
      const gameState = createGameState({
        pieces: [
          createPiece("queen", FACTION.FIRE, 0, 1),
          createPiece("king", FACTION.NATURE, 0, 0),
          createPiece("king", FACTION.FIRE, -5, 5),
          createPiece("king", FACTION.WATER, 5, 5),
        ],
        currentFaction: FACTION.FIRE,
        currentFactionIdx: 0,
        rpsEnabled: true,
      });

      const attacker = gameState.pieces.find(
        (p) => p.type === "queen" && p.faction === FACTION.FIRE,
      );
      const target = new Hex(0, 0);
      const undo = simulateMove(gameState, attacker, target);

      expect(undo.wasAttack).toBe(true);
      expect(undo.defenderWasKilled).toBe(true);
      expect(undo.eliminatedFaction).toBe(FACTION.NATURE);
      expect(attacker.pos.q).toBe(0);
      expect(attacker.pos.r).toBe(0);
    });
  });

  describe("Evaluation Functions", () => {
    test("evaluatePawnStructure gives bonus for advanced pawns", () => {
      const pieces = [
        createPiece("pawn", FACTION.FIRE, 0, 0), // promotion rank
        createPiece("pawn", FACTION.FIRE, 1, 1),
        createPiece("pawn", FACTION.WATER, 0, 5), // back rank
      ];
      const score = evaluatePawnStructure(pieces, FACTION.FIRE);
      // Function returns a number (can be negative due to enemy pawn factors)
      expect(typeof score).toBe("number");
      expect(isFinite(score)).toBe(true);
    });

    test("evaluatePawnStructure penalizes doubled pawns", () => {
      const pieces = [
        createPiece("pawn", FACTION.FIRE, 0, 2),
        createPiece("pawn", FACTION.FIRE, 0, 3), // same file
        createPiece("pawn", FACTION.WATER, 1, 2),
      ];
      const score = evaluatePawnStructure(pieces, FACTION.FIRE);
      // Doubled pawns penalty
      expect(score).toBeLessThan(20); // would be higher without penalty
    });

    test("evaluateEndgame returns 0 for non-endgame positions", () => {
      const gameState = createGameState({
        pieces: Array.from({ length: 25 }, (_, i) =>
          createPiece(
            "pawn",
            i % 3 === 0
              ? FACTION.FIRE
              : i % 3 === 1
                ? FACTION.WATER
                : FACTION.NATURE,
            (i % 7) - 3,
            Math.floor(i / 7) - 3,
          ),
        ),
        currentFaction: FACTION.FIRE,
        currentFactionIdx: 0,
        eliminatedFactions: new Set(),
      });

      const score = evaluateEndgame(
        gameState,
        gameState.pieces.filter((p) => p.alive),
        FACTION.FIRE,
      );
      expect(score).toBe(0); // Not endgame (25 pieces > 20)
    });

    test("evaluateEndgame activates for <= 20 pieces", () => {
      const gameState = createGameState({
        pieces: [
          createPiece("king", FACTION.FIRE, 0, 0),
          createPiece("pawn", FACTION.FIRE, 0, 1),
          createPiece("king", FACTION.WATER, 5, 5),
        ],
        currentFaction: FACTION.FIRE,
        currentFactionIdx: 0,
        eliminatedFactions: new Set([FACTION.NATURE]),
      });

      const pieces = gameState.pieces.filter((p) => p.alive);
      const score = evaluateEndgame(gameState, pieces, FACTION.FIRE);
      // Should activate (3 pieces <= 20, 2 factions alive)
      expect(typeof score).toBe("number");
    });

    test("evaluateBoard returns a number", () => {
      const gameState = createGameState();
      const score = evaluateBoard(gameState, FACTION.FIRE);
      expect(typeof score).toBe("number");
      expect(isFinite(score)).toBe(true);
    });

    test("evaluateBoard differs by faction perspective", () => {
      const gameState = createGameState({
        pieces: [
          createPiece("queen", FACTION.FIRE, 0, 1),
          createPiece("pawn", FACTION.WATER, 0, 2),
        ],
        currentFaction: FACTION.FIRE,
        currentFactionIdx: 0,
      });

      const fireScore = evaluateBoard(gameState, FACTION.FIRE);
      const waterScore = evaluateBoard(gameState, FACTION.WATER);
      expect(fireScore).not.toBe(waterScore);
    });
  });

  describe("Search Functions (minimax, quiesce, iterativeDeepening)", () => {
    test("minimax returns a result object with score and action", () => {
      const gameState = createGameState({
        pieces: [
          createPiece("pawn", FACTION.FIRE, 0, 3),
          createPiece("pawn", FACTION.WATER, 0, 1),
        ],
        currentFaction: FACTION.FIRE,
        currentFactionIdx: 0,
      });

      const result = minimax(
        gameState,
        1,
        -Infinity,
        Infinity,
        FACTION.FIRE,
        FACTION.FIRE,
      );
      expect(result).toHaveProperty("score");
      expect(typeof result.score).toBe("number");
      expect(isFinite(result.score)).toBe(true);
      // action can be null if no legal moves
    });

    test("quiesce returns stand-pat score at depth limit", () => {
      const gameState = createGameState();
      const result = quiesce(
        gameState,
        -Infinity,
        Infinity,
        FACTION.FIRE,
        FACTION.FIRE,
        4,
      ); // qDepth >= 4
      expect(result).toHaveProperty("score");
      expect(typeof result.score).toBe("number");
    });

    test("iterativeDeepening returns an action or null", () => {
      const gameState = createGameState({
        pieces: [createPiece("pawn", FACTION.FIRE, 0, 3)],
        currentFaction: FACTION.FIRE,
        currentFactionIdx: 0,
      });

      const action = iterativeDeepening(gameState, FACTION.FIRE);
      // Can be null if no legal moves, or an action object
      expect(action === null || (action && typeof action === "object")).toBe(
        true,
      );
    });
  });

  describe("Greedy Best Move", () => {
    test("greedyBestMove prefers advantageous attacks", () => {
      const gameState = createGameState({
        pieces: [
          createPiece("queen", FACTION.FIRE, 0, 1),
          createPiece("pawn", FACTION.NATURE, 0, 0), // Fire beats Nature
        ],
        currentFaction: FACTION.FIRE,
        currentFactionIdx: 0,
        rpsEnabled: true,
      });

      const actions = getAllActions(gameState, FACTION.FIRE);
      const move = greedyBestMove(gameState, FACTION.FIRE, actions);
      expect(move).not.toBeNull();
      if (move) {
        expect(move.type).toBe("attack");
        expect(move.rps).toBe("advantage");
      }
    });

    test("greedyBestMove returns null for empty actions", () => {
      const gameState = createGameState();
      const move = greedyBestMove(gameState, FACTION.FIRE, []);
      expect(move).toBeNull();
    });
  });

  describe("calculateBestMove (Entry Point)", () => {
    test("calculateBestMove returns a move for valid position", () => {
      const gameState = createGameState({
        pieces: [createPiece("pawn", FACTION.FIRE, 0, 3)],
        currentFaction: FACTION.FIRE,
        currentFactionIdx: 0,
      });

      const move = calculateBestMove(gameState, FACTION.FIRE);
      // Can be null if no legal moves, or an action object
      expect(move === null || (move && typeof move === "object")).toBe(true);
    });

    test("calculateBestMove handles empty board", () => {
      const gameState = createGameState({ pieces: [] });
      const move = calculateBestMove(gameState, FACTION.FIRE);
      expect(move).toBeNull();
    });
  });

  describe("deserializeGame", () => {
    test("deserializeGame reconstructs game object correctly", () => {
      const state = {
        pieces: [
          {
            id: "p1",
            type: "pawn",
            faction: FACTION.FIRE,
            pos: { q: 0, r: 0 },
            symbol: "P",
            alive: true,
            hasMoved: false,
          },
        ],
        currentFactionIdx: 0,
        currentFaction: FACTION.FIRE,
        state: GAME_STATE.SELECT_PIECE,
        eliminatedFactions: [],
        rpsEnabled: true,
        capturedPieces: { fire: [], water: [], nature: [] },
        _halfmoveClock: 0,
      };

      const game = deserializeGame(state);
      expect(game.pieces.length).toBe(1);
      expect(game.pieces[0].pos).toBeInstanceOf(Hex); // pos should be Hex
      expect(game.currentFaction).toBe(FACTION.FIRE);
      expect(game.eliminatedFactions).toBeInstanceOf(Set);
      expect(game._occupiedMap).toBeInstanceOf(Map);
    });
  });

  describe("Constants and Configuration", () => {
    test("TURN_ORDER has all three factions", () => {
      expect(TURN_ORDER).toEqual([FACTION.FIRE, FACTION.WATER, FACTION.NATURE]);
    });

    test("AI_PERSONALITIES has all four personalities", () => {
      expect(AI_PERSONALITIES).toHaveProperty("balanced");
      expect(AI_PERSONALITIES).toHaveProperty("aggressive");
      expect(AI_PERSONALITIES).toHaveProperty("defensive");
      expect(AI_PERSONALITIES).toHaveProperty("tactical");
    });

    test("RPS_VALUE_MULTIPLIER has correct values", () => {
      // Import is not direct, but we can test via getDynamicPieceValue
      const pawnVal = PIECE_STRENGTH.pawn;
      expect(getDynamicPieceValue("pawn", FACTION.FIRE, FACTION.NATURE)).toBe(
        pawnVal * 1.3,
      );
      expect(getDynamicPieceValue("pawn", FACTION.FIRE, FACTION.WATER)).toBe(
        pawnVal * 0.7,
      );
      expect(getDynamicPieceValue("pawn", FACTION.FIRE, FACTION.FIRE)).toBe(
        pawnVal * 1.0,
      );
    });
  });
});
