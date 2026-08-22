# trischach — Status (Stand: 2026-08-22, Cleanup-Phase)

Lokales `main` (5638e70) enthält Capture-Reply (`0169707`) + Kingmaker
(`a735fa8`) + Zobrist/State-Fix (`934e02f`). Engine-Arbeit ist
**abgeschlossen geparkt** — alle verbleibenden Hebel gemessen negativ/flach.

## Gesundheit

| Gate      | Befehl             | Ergebnis |
| --------- | ------------------ | -------- |
| Typecheck | `npx tsc --noEmit` | grün     |

## Engine-Stärke (absolut, depth 3, 40 games, seed 12345)

Quelle: `bench/km-vs-{random,material,depth1}-n40.log` (Kingmaker-Stand).

| Gegner   | v1.5.0     | + Capture-Reply | + Kingmaker                |
| -------- | ---------- | --------------- | -------------------------- |
| random   | 26.3%/−179 | 32.5%/−127      | **62.5% / +89 [−22..200]** |
| material | 32.5%/−127 | 32.5%/−127      | **36.3% / −98 [−210..14]** |
| depth1   | 32.5%/−127 | 32.5%/−127      | **35.0% / −108 [−221..5]** |

Erstmals >50% vs random; das 32.5%-Plateau ist gebrochen.

## Session-Abschluss 2026-08-22: klassische Engine-Hebel ERSCHÖPFT

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

## Mess-Integrität

- Autoritative Artefakte: `bench-current.log` (v1.5.0), `bench/cr-vs-*-n40.log`,
  `bench/km-vs-*-n40.log`.
- **Regel:** Keine Engine-Stärke-Behauptung ohne Bench-Artefakt im Tree.

## Cleanup (2026-08-22)

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

## Einziger unversuchter Pfad

schach9x9-Style Datengen-NNUE (deterministische Selbstspiel-Positionen mit
Engine-Zielen statt TD-on-outcome) — großes Projekt, Ertrag unsicher.
Energie stattdessen in schach9x9 (M1.1 gemergt +230 Elo, NNUE-Datengen läuft).
