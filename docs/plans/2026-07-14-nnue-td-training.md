# NNUE Elo-Steigerung via TD-Learning Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make the JS-NNUE eval actually stronger than the handcrafted eval (real Elo gain) by replacing knowledge-distillation training with Temporal-Difference (TD) learning from self-play game outcomes.

**Architecture:** Current `scripts/train-nnue.ts` trains NNUE to _mimic_ `evaluateBoard` (Knowledge Distillation) — label = `classic/1000`. That yields ~0 Elo (NNUE says the same thing as the handcrafted eval, only slower). Replace it with **TD(0) learning from self-play**: play full games with NNUE as the eval for both sides (`setNNUEEnabled(true)` + `loadNNUEWeights(w)`), record each position's trajectory, label every position by the game's final outcome, and run SGD (`trainStep`) on those labels. Add a **real Elo benchmark** (`scripts/benchmark-nnue.ts`) that plays NNUE vs. handcrafted over N games and reports win-rate/Elo, so we can measure before/after.

**Tech Stack:** TypeScript + tsx, existing `js/nnue.ts` (forward/trainStep/randomWeights/encodePosition/loadNNUEWeights/evaluateNNUE), `js/ai-core.ts` (`setNNUEEnabled`, `evaluateBoardNNUE`, `calculateBestMove`, `simulateMove`, `undoMove`), `js/game.ts`, `js/board.ts`.

**Verified signatures (read from source, do not guess):**

- `nnue.ts`: `randomWeights(): NNUEWeights`, `encodePosition(game: IGame, faction: Faction): Float32Array`, `evaluateNNUE(game, faction): number` (= `forward().out * 1000`), `trainStep(w, batch: {vec,label}[], lr): number` (does one SGD step + returns loss), `loss(w, batch): number`, `loadNNUEWeights(w): void`.
- `ai-core.ts`: `setNNUEEnabled(on: boolean): void`, `evaluateBoardNNUE(game, faction): number` (delegates to `evaluateNNUE` when enabled else `evaluateBoard`), `calculateBestMove(game, faction): AIAction | null` (uses `evaluateBoardNNUE` internally at line 1241), `simulateMove(game, piece, target): void`, `undoMove(game): void`.
- Net shape: `NNUE_INPUT_DIMS` (162 = 18×9) → 128 (ReLU) → 32 (ReLU) → 1 (`tanh(x/80) * 1000`). `forward` returns `{out, h1, h2}` with `out` in -1..1.
- NNUE is **flag-gated, default OFF** (`_nnueEnabled=false`). To use NNUE as the search eval: `setNNUEEnabled(true)` then `loadNNUEWeights(w)`.

---

## Task 1: Elo benchmark script (baseline)

**Objective:** Measure NNUE vs. handcrafted strength so we have a before/after number.

**Files:**

- Create: `scripts/benchmark-nnue.ts`
- Test: `tests/benchmark-nnue.test.ts` (smoke test that it runs a few games without crashing)

**Step 1: Write the benchmark script**

`scripts/benchmark-nnue.ts`:

```ts
/**
 * Elo benchmark: NNUE (enabled) vs Handcrafted (disabled) over N games.
 * Run: npx tsx scripts/benchmark-nnue.ts [games]
 * Prints win/draw/loss for NNUE side + approximate Elo from win-rate.
 */
import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import {
  calculateBestMove,
  setAIDepth,
  setNNUEEnabled,
  loadNNUEWeights,
} from "../js/ai-core.ts";
import { readFileSync } from "fs";

const TURNS: Faction[] = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];

function loadWeights() {
  const raw = JSON.parse(
    readFileSync("public/js/weights/nnue-weights.json", "utf8"),
  );
  return {
    w1: Float32Array.from(raw.w1),
    b1: Float32Array.from(raw.b1),
    w2: Float32Array.from(raw.w2),
    b2: Float32Array.from(raw.b2),
    w3: Float32Array.from(raw.w3),
    b3: Float32Array.from(raw.b3),
  };
}

function playGame(nnueSide: Faction): "win" | "draw" | "loss" {
  const g = new Game();
  g.init(generateBoard());
  setAIDepth(3);
  setNNUEEnabled(true); // NNUE for the searching side
  loadNNUEWeights(loadWeights());
  let ply = 0;
  while (ply < 200) {
    const alive = TURNS.filter((f) => !g.eliminatedFactions.has(f));
    if (alive.length <= 1) {
      // Determine result from nnueSide's survival
      return g.eliminatedFactions.has(nnueSide) ? "loss" : "win";
    }
    const faction = TURNS[g.currentFactionIdx]!;
    setNNUEEnabled(faction === nnueSide); // NNUE only on its own turns
    const mv = calculateBestMove(g, faction);
    if (!mv) {
      setNNUEEnabled(false);
      return "draw";
    }
    g.handleCellClick(mv.piece.pos);
    g.handleCellClick(mv.target);
    // handle promotion if any
    if (g.pendingPromotion) g.completePromotion("queen");
    ply++;
  }
  setNNUEEnabled(false);
  return "draw";
}

function eloFromWinRate(wr: number): number {
  // crude logistic mapping for reporting only
  if (wr <= 0) return -800;
  if (wr >= 1) return 800;
  return Math.round(-400 * Math.log(1 / wr - 1));
}

function main() {
  const N = Number(process.argv[2] ?? 40);
  let win = 0,
    draw = 0,
    loss = 0;
  for (let i = 0; i < N; i++) {
    const r = playGame(FACTION.FIRE); // NNUE = FIRE
    if (r === "win") win++;
    else if (r === "draw") draw++;
    else loss++;
  }
  const wr = win / N;
  console.log(
    `NNUE(FIRE) vs Handcrafted: W${win} D${draw} L${loss} | winrate ${(wr * 100).toFixed(1)}% | ~Elo ${eloFromWinRate(wr)}`,
  );
}

main();
```

**Step 2: Smoke test**

`tests/benchmark-nnue.test.ts`:

```ts
import { expect, test } from "vitest";
import { playGame } from "../scripts/benchmark-nnue.ts";

test("benchmark playGame returns a valid result without crashing", () => {
  const r = playGame("fire" as any);
  expect(["win", "draw", "loss"]).toContain(r);
});
```

Note: if `playGame` is not exported, export it (add `export` to the function) — adjust the test import accordingly.

**Step 3: Run smoke test**
Run: `npx vitest run tests/benchmark-nnue.test.ts`
Expected: PASS (game completes, returns a string in the set).

**Step 4: Run baseline benchmark**
Run: `npx tsx scripts/benchmark-nnue.ts 40`
Expected: prints `NNUE(FIRE) vs Handcrafted: W# D# L# | winrate X% | ~Elo Y`. Record this number as the **distillation baseline** (expected ~50% / ~0 Elo, because NNUE currently mimics handcrafted).

**Step 5: Commit**

```bash
git add scripts/benchmark-nnue.ts tests/benchmark-nnue.test.ts
git commit -m "test: add NNUE vs handcrafted Elo benchmark (baseline)"
```

---

## Task 2: TD(0) self-play trainer

**Objective:** Train NNUE from game outcomes instead of mimicking handcrafted eval, so it becomes genuinely stronger.

**Files:**

- Create: `scripts/train-nnue-td.ts`
- Modify: none in `js/` (reuse `trainStep`, `encodePosition`, `randomWeights`, `simulateMove`, `undoMove`)
- Test: `tests/nnue-td.test.ts` (unit test that one TD update reduces loss on a toy trajectory)

**Step 1: Write the TD trainer**

`scripts/train-nnue-td.ts`:

```ts
/**
 * TD(0) Self-Play Trainer for JS-NNUE.
 * Plays self-play games with NNUE as the eval for BOTH sides, records each
 * visited position, and trains the net so its prediction at every position
 * converges to the final game outcome (TD(0) bootstrap). This teaches the net
 * actual winning/losing patterns, not just to imitate the handcrafted eval.
 *
 * Run: npx tsx scripts/train-nnue-td.ts [games] [epochsPerGame]
 */
import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import {
  calculateBestMove,
  setAIDepth,
  setNNUEEnabled,
  loadNNUEWeights,
} from "../js/ai-core.ts";
import { simulateMove, undoMove } from "../js/ai-core.ts";
import {
  encodePosition,
  randomWeights,
  trainStep,
  type NNUEWeights,
} from "../js/nnue.ts";
import { writeFileSync, mkdirSync } from "fs";

const TURNS: Faction[] = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];

function outcomeToLabel(g: Game): number {
  // +1 if FIRE survived / won, -1 if eliminated, 0 draw (per FIRE perspective)
  if (g.eliminatedFactions.has(FACTION.FIRE)) return -1;
  const alive = TURNS.filter((f) => !g.eliminatedFactions.has(f));
  if (alive.length <= 1) return 1;
  return 0;
}

function playAndCollect(
  g: Game,
  w: NNUEWeights,
): { vec: Float32Array; faction: Faction }[] {
  setNNUEEnabled(true);
  loadNNUEWeights(w);
  setAIDepth(2);
  const traj: { vec: Float32Array; faction: Faction }[] = [];
  let ply = 0;
  while (ply < 120) {
    const alive = TURNS.filter((f) => !g.eliminatedFactions.has(f));
    if (alive.length <= 1) break;
    const faction = TURNS[g.currentFactionIdx]!;
    traj.push({ vec: encodePosition(g, faction), faction });
    const mv = calculateBestMove(g, faction);
    if (!mv) break;
    simulateMove(g, mv.piece, mv.target);
    ply++;
  }
  setNNUEEnabled(false);
  return traj;
}

function main() {
  const GAMES = Number(process.argv[2] ?? 120);
  const EPOCHS = Number(process.argv[3] ?? 4);
  let w = randomWeights();
  const LR = 0.02;

  for (let game = 0; game < GAMES; game++) {
    const g = new Game();
    g.init(generateBoard());
    const traj = playAndCollect(g, w);
    const terminal = outcomeToLabel(g);
    // TD(0): label every position with the terminal outcome (simple, robust).
    const batch = traj.map((t) => ({ vec: t.vec, label: terminal }));
    for (let e = 0; e < EPOCHS; e++) {
      trainStep(w, batch, LR);
    }
    if (game % 20 === 0)
      console.log(`Game ${game}: traj=${traj.length} outcome=${terminal}`);
  }

  mkdirSync("public/js/weights", { recursive: true });
  writeFileSync(
    "public/js/weights/nnue-weights.json",
    JSON.stringify({
      w1: Array.from(w.w1),
      b1: Array.from(w.b1),
      w2: Array.from(w.w2),
      b2: Array.from(w.b2),
      w3: Array.from(w.w3),
      b3: Array.from(w.b3),
    }),
  );
  console.log(
    "TD-trained weights written to public/js/weights/nnue-weights.json",
  );
}

main();
```

**Step 2: Unit test that a TD update reduces loss**

`tests/nnue-td.test.ts`:

```ts
import { expect, test } from "vitest";
import { randomWeights, trainStep, loss, encodePosition } from "../js/nnue.ts";
import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";

test("TD step reduces loss on a labelled trajectory", () => {
  const w = randomWeights();
  const g = new Game();
  g.init(generateBoard());
  const batch = [
    { vec: encodePosition(g, FACTION.FIRE), label: 1 },
    { vec: encodePosition(g, FACTION.WATER), label: -1 },
  ];
  const before = loss(w, batch);
  for (let i = 0; i < 10; i++) trainStep(w, batch, 0.05);
  const after = loss(w, batch);
  expect(after).toBeLessThan(before);
});
```

**Step 3: Run unit test**
Run: `npx vitest run tests/nnue-td.test.ts`
Expected: PASS (`after < before`).

**Step 4: Train (background, long)**
Run: `npx tsx scripts/train-nnue-td.ts 120 4` (in background, ~5-15 min depending on machine)
Expected: prints progress every 20 games, writes weights file.

**Step 5: Confirm weights changed vs distillation baseline**
Run: `npx tsx scripts/verify-nnue.ts` (reuse existing verify script if present, else quickly print a few evaluateNNUE scores on different positions to confirm non-saturated, position-dependent output).

**Step 6: Commit**

```bash
git add scripts/train-nnue-td.ts tests/nnue-td.test.ts public/js/weights/nnue-weights.json
git commit -m "feat: TD(0) self-play training for NNUE (real Elo signal)"
```

---

## Task 3: Re-run Elo benchmark after TD training

**Objective:** Prove the TD-trained net is stronger than handcrafted (Elo gain).

**Step 1: Run benchmark with TD weights**
Run: `npx tsx scripts/benchmark-nnue.ts 40`
Expected: prints winrate/Elo. Compare to Task 1 baseline. A genuine gain shows winrate > 50% (positive Elo). If winrate ~50% still, the TD signal is too weak — see Pitfalls.

**Step 2: Also benchmark NNUE-vs-NNUE (TD vs distillation) to isolate the effect**
Optionally: keep a copy of the old distillation weights, benchmark TD-weights vs distillation-weights.

**Step 3: Record result in PR description** (winrate before/after).

---

## Task 4: PR + cleanup

**Objective:** Land the Elo improvement.

**Step 1:** Create feature branch, commit all, push, open PR against main.
**Step 2:** Wait for CI (lint, typecheck, unit, e2e, benchmark). Benchmark job is `continue-on-error` so it won't block, but verify the e2e/unit still pass.
**Step 3:** Squash-merge, delete branch.

---

## Pitfalls

- **TD(0) with terminal label for every position is naive** — it can be slow/weak. If winrate stays ~50%, switch to **TD(λ) bootstrap** (label_t = outcome if terminal else `predict_{t+1}`) or increase games/epochs. This is a tuning lever, not a blocker.
- **`simulateMove`/`undoMove` vs `handleCellClick`**: the trainer uses `simulateMove`/`undoMove` (no promotion handling needed mid-search) for speed; the benchmark uses `handleCellClick` + `completePromotion` to mimic real play. Keep them separate.
- **NNUE flag-gating**: always `setNNUEEnabled(false)` after search loops so it doesn't leak into other tests/benchmarks.
- **`public/js/weights/nnue-weights.json` is in `.prettierignore`** (generated file) — do NOT run prettier on it.
- **Performance**: self-play at depth 2-3 with NNUE is slow in pure JS. Keep GAMES modest (120) for the first pass; scale up only after confirming a signal.
- **Don't delete `scripts/train-nnue.ts`** (distillation) — keep it as the baseline generator; the TD trainer supersedes it for strength but distillation is still useful for a sane init.
