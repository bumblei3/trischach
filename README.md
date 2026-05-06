# ⚔️ TriSchach

**TriSchach** ist ein einzigartiges Schachspiel für 3 Spieler auf einem hexagonalen Dreieck-Spielfeld, kombiniert mit einer taktischen Schere-Stein-Papier-Mechanik.

## 🌟 Features

- **3 Fraktionen:** 🔥 Feuer, 🌊 Wasser und 🌿 Natur.
- **Symmetrisches Spielfeld:** Ein perfektes Hexagon-Dreieck mit 3 angedockten Startzonen, gebaut aus Cube-Koordinaten.
- **Auto Battle Modus:** Lehn dich zurück und schau zu, wie eine KI die Fraktionen automatisch gegeneinander antreten lässt.
- **Keine Frameworks:** Zu 100% in Vanilla HTML, CSS und JavaScript geschrieben. Das Spielfeld wird performant als SVG gerendert.
- **Dark Mode UI:** Modernes "Glassmorphism"-Design mit leuchtenden Neon-Farben.

## 🎲 Spielregeln

Jede Fraktion hat 13 Figuren (1 König, 1 Königin, 2 Türme, 2 Läufer, 2 Springer, 5 Bauern). Die Bewegungsregeln basieren auf dem klassischen Schach, wurden aber logisch auf das 6-Eck-Raster (Hex-Grid) übertragen.

Das Kernstück des Spiels ist das **Schere-Stein-Papier-Prinzip (RPS)**:
- 🔥 **Feuer** schlägt 🌿 **Natur**
- 🌿 **Natur** schlägt 🌊 **Wasser**
- 🌊 **Wasser** schlägt 🔥 **Feuer**

**Die Kampfmechanik:**
- **Vorteil (z.B. Feuer greift Natur an):** Normaler Schlag. Der Angreifer besiegt den Verteidiger. Ein Feuer-Bauer kann problemlos eine Natur-Königin schlagen!
- **Nachteil (z.B. Feuer greift Wasser an):** Selbstmord-Angriff! Der Verteidiger wehrt den Angriff ab und der **Angreifer stirbt**. 

**Siegbedingung:**
Fällt der König einer Fraktion, scheidet diese sofort aus und all ihre restlichen Figuren verschwinden vom Feld. Wer als Letzter noch einen König hat, gewinnt!

## 🚀 Installation & Start

Da TriSchach komplett im Browser läuft und keine Build-Tools benötigt, ist der Start extrem simpel:

1. Repository klonen:
   ```bash
   git clone https://github.com/bumblei3/trischach.git
   cd trischach
   ```

2. Einen lokalen Webserver starten (z.B. mit Python):
   ```bash
   python3 -m http.server 8080
   ```

3. Im Browser öffnen:
   Gehe zu `http://localhost:8080/`

## 🛠️ Architektur

- `index.html`: Struktur und Layout
- `css/style.css`: Design System, Animationen und SVG-Styling
- `js/hex.js`: Mathematische Bibliothek für Cube-Koordinaten auf dem Hex-Grid (nach der Referenz von Red Blob Games)
- `js/board.js`: SVG-Rendering und Layout des dreieckigen Spielfelds
- `js/pieces.js`: Figuren-Definitionen und hex-spezifische Bewegungslogik
- `js/game.js`: Zentrale State-Machine, Spielzüge und RPS-Auswertung
- `js/ai.js`: Die "Auto Battle" KI mit Greedy-Heuristik
- `js/main.js`: Einstiegspunkt, Event-Listener und UI-Updates

## 📜 Lizenz
MIT License
