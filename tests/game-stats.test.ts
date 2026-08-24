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
});
