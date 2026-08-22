# trischach — Status (Stand: 2026-08-22)

Laufender Zustand des Repos `bumblei3/trischach`. `main` / tag `v1.5.0` ist
die Release-Baseline. Capture-Reply liegt auf `feat/middlegame-capture-reply`
(von `main`, ohne Eval-Mix / Paranoid / Maxⁿ).

## Gesundheit (2026-08-22, dieser Branch)

| Gate      | Befehl                   | Ergebnis                         |
| --------- | ------------------------ | -------------------------------- |
| Tests     | `npx vitest run` (delta) | capture-reply + ai-features grün |
| Typecheck | `npx tsc --noEmit`       | grün (exit 0)                    |

`main` (v1.5.0): 795/795, lint/prettier/build/audit grün. CI auf `main` grün.

## Engine-Stärke (absolut, depth 3, 40 games, seed 12345)

`main` Quelle: `bench-current.log` (HEAD @ `d232e70`). Capture-Reply Quellen:
`bench/cr-vs-random-n40.log`, `bench/cr-vs-material-n40.log`,
`bench/cr-vs-depth1-n40.log`.

| Gegner   | `main`                   | Capture-Reply                | Δ vs main            |
| -------- | ------------------------ | ---------------------------- | -------------------- |
| random   | 26.3% / −179 [−301..−57] | **32.5% / −127 [−242..−12]** | **+52 Elo** (W8→W12) |
| material | 32.5% / −127             | 32.5% / −127                 | 0                    |
| depth1   | 32.5% / −127             | 32.5% / −127                 | 0                    |

Die Random-Inversion (schlechter als vs depth1) ist **geschlossen** — alle
drei Gegner stehen jetzt bei 32.5%. 95%-CIs vs `main` überlappen; der
Punktschätzer landet exakt auf dem hypothetisierten Gegner (random nimmt
hängende Figuren). material/depth1 flach = keine Regression. Merge-Kandidat
nach demselben Standard wie Anti-Pendulum (+26) und Opp-Awareness (+36).

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

## Capture-Reply (gemessen, Merge-Kandidat)

Branch `feat/middlegame-capture-reply`. Ein Ply Capture-Reply in
`greedyBestMove`: nach jedem Kandidaten scannt `captureReplyPenalty` die
Angriffe des **nächsten** Spielers (RPS-Zyklus: der hat immer Vorteil gegen
uns) und zieht den SEE-Wert der wertvollsten hängenden eigenen Figur ab
(Dame=900, Bauer=100). Nur Schläge, `getValidMoves` ohne Check-Legalität.

Nicht mitgenommen: Eval-Refactor, Paranoid, Maxⁿ, volles depth-2. Die 3P-Suche
(Maxⁿ/Paranoid) lief bisher nur im Endspiel (`pieceCount ≤ 16`) und hat das
Greedy-Loch nie berührt.

Nebeneffekt: Greedy hängt die Dame auf ply 1 nicht mehr und kann Natur über
die Matt/Patt-Eliminierung nach `handleCellClick` aus dem Spiel nehmen.
`tests/ai-features.test.ts` prüft die drei Fraktionen deshalb isoliert.

## Parkiertes Experiment (nicht auf main)

| Branch                               | Stand                                     |
| ------------------------------------ | ----------------------------------------- |
| `feat/middlegame-minimax-experiment` | Eval = Regression; Minimax tot + falsch   |
| `feat/m1-paranoid-only`              | −49 Elo vs random, nicht mergen           |
| `feat/maxn-true`                     | n=40 flach, ~20× langsamer; Endspiel only |
| `feat/midgame-depth2`                | Code da, Timeout→d1 in der Eröffnung      |
| `feat/middlegame-d2`                 | Env-Flag, Protokollbruch (`--depth=2`)    |

## Remote-Branches

- `origin/main`
- `origin/feat/middlegame-minimax-experiment` (parked, negative eval result)

## Nächster sinnvoller Schritt (Selection)

1. **Capture-Reply mergen** (dieser Branch), wenn der Punktschätzer +52 vs
   random bei flachem material/depth1 reicht — gleicher Standard wie die
   letzten zwei positiven Hebel. CIs überlappen; Artefakte liegen im Tree.
2. **Danach:** entweder Root-Cap depth-2 (Top-12 nach Greedy, erst ab
   `pieceCount ≤ 28`) **oder** Capture-Reply auf beide Gegner / SEE-Recapture.
   Nicht nochmal volles Maxⁿ ohne Mittelfeld-Routing.
3. **NNUE** — weiter parken, bis Mittelfeld mehr als 1 Ply + Capture-Reply
   sucht.
4. **VecDestBrute Tests** — aufräumen oder löschen (kein Stärke-Hebel).

## Roadmap-Hebel

- [x] Anti-pendulum progress term — gemessen, +26 Elo vs random, im Tree.
- [x] Opponent-Awareness term — gemessen, +36 Elo vs random, im Tree.
- [x] Root-Maxⁿ — gemessen, 0 Elo, **radikal entfernt** (nicht soft-disabled).
- [x] Eval-Refactor (RPS-mg / King-proximity / threat-oppAware) — gemessen,
      **−140 Elo vs random**, nicht mergen.
- [x] M1 Paranoid-Minimax — gemessen, **−49 Elo vs random**, nicht mergen.
- [x] Maxⁿ + TT — n=40 flach / zu langsam, Endspiel-only, geparkt.
- [x] **Capture-Reply (hängende Figur, 1 Ply, nächster Spieler)** — gemessen,
      **+52 Elo vs random** (26.3%→32.5%), material/depth1 flach. Merge-Kandidat.
- [ ] Mittelfeld-Suche depth-2 (billig genug dass d2 fertig wird) — offen.
- [ ] NNUE — geparkt (Elo CI überlappt 0); erst nach tieferer Mittelfeld-Suche.
