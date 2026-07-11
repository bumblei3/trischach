import { test, expect } from "./base";

// Regression coverage for flows that were previously broken in production.
// NOTE: Only tests behavior present in the built .js source (main.js). The
// settings overlay / auto-battle-learning UI exists only in the unfinished
// .ts source and is intentionally NOT covered here.
test.describe("TriSchach - Regression flows", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#board-svg .piece", { timeout: 15000 });
    await page.waitForTimeout(800);
  });

  test("Auto Battle actually plays moves (regression: was stuck at 0 moves)", async ({
    page,
  }) => {
    await page.click("#auto-battle-btn");
    await expect(page.locator("#auto-battle-btn")).toHaveClass(/active/);

    let logged = 0;
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(1000);
      logged = await page
        .locator("#move-log .move-entry")
        .count()
        .catch(() => 0);
      if (logged >= 3) break;
    }

    await page.click("#auto-battle-btn").catch(() => {}); // stop
    expect(logged).toBeGreaterThan(0);
  });

  test("Puzzle mode opens the puzzle overlay", async ({ page }) => {
    await page.click("#puzzle-btn");
    await expect(page.locator("#puzzle-overlay")).toBeVisible();
  });

  test("Replay controls exist in DOM (hidden until a game is loaded)", async ({
    page,
  }) => {
    // replay-controls container is display:none until a TSPN is loaded,
    // but the buttons must be present so the UI can show them later.
    const next = page.locator("#replay-next");
    await expect(next).toHaveCount(1);
    const play = page.locator("#replay-play");
    await expect(play).toHaveCount(1);
  });

  test("New Game button resets to initial position", async ({ page }) => {
    // Make one Feuer move to change state
    const feuerPieces = page.locator("#board-svg .piece-fire");
    const feuerCount = await feuerPieces.count();
    let moved = false;
    for (let i = 0; i < feuerCount; i++) {
      const piece = feuerPieces.nth(i);
      await piece.click({ force: true });
      await page.waitForTimeout(250);
      const highlights = page.locator("#board-svg .highlight-move");
      if ((await highlights.count()) > 0) {
        await highlights.first().click({ force: true });
        moved = true;
        break;
      }
      await piece.click({ force: true });
      await page.waitForTimeout(100);
    }
    if (moved) {
      await page.click("#restart-btn");
      await expect(page.locator("#turn-indicator")).toContainText("Feuer");
      await expect(page.locator("#move-log")).toBeEmpty();
    }
  });

  test("Rotate then New Game stays clickable (regression: SVG intercepts pointer events)", async ({
    page,
  }) => {
    // Rotating the board-svg grows its hit-box beyond its layout box.
    // After rotation the rotated <svg> must NOT swallow clicks on the
    // controls below it (the bug made Drehen/Neu dead after one rotation).
    await page.click("#rotate-btn");
    await page.waitForTimeout(700);

    // These must succeed WITHOUT force: the SVG must not intercept the click.
    // (If the rotated SVG ate pointer events, Playwright would report
    // "<svg id=board-svg> intercepts pointer events".)
    await page.click("#rotate-btn", { timeout: 5000 });
    await page.waitForTimeout(300);

    await page.click("#restart-btn", { timeout: 5000 });
    await page.waitForTimeout(500);

    await expect(page.locator("#turn-indicator")).toContainText("Feuer");
    await expect(page.locator("#move-log")).toBeEmpty();

    // Controls remain live: rotate once more after restart.
    await page.click("#rotate-btn", { timeout: 5000 });
    await page.waitForTimeout(300);
  });
});
