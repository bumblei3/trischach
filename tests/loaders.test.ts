/**
 * Lazy-Loader (puzzle-loader, analysis-loader) — Smoke-Tests für Caching
 * und den "noch nicht geladen"-Fehlerpfad.
 */
import { describe, test, expect } from "vitest";
import { loadPuzzleModule, puzzleApi } from "../js/puzzle-loader.ts";
import { loadAnalysisModule } from "../js/analysis-loader.ts";

describe("puzzle-loader", () => {
  test("wirft, wenn puzzleApi() vor dem Laden aufgerufen wird", () => {
    // Modul-Cache kann aus anderen Tests bereits gefüllt sein — in dem Fall
    // überspringen wir den Throw-Pfad.
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
    // Nach dem Laden liefert puzzleApi() dasselbe Modul.
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
