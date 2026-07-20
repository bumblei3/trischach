import { test, expect } from "./base";

// Regression/coverage for the RPS-Tactic puzzle UI (added in #105).
// We cannot know the randomly generated position, so we drive the real
// two-click piece→target flow and assert the screen reacts: the feedback
// line changes from its initial prompt to a Richtig/Falsch verdict.
test.describe("TriSchach - RPS-Tactic puzzle UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#board-svg .piece", { timeout: 15000 });
    await page.waitForTimeout(800);
  });

  test("opens from the puzzle menu and reacts to a move attempt", async ({
    page,
  }) => {
    // Open puzzle menu
    await page.click("#puzzle-btn");
    await expect(page.locator("#puzzle-overlay")).toBeVisible();

    // Open the RPS-Tactic screen
    await page.click("#puzzle-rps-btn");
    await expect(page.locator("#rps-board-svg")).toBeVisible();
    await expect(page.locator("#rps-feedback")).toBeVisible();

    // Initial prompt should be present before any interaction
    const initialFeedback = await page.locator("#rps-feedback").textContent();
    expect(initialFeedback ?? "").toContain("Figur");

    // Drive the two-click flow: click every piece in turn. Because the
    // position always has one own piece + two enemy pieces, clicking an own
    // piece then an enemy piece must change the feedback to a verdict.
    const pieces = page.locator("#rps-board-svg .piece");
    const count = await pieces.count();
    expect(count).toBeGreaterThan(0);

    let verdictSeen = false;
    for (let i = 0; i < count && !verdictSeen; i++) {
      await pieces.nth(i).click({ force: true });
      await page.waitForTimeout(150);
      const fb = (await page.locator("#rps-feedback").textContent()) ?? "";
      if (fb.includes("Richtig") || fb.includes("Falsch")) {
        verdictSeen = true;
        break;
      }
      // If the first click selected an own piece, the next enemy click
      // resolves it. Try the next piece as the target.
      if (i + 1 < count) {
        await pieces.nth(i + 1).click({ force: true });
        await page.waitForTimeout(150);
        const fb2 = (await page.locator("#rps-feedback").textContent()) ?? "";
        if (fb2.includes("Richtig") || fb2.includes("Falsch")) {
          verdictSeen = true;
          break;
        }
      }
    }

    expect(verdictSeen).toBe(true);

    // "Neues Puzzle" regenerates without error
    await page.click("#rps-new-btn");
    await expect(page.locator("#rps-board-svg")).toBeVisible();
  });

  test("returns to the puzzle menu via the menu button", async ({ page }) => {
    await page.click("#puzzle-btn");
    await page.click("#puzzle-rps-btn");
    await expect(page.locator("#rps-board-svg")).toBeVisible();

    await page.click("#rps-menu-btn");
    await expect(page.locator("#puzzle-overlay")).toBeVisible();
  });
});
