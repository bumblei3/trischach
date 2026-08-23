import { test, expect } from "./base";

test.describe("Move-log jump to replay", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#board-svg", { timeout: 15000 });
    await page.waitForSelector("#board-svg .piece", { timeout: 15000 });
    await page.waitForTimeout(1000);
  });

  test("move log entries are clickable and jump opens replay controls", async ({
    page,
  }) => {
    // Play two moves via the UI: find a movable Feuer piece, move it.
    const feuerPieces = page.locator("#board-svg .piece-fire");
    const count = await feuerPieces.count();
    expect(count).toBeGreaterThan(0);

    let moved = false;
    for (let i = 0; i < count && !moved; i++) {
      const piece = feuerPieces.nth(i);
      await piece.click({ force: true });
      await page.waitForTimeout(300);
      const highlights = page.locator("#board-svg .highlight-move");
      if ((await highlights.count()) > 0) {
        await highlights.first().click({ force: true });
        moved = true;
        break;
      }
      await piece.click({ force: true });
      await page.waitForTimeout(100);
    }
    expect(moved).toBe(true);
    await page.waitForTimeout(500);

    // Move log should now have at least one entry
    const entries = page.locator("#move-log .move-entry");
    const entryCount = await entries.count();
    expect(entryCount).toBeGreaterThan(0);

    // Click the first entry — should open the replay controls
    await entries.first().click();
    await page.waitForTimeout(500);

    const replayControls = page.locator("#replay-controls");
    await expect(replayControls).toBeVisible();

    // Move info should show a valid position within the game
    const moveInfo = page.locator("#replay-move-info");
    await expect(moveInfo).toContainText(/Zug \d+ \/ \d+/);
  });

  test("jumping back shows an earlier position (fewer pieces moved)", async ({
    page,
  }) => {
    // Play at least one move
    const feuerPieces = page.locator("#board-svg .piece-fire");
    const count = await feuerPieces.count();
    let moved = false;
    for (let i = 0; i < count && !moved; i++) {
      const piece = feuerPieces.nth(i);
      await piece.click({ force: true });
      await page.waitForTimeout(300);
      const highlights = page.locator(
        "#board-svg .highlight-move, #board-svg .highlight-attack",
      );
      if ((await highlights.count()) > 0) {
        await highlights.first().click({ force: true });
        moved = true;
        break;
      }
      await piece.click({ force: true });
      await page.waitForTimeout(100);
    }
    expect(moved).toBe(true);
    await page.waitForTimeout(500);

    // Jump back to the start of the game via first entry click
    const entries = page.locator("#move-log .move-entry");
    await entries.first().click();
    await page.waitForTimeout(500);

    // Replay controls visible; step back to the very beginning
    await page.locator("#replay-first").click();
    await page.waitForTimeout(300);
    const moveInfo = page.locator("#replay-move-info");
    await expect(moveInfo).toContainText("Zug 0 /");
  });
});
