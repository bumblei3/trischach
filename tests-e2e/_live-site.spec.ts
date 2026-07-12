import { test, expect } from "./base";

// Verify the LIVE deployed site actually renders the board (not just the
// local dev server). This catches deploy/pages-config regressions where the
// production index.html references a path the CDN cannot serve.
test("live site renders the board", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });
  const resp = await page.goto("https://bumblei3.github.io/trischach/", {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  expect(resp?.status(), "HTTP status").toBeLessThan(400);
  await page.waitForTimeout(2500);
  const scriptSrc = await page
    .locator("#board-svg")
    .first()
    .getAttribute("id")
    .catch(() => null);
  const pieceCount = await page
    .locator("#board-svg [class*='piece']")
    .count();
  console.log("LIVE piece count:", pieceCount, "| errors:", errors);
  expect(
    pieceCount,
    `expected pieces on live board, got ${pieceCount}. errors=${errors.join("; ")}`,
  ).toBeGreaterThan(20);
});
