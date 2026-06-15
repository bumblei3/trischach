import { Hex, hexToPixel, hexPolygonPoints, hexCorners } from "./hex.ts";
import type { Faction, RPSResult, Cell, Zone, Piece } from "./types.ts";

export const ZONE: Zone = {
  TRIANGLE: "triangle",
  START_FIRE: "start_fire",
  START_WATER: "start_water",
  START_NATURE: "start_nature",
} as const;

export const FACTION = {
  FIRE: "fire" as Faction,
  WATER: "water" as Faction,
  NATURE: "nature" as Faction,
} as const;

export const FACTION_COLORS: Record<
  Faction,
  {
    primary: string;
    secondary: string;
    glow: string;
    name: string;
  }
> = {
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

export const RPS: Record<Faction, Faction> = {
  fire: "nature",
  nature: "water",
  water: "fire",
};

export function getRPSResult(attacker: Faction, defender: Faction): RPSResult {
  if (attacker === defender) return "neutral";
  return RPS[attacker] === defender ? "advantage" : "disadvantage";
}

export function generateBoard(): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  const N = 5;

  // Central triangle pointing up (▲)
  // Top vertex is (0,0). Base is at r=N.
  for (let r = 0; r <= N; r++) {
    for (let q = -r; q <= 0; q++) {
      const hex = new Hex(q, r);
      cells.set(hex.key, { hex, zone: ZONE.TRIANGLE, faction: null });
    }
  }

  // Bottom zone (Feuer 🔥) - attached to base r=N
  for (let d = 1; d <= 2; d++) {
    const r = N + d;
    for (let q = -N - d; q <= 0; q++) {
      const hex = new Hex(q, r);
      cells.set(hex.key, { hex, zone: ZONE.START_FIRE, faction: FACTION.FIRE });
    }
  }

  // Right zone (Wasser 🌊) - attached to right edge q=0
  for (let d = 1; d <= 2; d++) {
    const q = d;
    for (let r = -d; r <= N; r++) {
      const hex = new Hex(q, r);
      cells.set(hex.key, {
        hex,
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
      const hex = new Hex(q, r);
      cells.set(hex.key, {
        hex,
        zone: ZONE.START_NATURE,
        faction: FACTION.NATURE,
      });
    }
  }

  return cells;
}

interface HexElement {
  group: SVGGElement;
  polygon: SVGPolygonElement;
  label: SVGTextElement;
  cell: Cell;
}

interface PieceElement {
  id: string;
  element: SVGGElement;
}

interface TouchState {
  touches: Map<number, { clientX: number; clientY: number }>;
  initialAngle: number;
  initialRotation: number;
  isRotating: boolean;
  initialDistance: number;
}

export class BoardRenderer {
  public readonly svg: SVGSVGElement;
  public readonly hexSize: number;
  public readonly cells: Map<string, Cell>;
  public readonly hexElements: Map<string, HexElement>;
  public readonly pieceElements: Map<string, PieceElement>;
  public onCellClick: ((hex: Hex, cell: Cell) => void) | null = null;
  public onPieceLongPress:
    | ((piece: Piece, position: { clientX: number; clientY: number }) => void)
    | null = null;
  private _ox = 0;
  private _oy = 0;
  public currentRotation = 0;
  private _touchState: TouchState = {
    touches: new Map(),
    initialAngle: 0,
    initialRotation: 0,
    isRotating: false,
    initialDistance: 0,
  };

  constructor(svgEl: SVGSVGElement, hexSize = 36) {
    this.svg = svgEl;
    this.hexSize = hexSize;
    this.cells = generateBoard();
    this.hexElements = new Map();
    this.pieceElements = new Map();
    this._setupTouchHandling();
  }

  private _setupTouchHandling(): void {
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
    this.svg.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private _getTouchAngle(
    touch1: { clientX: number; clientY: number } | undefined,
    touch2: { clientX: number; clientY: number } | undefined,
  ): number {
    if (!touch1 || !touch2) return 0;
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    return (Math.atan2(dy, dx) * 180) / Math.PI;
  }

  private _getTouchDistance(
    touch1: { clientX: number; clientY: number } | undefined,
    touch2: { clientX: number; clientY: number } | undefined,
  ): number {
    if (!touch1 || !touch2) return 0;
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private _onTouchStart(e: TouchEvent): void {
    for (const touch of e.changedTouches) {
      this._touchState.touches.set(touch.identifier, {
        clientX: touch.clientX,
        clientY: touch.clientY,
      });
    }

    if (this._touchState.touches.size === 2) {
      e.preventDefault();
      const touches = Array.from(this._touchState.touches.values()) as [
        { clientX: number; clientY: number },
        { clientX: number; clientY: number },
      ];
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

  private _onTouchMove(e: TouchEvent): void {
    if (!this._touchState.isRotating || this._touchState.touches.size !== 2)
      return;

    e.preventDefault();

    for (const touch of e.changedTouches) {
      if (this._touchState.touches.has(touch.identifier)) {
        this._touchState.touches.set(touch.identifier, {
          clientX: touch.clientX,
          clientY: touch.clientY,
        });
      }
    }

    const touches = Array.from(this._touchState.touches.values()) as [
      { clientX: number; clientY: number },
      { clientX: number; clientY: number },
    ];
    if (touches.length !== 2) return;

    const currentAngle = this._getTouchAngle(touches[0], touches[1]);
    const angleDiff = currentAngle - this._touchState.initialAngle;

    const targetRotation = this._touchState.initialRotation + angleDiff;

    this.setRotation(targetRotation);
  }

  private _onTouchEnd(e: TouchEvent): void {
    for (const touch of e.changedTouches) {
      this._touchState.touches.delete(touch.identifier);
    }

    if (this._touchState.isRotating) {
      this._touchState.isRotating = false;

      const normalizedRotation = ((this.currentRotation % 360) + 360) % 360;
      const snapRotation = Math.round(normalizedRotation / 120) * 120;
      this.setRotation(snapRotation);
    }
  }

  private _calcBounds(): void {
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

    const cx = this._ox;
    const cy = 5 * this.hexSize + this._oy;
    this.svg.style.transformOrigin = `${(cx / w) * 100}% ${(cy / h) * 100}%`;
  }

  public render(): void {
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
      cg.dataset.q = String(cell.hex.q);
      cg.dataset.r = String(cell.hex.r);
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
      label.setAttribute("x", String(px.x));
      label.setAttribute("y", String(px.y + this.hexSize * 0.7));
      label.setAttribute("text-anchor", "middle");
      label.classList.add("hex-label");
      label.textContent = `${cell.hex.q},${cell.hex.r}`;
      label.style.transform = `rotate(${-this.currentRotation}deg)`;
      label.style.transformOrigin = `${px.x}px ${px.y + this.hexSize * 0.7}px`;
      label.style.transition = "transform 0.5s ease";
      cg.appendChild(label);

      cg.addEventListener("pointerdown", (e: PointerEvent) => {
        e.preventDefault();
        if (this.onCellClick) this.onCellClick(cell.hex, cell);
      });
      g.appendChild(cg);
      this.hexElements.set(key, {
        group: cg,
        polygon: poly,
        label: label,
        cell,
      });
    }
    this.svg.appendChild(g);
  }

  public highlightCells(hexes: Hex[], cls = "highlight-move"): void {
    for (const h of hexes) {
      const e = this.hexElements.get(h.key);
      if (e) e.polygon.classList.add(cls);
    }
  }

  public selectCell(hex: Hex): void {
    this.clearSelection();
    const e = this.hexElements.get(hex.key);
    if (e) e.polygon.classList.add("selected");
  }

  public clearHighlights(): void {
    for (const [, e] of this.hexElements) {
      e.polygon.classList.remove(
        "highlight-move",
        "highlight-attack",
        "highlight-attack-advantage",
        "highlight-attack-disadvantage",
        "highlight-check",
        "highlight-danger",
      );
    }
  }

  public clearSelection(): void {
    for (const [, e] of this.hexElements) {
      e.polygon.classList.remove("selected");
    }
  }

  /**
   * Highlights a king that is in check by adding the 'highlight-check' class to its hex cell.
   * @param kingHex - The hex position of the king in check
   */
  public highlightCheck(kingHex: Hex): void {
    const e = this.hexElements.get(kingHex.key);
    if (e) {
      e.polygon.classList.add("highlight-check");
    }
  }

  public clearCheck(): void {
    for (const [, e] of this.hexElements) {
      e.polygon.classList.remove("highlight-check");
    }
  }

  public renderPiece(piece: Piece): void {
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
    circ.setAttribute("r", String(this.hexSize * 0.38));
    circ.classList.add("piece-bg");
    g.appendChild(circ);
    const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
    txt.setAttribute("text-anchor", "middle");
    txt.setAttribute("dominant-baseline", "central");
    txt.setAttribute("font-size", String(this.hexSize * 0.48));
    txt.classList.add("piece-symbol");
    txt.textContent = piece.symbol;
    txt.style.transform = `rotate(${-this.currentRotation}deg)`;
    txt.style.transformOrigin = "0 0";
    txt.style.transition = "transform 0.5s ease";
    g.appendChild(txt);

    let pressTimer: number | null = null;
    const onPressStart = (e: PointerEvent) => {
      pressTimer = window.setTimeout(() => {
        if (this.onPieceLongPress) {
          this.onPieceLongPress(piece, {
            clientX: e.clientX,
            clientY: e.clientY,
          });
        }
      }, 500);
    };
    const onPressEnd = () => {
      if (pressTimer) clearTimeout(pressTimer);
    };

    g.addEventListener("pointerdown", onPressStart, { passive: true });
    g.addEventListener("pointerup", onPressEnd);
    g.addEventListener("pointerleave", onPressEnd);
    g.addEventListener("pointercancel", onPressEnd);
    g.addEventListener("contextmenu", (e: PointerEvent) => {
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
      this.pieceElements.set(piece.id, { id: piece.id, element: g });
    } else {
      console.warn("board-group not found, piece not rendered");
    }
  }

  public removePiece(id: string): void {
    const e = this.pieceElements.get(id);
    if (e) {
      e.element.remove();
      this.pieceElements.delete(id);
    }
  }

  public setRotation(deg: number): void {
    this.currentRotation = deg;
    this.svg.style.transform = `rotate(${this.currentRotation}deg)`;
    this.svg.style.transition = "transform 0.5s ease";
    document
      .querySelectorAll(".piece-symbol, .hex-label")
      .forEach((txt: Element) => {
        (txt as HTMLElement).style.transform =
          `rotate(${-this.currentRotation}deg)`;
      });
  }

  public async animateMove(
    piece: { id: string; pos: Hex },
    _from: Hex,
    to: Hex,
  ): Promise<void> {
    const el = this.pieceElements.get(piece.id);
    if (!el) return;
    const tp = hexToPixel(to, this.hexSize);
    el.element.style.transition = "transform 0.3s ease";
    el.element.setAttribute("transform", `translate(${tp.x},${tp.y})`);
    return new Promise((r) => setTimeout(r, 320));
  }

  private _addDefs(defs: SVGDefsElement): void {
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
