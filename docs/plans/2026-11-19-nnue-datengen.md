# Datengeneriertes NNUE (Distillation) — Implementierungsplan

> **Für Hermes:** Schrittweise umsetzen, jeder Schritt mit Beleg (Bench-Artefakt)
> absichern. Kein Commit ohne Messung.

**Ziel:** Die Engine-Stärke zu heben, obwohl Suchtiefe und Suchmodell erschöpft
sind. Der Engpass ist die Bewertungsfunktion. Statt sie von Hand zu feinjustieren
(alle Hebel negativ gemessen, `STATUS.md` „Engine-Hebel: ERSCHÖPFT") soll sie aus
Daten gelernt werden.

**Warum nicht TD-on-outcome:** Das frühere NNUE (Encoding v2, 660→128→32→1,
Elo −26/−17) wurde mit TD-Lernzielen trainiert. `STATUS.md` „TD(λ)-Training:
**0 % Gradient** in 3P-Selbstspiel — die Spiele enden fast nie durch Eliminierung."
In Drei-Fraktionen-Partien gibt es selten ein terminales Ergebnis-Label; wer
gewinnt, hängt von der RPS-Situation ab, die TD nicht sauber belohnt.

**Neuer Ansatz — Distillation:** Die Ziele sind keine Outcome-Labels, sondern die
Bewertung der vorhandenen Engine (`evaluateLeaf` aus Sicht der ziehenden Fraktion)
auf zufälligen Stellungen. Das vermeidet das Label-Problem: Die Engine liefert für
_jede_ Stellung sofort ein Ziel, und das Modell lernt, diese Bewertung schnell und
evtl. generalisierend nachzubilden. Der Ertrag ist dann entweder eine billigere
Eval (mehr Tiefe im Zeitbudget) oder eine bessere (wenn die Engine systematische
Fehler macht, die ein glattes Modell korrigiert).

---

## Phase 1 — Daten

**Woher:** `scripts/gen-nnue-data.ts` erzeugt Stellungen aus Auto-Battle-Selbstspielen
(Engine vs. Engine, unterschiedliche Persönlichkeiten), nicht aus Eröffnungsbüchern.

**Format:** eine Zeile pro Stellung, JSONL:
`{"f":0,"pieces":[[pieceId,hex,alive],...],"elim":[1],"target":-123.45}`

- `f` = Fraktion, aus deren Sicht bewertet wird (0/1/2) — das Modell bekommt die
  Fraktionsperspektive als Eingabe, nicht als getrennten Kopf (die Engine ist
  perspektivisch, also muss es das Modell sein).
- `pieces` = Flachformat (keine Zobrist-Hashes; das Modell braucht keine
  Zuggeschichte).
- `target` = `evaluateLeaf(game, f)` zum Aufzeichnungszeitpunkt.

**Menge:** 200 000 Zeilen reichen für einen ersten Fit; Erzeugung in Batches
(Selbstspiel ist schnell: Greedy ~2 ms/Zug). Aufbewahrung `data/nnue/train.jsonl`
(gitignore — keine Binärdaten im Repo).

**Kein Leak:** Stellungen aus Partien, die mit derselben Persönlichkeit gespielt
wurden, nicht bewerten; sonst lernt das Modell nur diese.

## Phase 2 — Modell

**Architektur:** 660→128→32→1, Tanh, wie der frühere Versuch (Bewährte
Dimensionierung). Eingabe: die 660 = 11 Figuren × 60 Felder (oder die schon
verwendete Kodierung v2 aus `git log --all -- js/nnue.ts` — vor dem Re-Start prüfen,
was davon zu retten ist).

**Implementierung:** `js/nnue.ts` (reine Mathematik, kein DOM) + `js/nnue-worker.ts`
für das Training, damit der Main-Thread frei bleibt. State in
`nnue/weights.json` (klein, <1 MB), per Flag ladbar.

**Nicht gleich die Eval ersetzen:** Das Modell ersetzt zuerst nur die _statische_
Schätzung in `evaluateBoard`-Pruning-Entscheidungen (futility/razoring/probcut),
gemäß dem Befund, dass die Blätter `evaluateLeaf` nutzen. Erst wenn das hilft,
weiter.

## Phase 3 — Training

**Offline, in Node:** `scripts/nnue-train.ts` lädt `train.jsonl`, trainiert mit
Mini-Batch-SGD (Adam, lr 3e-3, 30 Epochen, Holdout 10 %), schreibt `weights.json`.
Metrik: RMSE gegen die Ziele + Korrelation, nicht Elo.

**Kein Framework:** Handgeschriebene Backpropagation für eine 3-Schicht-MLP ist
~100 Zeilen; keine neue Dependency (Repo hat bewusst keine Runtime-Deps).

## Phase 4 — Messung (der einzige Beweis)

A/B gegen depth1, identische Bedingungen wie `scripts/engine-strength.ts`
(Buch an, Budget-Default, abwechselnde Reihenfolge, `--repeats=5`):

- Variante A: Engine mit NN-gestützter Pruning-Schätzung
- Variante B: unverändert

**Vor dem Commit:** `npm test`, `npm run test:e2e`, `npm run lint`, `npx prettier --check .`,
`npm run build` (Bundle-Gate 33000 — NN-Gewichte können das Bundle nicht außerdhalb
von `weights.json` treffen; das gehört nicht in den Build).

**Erfolgskriterium:** Die 95-%-CIs der beiden Arme schneiden sich nicht; bei
gleichbleibender Stärke trotzdem committen, wenn die Zugzeit messbar sinkt.

---

## Offene Risiken (vorab benannt)

1. **Distillation ist kein Stärkegewinn** — das Modell bildet dieselbe (erschöpfte)
   Eval nach. Es kann nur Durchsatz bringen, nicht Qualität. Wenn Phase 4 keinen
   Zeitgewinn zeigt, ist das Projekt tot.
2. **Perspektivität:** Die Engine bewertet aus Fraktionssicht; das Modell muss das
   lernen (Fraktionskodierung prüfen, nicht annehmen).
3. **Selbstspiel-Verzerrung:** Stellungen aus der eigenen Engine sind nicht
   repräsentativ für Partien gegen andere Stärken.

## Nicht in diesem Plan

Online-Multiplayer, Tablebases, andere Spielmodi.
