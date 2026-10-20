/**
 * Lazy-Loader (puzzle-loader, analysis-loader, game-loader) — Smoke-Tests
 * für Caching und den "noch nicht geladen"-Fehlerpfad.
 */
import { describe, test, expect } from "vitest";
import { loadPuzzleModule, puzzleApi } from "../js/puzzle-loader.ts";
import { loadAnalysisModule } from "../js/analysis-loader.ts";
import { loadGame, createGame } from "../js/game-loader.ts";

describe("puzzle-loader", () => {
  test("wirft, wenn puzzleApi() vor dem Laden aufgerufen wird", () => {
    try {
      puzzleApi();
    } catch (e) {
      expect((e as Error).message).toContain("noch nicht geladen");
    }
  });

  test("lädt das Puzzle-Modul und cached es", async () => {
    const first = await loadPuzzleModule();
    const second = await loadPuzzleModule();
    expect(first).toBe(second);
    expect(typeof first.getPuzzleState).toBe("function");
    expect(puzzleApi()).toBe(first);
  });
});

describe("analysis-loader", () => {
  test("lädt das Analyse-Modul und cached es", async () => {
    const first = await loadAnalysisModule();
    const second = await loadAnalysisModule();
    expect(first).toBe(second);
  });
});

import { loadRpsPuzzleModule, rpsPuzzleApi } from "../js/rps-puzzle-loader.ts";
import { loadCoachModule, coachApi } from "../js/coach-loader.ts";
import { loadReplayModule } from "../js/replay-loader.ts";

describe("rps-puzzle-loader", () => {
  test("cached load + throw before load", () => {
    try {
      rpsPuzzleApi();
    } catch (e) {
      expect((e as Error).message).toContain("noch nicht geladen");
    }
  });
  test("loads and caches", async () => {
    const a = await loadRpsPuzzleModule();
    const b = await loadRpsPuzzleModule();
    expect(a).toBe(b);
    expect(rpsPuzzleApi()).toBe(a);
  });
});

describe("coach-loader", () => {
  test("cached load + throw before load", () => {
    try {
      coachApi();
    } catch (e) {
      expect((e as Error).message).toContain("noch nicht geladen");
    }
  });
  test("loads and caches", async () => {
    const a = await loadCoachModule();
    const b = await loadCoachModule();
    expect(a).toBe(b);
    expect(coachApi()).toBe(a);
  });
});

describe("replay-loader", () => {
  test("loads and caches", async () => {
    const a = await loadReplayModule();
    const b = await loadReplayModule();
    expect(a).toBe(b);
  });
});

describe("game-loader", () => {
  test("cached loadGame + createGame", async () => {
    const first = await loadGame();
    const second = await loadGame();
    expect(first).toBe(second);
    const instance = await createGame();
    expect(instance).toBeInstanceOf(first);
  });
});
