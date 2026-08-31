/**
 * Feedback-Kanal — localStorage-basiert, kein Netzwerk, keine Accounts.
 *
 * Zwei Dinge:
 *  1. Logger: trackt Klicks auf den Feedback-Button und Formular-Absenden
 *     (Ghostboard — ob das Feature lebt).
 *  2. Formular: Ranking (1–5) + Freitext → generiert einen GitHub-Issue-Draft-Text.
 *
 * Nach dem Absenden: Danke-Dialog mit dem fertigen Draft-Text zum Kopieren.
 * Kein "wir haben es erhalten"-Fake — wir haben es nicht erhalten.
 */
import { GAME_STATS_KEY } from "./game-stats";

export const FEEDBACK_KEY = "trischach-feedback";

export interface FeedbackEntry {
  /** ISO-Timestamp des Events */
  timestamp: string;
  /** "button" = Klick auf den Button; "submit" = Formular abgesendet */
  kind: "button" | "submit";
  /** Optional: Kontext, in dem der Button geklickt wurde (z.B. "stats-dashboard") */
  context?: string;
  /** Nur bei kind=submit: Ranking 1–5 */
  rating?: number;
  /** Nur bei kind=submit: Freitext */
  text?: string;
  /** Nur bei kind=submit: fertig generierter Issue-Draft */
  draft?: string;
}

/** Lade alle Feedback-Einträge. */
export function loadFeedback(): FeedbackEntry[] {
  try {
    const raw = localStorage.getItem(FEEDBACK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

/** Speichere Feedback-Einträge. */
export function saveFeedback(entries: FeedbackEntry[]): void {
  try {
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(entries));
  } catch {
    // Storage voll oder disabled — nicht crash-en
  }
}

/** Logge einen Feedback-Button-Klick. */
export function logFeedbackClick(context?: string): FeedbackEntry[] {
  const entries = loadFeedback();
  entries.unshift({
    timestamp: new Date().toISOString(),
    kind: "button",
    context,
  });
  // Kappen auf 200 Einträge — reicht für Nutzungsanalyse
  if (entries.length > 200) entries.length = 200;
  saveFeedback(entries);
  return entries;
}

/** Logge ein abgesendetes Feedback-Formular. */
export function logFeedbackSubmit(
  rating: number,
  text: string,
  draft: string,
): FeedbackEntry[] {
  const entries = loadFeedback();
  entries.unshift({
    timestamp: new Date().toISOString(),
    kind: "submit",
    rating,
    text,
    draft,
  });
  if (entries.length > 200) entries.length = 200;
  saveFeedback(entries);
  return entries;
}

/** Generiere einen GitHub-Issue-Draft-Text aus Rating + Freitext. */
export function generateFeedbackDraft(rating: number, text: string): string {
  const ratingWords: Record<number, string> = {
    1: "sehr schlecht",
    2: "schlecht",
    3: "okay",
    4: "gut",
    5: "sehr gut",
  };
  const ratingWord = ratingWords[rating] ?? "unbekannt";
  const lines = [
    "## Feedback",
    "",
    `**Bewertung:** ${rating} von 5 (${ratingWord})`,
    "",
    "> " + text.replace(/\n/g, "\n> "),
    "",
    "---",
    "",
    "*Dieses Feedback wurde von trischach vorbereitet. Bitte auf GitHub posten.*",
  ];
  return lines.join("\n");
}

/** Löscht alle Feedback-Einträge (Nutzungsreset). */
export function resetFeedback(): void {
  try {
    localStorage.removeItem(FEEDBACK_KEY);
  } catch {
    // ignored
  }
}

/** Rückgabewert: { buttonClicks, submits, ratingSum, ratingCount, latestDraft } */
export function summarizeFeedback(): {
  buttonClicks: number;
  submits: number;
  ratingSum: number;
  ratingCount: number;
  latestDraft: string | null;
} {
  const entries = loadFeedback();
  let buttonClicks = 0;
  let submits = 0;
  let ratingSum = 0;
  let ratingCount = 0;
  let latestDraft: string | null = null;
  for (const e of entries) {
    if (e.kind === "button") buttonClicks++;
    else if (e.kind === "submit") {
      submits++;
      if (e.rating) {
        ratingSum += e.rating;
        ratingCount++;
      }
      if (e.draft) latestDraft = e.draft;
    }
  }
  return { buttonClicks, submits, ratingSum, ratingCount, latestDraft };
}
