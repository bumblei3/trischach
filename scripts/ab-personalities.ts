/**
 * ab-personalities.ts — which AI personality profile plays strongest?
 *
 * The search is Maximax and the routing threshold sends most of the game to
 * greedyBestMove, so the evaluation weights matter more than search depth. The
 * shipped default is "balanced"; the UI offers aggressive/defensive/tactical.
 * If a different profile scores clearly better against depth1, the default is
 * a free lever.
 *
 * Fair conditions: identical opening book, budget, opponent and seed; only
 * setPersonality() changes between arms.
 *
 * Run:
 *   npx tsx scripts/ab-personalities.ts [games] [depth]
 */
import { loadOpeningBook } from "../js/opening-book.ts";
import { setPersonality } from "../js/ai-core.ts";
import { runStrength } from "./engine-strength.ts";
import type { AIPersonality } from "../js/types.ts";

const GAMES = Number(process.argv[2] ?? 20);
const DEPTH = Number(process.argv[3] ?? 3);
const SEED = 12345;

async function main(): Promise<void> {
  await loadOpeningBook();
  const profiles: AIPersonality[] = [
    "balanced",
    "aggressive",
    "defensive",
    "tactical",
  ];
  console.log(
    `Personalities vs depth1 | games=${GAMES} depth=${DEPTH} seed=${SEED} book=on`,
  );
  for (const p of profiles) {
    const ok = setPersonality(p);
    if (!ok) {
      console.log(`${p}: unknown profile`);
      continue;
    }
    const t0 = Date.now();
    const s = runStrength(GAMES, DEPTH, "depth1", SEED);
    const ms = Date.now() - t0;
    console.log(
      `${p.padEnd(12)} W${s.engineWins} L${s.engineLosses} D${s.draws} score ${(s.score * 100).toFixed(1)}% elo ${s.elo} [${s.eloLo}..${s.eloHi}] ${ms}ms`,
    );
  }
  setPersonality("balanced");
}

void main();
