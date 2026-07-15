/**
 * Tutorial state helpers (localStorage + step content).
 */
import { expect, test, describe, beforeEach } from "vitest";
import {
  getTutorialSteps,
  isTutorialDone,
  markTutorialDone,
  resetTutorial,
  shouldShowTutorialOnStartup,
  TUTORIAL_DONE_KEY,
} from "../js/tutorial.ts";

describe("tutorial steps", () => {
  test("provides exactly 3 screens: board, rps, victory", () => {
    const steps = getTutorialSteps();
    expect(steps).toHaveLength(3);
    expect(steps.map((s) => s.id)).toEqual(["board", "rps", "victory"]);
    for (const step of steps) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(0);
      expect(step.bullets.length).toBeGreaterThan(0);
    }
  });
});

describe("tutorial persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("defaults to not done / show on startup", () => {
    expect(isTutorialDone()).toBe(false);
    expect(shouldShowTutorialOnStartup()).toBe(true);
  });

  test("markTutorialDone persists and hides on startup", () => {
    markTutorialDone();
    expect(localStorage.getItem(TUTORIAL_DONE_KEY)).toBe("1");
    expect(isTutorialDone()).toBe(true);
    expect(shouldShowTutorialOnStartup()).toBe(false);
  });

  test("resetTutorial clears the flag", () => {
    markTutorialDone();
    resetTutorial();
    expect(isTutorialDone()).toBe(false);
    expect(shouldShowTutorialOnStartup()).toBe(true);
  });
});
