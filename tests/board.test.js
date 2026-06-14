import { expect, test, describe, beforeEach } from "vitest";
import {
  generateBoard,
  getRPSResult,
  BoardRenderer,
  FACTION,
} from "../js/board.js";
import { Hex } from "../js/hex.js";

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
});
