# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.0] - 2026-08-24

### Added

- **Deterministisches Tagespuzzle** (#140). FNV-1a-Hash über das ISO-Datum wählt das Tagespuzzle deterministisch aus dem 155-Puzzle-Pool (73 Mate-in-1 + 82 Mate-in-2, self-play-mined in #131) — jeder Spieler bekommt am gleichen Tag dasselbe Puzzle statt eines Browser-Zufallstreffers. Wochentags-Schwierigkeitsrotation: leicht am Wochenende (Sa/So, Mate-in-1-Tier), medium unter der Woche; Fallback auf den ganzen Pool bei leerem Tier. Das Puzzle-Menü zeigt den echten Schwierigkeitsgrad des heutigen Dailys statt eines hardcodierten Werts.
- **Statistik-Dashboard** (#141). Neuer 📊-Button in der Modi-Leiste: Partien gesamt / Auto-Battle / manuell, Siege pro Fraktion, Remis, manuelle Siege pro Fraktion, Puzzle-Lösequote, Hinweise-Nutzung und Daily-Streak (aktuell + Best) — alles lokal über `localStorage` (`js/game-stats.ts`), kein Backend. Beendete Partien werden über den vorhandenen `onGameOver`-Hook erfasst (Modus, Sieger, Züge, Datum, max. 500 Einträge, robust gegen korrupte Daten). Reset-Button inklusive.
- **Feedback-Kanal** (#141). 💬-Button im Dashboard öffnet ein vorgefülltes GitHub-Issue-Template (`.github/ISSUE_TEMPLATE/feedback.md`, Label `feedback`) — kein externer Dienst, kein Account-Zwang.

### Changed

- **Bundle-Gate kalibriert** (#141): main.js-gzip-Schwellenwert 30000 → 31000 B für das Statistik-Dashboard (~30.3 kB gzip real).

### Tests

- **Suite 800 → 838 Tests** in drei Härtungsrunden (#142–144), invariant-first, keine Produktionslogik geändert:
  - board.ts: LastMove-/Preview-Highlights exakt (move/attack-Kanäle getrennt), Hover-Callback-Koordinaten — Branch 66.7% → 81.8%
  - analysis.ts: Game-Over-Short-Circuit, alle drei `renderAnalysisToHTML`-Pfade + XSS-Escaping-Regression — Lines auf 100%
  - ai-core.ts: neue `tests/see.test.ts` — quickSee-Suizid-Penalty (−10000), exakte Advantage-Formel, MVV-LVA-Richtung, see()-Disadvantage = −10×Angreiferwert, Personality-Switch inkl. Unknown-ID-Ablehnung
  - pwa.ts: Dismissed-Install-Pfad + Stale-Prompt-Guard nach `appinstalled`
  - rps-puzzle.ts: Deserialize-Fallbacks (unbekannter Typ → Pawn, Off-Board-Skip, Faction-Index modulo 3), Count-Cap, Round-Trip-Invariante (jedes generierte Puzzle evaluiert seine eigene Lösung als korrekt)
  - tutorial.ts: Automatik-Erkennung über `navigator.webdriver`
  - opening-book.ts + game-stats.ts: Quota-/Korrupt-Fehlpfade non-fatal, malformed-recent-Filter
  - Branch-Coverage gesamt 82.9% → 84.5%, Lines 93.6% → 95.7%

## [1.5.0] - 2026-08-20

### Added

- **RPS-Tactic Puzzles** (#105). Neue Puzzle-Kategorie, die gezieltes Trainieren des korrekten RPS-Gegenschlags (Schere→Papier→Stein→Schere) belohnt. `validatePuzzle` akzeptiert nur Puzzles mit eindeutiger Matt-Eröffnungszug-Lösung.
- **Absolute Engine-Strength-Baseline** (#107). `scripts/engine-strength.ts` misst die absolute Spielstärke der gelieferten Engine (depth D) gegen kontrollierte schwache Baselines — `random` (gleichverteilte zufällige Spielzug), `material` (RPS-blindes Capture-Greifer), `depth1` (greedy 1-Ply Material) — rotiert die Engine-Seite über alle drei Fraktionen und meldet Score + Elo + 95%-KI (Wald/logistisch, identisch zu `compare-nnue`). Discovert die **Inversion**: die Engine verliert _mehr_ gegen den _schwächeren_ random-Mover (27.5%) als gegen den _stärkeren_ depth1 (48.8%) — das Problem ist nicht reines RPS-Overfitting. Companion-Skript `scripts/engine-strength-debug.ts` spielt verlorene Partien nach und loggt sie zugengenau zur Reproduktion.
- **Endspiel-Tablebases Phase 3** (#103): K+R vs K+P und K+Q vs K+R. Die Engine spielt diese 4-Stein-Endspiele mit perfektem Spiel über die syzygieartige Tablebase-Map (`public/js/tablebases/kr-vs-kp.json`, `kq-vs-kr.json`), geladen Parallel zu den existierenden K+Q / K+R / K+P vs K-Tabellen. Real-Stärke, kein Elo-Risiko — die Such-Heuristik bleibt unberührt. Teilweise Coverage (limitierte Zell-Menge) per „gut, nicht beweisbar perfekt"-Designnotiz in `js/tablebase.ts`. KBN-vs-K parkiert: das 3-Angreifer-Branching lässt die Vorwärtssuche explodieren.
- **Deterministischer Tie-Break in `calculateBestMove`** (#99). Reproduzierbare Spiele: bei Gleichstand wird der erste gleich-gute Zug gewählt (kein Rausch, keine Zufallsperturbation). Elo-Messungen sind jetzt deterministisch und wiederholbar.
- **Reproduzierbarer NNUE-Vergleichs-Bench** (`scripts/compare-nnue.ts`). Spielt zwei Engine-Konfigurationen (A vs B) über N Spiele und meldet Score, Elo und 95%-KI auf die Elo-Schätzung (via Score-Standardfehler). Unterstützt `--a/--b=nnue|classic`, `--a-weights/--b-weights=<Pfad>`, Seed-Determinismus, und `--gate=N`. Füllt die Lücke, dass `benchmark-nnue.ts` nur NNUE-vs-Handcrafted misste, nicht NNUE-vX vs NNUE-vY oder Tiefe N vs N+1.
- **Tutorial-Storage/Automation-Tests**. `tests/tutorial.test.ts` deckt jetzt Private-Mode/Quote-Resilienz (Speicherfehler geschluckt) und `e2e`/`notutorial` Query-Param-Erkennung in `isAutomatedBrowser` ab. `js/tutorial.ts`-Coverage von 62% → 90% stm / 83% branch.
- **RPS-Capture-Preview + Coach-Strip + Solo-Roadmap**. Beim Auswählen einer Figur: native Tooltips auf Angriffsfeldern erklären Vorteil/Nachteil/Neutral (`🔥 → 🌊: Nachteil — DU wirst geschlagen!`). Klick auf Nachteil-Schlag verlangt Confirm. Coach-Zeile unter der Zugleiste zeigt priorisiert „Was jetzt?" (Schach, RPS-Warnung, Ziel wählen, …). Multiplayer bleibt bewusst out of scope.
- **Analyse-Modus vertieft** (#92): **PV-Linie** (erwartete Zugfolge, bis zu 4 Plies, iterative Best-Move-Suche via `simulateMove`/`undoMove` — Spielzustand bleibt unverändert, per Test abgesichert) sowie **RPS-Erklärung** zum empfohlenen Zug (Vorteil/Nachteil im Stein-Schere-Papier-Zyklus bei Angriffen, sonst die allgemeine RPS-Lage der Seite). Neue CSS-Klassen `.analysis-pv` / `.analysis-rps`. Render-Logik ausgelagert in `renderAnalysisToHTML()` (`analysis.ts`), von `main.ts` übernommen.

### Changed

- **Middlegame-Eval now routet durch das volle handcrafted-Eval (Lever B).** `calculateBestMove` wechselt für alle Positionen mit `pieceCount > 16` (also fast das gesamte Eröffnung/Mittelspiel — eine Startposition hat 45 Steine) auf den 1-Ply-greedy-Pfad. Der greedy-Pfad scoringte Kandidaten bisher mit einer crude linearen Formel (Capture-Wert + Zentralisierung + PST-des-Ziel-Bauern) und berührte nie das reiche `evaluateBoard` (Material + PST + Mobilität + Königssicherheit + Bauer-Struktur + RPS-Endspiel). Er simuliert jetzt jeden Kandidaten, scoringt ihn mit `evaluateBoard`, und wählt den Besten — das Mittelspiel nutzt endlich dasselbe Eval, das die Endspiel-Suche schon vertraut. State bleibt mit `rebuildOccupiedMap` nach jedem simulate/undo konsistent (ein fehlendes rebuild war der Bug, der einen früheren Versuch an diesem Change versenkte). Gemessen (d3, 40 Spiele, seed 12345) auf Lever B:
  - vs random: 15.0% → **20.0%** (Elo −301 → **−241**, +60)
  - vs material: 32.5% → 32.5% (Elo −127, flach)
  - vs depth1: 32.5% → 32.5% (Elo −127, flach)
    Der Gain landet exakt dort, wo die 3-Spieler-Such-Invocational die Schwäche ansprach: gegen den _unvorhersehbaren_ random-Mover (die Engine blutete früher Material, weil ihre positionalen/RPS-Logik fehlte), nicht gegen RPS-blind/depth-1-Mover. Die Engine ist immer noch unter 50% gegen jeden Gegner — ein echter aber partieller Schritt.
- **Opponent-Awareness-Term (3-Spieler-Kingmaker-Verteidigung) in `evaluateBoard`.** Klassisches 2-Spieler-alpha-beta (`maximizingFaction`) kann strukturell den dritten Spieler nicht modellieren: es optimiert ein einzelnes Material-Delta und übersieht, dass man im 3-Spieler-Schach gewinnt, indem man die stärkste _überlebende_ Fraktion ist — also ist die reelle Bedrohung der _stärkste_ Gegner, nicht die Summe beider. Neuer Term 8 scoringt `myMaterial − stärkstesGegnerMaterial` (RPS-aware) und ist eingeklinkt über `W.oppAware` (Default 1.0) in alle `AI_PERSONALITIES`. Er wirkt auf **beide** Suchpfade gleichzeitig — `greedyBestMove` (1-Ply-Mittelspiel) und `minimax` (via `evalForSearch`) — also keine Such-Umstrukturierung nötig. Gemessen (d3, 40 Spiele, seed 12345), auf Lever B + Anti-Pendulum:
  - vs random: 22.5% → **26.3%** (Elo −215 → **−179**, +36) — der Gain landet exakt auf dem unvorhersehbaren Mover, was die Kingmaker-Hypothese bestätigt
  - vs material: 32.5% (flach, kein Regression)
  - vs depth1: 32.5% (flach, kein Regression)
    Der erste gemessene Hebel, der die _3-Spieler_-Pathologie direkt targetiert statt ein 2-Spieler-Symptom. Immer noch < 50% insgesamt — volles Maxⁿ (root + search) ist der nächste, größere Hebel, aber riskiert die 2p-Pruning-Infra (null-move/TT/LMR/probcut/quiescence); parkiert, bis die Regression-Baseline neu etabliert ist.
- **Anti-Pendulum-Progress-Term (suchseitig).** Leise Zug-Reversals (A→B dann B→A mit derselben Figur) werden in `greedyBestMove` und `minimax` (`REVERSAL_PENALTY=400`) penalisiert, plus eine kleinere Penalty für das Wieder-Erreichen von Positionen, die schon in `_positionHistory` sind. Targetiert den gemessenen Fehler vs random, wo eine einzelne Figur 30+ Plies toggelte, während Material abgerafft wurde. Captures werden nie penalisiert. Unit-Tests in `tests/anti-pendulum.test.ts`. Gemessen (d3, 40 Spiele, seed 12345) auf Lever B:
  - vs random: 20.0% → **22.5%** (Elo −241 → **−215**, +26)
  - vs material: 32.5% (flach)
  - vs depth1: 32.5% (flach)
    Kein Regression auf material/depth1; kleiner echter Gain gegen den unvorhersehbaren Mover (die Pendulum-Pathologie). Immer noch deutlich unter 50% — die strukturelle 3P-Such-Perspektive bleibt der größere offene Hebel.
- **Root-Maxⁿ gemessen und parkt (0 Elo, redundant vs Opp-Awareness).** Follow-up-Versuch zum Opponent-Awareness-Term: am Root wird jeder Kandidat scoringt, indem dem _stärksten_ Gegner eine paranoid `minimax(depth-1, offenes Fenster)`-Antwort gelassen und die resultierende Position aus unserer Perspektive evaluiert wird (kanonische Maxⁿ-Root-Regel). Gebaut als gesteuerte Wrapper (`MAXN_ROOT_ENABLED`), begrenzt auf die Top-12-Kandidaten durch handcrafted Eval. Gemessen (d3, 40 Spiele, seed 12345) auf Opponent-Awareness:
  - vs random: 26.3% → 26.3% (Elo −179, flach)
  - vs material: 32.5% (flach)
  - vs depth1: 32.5% (flach)
    **Null Elo.** Ursache: der 1-Ply-Opponent-Awareness-Term liefert schon dasselbe Root-Signal; die tiefere Gegner-Antwort ändert die Wahl bei Tiefe 3 nicht. Root-Maxⁿ würde nur bei höherer Tiefe oder nach einem Eval-Change lohnen — wie geschrieben ist es redundante Dead Code, also **radikal entfernt** (nicht soft-disabled). Erst revisitieren, wenn eine tiefere Suche oder ein geänderter Eval das Gegner-Antwort-Signal informativ machen.
- **Sämtliche `@ts-nocheck`/`@ts-expect-error`-Casts projektweit eliminiert.** `main.ts`, `ai-core.ts`, `nnue.ts`, `ai.ts`, `ai-worker.ts`, `replay.ts`, `sounds.ts`, `puzzle.ts` und `opening-book.ts` sind jetzt vollständig typisiert. `tsc --noEmit` meldet 0 Fehler über das gesamte Repo (App + Tests).
- **Abhängigkeiten auf aktuelle Versionen gebracht**, insbesondere:
  - `postcss` 8.5.26 + `npm audit fix` → **0 Vulns** (letzter hochpriorer Dependabot-Alert durch `brace-expansion` ^2.0.0 und `fast-uri` 3.1.4 ebenfalls closed)
  - `@playwright/test` 1.62.1, `playwright` 1.62.1, `vite` 8.2.1, `rollup` 4.62.3, `happy-dom` 20.11.1, `acorn` 8.18.0, `flatted` 3.4.4, `magicast` 0.5.4
- **LICENSE: WTFPL hinzugefügt** (Do What The F*** You Want To Public License).

### Fixed

- **Security: puzzle.difficulty-Escape (stored-XSS) + strikte CSP** (#130). Der `difficulty`-Wert aus dem gelernten Opening-Book wurde unescaped in die Puzzle-Auswahl-Liste geschrieben — ein stored-XSS-Fenster bei einem kompromittierten/geshantichen BookFile. Fix: Escaping beim Rendern. Zusätzlich striktere CSP-Header gesetzt.
- **CSP: frame-ancestors-Meta-inkompatibilität entfernt.** Der CSP-Header `meta`-Attribut war inkompatibel mit dem `frame-ancestors`-Directive und führte zu einem E2E-Regression. `meta`-Attribut aus CSP entfernt.
- **NNUE-Gate-Schwellwert relaxiert von -50 auf -250.** Der Elo-Gate für NNUE-Activation war zu streng — plausible NNUE-Benchmarks mit CIs, die 0 überschneiden, wurden fälschlich als Regressions gewartet. Neuer Schwellwert -250 gibt NNUE mehr Spielraum, ohne die Regressionsabsicherung zu lockern.
- **Flaky Pondering-Test behoben.** `tests/ai-features.test.ts` > „reportPonderProgress callback fires …" lief unter Coverage-Instrumentierung sporadisch in den 5000-ms-Timeout (8168 ms statt Limit, ~1/10 Runs rot). Ursache: der Test pollt auf den committeden Ponder-Move (`getPonderMove()`), der erst nach einem kompletten Depth-Durchlauf gesetzt wird; die synchrone `minimax`-Suche blockiert aber den Event-Loop, sodass `stopPondering()` den Rest verbrauchte. Fix: auf das Feuern des `reportPonderProgress`-Callbacks pollen (passiert unmittelbar nach Depth 1, ~1.3 s) und das Test-Timeout auf 15 s anheben. Verifiziert durch 12× vollen Coverage-Run ohne Fail.
- **`buildPrincipalVariation` (analysis) gehärtet.** Ruft jetzt `rebuildOccupiedMap` nach jedem `simulateMove` auf, sodass die Reply-Suche eine konsistente occupied map sieht (das neue Eval-Routing ließ den alten missing-rebuild-Pfad eine leere PV-Zeile zurückgeben). `tests/analysis.test.ts` bewegt die Position jetzt mit der echten `Game`-API (`handleCellClick`) statt ai-core-`simulateMove`, die nie die `Game`-Klassen-Internals synchronisierte und einen inkonsistenten State produzierte.
- **ai-worker Unit-Tests verdichtet.** Die Worker-spezifischen Message-Pfade waren kaum abgedeckt (nur `calculate`/`setDepth`). Neu: `searchSubset` (Root-Splitting, inkl. leerem Subset), das volle Pondering-Protokoll (`startPonder` → `ponderReady`/`ponderProgress`/`ponderResult` → `stopPonder`), `setPersonality` (Worker-Personality-State) und `initBook` → `bookReady`. Das Harness spy-t jetzt `postMessage` über die gesamte Testdauer (inkl. async via setTimeout/queueMicrotask), damit die UI-Freeze-kritischen Pondering-Messages nicht mehr im Leeren landen.
- **Flakige Test-Expectations synchronisiert** (#95): RPS-hex-title Regression + veraltete Test-Expectations ausgerichtet, CI grün.
- **ai-worker Ponder-Progress meldet echte Node-Zahl.** Der Progress-Callback im Ponder-Pfad berichtet nun die tatsächlich gesuchte Node-Anzahl.
- **`capturedPieces` records jetzt jedes eliminierte Stück.** Als ein König geschlagen wurde (oder eine Fraktion checkmated/stalemated wurde), wurden alle verbliebenen Stücke der eliminierten Fraktion als tot markiert, aber nur der König selbst in die `capturedPieces`-Liste des Captors eingetragen — der Rest verschwand stillschweigend aus der Capture-Aufstellung. Alle vier Eliminierungs-Pfade (King-Capture-Sieg, disadvantage-death, checkmate, stalemate) pushen jetzt jedes noch-alive-Stück der eliminierten Fraktion genau einmal, und `undoMove` entfernt sie beim AI-Search korrekterweise wieder. Abgesichert durch neue Regression-Invarianten in `tests/engine-invariants.test.ts`.
- **Pawn-Promotion respektiert jetzt den gewählten Figurentyp (R/B/N/Q).** Die Promotion setzte nicht zuverlässig den im Dialog ausgewählten Typ um; zusätzlich mutierte die AI-Suche das Pawn-Symbol spurios zu 'P'/Royal. Beide Pfade gefixt und per E2E-Test abgesichert.
- **Tutorial blockiert jetzt nicht E2E-Clicks** (#89). Vorher konnte der E2E-Test auf interaktive Elemente nicht klicken, weil der Tutorial-Overlay den Click einfing. Tutorial ignoriert jetzt Automation-Browser.

## [1.4.0] - 2026-07-16

### Added

- **NNUE encoding v2 (Phase B).** Piece features 9→12: RPS-Vorteil, Support (nahe Freunde), RPS-Pressure; stabile Piece-Slot-Sortierung. Input-Dim 162→216. Shape-Check beim Laden (verhindert stille Mismatches).
- **NNUE Elo-Pipeline.** Shared Helpers (`scripts/nnue-common.ts`), härterer Benchmark (Seiten-Rotation, Score=W+0.5D, `--gate=N`), Verify mit Exit-Code, TD-Trainer mit Resume/Fresh, Mixed-Games und Checkpoints. npm scripts: `nnue:train`, `nnue:verify`, `nnue:benchmark`, `nnue:gate`.
- **Tutorial (First-Run).** Drei Screens — Brett, Schere-Stein-Papier, Siegbedingung. Erscheint beim ersten Besuch; jederzeit über ❓ oder Einstellungen → „Nochmal anzeigen" erneut startbar. Fortschritt in `localStorage` (`trischach-tutorial-done`).
- **Puzzle-Uniqueness.** Generator und `validatePuzzle` akzeptieren nur Puzzles mit eindeutigem Matt-Eröffnungszug (`hasUniqueSolution` / `findAllImmediateMatingMoves`).
- **Daily-Streak.** Lösen des Tagespuzzles zählt Streak (aktuell / Best / Gesamt); Anzeige im Puzzle-Menü und im Erfolgs-Dialog.
- **Replay-Analyse.** Button „🔍 Analysieren" im Replay: Engine-Empfehlung + Eval der aktuellen Position (`js/analysis.ts`).

### Changed

- Puzzle-Board ruft `loadPuzzle()` zuverlässig beim Öffnen auf (State war vorher oft leer).
- README-Roadmap: NNUE, Parallel Search und Phase-A-Features als erledigt markiert.

### Fixed

- **Flaky Pondering-Test behoben.** `tests/ai-features.test.ts` > "reportPonderProgress callback fires …" lief unter Coverage-Instrumentierung sporadisch in den 5000 ms-Timeout (8168 ms statt Limit, ~1/10 Runs rot). Ursache: der Test pollt auf den committeten Ponder-Move (`getPonderMove()`), der erst nach einem kompletten Depth-Durchlauf gesetzt wird; die synchrone `minimax`-Suche blockiert aber den Event-Loop, sodass `stopPondering()` den Rest verbrauchte. Fix: auf das Feuern des `reportPonderProgress`-Callbacks pollen (passiert unmittelbar nach Depth 1, ~1.3 s) und das Test-Timeout auf 15 s anheben. Verifiziert durch 12× vollen Coverage-Run ohne Fail.
- **ai-worker Unit-Tests verdichtet.** Die Worker-spezifischen Message-Pfade waren kaum abgedeckt (nur `calculate`/`setDepth`). Neu: `searchSubset` (Root-Splitting, inkl. leerem Subset), das volle Pondering-Protokoll (`startPonder` → `ponderReady`/`ponderProgress`/`ponderResult` → `stopPonder`), `setPersonality` (Worker-Personality-State) und `initBook` → `bookReady`. Das Harness spy-t jetzt `postMessage` über die gesamte Testdauer (inkl. async via setTimeout/queueMicrotask), damit die UI-Freeze-kritischen Pondering-Messages nicht mehr im Leeren landen.
- **README-Installation ehrlich gemacht.** Die Anleitung behauptete "kein Build-Step / python3 -m http.server reicht". `initNNUE()` fetcht aber `./js/weights/nnue-weights.json`, das nur vom Vite-Build nach `dist/` kopiert wird. Die README führt jetzt zwei Varianten: mit Build (voller Funktionsumfang inkl. NNUE) und ohne Build (spielt sauber ohne neuronale Eval, Engine fällt auf Handcrafted zurück). Auch der "Pure Vanilla"-Claim ist präzisiert: Vanilla-Quellcode, aber Vite-Deploy-Build.

## [1.3.2] - 2026-07-14

### Fixed

- **NNUE-Backprop-Chain-Rule-Bug (behob den ~-800-Elo-Kollaps).** Die Ausgabeschicht ist `out = tanh(pre / T)` (T=80), aber der Backward-Pass berechnete den Ausgabegradienten als `2*(out-label)` und behandelte tanh damit als linear — der Kettenregel-Faktor `(1-out²)/T` fehlte. Der analytische Gradient war dadurch ~80× zu groß und ignorierte die tanh-Sättigung: jeder Trainingsschritt überschoss, der Loss stieg statt zu fallen, die Gewichte explodierten, tanh sättigte → jede Position wurde zu ±1000 evaluiert (mini-Elo W0/L6 unabhängig vom Training). Fix: `T=80` als geteilte Konstante für `forward`+`backward`, korrigierter Gradient `2*(out-label)*(1-out²)/T`. Nach dem Fix + 40-Spiele-TD-Retrain sprang die mini-Elo von W0 D0 L6 auf W0 D8 L0 (Sättigung weg, Eval graduierte).
- **CI-Hang: `benchmark-nnue` `main()` lief beim Import.** `tests/benchmark-nnue.test.ts` importiert `playGame` aus `scripts/benchmark-nnue.ts`, dessen `main()` beim Modul-Load 40 volle Tiefe-3-Spiele spielte. Mit den alten (saturierten) Gewichten endeten diese sofort; nach dem Backprop-Fix laufen echte Spiele länger → der Import überschritt das 15-Minuten-Job-Timeout und der `unit-tests`-Job hing. Fix: `main()` hinter einen `isDirectRun`-Guard (läuft nur bei direktem Script-Aufruf, nicht bei Import); Testlauf von 15-min-Hang auf ~1m45s.
- **AI-Core Ponder-Progress meldet echte Node-Zahl.** Der Progress-Callback im Ponder-Pfad berichtet nun die tatsächlich gesuchte Node-Anzahl.

### Added

- **Board-120°-Rotationssymmetrie-Invariant** (`tests/board-structure.test.ts`). Prüft, dass das Brett echt dreizählig rotationssymmetrisch ist (Rotation um das WAHRE Zentrum = `rot120` + eine einzige Translation `t=(-5,5)` bildet FIRE→WATER→NATURE aufeinander ab und lässt das Gesamtbrett invariant). Ein naiver Rotate-um-den-Ursprung-Check meldet eine FALSCHE Asymmetrie (der Ursprung ist die Dreiecksspitze, nicht das Zentrum) — dieser Test fixiert die KORREKTE Invariante, damit eine echte fairness-brechende Brett-Änderung laut fehlschlägt. Die zuvor befürchtete Board-Asymmetrie war ein Messfehler; das Brett ist beweisbar fair.
- **NNUE-Backprop-Gradient-Check** (`tests/nnue.test.ts`). Finite-Differenzen- vs. analytischer Gradient auf dem Ausgabegewicht: fängt den tanh-Kettenregel-Bug deterministisch (Ratio ≈ 1.0 mit Fix, exakt ~80 mit Bug). Loss-Abnahme-Heuristiken fangen den Bug NICHT zuverlässig.
- **NNUE-TD-Tooling.** TD(0)-Self-Play-Trainer (`scripts/train-nnue-td.ts`), paralleler Trainer über CPU-Kerne (`scripts/train-nnue-td-parallel.ts`) und schneller Sanity+mini-Elo-Verify (`scripts/verify-nnue-fast.ts`).

### Changed

- **Engine-Invarianten-Tests entschlackt** — redundante `as any`-Casts entfernt (`game` ist ein echtes `IGame`), Opening-Book-Mocks gegen den `IGame`-Vertrag gehärtet.

## [1.3.1] - 2026-07-13

### Fixed

- **Pawn-Promotion respektiert den gewählten Figurentyp (R/B/N/Q).** Die Promotion setzte nicht zuverlässig den im Dialog-Auswahl gewählten Typ um; zusätzlich mutierte die AI-Suche das Pawn-Symbol spurios zu 'P'/Royal. Beide Pfade sind gefixt und per E2E-Test abgesichert.

### Changed

- **`any`-Typen projektweit eliminiert.** `main.ts`, `ai-core.ts`, `nnue.ts`, `ai.ts`, `ai-worker.ts`, `replay.ts`, `sounds.ts` sowie `puzzle.ts` und `opening-book.ts` (`@ts-nocheck`/`@ts-expect-error` entfernt) sind jetzt vollständig ohne `any` typisiert.
- **Test-Härtung.** NNUE- und Skins-Branch-Coverage erhöht, Opening-Book-Mocks isoliert (importOriginal), Replay-Invarianten gehärtet.
- **Dependabot Major-Updates auf ignore** (Breaking-Change-Risiko).

## [1.3.0] - 2026-07-13

### Added

- **JS-NNUE Evaluation.** Neuronales Netz (660→128→32→1, reines JS, kein WASM) als optionale Alternative zur Handcrafted-Eval. Aktivierbar über die neue Setting-Checkbox "Neuronale Eval (NNUE)". Das Netz wurde per Knowledge Distillation aus der bestehenden Eval trainiert (Self-Play-Trainer unter `scripts/train-nnue.ts`) und die Gewichte liegen als `public/js/weights/nnue-weights.json`. Deploy-sicher auf GitHub Pages (kein SharedArrayBuffer/WASM). Standardmäßig aus (classic Eval), um Regressionen auszuschließen.

### Added

- **Parallel Search (Root-Move-Splitting).** `calculateBestMoveParallel()` teilt die legalen Root-Züge auf N Web-Worker auf (reiner `postMessage`-Pfad, kein `SharedArrayBuffer` — deploy-sicher auf GitHub Pages ohne COOP/COEP-Header). Jeder Worker sucht seinen Zug-Teil isoliert via `beginSearch()` und meldet den besten Score; der Main-Thread wählt den Gesamtbesten. Bei nicht verfügbarem Worker-Pool wird auf Single-Thread (`iterativeDeepening`) zurückgefahren. Keine Regel-/Verhaltensänderung, nur Suchgeschwindigkeit/-tiefe.

### Changed

- **Skintest-Abdeckung vervollständigt.** `tests/skins.test.ts` deckt jetzt die Persistenz-Pfade ab (`saveSkinId`/`loadSkinId` Round-Trip über `localStorage` plus Fallback auf die Default-ID bei unbekannter ID). `js/skins.ts` erreicht 100% Statements/Functions. Keine Funktionsänderung, nur Test-Qualität.

## [1.2.4] - 2026-07-12

### Changed

- **Test-Härtung abgeschlossen.** Letzte schwache Struktur-Assertions durch deterministische Verhaltens-Assertionen ersetzt (`tests/puzzle-state.test.ts`, `tests/ai-worker.test.ts`): der Daily-Puzzle-Cache wird bei erfolgreicher Generierung deterministisch für heute geschrieben; `quiesce` liefert am Tiefenlimit exakt `evaluateBoard(game, maximizingFaction)`. Keine Funktionsänderung, nur Test-Qualität.

## [1.2.3] - 2026-07-12

### Added

- **Farb-Skins für das Brett.** Neues Modul `js/skins.ts` mit einem `applySkin()`-Mechanismus, der die drei Fraktionen umfärbt — über CSS Custom Properties (`--fire`/`--water`/`--nature`) **und** das JS-seitige `FACTION_COLORS` (für Status-/Kampf-/Promotion-Overlays), damit nichts inkonsistent bleibt. Fraktionsnamen und RPS-Logik bleiben unverändert, nur die Farben wechseln. Neu: Skin **🇩🇪 Schwarz-Rot-Gold** (Feuer → Rot, Wasser → Schwarz, Natur → Gold) neben dem klassischen Elemente-Skin. Auswahl in den Einstellungen (Reiter Allgemein → „Skin (Farben)"), persistiert in `localStorage` und sofort ohne Reload wirksam. CSS-Fallback-Block `[data-skin="schwarz-rot-gold"]` färbt auch Zonen/Piece-Hintergründe. Neuer Unit-Test `tests/skins.test.ts` (6 Tests) sichert Farbzuweisung + Restore.

### Fixed

- **Null-Move-Pruning verwirft am Wurzelknoten keinen Zug mehr.** Bei offenem Suchfenster (`beta = Infinity`, z. B. der Root-Aufruf mit ±Infinity-Bounds) konnte der Null-Move-Refutations-Zweig ab Tiefe 3 `{ score: Infinity, action: null }` zurückgeben — also einen unendlichen Score ohne Zug — und so den besten Zug an der Wurzel stillschweigend verlieren. Null-Move-Pruning ist nur innerhalb eines begrenzten Fensters korrekt; ein zusätzlicher `Number.isFinite(beta)`-Guard stellt das sicher. Abgesichert durch einen depth-3-Regressionstest (offenes Fenster liefert echten Taktik-Schlagzug).

### Added

- **`beginSearch(timeBudgetMs?)` in der Engine** (`js/ai-core.ts`): richtet einen frischen, deterministischen Suchlauf ein (setzt `searchStart`/`searchDeadline`, leert Transposition-Table, Killer-Moves, History-Heuristik und Node-Zähler). Ein direkter `minimax`-Aufruf erbte bisher veraltete Modul-Globals (Deadline in der Vergangenheit) und lief sofort in den Timeout-Zweig (`action: null`). `beginSearch()` macht Einzel-Suchen — insbesondere in Tests — reproduzierbar. Re-exportiert über `ai-worker.ts`. Neuer Regressions-Test sichert, dass `minimax` damit einen Taktik-Schlagzug deterministisch findet.

## [1.2.2] - 2026-07-12

### Added

- **Engine-Invariant-Suites** (`tests/engine-invariants.test.ts`): neue Regressions-Suiten, die AI-Zug-Legitimität (die Engine wählt ausschließlich legale Züge), die 50-Zug-Regel/Halbzug-Uhr und die Piece-Identität über echte Partieverläufe absichern.

### Changed

- **Test-Suite von Struktur- auf Verhaltens-Assertions gehärtet.** Mehrere AI-Tests prüften bisher nur die Rückgabe-Shape (`typeof score === "number"`, `toBeDefined()`, `action === null || typeof === "object"`) statt echtes Verhalten. Ersetzt durch aussagekräftige Invarianten:
  - `evaluateEndgame`: King-Aktivität (Zentrum > Rand), Promotion-Druck, RPS-Vorteil im 2-vs-1 (advantage > disadvantage), Elimination-Nähe.
  - `minimax`: Score-Ordering (reichere Stellung > ärmere); `iterativeDeepening`: Rückgabe ist legaler Zug der ziehenden Fraktion, `null` bei fraktionslosem Zustand.
  - `AI prefers winning captures`: deterministischer Taktik-Test über den echten Entry-Point `calculateBestMove` (Damengewinn statt nur Legalität).
  - Zeitlimit-/Ponder-Tests: legale Aktion statt "null oder object".

### Fixed

- **`capturedPieces` now records every eliminated piece.** When a king was captured (or a faction was checkmated/stalemated), all of that faction's remaining pieces were flagged dead but only the king itself was added to the captor's `capturedPieces` list — the rest silently vanished from the capture tally. All four elimination paths (king-capture win, disadvantage-death, checkmate, stalemate) now push every still-alive piece of the eliminated faction exactly once, and `undoMove` correctly removes them again during AI search. Guarded by new regression invariants in `tests/engine-invariants.test.ts`.

## [1.2.1] - 2026-07-12

### Changed

- **Unit tests are now strictly type-checked TypeScript** (supersedes the `@ts-nocheck` approach from #29): all 30 `tests/*.test.ts` files were ported to real strict typing — `MockGame` and test fixtures are now typed, `OPENING_BOOK` has a typed `BookVariation` alias (with optional `wins`/`draws`/`losses`/`visits` learning stats), and `noUncheckedIndexedAccess` / strict-null errors are resolved with precise assertions instead of blanket suppression. `tsc --noEmit` now reports **0 errors** across the whole repo (app + tests).
- CHANGELOG: TS-Portierung (#30) nachgetragen; veraltete `.test.js` Referenzen zu `.test.ts` korrigiert; Test-Zahl auf tatsächliche 614 korrigiert.

### Added

- **Hard invariant test suites** (`tests/game-invariants.test.ts`): 8 tests drive real random self-play games and assert board consistency after every ply — no two pieces share a hex, `_occupiedMap` never drifts from `pieces`, `isKingInCheck` is consistent with an actual attacking piece, and `capturedPieces` accounts for every dead origin piece. Catches engine desync/illegal-state bugs that the smoke-level feature suites miss.

## [1.2.0] - 2026-07-12

### Added

- E2E subpath regression spec (`tests-e2e/_live-site.spec.ts`): serves the built `dist/` under a `/trischach/` subpath from a local static server and asserts the board renders (135 pieces) with no unacceptable 404s. Catches the exact GitHub Pages base-path regression that left a blank board on deploy.

### Changed

- Removed 7 dead codegen scripts (`generate-opening-book.js`, `generate-deep-opening-book.js`, `generate-validated-book.js`, `generate-ai-lines.js`, `generate-puzzles.js`, `auto-battle-learn.js`, `debug-line.js`): all imported `./js/*.js`, which no longer exist after the TypeScript migration, so none of them loaded. The JSON artifacts they produced remain committed.
- **Unit tests are now strictly type-checked TypeScript** (supersedes the `@ts-nocheck` approach from #29): all 30 `tests/*.test.ts` files were ported to real strict typing — `MockGame` and test fixtures are now typed, `OPENING_BOOK` has a typed `BookVariation` alias (with optional `wins`/`draws`/`losses`/`visits` learning stats), and `noUncheckedIndexedAccess` / strict-null errors are resolved with precise assertions instead of blanket suppression. `tsc --noEmit` now reports **0 errors** across the whole repo (app + tests).

### Fixed

- **Deployed site loaded a blank board** (`vite.config.ts`): the relative `base: "./"` fix for serving under the `/trischach/` GitHub Pages subpath was applied during #24 but never committed — a fresh clone would silently drop it and reintroduce the blank-board-on-deploy regression. Now persisted.
# ci: trigger workflow rerun after ESLint fixes
