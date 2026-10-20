import { retryImport } from "./lazy-retry.ts";

type PuzzleModule = typeof import("./puzzle.ts");

let puzzleModule: PuzzleModule | null = null;

/**
 * Lazy-Import des Puzzle-Modus. Ohne diese Trennung landet puzzle.ts (~30 KB
 * Quelle) im main-Chunk und frisst die Marge am Bundle-Gate auf (33000 B gzip).
 * Geladen wird erst beim Öffnen des Puzzle-Menüs bzw. des Statistik-Dashboards.
 */
export async function loadPuzzleModule(): Promise<PuzzleModule> {
  puzzleModule ??= await retryImport(() => import("./puzzle.ts"));
  return puzzleModule;
}

/**
 * Synchroner Zugriff auf das bereits geladene Puzzle-Modul. Nur aus Code
 * aufrufen, der seinerseits hinter loadPuzzleModule() hängt (Puzzle-Overlay,
 * Dashboard) — sonst wirft der Aufruf.
 */
export function puzzleApi(): PuzzleModule {
  if (!puzzleModule) {
    throw new Error("Puzzle-Modul wurde noch nicht geladen");
  }
  return puzzleModule;
}
