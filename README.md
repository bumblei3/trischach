# ⚔️ TriSchach

**[👉 Spiele die Live-Demo hier!](https://bumblei3.github.io/trischach/)**

**TriSchach** ist ein einzigartiges Schachspiel für 3 Spieler auf einem hexagonalen Dreieck-Spielfeld, kombiniert mit einer taktischen Schere-Stein-Papier-Mechanik.

## 🌟 Features

- **3 Fraktionen:** 🔥 Feuer, 🌊 Wasser und 🌿 Natur.
- **Symmetrisches Spielfeld:** Ein perfektes Hexagon-Dreieck mit 3 angedockten Startzonen, basierend auf Cube-Koordinaten.
- **🤖 Engine mit Suchtiefe & Persönlichkeiten:**
  - Alpha-Beta Minimax mit iterativem Tiefgang (1–12)
  - Zobrist Transposition Table (262.144 Entries, ~2 MB)
  - SEE (Static Exchange Evaluation) RPS-aware
  - Futility Pruning, Razoring, Null-Move Pruning (R=2)
  - Late Move Reductions (LMR) + Probcut
  - 4 KI-Persönlichkeiten: Ausgewogen, Aggressiv, Defensiv, Taktisch
  - **Pondering** – Denkt während Gegnerzug
  - **Adaptives Zeitmanagement** – Nutzt gesamte Bedenkzeit intelligent
  - **Web Worker (non-blocking)** – UI bleibt flüssig
- **Auto Battle Modus:** Engine vs. Engine mit Turnier-System & Elo-Rating
- **Schere-Stein-Papier (RPS) Kampf:** Zusätzliche taktische Ebene
- **Check-Escape Move Ordering:** Priorisiert König-Züge, Angreifer-Capture, Block-Züge
- **Check-Visualisierung:** Pulsierender König + Sound bei Schach
- **Promotion UI:** Auto-Queen Option, Keyboard-Shortcuts (Q/R/B/N), Key-Hints
- **📱 Vollständige Mobile/Touch Unterstützung:**
  - Swipe-to-Rotate (2-Finger, 120°-Schritte)
  - Long-Press / Right-Click Kontextmenü auf Figuren
  - PWA: Installierbar, Offline-fähig (Service Worker), Push-ready
- **📜 Spielverlauf & Replay:** TSPN-Format (Export/Import/Copy), Play/Pause/Step/Speed
- **📚 Opening Book:** 12 Styles (3 Fraktionen × Main/Aggressive/Solid/Flank), Weighted Learning
- **📊 Statistik-Dashboard & Daily Puzzle:** Lokale Spielstatistiken, deterministisches Tagespuzzle, Streak-Tracking
- **Auditives Feedback:** Dynamische Soundeffekte (Web Audio API)
- **Modernes UI:** Glassmorphism-Design mit Neon-Farben, Dark Mode
- **Pure Vanilla Power:** 100% HTML, CSS, TypeScript (ES Modules), keine UI-Frameworks. Der Quellcode ist Vanilla; für das Deployment läuft ein Vite-Build (bundelt `js/*.ts` → `dist/`, kopiert Manifest, Puzzles, Service Worker, CSS und Icons). Performantes SVG-Rendering.

## 🎲 Spielregeln

Jede Fraktion startet mit 15 Figuren (1 König, 1 Königin, 2 Türme, 2 Läufer, 2 Springer, 7 Bauern) — 45 Figuren auf dem Brett. Die Bewegungsregeln basieren auf dem klassischen Schach, adaptiert auf das Hexagon-Raster.

### Das RPS-Prinzip

Das Herzstück von TriSchach:

- 🔥 **Feuer** schlägt 🌿 **Natur**
- 🌿 **Natur** schlägt 🌊 **Wasser**
- 🌊 **Wasser** schlägt 🔥 **Feuer**

**Die Kampfmechanik:**

- **Vorteil (z.B. Feuer → Natur):** Normaler Schlag. Angreifer besiegt Verteidiger.
- **Nachteil (z.B. Feuer → Wasser):** Konter-Schlag! Verteidiger bleibt, **Angreifer wird geschlagen**.
- **Neutral (Gleiche Fraktion oder RPS deaktiviert):** Klassischer Schach-Schlag.

### Siegbedingung

Fällt ein König, scheidet die gesamte Fraktion sofort aus. Wer als Letzter noch einen König auf dem Feld hat, gewinnt die Schlacht.

## 🚀 Installation & Start

1. Repository klonen:

   ```bash
   git clone https://github.com/bumblei3/trischach.git
   cd trischach
   ```

2. Dependencies installieren (nur für Build und Tests nötig):

   ```bash
   npm install
   ```

3. Builden und lokal servieren:

   ```bash
   npm run build
   npx serve dist
   # öffne http://localhost:3000/
   ```

**Wichtig — der Build ist nicht optional.** `index.html` referenziert die Quellen als
`js/main.ts` / `js/pwa.ts`. Im Repo liegen ausschließlich `.ts`-Dateien (22 Stück, keine
`.js`); erst der Vite-Build transformiert sie und schreibt die Referenzen in
`dist/index.html` auf `./main.js` um. Ein statischer Server über das Repo-Root
funktioniert deshalb **nicht**: `python3 -m http.server` liefert `js/main.ts` mit
`Content-type: text/vnd.trolltech.linguist` aus, und der Browser verweigert das als
ES-Modul. Nur der Vite-Dev-Server (den auch die E2E-Suite nutzt) und der gebaute
`dist/`-Ordner funktionieren.

### PWA Installieren

- **Desktop/Chrome:** Klicke auf "Installieren" in der Adressleiste
- **Mobile Safari:** Teilen → "Zum Home-Bildschirm"
- **Offline:** Funktioniert nach erstem Besuch komplett offline

## 🛠️ Architektur

Die Codebase ist modular aufgebaut (22 Module in `js/`):

**Brett & Regeln**

- `index.html`: Struktur, UI-Layout, PWA Meta-Tags, SW-Registrierung
- `manifest.json`: PWA Manifest (Icons, Shortcuts, Kategorien)
- `sw.js`: Service Worker (Cache-First/Network-First, Background Sync, Push)
- `css/style.css`: Design-System, Glassmorphism, Animationen, Responsive (800px Breakpoint)
- `js/hex.ts`: Mathematische Basis für Hex-Grid (Cube-Koordinaten, TS strict)
- `js/board.ts`: SVG-Board Renderer, Touch-Gesten (Swipe-Rotate, Long-Press), Pieces
- `js/pieces.ts`: Figuren-Eigenschaften, hex-basierte Zugmuster
- `js/game.ts`: Zentrale State-Machine, Spielregeln, RPS-Logik, Undo/Redo, Fraktions-Eliminierung (Schachmatt **und** Patt entfernen eine Fraktion)
- `js/game-check.ts`: Schach/Checkmate/Stalemate Detection (3-Spieler)
- `js/types.ts`: Typdefinitionen und Re-Exports

**Engine**

- `js/ai-core.ts`: **Shared AI Core** (Main Thread + Web Worker)
  - Zobrist TT, SEE, Futility/Razoring, NMP, LMR, Probcut
  - Check-Escape Move Ordering, Dynamic Piece Values (RPS-aware)
  - Aspiration Windows, Killer Moves, History Heuristic
  - **Endgame Evaluation**, Pawn Structure, Personality Weights
- `js/ai.ts`: Main Thread Entry Point, Opening Book Integration
- `js/ai-worker.ts`: Web Worker Wrapper für non-blocking Search

**Modi & UI**

- `js/opening-book.ts`: Eröffnungsbibliothek (Generator + Weighted Random)
- `js/replay.ts`: TSPN Format (Export/Import/Replay Controls)
- `js/puzzle.ts`: Mate-in-N Puzzle-Generator
- `js/rps-puzzle.ts`: RPS-Taktik-Puzzles (Konter-Schlag wählen)
- `js/analysis.ts`: Analyse-Modus (PV-Linie + RPS-Erklärung)
- `js/coach.ts`: Coach-Strip („Was jetzt?“-Zeile)
- `js/game-stats.ts`: Lokale Spielstatistiken (localStorage)
- `js/game-feedback.ts`: Feedback-Kanal (vorgefülltes GitHub-Issue)
- `js/tutorial.ts`: Erst-Run-Tutorial
- `js/skins.ts`: Brett-Skins
- `js/sounds.ts`: Audio Engine (Web Audio API, synthetisch)
- `js/pwa.ts`: Service-Worker-Registrierung, Install-Prompt-Flow
- `js/main.ts`: Einstiegspunkt, UI-Integration, Event-Handling

**Build Pipeline (Production):** Vite bundelt ES Modules → `dist/` + `scripts/copy-assets.mjs` kopiert PWA-Assets.

## 🧪 Testing & Qualität

```bash
# Unit Tests (Vitest)
npm test

# E2E Tests (Playwright)
npm run test:e2e

# TypeScript Strict Check
npm run typecheck

# Linting
npm run lint
```

- **859 Unit Tests** ✅ (Vitest + Happy-DOM, 0 skipped, 51 Test-Files)
- **31 E2E Tests** ✅ (Playwright Chromium)
- **TypeScript Strict Mode** ✅ (0 Errors)
- **ESLint** ✅ (0 Errors)
- **Coverage Gates:** 80% Thresholds
  - Overall: **94.4%** Statements / **84.7%** Branches / **96.3%** Functions / **96.1%** Lines
  - `ai-core.ts`: 92.6% Lines · `game.ts`: 99.7% Lines · `game-check.ts`: 100% · `board.ts`: 100%
  - `js/main.ts`, `js/puzzle.ts`, `js/sounds.ts`, `js/types.ts`, `js/ai-worker.ts` sind von der
    Unit-Coverage ausgenommen (UI/Event-Code bzw. engine-getrieben) und werden über E2E abgedeckt.
  - Opening Book Learning: integriert (auto-battle self-play)

## 🤖 CI/CD

Dieses Projekt nutzt **GitHub Actions** (Node 24) mit parallelen Jobs:

| Job          | Trigger   | Blockierend | Beschreibung                               |
| ------------ | --------- | ----------- | ------------------------------------------ |
| `typecheck`  | Push/PR   | ja          | `tsc --noEmit`                             |
| `lint`       | Push/PR   | ja          | ESLint                                     |
| `unit-tests` | Push/PR   | ja          | Vitest + Coverage-Gate ≥80%                |
| `e2e-tests`  | Push/PR   | ja          | Bundle-Size-Gate, dann Playwright Chromium |
| `benchmark`  | Push/PR   | nein        | AI-Move-Timing (informativ)                |
| `codeql`     | Push/PR   | nein        | Security Scanning (JavaScript)             |
| `release`    | Tag `v*`  | ja          | Auto GitHub Release mit Release Notes      |
| `deploy`     | Push main | ja          | GitHub Pages Deploy                        |

**Quality Gates:**

- **Bundle Size Check** (im `e2e-tests`-Job, läuft _vor_ den E2E-Tests):
  `main.js ≤ 33000 B` gzip, `ai.js ≤ 18000 B`, `ai-worker.js ≤ 2000 B`.
  Aktueller Stand: main ≈ 31.9 KB, ai ≈ 9.3 KB, ai-worker ≈ 0.8 KB.
- **Coverage enforcement** ≥80% auf PRs
- **Lint + Typecheck** blocking (fail on errors)
- **Deploy** hängt an `typecheck`, `lint`, `unit-tests`, `e2e-tests` und `codeql` —
  ein rotes E2E blockiert also das Deployment. `benchmark` und `codeql` sind mit
  `continue-on-error` markiert und brechen den Run nicht ab.

**Hinweis zum Bundle-Gate:** Die Schwellenwerte müssen bei legitimen Feature-Zuwächsen
mitgezogen werden — sonst bricht der `e2e-tests`-Job ab, _bevor_ die E2E-Tests
überhaupt starten, und alle offenen PRs erben den Fehler. Der echte Puffer liegt
im Code-Splitting: `js/game.ts` wird statisch _und_ dynamisch importiert, deshalb
kann Rollup es nicht in einen eigenen Chunk heben.

## 📜 Lizenz

WTFPL – Do What The F*** You Want To Public License. Erstellt von [bumblei3](https://github.com/bumblei3). Siehe [LICENSE](./LICENSE).

---

## 🗺️ Roadmap / Ideen

### Erledigt

- [✅] **Puzzle Mode** – "Mate in N" Generator aus Opening Book (151 Puzzles: 73 Mate-in-1, 78 Mate-in-2)
- [✅] **Mate-in-N Detection** – Quiescence erweitert, Eval Bar "Matt in 3"
- [✅] **Pondering** – Denken während Gegnerzug
- [✅] **Opening Book Expansion** – 12 Styles, Weighted Learning aus Engine-Selbstpartien
- [✅] **Parallel Search** – Root-Move-Splitting über Web Worker (ohne SharedArrayBuffer)
- [✅] **Tutorial** – 3 Screens (Brett, RPS, Sieg), First-Run + Settings
- [✅] **Puzzle Uniqueness + Daily Streak** – deterministisches Tagespuzzle, Streak-Tracking
- [✅] **Replay-Analyse** – „Engine empfiehlt…" mit Eval an der aktuellen Position
- [✅] **RPS-Taktik-Puzzles** – 🎯 Solo-Modus: RPS-Konter-Schlag wählen (Vorteil vs. Risiko)
- [✅] **Analyse-Modus vertiefen** – PV-Linie + RPS-Erklärung
- [✅] **RPS-Preview + Coach-Strip** – Tooltip/Confirm bei Nachteil, „Was jetzt?"-Zeile
- [✅] **Statistik-Dashboard + Feedback-Kanal** – lokale Stats, Issue-Template

### Bewusst entfernt

- **JS-NNUE Evaluation** – 660→128→32→1, TD-Training. Gemessen ohne Elo-Gewinn
  (depth 2: −26, depth 3: −17, CIs überlappen 0), deshalb radikal entfernt
  (~3500 Zeilen inkl. Gewichte, UI-Toggle, CI-Job). Die Suche ruft direkt
  `evaluateBoard` auf.
- **Endgame Tablebases** – 5 JSONs (~500 KB) + Probe-Hook. Die ≤4-Stein-Probe-Zone
  wird in echten Partien nie erreicht (erste Eliminierung bei 19–30 Steinen) —
  totes Bundle-Gewicht plus irreführende „perfect play"-Doku.

### Offen (Solo-Fokus — kein Multiplayer)

- [ ] **3-Player Search-Stärke** – Suchtiefe bringt derzeit **keinen messbaren
      Vorteil**: depth 3 gegen depth 1 ergibt 35.0% Score (n=40, CI −221..5) bzw.
      33.3% (n=12, CI −329..89). Bei drei Fraktionen ist 33% exakt das
      Fairness-Niveau — die Tiefe zahlt sich also nicht aus. Der Engpass ist die
      Eval-Qualität, und jede Methode, sie zu _lernen_, scheitert an der
      3-Spieler-Struktur (keine terminalen Labels, Kingmaker bricht 2P-Tricks).
      Gemessen via `scripts/engine-strength.ts`; Zahlen und Messregeln in
      [STATUS.md](./STATUS.md). Kein Hebel ohne Bench-Artefakt.
- [ ] **Tastatur- & Screenreader-Bedienung** – Das SVG-Brett ist derzeit Maus/Touch-only
      (kein `tabindex`, kein `focus()`; Modals setzen keinen Fokus). Brettspiele sind
      traditionell gute Kandidaten für Tastatur-Bedienung via algebraischer Notation.
- [ ] **Code-Splitting** – `js/puzzle.ts` (~30 KB raw) und `js/replay.ts` (~30 KB raw)
      liegen statisch im Initial-Bundle, obwohl sie erst beim Öffnen des jeweiligen
      Modus gebraucht werden. `js/game.ts` und `js/opening-book.ts` werden doppelt
      gebundelt (statisch + dynamisch).
- [ ] **i18n** – Die UI ist konsistent deutsch; Englisch wäre der größte Reichweiten-Hebel.

**Bewusst nicht geplant:** Online Multiplayer (WebRTC), Distributed Match Runner.
