/**
 * hex.js – Cube Coordinate Hex Library for TriSchach
 * Based on https://www.redblobgames.com/grids/hexagons/
 * Uses pointy-top hexagons with axial (q,r) / cube (q,r,s) coordinates.
 */

export class Hex {
  constructor(q, r) {
    this.q = q;
    this.r = r;
    this.s = -q - r;
  }

  get key() {
    return `${this.q},${this.r}`;
  }

  equals(other) {
    return this.q === other.q && this.r === other.r;
  }

  add(other) {
    return new Hex(this.q + other.q, this.r + other.r);
  }

  subtract(other) {
    return new Hex(this.q - other.q, this.r - other.r);
  }

  scale(factor) {
    return new Hex(this.q * factor, this.r * factor);
  }

  distance(other) {
    const vec = this.subtract(other);
    return Math.max(Math.abs(vec.q), Math.abs(vec.r), Math.abs(vec.s));
  }

  /** Rotate 60° clockwise around origin */
  rotateCW() {
    return new Hex(-this.r, -this.s);
  }

  /** Rotate 60° counter-clockwise around origin */
  rotateCCW() {
    return new Hex(-this.s, -this.q);
  }

  toString() {
    return `Hex(${this.q}, ${this.r})`;
  }
}

// 6 main directions (pointy-top hex neighbors)
export const HEX_DIRECTIONS = [
  new Hex(+1, 0), // E
  new Hex(+1, -1), // NE
  new Hex(0, -1), // NW
  new Hex(-1, 0), // W
  new Hex(-1, +1), // SW
  new Hex(0, +1), // SE
];

// 6 diagonal directions
export const HEX_DIAGONALS = [
  new Hex(+2, -1), // ENE
  new Hex(+1, -2), // NNE
  new Hex(-1, -1), // NNW
  new Hex(-2, +1), // WSW
  new Hex(-1, +2), // SSW
  new Hex(+1, +1), // SSE
];

/**
 * Get all 6 neighbors of a hex.
 */
export function hexNeighbors(hex) {
  return HEX_DIRECTIONS.map((d) => hex.add(d));
}

/**
 * Get all 6 diagonal neighbors.
 */
export function hexDiagonals(hex) {
  return HEX_DIAGONALS.map((d) => hex.add(d));
}

/**
 * Get the hex knight-move targets (distance 2, not on a straight line).
 * There are 12 such positions on a hex grid.
 */
export function hexKnightMoves(hex) {
  const moves = [];
  for (let dq = -2; dq <= 2; dq++) {
    for (let dr = -2; dr <= 2; dr++) {
      const ds = -dq - dr;
      if (Math.abs(ds) > 2) continue;
      const dist = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
      if (dist !== 2) continue;
      // Exclude straight-line moves (one coordinate is 0)
      if (dq === 0 || dr === 0 || ds === 0) continue;
      moves.push(hex.add(new Hex(dq, dr)));
    }
  }
  return moves;
}

/**
 * Get all hexes on a straight line from origin in a given direction,
 * up to maxDist steps. Does NOT include the origin hex.
 */
export function hexLine(origin, direction, maxDist) {
  const results = [];
  let current = origin;
  for (let i = 0; i < maxDist; i++) {
    current = current.add(direction);
    results.push(current);
  }
  return results;
}

/**
 * Convert hex (axial) to pixel coordinates (pointy-top).
 */
export function hexToPixel(hex, size) {
  const x = size * (Math.sqrt(3) * hex.q + (Math.sqrt(3) / 2) * hex.r);
  const y = size * ((3 / 2) * hex.r);
  return { x, y };
}

/**
 * Convert pixel to fractional hex coordinates, then round.
 */
export function pixelToHex(x, y, size) {
  const q = ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / size;
  const r = ((2 / 3) * y) / size;
  return hexRound(q, r);
}

/**
 * Round fractional hex coordinates to nearest hex.
 */
function hexRound(q, r) {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  let rs = Math.round(s);

  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);

  if (dq > dr && dq > ds) {
    rq = -rr - rs;
  } else if (dr > ds) {
    rr = -rq - rs;
  }
  // else rs = -rq - rr (implicit)

  return new Hex(rq, rr);
}

/**
 * Get the 6 corner points of a hex for SVG rendering (pointy-top).
 */
export function hexCorners(center, size) {
  const corners = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    corners.push({
      x: center.x + size * Math.cos(angle),
      y: center.y + size * Math.sin(angle),
    });
  }
  return corners;
}

/**
 * Get SVG polygon points string for a hex.
 */
export function hexPolygonPoints(center, size) {
  return hexCorners(center, size)
    .map((c) => `${c.x},${c.y}`)
    .join(" ");
}
