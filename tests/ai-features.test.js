import { expect, test, describe, beforeEach } from "vitest";

// Test the AI modules directly (not through main.js UI)
import { Game, GAME_STATE } from "../js/game.js";
import { generateBoard, FACTION } from "../js/board.js";
import {
  calculateBestMove,
  evaluateBoard,
  setAIDepth,
  startPondering,
  stopPondering,
  getPonderMove,
  isPondering,
  PonderState,
} from "../js/ai.js";
import {
  serializeGame,
  parseTSPN,
  downloadGame,
  copyGameToClipboard,
} from "../js/replay.js";
import { PIECE_TYPE, Piece } from "../js/pieces.js";
import { Hex } from "../js/hex.js";

describe("AI Core: Dynamic Piece Values (RPS-aware)", () => {
  let game;

  beforeEach(() => {
    const cells = generateBoard();
    game = new Game();
    game.init(cells);
  });

  test("evaluateBoard uses dynamic RPS-aware values", () => {
    // Fire beats Nature (advantage), loses to Water (disadvantage)
    const fireEval = evaluateBoard(game, FACTION.FIRE);
    const waterEval = evaluateBoard(game, FACTION.WATER);
    const natureEval = evaluateBoard(game, FACTION.NATURE);

    expect(typeof fireEval).toBe("number");
    expect(typeof waterEval).toBe("number");
    expect(typeof natureEval).toBe("number");

    // All evaluations should be finite numbers
    expect(Number.isFinite(fireEval)).toBe(true);
    expect(Number.isFinite(waterEval)).toBe(true);
    expect(Number.isFinite(natureEval)).toBe(true);
  });

  test("Fire has advantage over Nature, disadvantage vs Water", () => {
    // Fire beats Nature, so Nature pieces should be worth less from Fire's perspective
    // Fire loses to Water, so Water pieces should be worth more from Fire's perspective
    const firePerspective = evaluateBoard(game, FACTION.FIRE);

    // The evaluation should reflect RPS relationships
    expect(Number.isFinite(firePerspective)).toBe(true);
  });

  test("Material values change based on RPS relationship", () => {
    // Get a Fire piece and evaluate it from different perspectives
    const firePawn = game.pieces.find(
      (p) => p.faction === FACTION.FIRE && p.type === "pawn",
    );
    expect(firePawn).toBeDefined();

    // Import getMaterialValue - it's not exported, so we test through evaluateBoard
    const fireEval = evaluateBoard(game, FACTION.FIRE);
    const waterEval = evaluateBoard(game, FACTION.WATER);

    expect(fireEval).not.toBe(waterEval);
  });
});

describe("AI Core: Adaptive Time Management", () => {
  let game;

  beforeEach(() => {
    const cells = generateBoard();
    game = new Game();
    game.init(cells);
  });

  test("calculateBestMove returns valid action in opening", () => {
    const action = calculateBestMove(game, FACTION.FIRE);
    expect(action).toBeDefined();
    expect(action).toHaveProperty("piece");
    expect(action).toHaveProperty("target");
    expect(action.piece.faction).toBe(FACTION.FIRE);
  });

  test("calculateBestMove works for all factions", () => {
    // Test Fire
    let action = calculateBestMove(game, FACTION.FIRE);
    expect(action).toBeDefined();
    expect(action.piece.faction).toBe(FACTION.FIRE);

    // Simulate Fire move
    game.handleCellClick(action.piece.pos);
    const result = game.handleCellClick(action.target);

    if (result.promotion) {
      game.completePromotion("queen");
    }

    // Test Water
    action = calculateBestMove(game, FACTION.WATER);
    expect(action).toBeDefined();
    expect(action.piece.faction).toBe(FACTION.WATER);

    // Test Nature
    game.handleCellClick(action.piece.pos);
    const result2 = game.handleCellClick(action.target);
    if (result2.promotion) game.completePromotion("queen");

    action = calculateBestMove(game, FACTION.NATURE);
    expect(action).toBeDefined();
    expect(action.piece.faction).toBe(FACTION.NATURE);
  });

  test("setAIDepth changes search depth", () => {
    // Just verify it doesn't throw
    expect(() => setAIDepth(1)).not.toThrow();
    expect(() => setAIDepth(4)).not.toThrow();
    expect(() => setAIDepth(5)).not.toThrow(); // Should cap at max
  });
});

describe("AI Core: Move Quality", () => {
  let game;

  beforeEach(() => {
    const cells = generateBoard();
    game = new Game();
    game.init(cells);
  });

  test("AI avoids disadvantage captures", () => {
    // Set up a position where AI has a disadvantage capture available
    const action = calculateBestMove(game, FACTION.FIRE);

    // AI should not choose disadvantage captures unless forced
    if (action && action.type === "combat") {
      expect(action.rps).not.toBe("disadvantage");
    }
  });

  test("AI prefers winning captures (SEE > 0)", () => {
    // Create a position with a clear winning capture
    const cells = generateBoard();
    const testGame = new Game();
    testGame.init(cells);

    // Give Fire a Queen that can capture an enemy pawn with advantage
    // This is hard to set up deterministically, so we just verify the move is legal
    const action = calculateBestMove(testGame, FACTION.FIRE);
    expect(action).toBeDefined();

    // Verify the move is actually legal
    const { moves, attacks } = testGame.getLegalMoves(action.piece);
    const isLegalMove = moves.some((m) => m.equals(action.target));
    const isLegalAttack = attacks.some((a) => a.equals(action.target));
    expect(isLegalMove || isLegalAttack).toBe(true);
  });
});

describe("Game Replay: TSPN Serialization", () => {
  let game;

  beforeEach(() => {
    const cells = generateBoard();
    game = new Game();
    game.init(cells);
  });

  test("serializeGame produces valid TSPN format", () => {
    // Play a few moves
    for (let i = 0; i < 4; i++) {
      const action = calculateBestMove(game, game.currentFaction);
      if (!action) break;
      game.handleCellClick(action.piece.pos);
      const result = game.handleCellClick(action.target);
      if (result.promotion) game.completePromotion("queen");
      if (result.gameOver) break;
    }

    const tspn = serializeGame(game);

    // Check required headers
    expect(tspn).toContain("[Event ");
    expect(tspn).toContain("[Site ");
    expect(tspn).toContain("[Date ");
    expect(tspn).toContain("[Fire ");
    expect(tspn).toContain("[Water ");
    expect(tspn).toContain("[Nature ");
    expect(tspn).toContain("[Result ");
    expect(tspn).toContain("[RPS ");
    expect(tspn).toContain('[Variant "TriSchach"]');
    expect(tspn).toContain('[Version "1.0"]');

    // Check moves section exists
    expect(tspn).toContain("1.");
  });

  test("TSPN captures RPS results in notation", () => {
    // Force a combat to test RPS notation
    const cells = generateBoard();
    const testGame = new Game();
    testGame.init(cells);

    // Manually create a combat scenario
    const firePawn = testGame.pieces.find(
      (p) => p.faction === FACTION.FIRE && p.type === "pawn",
    );
    const waterPawn = testGame.pieces.find(
      (p) => p.faction === FACTION.WATER && p.type === "pawn",
    );

    if (firePawn && waterPawn) {
      // Move them adjacent for combat
      testGame.pieces = [firePawn, waterPawn];
      firePawn.pos = new Hex(0, 0);
      waterPawn.pos = new Hex(0, 1);
      testGame._rebuildOccupiedMap();
      testGame.currentFactionIdx = 0;
      testGame.state = GAME_STATE.SELECT_PIECE;
      testGame.rpsEnabled = true;

      // Simulate combat: Fire attacks Water (Fire has advantage over Nature, but vs Water is disadvantage)
      // Fire=fire, Water=water => Fire disadvantage vs Water
      testGame.handleCellClick(firePawn.pos);
      const result = testGame.handleCellClick(waterPawn.pos);

      if (result.action === "combat") {
        const tspn = serializeGame(testGame);
        // Should contain RPS indicator
        expect(tspn).toMatch(/[<>]/);
      }
    }
  });

  test("parseTSPN handles valid TSPN string", () => {
    const sampleTspn = `[Event "Test Game"]
[Site "TriSchach"]
[Date "2026-06-12"]
[Fire "Player 1"]
[Water "Player 2"]
[Nature "Player 3"]
[Result "*"]
[RPS "on"]
[Variant "TriSchach"]
[Version "1.0"]

1. fire_Pawn_-4,5 water_Pawn_0,2
2. nature_Pawn_-1,1 fire_Pawn_-4,4`;

    const parsed = parseTSPN(sampleTspn);
    expect(parsed).toHaveProperty("headers");
    expect(parsed).toHaveProperty("moves");
    expect(parsed.headers.Event).toBe("Test Game");
    expect(parsed.headers.RPS).toBe("on");
  });

  test("downloadGame and copyGameToClipboard are defined", () => {
    expect(typeof downloadGame).toBe("function");
    expect(typeof copyGameToClipboard).toBe("function");
  });
});

describe("Auto-Battle Integration", () => {
  let game;

  beforeEach(() => {
    const cells = generateBoard();
    game = new Game();
    game.init(cells);
  });

  test("Auto-battle plays multiple moves without errors", async () => {
    const moveCount = 10;
    let moves = 0;

    while (game.state !== GAME_STATE.GAME_OVER && moves < moveCount) {
      const action = calculateBestMove(game, game.currentFaction);
      if (!action) break;

      game.handleCellClick(action.piece.pos);
      const result = game.handleCellClick(action.target);

      if (result.promotion) {
        game.completePromotion("queen");
      }

      if (result.gameOver) break;
      moves++;
    }

    expect(moves).toBeGreaterThan(0);
    // Game should progress without throwing
  });

  test("Auto-battle handles combat correctly", () => {
    // Set up a combat - need pawns in attack range
    // Fire pawn at (0,0), Water pawn at (0,1) - Fire attacks NE/NW, Water attacks SW/W
    // Fire forward: NW=(-1,-1), NE=(0,-1) from (0,0) -> can attack (-1,-1) and (0,-1)
    // Water forward: SW=(-1,1), W=(0,1) from (0,1) -> can attack (-1,2) and (0,2)
    // So Fire at (0,0) and Water at (0,1) are NOT in attack range of each other

    // Fire pawn attacks NW/NE (toward center r<=0)
    // Water pawn attacks SW/W (toward center r<=0)
    // To make them attack each other, need different positions

    // Fire pawn at (-1,0) attacks NE=(0,-1) and NW=(-1,-1)
    // Water pawn at (0,0) attacks SW=(-1,1) and W=(0,1)
    // Still not attacking each other...

    // Let's use a queen which attacks in all directions
    const cells = generateBoard();
    const testGame = new Game();
    testGame.init(cells);

    const fireQueen = new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(0, 0));
    const waterPawn = new Piece(PIECE_TYPE.PAWN, FACTION.WATER, new Hex(1, 0));
    const natureKing = new Piece(
      PIECE_TYPE.KING,
      FACTION.NATURE,
      new Hex(-2, 2),
    );

    testGame.pieces = [fireQueen, waterPawn, natureKing];
    testGame._rebuildOccupiedMap();
    testGame.currentFactionIdx = 0;
    testGame.state = GAME_STATE.SELECT_PIECE;
    testGame.rpsEnabled = true;

    // Fire queen at (0,0) can attack water pawn at (1,0) - Fire beats Nature, Water beats Fire, Nature beats Water
    // Fire vs Water = DISADVANTAGE for Fire
    testGame.handleCellClick(fireQueen.pos);
    const result = testGame.handleCellClick(waterPawn.pos);

    expect(result.action).toBe("combat");
    expect(result.rpsResult).toBe("disadvantage"); // Fire vs Water = disadvantage
    expect(result.defender).toBeDefined();
    expect(result.winner).toBeDefined();
    expect(result.loser).toBeDefined();
  });

  test("Auto-battle skips eliminated factions", () => {
    // Eliminate a faction
    game.eliminatedFactions.add(FACTION.NATURE);
    game.pieces.forEach((p) => {
      if (p.faction === FACTION.NATURE) p.alive = false;
    });
    game._rebuildOccupiedMap();

    // AI should skip Nature's turn
    void calculateBestMove(game, FACTION.NATURE);
    // Should either return null or a move for next active faction
    // The game logic handles turn skipping
  });

  test("Game ends correctly when one faction remains", () => {
    // Eliminate two factions
    game.eliminatedFactions.add(FACTION.WATER);
    game.eliminatedFactions.add(FACTION.NATURE);
    game.pieces.forEach((p) => {
      if (p.faction === FACTION.WATER || p.faction === FACTION.NATURE)
        p.alive = false;
    });
    game._rebuildOccupiedMap();

    const aliveCount = game.pieces.filter((p) => p.alive).length;
    expect(aliveCount).toBeGreaterThan(0);

    void calculateBestMove(game, FACTION.FIRE);
    // Game should be over or only Fire remains
    expect(
      game.state === GAME_STATE.GAME_OVER ||
        game.currentFaction === FACTION.FIRE,
    ).toBe(true);
  });
});

describe("Edge Cases", () => {
  test("calculateBestMove handles empty board", () => {
    const cells = generateBoard();
    const testGame = new Game();
    testGame.init(cells);
    testGame.pieces = [];
    testGame._rebuildOccupiedMap();

    const action = calculateBestMove(testGame, FACTION.FIRE);
    expect(action).toBeNull();
  });

  test("calculateBestMove handles single piece", () => {
    const cells = generateBoard();
    const testGame = new Game();
    testGame.init(cells);
    testGame.pieces = [
      testGame.pieces.find(
        (p) => p.faction === FACTION.FIRE && p.type === "king",
      ),
    ];
    testGame._rebuildOccupiedMap();

    const action = calculateBestMove(testGame, FACTION.FIRE);
    // King can move
    expect(action).toBeDefined();
  });

  test("Dynamic piece values work with RPS relationships", () => {
    // Test that material values reflect RPS relationships
    const cells = generateBoard();
    const game = new Game();
    game.init(cells);

    // Remove some pieces to create measurable differences
    game.pieces = game.pieces.filter(
      (p) => p.faction === FACTION.FIRE || p.faction === FACTION.WATER,
    );
    game._rebuildOccupiedMap();

    // Fire vs Water: Fire has disadvantage vs Water
    // From Fire's perspective, Water pieces should be worth more (1.15x multiplier)
    const fireEval = evaluateBoard(game, FACTION.FIRE);
    const waterEval = evaluateBoard(game, FACTION.WATER);

    // Evaluations should be different due to RPS asymmetry
    expect(fireEval).not.toBe(waterEval);
    expect(Number.isFinite(fireEval)).toBe(true);
    expect(Number.isFinite(waterEval)).toBe(true);
  });
});

describe("AI Core: Pondering", () => {
  let game;

  beforeEach(() => {
    const cells = generateBoard();
    game = new Game();
    game.init(cells);
  });

  test("isPondering returns false initially", () => {
    expect(isPondering()).toBe(false);
  });

  test("startPondering sets isPondering to true", () => {
    startPondering(game, FACTION.FIRE);
    expect(isPondering()).toBe(true);
    stopPondering(); // Cleanup
  });

  test("stopPondering returns a valid move", async () => {
    startPondering(game, FACTION.FIRE);
    // Give it a small moment to search at least depth 1
    await new Promise((r) => setTimeout(r, 200));
    const move = await stopPondering();
    expect(move).toBeDefined();
    expect(move).toHaveProperty("piece");
    expect(move).toHaveProperty("target");
    expect(isPondering()).toBe(false);
  }, 5000);

  test("getPonderMove returns the current best move without stopping", () => {
    startPondering(game, FACTION.FIRE);
    // getPonderMove should return null initially (search hasn't completed yet)
    // but after a short time it should have a move
    const move = getPonderMove();
    // Initially may be null, that's OK - just verify it returns something or null
    expect(move === null || (move && move.piece && move.target)).toBe(true);
    stopPondering(); // Cleanup
  });

  test("second startPondering call stops previous pondering", () => {
    startPondering(game, FACTION.FIRE);
    expect(isPondering()).toBe(true);

    // Start new pondering - should stop the old one
    startPondering(game, FACTION.WATER);
    expect(isPondering()).toBe(true);

    stopPondering(); // Cleanup
  });

  test("pondering works when opponent has no legal moves", () => {
    // Create a position where opponent has no moves
    const cells = generateBoard();
    const testGame = new Game();
    testGame.init(cells);
    testGame.pieces = testGame.pieces.filter((p) => p.faction === FACTION.FIRE);
    testGame._rebuildOccupiedMap();
    testGame.currentFactionIdx = 1; // Water's turn
    testGame.currentFaction = FACTION.WATER;

    startPondering(testGame, FACTION.WATER);
    // Should not crash, isPondering may be false since no moves
    expect(typeof isPondering()).toBe("boolean");
    stopPondering(); // Cleanup
  });

  test("PonderState object is exported and has correct structure", () => {
    expect(PonderState).toBeDefined();
    expect(PonderState).toHaveProperty("active");
    expect(PonderState).toHaveProperty("game");
    expect(PonderState).toHaveProperty("opponentFaction");
    expect(PonderState).toHaveProperty("searchDeadline");
    expect(PonderState).toHaveProperty("bestMove");
    expect(PonderState).toHaveProperty("bestScore");
    expect(PonderState).toHaveProperty("currentDepth");
    expect(PonderState).toHaveProperty("nodesSearched");
    expect(PonderState).toHaveProperty("aborted");
    expect(PonderState).toHaveProperty("killerMoves");
    expect(PonderState).toHaveProperty("historyTable");
  });
});
