import { retryImport } from "./lazy-retry.ts";

type AnalysisModule = typeof import("./analysis.ts");

let analysisModule: AnalysisModule | null = null;

/**
 * Lazy-Import des Analyse-Modus (Positionsanalyse im Replay-Panel). Wird nur
 * beim Klick auf „Analysieren“ gebraucht.
 */
export async function loadAnalysisModule(): Promise<AnalysisModule> {
  analysisModule ??= await retryImport(() => import("./analysis.ts"));
  return analysisModule;
}
