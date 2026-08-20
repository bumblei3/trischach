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
unverändert; `v1.5.0` ist CHANGELOG + Versionsbump.

v1.5.0-CI war rot **nur** wegen Prettier auf `CHANGELOG.md` / `STATUS.md`
(Release-Job + GitHub-Pages-Deploy übersprungen). Dieser Commit hebt den Block.

## Engine-Stärke (absolut, depth 3, 40 games, seed 12345)

Quelle: `bench-current.log` (HEAD @ `d232e70`, weiterhin gültig für `main` /
`v1.5.0`).

| Gegner   | Score | Elo                     |
| -------- | ----- | ----------------------- |
| random   | 26.3% | −179 [95% CI −301..−57] |
| material | 32.5% | −127 [95% CI −242..−12] |
| depth1   | 32.5% | −127 [95% CI −242..−12] |

Engine liegt nach Opp-Awareness (+36 vs random) und anti-pendulum (+26 vs
random) weiterhin unter 50% gegen jeden Gegner. Das strukturelle Loch ist das
1-Ply-Greedy im Mittellspiel (oberhalb von 16 Steinen).

## Mess-Integrität

- `bench-current.log` (HEAD @ `d232e70`): 26.3% vs random, 32.5% vs material,
  32.5% vs depth1 — Artefakt liegt im Tree.
- **Regel:** Keine Engine-Stärke-Behauptung ohne Bench-Artefakt im Tree.
  Kein Merge von Such-/Eval-Änderungen auf `main` ohne diesen Nachweis.

## Parkiertes Experiment (nicht auf main)

| Branch                               | Inhalt                                                                |
| ------------------------------------ | --------------------------------------------------------------------- |
| `feat/middlegame-minimax-experiment` | `evaluateBoard`-Refactor + `middlegameBestMove` (depth-2, >16 Steine) |

Gepusht, kein PR, **kein Bench-Artefakt**. Merge erst nach d3-Bench vs `main`
(40 Spiele, seed 12345).

## Remote-Branches

Stale gemergte PR-Zweige (anti-pendulum, security-escape, postcss-audit, …)
sind gelöscht. Verbleiben:

- `origin/main`
- `origin/feat/middlegame-minimax-experiment`

## Nächster sinnvoller Schritt (Selection)

1. **d3-Bench des Experiments vs main** (40 Spiele, seed 12345). Ohne Messung
   nicht mergen.
2. **d4-Benchmark vs random** (schnell, oracle-Antwort):
   `npx tsx scripts/engine-strength.ts 40 4 random --seed=12345`.
3. **Mittellspiel → echte Minimax statt 1-Ply-Greedy** (schwer, nur wenn 1
   Signal gibt und Timeout-Verhalten tragbar ist).
4. **VecDestBrute Tests aufräumen** oder ganz löschen.
5. **NNUE-Entscheidung**: aktivieren (mit aktualisierten Gewichten + Training)
   oder sauber entfernen.

## Roadmap-Hebel

- [x] Anti-pendulum progress term — gemessen, +26 Elo vs random, im Tree.
- [x] Opponent-Awareness term — gemessen, +36 Elo vs random, im Tree.
- [x] Root-Maxⁿ — gemessen, 0 Elo, **radikal entfernt** (nicht soft-disabled).
- [ ] Mittellspiel-Stärke — Experiment geparkt, ungemessen.
- [ ] NNUE — geparkt (Elo CI überlappt 0); Gewichte fehlen, Entscheidung offen.
