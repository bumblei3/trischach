import { beforeEach, describe, expect, it } from "vitest";
import {
  loadFeedback,
  saveFeedback,
  logFeedbackClick,
  logFeedbackSubmit,
  generateFeedbackDraft,
  resetFeedback,
  summarizeFeedback,
  FEEDBACK_KEY,
  FeedbackEntry,
} from "../js/game-feedback";
import { GAME_STATS_KEY } from "../js/game-stats";

beforeEach(() => {
  // clean shared happy-dom localStorage
  localStorage.removeItem(FEEDBACK_KEY);
  localStorage.removeItem(GAME_STATS_KEY);
});

describe("game-feedback", () => {
  it("loadFeedback — leerer Storage gibt leeres Array zurück", () => {
    expect(loadFeedback()).toEqual([]);
  });

  it("loadFeedback — gültige Daten werden korrekt geladen", () => {
    const entries: FeedbackEntry[] = [
      { timestamp: "2024-01-01T00:00:00.000Z", kind: "button", context: "stats-dashboard" },
      { timestamp: "2024-01-01T00:01:00.000Z", kind: "submit", rating: 5, text: "gut", draft: "draft" },
    ];
    saveFeedback(entries);
    expect(loadFeedback()).toEqual(entries);
  });

  it("loadFeedback — kaputte JSON gibt leeres Array zurück", () => {
    localStorage.setItem(FEEDBACK_KEY, "nope");
    expect(loadFeedback()).toEqual([]);
  });

  it("loadFeedback — kein Array (z.B. Number) gibt leeres Array zurück", () => {
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(42));
    expect(loadFeedback()).toEqual([]);
  });

  it("logFeedbackClick — ohne context erzeugt button-Eintrag", () => {
    const entries = logFeedbackClick();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "button",
    });
    expect((entries[0] as FeedbackEntry).context).toBeUndefined();
  });

  it("logFeedbackClick — mit context erzeugt button-Eintrag mit context", () => {
    const entries = logFeedbackClick("stats-dashboard");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "button",
      context: "stats-dashboard",
    });
  });

  it("logFeedbackClick — persistiert im Storage", () => {
    logFeedbackClick();
    expect(JSON.parse(localStorage.getItem(FEEDBACK_KEY)!).length).toBe(1);
  });

  it("logFeedbackClick — kappt auf 200 Einträge", () => {
    const batch: FeedbackEntry[] = [];
    for (let i = 0; i < 200; i++) {
      batch.push({ timestamp: `t${i}`, kind: "button" });
    }
    saveFeedback(batch);
    logFeedbackClick();
    expect(loadFeedback()).toHaveLength(200);
    expect(loadFeedback()[0].kind).toBe("button");
  });

  it("logFeedbackSubmit — erzeugt submit-Eintrag mit rating, text, draft", () => {
    const draft = generateFeedbackDraft(4, "alles gut");
    const entries = logFeedbackSubmit(4, "alles gut", draft);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "submit",
      rating: 4,
      text: "alles gut",
      draft,
    });
  });

  it("generateFeedbackDraft — enthält alle Sections", () => {
    const draft = generateFeedbackDraft(3, "geht so\nnoch besser wär es");
    expect(draft).toContain("## Feedback");
    expect(draft).toContain("**Bewertung:** 3 von 5");
    expect(draft).toContain("> geht so");
    expect(draft).toContain("> noch besser wär es");
    expect(draft).toContain("*Dieses Feedback wurde von trischach vorbereitet.");
  });

  it("generateFeedbackDraft — Rating-Wörter", () => {
    expect(generateFeedbackDraft(1, "")).toContain("(sehr schlecht)");
    expect(generateFeedbackDraft(3, "")).toContain("(okay)");
    expect(generateFeedbackDraft(5, "")).toContain("(sehr gut)");
    expect(generateFeedbackDraft(9000, "")).toContain("(unbekannt)");
  });

  it("resetFeedback — leert den Storage-Key", () => {
    logFeedbackClick();
    expect(loadFeedback()).toHaveLength(1);
    resetFeedback();
    expect(loadFeedback()).toEqual([]);
    expect(localStorage.getItem(FEEDBACK_KEY)).toBeNull();
  });

  it("summarizeFeedback — aggregiert button + submit", () => {
    logFeedbackClick();
    logFeedbackClick("puzzle");
    const draft = generateFeedbackDraft(4, "gut");
    logFeedbackSubmit(4, "gut", draft);
    logFeedbackSubmit(2, "schlecht", draft);

    const s = summarizeFeedback();
    expect(s.buttonClicks).toBe(2);
    expect(s.submits).toBe(2);
    expect(s.ratingSum).toBe(6);
    expect(s.ratingCount).toBe(2);
    expect(s.latestDraft).toBe(draft);
  });

  it("summarizeFeedback — empty state", () => {
    const s = summarizeFeedback();
    expect(s.buttonClicks).toBe(0);
    expect(s.submits).toBe(0);
    expect(s.ratingSum).toBe(0);
    expect(s.ratingCount).toBe(0);
    expect(s.latestDraft).toBeNull();
  });

  it("FEEDBACK_KEY und GAME_STATS_KEY sind verschiedene Keys", () => {
    expect(FEEDBACK_KEY).not.toBe(GAME_STATS_KEY);
    expect(FEEDBACK_KEY.startsWith("trischach-")).toBe(true);
  });

  it("saveFeedback — wirft bei kaputter Storage nicht", () => {
    const original = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    };
    expect(() =>
      saveFeedback([{ timestamp: "t", kind: "button" }]),
    ).not.toThrow();
    localStorage.setItem = original;
  });
});
