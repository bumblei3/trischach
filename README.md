# ⚔️ TriSchach

**[👉 Spiele die Live-Demo hier!](https://bumblei3.github.io/trischach/)**

**TriSchach** ist ein einzigartiges Schachspiel für 3 Spieler auf einem hexagonalen Dreieck-Spielfeld, kombiniert mit einer taktischen Schere-Stein-Papier-Mechanik.

## 🌟 Features

- **3 Fraktionen:** 🔥 Feuer, 🌊 Wasser und 🌿 Natur.
- **Symmetrisches Spielfeld:** Ein perfektes Hexagon-Dreieck mit 3 angedockten Startzonen, basierend auf Cube-Koordinaten.
- **🤖 Engine mit Suchtiefe & Persönlichkeiten:**
  - Alpha-Beta Minimax mit iterativem Tiefgang (1–12)
  - Zobrist Transposition Table (262k Entries, ~80–120 Elo)
  - SEE (Static Exchange Evaluation) RPS-aware
  - Futility Pruning, Razoring, Null-Move Pruning (R=2)
  - Late Move Reductions (LMR) + Probcut (~40–60 Elo)
  - 4 KI-Persönlichkeiten: Ausgewogen, Aggressiv, Defensiv, Taktisch
  - **Pondering** – Denkt während Gegnerzug (+50–80 Elo)
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
- **📚 Opening Book:** 3×4 Styles (Classical, Aggressive, Solid, Tricky), Depth 22+, Weighted Learning
- **Auditives Feedback:** Dynamische Soundeffekte (Web Audio API)
- **Modernes UI:** Glassmorphism-Design mit Neon-Farben, Dark Mode
- **Pure Vanilla Power:** 100% HTML, CSS, JavaScript (ES Modules). Keine Frameworks, kein Build-Step. Performantes SVG-Rendering.

## 🎲 Spielregeln

Jede Fraktion startet mit 15 Figuren (1 König, 1 Königin, 2 Türme, 2 Läufer, 2 Springer, 7 Bauern). Die Bewegungsregeln basieren auf dem klassischen Schach, adaptiert auf das Hexagon-Raster.

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

Lokal lässt sich TriSchach in Sekunden starten:

1. Repository klonen:

   ```bash
   git clone https://github.com/bumblei3/trischach.git
   cd trischach
   ```

2. Lokalen Webserver starten:

   ```bash
   # Mit Python
   python3 -m http.server 8080
   # Oder mit Node.js (falls installiert)
   npx serve .
   ```

3. Öffne `http://localhost:8080/` im Browser.

### PWA Installieren

- **Desktop/Chrome:** Klicke auf "Installieren" in der Adressleiste
- **Mobile Safari:** Teilen → "Zum Home-Bildschirm"
- **Offline:** Funktioniert nach erstem Besuch komplett offline

## 🛠️ Architektur

Die Codebase ist modular und ohne Build-Step aufgebaut:

- `index.html`: Struktur, UI-Layout, PWA Meta-Tags, SW-Registrierung
- `manifest.json`: PWA Manifest (Icons, Shortcuts, Kategorien)
- `sw.js`: Service Worker (Cache-First/Network-First, Background Sync, Push)
- `css/style.css`: Design-System, Glassmorphism, Animationen, Responsive (800px Breakpoint)
- `js/hex.ts`: Mathematische Basis für Hex-Grid (Cube-Koordinaten, TS strict)
- `js/board.ts`: SVG-Board Renderer, Touch-Gesten (Swipe-Rotate, Long-Press), Pieces
- `js/pieces.ts`: Figuren-Eigenschaften, hex-basierte Zugmuster
- `js/game.ts`: Zentrale State-Machine, Spielregeln, RPS-Logik, Undo/Redo
- `js/game-check.ts`: Schach/Checkmate/Stalemate Detection (3-Spieler)
- `js/ai-core.ts`: **Shared AI Core** (Main Thread + Web Worker)
  - Zobrist TT, SEE, Futility/Razoring, NMP, LMR, Probcut
  - Check-Escape Move Ordering, Dynamic Piece Values (RPS-aware)
  - Aspiration Windows, Killer Moves, History Heuristic
  - **Endgame Evaluation**, Pawn Structure, Personality Weights
- `js/ai.ts`: Main Thread Entry Point, Opening Book Integration
- `js/ai-worker.js`: Web Worker Wrapper für non-blocking Search
- `js/opening-book.ts`: Eröffnungsbibliothek (Generator + Weighted Random)
- `js/replay.ts`: TSPN Format (Export/Import/Replay Controls)
- `js/sounds.ts`: Audio Engine (Web Audio API, synthetisch)
- `js/main.ts`: Einstiegspunkt, UI-Integration, Event-Handling, PWA SW-Registrierung

## 🧪 Testing & Qualität

```bash
# Unit Tests (Vitest)
npm test

# E2E Tests (Playwright)
npm run test:e2e

# TypeScript Strict Check
npx tsc --noEmit

# Linting
npm run lint
```

- **336 Unit Tests** ✅ (Vitest + Happy-DOM)
- **13 E2E Tests** ✅ (Playwright Chromium)
- **TypeScript Strict Mode** ✅ (0 Errors)
- **ESLint** ✅ (0 Errors, nur Pre-existing Warnings)
- **Coverage Gates:** 80% Thresholds, `vitest check: true`
  - Overall: ~74% Statements / ~89% Branches / ~85% Functions
  - ai-core.ts: **89.93%** Coverage
  - CombatUIManager: 92%, TooltipManager: 97%

### Engine Tournament (Elo-Messung)

```bash
# Quick (4 Games/Pairing, Depth 2)
npm run tournament

# Full (20 Games/Pairing, Depth 3)
npm run tournament:large
```

elo-Hierarchie (Beispiel): Ausgewogen > Aggressiv > Defensiv > Taktisch > Random

## 🤖 CI/CD

Dieses Projekt nutzt **GitHub Actions** mit parallelen Jobs:

| Job          | Trigger                       | Beschreibung                                                  |
| ------------ | ----------------------------- | ------------------------------------------------------------- |
| `lint-test`  | Push/PR                       | TypeScript, ESLint, Unit Tests (Node 20/22), Coverage ≥80%    |
| `codeql`     | Push/PR                       | Security Scanning (JavaScript)                                |
| `e2e-tests`  | Push/PR                       | Playwright E2E (parallel zu lint-test)                        |
| `benchmark`  | Push/PR                       | Quick Tournament (4 Games @ Depth 2), PR-Comment              |
| `tournament` | Schedule (03:00 UTC) / Manual | Full Tournament (10 Games @ Depth 3), 30d Artifact            |
| `release`    | Tag `v*`                      | Auto GitHub Release mit Release Notes                         |
| `deploy`     | Push main                     | GitHub Pages Deploy (nach lint-test + e2e-tests + codeql)     |

**Fixes:** `copy-assets` post-build, Script-Pfad korrigiert, erhöhte Timeouts → stabile E2E Runs

## 📜 Lizenz

MIT License – Erstellt von [bumblei3](https://github.com/bumblei3)

---

## 🗺️ Roadmap / Ideen

- [ ] **Puzzle Mode** – "Mate in N" Generator aus Opening Book
- [ ] **Mate-in-N Detection** – Quiescence erweitert, Eval Bar "Matt in 3"
- [ ] **Online Multiplayer (WebRTC)** – Echtzeit 3-Spieler-Schach
- [ ] **Neural Evaluation (tiny NNUE)** – ~150-200 Elo Gewinn
- [ ] **Parallel Search** – SharedArrayBuffer + Web Workers
- [✅] **Pondering** – Denken während Gegnerzug (+50-80 Elo)
- [✅] **Opening Book Expansion** – 3×4 Styles, Depth 22+, Weighted Learning aus Engine-Selbstpartien
- [ ] **Distributed Match Runner** – Koordinierte Engine-Matches über mehrere Clients
- [ ] **Endgame Tablebases** – Syzygy-Style für 3-Spieler-Endspiele
