/**
 * nnue-train.ts — Phase 3 des datengenerierten NNUE (Distillation).
 *
 * Gegenteil zum gescheiterten TD-Trainer (`scripts/train-nnue-td.ts`, entfernt):
 * Das Ziel ist NICHT die Partieausgabe, sondern `evaluateLeaf(game, faction)`
 * der vorhandenen Engine — die Engine liefert für jede Stellung sofort ein
 * Ziel, unabhängig davon, wie die Partie endet. Das umgeht das 3P-Labelproblem
 * (Partien enden fast nie durch Eliminierung → TD-Gradient 0 %).
 *
 * Die Stellungen stammen aus Partien der klassischen Engine (keine
 * NNUE-Selbstspiele), damit die Verteilung der Trainingsdaten nicht vom
 * noch untrainierten Netz abhängt.
 *
 * Run:
 *   npx tsx scripts/nnue-train.ts --games=50 --batch=64 --lr=0.003
 *   npx tsx scripts/nnue-train.ts --games=200 --out=data/nnue/weights.json
 *
 * Schreibt: data/nnue/weights.json (gitignoriert).
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
import {
  encodePosition,
  randomWeights,
  trainStep,
  assertWeightShapes,
  type NNUEWeights,
} from "../js/nnue.ts";
import { loadOpeningBook } from "../js/opening-book.ts";
import { writeFileSync, mkdirSync } from "node:fs";

const TURNS: Faction[] = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];
const PROFILES = ["balanced", "aggressive", "defensive", "tactical"] as const;

function flag(name: string, fallback: number): number {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.split("=")[1]) : fallback;
}

function weightsToJson(w: NNUEWeights): Record<string, number[]> {
  return {
    w1: Array.from(w.w1),
    b1: Array.from(w.b1),
    w2: Array.from(w.w2),
    b2: Array.from(w.b2),
    w3: Array.from(w.w3),
    b3: Array.from(w.b3),
  };
}

async function main(): Promise<void> {
  const games = flag("games", 50);
  const batch = flag("batch", 64);
  const lr = flag("lr", 0.003);
  const maxPlies = flag("plies", 200);
  const out =
    process.argv.find((x) => x.startsWith("--out="))?.split("=")[1] ??
    "data/nnue/weights.json";

  await loadOpeningBook();
  setAIDepth(3);

  const w = randomWeights();
  assertWeightShapes(w);
  const buf: { vec: Float32Array; label: number }[] = [];
  let seen = 0;
  let updates = 0;
  let lastLoss = 0;

  for (let i = 0; i < games; i++) {
    setPersonality(PROFILES[i % PROFILES.length]!);
    const g = new Game();
    g.init(generateBoard());
    // Referenz aus der Ausgangsstellung: evaluateBoard enthält den
    // König-Basis-Offset (~-1e5, denn jede Fraktion sieht zwei fremde Könige).
    // Ohne Abzug ist das Ziel praktisch konstant und die Information im
    // kleinen Rest (~±1e3) geht in der Kompression verloren.
    const refEval = evaluateLeaf(g as never, TURNS[g.currentFactionIdx]!);
    let ply = 0;
    while (ply < maxPlies) {
      const alive = TURNS.filter((f) => !g.eliminatedFactions.has(f));
      if (alive.length <= 1) break;
      const faction = TURNS[g.currentFactionIdx]!;
      // Ziel aus der Engine, aber relativ zur Ausgangsstellung und in den
      // Ausgabebereich des Netzes gebracht: `evaluateLeaf` liefert Werte bis
      // ±1e5 (GAME_WIN_SCORE), die Netz-Ausgabe ist tanh × 1000/T (T=80)
      // → ±12,5.
      const raw = evaluateLeaf(g as never, faction);
      const label = Math.tanh((raw - refEval) / 1000) * 10;
      buf.push({
        vec: encodePosition(g as never, faction),
        label,
      });
      seen++;
      if (buf.length >= batch) {
        lastLoss = trainStep(w, buf, lr);
        updates++;
        buf.length = 0;
      }
      const mv = calculateBestMove(g, faction);
      if (!mv) break;
      g.handleCellClick(mv.piece.pos);
      g.handleCellClick(mv.target);
      if (g.pendingPromotion) g.completePromotion("queen");
      ply++;
    }
  }
  if (buf.length > 1) {
    lastLoss = trainStep(w, buf, lr);
    updates++;
  }

  mkdirSync(out.slice(0, out.lastIndexOf("/")), { recursive: true });
  writeFileSync(out, JSON.stringify(weightsToJson(w)));
  console.log(
    `Training: ${seen} Stellungen, ${updates} Updates, letzter Loss ${lastLoss.toFixed(4)} -> ${out}`,
  );
}

void main();
