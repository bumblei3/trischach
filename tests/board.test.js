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

describe("Board Generator & Logic", () => {
  test("generateBoard creates exactly 66 cells", () => {
    const cells = generateBoard();
    // 21 (center triangle) + 3 * 15 (base zones) = 66
    expect(cells.size).toBe(66);
  });

  test("generateBoard correctly assigns zones", () => {
    const cells = generateBoard();
    // (0,0) should be TRIANGLE
    expect(cells.get("0,0").zone).toBe("triangle");

    // (0,6) should be FIRE base
    expect(cells.get("0,6").zone).toBe(`start_${FACTION.FIRE}`);
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
    expect(cells.get("0,0").zone).toBe("triangle");
    expect(cells.get("0,0").faction).toBeNull();
    // Apex of the fire base
    expect(cells.get("0,6").zone).toBe("start_fire");
    expect(cells.get("0,6").faction).toBe(FACTION.FIRE);
    // Apex of the water base
    expect(cells.get("1,0").zone).toBe("start_water");
    expect(cells.get("1,0").faction).toBe(FACTION.WATER);
  });

  test("generateBoard is deterministic across calls", () => {
    const a = generateBoard();
    const b = generateBoard();
    expect(a.size).toBe(b.size);
    for (const [key, cell] of a) {
      const other = b.get(key);
      expect(other).toBeDefined();
      expect(other.zone).toBe(cell.zone);
      expect(other.faction).toBe(cell.faction);
    }
  });
});

describe("getRPSResult — full matrix & invariants", () => {
  const factions = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];

  test("same faction is always neutral", () => {
    for (const f of factions) {
      expect(getRPSResult(f, f)).toBe("neutral");
    }
  });

  test("advantage is the inverse of disadvantage (symmetric RPS)", () => {
    for (const a of factions) {
      for (const d of factions) {
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
  let svgContainer;
  let renderer;

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
    svgContainer = document.getElementById("board-svg");
    renderer = new BoardRenderer(svgContainer);
  });

  test("render creates hex polygons in DOM", () => {
    renderer.render();
    const cells = svgContainer.querySelectorAll(".hex-polygon");
    expect(cells.length).toBe(66);
  });

  test("clearHighlights removes highlight classes", () => {
    renderer.render();
    const firstCell = svgContainer.querySelector(".hex-polygon");
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

    const mockPiece = {
      id: "test-piece",
      type: "pawn",
      faction: FACTION.FIRE,
      pos: new Hex(0, 0),
      symbol: "P",
    };

    renderer.renderPiece(mockPiece);
    const pieceEl = document.querySelector('[data-piece-id="test-piece"]');

    expect(pieceEl).not.toBeNull();
    expect(pieceEl.classList.contains("piece")).toBe(true);
    expect(pieceEl.classList.contains("piece-fire")).toBe(true);

    // Ensure text rotation matches board counter-rotation
    const textEl = pieceEl.querySelector(".piece-symbol");
    expect(textEl.style.transform).toBe("rotate(0deg)");

    // Removing the piece should remove it from DOM
    renderer.removePiece(mockPiece.id);
    expect(document.querySelectorAll(".piece").length).toBe(0);
    expect(renderer.pieceElements.has(mockPiece.id)).toBe(false);
  });

  test("highlightCells and clearHighlights", () => {
    renderer.render();
    const cells = Array.from(renderer.cells.values());

    renderer.highlightCells([cells[0].hex]); // default arg test
    const el = renderer.hexElements.get(cells[0].hex.key);
    expect(el.polygon.classList.contains("highlight-move")).toBe(true);

    renderer.clearHighlights();
    expect(el.polygon.classList.contains("highlight-move")).toBe(false);
  });

  test("selectCell clears previous selection and selects new", () => {
    renderer.render();
    const cells = Array.from(renderer.cells.values());

    renderer.selectCell(cells[0].hex);
    expect(
      renderer.hexElements
        .get(cells[0].hex.key)
        .polygon.classList.contains("selected"),
    ).toBe(true);

    renderer.selectCell(cells[1].hex);
    expect(
      renderer.hexElements
        .get(cells[0].hex.key)
        .polygon.classList.contains("selected"),
    ).toBe(false);
    expect(
      renderer.hexElements
        .get(cells[1].hex.key)
        .polygon.classList.contains("selected"),
    ).toBe(true);
  });

  test("animateMove transforms piece element", async () => {
    renderer.render();
    const piece = {
      id: "test_piece",
      faction: FACTION.FIRE,
      pos: new Hex(0, 0),
      symbol: "P",
    };
    renderer.renderPiece(piece);

    const p1 = renderer.animateMove(piece, new Hex(0, 0), new Hex(1, 1));
    expect(p1).toBeInstanceOf(Promise);
    await p1;

    // test unknown piece
    const p2 = await renderer.animateMove(
      { id: "unknown" },
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
    renderer.highlightCheck(cells[0].hex);
    const el = renderer.hexElements.get(cells[0].hex.key);
    expect(el.polygon.classList.contains("highlight-check")).toBe(true);
    renderer.clearCheck();
    expect(el.polygon.classList.contains("highlight-check")).toBe(false);
  });

  test("renderPiece warns and skips when board-group is missing", () => {
    // Fresh renderer on an SVG that is NOT attached to a board-group
    const detached = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    const r2 = new BoardRenderer(detached);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    r2.renderPiece({
      id: "orphan",
      faction: FACTION.FIRE,
      pos: new Hex(0, 0),
      symbol: "P",
    });
    expect(warnSpy).toHaveBeenCalledWith(
      "board-group not found, piece not rendered",
    );
    expect(r2.pieceElements.has("orphan")).toBe(false);
    warnSpy.mockRestore();
  });
});
