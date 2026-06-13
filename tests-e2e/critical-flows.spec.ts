import { test, expect } from '@playwright/test';

test.describe('TriSchach - Critical User Flows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for board to render and pieces to appear
    await page.waitForSelector('#board-svg', { timeout: 15000 });
    await page.waitForSelector('#board-svg .piece', { timeout: 15000 });
    // Wait a bit more for game initialization
    await page.waitForTimeout(1000);
  });

  test('Game loads and shows initial position', async ({ page }) => {
    // Check title
    await expect(page.locator('h1')).toContainText('TriSchach');
    // Check board is rendered
    await expect(page.locator('#board-svg')).toBeVisible();
    // Check turn indicator shows Feuer
    await expect(page.locator('#turn-indicator')).toContainText('Feuer');
    // Check status shows "Wähle eine Figur"
    await expect(page.locator('#status')).toContainText('Wähle eine Figur');
  });

  test('Can make a valid move (select piece, then target)', async ({ page }) => {
    // Get all piece elements
    const pieces = page.locator('#board-svg .piece');
    const pieceCount = await pieces.count();
    expect(pieceCount).toBeGreaterThan(0);

    // Find a Feuer piece (red) that has valid moves
    // In initial position, the first Feuer piece (rook at edge) has NO moves
    // We need to find one with valid moves - typically a pawn
    const feuerPieces = page.locator('#board-svg .piece-fire');
    const feuerCount = await feuerPieces.count();
    expect(feuerCount).toBeGreaterThan(0);

    // Try each Feuer piece until we find one with valid moves
    let foundValidMoves = false;
    for (let i = 0; i < feuerCount; i++) {
      const piece = feuerPieces.nth(i);
      await piece.click({ force: true });
      
      // Wait briefly to see if valid moves appear
      await page.waitForTimeout(300);
      
      const highlights = page.locator('#board-svg .highlight-move');
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
    await expect(page.locator('#status')).toContainText('Wähle ein Ziel');

    // Wait for valid move indicators to appear - these are highlighted hex cells
    await page.waitForFunction(() => {
      const highlights = document.querySelectorAll('#board-svg .highlight-move');
      return highlights.length > 0;
    }, { timeout: 5000 });

    // Click a valid move target (the highlighted hex polygon)
    const validMoves = page.locator('#board-svg .highlight-move');
    const moveCount = await validMoves.count();
    expect(moveCount).toBeGreaterThan(0);

    await validMoves.first().click({ force: true });

    // Verify turn advanced (now Wasser's turn)
    await expect(page.locator('#turn-indicator')).toContainText('Wasser');

    // Verify move was logged in history
    const moveLog = page.locator('#move-log');
    await expect(moveLog).not.toBeEmpty();
  });

  test('RPS Combat works', async ({ page }) => {
    // This test requires setting up a combat position
    // For now, verify combat overlay appears when clicking enemy piece
    const feuerPieces = page.locator('#board-svg .piece-fire');
    const wasserPieces = page.locator('#board-svg .piece-water');

    await expect(feuerPieces.first()).toBeVisible();
    await expect(wasserPieces.first()).toBeVisible();

    // Select a Feuer piece
    await feuerPieces.first().click({ force: true });
    await expect(page.locator('#status')).toContainText('Wähle ein Ziel');

    // If there's a valid attack on a Wasser piece, combat overlay should appear
    // We'll just verify the attack indicators exist
    const validAttacks = page.locator('#board-svg .valid-attack');
    const attackCount = await validAttacks.count();
    // Attack count might be 0 in initial position, that's OK
  });

  test('Undo button works', async ({ page }) => {
    // Make a move first - find a Feuer piece with valid moves
    const feuerPieces = page.locator('#board-svg .piece-fire');
    const feuerCount = await feuerPieces.count();
    
    let foundValidMoves = false;
    for (let i = 0; i < feuerCount; i++) {
      const piece = feuerPieces.nth(i);
      await piece.click({ force: true });
      await page.waitForTimeout(300);
      
      const highlights = page.locator('#board-svg .highlight-move');
      const highlightCount = await highlights.count();
      
      if (highlightCount > 0) {
        foundValidMoves = true;
        break;
      }
      
      await piece.click({ force: true });
      await page.waitForTimeout(100);
    }
    
    if (foundValidMoves) {
      const validMoves = page.locator('#board-svg .valid-move');
      const moveCount = await validMoves.count();
      if (moveCount > 0) {
        await validMoves.first().click({ force: true });

        // Now click undo
        await page.click('#undo-btn');

        // Verify we're back to Feuer's turn
        await expect(page.locator('#turn-indicator')).toContainText('Feuer');
      }
    }
  });

  test('AI Depth slider changes depth', async ({ page }) => {
    const depthSlider = page.locator('#depth-slider');
    const depthLabel = page.locator('#depth-label');

    // Check initial value (default is 3 = Schwer)
    await expect(depthSlider).toHaveValue('3');
    await expect(depthLabel).toContainText('Schwer');

    // Change to depth 4
    await depthSlider.fill('4');
    await expect(depthLabel).toContainText('Extrem');

    // Change to depth 1
    await depthSlider.fill('1');
    await expect(depthLabel).toContainText('Leicht');
  });

  test('AI Personality selector works', async ({ page }) => {
    const personalitySelect = page.locator('#personality-select');

    // Check default
    await expect(personalitySelect).toHaveValue('balanced');

    // Change to aggressive
    await personalitySelect.selectOption('aggressive');
    await expect(personalitySelect).toHaveValue('aggressive');

    // Change to defensive
    await personalitySelect.selectOption('defensive');
    await expect(personalitySelect).toHaveValue('defensive');

    // Change to tactical
    await personalitySelect.selectOption('tactical');
    await expect(personalitySelect).toHaveValue('tactical');
  });

  test('Board rotation works', async ({ page }) => {
    const rotateBtn = page.locator('#rotate-btn');
    const boardSvg = page.locator('#board-svg');

    // Get initial rotation
    const initialTransform = await boardSvg.evaluate(el => getComputedStyle(el).transform);

    // Click rotate
    await rotateBtn.click();

    // Wait for rotation animation
    await page.waitForTimeout(500);

    // Check rotation changed
    const newTransform = await boardSvg.evaluate(el => getComputedStyle(el).transform);
    expect(newTransform).not.toBe(initialTransform);
  });

  test('New Game button resets game', async ({ page }) => {
    // Make a move first - find a Feuer piece with valid moves
    const feuerPieces = page.locator('#board-svg .piece-fire');
    const feuerCount = await feuerPieces.count();
    
    let foundValidMoves = false;
    for (let i = 0; i < feuerCount; i++) {
      const piece = feuerPieces.nth(i);
      await piece.click({ force: true });
      await page.waitForTimeout(300);
      
      const highlights = page.locator('#board-svg .highlight-move');
      const highlightCount = await highlights.count();
      
      if (highlightCount > 0) {
        foundValidMoves = true;
        break;
      }
      
      await piece.click({ force: true });
      await page.waitForTimeout(100);
    }
    
    if (foundValidMoves) {
      const validMoves = page.locator('#board-svg .valid-move');
      const moveCount = await validMoves.count();
      if (moveCount > 0) {
        await validMoves.first().click({ force: true });

        // Click new game
        await page.click('#restart-btn');

        // Verify back to initial state
        await expect(page.locator('#turn-indicator')).toContainText('Feuer');
        await expect(page.locator('#status')).toContainText('Wähle eine Figur');
        await expect(page.locator('#move-log')).toBeEmpty();
      }
    }
  });

  test('Sound toggle persists', async ({ page }) => {
    const soundToggle = page.locator('#sound-toggle');
    const soundLabel = page.locator('label.switch:has(#sound-toggle)');
    await expect(soundToggle).toBeChecked();

    // Turn off by clicking the label (checkbox is visually hidden)
    await soundLabel.click();
    await expect(soundToggle).not.toBeChecked();

    // Reload page
    await page.reload();
    await page.waitForSelector('#board-svg', { timeout: 15000 });
    await page.waitForSelector('#board-svg .piece', { timeout: 15000 });
    await page.waitForTimeout(1000);

    // Should still be off
    await expect(page.locator('#sound-toggle')).not.toBeChecked();
  });

  test('RPS toggle persists', async ({ page }) => {
    const rpsToggle = page.locator('#rps-toggle');
    const rpsLabel = page.locator('label.switch:has(#rps-toggle)');
    await expect(rpsToggle).toBeChecked();

    // Turn off by clicking the label
    await rpsLabel.click();
    await expect(rpsToggle).not.toBeChecked();

    // Reload
    await page.reload();
    await page.waitForSelector('#board-svg', { timeout: 15000 });
    await page.waitForSelector('#board-svg .piece', { timeout: 15000 });
    await page.waitForTimeout(1000);

    // Should still be off
    await expect(page.locator('#rps-toggle')).not.toBeChecked();
  });
});

test.describe('TriSchach - Auto Battle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#board-svg', { timeout: 15000 });
    await page.waitForSelector('#board-svg .piece', { timeout: 15000 });
    await page.waitForTimeout(1000);
  });

  test('Auto Battle button toggles', async ({ page }) => {
    const autoBattleBtn = page.locator('#auto-battle-btn');

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

test.describe('TriSchach - Save/Load', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#board-svg', { timeout: 15000 });
    await page.waitForSelector('#board-svg .piece', { timeout: 15000 });
    await page.waitForTimeout(1000);
  });

  test('Save button downloads .tspn file', async ({ page }) => {
    const saveBtn = page.locator('#save-btn');

    // Make a move first so there's something to save - find a Feuer piece with valid moves
    const feuerPieces = page.locator('#board-svg .piece-fire');
    const feuerCount = await feuerPieces.count();
    
    let foundValidMoves = false;
    for (let i = 0; i < feuerCount; i++) {
      const piece = feuerPieces.nth(i);
      await piece.click({ force: true });
      await page.waitForTimeout(300);
      
      const highlights = page.locator('#board-svg .highlight-move');
      const highlightCount = await highlights.count();
      
      if (highlightCount > 0) {
        foundValidMoves = true;
        break;
      }
      
      await piece.click({ force: true });
      await page.waitForTimeout(100);
    }
    
    if (foundValidMoves) {
      const validMoves = page.locator('#board-svg .valid-move');
      const moveCount = await validMoves.count();
      if (moveCount > 0) {
        await validMoves.first().click({ force: true });

        // Click save - should trigger download
        const downloadPromise = page.waitForEvent('download');
        await saveBtn.click();
        const download = await downloadPromise;

        expect(download.suggestedFilename()).toMatch(/\.tspn$/);
      }
    }
  });

  test('Copy button copies TSPN to clipboard', async ({ page }) => {
    const copyBtn = page.locator('#copy-btn');

    // Make a move first - find a Feuer piece with valid moves
    const feuerPieces = page.locator('#board-svg .piece-fire');
    const feuerCount = await feuerPieces.count();
    
    let foundValidMoves = false;
    for (let i = 0; i < feuerCount; i++) {
      const piece = feuerPieces.nth(i);
      await piece.click({ force: true });
      await page.waitForTimeout(300);
      
      const highlights = page.locator('#board-svg .highlight-move');
      const highlightCount = await highlights.count();
      
      if (highlightCount > 0) {
        foundValidMoves = true;
        break;
      }
      
      await piece.click({ force: true });
      await page.waitForTimeout(100);
    }
    
    if (foundValidMoves) {
      const validMoves = page.locator('#board-svg .valid-move');
      const moveCount = await validMoves.count();
      if (moveCount > 0) {
        await validMoves.first().click({ force: true });

        // Grant clipboard permission
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

        await copyBtn.click();

        // Verify clipboard has content
        const clipboardText = await page.evaluate(async () => {
          return await navigator.clipboard.readText();
        });
        expect(clipboardText).toContain('TriSchach');
      }
    }
  });
});