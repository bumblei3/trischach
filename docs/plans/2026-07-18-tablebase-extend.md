# Tablebase Phase 3 — KR-vs-KP, KQ-vs-KR, KBN-vs-K Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Extend the trischach endgame tablebases from the current 3 (KQ/KR/KP vs K)
to cover KR-vs-KP, KQ-vs-KR, and KBN-vs-K, so the engine plays these 4-stone
endgames with perfect-play instead of heuristic search — real engine strength
with zero Elo risk (no search heuristic touched).

**Architecture:** The existing generator `scripts/gen-tablebase.ts` enumerates
all placements, builds a `Game` per placement, and solves each position with a
memoized full-minimax over the *real* Game rules (so RPS king-capture + pawn
promotion are already correct). The runtime maps hash→result in
`js/tablebase.ts`, probed from `minimax` in `js/ai-core.ts:1719`, gated by
`isTablebasePosition` (≤4 alive pieces AND ≥1 eliminated faction). The 3 new
endgames fit the same machinery. The ONLY structural risk is the solver's
`depth` cap of 60 plies: KBN-vs-K needs ~65+ plies to force mate, so the cap
must be raised for it. We verify each new endgame actually generates before
wiring it into the runtime.

**Tech Stack:** TypeScript + `tsx` (generator), vitest (tests), the existing
`gen-tablebase.ts` / `tablebase.ts` / `ai-core.ts` / `main.ts` runtime path.

---

## Verified facts (read before implementing — do NOT assume)

- `PieceType` includes `bishop` and `knight` (js/pieces.ts:15-16). So KBN-vs-K
  is representable — no new piece type needed.
- `solve(game, memo, depth)` in gen-tablebase.ts:81 has `depth` cap 60
  (gen-tablebase.ts:259 passes `60`). For positions past depth 0 it returns
  `draw` — so if a KBN mate is deeper than 60 plies, those positions get
  silently marked draw. **Mitigation:** add an `--endgame`-aware depth (e.g.
  kbn → 80) or a global `--depth=` override; verify generated counts are sane.
- `isTablebasePosition` (tablebase.ts:45) gates on `alive ≤ TB_PIECE_LIMIT(4)`
  AND `eliminatedFactions.size >= 1`. All 3 new endgames have exactly 4 pieces
  (2 per side) + 1 eliminated faction → automatically recognised. **No change
  needed to the gate.**
- `TURNS = [FIRE, WATER, NATURE]`; generator fixes STRONG=FIRE, WEAK=WATER,
  ELIM=NATURE (gen-tablebase.ts:210-212). New endgames reuse this symmetry.
- Runtime loading: `TABLEBASE_FILES` in main.ts:424 is a hardcoded array of 3
  paths. New files MUST be appended here (and the block comment updated).
- Worker push: main.ts:458-460 also pushes merged map to `aiWorker` + `workerPool`.
  Merging the new files into `merged` covers both paths automatically.
- Tests pattern: `tests/tablebase.test.ts` has a `describeEndgame(label, file,
  strong, weak)` helper (line 162) — reuse it for each new file. The minimax
  short-circuit is asserted once via the K+Q suite, so new suites only need the
  3 shared assertions.

---

## Task 1: Add the three endgame specs to the generator

**Objective:** Register krvk (KR-vs-KP), kqvkr (KQ-vs-KR), kbnvk (KBN-vs-K) in
`ENDGAMES` so the generator can build them.

**Files:**
- Modify: `scripts/gen-tablebase.ts:55-74` (the `ENDGAMES` record)

**Step 1: Read the current ENDGAMES block (already verified above).**

**Step 2: Add three entries.** Replace the `ENDGAMES` record with:

```ts
const ENDGAMES: Record<
  EndgameKind,
  { strong: PieceType[]; weak: PieceType[]; out: string }
> = {
  kq: {
    strong: ["king", "queen"],
    weak: ["king"],
    out: "public/js/tablebases/kq-vs-k.json",
  },
  kr: {
    strong: ["king", "rook"],
    weak: ["king"],
    out: "public/js/tablebases/kr-vs-k.json",
  },
  kpk: {
    strong: ["king", "pawn"],
    weak: ["king"],
    out: "public/js/tablebases/kpk.json",
  },
  // Phase 3 additions:
  krvk: {
    strong: ["king", "rook"],
    weak: ["king", "pawn"],
    out: "public/js/tablebases/kr-vs-kp.json",
  },
  kqvkr: {
    strong: ["king", "queen"],
    weak: ["king", "rook"],
    out: "public/js/tablebases/kq-vs-kr.json",
  },
  kbnvk: {
    strong: ["king", "bishop", "knight"],
    weak: ["king"],
    out: "public/js/tablebases/kbn-vs-k.json",
  },
};
```

Also extend the `EndgameKind` type (gen-tablebase.ts:47) to include the new keys:

```ts
type EndgameKind = "kq" | "kr" | "kpk" | "krvk" | "kqvkr" | "kbnvk";
```

**Step 3: Run the existing tests to confirm nothing broke.**

Run: `npx vitest run tests/tablebase.test.ts`
Expected: PASS (7+ existing tests still green — registration is data-only).

**Step 4: Commit**

```bash
git add scripts/gen-tablebase.ts
git commit -m "feat(tablebase): register KR-vs-KP, KQ-vs-KR, KBN-vs-K endgames in generator"
```

---

## Task 2: Make the solver depth configurable per endgame

**Objective:** KBN-vs-K needs >60 plies to force mate; raise the cap so its
positions aren't silently marked draw.

**Files:**
- Modify: `scripts/gen-tablebase.ts:259` (the `solve(g, memo, 60)` call)
- Modify: `scripts/gen-tablebase.ts:193-208` (argument parsing, add `--depth=`)

**Step 1: Add a `--depth=` CLI override and an endgame default.**

In `main()`, after the `limit` parsing (around line 207), add:

```ts
const depthArg = process.argv.find((a) => a.startsWith("--depth="));
// KBN-vs-K needs ~65+ plies to force mate; default 60 is too shallow.
const ENDGAME_DEPTH: Partial<Record<EndgameKind, number>> = {
  kbnvk: 90,
};
const searchDepth = depthArg
  ? Number(depthArg.slice("--depth=".length))
  : (ENDGAME_DEPTH[eg] ?? 60);
```

**Step 2: Use `searchDepth` in the solve call (line 259).**

Replace:
```ts
        const solved = solve(g, memo, 60);
```
with:
```ts
        const solved = solve(g, memo, searchDepth);
```

**Step 3: Run generator for the cheap endgames to confirm still works.**

Run: `npx tsx scripts/gen-tablebase.ts --endgame=kr --limit=200`
Expected: prints "Solved N unique positions; memo=…" and "Wrote … entries".
(limit=200 keeps it fast; full gen is Task 4.)

**Step 4: Commit**

```bash
git add scripts/gen-tablebase.ts
git commit -m "feat(tablebase): make solver depth configurable; KBN needs >60 plies"
```

---

## Task 3: Smoke-test that each new endgame generates & is decisive

**Objective:** Prove the 3 new endgames actually produce a non-empty, decisive
table before committing to full generation (catches symmetry/rule bugs early).

**Files:**
- Run (no file change): `npx tsx scripts/gen-tablebase.ts --endgame=<eg> --limit=3000`

**Step 1: Generate a partial KBN-vs-K table and inspect distribution.**

Run: `npx tsx scripts/gen-tablebase.ts --endgame=kbnvk --limit=3000`
Expected: output shows `win=… loss=… draw=0` (draws are omitted by design).
Confirm `Wrote <N> entries` with N > 0. If N is 0 or the process errors /
OOMs, STOP — KBN generation is infeasible on this board and we drop it (see
Risk note in Task 4). Report back before proceeding.

**Step 2: Same smoke for KR-vs-KP and KQ-vs-KR.**

Run (each):
```
npx tsx scripts/gen-tablebase.ts --endgame=krvk --limit=3000
npx tsx scripts/gen-tablebase.ts --endgame=kqvkr --limit=3000
```
Expected: each prints a positive entry count and a win/loss distribution.

**Step 3: Commit the smoke output reasoning to the plan log (no code commit yet
— these partial files are temp). Do NOT commit the `--limit` JSONs.**

Decision gate: if all 3 produced entries, proceed to Task 4. If any produced 0
entries or crashed, that endgame is excluded and the plan is adjusted.

---

## Task 4: Full generation of the three tablebases

**Objective:** Generate the complete, production JSON files for all 3 endgames.

**Files:**
- Create (generated): `public/js/tablebases/kr-vs-kp.json`
- Create (generated): `public/js/tablebases/kq-vs-kr.json`
- Create (generated): `public/js/tablebases/kbn-vs-k.json`

**Step 1: Generate KR-vs-KP (full).**

Run: `npx tsx scripts/gen-tablebase.ts --endgame=krvk`
Expected: `Solved <large N> unique positions; memo=<M>` and `Wrote <N> entries`.

**Step 2: Generate KQ-vs-KR (full).**

Run: `npx tsx scripts/gen-tablebase.ts --endgame=kqvkr`
Expected: same shape, positive counts.

**Step 3: Generate KBN-vs-K (full, uses --depth=90 default).**

Run: `npx tsx scripts/gen-tablebase.ts --endgame=kbnvk`
Expected: positive entry count; if it hangs > a few minutes per batch or OOMs,
stop and exclude KBN (park it, note why). Single endgame is still a win.

**Step 4: Check file sizes are sane (4-stone tables are bigger than 3-stone).**

Run: `ls -lh public/js/tablebases/`
Expected: new files present, each a few MB at most. If any file is > ~15 MB,
flag for review (the `--limit` in production build must still be acceptable for
GitHub Pages; the existing kq-vs-k.json is ~2.1 MB so 4-stone ~5-10 MB is fine).

**Step 5: Commit the generated JSONs (data files).**

```bash
git add public/js/tablebases/kr-vs-kp.json public/js/tablebases/kq-vs-kr.json public/js/tablebases/kbn-vs-k.json
git commit -m "feat(tablebase): generate KR-vs-KP, KQ-vs-KR, KBN-vs-K perfect-play tables"
```

---

## Task 5: Wire new tablebases into the runtime loader

**Objective:** main.ts fetches + merges the new JSONs so the engine actually
uses them in games.

**Files:**
- Modify: `js/main.ts:420-428` (TABLEBASE_FILES array + comment)

**Step 1: Append the three new paths.**

Replace the block:
```ts
const TABLEBASE_FILES = [
  "./js/tablebases/kq-vs-k.json",
  "./js/tablebases/kr-vs-k.json",
  "./js/tablebases/kpk.json",
];
```
with:
```ts
const TABLEBASE_FILES = [
  "./js/tablebases/kq-vs-k.json",
  "./js/tablebases/kr-vs-k.json",
  "./js/tablebases/kpk.json",
  "./js/tablebases/kr-vs-kp.json",
  "./js/tablebases/kq-vs-kr.json",
  "./js/tablebases/kbn-vs-k.json",
];
```
(Only include files that actually exist from Task 4 — if KBN was parked,
omit `kbn-vs-k.json` from this list.)

Also update the comment above (line 419-423) to mention the 3 new endgames.

**Step 2: typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (strings-only change, but confirm).

**Step 3: Commit**

```bash
git add js/main.ts
git commit -m "feat(tablebase): load KR-vs-KP, KQ-vs-KR, KBN-vs-K in runtime"
```

---

## Task 6: Extend the test suite for the new endgames

**Objective:** Prove each new tablebase loads, is recognised, and round-trips.

**Files:**
- Modify: `tests/tablebase.test.ts:206-224` (add `describeEndgame` calls)

**Step 1: Add three describeEndgame invocations at the end of the file.**

Append:
```ts
describeEndgame(
  "K+R vs K+P endgame",
  "public/js/tablebases/kr-vs-kp.json",
  [
    ["king", "1,1"],
    ["rook", "0,0"],
  ],
  [
    ["king", "2,2"],
    ["pawn", "3,3"],
  ],
);

describeEndgame(
  "K+Q vs K+R endgame",
  "public/js/tablebases/kq-vs-kr.json",
  [
    ["king", "1,1"],
    ["queen", "0,0"],
  ],
  [
    ["king", "2,2"],
    ["rook", "3,3"],
  ],
);

describeEndgame(
  "K+B+N vs K endgame",
  "public/js/tablebases/kbn-vs-k.json",
  [
    ["king", "1,1"],
    ["bishop", "0,0"],
    ["knight", "2,0"],
  ],
  [["king", "2,2"]],
);
```
(Only add the `describeEndgame` calls for files that exist from Task 4.)

**Step 2: Run the tablebase tests.**

Run: `npx vitest run tests/tablebase.test.ts`
Expected: all new `describeEndgame` suites PASS — `isTablebasePosition true`,
`generated JSON loads with decisive entries`, `probeTablebase round-trips`.
(Omitting KBN block if KBN was parked.)

**Step 3: Commit**

```bash
git add tests/tablebase.test.ts
git commit -m "test(tablebase): cover KR-vs-KP, KQ-vs-KR, KBN-vs-K endgames"
```

---

## Task 7: Build + full CI verification

**Objective:** Confirm the new data files ship and the whole suite stays green.

**Files:**
- Run: `npm run build` then `npx vitest run` then `npx tsc --noEmit` then `npx eslint .`

**Step 1: Build (copies JSONs into dist/).**

Run: `npm run build`
Expected: success; `dist/js/tablebases/` contains the 3 new JSONs.

**Step 2: Full test + typecheck + lint.**

Run: `npx vitest run && npx tsc --noEmit && npx eslint .`
Expected: all PASS / 0 errors.

**Step 3: Update CHANGELOG [Unreleased] > Added with the new endgames, and
refresh README Roadmap "Offen" — mark "Endgame Tablebases Phase 2+" done (now
Phase 3) and note KBN status.**

**Step 4: Open a PR (main is branch-protected → PR-only).**

```bash
git checkout -b feat/tablebase-phase3
git push -u origin feat/tablebase-phase3
gh pr create --title "feat: extend endgame tablebases to KR-vs-KP, KQ-vs-KR, KBN-vs-K" --body "Phase 3 tablebases. Perfect-play in 3 new 4-stone endgames. Zero Elo risk (search heuristic untouched)."
```
Expected: PR opens; CI green (unit-tests, e2e, typecheck, lint, nnue-gate,
benchmark). Merge after CI passes.

---

## Risks / decision gates

- **KBN-vs-K may be infeasible** on the 21-cell triangle board: either OOM,
  >minutes-per-batch, or produces 0 decisive entries. The 60→90 ply cap helps
  but doesn't guarantee termination within budget. **Gate:** Task 3 smoke must
  show >0 decisive entries; Task 4 full gen must finish without OOM. If KBN
  fails, park it (note in CHANGELOG) and ship KR-vs-KP + KQ-vs-KR only.
- **4-stone tables are larger than 3-stone.** Watch file sizes (Task 4, step 4).
  The GitHub Pages deploy budget is the only hard limit; existing kq file is
  ~2.1 MB so 4-stone ~5-10 MB is acceptable.
- **`isTablebasePosition` gate is unchanged** — all 3 endgames have exactly 4
  pieces + 1 eliminated faction, so they're recognised automatically. No gate
  edit needed.

## Verification summary (what "done" means)

- 3 new JSON tablebases exist and load (probeTablebase returns decisive entries).
- main.ts fetches + merges them; engine uses perfect-play in those endgames.
- `npx vitest run` green; `npx tsc --noEmit` clean; `npx eslint .` 0 errors.
- CHANGELOG + README updated; PR merged to main.

---

## Verified during implementation (2026-07-19) — PLAN WAS PARTIALLY WRONG

Three claims in the plan above did not match reality. Corrected approach:

1. **Board is 66 cells, not 21.** `generateBoard()` returns **66** cells
   (cube-coordinate keys like `0,0`, `-1,1`, `3,-1`). The plan's "21-cell
   triangle" assumption is stale. Full enumeration is P(66,4) ≈ 11.6M
   placements × 3 sides — NOT feasible with forward minimax (see #2). The
   `--limit=` flag caps the *number of cells* used, not placements. We generate
   with `--limit=8` (P(8,4)=1680 placements) which yields good coverage in
   ~3 min per endgame — same incomplete-but-useful scope as the existing
   kq/kr/kpk files (those were also generated with a limited cell set).

2. **4-stone forward minimax EXPLODES at depth 60 — it hangs, not just slow.**
   Tested directly: a single 4-stone position with depth 8 already hangs past
   30 s; depth 60 never terminates (process spins at ~1% CPU). The branching
   factor (≈10–20 moves/side) makes 15^60 untractable. A **shallow depth** is
   the fix: `--depth=4` terminates in seconds and finds short forced mates;
   `--depth=6` (the chosen default for krvk) gives 820 entries in ~3 min at
   limit=8; K+Q vs K+R needs `--depth=4` (the queen's large move set makes
   depth 6 explode) — 111 entries in seconds at limit=8. Set per-endgame
   defaults in `ENDGAME_DEPTH` (krvk=6, kqvkr=4, kbnvk=8). A first attempt used
   path-repetition pruning (`if path.has(hash) return draw`) — REVERTED: it
   terminated but scored every forced mate as `draw` (defender can always
   reshuffle), producing **0 entries** even for trivially-won K+R vs K. Shallow
   depth is correct.

3. **KBN-vs-K NOT generated.** Even at depth 8 the 3-attacker + king branching
   makes forward search explode; it was parked. KR-vs-KP and KQ-vs-KR ship.
   This is consistent with the "good, not provably perfect" design note in
   js/tablebase.ts — these are partial (limit=8) tables, not exhaustive DTM.

4. **kr-vs-k.json was clobbered during debugging** (a regression run wrote 0
   entries). Restored from git HEAD (13762 entries) before PR.
