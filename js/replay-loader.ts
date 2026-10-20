import { retryImport } from "./lazy-retry.ts";

type ReplayModule = typeof import("./replay.ts");

let replayModule: ReplayModule | null = null;

/**
 * Lazy-Import des Replay-/TSPN-Moduls. replay.ts (~30 KB Quelle) wird nur für
 * Export, Datei-Import, Kopieren und den Replay-Sprung gebraucht — nicht für
 * den Start. Awaited an jeder Aufrufstelle, deshalb gerät nur die jeweilige
 * Nutzeraktion ins Nachladen.
 */
export async function loadReplayModule(): Promise<ReplayModule> {
  replayModule ??= await retryImport(() => import("./replay.ts"));
  return replayModule;
}
