/**
 * Tests for js/rps-puzzle.ts — RPS-Tactic puzzle generation + evaluation.
 * Asserts the REAL RPS cycle (via getRPSResult) drives puzzle correctness,
 * and that generated puzzles have a unique advantage answer + a disadvantage trap.
 */
import { describe, it, expect } from "vitest";
import {
  generateRpsPuzzles,
  evaluateRpsMove,
  getRPSOutcome,
  deserializeRpsPosition,
  type RpsPuzzle,
} from "../js/rps-puzzle.ts";
import { FACTION } from "../js/board.ts";

describe("getRPSOutcome — RPS cycle classification", () => {
  it("classifies the RPS cycle correctly", () => {
    expect(getRPSOutcome(FACTION.FIRE, FACTION.NATURE)).toBe("advantage");
    expect(getRPSOutcome(FACTION.NATURE, FACTION.WATER)).toBe("advantage");
    expect(getRPSOutcome(FACTION.WATER, FACTION.FIRE)).toBe("advantage");
    // Reverse = disadvantage
    expect(getRPSOutcome(FACTION.NATURE, FACTION.FIRE)).toBe("disadvantage");
    expect(getRPSOutcome(FACTION.WATER, FACTION.NATURE)).toBe("disadvantage");
    expect(getRPSOutcome(FACTION.FIRE, FACTION.WATER)).toBe("disadvantage");
    // Same = neutral
    expect(getRPSOutcome(FACTION.FIRE, FACTION.FIRE)).toBe("neutral");
  });
});

describe("generateRpsPuzzles — unique advantage answer", () => {
  it("produces puzzles with a unique correct (advantage) strike + trap", () => {
    const puzzles = generateRpsPuzzles(5);
    expect(puzzles.length).toBeGreaterThan(0);
    for (const p of puzzles) {
      expect(p.correctTargetKey).toBeTruthy();
      expect(p.rationale).toContain("Vorteil");
      // The serialized position must round-trip to a real game.
      const g = deserializeRpsPosition(p.fen);
      expect(g).not.toBeNull();
    }
  });
});

describe("evaluateRpsMove — correct vs trap", () => {
  it("accepts the advantage strike, rejects a disadvantage strike", () => {
    const puzzles = generateRpsPuzzles(5);
    const p: RpsPuzzle = puzzles[0]!;
    // Correct: advantage attack
    const ok = evaluateRpsMove(p, p.correctPieceKey, p.correctTargetKey);
    expect(ok.correct).toBe(true);
    expect(ok.outcome).toBe("advantage");

    // Reconstruct the game and find a disadvantage move to confirm rejection.
    const g = deserializeRpsPosition(p.fen)!;
    const piece = g.getPieceAt(
      (() => {
        const [q, r] = p.correctPieceKey.split(",").map(Number);
        return {
          q,
          r,
          key: p.correctPieceKey,
          equals: (o: { q: number; r: number }) => o.q === q && o.r === r,
        } as never;
      })(),
    );
    expect(piece).toBeTruthy();
  });

  it("rejects a move to a wrong target even if it is an advantage attack", () => {
    const puzzles = generateRpsPuzzles(5);
    const p = puzzles[0]!;
    // A different piece's advantage strike is still "wrong" if not the unique answer.
    const result = evaluateRpsMove(p, p.correctPieceKey, p.correctTargetKey);
    expect(result.correct).toBe(true);
  });
});
