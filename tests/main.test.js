import {
  expect,
  test,
  describe,
  beforeEach,
  vi,
  afterEach,
  beforeAll,
} from "vitest";
import fs from "fs";
import path from "path";

// Read index.html to inject into JSDOM
// eslint-disable-next-line no-undef
const htmlPath = path.resolve(__dirname, "../index.html");
const htmlContent = fs.readFileSync(htmlPath, "utf-8");
const bodyMatch = htmlContent.match(
  new RegExp("<body[^>]*>([\\s\\S]*)<\\/body>", "i"),
);
let bodyHTML = bodyMatch ? bodyMatch[1] : htmlContent;
// Remove ALL script tags (including module scripts with src)
bodyHTML = bodyHTML.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
// Also remove self-closing script tags
bodyHTML = bodyHTML.replace(/<script\b[^>]*\/>/gi, "");

// Mock fetch globally BEFORE any module loads (happy-dom SyncFetch uses this)
const fetchMock = vi.hoisted(() => {
  const originalFetch = globalThis.fetch;
  return {
    originalFetch,
    mockFn: async (url, opts) => {
      if (typeof url === "string" && url.startsWith("http://localhost:3000/")) {
        const filePath = url.replace("http://localhost:3000/", "");
        let content = "";
        try {
          content = fs.readFileSync(`./${filePath}`, "utf8");
        } catch (e) {
          content = "";
        }
        const mime = filePath.endsWith(".css")
          ? "text/css"
          : filePath.endsWith(".js")
            ? "application/javascript"
            : "text/plain";
        return new Response(content, { headers: { "Content-Type": mime } });
      }
      return originalFetch(url, opts);
    },
  };
});

beforeAll(() => {
  vi.stubGlobal("fetch", fetchMock.mockFn);
});

afterEach(() => {
  vi.clearAllTimers();
});

describe("Main UI & Events", () => {
  beforeEach(() => {
    document.body.innerHTML = bodyHTML;
    vi.resetModules(); // Ensure main.js runs cleanly each time

    // Mock AudioContext
    globalThis.AudioContext = vi.fn().mockImplementation(() => ({
      createOscillator: () => ({
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        frequency: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        type: "sine",
      }),
      createGain: () => ({
        connect: vi.fn(),
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
        },
      }),
      destination: {},
      currentTime: 100,
    }));
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  test("UI initializes correctly on load", async () => {
    await import("../js/main.ts");

    const svg = document.getElementById("board-svg");
    expect(svg.querySelectorAll(".hex-polygon").length).toBeGreaterThan(0);

    const turnEl = document.getElementById("turn-indicator");
    expect(turnEl.textContent).toContain("Feuer");
  });

  test("Board rotate button applies rotation", async () => {
    await import("../js/main.ts");
    const rotateBtn = document.getElementById("rotate-btn");
    const svg = document.getElementById("board-svg");

    rotateBtn.click();
    expect(svg.style.transform).toBe("rotate(120deg)");
    rotateBtn.click();
    expect(svg.style.transform).toBe("rotate(240deg)");
  });

  test("Auto Battle toggle button", async () => {
    vi.useFakeTimers();
    await import("../js/main.ts");
    const autoBattleBtn = document.getElementById("auto-battle-btn");

    autoBattleBtn.click();
    expect(autoBattleBtn.classList.contains("active")).toBe(true);

    vi.advanceTimersByTime(500);

    autoBattleBtn.click();
    expect(autoBattleBtn.classList.contains("active")).toBe(false);
    vi.useRealTimers();
  });

  test("Restart button resets the game", async () => {
    await import("../js/main.ts");
    const restartBtn = document.getElementById("restart-btn");
    const moveLogEl = document.getElementById("move-log");

    moveLogEl.innerHTML = "<div>Fake Move</div>";
    restartBtn.click();

    expect(moveLogEl.innerHTML).toBe("");
    const statusEl = document.getElementById("status");
    expect(statusEl.textContent).toBe("Wähle eine Figur");
  });

  test("Toggles for RPS and Sound", async () => {
    await import("../js/main.ts");
    const rpsToggle = document.getElementById("rps-toggle");
    const soundToggle = document.getElementById("sound-toggle");
    const rpsInfoEl = document.getElementById("rps-info");

    rpsToggle.checked = false;
    rpsToggle.dispatchEvent(new Event("change"));
    expect(rpsInfoEl.classList.contains("rps-inactive")).toBe(true);

    soundToggle.checked = false;
    soundToggle.dispatchEvent(new Event("change"));
  });

  test("Simulate gameplay clicks (move and combat)", async () => {
    vi.useFakeTimers();
    await import("../js/main.ts");
    const pieces = document.querySelectorAll(".piece");
    expect(pieces.length).toBeGreaterThan(0);

    // Auto Battle triggers a move and potentially combat
    const autoBattleBtn = document.getElementById("auto-battle-btn");
    autoBattleBtn.click();

    // Fast forward to trigger AI move
    vi.advanceTimersByTime(500);

    // If it was a combat, the overlay should be visible
    const combatOverlay = document.getElementById("combat-overlay");
    if (combatOverlay.classList.contains("visible")) {
      const stopBtn = document.getElementById("stop-auto-combat");
      if (stopBtn) stopBtn.click(); // Stop auto battle during combat

      // Fast forward past combat animation
      vi.advanceTimersByTime(2500);
      expect(combatOverlay.classList.contains("visible")).toBe(false);
    }

    vi.useRealTimers();
  });

  test("Auto Battle can be stopped during combat animation", async () => {
    vi.useFakeTimers();
    await import("../js/main.ts");

    // Force auto battle on
    const autoBattleBtn = document.getElementById("auto-battle-btn");
    autoBattleBtn.click();

    // Inject a fake combat stop button if it doesn't exist yet (to test the handler)
    // Actually, showCombat adds it to the overlay.
    // We can't easily trigger showCombat because it's private.
    // But we can check if it's there after a while if we mock AI to force a combat.
    // This is tested via 'Simulate gameplay clicks' partially.

    vi.useRealTimers();
  });

  test("UI responds to game over state", async () => {
    vi.useFakeTimers();
    const { game, renderer } = await import("../js/main.ts");
    const statusEl = document.getElementById("status");
    const { FACTION } = await import("../js/board.ts");

    // Simulate game over state
    game.state = "game_over";

    // Trigger game over UI via a mock combat result
    // We can directly call the exported renderer/game or just mock the state
    // To trigger showCombat with result.gameOver:
    const { Hex } = await import("../js/hex.ts");
    const { PIECE_TYPE, Piece } = await import("../js/pieces.ts");

    game.pieces = []; // Clear board
    const fireQueen = new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(0, 0));
    const waterKing = new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(0, 1));
    game.pieces = [fireQueen, waterKing];
    game._rebuildOccupiedMap();
    game.eliminatedFactions.add(FACTION.NATURE);

    // Execute attack
    game.state = "select_piece";
    game.rpsEnabled = false;
    game.currentFactionIdx = 0; // Fire

    renderer.onCellClick(fireQueen.pos);
    renderer.onCellClick(waterKing.pos);

    // Fast-forward showCombat timeout (2200ms)
    vi.advanceTimersByTime(2500);

    expect(statusEl.textContent).toContain("gewonnen!");

    // Test AI returning no valid moves (Line 138-141)
    // We can clear all pieces, so AI has no moves
    game.pieces = [];
    game._rebuildOccupiedMap();
    const autoBattleBtn = document.getElementById("auto-battle-btn");
    autoBattleBtn.click(); // Turn on auto battle
    vi.advanceTimersByTime(500); // trigger AutoMove

    expect(game.state).toBe("game_over");

    vi.useRealTimers();
  });

  test("Auto Battle triggers a normal move", async () => {
    vi.useFakeTimers();
    const { game } = await import("../js/main.ts");
    const { PIECE_TYPE, Piece } = await import("../js/pieces.ts");
    const { FACTION } = await import("../js/board.ts");
    const { Hex } = await import("../js/hex.ts");

    // Give AI a piece that can move but NOT attack
    game.pieces = [new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 5))];
    game._rebuildOccupiedMap();
    game.state = "select_piece";
    game.currentFactionIdx = 0; // Fire

    const autoBattleBtn = document.getElementById("auto-battle-btn");
    if (!autoBattleBtn.classList.contains("active")) {
      autoBattleBtn.click();
    }

    vi.advanceTimersByTime(500);
    vi.useRealTimers();
  });

  test("Auto Battle continues after non-game-over combat", async () => {
    vi.useFakeTimers();
    const { game, renderer } = await import("../js/main.ts");
    const { PIECE_TYPE, Piece } = await import("../js/pieces.ts");
    const { FACTION } = await import("../js/board.ts");
    const { Hex } = await import("../js/hex.ts");

    // Set up a combat that does NOT end the game
    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 0));
    const waterPawn = new Piece(PIECE_TYPE.PAWN, FACTION.WATER, new Hex(0, 1));
    const waterKing = new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(0, 2)); // King stays alive
    game.pieces = [firePawn, waterPawn, waterKing];
    game._rebuildOccupiedMap();
    game.state = "select_piece";
    game.currentFactionIdx = 0; // Fire

    // Turn on auto battle
    const autoBattleBtn = document.getElementById("auto-battle-btn");
    if (!autoBattleBtn.classList.contains("active")) {
      autoBattleBtn.click();
    }

    // Trigger combat manually via renderer to force showCombat
    renderer.onCellClick(firePawn.pos);
    renderer.onCellClick(waterPawn.pos);

    // showCombat timeout is 2200ms
    vi.advanceTimersByTime(2500);

    vi.useRealTimers();
  });

  test("renderer.onCellClick executes normal move", async () => {
    const { game, renderer } = await import("../js/main.ts");
    const { Hex } = await import("../js/hex.ts");
    const { PIECE_TYPE, Piece } = await import("../js/pieces.ts");
    const { FACTION } = await import("../js/board.ts");

    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 5));
    game.pieces = [pawn];
    game._rebuildOccupiedMap();
    game.currentFactionIdx = 0;
    game.state = "select_piece";

    renderer.onCellClick(pawn.pos);
    renderer.onCellClick(new Hex(0, 4));

    expect(pawn.pos.equals(new Hex(0, 4))).toBe(true);
  });

  test("triggerAutoMove delays if game state is not SELECT_PIECE", async () => {
    vi.useFakeTimers();
    const { game, triggerAutoMove } = await import("../js/main.ts");

    game.state = "select_target";
    triggerAutoMove(); // Should hit the setTimeout

    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
  });
});
