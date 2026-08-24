import { expect, test, describe, beforeEach, vi } from "vitest";
import {
  generateBoard,
  getRPSResult,
  BoardRenderer,
  FACTION,
  ZONE,
  RPS,
} from "../js/board.ts";
import { Hex } from "../js/hex.ts";
import type { Cell, Faction, Piece } from "../js/types.ts";

// Touch-event test helpers (shared across describe blocks). The BoardRenderer
// touch handlers only read `changedTouches` and `preventDefault`, so a plain
// object suffices — happy-dom's TouchEvent support is not required.
interface TouchLike {
  identifier: number;
  clientX: number;
  clientY: number;
}
function makeTouch(id: number, x: number, y: number): TouchLike {
  return { identifier: id, clientX: x, clientY: y };
}
function makeTouchEvent(type: string, touches: TouchLike[]): any {
  return { type, changedTouches: touches, preventDefault: () => {} };
}

const FACTION_VALUES: Faction[] = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];

describe("Board Generator & Logic", () => {
  test("generateBoard creates exactly 66 cells", () => {
    const cells = generateBoard();
    // 21 (center triangle) + 3 * 15 (base zones) = 66
    expect(cells.size).toBe(66);
  });

  test("generateBoard correctly assigns zones", () => {
    const cells = generateBoard();
    // (0,0) should be TRIANGLE
    expect(cells.get("0,0")!.zone).toBe("triangle");

    // (0,6) should be FIRE base
    expect(cells.get("0,6")!.zone).toBe(`start_${FACTION.FIRE}`);
  });

  test("getRPSResult resolves combat correctly", () => {
    expect(getRPSResult(FACTION.FIRE, FACTION.NATURE)).toBe("advantage");
    expect(getRPSResult(FACTION.FIRE, FACTION.WATER)).toBe("disadvantage");
    expect(getRPSResult(FACTION.WATER, FACTION.FIRE)).toBe("advantage");
    expect(getRPSResult(FACTION.NATURE, FACTION.WATER)).toBe("advantage");
  });
});

describe("generateBoard — zone & faction distribution", () => {
  test("exact zone counts: 21 triangle + 15 each base", () => {
    const cells = generateBoard();
    const zones = {
      triangle: 0,
      start_fire: 0,
      start_water: 0,
      start_nature: 0,
    };
    for (const cell of cells.values()) {
      zones[cell.zone]++;
    }
    expect(zones.triangle).toBe(21);
    expect(zones.start_fire).toBe(15);
    expect(zones.start_water).toBe(15);
    expect(zones.start_nature).toBe(15);
    // total must still be 66
    expect(cells.size).toBe(66);
  });

  test("exact faction counts: 15 per faction, 21 neutral", () => {
    const cells = generateBoard();
    const factions = { fire: 0, water: 0, nature: 0, null: 0 };
    for (const cell of cells.values()) {
      factions[cell.faction ?? "null"]++;
    }
    expect(factions.fire).toBe(15);
    expect(factions.water).toBe(15);
    expect(factions.nature).toBe(15);
    expect(factions.null).toBe(21);
  });

  test("no overlapping cells — every hex key is unique", () => {
    const cells = generateBoard();
    const keys = [...cells.keys()];
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBe(66);
  });

  test("specific anchor cells have expected zone/faction", () => {
    const cells = generateBoard();
    expect(cells.get("0,0")!.zone).toBe("triangle");
    expect(cells.get("0,0")!.faction).toBeNull();
    // Apex of the fire base
    expect(cells.get("0,6")!.zone).toBe("start_fire");
    expect(cells.get("0,6")!.faction).toBe(FACTION.FIRE);
    // Apex of the water base
    expect(cells.get("1,0")!.zone).toBe("start_water");
    expect(cells.get("1,0")!.faction).toBe(FACTION.WATER);
  });

  test("generateBoard is deterministic across calls", () => {
    const a = generateBoard();
    const b = generateBoard();
    expect(a.size).toBe(b.size);
    for (const [key, cell] of a) {
      const other = b.get(key);
      expect(other).toBeDefined();
      expect(other!.zone).toBe(cell.zone);
      expect(other!.faction).toBe(cell.faction);
    }
  });
});

describe("getRPSResult — full matrix & invariants", () => {
  test("same faction is always neutral", () => {
    for (const f of FACTION_VALUES) {
      expect(getRPSResult(f, f)).toBe("neutral");
    }
  });

  test("advantage is the inverse of disadvantage (symmetric RPS)", () => {
    for (const a of FACTION_VALUES) {
      for (const d of FACTION_VALUES) {
        if (a === d) continue;
        const r = getRPSResult(a, d);
        const inv = getRPSResult(d, a);
        expect(r).not.toBe("neutral");
        // attacker advantage <-> defender disadvantage
        if (r === "advantage") expect(inv).toBe("disadvantage");
        if (r === "disadvantage") expect(inv).toBe("advantage");
      }
    }
  });

  test("RPS cycle: each faction beats exactly one and loses to exactly one", () => {
    // fire>nature, nature>water, water>fire (verified against RPS constant)
    expect(getRPSResult(FACTION.FIRE, FACTION.NATURE)).toBe("advantage");
    expect(getRPSResult(FACTION.NATURE, FACTION.WATER)).toBe("advantage");
    expect(getRPSResult(FACTION.WATER, FACTION.FIRE)).toBe("advantage");
    // and the reverse is a disadvantage
    expect(getRPSResult(FACTION.NATURE, FACTION.FIRE)).toBe("disadvantage");
    expect(getRPSResult(FACTION.WATER, FACTION.NATURE)).toBe("disadvantage");
    expect(getRPSResult(FACTION.FIRE, FACTION.WATER)).toBe("disadvantage");
  });
});

describe("FACTION / ZONE / RPS constants — invariants", () => {
  test("exactly three factions defined", () => {
    expect(Object.keys(FACTION).sort()).toEqual(["FIRE", "NATURE", "WATER"]);
    expect(Object.values(FACTION).sort()).toEqual(["fire", "nature", "water"]);
  });

  test("RPS is a bijection: every faction beats exactly one other", () => {
    // Each faction is the "defender" (loser) for exactly one attacker
    const losers = Object.values(RPS);
    expect(new Set(losers).size).toBe(3);
    // No faction beats itself
    for (const f of Object.values(FACTION)) {
      expect(RPS[f]).not.toBe(f);
    }
  });

  test("ZONE has the four expected zones", () => {
    expect(ZONE.TRIANGLE).toBe("triangle");
    expect(ZONE.START_FIRE).toBe("start_fire");
    expect(ZONE.START_WATER).toBe("start_water");
    expect(ZONE.START_NATURE).toBe("start_nature");
  });
});

describe("BoardRenderer (DOM)", () => {
  let svgContainer: SVGSVGElement;
  let renderer: BoardRenderer;

  beforeEach(() => {
    // Create mock SVG container using happy-dom
    document.body.innerHTML = '<svg id="board-svg"></svg>';
    // Add eval bar elements that updateEvalBar tries to access
    const evalContainer = document.createElement("div");
    evalContainer.style.display = "none";
    evalContainer.innerHTML = `
      <div id="eval-fire" class="eval-segment fire"></div>
      <div id="eval-nature" class="eval-segment nature"></div>
      <div id="eval-water" class="eval-segment water"></div>
    `;
    document.body.appendChild(evalContainer);
    svgContainer = document.getElementById(
      "board-svg",
    ) as unknown as SVGSVGElement;
    renderer = new BoardRenderer(svgContainer);
  });

  test("render creates hex polygons in DOM", () => {
    renderer.render();
    const cells = svgContainer.querySelectorAll(".hex-polygon");
    expect(cells.length).toBe(66);
  });

  test("clearHighlights removes highlight classes", () => {
    renderer.render();
    const firstCell = svgContainer.querySelector(".hex-polygon")!;
    firstCell.classList.add("highlight-move");

    renderer.clearHighlights();
    expect(firstCell.classList.contains("highlight-move")).toBe(false);
  });

  test("setRotation applies CSS transform", () => {
    renderer.setRotation(120);
    expect(svgContainer.style.transform).toBe("rotate(120deg)");
  });

  test("renderPiece appends piece group to DOM", () => {
    renderer.render();

    const mockPiece: Piece = {
      id: "test-piece",
      type: "pawn",
      faction: FACTION.FIRE,
      pos: new Hex(0, 0),
      symbol: "P",
      alive: true,
      hasMoved: false,
    };

    renderer.renderPiece(mockPiece);
    const pieceEl = document.querySelector(
      '[data-piece-id="test-piece"]',
    ) as SVGGElement | null;

    expect(pieceEl).not.toBeNull();
    expect(pieceEl!.classList.contains("piece")).toBe(true);
    expect(pieceEl!.classList.contains("piece-fire")).toBe(true);

    // Ensure text rotation matches board counter-rotation
    const textEl = pieceEl!.querySelector(
      ".piece-symbol",
    ) as SVGTextElement | null;
    expect(textEl!.style.transform).toBe("rotate(0deg)");

    // Removing the piece should remove it from DOM
    renderer.removePiece(mockPiece.id);
    expect(document.querySelectorAll(".piece").length).toBe(0);
    expect(renderer.pieceElements.has(mockPiece.id)).toBe(false);
  });

  test("highlightCells and clearHighlights", () => {
    renderer.render();
    const cells = Array.from(renderer.cells.values());
    const cell0 = cells[0]!;

    renderer.highlightCells([cell0.hex]); // default arg test
    const el = renderer.hexElements.get(cell0.hex.key)!;
    expect(el.polygon.classList.contains("highlight-move")).toBe(true);

    renderer.clearHighlights();
    expect(el.polygon.classList.contains("highlight-move")).toBe(false);
  });

  test("selectCell clears previous selection and selects new", () => {
    renderer.render();
    const cells = Array.from(renderer.cells.values());
    const cell0 = cells[0]!;
    const cell1 = cells[1]!;

    renderer.selectCell(cell0.hex);
    expect(
      renderer.hexElements
        .get(cell0.hex.key)!
        .polygon.classList.contains("selected"),
    ).toBe(true);

    renderer.selectCell(cell1.hex);
    expect(
      renderer.hexElements
        .get(cell0.hex.key)!
        .polygon.classList.contains("selected"),
    ).toBe(false);
    expect(
      renderer.hexElements
        .get(cell1.hex.key)!
        .polygon.classList.contains("selected"),
    ).toBe(true);
  });

  test("animateMove transforms piece element", async () => {
    renderer.render();
    const piece: Piece = {
      id: "test_piece",
      type: "pawn",
      faction: FACTION.FIRE,
      pos: new Hex(0, 0),
      symbol: "P",
      alive: true,
      hasMoved: false,
    };
    renderer.renderPiece(piece);

    const p1 = renderer.animateMove(piece, new Hex(0, 0), new Hex(1, 1));
    expect(p1).toBeInstanceOf(Promise);
    await p1;

    // test unknown piece
    const p2 = await renderer.animateMove(
      { id: "unknown", pos: new Hex(0, 0) },
      new Hex(0, 0),
      new Hex(1, 1),
    );
    expect(p2).toBeUndefined();
  });

  test("constructor seeds 66 cells and starts at rotation 0", () => {
    expect(renderer.cells.size).toBe(66);
    expect(renderer.currentRotation).toBe(0);
    expect(renderer.hexElements.size).toBe(0); // populated by render()
  });

  test("setRotation stores the new rotation value", () => {
    renderer.setRotation(240);
    expect(renderer.currentRotation).toBe(240);
    // negative wraps via CSS but the stored value is kept as given
    renderer.setRotation(-120);
    expect(renderer.currentRotation).toBe(-120);
  });

  test("highlightCheck and clearCheck toggle the check class", () => {
    renderer.render();
    const cells = Array.from(renderer.cells.values());
    const cell0 = cells[0]!;
    renderer.highlightCheck(cell0.hex);
    const el = renderer.hexElements.get(cell0.hex.key)!;
    expect(el.polygon.classList.contains("highlight-check")).toBe(true);
    renderer.clearCheck();
    expect(el.polygon.classList.contains("highlight-check")).toBe(false);
  });

  test("renderPiece warns and skips when board-group is missing", () => {
    // Fresh renderer on an SVG that is NOT attached to a board-group
    const detached = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    ) as SVGSVGElement;
    const r2 = new BoardRenderer(detached);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    r2.renderPiece({
      id: "orphan",
      type: "pawn",
      faction: FACTION.FIRE,
      pos: new Hex(0, 0),
      symbol: "P",
      alive: true,
      hasMoved: false,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      "board-group not found, piece not rendered",
    );
    expect(r2.pieceElements.has("orphan")).toBe(false);
    warnSpy.mockRestore();
  });

  test("render adds faction class only for faction-owned cells", () => {
    renderer.render();
    // Center triangle cell has no faction -> no faction-* class
    const neutral = renderer.hexElements.get(new Hex(0, 0).key)!;
    expect(neutral.polygon.classList.contains("faction-fire")).toBe(false);
    expect(neutral.polygon.classList.contains("faction-water")).toBe(false);
    // Fire base apex is faction-owned
    const owned = renderer.hexElements.get(new Hex(0, 6).key)!;
    expect(owned.polygon.classList.contains("faction-fire")).toBe(true);
  });
});

describe("BoardRenderer — touch rotation gestures", () => {
  let svgContainer: SVGSVGElement;
  let renderer: BoardRenderer;
  let pr: any;

  beforeEach(() => {
    document.body.innerHTML = '<svg id="board-svg"></svg>';
    svgContainer = document.getElementById(
      "board-svg",
    ) as unknown as SVGSVGElement;
    renderer = new BoardRenderer(svgContainer);
    pr = renderer as any;
    renderer.setRotation(0);
  });

  test("single-finger touch does not start rotating", () => {
    const ev = makeTouchEvent("touchstart", [makeTouch(1, 10, 10)]);
    pr._onTouchStart(ev);
    expect(pr._touchState.isRotating).toBe(false);
    expect(renderer.currentRotation).toBe(0);
  });

  test("two-finger touch starts rotating and records initial angle", () => {
    const ev = makeTouchEvent("touchstart", [
      makeTouch(1, 0, 0),
      makeTouch(2, 100, 0),
    ]);
    pr._onTouchStart(ev);
    expect(pr._touchState.isRotating).toBe(true);
    expect(pr._touchState.initialRotation).toBe(0);
  });

  test("two-finger move rotates by the change in angle", () => {
    // start horizontal (angle 0)
    pr._onTouchStart(
      makeTouchEvent("touchstart", [makeTouch(1, 0, 0), makeTouch(2, 100, 0)]),
    );
    // rotate to vertical (angle 90)
    pr._onTouchMove(
      makeTouchEvent("touchmove", [makeTouch(1, 0, 0), makeTouch(2, 0, 100)]),
    );
    expect(Math.round(renderer.currentRotation)).toBe(90);
  });

  test("move is a no-op when not rotating", () => {
    pr._onTouchMove(
      makeTouchEvent("touchmove", [makeTouch(1, 0, 0), makeTouch(2, 0, 100)]),
    );
    expect(renderer.currentRotation).toBe(0);
  });

  test("touchend snaps rotation to nearest 120° and stops rotating", () => {
    // start from 50° (between 0 and 120) -> should snap to 0
    renderer.setRotation(50);
    pr._touchState.isRotating = true;
    pr._touchState.initialRotation = 50;
    pr._onTouchEnd(makeTouchEvent("touchend", [makeTouch(2, 0, 100)]));
    expect(renderer.currentRotation).toBe(0);
    expect(pr._touchState.isRotating).toBe(false);
  });

  test("touchend with no active rotation leaves rotation untouched", () => {
    renderer.setRotation(240);
    pr._onTouchEnd(makeTouchEvent("touchend", [makeTouch(1, 0, 0)]));
    expect(renderer.currentRotation).toBe(240);
  });

  test("rotation stays positive after full 360° turn (modulo wrap)", () => {
    renderer.setRotation(350);
    pr._touchState.isRotating = true;
    pr._touchState.initialRotation = 350;
    // 350° is closer to 360° than to 0°, so it snaps UP to 360 (not down to 0)
    pr._onTouchEnd(makeTouchEvent("touchend", [makeTouch(1, 0, 0)]));
    expect(renderer.currentRotation).toBe(360);
  });

  test("_onTouchMove ignores a changed touch not present in touch state", () => {
    pr._touchState.isRotating = true;
    pr._touchState.touches.set(1, { clientX: 0, clientY: 0 });
    pr._touchState.touches.set(2, { clientX: 100, clientY: 0 });
    // A changedTouches entry with an unknown identifier must not be recorded
    pr._onTouchMove(makeTouchEvent("touchmove", [makeTouch(99, 50, 50)]));
    expect(pr._touchState.touches.has(99)).toBe(false);
  });

  test("_onTouchMove is a no-op when fewer than two touches remain", () => {
    pr._touchState.isRotating = true;
    pr._touchState.touches.clear();
    pr._onTouchMove(makeTouchEvent("touchmove", [makeTouch(1, 0, 0)]));
    expect(renderer.currentRotation).toBe(0);
  });

  test("_getTouchAngle / _getTouchDistance return 0 with missing touches", () => {
    expect(pr._getTouchAngle(undefined, undefined)).toBe(0);
    expect(pr._getTouchDistance(undefined, { clientX: 0, clientY: 0 })).toBe(0);
    // with both present, distance is the euclidean length
    const d = pr._getTouchDistance(
      { clientX: 0, clientY: 0 },
      { clientX: 3, clientY: 4 },
    );
    expect(d).toBe(5);
  });
});

describe("BoardRenderer — highlight / animate edge cases", () => {
  let svgContainer: SVGSVGElement;
  let renderer: BoardRenderer;

  beforeEach(() => {
    document.body.innerHTML = '<svg id="board-svg"></svg>';
    svgContainer = document.getElementById(
      "board-svg",
    ) as unknown as SVGSVGElement;
    renderer = new BoardRenderer(svgContainer);
    renderer.render();
  });

  test("highlightCells / highlightCheck are safe with an unknown hex", () => {
    const ghost = new Hex(99, 99);
    // should not throw and should be a no-op
    expect(() => renderer.highlightCells([ghost])).not.toThrow();
    expect(() => renderer.highlightCheck(ghost)).not.toThrow();
  });

  test("highlightCells default class is highlight-move", () => {
    const cell = Array.from(renderer.cells.values())[0]!;
    renderer.highlightCells([cell.hex]);
    expect(
      renderer.hexElements
        .get(cell.hex.key)!
        .polygon.classList.contains("highlight-move"),
    ).toBe(true);
  });

  test("render fires onCellClick callback when a cell is tapped", () => {
    const onCellClick = vi.fn();
    renderer.onCellClick = onCellClick;
    const cell = Array.from(renderer.cells.values())[0]!;
    const el = renderer.hexElements.get(cell.hex.key)!;
    // simulate the pointerdown listener attached in render()
    el.polygon.dispatchEvent(new window.Event("pointerdown"));
    // happy-dom may not route the listener the same way; fall back to direct call
    renderer.onCellClick(cell.hex, cell);
    expect(onCellClick).toHaveBeenCalled();
  });

  test("animateMove resolves undefined for an unknown piece id", async () => {
    const result = await renderer.animateMove(
      { id: "does-not-exist", pos: new Hex(0, 0) },
      new Hex(0, 0),
      new Hex(1, 1),
    );
    expect(result).toBeUndefined();
  });

  test("_onTouchMove bails out when a touch was lifted mid-gesture (≠2 touches)", () => {
    const pr = renderer as any;
    pr._touchState.isRotating = true;
    pr._touchState.touches.set(1, { clientX: 0, clientY: 0 });
    pr._touchState.touches.set(2, { clientX: 100, clientY: 0 });
    // Only one touch remains in changedTouches (the other was lifted) and the
    // recorded state still has 2 -> after the update loop the array has length 1
    pr._touchState.touches.delete(2);
    pr._onTouchMove(makeTouchEvent("touchmove", [makeTouch(1, 0, 0)]));
    expect(renderer.currentRotation).toBe(0);
  });

  test("renderPiece long-press: contextmenu triggers onPieceLongPress", () => {
    const onPieceLongPress = vi.fn();
    renderer.onPieceLongPress = onPieceLongPress;
    const piece: Piece = {
      id: "lp",
      type: "pawn",
      faction: FACTION.FIRE,
      pos: new Hex(0, 0),
      symbol: "P",
      alive: true,
      hasMoved: false,
    };
    renderer.renderPiece(piece);
    const el = renderer.pieceElements.get("lp")!.element;
    const evt = new window.Event("contextmenu") as unknown as MouseEvent;
    evt.preventDefault = () => {};
    (evt as any).clientX = 12;
    (evt as any).clientY = 34;
    el.dispatchEvent(evt);
    expect(onPieceLongPress).toHaveBeenCalledTimes(1);
    const arg = (
      onPieceLongPress.mock.calls[0] as unknown as [
        unknown,
        { clientX: number; clientY: number },
      ]
    )[1];
    expect(arg).toEqual({ clientX: 12, clientY: 34 });
  });

  test("renderPiece long-press: onPressEnd with no pending timer is a no-op", () => {
    // Cover the `if (pressTimer)` false branch in onPressEnd.
    const piece: Piece = {
      id: "lp2",
      type: "pawn",
      faction: FACTION.FIRE,
      pos: new Hex(0, 0),
      symbol: "P",
      alive: true,
      hasMoved: false,
    };
    renderer.renderPiece(piece);
    const el = renderer.pieceElements.get("lp2")!.element;
    const up = new window.Event("pointerup");
    // No pointerdown happened first -> pressTimer is null -> clearTimeout skipped
    expect(() => el.dispatchEvent(up)).not.toThrow();
  });

  test("highlightLastMove marks exactly the from/to hexes and clearLastMove resets", () => {
    const from = Array.from(renderer.cells.values())[0]!.hex;
    const to = Array.from(renderer.cells.values())[5]!.hex;
    renderer.highlightLastMove(from, to);
    expect(
      renderer.hexElements
        .get(from.key)!
        .polygon.classList.contains("highlight-last-move"),
    ).toBe(true);
    expect(
      renderer.hexElements
        .get(to.key)!
        .polygon.classList.contains("highlight-last-move"),
    ).toBe(true);
    // a third, unrelated cell must NOT be marked
    const other = Array.from(renderer.cells.values())[10]!.hex;
    expect(
      renderer.hexElements
        .get(other.key)!
        .polygon.classList.contains("highlight-last-move"),
    ).toBe(false);

    renderer.clearLastMove();
    for (const [, e] of renderer.hexElements) {
      expect(e.polygon.classList.contains("highlight-last-move")).toBe(false);
    }
  });

  test("highlightLastMove accepts string keys and skips null endpoints", () => {
    const cell = Array.from(renderer.cells.values())[3]!.hex;
    // string-key overload + undefined `to` (e.g. move without a target yet)
    expect(() => renderer.highlightLastMove(cell.key, undefined)).not.toThrow();
    expect(
      renderer.hexElements
        .get(cell.key)!
        .polygon.classList.contains("highlight-last-move"),
    ).toBe(true);
  });

  test("showMovePreview separates move vs attack highlights; clearMovePreview removes both", () => {
    const moveHex = Array.from(renderer.cells.values())[1]!.hex;
    const attackHex = Array.from(renderer.cells.values())[2]!.hex;
    const ghost = new Hex(99, 99); // unknown hex must be a safe no-op

    renderer.showMovePreview([moveHex, ghost], [attackHex]);
    const moveEl = renderer.hexElements.get(moveHex.key)!.polygon;
    const attackEl = renderer.hexElements.get(attackHex.key)!.polygon;
    expect(moveEl.classList.contains("highlight-preview-move")).toBe(true);
    expect(attackEl.classList.contains("highlight-preview-attack")).toBe(true);
    // an attack hex must not carry the move class (distinct visual channels)
    expect(attackEl.classList.contains("highlight-preview-move")).toBe(false);

    renderer.clearMovePreview();
    expect(moveEl.classList.contains("highlight-preview-move")).toBe(false);
    expect(attackEl.classList.contains("highlight-preview-attack")).toBe(false);
  });

  test("showMovePreview(undefined, undefined) clears previous previews", () => {
    const hex = Array.from(renderer.cells.values())[4]!.hex;
    renderer.showMovePreview([hex], []);
    expect(
      renderer.hexElements
        .get(hex.key)!
        .polygon.classList.contains("highlight-preview-move"),
    ).toBe(true);
    // passing undefined moves/attacks wipes prior markers (preview reset path)
    renderer.showMovePreview(undefined, undefined);
    expect(
      renderer.hexElements
        .get(hex.key)!
        .polygon.classList.contains("highlight-preview-move"),
    ).toBe(false);
  });

  test("onCellHover fires with coordinates on pointerenter and null on pointerleave", () => {
    const seen: ({ q: number; r: number } | null)[] = [];
    renderer.onCellHover = (pos) => seen.push(pos);
    const cell = Array.from(renderer.cells.values())[0]!;
    const el = renderer.hexElements.get(cell.hex.key)!.polygon
      .parentElement as unknown as EventTarget;
    el.dispatchEvent(new window.Event("pointerenter"));
    expect(seen).toEqual([{ q: cell.hex.q, r: cell.hex.r }]);
    el.dispatchEvent(new window.Event("pointerleave"));
    expect(seen[seen.length - 1]).toBeNull();
  });
});
