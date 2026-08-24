import { describe, expect, it } from "vitest";
import { dailyPuzzleIndex, preferredDifficulty } from "../js/puzzle.ts";
import type { Puzzle } from "../js/puzzle.ts";

function makePuzzle(id: string, difficulty: Puzzle["difficulty"]): Puzzle {
  return {
    id,
    fen: "",
    initialMoves: [],
    solution: [],
    mateIn: difficulty === "easy" ? 1 : 2,
    difficulty,
    faction: "fire",
    createdAt: 0,
  };
}

describe("dailyPuzzleIndex", () => {
  it("is deterministic: same date and pool size give the same index", () => {
    expect(dailyPuzzleIndex("2026-08-24", 78)).toBe(
      dailyPuzzleIndex("2026-08-24", 78),
    );
  });

  it("returns an index within [0, n)", () => {
    for (const date of ["2026-01-01", "2026-06-15", "2027-12-31"]) {
      const idx = dailyPuzzleIndex(date, 78);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(78);
    }
  });

  it("varies across dates (not stuck on one puzzle)", () => {
    const indices = new Set(
      Array.from({ length: 30 }, (_, i) => {
        const d = new Date(Date.UTC(2026, 0, 1 + i));
        return dailyPuzzleIndex(d.toISOString().split("T")[0]!, 78);
      }),
    );
    // 30 days over a pool of 78 should hit well more than one distinct puzzle.
    expect(indices.size).toBeGreaterThan(10);
  });
});

describe("preferredDifficulty", () => {
  it("picks easy on weekends (Saturday/Sunday UTC)", () => {
    expect(preferredDifficulty("2026-08-22")).toBe("easy"); // Saturday
    expect(preferredDifficulty("2026-08-23")).toBe("easy"); // Sunday
    expect(preferredDifficulty("2026-08-30")).toBe("easy"); // Sunday
  });

  it("picks medium on weekdays", () => {
    expect(preferredDifficulty("2026-08-24")).toBe("medium"); // Monday
    expect(preferredDifficulty("2026-08-28")).toBe("medium"); // Friday
  });

  it("never returns hard while the shipped pool has no hard tier", () => {
    const days = Array.from({ length: 400 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 0, 1 + i));
      return preferredDifficulty(d.toISOString().split("T")[0]!);
    });
    expect(days).not.toContain("hard");
  });
});
