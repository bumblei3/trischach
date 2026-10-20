# bench/ — Engine-Messartefakte

Alles hier ist Messbeleg, keine Doku. Prosa fasst `../STATUS.md` zusammen.

## Aufruf

```bash
npx tsx scripts/engine-strength.ts --games=20 --depth=3 --opponent=depth1 --repeats=5
```

Flags: `--games=N`, `--depth=N`, `--opponent=random|depth1|material`, `--seed=N`
(default 12345), `--max-plies=N` (default 200), `--budget=N` (Zug-Budget in ms,
setzt `setAITimeLimit`), `--repeats=N`.

## Regel: Einzelläufe sind keine Evidenz

Die Suche ist **wall-clock-budgetiert** (`searchDeadline` in `js/ai-core.ts`). Der
erreichte Suchtiefe hängt damit von der Maschinenlast ab, und die Partieausgänge
hängen an der Suchtiefe. Belegte Fälle gleicher Flags/Seed/Code:

| Messung                          | Ergebnis                                            |
| -------------------------------- | --------------------------------------------------- |
| random, n=20, Default-Budget     | 40,0 % (Leerlauf) vs. 72,5 % (unter Last)           |
| random, n=10, `--budget=400`, 3x | 50,0 % / 50,0 % / 60,0 %                            |
| depth1, n=20, `--budget=400`, 5x | 35,0 % / 35,0 % / 35,0 % / 35,0 % / 35,0 % (0,0 pp) |

Also: `--repeats=N` (≥3) fahren, **Mittel + Spread** berichten. Spread >5 pp bedeutet,
dass die Aussage mit diesem Setup nicht möglich ist (das Skript warnt selbst). Gegen
`random` streut es stark (Partien bis 200 Plies), gegen `depth1` ist es stabil — für
Engine-Aussagen `depth1` verwenden.

## Score-Semantik bei drei Fraktionen

Der Bench wertet „letzte überlebende Fraktion gewinnt". Fairness-Niveau ist damit
**33 %**, nicht 50 %: 35 % gegen depth1 heißt „gewinnt so oft wie jeder einzelne
Gegner" = kein Vorteil.

## Aktuell belastbar

- `engine-strength-depth3-n20-depth1-repeats5.txt` — 35,0 % / −108 Elo, Spread 0,0 pp.
- `engine-strength-depth3-n20-depth1-budget400-repeats5.txt` — identisch 35,0 %.
- `engine-strength-routing-16-30-vs-24-45.txt` — Routing-Schwelle ändert nichts.

## Historisch, nur noch als Rauschen lesbar

- `bench-current.log` (v1.5.0, n=40, 62,5 % gegen random — reproduziert sich nicht)
- `engine-strength-baseline-depth3-n20-random.txt` (40,0 %, Einzellauf)
- `cr-vs-*-n40.log`, `km-vs-*-n40.log`, `mgd2-*`, `maxn-*`, `pe-*`, `zobrist-*`,
  `eval-experiment.log`, `middlegame-search-2026-10-19.log` — Einzelläufe früherer
  Sessions; als „geparkte Negative" weiterhin nützlich, aber nicht als Stärkebeweis.
