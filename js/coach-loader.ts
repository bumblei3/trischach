import { retryImport } from "./lazy-retry.ts";

export type CoachModule = typeof import("./coach.ts");

let coachModule: CoachModule | null = null;

/**
 * Lazy-Import des Coach-Moduls (RPS-Capture-Titles, Coaching-Leisten-Messages).
 * Dadurch landet coach.ts (und die teure Hot-Path-Abhängigkeit board.ts) nicht
 * im main-Chunk, der klein bleibt für den kritischen Render-Pfad.
 * Geladen wird erst beim ersten Tooltip/Coach-Aufruf – nach `initApp()`.
 */
export async function loadCoachModule(): Promise<CoachModule> {
  coachModule ??= await retryImport(() => import("./coach.ts"));
  return coachModule;
}

/** Synchroner Zugriff auf das bereits geladene Coach-Modul. */
export function coachApi(): CoachModule {
  if (!coachModule) {
    throw new Error(
      "Coach-Modul noch nicht geladen – zuerst loadCoachModule() aufrufen.",
    );
  }
  return coachModule;
}

// Typen, die main.ts sonst static aus coach.ts importiert hätte. Wertewerte
// stammen weiterhin von coach.ts selbst (hier nur der Typ-Import).
export type { CoachMessage, CoachTone, RpsBuckets } from "./coach.ts";
