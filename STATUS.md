# trischach — Status (Stand: 2026-08-20)

Laufender Zustand des Repos `bumblei3/trischach` (branch `main`, tag `v1.5.0`).
Gehalten von Hermes; bei jeder "wie weiter verbessern"-Run neu verifiziert.

## Gesundheit (2026-08-20)

| Gate      | Befehl                   | Ergebnis                  |
| --------- | ------------------------ | ------------------------- |
| Tests     | `npx vitest run`         | 795/795 passed (47 files) |
| Typecheck | `npx tsc --noEmit`       | grün (exit 0)             |
| Lint      | `npx eslint .`           | grün (exit 0)             |
| Prettier  | `npx prettier --check .` | grün                      |
| Build     | `vite build`             | `dist/` vorhanden/ok      |
| npm audit | `npm audit --json`       | 0 vulns                   |

Working Tree: sauber auf `main`. Engine-Code seit Bench-Artefakt (`d232e70`)
unverändert. CI auf `main` grün inkl. Pages-Deploy
(`7f07349`, Prettier-Unblock).

## Engine-Stärke (absolut, depth 3, 40 games, seed 12345)

Quelle: `bench-current.log` (HEAD @ `d232e70`, gültig für `main` / `v1.5.0`).

| Gegner   | Score | Elo                     |
| -------- | ----- | ----------------------- |
| random   | 26.3% | −179 [95% CI −301..−57] |
| material | 32.5% | −127 [95% CI −242..−12] |
| depth1   | 32.5% | −127 [95% CI −242..−12] |

Engine liegt nach Opp-Awareness (+36 vs random) und anti-pendulum (+26 vs
random) weiterhin unter 50% gegen jeden Gegner. Das strukturelle Loch ist das
1-Ply-Greedy im Mittellspiel (`pieceCount > 16`; Startposition hat 45 Steine).
Iteratives Vertiefen läuft erst im Endspiel — Tiefe auf `main` anheben (d4)
testet deshalb nicht das Kingmaker-Loch.

## Mess-Integrität

- `bench-current.log` (HEAD @ `d232e70`): 26.3% vs random, 32.5% vs material,
  32.5% vs depth1 — Artefakt liegt im Tree.
- **Regel:** Keine Engine-Stärke-Behauptung ohne Bench-Artefakt im Tree.
  Kein Merge von Such-/Eval-Änderungen auf `main` ohne diesen Nachweis.

## Eval-Experiment (gemessen, Regression — nicht mergen)

Branch `feat/middlegame-minimax-experiment` @ `7ec81ef`. Zwei unabhängige
Änderungen, nur eine wirkt in `calculateBestMove`:

1. **Eval-Refactor (lebt):** RPS-Term auf alle überlebenden Gegner (nicht nur
   Endspiel), König-Bedrohung mit Nähe/Koordination, threat-aware Opp-Awareness
   (König-Angriff +150 auf Gegner-Threat). Routing bleibt `greedyBestMove`.
2. **`middlegameBestMove` (tot):** nirgends aus `calculateBestMove` aufgerufen.
   Die Funktion selbst ist kein depth-2 (zwei `minimax(..., 1)` auf derselben
   Child-Stellung). Ein Bench dieses Branches ist ein **Eval-A/B**, kein
   Such-A/B.

Quelle: `bench/eval-experiment.log` (d3, 40 Spiele, seed 12345, Experiment vs
dieselbe Harness wie `bench-current.log`).

| Gegner   | `main` | Experiment | Δ Elo vs main        |
| -------- | ------ | ---------- | -------------------- |
| random   | 26.3%  | **13.8%**  | **−140** (−179→−319) |
| material | 32.5%  | 32.5%      | 0                    |
| depth1   | 32.5%  | 32.5%      | 0                    |

vs random: W8/L27/D5 → W4/L33/D3. 95%-CIs überlappen leicht
(`main` −301..−57, Experiment −475..−163); der Punktschätzer fällt genau auf
dem Kingmaker-Gegner, material/depth1 flach. **Nicht mergen.** Diese
Eval-Terme nicht nochmal versuchen.

## Parkiertes Experiment (nicht auf main)

| Branch                               | Stand                                   |
| ------------------------------------ | --------------------------------------- |
| `feat/middlegame-minimax-experiment` | Eval = Regression; Minimax tot + falsch |

Kein PR. Branch darf stehen bleiben als Warnung, nicht als Merge-Kandidat.
Echte Mittelfeld-Suche auf einem **neuen** Branch von `main`, ohne diese
Eval-Terme und ohne die kaputte `middlegameBestMove`.

## Remote-Branches

- `origin/main`
- `origin/feat/middlegame-minimax-experiment` (parked, negative eval result)

## Nächster sinnvoller Schritt (Selection)

1. **Mittelfeld-Suche sauber von `main`:** ein `minimax(depth=2)` (oder 1 Ply
   Gegner + Eval) statt 1-Ply-Greedy bei `pieceCount > 16`, Reversal-Penalty
   behalten, Timeout → greedy. Dann d3-Bench vs `main` (40, seed 12345).
   Eval-Terme aus dem Experiment **nicht** mitnehmen.
2. **d4 vs random auf `main`** nur als Endspiel-Oracle — bewegt das
   Kingmaker-Loch nicht, weil die Eröffnung weiter greedy ist.
3. **NNUE** — parken, bis das Mittelfeld überhaupt sucht.
4. **VecDestBrute Tests** — aufräumen oder löschen (kein Stärke-Hebel).

## Roadmap-Hebel

- [x] Anti-pendulum progress term — gemessen, +26 Elo vs random, im Tree.
- [x] Opponent-Awareness term — gemessen, +36 Elo vs random, im Tree.
- [x] Root-Maxⁿ — gemessen, 0 Elo, **radikal entfernt** (nicht soft-disabled).
- [x] Eval-Refactor (RPS-mg / King-proximity / threat-oppAware) — gemessen,
      **−140 Elo vs random**, nicht mergen.
- [ ] Mittellspiel-Suche (echtes depth-2, von `main`, ohne Eval-Mix) — offen.
- [ ] NNUE — geparkt (Elo CI überlappt 0); erst nach Mittelfeld-Suche.
