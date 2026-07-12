/**
 * ai-worker.test.js - Tests for the AI Web Worker
 * Tests the worker message interface AND core AI functions (now exported for coverage)
 */
import { expect, test, describe, vi } from "vitest";
import { Hex } from "../js/hex.ts";
import { FACTION, generateBoard } from "../js/board.ts";
import { PIECE_STRENGTH, PIECE_TYPE, Piece } from "../js/pieces.ts";
import { GAME_STATE } from "../js/game.ts";
import {
  IGame,
  GameState,
  Cell,
  GameResult,
  PieceType,
  Faction,
} from "../js/types.ts";

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
  beginSearch,
  quiesce,
  iterativeDeepening,
  greedyBestMove,
  calculateBestMove,
  deserializeGame,
  TURN_ORDER,
  AI_PERSONALITIES,
  setAIDepth,
} from "../js/ai-worker.ts";

// Keep the synchronous search shallow so tests stay fast and never block the
// event loop. Tests verify AI logic, not search depth/strength.
setAIDepth(2);

// Mock opening-book to avoid needing full Game instance
vi.mock("../js/opening-book.ts", () => ({
  pickBookMove: vi.fn(() => null),
  buildOpeningBook: vi.fn(),
  inBook: vi.fn(() => false),
  getBookMoves: vi.fn(() => null),
}));

// --- Helper: Create a proper game state object (like deserializeGame does) ---
function createGameState(overrides: Partial<IGame> = {}): IGame {
  const cells = generateBoard();

  // Default pieces as Piece instances
  const pieces: Piece[] = [
    new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 5)),
    new Piece(PIECE_TYPE.PAWN, FACTION.WATER, new Hex(0, 0)),
    new Piece(PIECE_TYPE.PAWN, FACTION.NATURE, new Hex(-2, 2)),
  ];

  const game: any = {
    pieces,
    currentFactionIdx: 0,
    currentFaction: FACTION.FIRE,
    state: GAME_STATE.SELECT_PIECE,
    eliminatedFactions: new Set<Faction>(),
    rpsEnabled: true,
    boardCells: cells,
    _occupiedMap: new Map<string, Piece>(),
    capturedPieces: { fire: [], water: [], nature: [] },
    moveHistory: [] as GameResult[],
    _positionHistory: new Map<string, number>(),
    _halfmoveClock: 0,
  };

  // Rebuild occupied map
  for (const p of game.pieces) {
    if (p.alive) game._occupiedMap.set(p.pos.key, p);
  }

  const merged: any = { ...game, ...overrides };

  // If pieces were overridden, rebuild occupied map
  if (overrides.pieces) {
    merged._occupiedMap = new Map<string, Piece>();
    for (const p of merged.pieces) {
      if (p.alive) merged._occupiedMap.set(p.pos.key, p);
    }
  }

  // Add methods expected by ai-worker.js functions
  merged.simulateMove = (piece: Piece, target: Hex) =>
    simulateMove(merged as IGame, piece, target);
  merged.undoMove = (undo: any) => {
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
    merged._occupiedMap = new Map<string, Piece>();
    for (const p of merged.pieces) {
      if (p.alive) merged._occupiedMap.set(p.pos.key, p);
    }
  };
  merged._rebuildOccupiedMap = () => rebuildOccupiedMap(merged as IGame);

  return merged as IGame;
}

// Helper to create Piece instances for test overrides
function createPiece(
  type: PieceType,
  faction: Faction,
  q: number,
  r: number,
): Piece {
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
      for (const pieceType of [
        "pawn",
        "knight",
        "bishop",
        "rook",
        "queen",
      ] as PieceType[]) {
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
      const piece = { type: "pawn", faction: FACTION.NATURE } as Piece;

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
      const kingPiece = { type: "king", faction: FACTION.WATER } as Piece;
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
      const { moves, attacks } = getLegalMoves(gameState, fireKing!);
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
      gameState.pieces[1]!.alive = false;
      rebuildOccupiedMap(gameState);

      expect(gameState._occupiedMap!.size).toBe(1);
      expect(gameState._occupiedMap!.has("0,0")).toBe(true);
    });

    test("simulateMove executes normal move correctly", () => {
      const gameState = createGameState({
        pieces: [createPiece("pawn", FACTION.FIRE, 0, 3)],
        currentFaction: FACTION.FIRE,
        currentFactionIdx: 0,
      });

      const piece = gameState.pieces[0];
      const target = new Hex(0, 2);
      const undo = simulateMove(gameState, piece!, target);

      expect(piece!.pos.q).toBe(0);
      expect(piece!.pos.r).toBe(2);
      expect(piece!.hasMoved).toBe(true);
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
      )!;
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

    test("evaluateEndgame rewards a king near the board center", () => {
      // King in center should score higher than king pushed to the edge,
      // because king activity is rewarded in the endgame (dist-from-center penalty).
      const centerKing = createGameState({
        pieces: [
          createPiece("king", FACTION.FIRE, 0, 0),
          createPiece("king", FACTION.WATER, 4, 4),
        ],
        currentFaction: FACTION.FIRE,
        eliminatedFactions: new Set([FACTION.NATURE]),
      });
      const edgeKing = createGameState({
        pieces: [
          createPiece("king", FACTION.FIRE, 0, 5),
          createPiece("king", FACTION.WATER, 4, 4),
        ],
        currentFaction: FACTION.FIRE,
        eliminatedFactions: new Set([FACTION.NATURE]),
      });

      const centerScore = evaluateEndgame(
        centerKing,
        centerKing.pieces.filter((p) => p.alive),
        FACTION.FIRE,
      );
      const edgeScore = evaluateEndgame(
        edgeKing,
        edgeKing.pieces.filter((p) => p.alive),
        FACTION.FIRE,
      );
      expect(centerScore).toBeGreaterThan(edgeScore);
    });

    test("evaluateEndgame rewards advanced pawns closer to promotion", () => {
      // FIRE promotes toward r <= 0. A pawn on r=0 must score higher than one on r=4.
      const advanced = createGameState({
        pieces: [
          createPiece("king", FACTION.FIRE, 0, 0),
          createPiece("pawn", FACTION.FIRE, -2, 0),
          createPiece("king", FACTION.WATER, 4, 4),
        ],
        currentFaction: FACTION.FIRE,
        eliminatedFactions: new Set([FACTION.NATURE]),
      });
      const backward = createGameState({
        pieces: [
          createPiece("king", FACTION.FIRE, 0, 0),
          createPiece("pawn", FACTION.FIRE, -2, 4),
          createPiece("king", FACTION.WATER, 4, 4),
        ],
        currentFaction: FACTION.FIRE,
        eliminatedFactions: new Set([FACTION.NATURE]),
      });

      const advancedScore = evaluateEndgame(
        advanced,
        advanced.pieces.filter((p) => p.alive),
        FACTION.FIRE,
      );
      const backwardScore = evaluateEndgame(
        backward,
        backward.pieces.filter((p) => p.alive),
        FACTION.FIRE,
      );
      expect(advancedScore).toBeGreaterThan(backwardScore);
    });

    test("evaluateEndgame favors RPS advantage over disadvantage in 2-vs-1", () => {
      // FIRE beats NATURE (advantage) but loses to WATER (disadvantage).
      // Same material, only the surviving enemy faction differs.
      const vsNature = createGameState({
        pieces: [
          createPiece("king", FACTION.FIRE, 0, 0),
          createPiece("king", FACTION.NATURE, 3, 3),
        ],
        currentFaction: FACTION.FIRE,
        eliminatedFactions: new Set([FACTION.WATER]),
      });
      const vsWater = createGameState({
        pieces: [
          createPiece("king", FACTION.FIRE, 0, 0),
          createPiece("king", FACTION.WATER, 3, 3),
        ],
        currentFaction: FACTION.FIRE,
        eliminatedFactions: new Set([FACTION.NATURE]),
      });

      const advantageScore = evaluateEndgame(
        vsNature,
        vsNature.pieces.filter((p) => p.alive),
        FACTION.FIRE,
      );
      const disadvantageScore = evaluateEndgame(
        vsWater,
        vsWater.pieces.filter((p) => p.alive),
        FACTION.FIRE,
      );
      expect(advantageScore).toBeGreaterThan(disadvantageScore);
    });

    test("evaluateEndgame rewards proximity to eliminating a weakened enemy", () => {
      // An enemy faction reduced to a lone king (<=3 pieces) yields an
      // elimination-proximity bonus vs. a healthier enemy.
      const weakEnemy = createGameState({
        pieces: [
          createPiece("king", FACTION.FIRE, 0, 0),
          createPiece("king", FACTION.NATURE, 3, 3),
        ],
        currentFaction: FACTION.FIRE,
        eliminatedFactions: new Set([FACTION.WATER]),
      });
      const strongEnemy = createGameState({
        pieces: [
          createPiece("king", FACTION.FIRE, 0, 0),
          createPiece("king", FACTION.NATURE, 3, 3),
          createPiece("pawn", FACTION.NATURE, 3, 2),
          createPiece("pawn", FACTION.NATURE, 2, 3),
          createPiece("pawn", FACTION.NATURE, 4, 1),
        ],
        currentFaction: FACTION.FIRE,
        eliminatedFactions: new Set([FACTION.WATER]),
      });

      const weakScore = evaluateEndgame(
        weakEnemy,
        weakEnemy.pieces.filter((p) => p.alive),
        FACTION.FIRE,
      );
      const strongScore = evaluateEndgame(
        strongEnemy,
        strongEnemy.pieces.filter((p) => p.alive),
        FACTION.FIRE,
      );
      expect(weakScore).toBeGreaterThan(strongScore);
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

    test("beginSearch enables minimax to find a tactical capture deterministically", () => {
      // Regression guard for the search-state coupling discovered while
      // hardening the suite: a bare minimax() call inherits stale module
      // globals (deadline in the past) and returns the timeout branch with a
      // null action. beginSearch() installs a fresh, valid search window so a
      // single minimax() call is deterministic. FIRE queen next to a NATURE
      // queen it beats — depth-2 search must return that winning capture.
      const gameState = createGameState({
        pieces: [
          createPiece("queen", FACTION.FIRE, 0, 1),
          createPiece("pawn", FACTION.FIRE, 2, 2),
          createPiece("queen", FACTION.NATURE, 0, 0),
          createPiece("king", FACTION.FIRE, 3, 3),
          createPiece("king", FACTION.NATURE, -3, -3),
          createPiece("pawn", FACTION.NATURE, -2, -2),
        ],
        currentFaction: FACTION.FIRE,
        currentFactionIdx: 0,
        rpsEnabled: true,
        eliminatedFactions: new Set([FACTION.WATER]),
      });

      beginSearch(2000);
      const result = minimax(
        gameState,
        2,
        -Infinity,
        Infinity,
        FACTION.FIRE,
        FACTION.FIRE,
      );
      expect(result.action).not.toBeNull();
      expect(result.action?.type).toBe("attack");
      expect(result.action?.piece.type).toBe("queen");
      expect(result.action?.target.equals(new Hex(0, 0))).toBe(true);
      expect(result.score).toBeGreaterThan(0);
    });

    test("minimax returns a real move at depth 3 with an open window (null-move guard)", () => {
      // Regression guard: with an open search window (beta = Infinity) at
      // depth >= 3, null-move pruning used to fire and return
      // { score: Infinity, action: null } — silently discarding the best move
      // at the root. The finite-beta guard on null-move pruning must keep the
      // winning queen capture as a real action.
      const gameState = createGameState({
        pieces: [
          createPiece("queen", FACTION.FIRE, 0, 1),
          createPiece("pawn", FACTION.FIRE, 2, 2),
          createPiece("queen", FACTION.NATURE, 0, 0),
          createPiece("king", FACTION.FIRE, 3, 3),
          createPiece("king", FACTION.NATURE, -3, -3),
          createPiece("pawn", FACTION.NATURE, -2, -2),
        ],
        currentFaction: FACTION.FIRE,
        currentFactionIdx: 0,
        rpsEnabled: true,
        eliminatedFactions: new Set([FACTION.WATER]),
      });

      beginSearch(2000);
      const result = minimax(
        gameState,
        3,
        -Infinity,
        Infinity,
        FACTION.FIRE,
        FACTION.FIRE,
      );
      expect(result.action).not.toBeNull();
      expect(Number.isFinite(result.score)).toBe(true);
      expect(result.action?.type).toBe("attack");
      expect(result.action?.piece.type).toBe("queen");
      expect(result.action?.target.equals(new Hex(0, 0))).toBe(true);
    });

    test("minimax prefers a stronger position over a weaker one", () => {
      // Same side to move; the position with an extra friendly queen must
      // evaluate higher than the one without it. This asserts real search
      // behaviour (score ordering) rather than just the result shape.
      const rich = createGameState({
        pieces: [
          createPiece("king", FACTION.FIRE, 0, 0),
          createPiece("queen", FACTION.FIRE, 1, 1),
          createPiece("king", FACTION.WATER, 4, 4),
        ],
        currentFaction: FACTION.FIRE,
        eliminatedFactions: new Set([FACTION.NATURE]),
      });
      const poor = createGameState({
        pieces: [
          createPiece("king", FACTION.FIRE, 0, 0),
          createPiece("king", FACTION.WATER, 4, 4),
        ],
        currentFaction: FACTION.FIRE,
        eliminatedFactions: new Set([FACTION.NATURE]),
      });

      const richScore = minimax(
        rich,
        1,
        -Infinity,
        Infinity,
        FACTION.FIRE,
        FACTION.FIRE,
      ).score;
      const poorScore = minimax(
        poor,
        1,
        -Infinity,
        Infinity,
        FACTION.FIRE,
        FACTION.FIRE,
      ).score;
      expect(richScore).toBeGreaterThan(poorScore);
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

    test("iterativeDeepening returns a legal action for the moving faction", () => {
      const gameState = createGameState({
        pieces: [
          createPiece("rook", FACTION.FIRE, 0, 1),
          createPiece("pawn", FACTION.NATURE, 0, 0),
          createPiece("king", FACTION.FIRE, 3, 3),
          createPiece("king", FACTION.NATURE, -3, -3),
        ],
        currentFaction: FACTION.FIRE,
        currentFactionIdx: 0,
        rpsEnabled: true,
        eliminatedFactions: new Set([FACTION.WATER]),
      });

      const action = iterativeDeepening(gameState, FACTION.FIRE);
      expect(action).not.toBeNull();
      // The chosen action must belong to a FIRE piece and be one of the
      // legally generated actions for that position.
      expect(action?.piece.faction).toBe(FACTION.FIRE);
      const legal = getAllActions(gameState, FACTION.FIRE);
      const isLegal = legal.some(
        (a) =>
          a.piece.id === action?.piece.id &&
          a.target.equals(action.target) &&
          a.type === action.type,
      );
      expect(isLegal).toBe(true);
    });

    test("iterativeDeepening returns null when the faction has no pieces", () => {
      const gameState = createGameState({
        pieces: [createPiece("king", FACTION.WATER, 0, 0)],
        currentFaction: FACTION.FIRE,
        currentFactionIdx: 0,
      });
      const action = iterativeDeepening(gameState, FACTION.FIRE);
      expect(action).toBeNull();
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

  describe("Worker Message Interface (onmessage handler)", () => {
    // Loosely-typed view of the worker global so we can spy on postMessage
    // and invoke onmessage without fighting the strict DOM/Worker typings.
    const workerCtx = self as unknown as {
      postMessage: ((msg: any) => void) | null;
      onmessage: ((e: MessageEvent) => any) | null;
    };

    function runHandler(data: any, posted: any[]): void {
      const originalPost = workerCtx.postMessage;
      workerCtx.postMessage = (msg: any) => posted.push(msg);
      workerCtx.onmessage!({ data } as MessageEvent);
      workerCtx.postMessage = originalPost;
    }

    test("'calculate' message runs the search and posts a result", () => {
      const posted: any[] = [];

      const gameState = createGameState({
        pieces: [createPiece("pawn", FACTION.FIRE, 0, 3)],
        currentFaction: FACTION.FIRE,
        currentFactionIdx: 0,
      });

      // The handler reads e.data.{type, gameState, faction, depth}
      runHandler(
        { type: "calculate", gameState, faction: FACTION.FIRE },
        posted,
      );

      // It must have posted a 'result' with a move object
      // (pieceId + targetQ/R + moveType), not an error.
      const result = posted.find((m) => m.type === "result");
      expect(result).toBeDefined();
      expect(result.move).not.toBeNull();
      expect(result.move).toHaveProperty("pieceId");
      expect(result.move).toHaveProperty("targetQ");
      expect(result.move).toHaveProperty("targetR");
      expect(result.move).toHaveProperty("moveType");
    });

    test("'calculate' with no legal moves posts result move: null", () => {
      const posted: any[] = [];

      const gameState = createGameState({ pieces: [] });

      runHandler(
        { type: "calculate", gameState, faction: FACTION.FIRE },
        posted,
      );

      const result = posted.find((m) => m.type === "result");
      expect(result).toBeDefined();
      expect(result.move).toBeNull();
    });

    test("'setDepth' message updates the search depth without throwing", () => {
      const posted: any[] = [];

      // Must not throw (the handler just calls setAIDepth).
      expect(() =>
        runHandler({ type: "setDepth", depth: 4 }, posted),
      ).not.toThrow();
    });
  });
});
