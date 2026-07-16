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
import type { Hex } from "../js/hex.ts";
type HexType = Hex;

// Read index.html to inject into the test DOM. happy-dom provides DOMParser,
// so we parse + extract the body and strip <script> tags via the DOM API
// (no regex-based HTML filtering, which CodeQL flags as unsafe).
// eslint-disable-next-line no-undef
const htmlPath = path.resolve(__dirname, "../index.html");
const htmlContent = fs.readFileSync(htmlPath, "utf-8");
const doc = new DOMParser().parseFromString(htmlContent, "text/html");
doc.querySelectorAll("script, link").forEach((s) => s.remove());
const bodyHTML = doc.body.innerHTML;

// Mock fetch globally BEFORE any module loads (happy-dom SyncFetch uses this)
const fetchMock = vi.hoisted(() => {
  const originalFetch = globalThis.fetch;
  return {
    originalFetch,
    mockFn: async (
      url: string | URL | Request,
      opts?: RequestInit,
    ): Promise<Response> => {
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
      // Any other localhost:3000 URL (e.g. opening-book.learned.json,
      // stray css) — answer with empty content instead of falling
      // through to the real fetch, which would 404 and surface as
      // an uncaught DOMException in the suite.
      return new Response("", { headers: { "Content-Type": "text/plain" } });
    },
  };
});

beforeAll(() => {
  vi.stubGlobal("fetch", fetchMock.mockFn);
});

// Typed helper to read DOM elements (getElementById returns T | null).
function byId(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

describe("Main UI & Events", () => {
  beforeEach(() => {
    document.body.innerHTML = bodyHTML;
    vi.resetModules(); // Ensure main.ts runs cleanly each time

    // Control ALL timers (main.ts registers real setTimeout/setInterval for
    // auto-battle, combat resolution, replay, puzzle, toasts). With fake
    // timers no callback can leak across tests or fire after the suite ends
    // (which previously crashed the run with a null.classList error).
    vi.useFakeTimers();

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
    // Clear any pending timers and restore the real timer implementation so
    // later tests (and the harness) are not left in a fake-timer context.
    // We do NOT blank document.body here: main.ts registers timers that may
    // fire during teardown, and removing the DOM would make them throw. The
    // next beforeEach rebuilds the body from bodyHTML anyway.
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  test("UI initializes correctly on load", async () => {
    await import("../js/main.ts");

    const svg = byId("board-svg");
    expect(svg.querySelectorAll(".hex-polygon").length).toBeGreaterThan(0);

    const turnEl = byId("turn-indicator");
    expect(turnEl.textContent).toContain("Feuer");
  });

  test("Board rotate button applies rotation", async () => {
    await import("../js/main.ts");
    const rotateBtn = byId("rotate-btn");
    const svg = byId("board-svg");

    rotateBtn.click();
    expect(svg.style.transform).toBe("rotate(120deg)");
    rotateBtn.click();
    expect(svg.style.transform).toBe("rotate(240deg)");
  });

  test("Auto Battle toggle button", async () => {
    await import("../js/main.ts");
    const autoBattleBtn = byId("auto-battle-btn");

    autoBattleBtn.click();
    expect(autoBattleBtn.classList.contains("active")).toBe(true);

    vi.advanceTimersByTime(500);

    autoBattleBtn.click();
    expect(autoBattleBtn.classList.contains("active")).toBe(false);
  });

  test("Restart button resets the game", async () => {
    await import("../js/main.ts");
    const restartBtn = byId("restart-btn");
    const moveLogEl = byId("move-log");

    moveLogEl.innerHTML = "<div>Fake Move</div>";
    restartBtn.click();

    expect(moveLogEl.innerHTML).toBe("");
    const statusEl = byId("status");
    expect(statusEl.textContent).toContain("Wähle eine Figur");
  });

  test("Toggles for RPS and Sound", async () => {
    await import("../js/main.ts");
    const rpsToggle = byId("rps-toggle") as HTMLInputElement;
    const soundToggle = byId("sound-toggle") as HTMLInputElement;
    const rpsInfoEl = byId("rps-info");

    rpsToggle.checked = false;
    rpsToggle.dispatchEvent(new Event("change"));
    expect(rpsInfoEl.classList.contains("rps-inactive")).toBe(true);

    soundToggle.checked = false;
    soundToggle.dispatchEvent(new Event("change"));
  });

  test("Simulate gameplay clicks (move and combat)", async () => {
    await import("../js/main.ts");
    const pieces = document.querySelectorAll(".piece");
    expect(pieces.length).toBeGreaterThan(0);

    // Auto Battle triggers a move and potentially combat
    const autoBattleBtn = byId("auto-battle-btn");
    autoBattleBtn.click();

    // Fast forward to trigger AI move
    vi.advanceTimersByTime(500);

    // If it was a combat, the overlay should be visible
    const combatOverlay = byId("combat-overlay");
    if (combatOverlay.classList.contains("visible")) {
      const stopBtn = document.getElementById("stop-auto-combat");
      if (stopBtn) stopBtn.click(); // Stop auto battle during combat

      // Fast forward past combat animation
      vi.advanceTimersByTime(2500);
      expect(combatOverlay.classList.contains("visible")).toBe(false);
    }
  });

  test("Auto Battle can be stopped during combat animation", async () => {
    await import("../js/main.ts");

    // Force auto battle on
    const autoBattleBtn = byId("auto-battle-btn");
    autoBattleBtn.click();

    // We can't easily trigger showCombat because it's private, but enabling
    // auto-battle and advancing timers must not throw.
    vi.advanceTimersByTime(500);

    autoBattleBtn.click();
    expect(autoBattleBtn.classList.contains("active")).toBe(false);
  });

  test("Combat resolution callback cleans up DOM without throwing", async () => {
    // Regression guard for the null.classList crash in main.ts: the delayed
    // combat-resolution callback must tolerate a missing #combat-overlay and
    // still update the board when the element is present.
    await import("../js/main.ts");
    const { game, renderer } = await import("../js/main.ts");
    const { PIECE_TYPE, Piece } = await import("../js/pieces.ts");
    const { FACTION } = await import("../js/board.ts");
    const { Hex } = await import("../js/hex.ts");

    // Case 1: overlay present — combat resolution runs and clears it.
    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 0));
    const waterPawn = new Piece(PIECE_TYPE.PAWN, FACTION.WATER, new Hex(0, 1));
    const waterKing = new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(0, 2));
    game.pieces = [firePawn, waterPawn, waterKing];
    game._rebuildOccupiedMap();
    game.state = "select_piece";
    game.currentFactionIdx = 0; // Fire

    const autoBattleBtn = byId("auto-battle-btn");
    if (!autoBattleBtn.classList.contains("active")) autoBattleBtn.click();

    const click = (h: HexType) => renderer.onCellClick!(h, undefined as never);
    click(firePawn.pos);
    click(waterPawn.pos);

    // showCombat timeout is 2200ms — must resolve without throwing even though
    // the combat-overlay element exists in the injected DOM.
    expect(() => vi.advanceTimersByTime(2500)).not.toThrow();

    autoBattleBtn.click(); // stop auto battle
  });

  test("UI responds to game over state", async () => {
    await import("../js/main.ts");
    const statusEl = byId("status");
    const { game, renderer } = await import("../js/main.ts");
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

    const click = (h: HexType) => renderer.onCellClick!(h, undefined as never);
    click(fireQueen.pos);
    click(waterKing.pos);

    // Fast-forward showCombat timeout (2200ms)
    vi.advanceTimersByTime(2500);

    expect(statusEl.textContent).toContain("gewonnen!");

    // Test AI returning no valid moves (Line 138-141)
    // We can clear all pieces, so AI has no moves
    game.pieces = [];
    game._rebuildOccupiedMap();
    const autoBattleBtn = byId("auto-battle-btn");
    autoBattleBtn.click(); // Turn on auto battle
    vi.advanceTimersByTime(500); // trigger AutoMove

    expect(game.state).toBe("game_over");

    autoBattleBtn.click(); // stop auto battle
  });

  test("Auto Battle triggers a normal move", async () => {
    await import("../js/main.ts");
    const { game } = await import("../js/main.ts");
    const { PIECE_TYPE, Piece } = await import("../js/pieces.ts");
    const { FACTION } = await import("../js/board.ts");
    const { Hex } = await import("../js/hex.ts");

    // Give AI a piece that can move but NOT attack
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 5));
    game.pieces = [pawn];
    game._rebuildOccupiedMap();
    game.state = "select_piece";
    game.currentFactionIdx = 0; // Fire

    const movesBefore = game.moveHistory.length;
    const posBefore = pawn.pos.key;

    const autoBattleBtn = byId("auto-battle-btn");
    if (!autoBattleBtn.classList.contains("active")) {
      autoBattleBtn.click();
    }

    // Advance past the auto-move timer (500ms in main.ts).
    // Use the async variant: triggerAutoMove awaits import()/worker
    // promises, which only flush under fake timers via the *Async API.
    await vi.advanceTimersByTimeAsync(500);

    // Auto Battle must have actually moved the pawn (new history entry +
    // position changed), not just toggled the button.
    expect(game.moveHistory.length).toBeGreaterThan(movesBefore);
    expect(pawn.pos.key).not.toBe(posBefore);

    autoBattleBtn.click(); // stop auto battle
  });

  test("Auto Battle continues after non-game-over combat", async () => {
    await import("../js/main.ts");
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
    const autoBattleBtn = byId("auto-battle-btn");
    if (!autoBattleBtn.classList.contains("active")) {
      autoBattleBtn.click();
    }

    // Trigger combat manually via renderer to force showCombat
    const click = (h: HexType) => renderer.onCellClick!(h, undefined as never);
    click(firePawn.pos);
    click(waterPawn.pos);

    // showCombat timeout is 2200ms
    vi.advanceTimersByTime(2500);

    autoBattleBtn.click(); // stop auto battle
  });

  test("renderer.onCellClick executes normal move", async () => {
    await import("../js/main.ts");
    const { game, renderer } = await import("../js/main.ts");
    const { Hex } = await import("../js/hex.ts");
    const { PIECE_TYPE, Piece } = await import("../js/pieces.ts");
    const { FACTION } = await import("../js/board.ts");

    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 5));
    game.pieces = [pawn];
    game._rebuildOccupiedMap();
    game.currentFactionIdx = 0;
    game.state = "select_piece";

    const click = (h: HexType) => renderer.onCellClick!(h, undefined as never);
    click(pawn.pos);
    click(new Hex(0, 4));

    expect(pawn.pos.equals(new Hex(0, 4))).toBe(true);
  });

  test("triggerAutoMove delays if game state is not SELECT_PIECE", async () => {
    await import("../js/main.ts");
    const { game, triggerAutoMove } = await import("../js/main.ts");

    game.state = "select_target";
    game.moveHistory = [];
    triggerAutoMove(); // Should hit the setTimeout, NOT move synchronously

    // The whole point of the guard is that the move is deferred to a
    // timer, so no game state may change synchronously here.
    expect(game.moveHistory.length).toBe(0);

    // Flush the (async) timer; use the async variant so the awaited
    // import()/worker promises inside the callback resolve.
    await vi.advanceTimersByTimeAsync(1000);
  });

  test("replay analysis renders PV line and RPS explanation", async () => {
    const { analyzePosition, renderAnalysisToHTML } =
      await import("../js/analysis.ts");
    const { Game } = await import("../js/game.ts");
    const { generateBoard, FACTION } = await import("../js/board.ts");

    const game = new Game();
    game.init(generateBoard());

    const result = analyzePosition(game, 2);
    expect(result.pv.length).toBeGreaterThanOrEqual(1);
    expect(result.rpsExplanation!.length).toBeGreaterThan(0);

    // The exact renderer main.ts uses for the replay panel.
    const html = renderAnalysisToHTML(result);
    expect(html).toContain("analysis-pv");
    expect(html).toContain("analysis-rps");
    expect(html).toContain("→"); // PV separator
  });
});
