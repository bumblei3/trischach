/**
 * Puzzle uniqueness + daily streak helpers.
 */
import { expect, test, describe, beforeEach, vi } from "vitest";
import { FACTION } from "../js/board.ts";
import {
  hasUniqueSolution,
  getPuzzleStreak,
  recordDailyPuzzleSolved,
  isDailySolvedToday,
  isTodaysDailyPuzzle,
  todayISO,
  type Puzzle,
  STREAK_KEY,
  DAILY_PUZZLE_KEY,
  DAILY_PUZZLE_DATE_KEY,
} from "../js/puzzle.ts";

function makePuzzle(overrides: Partial<Puzzle> = {}): Puzzle {
  return {
    id: "puzzle_unique",
    fen: "Fk0,0#0", // may not be a real mate pos — used for id/streak tests
    initialMoves: [],
    solution: [
      {
        pieceId: "p1",
        pieceType: "queen",
        faction: FACTION.FIRE,
        from: { q: 0, r: 0 },
        to: { q: 1, r: 1 },
        isCapture: true,
        isCheck: true,
        isMate: true,
        san: "Q0,0x1,1#",
      },
    ],
    mateIn: 1,
    difficulty: "easy",
    faction: FACTION.FIRE,
    createdAt: 0,
    ...overrides,
  };
}

describe("hasUniqueSolution", () => {
  test("returns false for an unreconstructable / empty FEN position", () => {
    // Invalid empty-ish FEN still builds a default board but without pieces
    // matching the solution — uniqueness check deserializes and finds 0 mates.
    const p = makePuzzle({ fen: "X#0", mateIn: 1 });
    // 0 mates with mateIn 1 → not unique
    expect(hasUniqueSolution(p)).toBe(false);
  });
});

describe("daily streak", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  test("starts at zero", () => {
    const s = getPuzzleStreak();
    expect(s.current).toBe(0);
    expect(s.best).toBe(0);
    expect(s.totalDailySolved).toBe(0);
    expect(isDailySolvedToday()).toBe(false);
  });

  test("first solve sets streak to 1", () => {
    const date = "2026-07-15";
    const s = recordDailyPuzzleSolved(date);
    expect(s.current).toBe(1);
    expect(s.best).toBe(1);
    expect(s.lastSolvedDate).toBe(date);
    expect(s.totalDailySolved).toBe(1);
    expect(localStorage.getItem(STREAK_KEY)).toBeTruthy();
  });

  test("idempotent for the same day", () => {
    const date = "2026-07-15";
    recordDailyPuzzleSolved(date);
    const s = recordDailyPuzzleSolved(date);
    expect(s.current).toBe(1);
    expect(s.totalDailySolved).toBe(1);
  });

  test("consecutive days increase streak; gap resets to 1", () => {
    recordDailyPuzzleSolved("2026-07-14");
    let s = recordDailyPuzzleSolved("2026-07-15");
    expect(s.current).toBe(2);
    expect(s.best).toBe(2);

    // Skip a day
    s = recordDailyPuzzleSolved("2026-07-17");
    expect(s.current).toBe(1);
    expect(s.best).toBe(2);
    expect(s.totalDailySolved).toBe(3);
  });

  test("isTodaysDailyPuzzle matches cached daily id", () => {
    const today = todayISO();
    const daily = makePuzzle({ id: "daily_abc" });
    localStorage.setItem(DAILY_PUZZLE_DATE_KEY, today);
    localStorage.setItem(DAILY_PUZZLE_KEY, JSON.stringify(daily));

    expect(isTodaysDailyPuzzle(daily)).toBe(true);
    expect(isTodaysDailyPuzzle(makePuzzle({ id: "other" }))).toBe(false);
  });

  test("isDailySolvedToday follows lastSolvedDate", () => {
    const today = todayISO();
    expect(isDailySolvedToday(today)).toBe(false);
    recordDailyPuzzleSolved(today);
    expect(isDailySolvedToday(today)).toBe(true);
  });
});
