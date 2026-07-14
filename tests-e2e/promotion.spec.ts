import { test, expect } from "./base";

// Verifies the pawn-promotion *choice* UI end-to-end: when a pawn reaches the
// promotion zone the overlay appears, and picking a piece (click or hotkey)
// transforms the pawn and dismisses the overlay. Drives the engine into the
// edge-case position via window.game (exposed in main.ts) instead of playing
// six moves by hand, then exercises the real handleCellClick -> showPromotion
// -> completePromotion flow through the DOM.
//
// main.ts exposes (for E2E/testing only): window.game, window.renderer, and the
// real engine constructors/types via __trischachTestPiece / __trischachTestTypes
// / __trischachTestHex.
function scriptPromotionPosition(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const g = (window as any).game;
    const Piece = (window as any).__trischachTestPiece;
    const { PIECE_TYPE, FACTION } = (window as any).__trischachTestTypes;
    const Hex = (window as any).__trischachTestHex;
    // Minimal position: Fire pawn one step from the promotion zone at (0,-1),
    // which promotes on reaching its true last rank (0,-2) (r === -2), plus
    // all three kings so no faction is eliminated.
    g.pieces = [
      new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, -1)),
      new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(-5, 5)),
      new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(5, -5)),
      new Piece(PIECE_TYPE.KING, FACTION.NATURE, new Hex(5, 5)),
    ];
    g.rpsEnabled = false;
    g.eliminatedFactions = new Set();
    g._rebuildOccupiedMap();
    g.currentFactionIdx = 0;
    g.currentFaction = FACTION.FIRE;
    g.state = "select_piece";
    g.selectedPiece = null;
    g.pendingPromotion = null;
    // Re-render the scripted position so the DOM matches the engine.
    const boardGroup = document.getElementById("board-group");
    boardGroup?.querySelectorAll(".piece").forEach((el) => el.remove());
    for (const p of g.getAlivePieces()) (window as any).renderer.renderPiece(p);
  });
}

test.describe("TriSchach - Pawn Promotion Choice", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#board-svg", { timeout: 15000 });
    await page.waitForSelector("#board-svg .piece", { timeout: 15000 });
    await page.waitForTimeout(1000);
    await scriptPromotionPosition(page);
  });

  test("promotion overlay appears and a click promotes the pawn to a queen", async ({
    page,
  }) => {
    // Click the Fire pawn, then click the promotion-square hex (0,-2).
    await page.locator("#board-svg .piece-fire").first().click({ force: true });
    const targetHex = page.locator('#board-svg polygon[title="Coord: 0,-2"]');
    await expect(targetHex).toBeVisible();
    await targetHex.click({ force: true });

    // Promotion overlay must appear.
    const overlay = page.locator("#promotion-overlay");
    await expect(overlay).toHaveClass(/visible/);

    // Click the Queen choice.
    await page.locator('.promotion-choice[data-type="queen"]').click();

    // Overlay dismissed, pawn is now a queen (symbol ♛) on (0,0).
    await expect(overlay).not.toHaveClass(/visible/);
    const promoted = page.locator("#board-svg .piece-fire", { hasText: "♛" });
    await expect(promoted.first()).toBeVisible();

    const state = await page.evaluate(() => {
      const g = (window as any).game;
      const p = g.pieces.find(
        (p: any) =>
          p.faction === "fire" &&
          p.type === "queen" &&
          p.pos.q === 0 &&
          p.pos.r === -2,
      );
      return { promoted: !!p, pending: g.pendingPromotion };
    });
    expect(state.promoted).toBe(true);
    expect(state.pending).toBeNull();
  });

  test("promotion can be completed with the Q hotkey", async ({ page }) => {
    await page.locator("#board-svg .piece-fire").first().click({ force: true });
    await page
      .locator('#board-svg polygon[title="Coord: 0,-2"]')
      .click({ force: true });

    const overlay = page.locator("#promotion-overlay");
    await expect(overlay).toHaveClass(/visible/);

    // Press Q to promote to queen.
    await page.keyboard.press("q");

    await expect(overlay).not.toHaveClass(/visible/);
    const promoted = page.locator("#board-svg .piece-fire", { hasText: "♛" });
    await expect(promoted.first()).toBeVisible();
  });
});
