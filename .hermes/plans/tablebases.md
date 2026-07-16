# Plan: Endgame Tablebases (Syzygy-Style, 3-Spieler) — trischach

## Status

- main = 9c3b331 (Analyse-Modus gemergt), sauber, keine offenen PRs.
- Zobrist-Hash (`computeZobristHash(game): bigint`) ist bereits vorhanden und in
  `minimax` verfügbar (ai-core.ts:519-561, genutzt ab :1719). → Position-Key als
  TB-Index ist gratis.
- Keine TB-Infra im Repo. Alles neu.

## Das harte Problem (ehrlich)

2-player Syzygy ist gelöst (retrograde Analyse, WDL/DTM). 3-player ist
grundlegend schwerer:

- RPS-Zyklen: F schlägt N, N schlägt W, W schlägt F → es gibt KEINE eindeutige
  "stärkere" Figur. Wer ein Endspiel "gewinnt", hängt von der RPS-Dynamik ab.
- "Eliminiert" = König geschlagen. Ein 3-player-Endspiel K vs K vs K ist oft
  Remis oder zufällig durch RPS-Angriffe entschieden, nicht durch Material.
- Retrograde Analyse braucht eine klare Terminal-Bedingung + eindeutige
  Gewinner-Bestimmung pro Endknoten. Bei 3-player ist "Wer gewinnt?" oft
  kontextabhängig (welche 2 Factionen bekämpfen sich gerade).

→ Realistischer Scope: **nicht** volle 3-player-Perfektion, sondern:
TB für Endspiele mit wenigen Steinen, WO die RPS-Dynamik entscheidbar ist
(z.B. eine Faction hat nur noch König, die anderen noch Material). Generierung
via retrograde Analyse mit vereinfachter Gewinner-Regel (letzte überlebende
Faction gewinnt; bei gleichzeitiger Elimination → Remis/Draw).

## Phasen

### Phase 1 — Foundation + kleinstes TB (dieser PR)

- `js/tablebase.ts`:
  - `TablebaseEntry { result: 'win'|'loss'|'draw'|'unknown'; dtz: number }`
  - `probeTablebase(hash: bigint): TablebaseEntry | null` (Map-Lookup).
  - `isTablebasePosition(game): boolean` (≤ N Steine, Endspiel erkannt).
- `scripts/gen-tablebase.ts`: retrograde Generator für das kleinste sinnvolle
  Endspiel (Start: K vs K vs K oder K+Figur vs K vs K), schreibt eine
  kompakte Map (hash → {r, dtz}) nach `public/js/tablebases/<type>.json`.
- Lookup-Hook in `minimax`/`calculateBestMove`: wenn `isTablebasePosition`
  und `probeTablebase` Treffer → perfekte Eval (statt Suche/tiefer Eval).
- Tests: Generator produziert konsistente TB; Lookup liefert korrekte Ergebnisse
  für bekannte Endspiele; Engine nutzt TB (eval == TB-Wert an TB-Position).

### Phase 2 — Mehr Coverage

- Weitere Endspiel-Typen (3–4 Steine: K+R vs K, K+Q vs K, etc.).
- Storage-Optimierung: WDL/DTZ-kodiert statt voller Maps (wie Syzygy).
- Mehr Steine (bis 4) wenn Phase 1 stabil.

### Phase 3 — UI/Polish

- Anzeige "Tablebase: Matt in N" / perfekte Endspiel-Eval im Analyse-Panel.
- Benchmark: Engine mit TB vs ohne in Endspielen.

## Risiken

- 3-player-Gewinner-Regel ist eine Vereinfachung → TB ist "gut, nicht perfekt".
  Das ist OK (Roadmap sagt "3–4 Steine zuerst", nicht "vollständig").
- Generator-Laufzeit: retrograde Analyse über alle Positionen eines Endspiels
  kann bei 4 Steinen groß werden → in Phasen, kleine Endspiele zuerst.
- Nicht mit NNUE-Konflikt: TB-Lookup passiert VOR NNUE/handcrafted-Eval, also
  unabhängig.

## Verify-Gates (jeder PR)

- `tsc --noEmit` 0 errors
- `eslint .` clean (CI: `npm run lint` = eslint . + prettier --check)
- `prettier --check .` (sonst lint-CI fail!)
- `vitest run` alle grün (747+)
- `npm run build` grün
- e2e (Playwright) grün — ACHTUNG: Bundle-Size-Guard! main.js ist 25329B
  gzip, Threshold ist 27000 (in ci-cd.yml erhöht). Neuer Code darf main.js
  nicht über 27000B gzip treiben — sonst e2e-job failt.
- PR zu main (branch-protected, squash+delete).
