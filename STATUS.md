# trischach — Status (Stand: 2026-10-20, HEAD 4d27466)

`main` (4d27466) enthält Capture-Reply + Kingmaker + Zobrist/State-Fix + Tagespuzzle,
dazu **unreleased seit Tag `v1.6.0`** (2026-08-24, 16 Commits): Solo-Modus gegen die KI,
Code-Splitting (`game.ts` eigener Chunk), 145 transitive Pseudo-Dependencies entfernt,
`evaluateLeaf` an den Minimax-_Leafs_, Bench-Artefakt. `package.json` steht noch auf
`1.6.0` → Release `v1.7.0` ist fällig.

- Statistik-Dashboard + Feedback-Kanal. Engine-Arbeit ist **abgeschlossen geparkt** —
  alle verbleibenden Hebel gemessen negativ/flach (Details unten).

## Gesundheit

Alle Gates grün (Node 24, CI-Version):

| Gate       | Befehl                   | Ergebnis                   |
| ---------- | ------------------------ | -------------------------- |
| Typecheck  | `npm run typecheck`      | grün                       |
| Lint       | `npm run lint`           | grün                       |
| Unit-Tests | `npm test`               | 868/868 (52 Files)         |
| E2E        | `npm run test:e2e`       | 33/33                      |
| Coverage   | `npm test -- --coverage` | 94.8% Stmts / 84.8% Branch |
| Build      | `npm run build`          | grün, main ≈ 30.7 KB gzip  |

**Node-Version:** CI pinnt Node 24. Lokal **nicht** Node 26 verwenden — die
happy-dom-Umgebung stellt dort kein `localStorage` bereit, was 90 Unit-Tests
fälschlich rot macht (`Cannot read properties of undefined (reading 'clear')`).
`package.json` pinnt inzwischen `"engines": { "node": ">=24 <25" }` — CI fährt Node 24,
das Feld ist also nicht mehr offen.

## Engine-Stärke (absolut, depth 3, seed 12345)

Quelle: `bench-current.log` (n=40) und Nachmessung 2026-10-19 (n=12).

| Gegner   | n=40 (Artefakt)        | n=12 (Nachmessung)      |
| -------- | ---------------------- | ----------------------- |
| random   | 62.5% / +89 [−22..200] | 58.3% / +58 [−141..257] |
| material | 36.3% / −98 [−210..14] | —                       |
| depth1   | 35.0% / −108 [−221..5] | 33.3% / −120 [−329..89] |

**Neuestes Artefakt im Tree** (`bench/engine-strength-baseline-depth3-n20-random.txt`,
Commit 4d27466): depth 3 vs random, n=20, seed 12345 → **40.0% / −70 [−225..85]** (W8/L12).
Das liegt unter der 62.5%-Baseline (n=40) und unter der Skill-Notiz von 57.5% (n=20).
Die 95-%-CIs überlappen 0, es ist also **kein** bewiesener Rückschritt — aber der Vorteil
gegen random reproduziert sich im aktuellen Stand nicht. Der n=20-Lauf ist der einzige
Messpunkt nach den `evaluateLeaf`-Leafs; ein frischer n=40-Lauf gegen dasselbe Artefakt
ist die offene Nachmessung.

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
  Statistik-Dashboard) → 33000 (Feedback-Kanal; real heute 30.70 KB gzip, Marge ~2.3 KB).
  Das Gate läuft im
  `e2e-tests`-Job **vor** den E2E-Tests; ein zu niedriger Wert macht alle offenen PRs
  rot, ohne dass je ein Test lief. Bei Feature-Zuwächsen mitziehen.
- **`package.json`:** 145 transitive Pseudo-Dependencies entfernt (2026-10-19). Die
  App hat faktisch null Runtime-Dependencies (nur `fs`/`path`/`process` sowie
  `vite`/`vitest`/`@playwright/test` aus devDeps). `npm audit --omit=dev`: 4 → 0.
- **`tspn-viewer.html` ist kaputt** (42 KB): importiert `./js/*.js`, die es nicht gibt
  (nur `.ts`), ist kein Vite-Entry, wird nicht deployt. Reparieren oder löschen.
- **`engines`-Feld** ist gesetzt (`>=24 <25`) — siehe Node-Hinweis oben.
- **Code-Splitting offen:** `js/puzzle.ts` (~30 KB raw) und `js/replay.ts` (~30 KB raw)
  liegen statisch im Initial-Bundle; `js/game.ts` + `js/opening-book.ts` werden doppelt
  gebundelt (statisch + dynamisch, siehe INEFFECTIVE_DYNAMIC_IMPORT im Build).

## Mess-Integrität

- Autoritative Artefakte: `bench-current.log` (v1.5.0), `bench/cr-vs-*-n40.log`,
  `bench/km-vs-*-n40.log`.
- **Regel:** Keine Engine-Stärke-Behauptung ohne Bench-Artefakt im Tree — und keine
  Aussage aus Prosa (README) ableiten, siehe Fehldiagnose oben.
- `scripts/engine-strength.ts` ist nicht als npm-Script hinterlegt und läuft in keiner
  CI. Aufruf: `npx tsx scripts/engine-strength.ts --games=40 --depth=3 --opponent=random`

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
