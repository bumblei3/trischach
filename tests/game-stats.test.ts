import { beforeEach, describe, expect, it } from "vitest";
import {
  GAME_STATS_KEY,
  loadGameStats,
  recordGameResult,
  resetGameStats,
} from "../js/game-stats";

beforeEach(() => {
  // Other test files (e.g. main.test.ts) may leave records behind in the
  // shared happy-dom localStorage.
  localStorage.removeItem(GAME_STATS_KEY);
});

describe("game stats", () => {
  it("starts empty", () => {
    const s = loadGameStats();
    expect(s.totalGames).toBe(0);
    expect(s.recent).toEqual([]);
  });

  it("records a win and updates faction counters", () => {
    recordGameResult({
      winner: "fire",
      mode: "manual",
      moves: 40,
      now: new Date("2026-08-24T12:00:00Z"),
    });
    const s = loadGameStats();
    expect(s.totalGames).toBe(1);
    expect(s.winsFire).toBe(1);
    expect(s.manualGames).toBe(1);
    expect(s.manualWins.fire).toBe(1);
    expect(s.recent[0]).toMatchObject({
      winner: "fire",
      mode: "manual",
      moves: 40,
      date: "2026-08-24",
    });
  });

  it("records draws without a manual-wins increment", () => {
    recordGameResult({ winner: null, mode: "auto", moves: 120 });
    const s = loadGameStats();
    expect(s.draws).toBe(1);
    expect(s.autoGames).toBe(1);
    expect(Object.values(s.manualWins).every((v) => v === 0)).toBe(true);
  });

  it("caps the recent list at 500 entries (newest first)", () => {
    for (let i = 0; i < 505; i++) {
      recordGameResult({ winner: "water", mode: "auto", moves: i });
    }
    const s = loadGameStats();
    expect(s.totalGames).toBe(505);
    expect(s.recent.length).toBe(500);
    // newest first
    expect(s.recent[0]?.moves).toBe(504);
  });

  it("survives corrupted storage", () => {
    localStorage.setItem(GAME_STATS_KEY, "{invalid json");
    const s = loadGameStats();
    expect(s.totalGames).toBe(0);
  });

  it("reset clears everything", () => {
    recordGameResult({ winner: "nature", mode: "manual", moves: 10 });
    resetGameStats();
    const s = loadGameStats();
    expect(s.totalGames).toBe(0);
    expect(s.recent.length).toBe(0);
  });

  it("save failures are non-fatal (quota exceeded / private mode)", () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    try {
      const returned = recordGameResult({
        winner: "fire",
        mode: "auto",
        moves: 5,
      });
      // the RETURNED stats object reflects the recorded game even though
      // persistence failed (recordGameResult mutates + returns before save)
      expect(returned.totalGames).toBe(1);
      // and nothing was persisted — a fresh read starts empty again
      localStorage.setItem = orig; // restore so loadGameStats can read
      Storage.prototype.removeItem = () => {
        throw new Error("x");
      };
      resetGameStats(); // no-op on storage, but clears nothing persisted
      Storage.prototype.removeItem = orig;
      expect(loadGameStats().totalGames).toBe(0);
    } finally {
      Storage.prototype.setItem = orig;
    }
  });

  it("reset failures are non-fatal", () => {
    const orig = Storage.prototype.removeItem;
    Storage.prototype.removeItem = () => {
      throw new Error("QuotaExceededError");
    };
    try {
      expect(() => resetGameStats()).not.toThrow();
    } finally {
      Storage.prototype.removeItem = orig;
    }
  });

  it("drops malformed recent entries on load instead of crashing", () => {
    // Simulate a hand-edited/corrupted entry sneaking into the recent list.
    localStorage.setItem(
      GAME_STATS_KEY,
      JSON.stringify({
        totalGames: 1,
        recent: [
          { date: "2026-08-24", mode: "auto", winner: "fire", moves: 12 },
          { garbage: true },
          null,
          { date: 42, mode: "auto", moves: 3 }, // wrong date type
          { date: "2026-08-23", mode: "bogus-mode", moves: 3 }, // invalid mode
        ],
      }),
    );
    const s = loadGameStats();
    expect(s.recent.length).toBe(1);
    expect(s.recent[0]).toMatchObject({ date: "2026-08-24", moves: 12 });
  });
});
