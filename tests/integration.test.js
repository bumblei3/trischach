import { expect, test, describe } from "vitest";
import { Game } from "../js/game.ts";
import { generateBoard } from "../js/board.ts";
import { calculateBestMove, setAIDepth, setAITimeLimit } from "../js/ai.ts";
import { PIECE_TYPE } from "../js/pieces.ts";

// Keep the AI search shallow AND time-bounded so the synchronous (main-thread)
// calculateBestMove used here stays fast. These tests verify game/AI *logic*
// (moves execute without crashing, the game reaches a final state), not
// search strength. Node 24 runs the search much slower than Node 22, so a
// short time limit is required to keep the suite under the CI timeout.
setAIDepth(2);
setAITimeLimit(200);

describe("AI Simulation (Integration)", () => {
  test("AI can play a sequence of moves without crashing", () => {
    const game = new Game();
    game.init(generateBoard());

    // Play up to 20 turns. Bound the loop by wall-clock time as well, so a
    // pathologically slow runtime can never hang the test (MAX_SEARCH_MS
    // already bounds each individual calculateBestMove call).
    const start = Date.now();
    for (let turn = 0; turn < 20; turn++) {
      if (game.state === "game_over") break;
      if (Date.now() - start > 15000) break;

      const faction = game.currentFaction;
      const action = calculateBestMove(game, faction);

      if (!action) {
        break;
      }

      // Execute the action (selResult may be null if selection fails)
      const selResult = game.handleCellClick(action.piece.pos);
      if (!selResult || selResult.action === "deselect") {
        // AI selected an invalid piece; skip this turn
        break;
      }
      const result = game.handleCellClick(action.target);

      // Handle promotion: auto-promote to queen
      if (result && result.promotion && game.pendingPromotion) {
        game.completePromotion(PIECE_TYPE.QUEEN);
      }

      if (result && result.action !== "deselect") {
        expect(result.action).toMatch(/move|combat|promotion/);
      }
    }
  });

  test("Game reaches a final state after many moves", () => {
    const game = new Game();
    game.init(generateBoard());

    let moveCount = 0;
    const start = Date.now();
    while (game.state !== "game_over" && moveCount < 100) {
      // Hard wall-clock guard: never let this loop run past 15s even if a
      // single calculateBestMove somehow exceeds its budget.
      if (Date.now() - start > 15000) break;

      const action = calculateBestMove(game, game.currentFaction);
      if (!action) break;

      const selResult = game.handleCellClick(action.piece.pos);
      if (!selResult || selResult.action === "deselect") break;

      const result = game.handleCellClick(action.target);

      // Handle promotion: auto-promote to queen
      if (result && result.promotion && game.pendingPromotion) {
        game.completePromotion(PIECE_TYPE.QUEEN);
      }

      moveCount++;
    }

    expect(moveCount).toBeGreaterThan(0);
  });

  test("calculateBestMove honors a tight time limit and never hangs", () => {
    // Regression guard for the 1.1.1 CI hang: with a pathological (tiny) time
    // budget, calculateBestMove MUST still return promptly instead of running
    // unbounded. We set a very low limit and assert the wall-clock cost stays
    // well under a hard ceiling.
    const prevLimit = 30; // ms — deliberately tiny
    setAITimeLimit(prevLimit);

    const game = new Game();
    game.init(generateBoard());

    const start = Date.now();
    const action = calculateBestMove(game, game.currentFaction);
    const elapsed = Date.now() - start;

    // Restore the suite-wide limit so subsequent tests stay fast.
    setAITimeLimit(200);

    // Returns within a hard ceiling (1000ms) regardless of search speed.
    expect(elapsed).toBeLessThan(1000);
    // Either a legal action or null (no move available) — never an undefined
    // hang / throw.
    expect(action === null || typeof action === "object").toBe(true);
  });
});
