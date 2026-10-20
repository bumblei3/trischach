import { retryImport } from "./lazy-retry.ts";

type RpsPuzzleModule = typeof import("./rps-puzzle.ts");

let rpsPuzzleModule: RpsPuzzleModule | null = null;

/**
 * Lazy-Import des RPS-Taktik-Puzzle-Moduls. rps-puzzle.ts ist eine
 * ~280-Quellzeilen große Puzzle-Generierung + -Evaluation (mit Abhängigkeiten
 * zur Such-Engine) und war bisher statisch im main-Chunk — das hielt main.js
 * länger im kritischen Pfad. Geladen wird nur, wenn der RPS-Taktik-Modus
 * gewählt wird (puzzle-rps-btn), also nach `initApp()`.
 */
export async function loadRpsPuzzleModule(): Promise<RpsPuzzleModule> {
  rpsPuzzleModule ??= await retryImport(() => import("./rps-puzzle.ts"));
  return rpsPuzzleModule;
}

/** Synchroner Zugriff auf das bereits geladene RPS-Puzzle-Modul. */
export function rpsPuzzleApi(): RpsPuzzleModule {
  if (!rpsPuzzleModule) {
    throw new Error(
      "RPS-Puzzle-Modul noch nicht geladen – zuerst loadRpsPuzzleModule() aufrufen.",
    );
  }
  return rpsPuzzleModule;
}
