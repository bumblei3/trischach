/**
 * First-run tutorial for TriSchach (3 screens: board, RPS, victory).
 * Pure state + copy — DOM rendering lives in main.ts.
 */

export const TUTORIAL_DONE_KEY = "trischach-tutorial-done";

export interface TutorialStep {
  id: "board" | "rps" | "victory";
  title: string;
  icon: string;
  body: string;
  bullets: string[];
}

export function getTutorialSteps(): TutorialStep[] {
  return [
    {
      id: "board",
      title: "Das Brett",
      icon: "⬡",
      body: "TriSchach wird auf einem hexagonalen Dreiecksfeld gespielt — drei Fraktionen teilen sich ein gemeinsames Zentrum.",
      bullets: [
        "🔥 Feuer, 🌊 Wasser und 🌿 Natur starten in eigenen Ecken",
        "Figuren ziehen wie im klassischen Schach, angepasst auf Hex-Koordinaten",
        "Drehe die Ansicht mit 2-Finger-Swipe (120°-Schritte), um deine Fraktion nach unten zu bringen",
      ],
    },
    {
      id: "rps",
      title: "Schere-Stein-Papier",
      icon: "✊",
      body: "Jede Fraktion schlägt eine andere. Das entscheidet Kämpfe zusätzlich zur Figurenstärke.",
      bullets: [
        "🔥 Feuer schlägt 🌿 Natur",
        "🌿 Natur schlägt 🌊 Wasser",
        "🌊 Wasser schlägt 🔥 Feuer",
        "Vorteil: normaler Schlag. Nachteil: Konter — der Angreifer fällt!",
      ],
    },
    {
      id: "victory",
      title: "Siegbedingung",
      icon: "👑",
      body: "Es geht nicht um Schachmatt im Zweier-Sinn: wer als Letzter noch einen König hat, gewinnt.",
      bullets: [
        "Fällt ein König (Matt oder Patt), scheidet die ganze Fraktion aus",
        "Die verbleibenden Figuren dieser Fraktion verschwinden vom Brett",
        "Zuletzt stehender König = Sieg. Viel Erfolg!",
      ],
    },
  ];
}

export function isTutorialDone(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_DONE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markTutorialDone(): void {
  try {
    localStorage.setItem(TUTORIAL_DONE_KEY, "1");
  } catch {
    // ignore quota / private mode
  }
}

export function resetTutorial(): void {
  try {
    localStorage.removeItem(TUTORIAL_DONE_KEY);
  } catch {
    // ignore
  }
}

/** Show on first visit only (tutorial not yet completed). */
export function shouldShowTutorialOnStartup(): boolean {
  return !isTutorialDone();
}
