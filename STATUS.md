# trischach — Status (Stand: 2026-10-20, HEAD 4d27466)

`main` (4d27466) enthält Capture-Reply + Kingmaker + Zobrist/State-Fix + Tagespuzzle,
dazu **unreleased seit Tag `v1.6.0`** (2026-08-24, 16 Commits): Solo-Modus gegen die KI,
Code-Splitting (`game.ts` eigener Chunk), 145 transitive Pseudo-Dependencies entfernt,
Modus-Chunks für Puzzle/Replay/Analyse, `evaluateLeaf` an die Minimax-_Leafs_,
Bench-Artefakt. `package.json` steht noch auf
`1.6.0` → Release `v1.7.0` ist fällig.

- Statistik-Dashboard + Feedback-Kanal. Engine-Arbeit ist **abgeschlossen geparkt** —
  alle verbleibenden Hebel gemessen negativ/flach (Details unten).

## Gesundheit

Alle Gates grün (Node 24, CI-Version):

| Gate       | Befehl                   | Ergebnis                   |
| ---------- | ------------------------ | -------------------------- |
| Typecheck  | `npm run typecheck`      | grün                       |
| Lint       | `npm run lint`           | grün                       |
| Unit-Tests | `npm test`               | 871/871 (53 Files)         |
| E2E        | `npm run test:e2e`       | 33/33                      |
| Coverage   | `npm test -- --coverage` | 94.6% Stmts / 84.6% Branch |
| Build      | `npm run build`          | grün, main ≈ 24.7 KB gzip  |

**Node-Version:** CI pinnt Node 24. Lokal **nicht** Node 26 verwenden — die
happy-dom-Umgebung stellt dort kein `localStorage` bereit, was 90 Unit-Tests
fälschlich rot macht (`Cannot read properties of undefined (reading 'clear')`).
`package.json` pinnt inzwischen `"engines": { "node": ">=24 <25" }` — CI fährt Node 24,
das Feld ist also nicht mehr offen.

## Engine-Stärke (gemessen 2026-10-20, depth 3, seed 12345)

**Kernzahl: die Engine ist so stark wie _ein_ Gegner, nicht stärker.** Gegen depth1
(n=20) ergibt jeder Lauf **35,0 % (W7/L13, −108 Elo)** — bei Routing 16/30 wie 24/45, bei
Budget 400 ms, 800 ms und Default, und in fünf Wiederholungen mit **Spread 0,0 pp**
(`bench/engine-strength-depth3-n20-depth1-repeats5.txt`,
`bench/engine-strength-routing-16-30-vs-24-45.txt`). Fairness-Niveau bei drei Fraktionen
ist 33 % → **kein Vorteil gegen depth1**.

| Gegner   | n=20, aktuelle Engine                       | Anmerkung                                        |
| -------- | ------------------------------------------- | ------------------------------------------------ |
| depth1   | 35,0 % / −108 [−268..52]                    | stabil, 5 Wiederholungen identisch               |
| random   | 59,0 % Mittel (Spread 52,5–65,0 %, 12,5 pp) | Einzelläufe 40–72,5 % → **nicht reproduzierbar** |
| material | 36,3 % / −98 [−210..14]                     | alter Stand (n=40), nicht neu gemessen           |

**Der Bench ist nicht reproduzierbar, solange die Zeit-Deadline greift.** Die Suche ist
wall-clock-budgetiert (`searchDeadline`), die erreichte Tiefe hängt also von der
Maschinenlast ab. Belege: identischer Befehl, gleicher Seed, gleicher Code lieferte gegen
random 40,0 % (Artefakt vom 20.10., 12:57, Leerlauf) _und_ 72,5 % (Lauf unter Last), sowie
mit `--budget=400`, n=10: 50 % / 50 % / 60 %; die 5-Lauf-Reihe mit dem neuen Budget streut
52,5–65,0 % (12,5 pp, `bench/engine-strength-depth3-n20-random-repeats5.txt`). Gegen depth1
ist das Ergebnis stabil
(kurze Partien) — deshalb ist 35,0 % die belastbare Zahl und **alle random-Zahlen in
diesem Dokument sind Rauschen**, inklusive der alten 62,5 % (n=40, v1.5.0), die sich mit
keiner Konfiguration bei n=20 wiederfindet. Einzelläufe sind keine Evidenz: der Bench hat
jetzt `--repeats=N` (Mittel + Spread + Warnung bei >5 pp) und `--budget=N`.

**Konsequenz (2026-10-20): Zug-Budget gesenkt.** Es lag bei 1500–5500 ms und wurde bis
4 s lang ausgenutzt (⌀ 1776 ms, max 4048 ms laut Trace vom 19.10.) — für den Spieler reine
Wartezeit, denn das Ergebnis ändert sich messbar nicht. Neue Skala 200–600 ms (+150
Königscheck, +150 bei <5 Zügen), `MAX_SEARCH_MS` 4000 → 1500. Nebeneffekt: Unit-Suite
15 s → 7,5 s, Benches wieder bezahlbar.

**Wichtig — Score-Semantik bei 3 Fraktionen:** Der Bench wertet „letzte überlebende
Fraktion gewinnt". Bei _drei_ Fraktionen ist das Fairness-Niveau **33 %**, nicht 50 %.
Ein Score von 58.3% gegen random heißt also: Engine 58.3%, jeder der beiden Gegner
~20.8% — klar überlegen. Ein Score von 33.3% gegen depth1 heißt: die Engine gewinnt
exakt so oft wie jeder einzelne Gegner — **kein Vorteil**.

### Warum Suchtiefe sich nicht auszahlt: Minimax lief nie (2026-10-19)

depth 3 gegen depth 1 ergibt 35.0% (n=40) bzw. 33.3% (n=12) — ohne signifikanten
Abstand zum Fairness-Niveau. Die Ursache ist **nicht** die Eval-Qualität, sondern die
Routing-Schwelle in `calculateBestMove` (`ai-core.ts`):

    if (pieceCount > 16 || usableActions.length > 30) -> greedyBestMove (1-Ply)

Bei 45 Startfiguren und 20–60 legalen Zügen je Fraktion greift das **immer**. Über
eine ganze Partie instrumentiert gemessen: **BOOK=0, GREEDY(1-Ply)=13, MINIMAX=0**.
Der komplette Suchstapel (Alpha-Beta, TT, SEE, LMR, Probcut, Pondering) war in echten
Partien toter Code — und der UI-Regler „KI-Tiefe" (1–4) wird nie gelesen.

Folge: Die Engine spielt faktisch 1-Ply-Greedy und verbraucht **2 ms** ihres
1500–4000-ms-Zeitbudgets. Partien enden nach 13 Plies (8/8 identisch); im Trace zieht
der water-König in Zug 10 aus dem Lager, um eine Queen zu schlagen — genau der Fehler,
den eine 2-Ply-Suche verbietet.

**Hebel getestet und geparkt** (2026-10-19): Schwelle auf `> 44 || > 100` angehoben.

| Metrik           | vorher           | nachher                            |
| ---------------- | ---------------- | ---------------------------------- |
| Pfad             | Greedy 13/13     | Greedy 4, Minimax 20               |
| Partielänge      | 13 Plies         | 24 Plies                           |
| Zugzeit          | 2 ms             | 1776 ms (max 4048 = MAX_SEARCH_MS) |
| Tests            | 46 s             | 139 s (859/859 grün)               |
| vs random (n=12) | 58.3% (7W/5L/0D) | 66.7% (7W/3L/2D)                   |
| vs depth1 (n=12) | 33.3% (4W/8L/0D) | 37.5% (2W/5L/5D)                   |

Bewertung: **flach → geparkt.** Kein signifikanter Gewinn (beide CIs überlappen 0);
bei depth1 sind die **Siege von 4 auf 2 gesunken**, der Score-Gewinn stammt allein
aus Remis (0 → 5, zählen als 0.5) — die Engine gewinnt nicht mehr, sie spielt
vorsichtiger. Verdacht: die Remis sind der Pendel-Fehlmodus von 2026-07-20, gegen den
`greedyBestMove` `REVERSAL_PENALTY`/`SEEN_POSITION_PENALTY` bekam — `minimax` hat
`kingmakerTerm` gar nicht (nur `evaluateBoard` an den Blättern).

Details: `bench/middlegame-search-2026-10-19.log`. Nächste Bausteine, falls je wieder
aufgegriffen: (1) `kingmakerTerm` + `captureReplyPenalty` in die minimax-*Blatt*bewertung
(nicht in die Pruning-Stellen futility/razoring/probcut, dort ist `evaluateBoard` eine
statische Schätzung), (2) Zeitbudget auf ~400 ms senken, sonst ist keine Messung mit
vertretbarem Aufwand möglich.

### Korrektur einer Fehldiagnose (2026-10-19)

Die README behauptete eine **Inversion** (Engine _schlechter_ vs random als vs depth1:
27.5% vs 48.8%). Das war der Stand **vor** dem Kingmaker-Fix. Der Kingmaker-Fix hob
vs random von 32.5% auf 62.5% — die Inversion ist damit **behoben**, die Reihenfolge
ist heute normal (besser gegen random als gegen depth1).

Die veralteten README-Zahlen haben zu einer Fehldiagnose geführt (Verdacht auf
Bewertungs-/Suchbug, also ein Korrektheitsproblem). Tatsächlich liegt ein
**Plateau** vor, kein Bug. Lehre: Engine-Aussagen nur gegen das Bench-Artefakt
prüfen, nie gegen Prosa — Doku driftet, Logs nicht.

## Engine-Hebel: ERSCHÖPFT (Session-Abschluss 2026-08-22)

Alle nach dem Kingmaker-Stand getesteten Hebel sind gemessen negativ/flach:

| Hebel                                 | Ergebnis                                                                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Maxⁿ / Maxⁿ-TT (d3, n40)              | flach (32.5%), ~20x langsamer — geparkt                                                                                                                               |
| MGD2 depth2-Minimax                   | vs random 22.5%/−215; vs depth1 31.3%/−137 — negativ                                                                                                                  |
| Tablebase-Coverage                    | ≤4-Stein-Zone wird in echten Partien NIE erreicht: erste Eliminierung bei 19–30 Steinen (20-Spiele-Inventur, seed 12345). Vorhandene TBs werden praktisch nie probed. |
| Post-Elim-Minimax                     | **10.0% / −382 vs random** (Kingmaker-Baseline 62.5%) — klar negativ; iterativeDeepening kollabiert bei großem Branching                                              |
| NNUE inkl. RPS-Features (Encoding v2) | Elo −26 (d2) / −17 (d3), CI überlappt 0 — geparkt                                                                                                                     |
| TD(λ)-Training                        | 0% Gradient in 3P-Selbstspiel (Spiele enden fast nie durch Eliminierung)                                                                                              |

Single-Game-Trace (`scripts/analyze-one-game.ts`, inkl. Bugfix: Engine-Zug
muss angewendet werden): Such-Qualität sauber — 37/38 Turns diff=0 → die
Engine wählt konsequent ihren besten Kandidaten. Der Engpass ist die
Eval-Qualität, und jede Methode, eine bessere zu LERNEN, scheitert an der
3P-Struktur (keine terminalen Labels, Kingmaker bricht 2P-Tricks).

## Infrastruktur-Notizen

- **Bundle-Gate-Historie** (`.github/workflows/ci-cd.yml`): 29000 → 31000 (#141,
  Statistik-Dashboard) → 33000 (Feedback-Kanal). Real heute: main.js **24.71 KB gzip**
  (Marge ~8 KB), nachdem puzzle.ts/replay.ts/analysis.ts in eigene Chunks gewandert sind.
  Das Gate läuft im
  `e2e-tests`-Job **vor** den E2E-Tests; ein zu niedriger Wert macht alle offenen PRs
  rot, ohne dass je ein Test lief. Bei Feature-Zuwächsen mitziehen.
- **`package.json`:** 145 transitive Pseudo-Dependencies entfernt (2026-10-19). Die
  App hat faktisch null Runtime-Dependencies (nur `fs`/`path`/`process` sowie
  `vite`/`vitest`/`@playwright/test` aus devDeps). `npm audit --omit=dev`: 4 → 0.
- **`tspn-viewer.html` ist kaputt** (42 KB): importiert `./js/*.js`, die es nicht gibt
  (nur `.ts`), ist kein Vite-Entry, wird nicht deployt. Reparieren oder löschen.
- **`engines`-Feld** ist gesetzt (`>=24 <25`) — siehe Node-Hinweis oben.
- **Modus-Chunks (2026-10-20):** `puzzle.ts`, `replay.ts` und `analysis.ts` liegen in
  eigenen Chunks — main.js 30.7 → **24.7 KB gzip** (Gate-Marge ~8 KB). Sie werden nach
  `initApp()` im Hintergrund vorgeladen (`prefetchLazyModes` in `js/main.ts`, Loader in
  `js/*-loader.ts`), weil ein Fetch **erst beim Klick** im Vite-Dev-Server unter Last
  sporadisch mit „Failed to fetch dynamically imported module“ scheitert: das
  Puzzle-Overlay blieb dann leer und zwei E2E-Tests liefen in den Timeout — nur in der
  vollen Suite, nie isoliert. Absicherung: Vorladung + `server.warmup` in
  `vite.config.ts` + Retry (`js/lazy-retry.ts`). Der Browser cacht einen
  fehlgeschlagenen Module-Fetch, ein Retry mit **identischem** Specifier greift deshalb
  nicht immer — die Vorladung ist die eigentliche Absicherung.
- **Code-Splitting weiter offen:** `js/rps-puzzle.ts` (10 KB) und `js/coach.ts` liegen
  noch statisch im main-Chunk (`rps-puzzle.ts` braucht `rpsCaptureTitleFromPieces` im
  heißen Render-Pfad, ein Split verlangt das Herausziehen dieses Helfers).
- **Flaky-Test entschärft (2026-10-20):** `tests/main.test.ts > triggerAutoMove delays if
game state is not SELECT_PIECE` lief in CI in den globalen 180-s-Timeout („Test timed
  out in 180000ms“, gemessen 322 s; der ganze unit-tests-Job 333 s statt 27 s). Erster
  Fix (Spiel vor dem Flush auf `game_over` parken) griff nicht, weil die Ursache woanders
  lag: happy-dom behält `localStorage` über Tests hinweg, und ein vorheriger Test
  speichert `autoBattle:true`. `applySettings()` startet dann ihre eigene Auto-Battle-
  Kette, deren Timer weit über das 1000-ms-Fenster von
  `vi.advanceTimersByTimeAsync(1000)` hinausreicht — die Flush-Promise settlet nie.
  Die Verzweigung ist zufällig (Reihenfolge/Microtasks), deshalb war der Test lokal
  „manchmal grün". Fix: `localStorage.clear()` vor dem Import, `vi.runAllTicks()` +
  `advanceTimersByTimeAsync(0)` damit `applySettings()` gelaufen ist, und
  `isAutoBattleActive()` (neu exportiert) als Assertion, die die Bedingung prüft statt
  nur zu hoffen. Verifiziert: 8/8 isolierte Läufe und 6/6 volle Suite (CI-Pool) stabil,
  Testzeit ~160 ms statt 360 s.

## Mess-Integrität

- Autoritative Artefakte: `bench/engine-strength-depth3-n20-depth1-repeats5.txt` (stabil),
  `bench/engine-strength-routing-16-30-vs-24-45.txt` (Routing-Vergleich);
  historisch/nur noch als Rauschen lesbar: `bench-current.log` (v1.5.0),
  `bench/cr-vs-*-n40.log`, `bench/km-vs-*-n40.log` sowie
  `bench/engine-strength-baseline-depth3-n20-random.txt` (40 %).
- **Regel 1:** Keine Engine-Stärke-Behauptung ohne Bench-Artefakt im Tree — und keine
  Aussage aus Prosa (README) ableiten, siehe Fehldiagnose oben.
- **Regel 2 (neu): Einzelläufe sind keine Evidenz.** Die Suche ist wall-clock-budgetiert,
  gleiche Flags liefern unterschiedliche Zahlen. Immer `--repeats=N` (≥3) fahren und
  Mittel + Spread berichten; Spread >5 pp heißt „Aussage unmöglich". Gegen `random` streut
  es stark (Partien bis 200 Plies), gegen `depth1` ist es stabil — für Engine-Aussagen
  daher `depth1` bevorzugen. Umgekehrt gilt: solange die Deadline greift, ist ein Lauf
  auch nicht als „gleich/ungleich" interpretierbar.
- `scripts/engine-strength.ts` ist nicht als npm-Script hinterlegt und läuft in keiner
  CI. Aufruf:
  `npx tsx scripts/engine-strength.ts --games=20 --depth=3 --opponent=depth1 --repeats=5`
  (optional `--budget=N`, `--seed=N`, `--max-plies=N`). Einzellauf-Format bleibt
  kompatibel zu den alten Artefakten.

## Cleanup-Historie (2026-08-22)

- Gelöschte Branches: 4 bereits gemergte (`feat/greedy-kingmaker`,
  `feat/middlegame-capture-reply`, `feat/middlegame-d2`,
  `fix/zobrist-rps-attack-main`) + 4 geparkte Negative
  (`feat/m1-paranoid-only`, `feat/maxn-true`, `feat/midgame-depth2`,
  `feat/middlegame-minimax-experiment` lokal+remote).
- `fix/zobrist-rps-attack` verworfen: enthielt einen zweiten, divergenten
  Zobrist-Fix (main hat `934e02f`) plus Maxn/MGD2-Experimente — alle tot.
- Bench-Logs ausgedünnt: nur Logs, die STATUS.md-Behauptungen stützen.
  Maxn-Zwischenvarianten (leafeval/commit/fixed-engside) entfernt.
- Verbleibende Experiment-Artefakte (Negativ-Belege): `bench/maxn-tt-fixed-vs-depth1-n10.log`,
  `bench/mgd2-vs-{random,depth1}-n40.log`, `bench/pe-minimax-vs-random-n10.log`.
- **NNUE radikal entfernt** (6eb6533): js/nnue.ts, Gewichte, UI-Toggle,
  9 Skripte, 4 Testdateien, CI nnue-gate-Job, npm-Scripts, Pläne —
  ~3500 Zeilen. Suche ruft jetzt direkt `evaluateBoard` auf.
  Elo-Helfer leben in `scripts/elo-common.ts` weiter.
- Repo-Bug gefixt: getrackter node_modules-Self-Symlink aus Index (5378f24).
- **Tablebase-System entfernt** (b44b0fd): 5 JSONs (~500KB), js/tablebase.ts,
  gen-tablebase.ts, Probe-Hook im minimax, init-Wiring. Grund: die ≤4-Stein-
  Probe-Zone wird in echten Partien nie erreicht (erste Eliminierung bei
  19–30 Steinen) — totes Bundle-Gewicht + irreführende "perfect play"-Doku.
- **pwa.ts abgedeckt** (2faf5db): 8 Unit-Tests für den bisher ungetesteten
  PWA-Bootstrap (SW-Registrierung, Update-Zyklus, Install-Prompt-Flow).
  pwa.ts jetzt bei 100% Line-Coverage.

## Einziger unversuchter Pfad

schach9x9-Style Datengen-NNUE (deterministische Selbstspiel-Positionen mit
Engine-Zielen statt TD-on-outcome) — großes Projekt, Ertrag unsicher.
Energie stattdessen in schach9x9 (M1.1 gemergt +230 Elo, NNUE-Datengen läuft).
