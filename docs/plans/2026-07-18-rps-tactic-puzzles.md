# RPS-Taktik-Puzzles Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a new puzzle category "RPS-Taktik" to trischach that trains the
player to pick the correct counter-strike in the Rock-Paper-Scissors cycle
(Fire→Nature→Water→Fire). Unlike the existing Mate-in-N puzzles (js/puzzle.ts,
mate-focussed), these test RPS reading: given a position, the player must choose
the move that wins the RPS exchange (advantage attack) and avoid disadvantage
(suicide) strikes.

**Architecture:** Keep the existing Mate puzzle system untouched. Add a parallel
`RpsPuzzle` type + generator + validator + state in a new module
`js/rps-puzzle.ts`, reusing the real `getRPSResult(attacker, defender)` from
`js/board.ts:52` and the human-readable `explainRPS` logic from `js/analysis.ts:204`
(copy the wording style, do not import analysis.ts to avoid circular deps).
Wire a "RPS-Taktik" tab into the existing puzzle menu (`showPuzzleMenu`,
main.ts:2115) and reuse `showPuzzleBoard`/`showPuzzleResult` styling where
possible. TDD: every task writes the failing test first.

**Tech Stack:** TypeScript, vitest, the existing `Game`/`Piece`/`Hex` runtime,
the real `getRPSResult` RPS core. No tablebase generator involved (cheap to
build/test — this avoids the Phase-3 generation-cost failure).

---

## Verified facts (read before implementing — do NOT assume)

- `getRPSResult(attacker: Faction, defender: Faction): "advantage"|"neutral"|"disadvantage"`
  in js/board.ts:52. Returns "neutral" if same faction; else
  `RPS[attacker] === defender ? "advantage" : "disadvantage"`. This is THE real
  RPS mapping — use it for all RPS-puzzle logic. Do not re-implement the cycle.
- `explainRPS(game, move)` in js/analysis.ts:204 produces the human wording
  ("Vorteil"/"Risiko…im Nachteil"). Reuse the exact phrasing style for puzzle
  feedback. NOTE: analysis.ts imports board.ts; importing analysis.ts into the
  puzzle module risks a cycle — copy the wording, don't import.
- `RPS` constant + `FACTION` enum live in js/board.ts. `FACTION.FIRE/WATER/NATURE`.
- Existing `Puzzle` interface (js/puzzle.ts:15) is mate-shaped (fen, solution,
  mateIn, stats). RPS puzzles need a different shape → new `RpsPuzzle` type, NOT
  an extension of `Puzzle`, to keep Mate logic isolated.
- `Game.getLegalMoves(piece)` returns `{ moves, attacks }` (used in puzzle.ts:210).
  Attacks land on enemy-occupied cells; `getRPSResult(piece.faction, target.faction)`
  tells advantage/neutral/disadvantage of each attack. This is the basis for
  generating RPS puzzles: place pieces so that exactly ONE attack is an
  advantage-strike and others are disadvantage/neutral → unique correct answer.
- UI entry: `showPuzzleMenu()` (main.ts:2115) renders the Mate puzzle menu and
  the Daily button (main.ts:2151). We add a second button "🪨 RPS-Taktik" that
  calls a new `showRpsPuzzleMenu()`. `showPuzzleBoard` (main.ts:2238) renders a
  `Game` for a puzzle; we reuse it for RPS puzzles by passing an `RpsPuzzle`
  converted to a `Game` + an RPS-specific scoring/check callback.
- `makePuzzleMove` (puzzle.ts:449) is Mate-specific (compares to solution[]).
  RPS puzzles need their own `makeRpsPuzzleMove` that checks "did the player pick
  an advantage attack (or the only non-suicide move)?" rather than a fixed line.

---

## Task 1: Define the RpsPuzzle type + RPS core helper

**Objective:** A typed, testable module skeleton for RPS puzzles.

**Files:**

- Create: `js/rps-puzzle.ts`

**Step 1: Write the failing test.**

Create `tests/rps-puzzle.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getRPSOutcome } from "../js/rps-puzzle.ts";
import { FACTION } from "../js/board.ts";

describe("rps-puzzle core", () => {
  it("classifies the RPS cycle correctly", () => {
    expect(getRPSOutcome(FACTION.FIRE, FACTION.NATURE)).toBe("advantage");
    expect(getRPSOutcome(FACTION.NATURE, FACTION.WATER)).toBe("advantage");
    expect(getRPSOutcome(FACTION.WATER, FACTION.FIRE)).toBe("advantage");
    // Reverse = disadvantage
    expect(getRPSOutcome(FACTION.NATURE, FACTION.FIRE)).toBe("disadvantage");
    // Same = neutral
    expect(getRPSOutcome(FACTION.FIRE, FACTION.FIRE)).toBe("neutral");
  });
});
```

**Step 2: Run test to verify failure.**

Run: `npx vitest run tests/rps-puzzle.test.ts`
Expected: FAIL — `getRPSOutcome` not exported.

**Step 3: Write minimal implementation in `js/rps-puzzle.ts`.**

```ts
import { getRPSResult, FACTION } from "./board.ts";
import type { Faction } from "./types.ts";

export type RPSOutcome = "advantage" | "neutral" | "disadvantage";

/** Thin, named wrapper over the real RPS core (board.ts:52). */
export function getRPSOutcome(
  attacker: Faction,
  defender: Faction,
): RPSOutcome {
  return getRPSResult(attacker, defender);
}

export interface RpsPuzzle {
  id: string;
  /** Serialized position (reuse puzzle.ts serializePosition if available). */
  fen: string;
  sideToMove: Faction;
  /** Hex key of the piece that must move. */
  correctPieceKey: string;
  /** Hex key of the correct target (the RPS-advantage strike / safe move). */
  correctTargetKey: string;
  /** Why this is correct, in human wording (reuse analysis.ts style). */
  rationale: string;
  difficulty: "easy" | "medium" | "hard";
  createdAt: number;
}
```

**Step 4: Run test to verify pass.**

Run: `npx vitest run tests/rps-puzzle.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add js/rps-puzzle.ts tests/rps-puzzle.test.ts
git commit -m "feat(rps-puzzle): add type + RPS core wrapper"
```

---

## Task 2: RPS puzzle generator (unique advantage-strike)

**Objective:** Generate positions where exactly one legal move is the correct
RPS play (an advantage attack, or the only non-suicide move), so the puzzle has
a unique solution.

**Files:**

- Modify: `js/rps-puzzle.ts` (add `generateRpsPuzzles`)
- Modify: `tests/rps-puzzle.test.ts` (add generator test)

**Step 1: Write failing test.**

Append to `tests/rps-puzzle.test.ts`:

```ts
import { generateRpsPuzzles } from "../js/rps-puzzle.ts";

describe("rps-puzzle generator", () => {
  it("produces puzzles with a unique correct (advantage) strike", () => {
    const puzzles = generateRpsPuzzles(5);
    expect(puzzles.length).toBeGreaterThan(0);
    for (const p of puzzles) {
      expect(p.correctTargetKey).toBeTruthy();
      expect(p.rationale).toContain("Vorteil");
    }
  });
});
```

**Step 2: Run test to verify failure.**

Run: `npx vitest run tests/rps-puzzle.test.ts`
Expected: FAIL — `generateRpsPuzzles` not exported.

**Step 3: Implement generator using real Game rules.**

In `js/rps-puzzle.ts`, add:

```ts
import { Game } from "./game.ts";
import { generateBoard } from "./board.ts";
import { Piece } from "./pieces.ts";
import { Hex } from "./hex.ts";
import {
  getLegalMoves,
  cloneGameForTest,
  serializePosition,
} from "./puzzle.ts";

const TURNS: Faction[] = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];

export function generateRpsPuzzles(count = 10): RpsPuzzle[] {
  const out: RpsPuzzle[] = [];
  // Enumerate a small set of crafted 2-faction skirmish setups (FIRE vs NATURE,
  // etc.) where one side has a clear RPS-advantage strike available.
  const setups = buildRpsSetups();
  for (const g of setups) {
    if (out.length >= count) break;
    const puzzle = deriveRpsPuzzle(g);
    if (puzzle) out.push(puzzle);
  }
  return out;
}
```

Implement `buildRpsSetups()` to place 2–3 pieces per side on a generated board
(use `generateBoard()` + `new Piece(type, fac, hex)` like puzzle.ts:111-158
`reconstructGameFromHash`), and `deriveRpsPuzzle(game)` that:

- iterates the side-to-move's pieces and their `attacks`,
- classifies each attack via `getRPSOutcome`,
- accepts the position only if EXACTLY ONE attack is `advantage` (unique correct
  answer) and at least one alternative is `disadvantage` (so the wrong choice is
  a real trap),
- builds the `RpsPuzzle` with the advantage attack as correct + a rationale
  string in `explainRPS` style ("Schlägt eine <Faction>-Figur, die du im
  Stein-Schere-Papier-Zyklus schlägst (Vorteil).").

**Step 4: Run test to verify pass.**

Run: `npx vitest run tests/rps-puzzle.test.ts`
Expected: PASS (generator yields >0 unique puzzles).

**Step 5: Commit**

```bash
git add js/rps-puzzle.ts tests/rps-puzzle.test.ts
git commit -m "feat(rps-puzzle): generator for unique advantage-strike puzzles"
```

---

## Task 3: RPS puzzle move evaluation (correct vs trap)

**Objective:** Decide whether a player's chosen move is correct, using real RPS
logic — not a fixed solution line.

**Files:**

- Modify: `js/rps-puzzle.ts` (add `evaluateRpsMove`)
- Modify: `tests/rps-puzzle.test.ts` (add evaluation test)

**Step 1: Write failing test.**

```ts
describe("rps-puzzle evaluation", () => {
  it("accepts an advantage strike, rejects a disadvantage strike", () => {
    const puzzles = generateRpsPuzzles(1);
    const p = puzzles[0]!;
    // Correct: advantage attack
    expect(
      evaluateRpsMove(p, p.correctPieceKey, p.correctTargetKey).correct,
    ).toBe(true);
    // Any other legal attack that is a disadvantage strike must be wrong.
    const wrong = findAnyDisadvantageMove(p);
    if (wrong) {
      expect(evaluateRpsMove(p, wrong.piece, wrong.target).correct).toBe(false);
    }
  });
});
```

(`findAnyDisadvantageMove` is a test helper that reconstructs the Game from
`p.fen` and finds a disadvantage attack — implement inline in the test.)

**Step 2: Run test to verify failure.**

Run: `npx vitest run tests/rps-puzzle.test.ts`
Expected: FAIL — `evaluateRpsMove` not exported.

**Step 3: Implement evaluation.**

```ts
export function evaluateRpsMove(
  puzzle: RpsPuzzle,
  pieceKey: string,
  targetKey: string,
): { correct: boolean; outcome: RPSOutcome; rationale: string } {
  // Reconstruct the position to read factions from keys.
  const game = deserializeRpsPosition(puzzle.fen);
  const piece = game.getPieceAt(new Hex.fromKey(pieceKey));
  const target = game.getPieceAt(new Hex.fromKey(targetKey));
  if (!piece || !target)
    return { correct: false, outcome: "neutral", rationale: "Ungültiger Zug." };
  const outcome = getRPSOutcome(piece.faction, target.faction);
  const correct =
    pieceKey === puzzle.correctPieceKey &&
    targetKey === puzzle.correctTargetKey;
  const rationale =
    outcome === "advantage"
      ? "RPS-Vorteil: du schlägst die gegnerische Figur im Zyklus."
      : outcome === "disadvantage"
        ? "RPS-Nachteil: du verlierst diesen Tausch — beiß nicht in die Falle."
        : "Neutraler Schlag — nicht der taktische Schlüsselzug.";
  return { correct, outcome, rationale };
}
```

(Use the same serialize/deserialize helpers as puzzle.ts — `serializePosition`
is already exported from puzzle.ts; add `deserializeRpsPosition` reusing
`deserializePosition` from puzzle.ts:266 if exported, else replicate the
reconstruct logic. VERIFY the export name against puzzle.ts before writing the
final code.)

**Step 4: Run test to verify pass.**

Run: `npx vitest run tests/rps-puzzle.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add js/rps-puzzle.ts tests/rps-puzzle.test.ts
git commit -m "feat(rps-puzzle): evaluate player move via real RPS outcome"
```

---

## Task 4: Wire RPS-Taktik tab into the puzzle menu (UI)

**Objective:** Players can open RPS-Taktik puzzles from the existing menu.

**Files:**

- Modify: `js/main.ts:2115` (`showPuzzleMenu`) — add a second button
- Modify: `js/main.ts` — add `showRpsPuzzleMenu()` + `showRpsPuzzleBoard()`
- Modify: `js/main.ts:58-69` — import from `./rps-puzzle.ts`

**Step 1: Add imports near line 58.**

```ts
import {
  generateRpsPuzzles,
  evaluateRpsMove,
  type RpsPuzzle,
} from "./rps-puzzle.ts";
```

**Step 2: In `showPuzzleMenu` (main.ts:2115) render an extra button after the
Daily button (main.ts:2151):**

```html
<button id="rps-tactic-btn" class="menu-button">🪨 RPS-Taktik</button>
```

and wire it in the same function:

```ts
document
  .getElementById("rps-tactic-btn")
  ?.addEventListener("click", () => showRpsPuzzleMenu());
```

**Step 3: Add `showRpsPuzzleMenu()` + `showRpsPuzzleBoard()`.**

`showRpsPuzzleMenu` generates `generateRpsPuzzles(5)`, lists them as buttons
(reuse the `showPuzzleSelection` DOM pattern at main.ts:2200, swapping labels to
"RPS-Taktik #n — <difficulty>"). On click, call `showRpsPuzzleBoard(puzzle)`.

`showRpsPuzzleBoard` reconstructs a `Game` from `puzzle.fen` (reuse the
`deserializePosition` path), renders the board (reuse `showPuzzleBoard`'s
render call at main.ts:2238), and on cell click calls `evaluateRpsMove`. On a
correct advantage strike, show success feedback (reuse `showPuzzleResult` style
at main.ts:2498, labelled for RPS). On wrong (disadvantage) strike, flash the
"RPS-Nachteil" warning + show the rationale.

**Step 4: typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

**Step 5: Commit**

```bash
git add js/main.ts
git commit -m "feat(rps-puzzle): RPS-Taktik tab in puzzle menu + board UI"
```

---

## Task 5: Tests for the UI wiring + Daily-style streak (optional, if time)

**Objective:** Prove the menu button exists and the board dispatches correctly.

**Files:**

- Modify: `tests/main.test.ts` (or a new `tests/rps-puzzle-ui.test.ts`) — assert
  the RPS button triggers `showRpsPuzzleMenu` and `evaluateRpsMove` is called.

**Step 1: Write a test that imports `generateRpsPuzzles`, renders via the
existing DOM harness if available, and asserts `evaluateRpsMove` is invoked on a
click. Keep it unit-level (avoid full Playwright unless an e2e spec is added).**

**Step 2: Run `npx vitest run tests/rps-puzzle.test.ts tests/main.test.ts`.**

Expected: PASS.

**Step 3: Commit**

```bash
git add tests/
git commit -m "test(rps-puzzle): cover menu wiring + move evaluation"
```

---

## Task 6: Build + full CI verification + PR

**Objective:** Ship it green.

**Files:**

- Run: `npm run build` then `npx vitest run` then `npx tsc --noEmit` then
  `npx eslint .`

**Step 1: Build.**

Run: `npm run build`
Expected: success.

**Step 2: Full test + typecheck + lint.**

Run: `npx vitest run && npx tsc --noEmit && npx eslint .`
Expected: all PASS / 0 errors.

**Step 3: Update CHANGELOG [Unreleased] > Added with "RPS-Taktik-Puzzles" and
mark the README Roadmap "RPS-Taktik-Puzzles" [ ] → [x].**

**Step 4: Open a PR (main is branch-protected → PR-only).**

```bash
git checkout -b feat/rps-tactic-puzzles
git push -u origin feat/rps-tactic-puzzles
gh pr create --title "feat: RPS-Taktik-Puzzles (counter-strike training)" --body "New solo puzzle category training RPS counter-strikes. Reuses real getRPSResult core. No search-heuristic change, no tablebase generation."
```

Expected: PR opens; CI green. Merge after CI passes.

---

## Pitfalls (verified before writing)

- **Do NOT re-implement the RPS cycle.** `getRPSResult` (board.ts:52) is the
  single source of truth. Wrapping it in `getRPSOutcome` is fine; inventing a
  new mapping is a bug.
- **Circular import risk:** analysis.ts imports board.ts; importing analysis.ts
  from rps-puzzle.ts could cycle. Copy the `explainRPS` wording, don't import
  the function.
- **Don't extend `Puzzle` (mate shape).** RPS puzzles are a different concept →
  separate `RpsPuzzle` type keeps Mate validation (hasUniqueSolution/validate
  Puzzle) isolated.
- **serialize/deserialize helper names** in puzzle.ts must be checked against the
  actual export (Task 3, Step 3 note) before writing the final code — puzzle.ts
  exports `serializePosition` (line ~) and may export `deserializePosition`
  (referenced at line 266). Confirm the exact name.

## Verification summary (what "done" means)

- `generateRpsPuzzles` yields >0 unique puzzles, each with exactly one advantage
  strike and a disadvantage trap.
- `evaluateRpsMove` accepts the advantage strike, rejects disadvantage strikes,
  using real `getRPSResult`.
- "🪨 RPS-Taktik" button opens the new puzzle board; correct/wrong moves give
  RPS-specific feedback.
- `npx vitest run` green; `npx tsc --noEmit` clean; `npx eslint .` 0 errors.
- CHANGELOG + README updated; PR merged to main.
