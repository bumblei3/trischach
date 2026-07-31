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
import { calculateBestMove } from "../js/ai-core.ts";
import type { AIAction, Faction } from "../js/types.ts";
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
    // New: PV line and RPS explanation are populated.
    expect(Array.isArray(result.pv)).toBe(true);
    expect(result.pv.length).toBeGreaterThanOrEqual(1);
    expect(typeof result.rpsExplanation).toBe("string");
    expect(result.rpsExplanation!.length).toBeGreaterThan(0);
  });

  test("does not mutate the game state while building the PV", () => {
    const game = new Game();
    game.init(generateBoard());
    const before = JSON.stringify(
      game.getAlivePieces().map((p) => [p.id, p.pos.q, p.pos.r, p.alive]),
    );
    analyzePosition(game, 3);
    const after = JSON.stringify(
      game.getAlivePieces().map((p) => [p.id, p.pos.q, p.pos.r, p.alive]),
    );
    expect(after).toBe(before);
    // Side to move must be unchanged too.
    expect(game.currentFaction).toBe(FACTION.FIRE);
  });

  test("PV has multiple plies at higher depth from a midgame position", () => {
    const game = new Game();
    game.init(generateBoard());
    // Advance a few plies so there is a real tactical tree.
    // Use the real Game API (handleCellClick) to keep the Game-class state
    // consistent — ai-core simulateMove does not sync the Game-class internals.
    setAIDepth(2);
    for (let i = 0; i < 5; i++) {
      const mv = calculateBestMove(game, game.currentFaction as Faction);
      if (!mv) break;
      game.handleCellClick(mv.piece.pos);
      game.handleCellClick(mv.target);
      if (game.pendingPromotion) game.completePromotion("queen");
    }
    const result = analyzePosition(game, 2);
    expect(result.pv.length).toBeGreaterThanOrEqual(2);
    result.pv.forEach((m) => expect(m).toMatch(/,/));
  });

  test("restores AI depth after analysis", () => {
    setAIDepth(3);
    const game = new Game();
    game.init(generateBoard());
    analyzePosition(game, 1);
    expect(getAIDepth()).toBe(3);
  });
});
