# trischach — Status (Stand: 2026-08-20)

Laufender Zustand des Repos `bumblei3/trischach` (branch `main`, synced mit origin).
Gehalten von Hermes; bei jeder "wie weiter verbessern"-Run neu verifiziert.

## Gesundheit (frisch verifiziert 2026-08-20)

| Gate      | Befehl             | Ergebnis                  |
| --------- | ------------------ | ------------------------- |
| Tests     | `npx vitest run`   | 795/795 passed (47 files) |
| Typecheck | `npx tsc --noEmit` | grün (exit 0)             |
| Lint      | `npx eslint .`     | grün (exit 0)             |
| Build     | `vite build`       | `dist/` vorhanden/ok      |
| npm audit | `npm audit --json` | 0 vulns                   |

Working Tree: sauber, `bench-current.log` ist als Mess-Artefakt im Tree.
Alle CI-Gates grün; kein ausstehendes PR oder offener lokaler Branch mit
nicht auf main eingepflegtem Inhalt.

## Engine-Stärke (absolut, depth 3, 40 games, seed 12345, Stand HEAD @ d232e70)

| Gegner   | Score  | Elo             |
| -------- | ------ | --------------- |
| random   | 26.3%  | −179 [95% CI −301..−57] |
| material | 32.5%  | −127 [95% CI −242..−12] |
| depth1   | 32.5%  | −127 [95% CI −242..−12] |

Engine liegt nach Opp-Awareness (+36 vs random) und anti-pendulum (+6 vs random,
gemessen davor) weiterhin unter 50% gegen jeden Gegner. Das strukturelle Loch ist
das 1-Ply-Greedy im Mittellspiel (oberhalb von 24 Steinen).

## Mess-Integrität (verifiziert 2026-08-20)

- `bench-current.log` (HEAD @ d232e70): 26.3% vs random, 32.5% vs material,
  32.5% vs depth1 — Artefakt liegt im Tree und ist Commit `bench-current`-Signal.
- **Regel:** Keine Engine-Stärke-Behauptung ohne Bench-Artefakt im Tree.

## Offene lokale Branches (nicht gepusht, Überreste vorheriger Entwicklungszüge)

| Branch                        | Commits (letzter)            | Inhalt (Zusammenfassung)                          |
| ----------------------------- | ---------------------------- | ------------------------------------------------- |
| feat/middlegame-eval-route   | 323e777 style (CHANGELOG)   | Opp-Awareness-Term raus aus evaluateBoard, deps   |
| fix/3p-maxn                  | 51a0f00 security (XSS+CSP)  | Sicherheitsfix + deps + anti-pendulum raus        |

Beide Branches enthalten Inhalte, die **bereits auf main** sind (Opp-Awareness,
Sicherheitsfix #130, anti-pendulum #118) — sie sind Überreste aus vorherigen
Entwicklungszügen. Werden in separaten Commits gelöscht, bevor sie den Push
verunreinigen.

## Offene remote-branches (origin/)

Entire remote branches sind gemergte PR-Zweige (fix/postcss-audit-cleanup,
fix/security-escape-difficulty, feat/anti-pendulum-progress, etc.). Die können
gerne lokal gelöscht werden (`git branch -r -d origin/<name>`), sind aber kein
Blocker.

## Nächster sinnvoller Schritt (Selection)

Engine-Stärke-Kandidaten, sortiert nach Signal/Effort:

1. **d4-Benchmark vs random** (schnell, oracle-Antwort): `npx tsx scripts/engine-strength.ts 40 4 random --seed=12345`. Zeigt, ob Tiefe allein das Kingmaker-Problem bewegt.
2. **evaluateBoard refactor + gezielte Term-Änderungen** (medium): Aktivität/Königssicherheit über alle Fraktionen, dann d3-Bench vs alte Version.
3. **Mittellspiel → echte Minimax statt 1-Ply-Greedy** (schwer, erst nach Signal aus 1 oder 2).
4. **VecDestBrute Tests aufräumen** oder ganz löschen.
5. **NNUE-Entscheidung**: aktivieren (mit aktualisierten Gewichten + Training) oder sauber entfernen.

## Roadmap-Hebel (aus CHANGELOG [Unreleased] + STATUS)

- [x] Anti-pendulum progress term — gemessen, +6 Elo vs random, im Tree.
- [x] Opponent-Awareness term — gemessen, +36 Elo vs random, im Tree.
- [x] Root-Maxⁿ — gemessen, 0 Elo, **radikal entfernt** (nicht soft-disabled).
- [ ] Mittellspiel-Stärke (d4 / Minimax / Eval-Term-Struktur) — offen, dokumentiert.
- [ ] NNUE — geparkt (Elo CI überlappt 0); Gewichte fehlen, Entscheidung offen.
