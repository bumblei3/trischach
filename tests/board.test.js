import { expect, test, describe, beforeEach } from 'vitest';
import { generateBoard, getRPSResult, BoardRenderer, FACTION } from '../js/board.js';
import { Hex } from '../js/hex.js';

describe('Board Generator & Logic', () => {
  test('generateBoard creates exactly 66 cells', () => {
    const cells = generateBoard();
    // 21 (center triangle) + 3 * 15 (base zones) = 66
    expect(cells.size).toBe(66);
  });

  test('generateBoard correctly assigns zones', () => {
    const cells = generateBoard();
    // (0,0) should be TRIANGLE
    expect(cells.get('0,0').zone).toBe('triangle');
    
    // (0,6) should be FIRE base
    expect(cells.get('0,6').zone).toBe(`start_${FACTION.FIRE}`);
  });

  test('getRPSResult resolves combat correctly', () => {
    expect(getRPSResult(FACTION.FIRE, FACTION.NATURE)).toBe('advantage');
    expect(getRPSResult(FACTION.FIRE, FACTION.WATER)).toBe('disadvantage');
    expect(getRPSResult(FACTION.WATER, FACTION.FIRE)).toBe('advantage');
    expect(getRPSResult(FACTION.NATURE, FACTION.WATER)).toBe('advantage');
  });
});

describe('BoardRenderer (DOM)', () => {
  let svgContainer;
  let renderer;

  beforeEach(() => {
    // Create mock SVG container using happy-dom
    document.body.innerHTML = '<svg id="board-svg"></svg>';
    svgContainer = document.getElementById('board-svg');
    renderer = new BoardRenderer(svgContainer);
  });

  test('render creates hex polygons in DOM', () => {
    renderer.render();
    const cells = svgContainer.querySelectorAll('.hex-polygon');
    expect(cells.length).toBe(66);
  });

  test('clearHighlights removes highlight classes', () => {
    renderer.render();
    const firstCell = svgContainer.querySelector('.hex-polygon');
    firstCell.classList.add('highlight-move');
    
    renderer.clearHighlights();
    expect(firstCell.classList.contains('highlight-move')).toBe(false);
  });

  test('setRotation applies CSS transform', () => {
    renderer.setRotation(120);
    expect(svgContainer.style.transform).toBe('rotate(120deg)');
  });

  test('renderPiece appends piece group to DOM', () => {
    renderer.render();
    
    const mockPiece = {
      id: 'test-piece',
      type: 'pawn',
      faction: FACTION.FIRE,
      pos: new Hex(0, 0),
      symbol: 'P'
    };
    
    renderer.renderPiece(mockPiece);
    const pieceEl = document.querySelector('[data-piece-id="test-piece"]');
    
    expect(pieceEl).not.toBeNull();
    expect(pieceEl.classList.contains('piece')).toBe(true);
    expect(pieceEl.classList.contains('piece-fire')).toBe(true);
    
    // Ensure text rotation matches board counter-rotation
    const textEl = pieceEl.querySelector('.piece-symbol');
    expect(textEl.style.transform).toBe('rotate(0deg)');
  });
});
