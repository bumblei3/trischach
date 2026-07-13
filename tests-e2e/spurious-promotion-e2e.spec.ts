/**
 * spurious-promotion-e2e.spec.ts — regression test for the bug where a pawn's
 * symbol was silently mutated (to "P" / a royal symbol) by the main-thread AI
 * search (calculateBestMoveParallel) running on the live game object. The
 * search mutates+restores piece state via simulateMove/undoMove; undoMove used
 * to hardcode symbol="P", so after a search the live pawn kept "P" instead of
 * its real Unicode symbol (♟). Fixed by restoring the original symbol.
 *
 * This test drives an auto-battle from a position where a pawn is NOT on the
 * promotion rank and asserts the pawn keeps type=pawn AND symbol=♟ afterwards.
 */
import { test, expect } from "./base";

test.describe("TriSchach - No spurious pawn promotion from AI search", () => {
  test("a non-promoting pawn keeps its pawn symbol through auto-battle", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await page.goto("/");
    await page.waitForSelector("#board-svg .piece", { timeout: 15000 });
    await page.waitForTimeout(500);

    // Position: one Fire pawn at (0,2) — r=2 is NOT the promotion rank (r<=0).
    // Three kings keep the game in a valid state.
    await page.evaluate(() => {
      const g = window.game;
      const PT = window.__trischachTestTypes.PIECE_TYPE;
      const Piece = window.__trischachTestPiece;
      const Hex = window.__trischachTestHex;
      g.pieces = [
        new Piece(PT.PAWN, "fire", new Hex(0, 2)),
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

    // Start auto-battle and let the search run for a few moves.
    await page.evaluate(() => {
      const btn = document.getElementById("auto-battle-btn");
      if (btn) (btn as HTMLButtonElement).click();
    });
    await page.waitForTimeout(8000);

    // The pawn must still be a pawn with its real Unicode symbol (♟), NOT a
    // royal symbol and NOT the ASCII "P" left behind by the search.
    const pawn = await page.evaluate(() => {
      const g = window.game;
      const p = g.pieces.find(
        (p: { faction: string; pos: { q: number; r: number } }) =>
          p.faction === "fire" && p.pos.q === 0 && p.pos.r === 2,
      );
      return p ? { type: p.type, symbol: p.symbol } : null;
    });

    // The pawn may have moved during auto-battle; find ANY fire pawn and
    // assert it is still a pawn with the correct symbol.
    const anyFirePawn = await page.evaluate(() => {
      const g = window.game;
      return g.pieces
        .filter(
          (p: { faction: string; type: string }) =>
            p.faction === "fire" && p.type === "pawn",
        )
        .map((p: { type: string; symbol: string }) => ({
          type: p.type,
          symbol: p.symbol,
        }));
    });

    // If the specific pawn is still there, it must be correct.
    if (pawn) {
      expect(pawn.type).toBe("pawn");
      expect(pawn.symbol).toBe("♟");
    }
    // Any fire pawn must have a valid pawn symbol (♟), never "P" or a royal one.
    for (const p of anyFirePawn) {
      expect(p.type).toBe("pawn");
      expect(p.symbol).toBe("♟");
    }

    expect(errors).toEqual([]);
  });
});
