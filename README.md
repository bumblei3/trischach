# ⚔️ TriSchach

**[👉 Spiele die Live-Demo hier!](https://bumblei3.github.io/trischach/)**

**TriSchach** ist ein einzigartiges Schachspiel für 3 Spieler auf einem hexagonalen Dreieck-Spielfeld, kombiniert mit einer taktischen Schere-Stein-Papier-Mechanik.

## 🌟 Features

- **3 Fraktionen:** 🔥 Feuer, 🌊 Wasser und 🌿 Natur.
- **Symmetrisches Spielfeld:** Ein perfektes Hexagon-Dreieck mit 3 angedockten Startzonen, basierend auf Cube-Koordinaten.
- **Auto Battle Modus:** Eine KI mit Greedy-Heuristik lässt die Fraktionen automatisch gegeneinander antreten.
- **Schere-Stein-Papier (RPS) Kampf:** Eine zusätzliche taktische Ebene, die klassisches Schach auf den Kopf stellt.
- **Auditives Feedback:** Dynamische Soundeffekte für Züge, Schläge und Spielereignisse.
- **📜 Spielverlauf:** Ein detailliertes Log aller vergangenen Züge zur besseren Übersicht.
- **Modernes UI:** Glassmorphism-Design mit Neon-Farben, optimiert für Dark Mode.
- **Pure Vanilla Power:** 100% HTML, CSS und JavaScript. Keine Frameworks, kein Overhead. Performantes SVG-Rendering.

## 🎲 Spielregeln

Jede Fraktion startet mit 15 Figuren (1 König, 1 Königin, 2 Türme, 2 Läufer, 2 Springer, 7 Bauern). Die Bewegungsregeln basieren auf dem klassischen Schach, adaptiert auf das Hexagon-Raster.

### Das RPS-Prinzip
Das Herzstück von TriSchach:
- 🔥 **Feuer** schlägt 🌿 **Natur**
- 🌿 **Natur** schlägt 🌊 **Wasser**
- 🌊 **Wasser** schlägt 🔥 **Feuer**

**Die Kampfmechanik:**
- **Vorteil (z.B. Feuer → Natur):** Normaler Schlag. Der Angreifer besiegt den Verteidiger.
- **Nachteil (z.B. Feuer → Wasser):** Konter-Schlag! Der Verteidiger bleibt stehen und der **Angreifer wird geschlagen**.
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

## 🛠️ Architektur

Die Codebase ist modular und ohne Build-Step aufgebaut:

- `index.html`: Struktur und UI-Layout.
- `css/style.css`: Design-System, Glassmorphism-Effekte und Animationen.
- `js/hex.js`: Mathematische Basis für das Hex-Grid (Cube-Koordinaten).
- `js/board.js`: Logik für das SVG-Board und die Spielfeld-Generierung.
- `js/pieces.js`: Figuren-Eigenschaften und hex-basierte Zugmuster.
- `js/game.js`: Zentrale State-Machine, Spielregeln und RPS-Logik.
- `js/ai.js`: Die "Auto Battle" KI mit Greedy-Entscheidungen.
- `js/sounds.js`: Audio-Engine für auditives Feedback.
- `js/main.js`: Einstiegspunkt, UI-Integration und Event-Handling.

## 🤖 CI/CD
Dieses Projekt nutzt **GitHub Actions**, um bei jedem Push in den `main` Branch automatisch die neueste Version auf **GitHub Pages** zu deployen.

## 📜 Lizenz
MIT License – Erstellt von [bumblei3](https://github.com/bumblei3)

