/**
 * Tutorial state helpers (localStorage + step content).
 */
import { expect, test, describe, beforeEach } from "vitest";
import {
  getTutorialSteps,
  isTutorialDone,
  isAutomatedBrowser,
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

  test("defaults to not done; startup show respects automation flag", () => {
    expect(isTutorialDone()).toBe(false);
    // happy-dom (and Playwright) may set navigator.webdriver → suppress auto-open.
    expect(shouldShowTutorialOnStartup()).toBe(!isAutomatedBrowser());
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
    expect(shouldShowTutorialOnStartup()).toBe(!isAutomatedBrowser());
  });

  test("isAutomatedBrowser is a boolean (env-dependent)", () => {
    expect(typeof isAutomatedBrowser()).toBe("boolean");
  });

  test("isAutomatedBrowser detects e2e / notutorial query params", () => {
    const origSearch = window.location.search;
    // Force webdriver off so the query-param branch is actually exercised
    // (vitest/happy-dom otherwise short-circuits via navigator.webdriver).
    const nav = window.navigator as unknown as { webdriver?: boolean };
    const origWebdriver = nav.webdriver;
    Object.defineProperty(nav, "webdriver", {
      value: false,
      configurable: true,
    });
    try {
      window.location.search = "?e2e=1";
      expect(isAutomatedBrowser()).toBe(true);
      window.location.search = "?notutorial";
      expect(isAutomatedBrowser()).toBe(true);
      window.location.search = "?foo=bar";
      // neutral param, webdriver off → not automated
      expect(isAutomatedBrowser()).toBe(false);
    } finally {
      window.location.search = origSearch;
      Object.defineProperty(nav, "webdriver", {
        value: origWebdriver,
        configurable: true,
      });
    }
  });
});

describe("tutorial storage resilience (private mode / quota)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("isTutorialDone returns false when localStorage.getItem throws", () => {
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("quota");
    };
    try {
      expect(isTutorialDone()).toBe(false);
    } finally {
      Storage.prototype.getItem = orig;
    }
  });

  test("markTutorialDone swallows setItem errors (private mode)", () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("quota exceeded");
    };
    try {
      expect(() => markTutorialDone()).not.toThrow();
    } finally {
      Storage.prototype.setItem = orig;
    }
  });

  test("resetTutorial swallows removeItem errors (private mode)", () => {
    const orig = Storage.prototype.removeItem;
    Storage.prototype.removeItem = () => {
      throw new Error("quota exceeded");
    };
    try {
      expect(() => resetTutorial()).not.toThrow();
    } finally {
      Storage.prototype.removeItem = orig;
    }
  });
});
