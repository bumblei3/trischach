import { describe, it, expect, beforeEach } from "vitest";
import { getPuzzleSessionStats, PUZZLE_STATS_KEY } from "../js/puzzle.ts";
import "./setup.ts";

describe("puzzle session stats", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to zeros", () => {
    const s = getPuzzleSessionStats();
    expect(s.attempts).toBe(0);
    expect(s.solved).toBe(0);
    expect(s.failed).toBe(0);
    expect(s.bestTimeSeconds).toBeNull();
  });

  it("round-trips a stored stats object", () => {
    localStorage.setItem(
      PUZZLE_STATS_KEY,
      JSON.stringify({
        attempts: 7,
        solved: 5,
        failed: 2,
        hintsUsed: 1,
        totalSeconds: 130,
        bestTimeSeconds: 12,
      }),
    );
    const s = getPuzzleSessionStats();
    expect(s.attempts).toBe(7);
    expect(s.solved).toBe(5);
    expect(s.bestTimeSeconds).toBe(12);
  });

  it("tolerates corrupt storage", () => {
    localStorage.setItem(PUZZLE_STATS_KEY, "{not json");
    const s = getPuzzleSessionStats();
    expect(s.attempts).toBe(0);
  });
});
