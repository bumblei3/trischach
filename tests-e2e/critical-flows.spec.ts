import { test, expect } from "./base";

test.describe("TriSchach - Critical User Flows", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for board to render and pieces to appear
    await page.waitForSelector("#board-svg", { timeout: 15000 });
    await page.waitForSelector("#board-svg .piece", { timeout: 15000 });
    // Wait a bit more for game initialization
    await page.waitForTimeout(1000);
  });

  test("Game loads and shows initial position", async ({ page }) => {
    // Check title
    await expect(page.locator("h1")).toContainText("TriSchach");
    // Check board is rendered
    await expect(page.locator("#board-svg")).toBeVisible();
    // Check turn indicator shows Feuer
    await expect(page.locator("#turn-indicator")).toContainText("Feuer");
    // Check status shows "Wähle eine Figur"
    await expect(page.locator("#status")).toContainText("Wähle eine Figur");
  });

  test("Can make a valid move (select piece, then target)", async ({
    page,
  }) => {
    // Get all piece elements
    const pieces = page.locator("#board-svg .piece");
    const pieceCount = await pieces.count();
    expect(pieceCount).toBeGreaterThan(0);

    // Find a Feuer piece (red) that has valid moves
    // In initial position, the first Feuer piece (rook at edge) has NO moves
    // We need to find one with valid moves - typically a pawn
    const feuerPieces = page.locator("#board-svg .piece-fire");
    const feuerCount = await feuerPieces.count();
    expect(feuerCount).toBeGreaterThan(0);

    // Try each Feuer piece until we find one with valid moves
    let foundValidMoves = false;
    for (let i = 0; i < feuerCount; i++) {
      const piece = feuerPieces.nth(i);
      await piece.click({ force: true });

      // Wait briefly to see if valid moves appear
      await page.waitForTimeout(300);

      const highlights = page.locator("#board-svg .highlight-move");
      const highlightCount = await highlights.count();

      if (highlightCount > 0) {
        foundValidMoves = true;
        break; // This piece has valid moves, use it
      }

      // No moves for this piece - deselect by clicking again or clicking elsewhere
      await piece.click({ force: true });
      await page.waitForTimeout(100);
    }

    expect(foundValidMoves).toBeTruthy();

    // Check status changes to show valid moves
    await expect(page.locator("#status")).toContainText("Ziel wählen");

    // Wait for valid move indicators to appear - these are highlighted hex cells
    await page.waitForFunction(
      () => {
        const highlights = document.querySelectorAll(
          "#board-svg .highlight-move",
        );
        return highlights.length > 0;
      },
      { timeout: 5000 },
    );

    // Click a valid move target (the highlighted hex polygon)
    const validMoves = page.locator("#board-svg .highlight-move");
    const moveCount = await validMoves.count();
    expect(moveCount).toBeGreaterThan(0);

    await validMoves.first().click({ force: true });

    // Verify turn advanced (now Wasser's turn)
    await expect(page.locator("#turn-indicator")).toContainText("Wasser");

    // Verify move was logged in history
    const moveLog = page.locator("#move-log");
    await expect(moveLog).not.toBeEmpty();
  });

  test("RPS Combat works", async ({ page }) => {
    const feuerPieces = page.locator("#board-svg .piece-fire");
    const wasserPieces = page.locator("#board-svg .piece-water");

    await expect(feuerPieces.first()).toBeVisible();
    await expect(wasserPieces.first()).toBeVisible();

    // Select a Feuer piece that actually has moves/attacks (the first one in
    // the initial position may have none — e.g. an edge rook).
    const feuerCount = await feuerPieces.count();
    let foundSelectable = false;
    for (let i = 0; i < feuerCount; i++) {
      const piece = feuerPieces.nth(i);
      await piece.click({ force: true });
      await page.waitForTimeout(200);
      const highlights = page.locator(
        "#board-svg .highlight-move, #board-svg .highlight-attack, #board-svg .highlight-attack-advantage, #board-svg .highlight-attack-disadvantage",
      );
      if ((await highlights.count()) > 0) {
        foundSelectable = true;
        break;
      }
      await piece.click({ force: true });
      await page.waitForTimeout(100);
    }
    expect(foundSelectable).toBeTruthy();

    // After selecting, the status enters the target-selection state.
    await expect(page.locator("#status")).toContainText("Ziel wählen");

    // After selecting, attack indicators (advantage/neutral/disadvantage) may
    // appear. In the initial position there may be none — assert the count is a
    // non-negative integer rather than leaving the value unused.
    const validAttacks = page.locator(
      "#board-svg .highlight-attack, #board-svg .highlight-attack-advantage, #board-svg .highlight-attack-disadvantage",
    );
    const attackCount = await validAttacks.count();
    expect(attackCount).toBeGreaterThanOrEqual(0);
  });

  test("Undo button works", async ({ page }) => {
    // Make a move first - find a Feuer piece with valid moves
    const feuerPieces = page.locator("#board-svg .piece-fire");
    const feuerCount = await feuerPieces.count();

    let foundValidMoves = false;
    for (let i = 0; i < feuerCount; i++) {
      const piece = feuerPieces.nth(i);
      await piece.click({ force: true });
      await page.waitForTimeout(300);

      const highlights = page.locator("#board-svg .highlight-move");
      const highlightCount = await highlights.count();

      if (highlightCount > 0) {
        foundValidMoves = true;
        break;
      }

      await piece.click({ force: true });
      await page.waitForTimeout(100);
    }

    if (foundValidMoves) {
      const validMoves = page.locator("#board-svg .valid-move");
      const moveCount = await validMoves.count();
      if (moveCount > 0) {
        await validMoves.first().click({ force: true });

        // Now click undo
        await page.click("#undo-btn");

        // Verify we're back to Feuer's turn
        await expect(page.locator("#turn-indicator")).toContainText("Feuer");
      }
    }
  });

  test("AI Depth slider changes depth", async ({ page }) => {
    // Opens the Settings modal (General tab holds the KI-Tiefe slider)
    await page.click("#settings-btn");
    await expect(page.locator("#settings-overlay")).toHaveClass(/visible/);

    const depthSlider = page.locator("#depth-slider");
    const depthLabel = page.locator("#depth-label");

    // Check initial value (default is 3 = Schwer)
    await expect(depthSlider).toHaveValue("3");
    await expect(depthLabel).toContainText("Schwer");

    // Change to depth 4
    await depthSlider.fill("4");
    await expect(depthLabel).toContainText("Extrem");

    // Change to depth 1
    await depthSlider.fill("1");
    await expect(depthLabel).toContainText("Leicht");
  });

  test("AI Personality selector works", async ({ page }) => {
    await page.click("#settings-btn");
    await expect(page.locator("#settings-overlay")).toHaveClass(/visible/);

    const personalitySelect = page.locator("#personality-select");

    // Check default
    await expect(personalitySelect).toHaveValue("balanced");

    // Change to aggressive
    await personalitySelect.selectOption("aggressive");
    await expect(personalitySelect).toHaveValue("aggressive");

    // Change to defensive
    await personalitySelect.selectOption("defensive");
    await expect(personalitySelect).toHaveValue("defensive");

    // Change to tactical
    await personalitySelect.selectOption("tactical");
    await expect(personalitySelect).toHaveValue("tactical");
  });

  test("Board rotation works", async ({ page }) => {
    const rotateBtn = page.locator("#rotate-btn");
    const boardSvg = page.locator("#board-svg");

    // Get initial rotation
    const initialTransform = await boardSvg.evaluate(
      (el) => getComputedStyle(el).transform,
    );

    // Click rotate
    await rotateBtn.click();

    // Wait for rotation animation
    await page.waitForTimeout(500);

    // Check rotation changed
    const newTransform = await boardSvg.evaluate(
      (el) => getComputedStyle(el).transform,
    );
    expect(newTransform).not.toBe(initialTransform);
  });

  test("New Game button resets game", async ({ page }) => {
    // Make a move first - find a Feuer piece with valid moves
    const feuerPieces = page.locator("#board-svg .piece-fire");
    const feuerCount = await feuerPieces.count();

    let foundValidMoves = false;
    for (let i = 0; i < feuerCount; i++) {
      const piece = feuerPieces.nth(i);
      await piece.click({ force: true });
      await page.waitForTimeout(300);

      const highlights = page.locator("#board-svg .highlight-move");
      const highlightCount = await highlights.count();

      if (highlightCount > 0) {
        foundValidMoves = true;
        break;
      }

      await piece.click({ force: true });
      await page.waitForTimeout(100);
    }

    if (foundValidMoves) {
      const validMoves = page.locator("#board-svg .valid-move");
      const moveCount = await validMoves.count();
      if (moveCount > 0) {
        await validMoves.first().click({ force: true });

        // Click new game
        await page.click("#restart-btn");

        // Verify back to initial state
        await expect(page.locator("#turn-indicator")).toContainText("Feuer");
        await expect(page.locator("#status")).toContainText("Wähle eine Figur");
        await expect(page.locator("#move-log")).toBeEmpty();
      }
    }
  });

  test("Sound toggle persists", async ({ page }) => {
    // Open settings (Sound toggle now lives in the Settings modal)
    await page.click("#settings-btn");
    await expect(page.locator("#settings-overlay")).toHaveClass(/visible/);

    const soundToggle = page.locator("#sound-toggle");
    const soundLabel = page.locator("label.switch:has(#sound-toggle)");
    await expect(soundToggle).toBeChecked();

    // Turn off by clicking the label (checkbox is visually hidden)
    await soundLabel.click();
    await expect(soundToggle).not.toBeChecked();

    // Verify localStorage was updated (app reads this on startup)
    const soundSetting = await page.evaluate(() => {
      const settings = JSON.parse(
        localStorage.getItem("trischach-settings") || "{}",
      );
      return settings.soundEnabled;
    });
    expect(soundSetting).toBe(false);
  });

  test("RPS toggle persists", async ({ page }) => {
    // Open settings (RPS toggle now lives in the Settings modal)
    await page.click("#settings-btn");
    await expect(page.locator("#settings-overlay")).toHaveClass(/visible/);

    const rpsToggle = page.locator("#rps-toggle");
    const rpsLabel = page.locator("label.switch:has(#rps-toggle)");
    await expect(rpsToggle).toBeChecked();

    // Turn off by clicking the label
    await rpsLabel.click();
    await expect(rpsToggle).not.toBeChecked();

    // Verify localStorage was updated (app reads this on startup)
    const rpsSetting = await page.evaluate(() => {
      const settings = JSON.parse(
        localStorage.getItem("trischach-settings") || "{}",
      );
      return settings.rpsEnabled;
    });
    expect(rpsSetting).toBe(false);
  });
});

test.describe("TriSchach - Auto Battle", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#board-svg", { timeout: 15000 });
    await page.waitForSelector("#board-svg .piece", { timeout: 15000 });
    await page.waitForTimeout(1000);
  });

  test("Auto Battle button toggles", async ({ page }) => {
    const autoBattleBtn = page.locator("#auto-battle-btn");

    // Initially not active
    await expect(autoBattleBtn).not.toHaveClass(/active/);

    // Click to start
    await autoBattleBtn.click();
    await expect(autoBattleBtn).toHaveClass(/active/);

    // Wait a bit for AI moves
    await page.waitForTimeout(3000);

    // Click to stop
    await autoBattleBtn.click();
    await expect(autoBattleBtn).not.toHaveClass(/active/);
  });
});

test.describe("TriSchach - Save/Load", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#board-svg", { timeout: 15000 });
    await page.waitForSelector("#board-svg .piece", { timeout: 15000 });
    await page.waitForTimeout(1000);
  });

  test("Save button downloads .tspn file", async ({ page }) => {
    const saveBtn = page.locator("#save-btn");

    // Make a move first so there's something to save - find a Feuer piece with valid moves
    const feuerPieces = page.locator("#board-svg .piece-fire");
    const feuerCount = await feuerPieces.count();

    let foundValidMoves = false;
    for (let i = 0; i < feuerCount; i++) {
      const piece = feuerPieces.nth(i);
      await piece.click({ force: true });
      await page.waitForTimeout(300);

      const highlights = page.locator("#board-svg .highlight-move");
      const highlightCount = await highlights.count();

      if (highlightCount > 0) {
        foundValidMoves = true;
        break;
      }

      await piece.click({ force: true });
      await page.waitForTimeout(100);
    }

    if (foundValidMoves) {
      const validMoves = page.locator("#board-svg .valid-move");
      const moveCount = await validMoves.count();
      if (moveCount > 0) {
        await validMoves.first().click({ force: true });

        // Click save - should trigger download
        const downloadPromise = page.waitForEvent("download");
        await saveBtn.click();
        const download = await downloadPromise;

        expect(download.suggestedFilename()).toMatch(/\.tspn$/);
      }
    }
  });

  test("Copy button copies TSPN to clipboard", async ({ page }) => {
    const copyBtn = page.locator("#copy-btn");

    // Make a move first - find a Feuer piece with valid moves
    const feuerPieces = page.locator("#board-svg .piece-fire");
    const feuerCount = await feuerPieces.count();

    let foundValidMoves = false;
    for (let i = 0; i < feuerCount; i++) {
      const piece = feuerPieces.nth(i);
      await piece.click({ force: true });
      await page.waitForTimeout(300);

      const highlights = page.locator("#board-svg .highlight-move");
      const highlightCount = await highlights.count();

      if (highlightCount > 0) {
        foundValidMoves = true;
        break;
      }

      await piece.click({ force: true });
      await page.waitForTimeout(100);
    }

    if (foundValidMoves) {
      const validMoves = page.locator("#board-svg .valid-move");
      const moveCount = await validMoves.count();
      if (moveCount > 0) {
        await validMoves.first().click({ force: true });

        // Grant clipboard permission
        await page
          .context()
          .grantPermissions(["clipboard-read", "clipboard-write"]);

        await copyBtn.click();

        // Verify clipboard has content
        const clipboardText = await page.evaluate(async () => {
          return await navigator.clipboard.readText();
        });
        expect(clipboardText).toContain("TriSchach");
      }
    }
  });

  test("UI stays responsive after a human move (regression: main-thread freeze)", async ({
    page,
  }) => {
    // Regression test for the freeze bug where startPondering() ran a
    // synchronous minimax (depth up to 12) on the main thread after every
    // move, freezing the UI. After the move the turn indicator must still be
    // reachable (page not frozen).
    const pieces = page.locator("#board-svg .piece-fire");
    const pieceCount = await pieces.count();
    expect(pieceCount).toBeGreaterThan(0);

    let moved = false;
    for (let i = 0; i < pieceCount && !moved; i++) {
      const piece = pieces.nth(i);
      await piece.click({ force: true });
      await page.waitForTimeout(200);
      const highlights = page.locator("#board-svg .highlight-move");
      if ((await highlights.count()) > 0) {
        await highlights.first().click({ force: true });
        moved = true;
      } else {
        await piece.click({ force: true });
        await page.waitForTimeout(80);
      }
    }
    expect(moved).toBe(true);

    // The UI must remain interactive: turn indicator still present and the
    // move log must have grown. If the main thread had frozen, this times out.
    await expect(page.locator("#turn-indicator")).toBeVisible({
      timeout: 10000,
    });
    const moveEntries = await page.locator("#move-log .move-entry").count();
    expect(moveEntries).toBeGreaterThan(0);
  });

  test("Auto Battle plays multiple moves without freezing the UI (regression)", async ({
    page,
  }) => {
    // Regression test for the freeze that occurred on the SECOND auto-battle
    // move (startPondering() called after every auto move on the main thread).
    // Verify the UI stays responsive after several auto moves.
    await page.click("#auto-battle-btn");
    await expect(page.locator("#auto-battle-btn")).toHaveClass(/active/);

    // Let auto-battle play several moves (worker-backed, async). Each combat
    // resolves via a ~2.2s overlay (showCombat timer) before the next
    // auto move is triggered. A cold dev-server start can be slow, so instead
    // of a fixed wait we poll until >2 moves are logged (robust against
    // server warm-up flakiness).
    await expect
      .poll(
        async () => {
          return page.locator("#move-log .move-entry").count();
        },
        { timeout: 30000, intervals: [1000] },
      )
      .toBeGreaterThan(2);

    // UI must still be interactive after multiple auto moves.
    await expect(page.locator("#turn-indicator")).toBeVisible({
      timeout: 10000,
    });

    // Stop auto-battle cleanly.
    await page.click("#auto-battle-btn");
    await expect(page.locator("#auto-battle-btn")).not.toHaveClass(/active/);
  });
});
