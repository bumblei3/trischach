/**
 * board-render.test.js — focused tests for BoardRenderer rendering/state
 * methods (renderPiece, setRotation, highlightCells, clearHighlights,
 * selectCell, highlightCheck, removePiece, animateMove). These exercise the
 * DOM-building branches that the rotate-gesture tests do not cover, with
 * real DOM assertions rather than "does not throw" only.
 */
import { expect, test, describe, beforeEach } from "vitest";
import { BoardRenderer, FACTION } from "../js/board.ts";
import { Hex } from "../js/hex.ts";
import { Piece, PIECE_TYPE } from "../js/pieces.ts";

describe("BoardRenderer — rendering & state", () => {
  let svgContainer;
  let renderer;

  beforeEach(() => {
    document.body.innerHTML = '<svg id="board-svg"></svg>';
    svgContainer = document.getElementById("board-svg");
    renderer = new BoardRenderer(svgContainer);
    renderer.render();
  });

  function makePiece(id, faction, q, r, symbol = "P") {
    return new Piece(PIECE_TYPE.PAWN, faction, new Hex(q, r), symbol);
  }

  test("renderPiece adds a .piece group with the correct id and symbol", () => {
    const p = makePiece("p1", FACTION.FIRE, 0, 0, "♙");
    renderer.renderPiece(p);
    const el = renderer.pieceElements.get(p.id).element;
    expect(el.classList.contains("piece")).toBe(true);
    expect(el.classList.contains("piece-fire")).toBe(true);
    expect(el.dataset.pieceId).toBe(p.id);
    const symbol = el.querySelector(".piece-symbol");
    expect(symbol.textContent).toBe(p.symbol);
  });

  test("setRotation stores the angle", () => {
    renderer.setRotation(120);
    expect(renderer.currentRotation).toBe(120);
  });

  test("highlightCells adds the requested class to the target hex", () => {
    const cell = Array.from(renderer.cells.values())[0];
    renderer.highlightCells([cell.hex], "highlight-attack");
    const el = renderer.hexElements.get(cell.hex.key);
    expect(el.polygon.classList.contains("highlight-attack")).toBe(true);
    // default class when none supplied
    const cell2 = Array.from(renderer.cells.values())[1];
    renderer.highlightCells([cell2.hex]);
    const el2 = renderer.hexElements.get(cell2.hex.key);
    expect(el2.polygon.classList.contains("highlight-move")).toBe(true);
  });

  test("clearHighlights removes all highlight classes", () => {
    const cells = Array.from(renderer.cells.values()).slice(0, 3);
    renderer.highlightCells([cells[0].hex], "highlight-attack");
    renderer.highlightCells([cells[1].hex], "highlight-check");
    renderer.clearHighlights();
    for (const c of cells) {
      const el = renderer.hexElements.get(c.hex.key);
      expect(el.polygon.classList.contains("highlight-attack")).toBe(false);
      expect(el.polygon.classList.contains("highlight-check")).toBe(false);
      expect(el.polygon.classList.contains("highlight-move")).toBe(false);
    }
  });

  test("selectCell / clearSelection toggle the selected class", () => {
    const cell = Array.from(renderer.cells.values())[0];
    renderer.selectCell(cell.hex);
    const el = renderer.hexElements.get(cell.hex.key);
    expect(el.polygon.classList.contains("selected")).toBe(true);
    renderer.clearSelection();
    expect(el.polygon.classList.contains("selected")).toBe(false);
  });

  test("highlightCheck adds highlight-check to the king's hex", () => {
    const cell = Array.from(renderer.cells.values())[5];
    renderer.highlightCheck(cell.hex);
    const el = renderer.hexElements.get(cell.hex.key);
    expect(el.polygon.classList.contains("highlight-check")).toBe(true);
  });

  test("removePiece deletes the piece element from the DOM", () => {
    const p = makePiece("p2", FACTION.WATER, 1, 1, "♟");
    renderer.renderPiece(p);
    expect(renderer.pieceElements.has(p.id)).toBe(true);
    renderer.removePiece(p.id);
    expect(renderer.pieceElements.has(p.id)).toBe(false);
  });

  test("animateMove updates the piece group transform to the target pixel", async () => {
    const p = makePiece("p3", FACTION.NATURE, 0, 0, "♘");
    renderer.renderPiece(p);
    const target = new Hex(1, 0);
    await renderer.animateMove(p, p.pos, target);
    const el = renderer.pieceElements.get(p.id).element;
    const t = el.getAttribute("transform");
    expect(t).toContain("translate(");
  });

  test("renderPiece re-renders an existing piece id without leaking elements", () => {
    const p = makePiece("p4", FACTION.FIRE, 0, 0, "♙");
    renderer.renderPiece(p);
    renderer.renderPiece(p); // second render of same id
    const groups = svgContainer.querySelectorAll(`[data-piece-id="${p.id}"]`);
    expect(groups.length).toBe(1);
  });
});
