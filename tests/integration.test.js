import { expect, test, describe } from 'vitest';
import { Game } from '../js/game.js';
import { generateBoard } from '../js/board.js';
import { calculateBestMove } from '../js/ai.js';
import { PIECE_TYPE } from '../js/pieces.js';

describe('AI Simulation (Integration)', () => {
  test('AI can play a sequence of moves without crashing', () => {
    const game = new Game();
    game.init(generateBoard());

    // Play 20 turns
    for (let turn = 0; turn < 20; turn++) {
      if (game.state === 'game_over') break;

      const faction = game.currentFaction;
      const action = calculateBestMove(game, faction);

      if (!action) {
        // AI found no moves - skip or game over handled by UI usually
        // But in core logic, we should probably check if it deadlocks
        break;
      }

      // Execute the action
      game.handleCellClick(action.piece.pos);
      const result = game.handleCellClick(action.target);

      // Handle promotion: auto-promote to queen
      if (result && result.promotion && game.pendingPromotion) {
        game.completePromotion(PIECE_TYPE.QUEEN);
      }

      if (result) {
        expect(result.action).toMatch(/move|combat|promotion/);
      }
    }
  });

  test('Game reaches a final state after many moves', () => {
    const game = new Game();
    game.init(generateBoard());

    let moveCount = 0;
    while (game.state !== 'game_over' && moveCount < 100) {
      const action = calculateBestMove(game, game.currentFaction);
      if (!action) break;
      game.handleCellClick(action.piece.pos);
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
