/**
 * Analysis helpers — formatEvalScore / formatEngineMove / analyzePosition.
 */
import { expect, test, describe, beforeEach } from "vitest";
import {
  analyzePosition,
  formatEngineMove,
  formatEvalScore,
} from "../js/analysis.ts";
import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import { setAIDepth, getAIDepth } from "../js/ai.ts";
import type { AIAction } from "../js/types.ts";
import { Hex } from "../js/hex.ts";

describe("formatEvalScore", () => {
  test("labels decisive scores as mate", () => {
    expect(formatEvalScore(6000)).toBe("Matt+");
    expect(formatEvalScore(-6000)).toBe("Matt−");
  });

  test("formats mid-range scores with sign", () => {
    expect(formatEvalScore(25)).toBe("+2.5");
    expect(formatEvalScore(-12)).toBe("-1.2");
    expect(formatEvalScore(0)).toBe("0.0");
  });
});

describe("formatEngineMove", () => {
  test("formats piece moves with capture marker", () => {
    const action = {
      piece: {
        type: "queen",
        pos: { q: 0, r: 0 },
      },
      target: new Hex(1, 2),
      type: "attack",
    } as unknown as AIAction;
    expect(formatEngineMove(action)).toBe("Q0,0x1,2");
  });

  test("formats pawn non-captures without letter", () => {
    const action = {
      piece: {
        type: "pawn",
        pos: { q: -1, r: 2 },
      },
      target: new Hex(0, 3),
      type: "move",
    } as unknown as AIAction;
    expect(formatEngineMove(action)).toBe("-1,2-0,3");
  });
});

describe("analyzePosition", () => {
  beforeEach(() => {
    setAIDepth(3);
  });

  test("returns analysis for the starting position", () => {
    const game = new Game();
    game.init(generateBoard());
    const result = analyzePosition(game, 1);
    expect(result.gameOver).toBe(false);
    expect(result.faction).toBe(FACTION.FIRE);
    expect(typeof result.staticScore).toBe("number");
    expect(result.scoreLabel.length).toBeGreaterThan(0);
    // At depth 1 the engine should still find a legal move from the start.
    expect(result.bestMove).not.toBeNull();
    expect(result.san).toMatch(/,/);
    expect(result.depth).toBe(1);
  });

  test("restores AI depth after analysis", () => {
    setAIDepth(3);
    const game = new Game();
    game.init(generateBoard());
    analyzePosition(game, 1);
    expect(getAIDepth()).toBe(3);
  });
});
