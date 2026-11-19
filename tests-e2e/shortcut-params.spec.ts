import { test, expect } from "./base";

// Das PWA-Manifest verspricht zwei Shortcuts: einen für eine neue Partie
// (?new=true) und einen für den Automatik-Modus (?autobattle=true). Beide
// Parameter wirkten früher nicht — der Besucher landete in der App, ohne dass
// sich etwas tat. Diese Spec hält fest, dass sie das tun.

test.describe("TriSchach - PWA-Shortcuts", () => {
  // Ohne den Shortcut bliebe die gespeicherte Automatik an: applySettings
  // schaltet sie ein. Der Neustart des Shortcuts schaltet sie wieder aus —
  // nur daran ist die Wirkung des Parameters sichtbar.
  test("?new=true löst den Neustart aus", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "trischach-settings",
        JSON.stringify({ autoBattle: true, soundEnabled: false }),
      );
    });
    await page.goto("/?new=true", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#board-svg .piece", { timeout: 15000 });

    await expect(page.locator("#auto-battle-btn")).not.toHaveClass(/active/);
    const gespeichert = await page.evaluate(() =>
      localStorage.getItem("trischach-settings"),
    );
    expect(gespeichert).toContain('"autoBattle":false');
  });

  test("?autobattle=true schaltet die Automatik ein", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "trischach-settings",
        JSON.stringify({ autoBattle: false, soundEnabled: false }),
      );
    });
    await page.goto("/?autobattle=true", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#board-svg .piece", { timeout: 15000 });
    await expect(page.locator("#auto-battle-btn")).toHaveClass(/active/);

    const gespeichert = await page.evaluate(() =>
      localStorage.getItem("trischach-settings"),
    );
    expect(gespeichert).toContain('"autoBattle":true');
  });
});
