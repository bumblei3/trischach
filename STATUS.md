# trischach — Status (Stand: 2026-08-02)

Laufender Zustand des Repos `bumblei3/trischach` (branch `main`, synced mit origin).
Gehalten von Hermes; bei jeder "wie weiter verbessern"-Run neu verifiziert.

## Gesundheit (frisch verifiziert 2026-08-02)

| Gate      | Befehl             | Ergebnis                  |
| --------- | ------------------ | ------------------------- |
| Tests     | `npx vitest run`   | 795/795 passed (47 files) |
| Typecheck | `npx tsc --noEmit` | grün (exit 0)             |
| Lint      | `npx eslint .`     | grün (exit 0)             |
| Build     | `vite build`       | `dist/` vorhanden/ok      |

Working Tree: sauber bis auf 4 untracked Artefakte —
`bench-before.sh/.log`, `bench-after.sh/.log` (nur Mess-Skripte/Logs, kein Source).

## Engine-Stärke (absolut, depth 3, 40 games, seed 12345)

| Gegner   | BEFORE (Lever B + anti-pendulum) | AFTER (+ Opponent-Awareness) | Δ Elo   |
| -------- | -------------------------------- | ---------------------------- | ------- |
| random   | 22.5% (−215)                     | **26.3% (−179)**             | **+36** |
| material | 32.5% (−127)                     | 32.5% (−127)                 | 0       |
| depth1   | 32.5% (−127)                     | 32.5% (−127)                 | 0       |

→ Gewinn sitzt exakt dort, wo der Kingmaker-Effekt wirkt (gegen den
unvorhersehbaren random-Mover). Gegen material/depth1 keine Regression.
Noch immer < 50% gegen jeden Gegner — Teilschritt, kein Durchbruch.

## Mess-Integrität (verifiziert 2026-08-02)

- CHANGELOG `[Unreleased]` behauptet für _anti-pendulum_ (auf Lever B):
  vs random 20.0% → **22.5%** (Elo −241 → −215, +26).
- `bench-after.sh` frisch auf HEAD (commit 7661fe8, nach anti-pendulum-Merge)
  gestartet → liefert **22.5%** vs random (W7/D4, Elo −215). Die CHANGELOG-Zahl
  ist damit **belegt**.
- Hinweis: das im Tree liegende _alte_ `bench-after.log` (20.0%) war veraltet —
  es stammte aus dem Lever-B-Run _vor_ dem anti-pendulum-Merge. Der frische Run
  überschreibt es und bestätigt die neue Zahl.
- `bench-before.log` (Lever B, 20.0% vs random) bleibt als echter BEFORE-Baseline.
- **Regel:** Keine Engine-Stärke-Behauptung ohne Bench-Artefakt im Tree.

## Offene Follow-ups (aus CHANGELOG `[Unreleased]`)

1. **Baseline-Regression ungeklärt.** Aktuelle Zahlen (15/32.5/32.5) liegen
   unter einer früher notierten Baseline (27.5/37.5/48.8%). Re-Establish der
   Baseline gegen einen known-good Commit nötig, bevor Deltas "ehrlich" sind.
2. **Strukturelle 3P-Search-Perspektive** bleibt der große offene Hebel:
   ~60+ Elo vs random nötig, um 50% zu erreichen. Anti-pendulum/Lever B sind
   nur palliative Einzelhebel am symptomatischen Verhalten.
3. **KBN-vs-K Tablebase** geparkt (3-Attacker-Branching explodiert).
4. **NNUE-Elo-Studie** geparkt (depth 3 Elo −17, CI überlappt 0 → kein
   nachweisbarer Gewinn).

## Nächster sinnvoller Schritt

anti-pendulum ist verifiziert (+2.5% vs random, Elo +26). Offen bleibt die
**Baseline-Regression**: aktuelle Zahlen (22.5/32.5/32.5) liegen noch immer unter
einer früher notierten Baseline (27.5/37.5/48.8%) — die muss gegen einen
known-good Commit re-established werden, bevor Deltas "ehrlich" sind. Danach den
**strukturellen 3P-Search** angehen (~60+ Elo vs random bis 50%), nicht weiter an
Einzel-Symptom-Hebeln schrauben.
