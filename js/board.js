import { Hex, hexToPixel, hexPolygonPoints, hexCorners } from "./hex.js";

export const ZONE = {
  TRIANGLE: "triangle",
  START_FIRE: "start_fire",
  START_WATER: "start_water",
  START_NATURE: "start_nature",
};
export const FACTION = { FIRE: "fire", WATER: "water", NATURE: "nature" };
export const FACTION_COLORS = {
  fire: {
    primary: "#FF4500",
    secondary: "#FF6B35",
    glow: "#FF6B3566",
    name: "Feuer 🔥",
  },
  water: {
    primary: "#0099FF",
    secondary: "#00BFFF",
    glow: "#00BFFF66",
    name: "Wasser 🌊",
  },
  nature: {
    primary: "#22CC44",
    secondary: "#32CD32",
    glow: "#32CD3266",
    name: "Natur 🌿",
  },
};
export const RPS = { fire: "nature", nature: "water", water: "fire" };

export function getRPSResult(attacker, defender) {
  if (attacker === defender) return "neutral";
  return RPS[attacker] === defender ? "advantage" : "disadvantage";
}

export function generateBoard() {
  const cells = new Map();
  const N = 5;

  // Central triangle pointing up (▲)
  // Top vertex is (0,0). Base is at r=N.
  for (let r = 0; r <= N; r++) {
    for (let q = -r; q <= 0; q++) {
      cells.set(new Hex(q, r).key, {
        hex: new Hex(q, r),
        zone: ZONE.TRIANGLE,
        faction: null,
      });
    }
  }

  // Bottom zone (Feuer 🔥) - attached to base r=N
  for (let d = 1; d <= 2; d++) {
    const r = N + d;
    for (let q = -N - d; q <= 0; q++) {
      cells.set(new Hex(q, r).key, {
        hex: new Hex(q, r),
        zone: ZONE.START_FIRE,
        faction: FACTION.FIRE,
      });
    }
  }

  // Right zone (Wasser 🌊) - attached to right edge q=0
  for (let d = 1; d <= 2; d++) {
    const q = d;
    for (let r = -d; r <= N; r++) {
      cells.set(new Hex(q, r).key, {
        hex: new Hex(q, r),
        zone: ZONE.START_WATER,
        faction: FACTION.WATER,
      });
    }
  }

  // Left zone (Natur 🌿) - attached to left edge s=0 (q=-r)
  for (let d = 1; d <= 2; d++) {
    const s = d;
    for (let r = -d; r <= N; r++) {
      const q = -r - s;
      cells.set(new Hex(q, r).key, {
        hex: new Hex(q, r),
        zone: ZONE.START_NATURE,
        faction: FACTION.NATURE,
      });
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
    this._ox = 0;
    this._oy = 0;
    this.currentRotation = 0;

    // Touch gesture handling for board rotation
    this._touchState = {
      touches: new Map(),
      initialAngle: 0,
      initialRotation: 0,
      isRotating: false,
    };
    this._setupTouchHandling();
  }

  _setupTouchHandling() {
    // Handle touch events for 2-finger rotation gesture
    this.svg.addEventListener("touchstart", (e) => this._onTouchStart(e), {
      passive: false,
    });
    this.svg.addEventListener("touchmove", (e) => this._onTouchMove(e), {
      passive: false,
    });
    this.svg.addEventListener("touchend", (e) => this._onTouchEnd(e), {
      passive: false,
    });
    this.svg.addEventListener("touchcancel", (e) => this._onTouchEnd(e), {
      passive: false,
    });

    // Also prevent default context menu on long press
    this.svg.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  _getTouchAngle(touch1, touch2) {
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    return (Math.atan2(dy, dx) * 180) / Math.PI;
  }

  _getTouchDistance(touch1, touch2) {
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  _onTouchStart(e) {
    // Track all touches
    for (const touch of e.changedTouches) {
      this._touchState.touches.set(touch.identifier, {
        clientX: touch.clientX,
        clientY: touch.clientY,
      });
    }

    // If we have exactly 2 touches, start rotation gesture
    if (this._touchState.touches.size === 2) {
      e.preventDefault();
      const touches = Array.from(this._touchState.touches.values());
      this._touchState.initialAngle = this._getTouchAngle(
        touches[0],
        touches[1],
      );
      this._touchState.initialRotation = this.currentRotation;
      this._touchState.isRotating = true;
      this._touchState.initialDistance = this._getTouchDistance(
        touches[0],
        touches[1],
      );
    }
  }

  _onTouchMove(e) {
    if (!this._touchState.isRotating || this._touchState.touches.size !== 2)
      return;

    e.preventDefault();

    // Update touch positions
    for (const touch of e.changedTouches) {
      if (this._touchState.touches.has(touch.identifier)) {
        this._touchState.touches.set(touch.identifier, {
          clientX: touch.clientX,
          clientY: touch.clientY,
        });
      }
    }

    const touches = Array.from(this._touchState.touches.values());
    if (touches.length !== 2) return;

    const currentAngle = this._getTouchAngle(touches[0], touches[1]);
    const angleDiff = currentAngle - this._touchState.initialAngle;

    // Calculate rotation in 120-degree increments (3 factions)
    // Snap to nearest 120-degree step during gesture for visual feedback
    const targetRotation = this._touchState.initialRotation + angleDiff;

    // Optional: also detect pinch-to-zoom (not implemented, just rotation for now)
    // const currentDistance = this._getTouchDistance(touches[0], touches[1]);

    this.setRotation(targetRotation);
  }

  _onTouchEnd(e) {
    // Remove ended touches
    for (const touch of e.changedTouches) {
      this._touchState.touches.delete(touch.identifier);
    }

    // If we were rotating and now have less than 2 touches, snap to nearest 120°
    if (this._touchState.isRotating) {
      this._touchState.isRotating = false;

      // Snap to nearest 120-degree increment
      const normalizedRotation = ((this.currentRotation % 360) + 360) % 360;
      const snapRotation = Math.round(normalizedRotation / 120) * 120;
      this.setRotation(snapRotation);
    }
  }

  _calcBounds() {
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const [, c] of this.cells) {
      const px = hexToPixel(c.hex, this.hexSize);
      for (const cr of hexCorners(px, this.hexSize)) {
        minX = Math.min(minX, cr.x);
        maxX = Math.max(maxX, cr.x);
        minY = Math.min(minY, cr.y);
        maxY = Math.max(maxY, cr.y);
      }
    }
    const pad = this.hexSize * 1.5;
    this._ox = -minX + pad;
    this._oy = -minY + pad;
    const w = maxX - minX + pad * 2,
      h = maxY - minY + pad * 2;
    this.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);

    // Set rotation origin to the geometric center of the board
    // The central triangle is perfectly symmetrical around (0, 5 * hexSize)
    const cx = this._ox;
    const cy = 5 * this.hexSize + this._oy;
    this.svg.style.transformOrigin = `${(cx / w) * 100}% ${(cy / h) * 100}%`;
  }

  render() {
    this.svg.innerHTML = "";
    this._calcBounds();
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    this._addDefs(defs);
    this.svg.appendChild(defs);
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("transform", `translate(${this._ox},${this._oy})`);
    g.id = "board-group";
    for (const [key, cell] of this.cells) {
      const px = hexToPixel(cell.hex, this.hexSize);
      const pts = hexPolygonPoints(px, this.hexSize * 0.94);
      const cg = document.createElementNS("http://www.w3.org/2000/svg", "g");
      cg.classList.add("hex-cell");
      cg.dataset.q = cell.hex.q;
      cg.dataset.r = cell.hex.r;
      const poly = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "polygon",
      );
      poly.setAttribute("points", pts);
      poly.classList.add("hex-polygon", `zone-${cell.zone}`);
      if (cell.faction) poly.classList.add(`faction-${cell.faction}`);
      cg.appendChild(poly);

      const label = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "text",
      );
      label.setAttribute("x", px.x);
      label.setAttribute("y", px.y + this.hexSize * 0.7);
      label.setAttribute("text-anchor", "middle");
      label.classList.add("hex-label");
      label.textContent = `${cell.hex.q},${cell.hex.r}`;
      label.style.transform = `rotate(${-this.currentRotation}deg)`;
      label.style.transformOrigin = `${px.x}px ${px.y + this.hexSize * 0.7}px`;
      label.style.transition = "transform 0.5s ease";
      cg.appendChild(label);

      cg.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (this.onCellClick) this.onCellClick(cell.hex, cell);
      });
      g.appendChild(cg);
      this.hexElements.set(key, { group: cg, polygon: poly, label: label });
    }
    this.svg.appendChild(g);
  }

  highlightCells(hexes, cls = "highlight-move") {
    for (const h of hexes) {
      const e = this.hexElements.get(h.key);
      if (e) e.polygon.classList.add(cls);
    }
  }
  selectCell(hex) {
    this.clearSelection();
    const e = this.hexElements.get(hex.key);
    if (e) e.polygon.classList.add("selected");
  }
  clearHighlights() {
    for (const [, e] of this.hexElements)
      e.polygon.classList.remove(
        "highlight-move",
        "highlight-attack",
        "highlight-attack-advantage",
        "highlight-attack-disadvantage",
        "highlight-check",
        "highlight-danger",
      );
  }
  clearSelection() {
    for (const [, e] of this.hexElements)
      e.polygon.classList.remove("selected");
  }

  /**
   * Highlights a king that is in check by adding the 'highlight-check' class to its hex cell.
   * @param {Hex} kingHex - The hex position of the king in check
   */
  highlightCheck(kingHex) {
    const e = this.hexElements.get(kingHex.key);
    if (e) {
      e.polygon.classList.add("highlight-check");
    }
  }

  clearCheck() {
    for (const [, e] of this.hexElements) {
      e.polygon.classList.remove("highlight-check");
    }
  }

  renderPiece(piece) {
    this.removePiece(piece.id);
    const px = hexToPixel(piece.pos, this.hexSize);
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.classList.add("piece", `piece-${piece.faction}`);
    g.dataset.pieceId = piece.id;
    g.setAttribute("transform", `translate(${px.x},${px.y})`);
    const circ = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "circle",
    );
    circ.setAttribute("r", this.hexSize * 0.38);
    circ.classList.add("piece-bg");
    g.appendChild(circ);
    const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
    txt.setAttribute("text-anchor", "middle");
    txt.setAttribute("dominant-baseline", "central");
    txt.setAttribute("font-size", `${this.hexSize * 0.48}px`);
    txt.classList.add("piece-symbol");
    txt.textContent = piece.symbol;
    txt.style.transform = `rotate(${-this.currentRotation}deg)`;
    txt.style.transformOrigin = "0 0";
    txt.style.transition = "transform 0.5s ease";
    g.appendChild(txt);

    // Long-press / right-click context menu for pieces
    let pressTimer = null;
    const onPressStart = (e) => {
      pressTimer = setTimeout(() => {
        if (this.onPieceLongPress) {
          this.onPieceLongPress(piece, {
            clientX: e.clientX,
            clientY: e.clientY,
          });
        }
      }, 500); // 500ms for long press
    };
    const onPressEnd = () => {
      if (pressTimer) clearTimeout(pressTimer);
    };

    g.addEventListener("pointerdown", onPressStart, { passive: true });
    g.addEventListener("pointerup", onPressEnd);
    g.addEventListener("pointerleave", onPressEnd);
    g.addEventListener("pointercancel", onPressEnd);
    // Context menu (right-click / long-press on desktop)
    g.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (this.onPieceLongPress) {
        this.onPieceLongPress(piece, {
          clientX: e.clientX,
          clientY: e.clientY,
        });
      }
    });

    const boardGroup = document.getElementById("board-group");
    if (boardGroup) {
      boardGroup.appendChild(g);
      this.pieceElements.set(piece.id, g);
    } else {
      console.warn("board-group not found, piece not rendered");
    }
  }

  removePiece(id) {
    const e = this.pieceElements.get(id);
    if (e) {
      e.remove();
      this.pieceElements.delete(id);
    }
  }

  setRotation(deg) {
    this.currentRotation = deg;
    this.svg.style.transform = `rotate(${this.currentRotation}deg)`;
    this.svg.style.transition = "transform 0.5s ease";
    // counter-rotate piece symbols and hex labels
    document.querySelectorAll(".piece-symbol, .hex-label").forEach((txt) => {
      txt.style.transform = `rotate(${-this.currentRotation}deg)`;
    });
  }

  async animateMove(piece, from, to) {
    const el = this.pieceElements.get(piece.id);
    if (!el) return;
    const tp = hexToPixel(to, this.hexSize);
    el.style.transition = "transform 0.3s ease";
    el.setAttribute("transform", `translate(${tp.x},${tp.y})`);
    return new Promise((r) => setTimeout(r, 320));
  }

  _addDefs(defs) {
    // Glow filter
    const f = document.createElementNS("http://www.w3.org/2000/svg", "filter");
    f.id = "glow";
    f.setAttribute("x", "-50%");
    f.setAttribute("y", "-50%");
    f.setAttribute("width", "200%");
    f.setAttribute("height", "200%");
    const blur = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "feGaussianBlur",
    );
    blur.setAttribute("stdDeviation", "4");
    blur.setAttribute("result", "b");
    f.appendChild(blur);
    const merge = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "feMerge",
    );
    const n1 = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "feMergeNode",
    );
    n1.setAttribute("in", "b");
    const n2 = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "feMergeNode",
    );
    n2.setAttribute("in", "SourceGraphic");
    merge.appendChild(n1);
    merge.appendChild(n2);
    f.appendChild(merge);
    defs.appendChild(f);
  }
}
