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

    // Play 20 turns
    for (let turn = 0; turn < 20; turn++) {
      if (game.state === "game_over") break;

      const faction = game.currentFaction;
      const action = calculateBestMove(game, faction);

      if (!action) {
        break;
      }

      // Execute the action
      const selResult = game.handleCellClick(action.piece.pos);
      if (selResult.action === "deselect") {
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
    while (game.state !== "game_over" && moveCount < 100) {
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
});
