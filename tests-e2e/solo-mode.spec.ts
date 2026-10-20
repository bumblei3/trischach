import { test, expect } from "./base";

test.describe("TriSchach - Solo gegen die KI", () => {
  test("engine moves the other factions, then it is the human turn", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "trischach-settings",
        JSON.stringify({
          humanFaction: "water",
          aiDepth: 1,
          autoBattle: false,
          soundEnabled: false,
        }),
      );
    });
    await page.goto("/");
    await page.waitForSelector("#board-svg .piece", { timeout: 15000 });
    await expect(page.locator("#play-as")).toHaveValue("water");
    await expect(page.locator("#panel-water")).toHaveClass(/solo-human/);

    // Feuer zieht zuerst. Die KI spielt diesen Zug, danach ist Wasser am Zug.
    await expect(page.locator("#move-log .move-entry")).toHaveCount(1, {
      timeout: 20000,
    });
    await expect(page.locator("#turn-indicator")).toContainText("Wasser", {
      timeout: 20000,
    });
    await expect(page.locator("#status")).toContainText("Wähle eine Figur");

    // Der nächste Zug bleibt liegen: Wasser ist der Mensch.
    await page.waitForTimeout(600);
    await expect(page.locator("#move-log .move-entry")).toHaveCount(1);
  });

  test("hotseat does not move on its own", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#board-svg .piece", { timeout: 15000 });
    await expect(page.locator("#play-as")).toHaveValue("");
    await page.waitForTimeout(800);
    await expect(page.locator("#move-log .move-entry")).toHaveCount(0);
    await expect(page.locator("#turn-indicator")).toContainText("Feuer");
  });
});
