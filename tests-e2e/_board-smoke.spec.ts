import { test, expect } from "./base";

// Smoke check: the board must actually render after the app boots.
// Regression guard for the "board disappeared" bug where mid-file import
// statements in main.ts broke the production main.js parse, so init() never
// ran and the SVG stayed empty.
test("board renders after load", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForSelector("#board-svg", { timeout: 10000 });
  // Wait for the renderer to paint the initial pieces.
  await page.waitForTimeout(1500);
  const pieceCount = await page.locator("#board-svg [class*='piece']").count();
  expect(
    pieceCount,
    `expected pieces on board, got ${pieceCount}`,
  ).toBeGreaterThan(20);
  expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);
});
