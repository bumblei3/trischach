# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Endgame tablebases Phase 3: K+R vs K+P and K+Q vs K+R.** The engine now
  plays these 4-stone endgames with perfect-play via the Syzygy-style
  tablebase map (`public/js/tablebases/kr-vs-kp.json`, `kq-vs-kr.json`), loaded
  alongside the existing K+Q/K+R/K+P vs K tables. Real strength, zero Elo risk
  — the search heuristic is untouched. Generated with the forward-minimax
  solver at shallow depth (`--limit=8 --depth=6`); coverage is partial (limited
  cell set) per the "good, not provably perfect" design note in `js/tablebase.ts`.
  KBN-vs-K was parked: its 3-attacker branching makes forward search explode.

- **Reproducible NNUE compare-bench (`scripts/compare-nnue.ts`).** Plays two
  engine configurations (A vs B) over N games and reports score, Elo, and a 95%
  confidence interval on the Elo estimate (via score standard error). Supports
  `--a/--b=nnue|classic`, `--a-weights/--b-weights=<path>` (weight-file
  comparison), seeded determinism, and `--gate=N`. Fills the gap that
  `benchmark-nnue.ts` only measured NNUE vs handcrafted, not NNUE-vX vs
  NNUE-vY or depth N vs N+1.

- **NNUE Elo study (concluded — parked).** Measured NNUE vs classic with the
  new bench: depth 2 → Elo −26 [95% CI −134..+82]; depth 3 → Elo −17
  [95% CI −125..+91]. Neither is significant (CIs overlap 0). The current
  NNUE architecture (216→128→32→1) yields **no measurable Elo over the
  handcrafted eval** at either depth. Retraining/layer-tuning is NOT justified
  — further eval work would be training without signal. Engine strength now
  comes from tablebases (see below) and search quality, not the NNUE eval.

- **Tutorial storage/automation tests.** `tests/tutorial.test.ts` now covers
  private-mode/quota resilience (storage errors swallowed) and `e2e`/`notutorial`
  query-param detection in `isAutomatedBrowser`. `js/tutorial.ts` coverage
  raised 62% → 90% stm / 83% branch. (PR #97)

- **RPS-Preview + Coach-Strip (Solo UX).** Beim Auswählen einer Figur:
  native Tooltips auf Angriffs-Hexes erklären Vorteil/Nachteil/Neutral
  (`🔥 → 🌊: Nachteil — DU wirst geschlagen!`). Klick auf Nachteil-Schlag
  verlangt Confirm. Coach-Zeile unter der Zugleiste zeigt priorisiert
  „Was jetzt?“ (Schach, RPS-Warnung, Ziel wählen, …). Ungültige Felder
  flashen eine kurze Warnung. Multiplayer bleibt bewusst out of scope
  (README aktualisiert). Modul: `js/coach.ts` + Tests.

- **Endgame Tablebases (Syzygy-Style, Phase 1).** Die Engine nutzt jetzt
  perfekte Endspiel-Evaluation für das Endspiel **K+Queen vs K** (eine
  Faction König+Dame, eine nur König, dritte Faction eliminiert). Ein Generator
  (`scripts/gen-tablebase.ts`, retrograde/perfekte Suche über das echte
  `Game`) baut eine Position→Ergebnis-Map (49.763 Einträge, ~2.1MB JSON in
  `public/js/tablebases/kq-vs-k.json`). In `minimax` (ai-core.ts) greift vor
  jeder Suche ein O(1)-Lookup (`probeTablebase`): bei Treffer wird die perfekte
  Eval (statt Heuristik) zurückgegeben. Geladen wird die Tabelle in `main.ts`
  (`initTablebase()`, fetch + an AI-Worker gepusht), analog zu `initNNUE`.
  Gated durch `isTablebasePosition` (≤4 Steine, ≥1 Faction eliminiert), also
  kein Einfluss auf Mittelspiele. Tests: `tests/tablebase.test.ts` (7, inkl.
  Engine-Integration dass `minimax` die TB-Eval nutzt).
  eine **PV-Linie** (erwartete Zugfolge, bis zu 4 Plies, iterative
  Best-Move-Suche via `simulateMove`/`undoMove` — der Spielzustand wird dabei
  nicht verändert, durch Test abgesichert) sowie eine **RPS-Erklärung** zum
  empfohlenen Zug (Vorteil/Nachteil im Stein-Schere-Papier-Zyklus bei Angriffen,
  sonst die allgemeine RPS-Lage der Seite). Neue CSS-Klassen `.analysis-pv` /
  `.analysis-rps`. Die Render-Logik wurde in `renderAnalysisToHTML()`
  (analysis.ts) ausgelagert und von `main.ts` übernommen.

## [1.4.0] - 2026-07-16

### Added

- **NNUE encoding v2 (Phase B).** Piece features 9→12: RPS-Vorteil, Support
  (nahe Freunde), RPS-Pressure; stabile Piece-Slot-Sortierung. Input-Dim
  162→216. Shape-Check beim Laden (verhindert stille Mismatches).
- **NNUE Elo-Pipeline.** Shared Helpers (`scripts/nnue-common.ts`), härterer
  Benchmark (Seiten-Rotation, Score=W+0.5D, `--gate=N`), Verify mit Exit-Code,
  TD-Trainer mit Resume/Fresh, Mixed-Games und Checkpoints. npm scripts:
  `nnue:train`, `nnue:verify`, `nnue:benchmark`, `nnue:gate`.

- **Tutorial (First-Run).** Drei Screens — Brett, Schere-Stein-Papier, Siegbedingung.
  Erscheint beim ersten Besuch; jederzeit über ❓ oder Einstellungen → „Nochmal
  anzeigen“ erneut startbar. Fortschritt in `localStorage`
  (`trischach-tutorial-done`).
- **Puzzle-Uniqueness.** Generator und `validatePuzzle` akzeptieren nur Puzzles
  mit eindeutigem Matt-Eröffnungszug (`hasUniqueSolution` /
  `findAllImmediateMatingMoves`).
- **Daily-Streak.** Lösen des Tagespuzzles zählt Streak (aktuell / Best / Gesamt);
  Anzeige im Puzzle-Menü und im Erfolgs-Dialog.
- **Replay-Analyse.** Button „🔍 Analysieren“ im Replay: Engine-Empfehlung +
  Eval der aktuellen Position (`js/analysis.ts`).

### Changed

- Puzzle-Board ruft `loadPuzzle()` zuverlässig beim Öffnen auf (State war vorher
  oft leer).
- README-Roadmap: NNUE, Parallel Search und Phase-A-Features als erledigt markiert.

### Fixed

- **Flaky Pondering-Test behoben.** `tests/ai-features.test.ts` >
  "reportPonderProgress callback fires …" lief unter Coverage-Instrumentierung
  sporadisch in den 5000 ms-Timeout (8168 ms statt Limit, ~1/10 Runs rot).
  Ursache: der Test pollt auf den committeten Ponder-Move (`getPonderMove()`),
  der erst nach einem kompletten Depth-Durchlauf gesetzt wird; die synchrone
  `minimax`-Suche blockiert aber den Event-Loop, sodass `stopPondering()` den
  Rest verbrauchte. Fix: auf das Feuern des `reportPonderProgress`-Callbacks
  pollen (passiert unmittelbar nach Depth 1, ~1.3 s) und das Test-Timeout auf
  15 s anheben. Verifiziert durch 12× vollen Coverage-Run ohne Fail.
- **ai-worker Unit-Tests verdichtet.** Die Worker-spezifischen Message-Pfade
  waren kaum abgedeckt (nur `calculate`/`setDepth`). Neu: `searchSubset`
  (Root-Splitting, inkl. leerem Subset), das volle Pondering-Protokoll
  (`startPonder` → `ponderReady`/`ponderProgress`/`ponderResult` →
  `stopPonder`), `setPersonality` (Worker-Personality-State) und `initBook` →
  `bookReady`. Das Harness spy-t jetzt `postMessage` über die gesamte
  Testdauer (inkl. async via setTimeout/queueMicrotask), damit die
  UI-Freeze-kritischen Pondering-Messages nicht mehr im Leeren landen.

- **README-Installation ehrlich gemacht.** Die Anleitung behauptete
  "kein Build-Step / python3 -m http.server reicht". `initNNUE()` fetcht
  aber `./js/weights/nnue-weights.json`, das nur vom Vite-Build nach
  `dist/` kopiert wird. Die README führt jetzt zwei Varianten: mit Build
  (voller Funktionsumfang inkl. NNUE) und ohne Build (spielt sauber ohne
  neuronale Eval, Engine fällt auf Handcrafted zurück). Auch der
  "Pure Vanilla"-Claim ist präzisiert: Vanilla-Quellcode, aber Vite-Deploy-Build.

## [1.3.2] - 2026-07-14

### Fixed

- **NNUE-Backprop-Chain-Rule-Bug (behob den ~-800-Elo-Kollaps).** Die
  Ausgabeschicht ist `out = tanh(pre / T)` (T=80), aber der Backward-Pass
  berechnete den Ausgabegradienten als `2*(out-label)` und behandelte tanh
  damit als linear — der Kettenregel-Faktor `(1-out²)/T` fehlte. Der analytische
  Gradient war dadurch ~80× zu groß und ignorierte die tanh-Sättigung: jeder
  Trainingsschritt überschoss, der Loss stieg statt zu fallen, die Gewichte
  explodierten, tanh sättigte → jede Position wurde zu ±1000 evaluiert
  (mini-Elo W0/L6 unabhängig vom Training). Fix: `T=80` als geteilte Konstante
  für `forward`+`backward`, korrigierter Gradient
  `2*(out-label)*(1-out²)/T`. Nach dem Fix + 40-Spiele-TD-Retrain sprang die
  mini-Elo von W0 D0 L6 auf W0 D8 L0 (Sättigung weg, Eval graduiert). (#80)
- **CI-Hang: `benchmark-nnue` `main()` lief beim Import.**
  `tests/benchmark-nnue.test.ts` importiert `playGame` aus
  `scripts/benchmark-nnue.ts`, dessen `main()` beim Modul-Load 40 volle
  Tiefe-3-Spiele spielte. Mit den alten (saturierten) Gewichten endeten diese
  sofort; nach dem Backprop-Fix laufen echte Spiele länger → der Import
  überschritt das 15-Minuten-Job-Timeout und der `unit-tests`-Job hing. Fix:
  `main()` hinter einen `isDirectRun`-Guard (läuft nur bei direktem
  Script-Aufruf, nicht bei Import); Testlauf von 15-min-Hang auf ~1m45s. (#80)
- **AI-Core Ponder-Progress meldet echte Node-Zahl.** Der Progress-Callback im
  Ponder-Pfad berichtet nun die tatsächlich gesuchte Node-Anzahl. (#79)

### Added

- **Board-120°-Rotationssymmetrie-Invariant** (`tests/board-structure.test.ts`).
  Prüft, dass das Brett echt dreizählig rotationssymmetrisch ist (Rotation um
  das WAHRE Zentrum = `rot120` + eine einzige Translation `t=(-5,5)` bildet
  FIRE→WATER→NATURE aufeinander ab und lässt das Gesamtbrett invariant). Ein
  naiver Rotate-um-den-Ursprung-Check meldet eine FALSCHE Asymmetrie (der
  Ursprung ist die Dreiecksspitze, nicht das Zentrum) — dieser Test fixiert die
  KORREKTE Invariante, damit eine echte fairness-brechende Brett-Änderung laut
  fehlschlägt. Die zuvor befürchtete Board-Asymmetrie war ein Messfehler; das
  Brett ist beweisbar fair. (#82)
- **NNUE-Backprop-Gradient-Check** (`tests/nnue.test.ts`). Finite-Differenzen-
  vs. analytischer Gradient auf dem Ausgabegewicht: fängt den tanh-
  Kettenregel-Bug deterministisch (Ratio ≈ 1.0 mit Fix, exakt ~80 mit Bug).
  Loss-Abnahme-Heuristiken fangen den Bug NICHT zuverlässig. (#82)
- **NNUE-TD-Tooling.** TD(0)-Self-Play-Trainer (`scripts/train-nnue-td.ts`),
  paralleler Trainer über CPU-Kerne (`scripts/train-nnue-td-parallel.ts`) und
  schneller Sanity+mini-Elo-Verify (`scripts/verify-nnue-fast.ts`). (#80)

### Changed

- **Engine-Invarianten-Tests entschlackt** — redundante `as any`-Casts entfernt
  (`game` ist ein echtes `IGame`), Opening-Book-Mocks gegen den
  `IGame`-Vertrag gehärtet. (#77, #78)

## [1.3.1] - 2026-07-13

### Fixed

- **Pawn-Promotion respektiert den gewählten Figurentyp (R/B/N/Q).** Die
  Promotion setzte nicht zuverlässig den in der Dialog-Auswahl gewählten Typ
  um; zusätzlich mutierte die AI-Suche das Pawn-Symbol spurios zu 'P'/Royal.
  Beide Pfade sind gefixt und per E2E-Test abgesichert. (#68, #69, #71, #72)

### Changed

- **`any`-Typen projektweit eliminiert.** `main.ts`, `ai-core.ts`, `nnue.ts`,
  `ai.ts`, `ai-worker.ts`, `replay.ts`, `sounds.ts` sowie `puzzle.ts` und
  `opening-book.ts` (`@ts-nocheck`/`@ts-expect-error` entfernt) sind jetzt
  vollständig ohne `any` typisiert. (#59–#64)
- **Test-Härtung.** NNUE- und Skins-Branch-Coverage erhöht, Opening-Book-Mocks
  isoliert (importOriginal), Replay-Invarianten gehärtet. (#57, #58, #65, #66,
  #67, #70)
- **Dependabot Major-Updates auf ignore** (Breaking-Change-Risiko).

## [1.3.0] - 2026-07-13

### Added

- **JS-NNUE Evaluation.** Neuronales Netz (660→128→32→1, reines JS, kein WASM)
  als optionale Alternative zur Handcrafted-Eval. Aktivierbar über die neue
  Setting-Checkbox "Neuronale Eval (NNUE)". Das Netz wurde per Knowledge
  Distillation aus der bestehenden Eval trainiert (Self-Play-Trainer unter
  `scripts/train-nnue.ts`) und die Gewichte liegen als
  `public/js/weights/nnue-weights.json`. Deploy-sicher auf GitHub Pages (kein
  SharedArrayBuffer/WASM). Standardmäßig aus (classic Eval), um Regressionen
  auszuschließen.

### Added

- **Parallel Search (Root-Move-Splitting).** `calculateBestMoveParallel()` teilt
  die legalen Root-Züge auf N Web-Worker auf (reiner `postMessage`-Pfad, kein
  `SharedArrayBuffer` — deploy-sicher auf GitHub Pages ohne COOP/COEP-Header).
  Jeder Worker sucht seinen Zug-Teil isoliert via `beginSearch()` und meldet den
  besten Score; der Main-Thread wählt den Gesamtbesten. Bei nicht verfügbarem
  Worker-Pool wird auf Single-Thread (`iterativeDeepening`) zurückgefahren.
  Keine Regel-/Verhaltensänderung, nur Suchgeschwindigkeit/-tiefe.

### Changed

- **Skintest-Abdeckung vervollständigt.** `tests/skins.test.ts` deckt jetzt die
  Persistenz-Pfade ab (`saveSkinId`/`loadSkinId` Round-Trip über `localStorage`
  plus Fallback auf die Default-ID bei unbekannter ID). `js/skins.ts` erreicht
  100% Statements/Functions. Keine Funktionsänderung, nur Test-Qualität.

## [1.2.4] - 2026-07-12

### Changed

- **Test-Härtung abgeschlossen.** Letzte schwache Struktur-Assertions durch
  deterministische Verhaltens-Assertionen ersetzt (`tests/puzzle-state.test.ts`,
  `tests/ai-worker.test.ts`): der Daily-Puzzle-Cache wird bei erfolgreicher
  Generierung deterministisch für heute geschrieben; `quiesce` liefert am
  Tiefenlimit exakt `evaluateBoard(game, maximizingFaction)`. Keine
  Funktionsänderung, nur Test-Qualität.

## [1.2.3] - 2026-07-12

### Added

- **Farb-Skins für das Brett.** Neues Modul `js/skins.ts` mit einem
  `applySkin()`-Mechanismus, der die drei Fraktionen umfärbt — über CSS
  Custom Properties (`--fire`/`--water`/`--nature`) **und** das JS-seitige
  `FACTION_COLORS` (für Status-/Kampf-/Promotion-Overlays), damit nichts
  inkonsistent bleibt. Fraktionsnamen und RPS-Logik bleiben unverändert, nur
  die Farben wechseln. Neu: Skin **🇩🇪 Schwarz-Rot-Gold** (Feuer → Rot,
  Wasser → Schwarz, Natur → Gold) neben dem klassischen Elemente-Skin.
  Auswahl in den Einstellungen (Reiter Allgemein → „Skin (Farben)"), persistiert
  in `localStorage` und sofort ohne Reload wirksam. CSS-Fallback-Block
  `[data-skin="schwarz-rot-gold"]` färbt auch Zonen/Piece-Hintergründe. Neuer
  Unit-Test `tests/skins.test.ts` (6 Tests) sichert Farbzuweisung + Restore.

### Fixed

- **Null-Move-Pruning verwirft am Wurzelknoten keinen Zug mehr.** Bei offenem
  Suchfenster (`beta = Infinity`, z. B. der Root-Aufruf mit ±Infinity-Bounds)
  konnte der Null-Move-Refutations-Zweig ab Tiefe 3 `{ score: Infinity,
action: null }` zurückgeben — also einen unendlichen Score ohne Zug — und so
  den besten Zug an der Wurzel stillschweigend verlieren. Null-Move-Pruning ist
  nur innerhalb eines begrenzten Fensters korrekt; ein zusätzlicher
  `Number.isFinite(beta)`-Guard stellt das sicher. Abgesichert durch einen
  depth-3-Regressionstest (offenes Fenster liefert echten Taktik-Schlagzug).

### Added

- **`beginSearch(timeBudgetMs?)` in der Engine** (`js/ai-core.ts`): richtet einen
  frischen, deterministischen Suchlauf ein (setzt `searchStart`/`searchDeadline`,
  leert Transposition-Table, Killer-Moves, History-Heuristik und Node-Zähler).
  Ein direkter `minimax`-Aufruf erbte bisher veraltete Modul-Globals (Deadline in
  der Vergangenheit) und lief sofort in den Timeout-Zweig (`action: null`).
  `beginSearch()` macht Einzel-Suchen — insbesondere in Tests — reproduzierbar.
  Re-exportiert über `ai-worker.ts`. Neuer Regressions-Test sichert, dass
  `minimax` damit einen Taktik-Schlagzug deterministisch findet.

## [1.2.2] - 2026-07-12

### Added

- **Engine-Invariant-Suites** (`tests/engine-invariants.test.ts`): neue
  Regressions-Suiten, die AI-Zug-Legitimität (die Engine wählt ausschließlich
  legale Züge), die 50-Zug-Regel/Halbzug-Uhr und die Piece-Identität über echte
  Partieverläufe absichern.

### Changed

- **Test-Suite von Struktur- auf Verhaltens-Assertions gehärtet.** Mehrere
  AI-Tests prüften bisher nur die Rückgabe-Shape (`typeof score === "number"`,
  `toBeDefined()`, `action === null || typeof === "object"`) statt echtes
  Verhalten. Ersetzt durch aussagekräftige Invarianten:
  - `evaluateEndgame`: King-Aktivität (Zentrum > Rand), Promotion-Druck,
    RPS-Vorteil im 2-vs-1 (advantage > disadvantage), Elimination-Nähe.
  - `minimax`: Score-Ordering (reichere Stellung > ärmere);
    `iterativeDeepening`: Rückgabe ist legaler Zug der ziehenden Fraktion,
    `null` bei fraktionslosem Zustand.
  - `AI prefers winning captures`: deterministischer Taktik-Test über den
    echten Entry-Point `calculateBestMove` (Damengewinn statt nur Legalität).
  - Zeitlimit-/Ponder-Tests: legale Aktion statt "null oder object".

### Fixed

- **`capturedPieces` now records every eliminated piece.** When a king was
  captured (or a faction was checkmated/stalemated), all of that faction's
  remaining pieces were flagged dead but only the king itself was added to the
  captor's `capturedPieces` list — the rest silently vanished from the capture
  tally. All four elimination paths (king-capture win, disadvantage-death,
  checkmate, stalemate) now push every still-alive piece of the eliminated
  faction exactly once, and `undoMove` correctly removes them again during AI
  search. Guarded by new regression invariants in
  `tests/engine-invariants.test.ts`.

## [1.2.1] - 2026-07-12

### Changed

- **Unit tests are now strictly type-checked TypeScript** (supersedes the
  `@ts-nocheck` approach from #29): all 30 `tests/*.test.ts` files were ported
  to real strict typing — `MockGame` and test fixtures are now typed, `OPENING_BOOK`
  has a typed `BookVariation` alias (with optional `wins`/`draws`/`losses`/
  `visits` learning stats), and `noUncheckedIndexedAccess` / strict-null errors
  are resolved with precise assertions instead of blanket suppression. `tsc
--noEmit` now reports **0 errors** across the whole repo (app + tests).
- CHANGELOG: TS-Portierung (#30) nachgetragen; veraltete `.test.js` Referenzen
  zu `.test.ts` korrigiert; Test-Zahl auf tatsächliche 614 korrigiert.

### Added

- **Hard invariant test suites** (`tests/game-invariants.test.ts`): 8 tests
  drive real random self-play games and assert board consistency after every
  ply — no two pieces share a hex, `_occupiedMap` never drifts from `pieces`,
  `isKingInCheck` is consistent with an actual attacking piece, and
  `capturedPieces` accounts for every dead origin piece. Catches engine
  desync/illegal-state bugs that the smoke-level feature suites miss.

## [1.2.0] - 2026-07-12

### Added

- E2E subpath regression spec (`tests-e2e/_live-site.spec.ts`): serves the
  built `dist/` under a `/trischach/` subpath from a local static server and
  asserts the board renders (135 pieces) with no unacceptable 404s. Catches the
  exact GitHub Pages base-path regression that left a blank board on deploy.

### Changed

- Removed 7 dead codegen scripts (`generate-opening-book.js`,
  `generate-deep-opening-book.js`, `generate-validated-book.js`,
  `generate-ai-lines.js`, `generate-puzzles.js`, `auto-battle-learn.js`,
  `debug-line.js`): all imported `./js/*.js`, which no longer exist after the
  TypeScript migration, so none of them loaded. The JSON artifacts they
  produced remain committed.

- **Unit tests are now strictly type-checked TypeScript** (supersedes the
  `@ts-nocheck` approach from #29): all 30 `tests/*.test.ts` files were ported
  to real strict typing — `MockGame` and test fixtures are now typed, `OPENING_BOOK`
  has a typed `BookVariation` alias (with optional `wins`/`draws`/`losses`/
  `visits` learning stats), and `noUncheckedIndexedAccess` / strict-null errors
  are resolved with precise assertions instead of blanket suppression. `tsc
--noEmit` now reports **0 errors** across the whole repo (app + tests).

### Fixed

- **Deployed site loaded a blank board** (`vite.config.ts`): the relative
  `base: "./"` fix for serving under the `/trischach/` GitHub Pages subpath was
  applied during #24 but never committed — a fresh clone would silently drop it
  and reintroduce the blank-board-on-deploy regression. Now persisted.

### Tests

- Test-suite hardening across iterations (565 → 614 passing unit
  tests, no skips, `tsc --noEmit` clean):
  - **Threefold-repetition invariant** (`tests/game-draw.test.ts`): the
    `_updateDrawState` repeat counter is now asserted to require THREE
    _consecutive_ occurrences of the same position hash — an intervening
    different position must not advance the original hash's counter.
  - **RPS attack-categorization invariant** (`tests/game-draw.test.ts`):
    `categorizeAttacks` is verified to never classify a same-faction (neutral)
    target. When a piece is fully surrounded by friendly pieces the attack set
    is empty and the `neutral` bucket stays empty; enemy targets land in
    `advantage`/`disadvantage`, never `neutral`.
  - **Undo after faction elimination** (`tests/game-state.test.ts`): capturing
    the enemy king eliminates the faction; `undo()` now fully reverts it —
    `eliminatedFactions` is cleared and the eliminated king is revived. Guards
    the historically corruption-prone `eliminatedFactions` + killed-pieces
    restore path.
  - **King-less faction is never checkmate/stalemate** (`tests/game-check.test.ts`):
    `isCheckmateInternal`/`isStalemateInternal` are asserted to return `false`
    when the faction has no living king (already eliminated).
  - **nextTurn skips two eliminated factions** (`tests/game.test.ts`): with
    Water AND Nature eliminated, a Fire move wraps the turn back onto Fire
    itself (the historically infinite-loop-prone 2-eliminated `_nextTurn` case).
  - **TSPN elimination round-trip** (`tests/replay-logic.test.ts`): a real game
    driven to a faction elimination serializes `[nature eliminated]` and
    `parseTSPN` round-trips it as exactly one move carrying `elimination`.
  - **Replay round-trip replays a saved game** (`tests/replay-logic.test.ts`):
    a TSPN loaded via `parseTSPN` (which carries only faction/pieceName/target,
    no source square) is now replayed to the final position by
    `reconstructGameFromTSPN` + `ReplayController`. Guards the previously silent
    replay abort (and the `piece.pos`-becomes-a-plain-object crash).
  - **Game over when only one faction remains** (`tests/game.test.ts`): capturing
    the last enemy king drives `aliveAfter.length <= 1` to `GAME_OVER` with the
    surviving faction declared `winner_faction` (game.ts:398-403).
  - **Checkmate eliminates the mated faction** (`tests/game.test.ts`): a real
    checkmating move (back-rank mate) eliminates the mated faction, mirroring the
    stalemate-elimination rule — verified through the full `handleCellClick` flow.
  - **snapshot()/restore() round-trips without aliasing** (`tests/game-state.test.ts`):
    `game.snapshot()` → `game.restore(snap)` reproduces the exact state and is a
    true deep copy (mutating the restored game does not leak back into the
    snapshot). Protects the undo/AI snapshot path.
  - **AI search honors a tight time limit** (`tests/integration.test.ts`):
    `calculateBestMove` returns well within a hard ceiling (regression guard for
    the 1.1.1 CI hang) even with an artificially low `MAX_SEARCH_MS`.
  - **Undo reverts a stalemate elimination** (`tests/game-state.test.ts`):
    the undo path restores a stalemate-eliminated faction (not only a
    king-capture elimination).
  - **Threefold repetition over the full handleCellClick flow** (`tests/game-draw.test.ts`):
    a 4-ply knight-commutation that returns to the same position with the same
    side-to-move triggers `DRAW_REPETITION` end-to-end (not just the isolated
    `_updateDrawState` unit).
  - **Undo reverts a promotion** (`tests/promotion.test.ts`): a promoted pawn is
    demoted back to a pawn (and returned to its pre-promo square) by `undo()`.
  - **Pinned piece cannot move** (`tests/check.test.ts`): a pinned pawn that
    would expose its own king to check is rejected by `handleCellClick` (the
    pawn stays put, turn does not advance).
  - **King may not move into check / may escape check** (`tests/game-check.test.ts`):
    `getLegalMoves` excludes king squares under attack and keeps the legal
    escape square.
  - **handleCellClick is a no-op after the game ends** (`tests/promotion.test.ts`):
    clicks in `GAME_OVER` / draw states return `null` and leave state untouched.
  - **handleCellClick is a no-op while awaiting promotion choice**
    (`tests/promotion.test.ts`): after a pawn reaches the promotion zone the
    engine enters `PROMOTION` and waits for `completePromotion()`; a board click
    in that window returns `null`, leaves state in `PROMOTION`, keeps
    `pendingPromotion` set, and does not move or promote the pawn — so the UI
    cannot sneak a second half-move in before the piece is chosen.
  - **RPS disadvantage kills the attacker** (`tests/game.test.ts`,
    `tests/promotion.test.ts`): through both `handleCellClick` and
    `simulateMove`, a disadvantaged attacker dies and the defender survives
    (symmetric counterpart to the advantage case).
  - **50-move rule over the full handleCellClick flow** (`tests/game-draw.test.ts`):
    a quiet move reaching 100 half-moves ends in `DRAW_50MOVE`, while a capture
    resets the clock to 0 and prevents the draw — both verified end-to-end.

### Fixed

- **TSPN parser shredded elimination annotations** (`js/replay.ts`):
  `parseMoveText` split move lines blindly on whitespace, so
  `1. fire_Queen_x_0,1 > [nature eliminated]` was parsed as three bogus tokens
  (`1.`, `[nature`, `eliminated]`) — the elimination marker was lost on load.
  It now splits on move-number boundaries (`\d+\.`), treats the trailing
  `[X eliminated]` annotation as a single unit (even with spaces), and sets the
  new `elimination` field on `ParsedMove`. Legacy single-line multi-move input
  is still supported.
- **TSPN replay path was broken for saved games** (`js/replay.ts`):
  `replayGame`/`precomputeStates` could only replay in-memory move history
  (which carries a live `piece` with `pos`); moves loaded from a TSPN file had
  no `piece`, so the replay skipped every move silently — loaded games could
  not be replayed. Two coupled defects fixed:
  1. Added `resolveSourcePiece(game, move)` which resolves the source square at
     replay time from `faction` + `pieceName` + the target's legal moves when no
     `piece` is present (mock games without `getLegalMoves` fall back to the
     first candidate).
  2. The `target` parsed from a TSPN is a plain `{q,r}` object; it is now
     converted to a real `Hex` before being passed to `handleCellClick`, which
     previously set `piece.pos` to a plain object and crashed the post-move
     check detection (`getValidMoves` → `piece.pos.add is not a function`).
     `Hex` is now imported in `replay.ts`.
- **Promotion never advanced draw state** (`js/game.ts`): the two-phase
  promotion flow (`_selectTarget` early-return + `completePromotion`)
  never called `_updateDrawState`, so a promoted position was (a) invisible to
  the threefold-repetition counter and (b) left the 50-move clock frozen
  instead of resetting it like every other pawn move. `completePromotion` now
  records the post-promotion position (clock reset to 0) once the piece is
  committed — guarding a genuine draw-rule bug, not just a test gap.
  - **completePromotion omitted `result.inCheck`** (`js/game.ts`): a promotion
    returned `result.inCheck === undefined` even when the now-to-move faction
    was left in check, whereas every other move result sets `inCheck` (game.ts
    `_selectTarget` does `result.inCheck = isKingInCheck(currentFaction)` after
    `_nextTurn`). `completePromotion` now mirrors that, so the UI/AI can see that
    the opponent was left in check by the promoted piece — a genuine
    inconsistency, not just a test gap.
    - **disadvantage combat into the promotion zone promoted a dead pawn**
      (`js/game.ts`): `_selectTarget` ran the `isPromotion` check on the
      selected pawn _after_ a combat resolved, without verifying the pawn
      survived. On a disadvantage RPS duel the attacker dies on its origin
      square (never reaching the target), yet the engine still set
      `pendingPromotion` and entered `PROMOTION` state — leaving a zombie
      "promoted" corpse (a dead piece transformed to a queen, stuck in
      PROMOTION). The check now also requires `selectedPiece.alive`, so only a
      pawn that actually reaches the target square can promote.
  - **app boot broke: mid-file `import` in `js/main.ts` blanked the board**
    (`js/main.ts`): the E2E test hooks added `import` statements _after_ the
    top-level `const renderer = new Game()` initialization code. ES modules
    forbid imports outside the top of a file, so the production `main.js`
    failed to parse, `init()` never ran, and the `#board-svg` stayed empty —
    the board "disappeared". Moved the imports to the top of the module and
    the `window.*` test hooks (which use those symbols) below the
    initialization. `Piece` is now imported once from `./pieces.ts` (it is a
    type-only re-export from `./game.ts`). Recovery verified by a new board
    smoke E2E test (see below).

  ### Tests

- Test-suite hardening across iterations (565 → 614 passing unit
  tests, no skips, `tsc --noEmit` clean):
  - **completePromotion resets the 50-move clock** (`tests/promotion.test.ts`):
    a promotion completes with `_halfmoveClock === 0`, matching the pawn-move
    reset rule (regression guard for the frozen-clock bug).
  - **completePromotion records the post-promotion position for repetition**
    (`tests/promotion.test.ts`): the promoted position enters `_positionHistory`
    so threefold repetition can fire on promotion-bearing loops.
  - **handleCellClick is a no-op while awaiting promotion choice**
    (`tests/promotion.test.ts`): a board click in `PROMOTION` state returns
    `null`, leaves state in `PROMOTION`, keeps `pendingPromotion` set, and does
    not move or promote the pawn.
  - **Threefold repetition over a promotion (end-to-end)**
    (`tests/game-draw.test.ts`): seeding the post-promotion position twice and
    then completing a promotion into it a third time ends the game as
    `DRAW_REPETITION` — full-flow regression guard for the round-21
    draw-state fix (previously the promoted position was never recorded).
  - **simulateMove/undoMove round-trip (AI search integrity)**
    (`tests/game.test.ts`): a disadvantage capture (attacker dies) and an
    advantage capture (defender dies) each fully revert via `undoMove` —
    no stale `capturedPieces` entry leaks, protecting the AI search from
    corrupted material state across make/unmake.
  - **onDraw fires for both draw outcomes**
    (`tests/game-callbacks.test.ts`): the `onDraw` callback (the only
    remaining uncovered callback branch) is asserted to fire with
    `"repetition"` on a threefold-repetition draw and with `"50move"` when
    the 50-move rule triggers — closing the gap where `if (this.onDraw)`
    in `_updateDrawState` never ran in the suite.
  - **completePromotion reports inCheck for the following faction**
    (`tests/promotion.test.ts`): after a promotion that leaves the now-to-move
    faction in check, `result.inCheck` is `true` (regression guard for the
    round-24 fix where a promotion returned `inCheck === undefined`).
  - **promotion by capture respects RPS survival**
    (`tests/promotion.test.ts`): two new invariants around a pawn capturing
    into the promotion zone — a _disadvantage_ duel (attacker dies on its
    origin) must NOT promote the dead pawn (no zombie `PROMOTION` state; the
    round-25 fix), while an _advantage_ duel (attacker reaches the target)
    still promotes the surviving pawn.
  - **board renders after app boot (smoke)** (`tests-e2e/_board-smoke.spec.ts`):
    a new E2E smoke test asserts the `#board-svg` paints 20+ pieces with no
    page errors after load. Regression guard for the blank-board boot failure
    caused by the mid-file `import` in `js/main.ts` (would otherwise ship a
    non-rendering app to GitHub Pages undetected).

### Docs

- Corrected README: actual unit-test count (579 passing, 0 skipped), `ai-worker`
  is now `ai-worker.ts`, CI runs Node 24 (not 20), and the stalemate branch in
  `game.ts` is live (eliminates the stalemated faction) — the earlier
  "dead-code" note no longer applies.

## [1.1.1] - 2026-07-10

### Fixed

- CI `unit-tests` job hung in GitHub Actions (single-fork vitest pool on a
  shared runner): the AI search only checked its time deadline every 1000
  nodes inside `minimax` and `quiesce` had no deadline guard at all, so a
  tactical explosion could block the fork past the 180s test timeout.
  - `quiesce()` now honors the search deadline.
  - Added a hard `MAX_SEARCH_MS` (4s) ceiling in `minimax`/`quiesce`/
    `iterativeDeepening` (and the pondering path) that guarantees
    `calculateBestMove` returns regardless of runtime speed.
- CI `lint` job failed: the tournament-cleanup edit left the README CI-jobs
  table prettier-noncompliant (`npx prettier --check .` now passes).
- CI `unit-tests` reported 352 passed but exited 1: a `setTimeout` callback in
  `main.ts` dereferenced `#combat-overlay` without a null check and threw
  after the integration tests finished under happy-dom. Now null-guarded.
- Removed the orphaned `tournament` CI job and `tournament.js` script (dead
  after the TypeScript port — they imported `./js/game.js` which no longer
  exists and failed every manual/scheduled run).

## [1.1.0] - 2026-07-10

### Added

- E2E regression spec covering auto-battle, puzzle, replay and new-game flows.

### Changed

- Ported TriSchach to TypeScript as the sole build entry point (replacing the
  legacy JS sources).
- Bumped CI/dev dependencies (Vite 5→8, Vitest 1→3, happy-dom 14→20,
  vite-node/coverage-v8→3). Clears all npm audit vulnerabilities.
- Raised Vitest `testTimeout` to 180s — the full AI-vs-AI integration test now
  takes ~105s under Vitest 3 / happy-dom 20.

### Fixed

- Auto-Battle UI freeze caused by a worker/service-worker race condition
  (`ai-worker.ts` now posts a `ready` signal immediately on load; `sw.js`
  bypasses cache for worker modules and dynamically imported scripts).
- Auto-Battle crash in the Web Worker (`deserializeGame` now rebuilds board
  cells and Game methods).
- Opening-book warnings and missing favicon.
- Deployed site cache paths in `sw.js`; re-activated GitHub Pages deploy.
- `tsc` rebase artifact: duplicate `boardCells` prop in `ai.ts`
  `deserializeGame`.

### Refactor

- Ported origin/main Auto-Battle and opening-book fixes into the `.ts` sources.

## [1.0.0] - 2026-06-17

### Added

- Initial stable release: TriSchach (3-faction RPS chess variant) with
  Auto-Battle, opening book, puzzles, replay and PWA/offline support.

[Unreleased]: https://github.com/bumblei3/trischach/compare/v1.3.2...HEAD
[1.3.2]: https://github.com/bumblei3/trischach/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/bumblei3/trischach/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/bumblei3/trischach/compare/v1.2.6...v1.3.0
[1.2.0]: https://github.com/bumblei3/trischach/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/bumblei3/trischach/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/bumblei3/trischach/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/bumblei3/trischach/releases/tag/v1.0.0
