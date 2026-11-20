/**
 * nnue-eval.ts — bewertet ein trainiertes NNUE gegen die Engine-Eval.
 *
 * Metrik: Pearson-Korrelation und MAE zwischen `evaluateNNUE(game, f)` und
 * `evaluateLeaf(game, f)` auf frischen Stellungen (nicht die Trainingspartien).
 * Zusätzlich die Zeit pro Eval — der mögliche Gewinn der Distillation ist
 * Durchsatz, nicht Qualität.
 *
 * Run:
 *   npx tsx scripts/nnue-eval.ts --weights=data/nnue/weights-v1.json --games=20
 */
import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import type { Faction } from "../js/types.ts";
import {
  calculateBestMove,
  setAIDepth,
  setPersonality,
  evaluateLeaf,
} from "../js/ai-core.ts";
import { evaluateNNUE, loadNNUEWeights } from "../js/nnue.ts";
import { loadOpeningBook } from "../js/opening-book.ts";
import { readFileSync } from "node:fs";

const TURNS: Faction[] = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];
const PROFILES = ["balanced", "aggressive", "defensive", "tactical"] as const;

function flag(name: string, fallback: number): number {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.split("=")[1]) : fallback;
}

function toF32(v: number[] | undefined): Float32Array {
  return Float32Array.from(v ?? []);
}

async function main(): Promise<void> {
  const weightsPath =
    process.argv.find((x) => x.startsWith("--weights="))?.split("=")[1] ??
    "data/nnue/weights-v1.json";
  const games = flag("games", 20);
  const maxPlies = flag("plies", 200);

  const raw = JSON.parse(readFileSync(weightsPath, "utf-8")) as Record<
    string,
    number[]
  >;
  loadNNUEWeights({
    w1: toF32(raw.w1),
    b1: toF32(raw.b1),
    w2: toF32(raw.w2),
    b2: toF32(raw.b2),
    w3: toF32(raw.w3),
    b3: toF32(raw.b3),
  });

  await loadOpeningBook();
  setAIDepth(3);

  const pairs: { nn: number; ref: number }[] = [];
  const t0 = Date.now();
  let nnTime = 0;

  for (let i = 0; i < games; i++) {
    setPersonality(PROFILES[i % PROFILES.length]!);
    const g = new Game();
    g.init(generateBoard());
    const refEval = evaluateLeaf(g as never, TURNS[g.currentFactionIdx]!);
    let ply = 0;
    while (ply < maxPlies) {
      const alive = TURNS.filter((f) => !g.eliminatedFactions.has(f));
      if (alive.length <= 1) break;
      const faction = TURNS[g.currentFactionIdx]!;
      const t = performance.now();
      const nn = evaluateNNUE(g as never, faction);
      nnTime += performance.now() - t;
      // gleiche Relativierung wie im Trainer, sonst vergleicht man absolute
      // Engine-Werte mit der gelernten relativen Größe.
      const raw = evaluateLeaf(g as never, faction);
      pairs.push({ nn, ref: Math.tanh((raw - refEval) / 1000) * 10 });
      const mv = calculateBestMove(g, faction);
      if (!mv) break;
      g.handleCellClick(mv.piece.pos);
      g.handleCellClick(mv.target);
      if (g.pendingPromotion) g.completePromotion("queen");
      ply++;
    }
  }

  const n = pairs.length || 1;
  const meanNn = pairs.reduce((s, p) => s + p.nn, 0) / n;
  const meanRef = pairs.reduce((s, p) => s + p.ref, 0) / n;
  let cov = 0;
  let varNn = 0;
  let varRef = 0;
  let mae = 0;
  for (const p of pairs) {
    const dn = p.nn - meanNn;
    const dr = p.ref - meanRef;
    cov += dn * dr;
    varNn += dn * dn;
    varRef += dr * dr;
    mae += Math.abs(p.nn - p.ref);
  }
  const corr = varNn > 0 && varRef > 0 ? cov / Math.sqrt(varNn * varRef) : 0;

  console.log(
    `NNUE-Auswertung | ${n} Stellungen | Korrelation ${corr.toFixed(3)} | MAE ${(mae / n).toFixed(1)} | ${(nnTime / n).toFixed(3)} ms/Eval | Gesamt ${Date.now() - t0} ms`,
  );
}

void main();
