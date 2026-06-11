import { Hex, hexToPixel, hexPolygonPoints, hexCorners } from './hex.js';

export const ZONE = { TRIANGLE: 'triangle', START_FIRE: 'start_fire', START_WATER: 'start_water', START_NATURE: 'start_nature' };
export const FACTION = { FIRE: 'fire', WATER: 'water', NATURE: 'nature' };
export const FACTION_COLORS = {
  fire:   { primary: '#FF4500', secondary: '#FF6B35', glow: '#FF6B3566', name: 'Feuer 🔥' },
  water:  { primary: '#0099FF', secondary: '#00BFFF', glow: '#00BFFF66', name: 'Wasser 🌊' },
  nature: { primary: '#22CC44', secondary: '#32CD32', glow: '#32CD3266', name: 'Natur 🌿' },
};
export const RPS = { fire: 'nature', nature: 'water', water: 'fire' };

export function getRPSResult(attacker, defender) {
  if (attacker === defender) return 'neutral';
  return RPS[attacker] === defender ? 'advantage' : 'disadvantage';
}

export function generateBoard() {
  const cells = new Map();
  const N = 5;

  // Central triangle pointing up (▲)
  // Top vertex is (0,0). Base is at r=N.
  for (let r = 0; r <= N; r++) {
    for (let q = -r; q <= 0; q++) {
      cells.set(new Hex(q, r).key, { hex: new Hex(q, r), zone: ZONE.TRIANGLE, faction: null });
    }
  }

  // Bottom zone (Feuer 🔥) - attached to base r=N
  for (let d = 1; d <= 2; d++) {
    const r = N + d;
    for (let q = -N - d; q <= 0; q++) {
      cells.set(new Hex(q, r).key, { hex: new Hex(q, r), zone: ZONE.START_FIRE, faction: FACTION.FIRE });
    }
  }

  // Right zone (Wasser 🌊) - attached to right edge q=0
  for (let d = 1; d <= 2; d++) {
    const q = d;
    for (let r = -d; r <= N; r++) {
      cells.set(new Hex(q, r).key, { hex: new Hex(q, r), zone: ZONE.START_WATER, faction: FACTION.WATER });
    }
  }

  // Left zone (Natur 🌿) - attached to left edge s=0 (q=-r)
  for (let d = 1; d <= 2; d++) {
    const s = d;
    for (let r = -d; r <= N; r++) {
      const q = -r - s;
      cells.set(new Hex(q, r).key, { hex: new Hex(q, r), zone: ZONE.START_NATURE, faction: FACTION.NATURE });
    }
  }

  return cells;
}

export class BoardRenderer {
  constructor(svgEl, hexSize = 36) {
    this.svg = svgEl;
    this.hexSize = hexSize;
    this.cells = generateBoard();
    this.hexElements = new Map();
    this.pieceElements = new Map();
    this.onCellClick = null;
    this._ox = 0; this._oy = 0;
    this.currentRotation = 0;
  }

  _calcBounds() {
    let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
    for (const [,c] of this.cells) {
      const px = hexToPixel(c.hex, this.hexSize);
      for (const cr of hexCorners(px, this.hexSize)) {
        minX=Math.min(minX,cr.x); maxX=Math.max(maxX,cr.x);
        minY=Math.min(minY,cr.y); maxY=Math.max(maxY,cr.y);
      }
    }
    const pad = this.hexSize*1.5;
    this._ox = -minX+pad; this._oy = -minY+pad;
    const w = maxX-minX+pad*2, h = maxY-minY+pad*2;
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    
    // Set rotation origin to the geometric center of the board
    // The central triangle is perfectly symmetrical around (0, 5 * hexSize)
    const cx = this._ox;
    const cy = 5 * this.hexSize + this._oy;
    this.svg.style.transformOrigin = `${(cx / w) * 100}% ${(cy / h) * 100}%`;
  }

  render() {
    this.svg.innerHTML = '';
    this._calcBounds();
    const defs = document.createElementNS('http://www.w3.org/2000/svg','defs');
    this._addDefs(defs);
    this.svg.appendChild(defs);
    const g = document.createElementNS('http://www.w3.org/2000/svg','g');
    g.setAttribute('transform', `translate(${this._ox},${this._oy})`);
    g.id = 'board-group';
    for (const [key,cell] of this.cells) {
      const px = hexToPixel(cell.hex, this.hexSize);
      const pts = hexPolygonPoints(px, this.hexSize*0.94);
      const cg = document.createElementNS('http://www.w3.org/2000/svg','g');
      cg.classList.add('hex-cell');
      cg.dataset.q = cell.hex.q; cg.dataset.r = cell.hex.r;
      const poly = document.createElementNS('http://www.w3.org/2000/svg','polygon');
      poly.setAttribute('points', pts);
      poly.classList.add('hex-polygon', `zone-${cell.zone}`);
      if (cell.faction) poly.classList.add(`faction-${cell.faction}`);
      cg.appendChild(poly);
      
      const label = document.createElementNS('http://www.w3.org/2000/svg','text');
      label.setAttribute('x', px.x);
      label.setAttribute('y', px.y + this.hexSize * 0.70);
      label.setAttribute('text-anchor', 'middle');
      label.classList.add('hex-label');
      label.textContent = `${cell.hex.q},${cell.hex.r}`;
      label.style.transform = `rotate(${-this.currentRotation}deg)`;
      label.style.transformOrigin = `${px.x}px ${px.y + this.hexSize * 0.70}px`;
      label.style.transition = 'transform 0.5s ease';
      cg.appendChild(label);
      
      cg.addEventListener('click', () => this.onCellClick && this.onCellClick(cell.hex, cell));
      g.appendChild(cg);
      this.hexElements.set(key, { group: cg, polygon: poly, label: label });
    }
    this.svg.appendChild(g);
  }

  highlightCells(hexes, cls='highlight-move') {
    for (const h of hexes) {
      const e = this.hexElements.get(h.key);
      if (e) e.polygon.classList.add(cls);
    }
  }
  selectCell(hex) {
    this.clearSelection();
    const e = this.hexElements.get(hex.key);
    if (e) e.polygon.classList.add('selected');
  }
  clearHighlights() {
    for (const [,e] of this.hexElements) e.polygon.classList.remove('highlight-move','highlight-attack','highlight-attack-advantage','highlight-attack-disadvantage','highlight-check','highlight-danger');
  }
  clearSelection() {
    for (const [,e] of this.hexElements) e.polygon.classList.remove('selected');
  }

  renderPiece(piece) {
    this.removePiece(piece.id);
    const px = hexToPixel(piece.pos, this.hexSize);
    const g = document.createElementNS('http://www.w3.org/2000/svg','g');
    g.classList.add('piece', `piece-${piece.faction}`);
    g.dataset.pieceId = piece.id;
    g.setAttribute('transform', `translate(${px.x},${px.y})`);
    const circ = document.createElementNS('http://www.w3.org/2000/svg','circle');
    circ.setAttribute('r', this.hexSize*0.38);
    circ.classList.add('piece-bg');
    g.appendChild(circ);
    const txt = document.createElementNS('http://www.w3.org/2000/svg','text');
    txt.setAttribute('text-anchor','middle');
    txt.setAttribute('dominant-baseline','central');
    txt.setAttribute('font-size', `${this.hexSize*0.48}px`);
    txt.classList.add('piece-symbol');
    txt.textContent = piece.symbol;
    txt.style.transform = `rotate(${-this.currentRotation}deg)`;
    txt.style.transformOrigin = '0 0'; // SVG origin is already at the piece's center due to group translation
    txt.style.transition = 'transform 0.5s ease';
    g.appendChild(txt);
    document.getElementById('board-group').appendChild(g);
    this.pieceElements.set(piece.id, g);
  }

  removePiece(id) {
    const e = this.pieceElements.get(id);
    if (e) { e.remove(); this.pieceElements.delete(id); }
  }

  setRotation(deg) {
    this.currentRotation = deg;
    this.svg.style.transform = `rotate(${this.currentRotation}deg)`;
    this.svg.style.transition = 'transform 0.5s ease';
    // counter-rotate piece symbols and hex labels
    document.querySelectorAll('.piece-symbol, .hex-label').forEach(txt => {
      txt.style.transform = `rotate(${-this.currentRotation}deg)`;
    });
  }

  async animateMove(piece, from, to) {
    const el = this.pieceElements.get(piece.id);
    if (!el) return;
    const tp = hexToPixel(to, this.hexSize);
    el.style.transition = 'transform 0.3s ease';
    el.setAttribute('transform', `translate(${tp.x},${tp.y})`);
    return new Promise(r => setTimeout(r, 320));
  }

  _addDefs(defs) {
    // Glow filter
    const f = document.createElementNS('http://www.w3.org/2000/svg','filter');
    f.id='glow'; f.setAttribute('x','-50%'); f.setAttribute('y','-50%');
    f.setAttribute('width','200%'); f.setAttribute('height','200%');
    const blur = document.createElementNS('http://www.w3.org/2000/svg','feGaussianBlur');
    blur.setAttribute('stdDeviation','4'); blur.setAttribute('result','b');
    f.appendChild(blur);
    const merge = document.createElementNS('http://www.w3.org/2000/svg','feMerge');
    const n1 = document.createElementNS('http://www.w3.org/2000/svg','feMergeNode');
    n1.setAttribute('in','b');
    const n2 = document.createElementNS('http://www.w3.org/2000/svg','feMergeNode');
    n2.setAttribute('in','SourceGraphic');
    merge.appendChild(n1); merge.appendChild(n2);
    f.appendChild(merge); defs.appendChild(f);
  }
}
