# trischach — Status (Stand: 2026-08-22)

Lokales `main` enthält Capture-Reply (`0169707`). Kingmaker liegt auf
`feat/greedy-kingmaker` (von diesem `main`). Remote `origin/main` ist noch
v1.5.0 (`97a8de0`).

## Gesundheit (2026-08-22)

| Gate      | Befehl             | Ergebnis                                     |
| --------- | ------------------ | -------------------------------------------- |
| Tests     | delta              | kingmaker + capture-reply + ai-features grün |
| Typecheck | `npx tsc --noEmit` | grün                                         |

## Engine-Stärke (absolut, depth 3, 40 games, seed 12345)

v1.5.0: `bench-current.log`. CR: `bench/cr-vs-*-n40.log`. Kingmaker:
`bench/km-vs-random-n40.log`, `bench/km-vs-material-n40.log`,
`bench/km-vs-depth1-n40.log`.

| Gegner   | v1.5.0     | + Capture-Reply | + Kingmaker                | Δ vs CR      |
| -------- | ---------- | --------------- | -------------------------- | ------------ |
| random   | 26.3%/−179 | 32.5%/−127      | **62.5% / +89 [−22..200]** | **+216 Elo** |
| material | 32.5%/−127 | 32.5%/−127      | **36.3% / −98 [−210..14]** | +29 Elo      |
| depth1   | 32.5%/−127 | 32.5%/−127      | **35.0% / −108 [−221..5]** | +19 Elo      |

Erstmals **>50 % vs random**. Das 32.5 %-Plateau (W13/L27) ist gebrochen.
CI vs random überlappt 0 leicht; W25 vs W12 (CR) / W8 (v1.5.0) ist der
gleiche Merge-Maßstab wie die letzten positiven Hebel, hier mit größerem
Punktschätzer. material/depth1 leicht plus, keine Regression.

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

## Capture-Reply (gemessen, auf lokalem `main`)

`0169707`. Ein Ply Capture-Reply in `greedyBestMove`: nach jedem Kandidaten
scannt `captureReplyPenalty` die Angriffe des **nächsten** Spielers
(RPS-Zyklus: der hat immer Vorteil gegen uns) und zieht den SEE-Wert der
wertvollsten hängenden eigenen Figur ab (Dame=900, Bauer=100). Nur Schläge,
`getValidMoves` ohne Check-Legalität.

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

## Kingmaker (gemessen, Merge-Kandidat)

`feat/greedy-kingmaker`. Nach `simulateMove` wendet Greedy dieselbe
Matt/Patt-Eliminierung an wie `handleCellClick` (`applyPostMoveEliminations`).
`kingmakerTerm`: 2v1 RPS-Nachteil −150000 (größer als ein gegnerischer König
in der Eval, ~100k), Vorteil +5000, Solo-Sieg +500000. Ohne diesen Scale
mated Greedy weiter Natur auf ply 1, weil die tote Königs-Materialgutschrift
die alte −4000-Strafe überdeckt.

Patt nur bei ≤5 Steinen der Fraktion — Eröffnung bleibt schnell.

## Nächster sinnvoller Schritt (Selection)

1. **Kingmaker + Capture-Reply auf `main` mergen** (dieser Branch + bereits
   gemergtes CR). Artefakte im Tree.
2. **Danach:** billiges depth-2 (Top-12, `pieceCount ≤ 28`) — Greedy sucht
   weiter nur 1 Ply + Capture-Reply + Mate-Sicht.
3. **NNUE** — parken, bis Mittelfeld tiefer sucht.
4. **VecDestBrute Tests** — aufräumen oder löschen.

## Roadmap-Hebel

- [x] Anti-pendulum progress term — gemessen, +26 Elo vs random, im Tree.
- [x] Opponent-Awareness term — gemessen, +36 Elo vs random, im Tree.
- [x] Root-Maxⁿ — gemessen, 0 Elo, **radikal entfernt** (nicht soft-disabled).
- [x] Eval-Refactor (RPS-mg / King-proximity / threat-oppAware) — gemessen,
      **−140 Elo vs random**, nicht mergen.
- [x] M1 Paranoid-Minimax — gemessen, **−49 Elo vs random**, nicht mergen.
- [x] Maxⁿ + TT — n=40 flach / zu langsam, Endspiel-only, geparkt.
- [x] **Capture-Reply (hängende Figur, 1 Ply, nächster Spieler)** — gemessen,
      **+52 Elo vs random** (26.3%→32.5%), auf lokalem `main`.
- [x] **Kingmaker (Matt-Eliminierung + 2v1-RPS in Greedy)** — gemessen,
      **62.5 % vs random (+89 Elo)**, material 36.3 %, depth1 35.0 %.
      Merge-Kandidat.
- [ ] Mittelfeld-Suche depth-2 (billig genug dass d2 fertig wird) — offen.
- [ ] NNUE — geparkt (Elo CI überlappt 0); erst nach tieferer Mittelfeld-Suche.
