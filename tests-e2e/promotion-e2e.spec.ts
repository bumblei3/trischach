/**
 * promotion-e2e.spec.ts — browser verification of the pawn-promotion flow,
 * including the previously-broken piece-type persistence (R/B/N/Q must be
 * written to the move log, not always =Q). Drives the real UI click flow so
 * the promotion dialog actually opens via main.ts's click handler.
 */
import { test, expect } from "./base";

test.describe("TriSchach - Pawn Promotion", () => {
  test("selecting a rook writes =R to the move log (not =Q)", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    // Disable auto-queen BEFORE the app loads so the promotion CHOICE dialog
    // appears (otherwise main.ts silently completes as a queen and the
    // dialog never opens — the test would trivially pass with =Q).
    await page.addInitScript(() => {
      const raw = localStorage.getItem("trischach-settings");
      const s = raw ? JSON.parse(raw) : {};
      s.autoQueen = false;
      localStorage.setItem("trischach-settings", JSON.stringify(s));
    });

    await page.goto("/");
    await page.waitForSelector("#board-svg .piece", { timeout: 15000 });
    await page.waitForTimeout(500);

    // Script a Fire pawn one step from the promotion edge (r=0 is the promo
    // row) plus the three kings, so the game is in a valid state.
    await page.evaluate(() => {
      const g = window.game;
      const PT = window.__trischachTestTypes.PIECE_TYPE;
      const Piece = window.__trischachTestPiece;
      const Hex = window.__trischachTestHex;
      g.pieces = [
        new Piece(PT.PAWN, "fire", new Hex(0, 1)),
        new Piece(PT.KING, "fire", new Hex(-5, 5)),
        new Piece(PT.KING, "water", new Hex(5, -5)),
        new Piece(PT.KING, "nature", new Hex(5, 5)),
      ];
      g._rebuildOccupiedMap();
      g.currentFaction = "fire";
      g.currentFactionIdx = 0;
      g.rpsEnabled = true;
      if (g.onUpdate) g.onUpdate();
    });

    // Let the renderer repaint the new position.
    await page.waitForTimeout(300);
    await page.waitForSelector('[data-q="0"][data-r="1"]', { timeout: 5000 });

    // Drive the pawn into the promotion zone via real UI clicks.
    await page.click('[data-q="0"][data-r="1"] .hex-polygon', { force: true }); // select pawn
    await page.click('[data-q="0"][data-r="0"] .hex-polygon', { force: true }); // -> promotion zone

    // The choice dialog must appear.
    const overlay = page.locator("#promotion-overlay");
    await expect(overlay).toHaveClass(/visible/, { timeout: 5000 });

    // Pick ROOK (not the default queen).
    await page.locator('.promotion-choice[data-type="rook"]').click();

    // The pawn must now be a rook.
    const pieceType = await page.evaluate(() => {
      const g = window.game;
      const p = g.pieces.find(
        (p) => p.faction === "fire" && p.pos.q === 0 && p.pos.r === 0,
      );
      return p ? p.type : null;
    });
    expect(pieceType).toBe("rook");

    // The move log must show the promoted piece (rook symbol), NOT a queen —
    // proving the choice dialog's selection was honoured (previously the
    // promotion type was discarded and the log/export always showed queen).
    const logText = await page.locator("#move-log").innerText();
    expect(logText).toContain("♜"); // rook symbol
    expect(logText).not.toContain("♛"); // not the queen symbol

    // No page errors during the flow.
    expect(errors).toEqual([]);
  });

  test("selecting a knight writes =N to the move log", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    // Disable auto-queen BEFORE the app loads so the promotion CHOICE dialog
    // appears (otherwise main.ts silently completes as a queen and the
    // dialog never opens — the test would trivially pass with =Q).
    await page.addInitScript(() => {
      const raw = localStorage.getItem("trischach-settings");
      const s = raw ? JSON.parse(raw) : {};
      s.autoQueen = false;
      localStorage.setItem("trischach-settings", JSON.stringify(s));
    });

    await page.goto("/");
    await page.waitForSelector("#board-svg .piece", { timeout: 15000 });
    await page.waitForTimeout(500);

    await page.evaluate(() => {
      const g = window.game;
      const PT = window.__trischachTestTypes.PIECE_TYPE;
      const Piece = window.__trischachTestPiece;
      const Hex = window.__trischachTestHex;
      g.pieces = [
        new Piece(PT.PAWN, "fire", new Hex(0, 1)),
        new Piece(PT.KING, "fire", new Hex(-5, 5)),
        new Piece(PT.KING, "water", new Hex(5, -5)),
        new Piece(PT.KING, "nature", new Hex(5, 5)),
      ];
      g._rebuildOccupiedMap();
      g.currentFaction = "fire";
      g.currentFactionIdx = 0;
      g.rpsEnabled = true;
      if (g.onUpdate) g.onUpdate();
    });

    await page.waitForTimeout(300);
    await page.waitForSelector('[data-q="0"][data-r="1"]', { timeout: 5000 });

    await page.click('[data-q="0"][data-r="1"] .hex-polygon', { force: true });
    await page.click('[data-q="0"][data-r="0"] .hex-polygon', { force: true });

    const overlay = page.locator("#promotion-overlay");
    await expect(overlay).toHaveClass(/visible/, { timeout: 5000 });

    await page.locator('.promotion-choice[data-type="knight"]').click();

    const pieceType = await page.evaluate(() => {
      const g = window.game;
      const p = g.pieces.find(
        (p) => p.faction === "fire" && p.pos.q === 0 && p.pos.r === 0,
      );
      return p ? p.type : null;
    });
    expect(pieceType).toBe("knight");

    const logText = await page.locator("#move-log").innerText();
    expect(logText).toContain("♞"); // knight symbol
    expect(logText).not.toContain("♛"); // not the queen symbol

    expect(errors).toEqual([]);
  });
});
