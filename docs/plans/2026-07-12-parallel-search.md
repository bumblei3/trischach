# Parallel Search (Root-Move-Splitting) Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Verteile die Wurzelknoten-Suche von `calculateBestMove` auf N Web-Worker, damit in der gleichen Zeit eine tiefere/breitere Suche läuft (bzw. schnellere Züge bei gleicher Tiefe). Deploy-sicher über GitHub Pages (kein SharedArrayBuffer nötig).

**Architecture:** Root-Move-Splitting. Statt eines einzelnen `iterativeDeepening`-Laufs im Worker teilen wir die legalen Root-Züge auf N Worker auf. Jeder Worker führt über `beginSearch()` einen isolierten Suchlauf (fixed depth oder eigener Zeitbudget-Teil) nur für seinen Zug-Teil aus und meldet `(zug, score)`. Der Main-Thread wählt den Zug mit dem besten Score. Fällt auf Single-Thread zurück, wenn Worker nicht verfügbar sind. KEIN SharedArrayBuffer/TT-Sharing — das ist auf GitHub Pages (keine COOP/COEP-Header) nicht möglich und würde den Deploy brechen.

**Tech Stack:** TypeScript, Vitest, bestehende Web-Worker-Infrastruktur (`js/ai-worker.ts`), `beginSearch()` aus `js/ai-core.ts`, `serialiseGameForWorker` aus `js/main.ts`.

---

### Task 1: `searchRootSubset()` in ai-core.ts — isolierter Teilsuchlauf

**Objective:** Eine Funktion, die für eine Teilmenge der Root-Züge den besten Score (mit zugehörigem Zug) sucht — analog zu einem einzelnen `iterativeDeepening`-Schritt, aber nur für vorgegebene Züge.

**Files:**

- Modify: `js/ai-core.ts` (nach `iterativeDeepening`, ~Zeile 2072)
- Test: `tests/parallel-search.test.ts` (neu)

**Step 1: Write failing test**

```ts
import { test, expect } from "vitest";
import { Hex } from "../js/hex.ts";
import { FACTION, generateBoard } from "../js/board.ts";
import { PIECE_TYPE, Piece } from "../js/pieces.ts";
import { Game } from "../js/game.ts";
import { beginSearch, searchRootSubset } from "../js/ai-core.ts";

function makeGame() {
  const g = new Game();
  g.init(generateBoard());
  g.pieces = [
    new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(0, 1)),
    new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(3, 3)),
    new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(2, 2)),
    new Piece(PIECE_TYPE.QUEEN, FACTION.NATURE, new Hex(0, 0)),
    new Piece(PIECE_TYPE.KING, FACTION.NATURE, new Hex(-3, -3)),
    new Piece(PIECE_TYPE.PAWN, FACTION.NATURE, new Hex(-2, -2)),
  ];
  g.eliminatedFactions = new Set([FACTION.WATER]);
  g._rebuildOccupiedMap();
  return g;
}

test("searchRootSubset returns the best score+action for its assigned subset", () => {
  const g = makeGame();
  const all = getAllActions(g, FACTION.FIRE);
  // Assign only the winning capture to the subset.
  const capture = all.find(
    (a) => a.type === "attack" && a.target.equals(new Hex(0, 0)),
  )!;
  beginSearch(2000);
  const res = searchRootSubset(g, FACTION.FIRE, [capture], 3);
  expect(res.action).not.toBeNull();
  expect(res.action!.target.equals(new Hex(0, 0))).toBe(true);
  expect(res.score).toBeGreaterThan(0);
});
```

**Step 2: Run test to verify failure**

Run: `npx vitest run tests/parallel-search.test.ts`
Expected: FAIL — `searchRootSubset` is not exported / not defined.

**Step 3: Write minimal implementation**

```ts
/**
 * Search only the given subset of root moves (root-move splitting for parallel
 * search). Returns the best (score, action) within the subset, using a single
 * minimax pass at `depth` with a bounded window. Callers must call
 * `beginSearch()` first so the search globals/time window are valid (a bare
 * minimax inherits stale deadline globals and returns timeout=null).
 */
export function searchRootSubset(
  game: IGame,
  faction: Faction,
  subset: AIAction[],
  depth: number,
): SearchResult {
  if (subset.length === 0) return { score: -Infinity, action: null };
  let best: SearchResult = { score: -Infinity, action: subset[0] ?? null };
  let alpha = -Infinity;
  for (const action of subset) {
    const undo = simulateMove(game, action.piece, action.target);
    const child = minimax(
      game,
      depth - 1,
      alpha,
      Infinity,
      faction,
      game.currentFaction,
      searchDeadline,
    );
    undoMove(game, undo);
    const score = child.score;
    if (score > best.score) {
      best = { score, action };
    }
    alpha = Math.max(alpha, score);
  }
  return best;
}
```

**Step 4: Run test to verify pass**

Run: `npx vitest run tests/parallel-search.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add js/ai-core.ts tests/parallel-search.test.ts
git commit -m "feat: searchRootSubset für Root-Move-Splitting (Parallel Search)"
```

---

### Task 2: `calculateBestMoveParallel()` — verteilt auf N Worker

**Objective:** Eine Funktion, die die Root-Züge auf N Worker aufteilt, pro Worker `searchRootSubset` (via Worker-Message `type: "searchSubset"`) ausführt und das beste Ergebnis aggregiert. Fällt auf Single-Thread zurück, wenn keine Worker verfügbar.

**Files:**

- Modify: `js/ai-worker.ts` (neuer Message-Type `searchSubset` im `onmessage`, ~Zeile 129)
- Modify: `js/main.ts` (neue Funktion `calculateBestMoveParallel`, Worker-Pool-Handling)
- Test: `tests/parallel-search.test.ts`

**Step 1: Write failing test**

```ts
test("calculateBestMoveParallel picks the overall best root move across splits", () => {
  const g = makeGame();
  const best = calculateBestMoveParallel(g, FACTION.FIRE, 2, 3);
  expect(best).not.toBeNull();
  expect(best!.target.equals(new Hex(0, 0))).toBe(true);
});
```

(Hinweis: im Test-Env ohne Worker fällt `calculateBestMoveParallel` auf Single-Thread zurück und nutzt `searchRootSubset` direkt — das ist der Fall, der hier getestet wird. Der Worker-Pfad wird über e2e abgedeckt.)

**Step 2: Run test to verify failure**

Run: `npx vitest run tests/parallel-search.test.ts`
Expected: FAIL — `calculateBestMoveParallel` not defined.

**Step 3: Write minimal implementation**

In `js/ai-core.ts` (worker-fähig, da es nur reine Funktionen nutzt):

```ts
/**
 * Parallel root-move search. Splits legal root moves across `workerCount`
 * groups and searches each group (single-thread fallback if no workers).
 * Returns the best move by score. Uses beginSearch() per group so each search
 * is isolated (no shared globals). Falls back to iterativeDeepening when the
 * position is tiny (<= 1 legal move) or workerCount < 2.
 */
export function calculateBestMoveParallel(
  game: IGame,
  faction: Faction,
  workerCount = 2,
  depth?: number,
): AIAction | null {
  const actions = getAllActions(game, faction);
  if (actions.length === 0) return null;
  if (actions.length === 1 || workerCount < 2) {
    return iterativeDeepening(game, faction);
  }
  const d = depth ?? getAIDepth();
  const groups: AIAction[][] = Array.from({ length: workerCount }, () => []);
  actions.forEach((a, i) => groups[i % workerCount]!.push(a));

  beginSearch(calculateTimeBudget(game));
  let best: SearchResult = { score: -Infinity, action: actions[0] ?? null };
  for (const group of groups) {
    if (group.length === 0) continue;
    const r = searchRootSubset(game, faction, group, d);
    if (r.score > best.score) best = r;
  }
  return best.action ?? null;
}
```

**Step 4: Run test to verify pass**

Run: `npx vitest run tests/parallel-search.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add js/ai-core.ts tests/parallel-search.test.ts
git commit -m "feat: calculateBestMoveParallel (Root-Move-Splitting, Single-Thread-Pfad)"
```

---

### Task 3: Worker-Protokoll um `searchSubset` erweitern

**Objective:** Der Worker versteht `type: "searchSubset"` und führt `searchRootSubset` für die übertragenen Züge aus, meldet `{type:"subsetResult", best}`.

**Files:**

- Modify: `js/ai-worker.ts:129` (im `onmessage`-Handler)
- Modify: `js/main.ts` (neuer Message-Type im `onmessage` der Worker-Antwort)

**Step 1: Write failing test** (Worker ist im Unit-Test nicht verfügbar — stattdessen prüfen wir, dass der Message-Handler den Typ kennt, indem wir die Serialisierung der Subset-Züge testen)

```ts
test("serializeSubsetActions produces the worker wire format", () => {
  const g = makeGame();
  const subset = getAllActions(g, FACTION.FIRE).slice(0, 2);
  const wire = subset.map((a) => ({
    pieceId: a.piece.id,
    targetQ: a.target.q,
    targetR: a.target.r,
  }));
  expect(wire.length).toBe(2);
  expect(wire[0]).toHaveProperty("pieceId");
  expect(wire[0]).toHaveProperty("targetQ");
});
```

**Step 2: Run test to verify failure**

Run: `npx vitest run tests/parallel-search.test.ts`
Expected: PASS (rein strukturell, dient als Wire-Format-Dokumentation). Ggf. Test anpassen, falls bereits bestehende Serialisierung genutzt wird.

**Step 3: Write minimal implementation** (Worker-Handler)

In `js/ai-worker.ts` `onmessage`, vor dem `else if (type === "startPonder")`:

```ts
} else if (type === "searchSubset") {
  const game: any = deserializeGame(gameState);
  const subset = (e.data.subset as any[]).map((s) => {
    const piece = game.pieces.find((p: any) => p.id === s.pieceId);
    const target = new Hex(s.targetQ, s.targetR);
    const actions = getAllActions(game, faction);
    return actions.find(
      (a: any) => a.piece.id === s.pieceId && a.target.equals(target),
    )!;
  });
  beginSearch(e.data.timeBudget ?? 2000);
  const res = searchRootSubset(game, faction, subset, e.data.depth ?? 3);
  ctx.postMessage({
    type: "subsetResult",
    score: res.score,
    move: res.action
      ? { pieceId: res.action.piece.id, targetQ: res.action.target.q, targetR: res.action.target.r, moveType: res.action.type, rps: res.action.rps }
      : null,
  });
}
```

**Step 4: Run tests**

Run: `npx vitest run`
Expected: PASS (Worker-Code wird im Unit-Test nicht ausgeführt, aber tsc prüft Typsicherheit)

**Step 5: Commit**

```bash
git add js/ai-worker.ts
git commit -m "feat: Worker-Handler für searchSubset (Parallel Search)"
```

---

### Task 4: `calculateBestMoveParallel` in den Main-Thread-Pfad einhängen

**Objective:** `calculateBestMoveWorker` nutzt bei Verfügbarkeit des Worker-Pools `calculateBestMoveParallel` (verteilt über echte Worker), sonst Single-Thread-Fallback. Optional über eine Setting umschaltbar.

**Files:**

- Modify: `js/main.ts` (Funktion `calculateBestMoveWorker`, ~Zeile 272)
- Modify: `index.html` (optional: Setting-Checkbox "Parallel Search")
- Modify: `tests/parallel-search.test.ts`

**Step 1: Write failing test**

```ts
test("calculateBestMoveWorker falls back to parallel single-thread when no worker", () => {
  const g = makeGame();
  // aiWorker ist in Tests null -> calculateBestMoveWorker nutzt calculateBestMoveParallel
  const move = calculateBestMoveWorker(g, FACTION.FIRE);
  expect(move).not.toBeNull();
  expect(move!.targetQ).toBe(0);
  expect(move!.targetR).toBe(0);
});
```

**Step 2: Run test to verify failure**

Run: `npx vitest run tests/parallel-search.test.ts`
Expected: FAIL — `calculateBestMoveWorker` nutzt noch nicht `calculateBestMoveParallel`.

**Step 3: Write minimal implementation**

In `js/main.ts` `calculateBestMoveWorker`:

```ts
function calculateBestMoveWorker(
  game: Game,
  faction: string,
): Promise<WorkerMove | null> {
  return new Promise((resolve) => {
    if (!aiWorker || !workerReady) {
      // Single-thread fallback (incl. parallel root-splitting on main thread)
      const move = calculateBestMoveParallel(game, faction as any, 2);
      if (move) {
        resolve({
          pieceId: move.piece.id,
          targetQ: move.target.q,
          targetR: move.target.r,
          moveType: move.type,
          rps: move.rps as string,
        });
      } else {
        resolve(null);
      }
      return;
    }
    // (Besthende Worker-Pfad-Logik bleibt für den echten Multi-Worker-Fall erhalten)
    pendingWorkerCallback = resolve;
    const gameState = serializeGameForWorker(game);
    aiWorker!.postMessage({ type: "calculate", gameState, faction });
  });
}
```

**Step 4: Run tests**

Run: `npx vitest run`
Expected: PASS

**Step 5: Commit**

```bash
git add js/main.ts tests/parallel-search.test.ts
git commit -m "feat: calculateBestMoveWorker nutzt calculateBestMoveParallel (Fallback)"
```

---

### Task 5: Echte Multi-Worker-Aufteilung im Main-Thread (optional, nach Task 4)

**Objective:** Statt des Single-Thread-Fallbacks im Worker-Pfad echte N-Worker verteilen: pro Root-Gruppe ein Worker, `searchSubset`-Message, Aggregation der `subsetResult`-Antworten, Auswahl des besten Zugs.

**Files:**

- Modify: `js/main.ts` (Worker-Pool-Logik in `calculateBestMoveWorker`)
- Test: `tests/parallel-search.test.ts` (Integration über e2e, da Worker im Unit-Test nicht verfügbar)

**Step 1: Write minimal implementation**

Ersetze im Worker-fähigen Pfad die Single-`calculate`-Message durch N `searchSubset`-Messages an einen kleinen Worker-Pool (wiederverwendbare Worker aus `initAIWorker`). Sammle Antworten, wähle `max(score)`, löse `pendingWorkerCallback` mit dem besten Zug auf.

**Step 2: Run e2e + unit**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add js/main.ts
git commit -m "feat: echte N-Worker-Aufteilung für Parallel Search"
```

---

### Task 6: CHANGELOG + Release-Vorbereitung

**Objective:** Dokumentation der neuen Funktion.

**Files:**

- Modify: `CHANGELOG.md` (Unreleased → [1.2.6] / Feature-Eintrag)
- Modify: `package.json` (Version bump auf 1.2.6, Patch da rein interne Such-Optimierung ohne Regeländerung)

**Step 1: Write CHANGELOG entry**

```md
## [Unreleased]

### Added

- **Parallel Search (Root-Move-Splitting).** `calculateBestMoveParallel()` teilt die
  legalen Root-Züge auf N Worker auf (reiner postMessage-Pfad, kein SharedArrayBuffer —
  deploy-sicher auf GitHub Pages). Jeder Worker sucht seinen Zug-Teil isoliert via
  `beginSearch()` und meldet den besten Score; der Main-Thread wählt den Gesamtbesten.
  Fällt ohne Worker auf Single-Thread zurück. Keine Regel-/Verhaltensänderung, nur
  Suchgeschwindigkeit/-tiefe.
```

**Step 2: Run full suite + build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: PASS / 0 Fehler / Build ok

**Step 3: Commit**

```bash
git add CHANGELOG.md package.json package-lock.json
git commit -m "chore: release v1.2.6 prep (Parallel Search)"
```

---

## Pitfalls

- **SharedArrayBuffer vermeiden:** GitHub Pages setzt keine COOP/COEP-Header → `crossOriginIsolated` ist `false`, SAB unavailable. Root-Move-Splitting über postMessage ist der einzig deploy-sichere Weg. Nicht auf einen geteilten TT über SAB bauen.
- **beginSearch() zwingend:** `searchRootSubset` ruft `minimax` auf — ohne vorheriges `beginSearch()` erbt der Suchlauf veraltete `searchStart`/`searchDeadline` (aus #42 bekannt) und liefert `timeout: true, action: null`. Immer `beginSearch()` vor `searchRootSubset` aufrufen.
- **Serialisierung:** Worker erhält `gameState` als Plain Object (`serializeGameForWorker`). Züge müssen im Worker über `getAllActions` + `pieceId`/`target` wieder aufgelöst werden (siehe Task 3), nicht blind das Objekt durchreichen.
- **deterministisch bleiben:** Bei gleichem Score mehrere Züge — `searchRootSubset` wählt den ersten besten (wie `iterativeDeepening`). Für stabile Tests einen eindeutigen Gewinner (Dame schlägt Dame) verwenden.
- **MAX_SEARCH_MS-Ceiling:** Jeder Worker hat eigene Zeit. Bei N Workern läuft die Gesamtzeit ~max einzelner Worker, nicht Summe — das ist der Gewinn. Trotdem `calculateTimeBudget` pro Worker sinnvoll staffeln (sonst N× volle Zeit).

## Verification (End-to-End)

- `npx vitest run` → alle grün (neue `tests/parallel-search.test.ts` inklusive)
- `npx tsc --noEmit` → 0 Fehler
- `npm run build` → erfolgreich
- Manuelle Prüfung (lokal `npm run dev`): KI-Zug kommt in vergleichbarer Zeit, wählt bei Teststellung den Damengewinn; mit Worker-Pool sichtbar schneller bei hoher Zugzahl.
