// @ts-nocheck
import { expect, test, describe } from "vitest";
import { calculateBestMove, setAITimeLimit, setAIDepth } from "../js/ai.ts";
import { Game } from "../js/game.ts";
import { FACTION, generateBoard } from "../js/board.ts";
import { Piece, PIECE_TYPE } from "../js/pieces.ts";
import { Hex } from "../js/hex.ts";

// Regression test for the CI hang (Node 24 vs Node 22):
// calculateBestMove must honor its time budget even when quiescence search
// explodes with many mutual captures. Previously only minimax checked the
// deadline (every 1000 nodes); quiesce had no deadline guard, so a tactical
// explosion could run far past the budget on slower runtimes and hang the suite.

describe("AI time budget enforcement", () => {
  test("quiescence explosion stays within the time budget", () => {
    // Tight budget so any runaway search is obvious.
    setAITimeLimit(120);

    const game = new Game();
    game.init(generateBoard());
    game.pieces = [];
    game._rebuildOccupiedMap();
    game.rpsEnabled = true;

    // A cluster of mutually-attacking pieces (RPS chess): each side can
    // capture the other, which forces deep quiescence recursion. Keep the
    // piece count <= 24 so greedyBestMove early-return is NOT taken and the
    // full iterative-deepening + quiescence search runs.
    const setup = [
      // fire pieces
      new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(0, 0)),
      new Piece(PIECE_TYPE.KNIGHT, FACTION.FIRE, new Hex(2, 0)),
      new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(1, 1)),
      // water pieces (beat fire)
      new Piece(PIECE_TYPE.QUEEN, FACTION.WATER, new Hex(0, 1)),
      new Piece(PIECE_TYPE.KNIGHT, FACTION.WATER, new Hex(-1, 1)),
      new Piece(PIECE_TYPE.PAWN, FACTION.WATER, new Hex(1, 0)),
      // nature pieces (beat water)
      new Piece(PIECE_TYPE.QUEEN, FACTION.NATURE, new Hex(-1, 0)),
      new Piece(PIECE_TYPE.KNIGHT, FACTION.NATURE, new Hex(1, -1)),
      new Piece(PIECE_TYPE.PAWN, FACTION.NATURE, new Hex(0, -1)),
    ];
    game.pieces = setup;
    game._rebuildOccupiedMap();

    const budget = 120;
    const start = Date.now();
    const action = calculateBestMove(game, FACTION.FIRE);
    const elapsed = Date.now() - start;

    // A move must be returned and the search must not run away past a
    // reasonable multiple of the budget (deadline guard in minimax + quiesce).
    expect(action).not.toBeNull();
    // Allow generous slack: deadline checks are sampled, so a single
    // over-budget iteration is tolerable, but a multi-second runaway is not.
    expect(elapsed).toBeLessThan(budget * 8);
  });

  test("deep search on a quiet position respects the budget", () => {
    setAITimeLimit(150);
    setAIDepth(8);

    const game = new Game();
    game.init(generateBoard());
    game.rpsEnabled = true;

    // Opening position has > 24 pieces, so greedyBestMove is taken — this
    // guards the other path. Keep it bounded regardless.
    const start = Date.now();
    const action = calculateBestMove(game, FACTION.FIRE);
    const elapsed = Date.now() - start;

    expect(action).not.toBeNull();
    expect(elapsed).toBeLessThan(5000);
  });
});
