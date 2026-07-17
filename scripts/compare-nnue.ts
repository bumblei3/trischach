/**
 * compare-nnue.ts — reproducible two-engine-config Elo benchmark.
 *
 * The existing `benchmark-nnue.ts` only measures "NNUE vs Handcrafted". That
 * answers one question (is NNUE better than the handcrafted eval?) but NOT the
 * questions that actually gate engine work:
 *   - Is NNUE-v2 better than NNUE-v1?  (two weight files)
 *   - Does depth 4 beat depth 3?        (same eval, different depth)
 *   - Is a candidate net better than the shipped one?
 *
 * This script plays TWO engine *configurations* against each other over N
 * games, rotates which side each config plays, and reports score + Elo +
 * a 95% confidence interval on the Elo estimate (via the score standard error).
 *
 * Determinism: trischach's search breaks ties with Math.random() (ai-core.ts
 * ~L2274/L2283). To make a run reproducible we temporarily swap Math.random
 * for a seeded PRNG; the original is always restored, even on error.
 *
 * Run:
 *   npx tsx scripts/compare-nnue.ts [games] [depthA] [depthB]
 *   npx tsx scripts/compare-nnue.ts 40 3 3 --a=nnue --b=classic
 *   npx tsx scripts/compare-nnue.ts 40 3 3 --a-weights=public/js/weights/nnue-weights.json --b-weights=public/js/weights/nnue-weights-v1.json --gate=20
 *
 * Config flags:
 *   --a=nnue|classic        eval for side A (default nnue)
 *   --b=nnue|classic        eval for side B (default classic)
 *   --a-weights=PATH        weight file for A (default shipped weights)
 *   --b-weights=PATH        weight file for B (default shipped weights)
 *   --a-depth / --b-depth   per-side depth override (positional 2/3 also set both)
 *   --seed=N                PRNG seed for tie-break determinism (default 12345)
 *   --gate=N                exit 1 if A's Elo over B < N  (default no gate)
 *   --max-plies=N           hard cap on plies per game (default 200)
 */

import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import type { Faction } from "../js/types.ts";
import {
  calculateBestMove,
  setAIDepth,
  setNNUEEnabled,
  loadNNUEWeights,
  setTieBreakMode,
} from "../js/ai-core.ts";
import type { NNUEWeights } from "../js/nnue.ts";
import {
  eloFromScore,
  loadWeightsFromDisk,
  describeArch,
} from "./nnue-common.ts";

const TURNS: Faction[] = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];

export type EngineKind = "nnue" | "classic";
export type TieBreakMode = "deterministic" | "random";
export interface EngineConfig {
  kind: EngineKind;
  weights?: NNUEWeights;
  tiebreak?: TieBreakMode;
}
export type Side = "A" | "B";
export type GameOutcome = "A" | "B" | "draw";

export interface CompareSummary {
  games: number;
  aWins: number;
  bWins: number;
  draws: number;
  scoreA: number; // (W + 0.5D) / N  — A's score
  eloA: number; // A's Elo relative to B
  eloLo: number; // 95% CI lower bound
  eloHi: number; // 95% CI upper bound
  depthA: number;
  depthB: number;
  configA: string;
  configB: string;
}

// ── Seeded PRNG (mulberry32) so tie-break Math.random() is reproducible ──
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withSeededRandom<T>(seed: number, fn: () => T): T {
  const orig = Math.random;
  Math.random = mulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = orig;
  }
}

function applyConfig(cfg: EngineConfig, depth: number): void {
  setAIDepth(depth);
  if (cfg.kind === "nnue") {
    // Always (re)load weights so the net is present before the search eval
    // runs. Pass custom weights if provided, else fall back to shipped.
    loadNNUEWeights(cfg.weights ?? loadWeightsFromDisk());
    setNNUEEnabled(true);
  } else {
    setNNUEEnabled(false);
  }
  // Tie-break mode: default deterministic (reproducible, noise-free). The
  // legacy random mode is kept only so A/B benches can compare the two.
  setTieBreakMode(cfg.tiebreak !== "random");
}

/**
 * Play ONE game. `aFaction` is the faction that uses config A; the other two
 * factions use config B. Returns the winner side ("A"/"B") or "draw".
 */
export function playCompareGame(
  aFaction: Faction,
  cfgA: EngineConfig,
  cfgB: EngineConfig,
  depthA: number,
  depthB: number,
  maxPlies = 200,
): GameOutcome {
  const g = new Game();
  g.init(generateBoard());

  let ply = 0;
  while (ply < maxPlies) {
    const alive = TURNS.filter((f) => !g.eliminatedFactions.has(f));
    if (alive.length <= 1) {
      setNNUEEnabled(false);
      if (alive.length === 1) {
        // survivor won
        return alive[0] === aFaction ? "A" : "B";
      }
      return "draw";
    }
    const faction = TURNS[g.currentFactionIdx]!;
    const isA = faction === aFaction;
    applyConfig(isA ? cfgA : cfgB, isA ? depthA : depthB);
    const mv = calculateBestMove(g, faction);
    if (!mv) {
      setNNUEEnabled(false);
      return "draw";
    }
    g.handleCellClick(mv.piece.pos);
    g.handleCellClick(mv.target);
    if (g.pendingPromotion) g.completePromotion("queen");
    ply++;
  }
  setNNUEEnabled(false);
  return "draw";
}

/**
 * Run a full compare benchmark. To remove faction bias we rotate the A side
 * across all three factions AND mirror: for each game index i, A plays the
 * faction `TURNS[i % 3]`; additionally for odd i we swap which physical config
 * maps to "A"/"B" so a net advantage can't hide in a faction/side asymmetry.
 */
export function runCompare(
  games: number,
  cfgA: EngineConfig,
  cfgB: EngineConfig,
  depthA: number,
  depthB: number,
  seed = 12345,
  maxPlies = 200,
): CompareSummary {
  let aWins = 0;
  let bWins = 0;
  let draws = 0;

  const results = withSeededRandom(seed, () => {
    const out: GameOutcome[] = [];
    for (let i = 0; i < games; i++) {
      // mirror swap on odd rounds: swap the physical meaning of A/B
      const mirror = i % 2 === 1;
      const aFaction = TURNS[i % TURNS.length]!;
      const physA = mirror ? cfgB : cfgA;
      const physB = mirror ? cfgA : cfgB;
      const dA = mirror ? depthB : depthA;
      const dB = mirror ? depthA : depthB;
      const winner = playCompareGame(aFaction, physA, physB, dA, dB, maxPlies);
      // map physical winner back to logical A/B
      if (winner === "draw") out.push("draw");
      else if (winner === "A") out.push(mirror ? "B" : "A");
      else out.push(mirror ? "A" : "B");
    }
    return out;
  });

  for (const r of results) {
    if (r === "A") aWins++;
    else if (r === "B") bWins++;
    else draws++;
  }

  const n = games;
  const scoreA = (aWins + 0.5 * draws) / n;
  const eloA = eloFromScore(scoreA);

  // 95% CI on Elo via score standard error (Wald). With score s and N games,
  // var(s) ≈ s(1-s)/N (binomial), SE = sqrt(var)/N. Map SE through the
  // logistic derivative dElo/ds = 400 / (s(1-s) ln 10).
  const denom = scoreA * (1 - scoreA);
  let eloLo = eloA;
  let eloHi = eloA;
  if (denom > 1e-9 && n > 0) {
    const seScore = Math.sqrt(denom / n);
    const dEloDs = 400 / (denom * Math.LN10);
    const seElo = seScore * dEloDs;
    const z = 1.96; // 95%
    eloLo = Math.round(eloA - z * seElo);
    eloHi = Math.round(eloA + z * seElo);
  }

  const cfgStr = (c: EngineConfig) =>
    c.kind === "nnue" ? `nnue(${c.weights ? "custom" : "shipped"})` : "classic";

  return {
    games,
    aWins,
    bWins,
    draws,
    scoreA,
    eloA,
    eloLo,
    eloHi,
    depthA,
    depthB,
    configA: cfgStr(cfgA),
    configB: cfgStr(cfgB),
  };
}

function parseFlags(argv: string[]): {
  a: EngineKind;
  b: EngineKind;
  aWeights?: string;
  bWeights?: string;
  aDepth?: number;
  bDepth?: number;
  seed: number;
  gate: number | null;
  maxPlies: number;
  aTiebreak: TieBreakMode;
  bTiebreak: TieBreakMode;
} {
  let a: EngineKind = "nnue";
  let b: EngineKind = "classic";
  let aWeights: string | undefined;
  let bWeights: string | undefined;
  let aDepth: number | undefined;
  let bDepth: number | undefined;
  let aTiebreak: TieBreakMode = "deterministic";
  let bTiebreak: TieBreakMode = "deterministic";
  let seed = 12345;
  let gate: number | null = null;
  let maxPlies = 200;

  for (const arg of argv) {
    if (arg.startsWith("--a=")) a = arg.slice(4) as EngineKind;
    else if (arg.startsWith("--b=")) b = arg.slice(4) as EngineKind;
    else if (arg.startsWith("--a-weights=")) aWeights = arg.slice(12);
    else if (arg.startsWith("--b-weights=")) bWeights = arg.slice(12);
    else if (arg.startsWith("--a-depth=")) aDepth = Number(arg.slice(10));
    else if (arg.startsWith("--b-depth=")) bDepth = Number(arg.slice(10));
    else if (arg.startsWith("--a-tiebreak="))
      aTiebreak = arg.slice(13) as TieBreakMode;
    else if (arg.startsWith("--b-tiebreak="))
      bTiebreak = arg.slice(13) as TieBreakMode;
    else if (arg.startsWith("--seed=")) seed = Number(arg.slice(7));
    else if (arg.startsWith("--max-plies=")) maxPlies = Number(arg.slice(12));
    else if (arg.startsWith("--gate=")) gate = Number(arg.slice(7));
    else if (arg === "--gate") gate = 0;
  }
  return {
    a,
    b,
    aWeights,
    bWeights,
    aDepth,
    bDepth,
    aTiebreak,
    bTiebreak,
    seed,
    gate,
    maxPlies,
  };
}

function main(): void {
  const positional = process.argv.slice(2).filter((x) => !x.startsWith("--"));
  const N = Number(positional[0] ?? 40);
  const flags = parseFlags(process.argv);
  // positional depth args set both sides unless overridden per side
  const depthA = flags.aDepth ?? Number(positional[1] ?? 3);
  const depthB = flags.bDepth ?? Number(positional[2] ?? depthA);

  const cfgA: EngineConfig = {
    kind: flags.a,
    weights: flags.aWeights ? loadWeightsFromDisk(flags.aWeights) : undefined,
    tiebreak: flags.aTiebreak,
  };
  const cfgB: EngineConfig = {
    kind: flags.b,
    weights: flags.bWeights ? loadWeightsFromDisk(flags.bWeights) : undefined,
    tiebreak: flags.bTiebreak,
  };

  console.log(
    `${describeArch()} | A=${cfgA.kind}${flags.aWeights ? "(custom)" : ""} depth=${depthA} tie=${cfgA.tiebreak ?? "deterministic"}  vs  B=${cfgB.kind}${flags.bWeights ? "(custom)" : ""} depth=${depthB} tie=${cfgB.tiebreak ?? "deterministic"} | games=${N} seed=${flags.seed}`,
  );
  const s = runCompare(
    N,
    cfgA,
    cfgB,
    depthA,
    depthB,
    flags.seed,
    flags.maxPlies,
  );
  console.log(`A wins ${s.aWins} | B wins ${s.bWins} | draws ${s.draws}`);
  console.log(
    `A score ${(s.scoreA * 100).toFixed(1)}% | Elo(A vs B) ${s.eloA}  [95% CI ${s.eloLo}..${s.eloHi}]`,
  );

  if (flags.gate !== null && s.eloA < flags.gate) {
    console.error(`GATE FAIL: Elo ${s.eloA} < ${flags.gate}`);
    process.exit(1);
  }
  if (flags.gate !== null) {
    console.log(`GATE OK: Elo ${s.eloA} ≥ ${flags.gate}`);
  }
}

const isDirectRun =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  /compare-nnue\.ts$/.test(process.argv[1] ?? "");
if (isDirectRun) main();
