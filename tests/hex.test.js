import { expect, test, describe } from "vitest";
import {
  Hex,
  hexNeighbors,
  hexDiagonals,
  hexKnightMoves,
  hexLine,
  hexToPixel,
  pixelToHex,
  hexCorners,
  hexPolygonPoints,
} from "../js/hex.js";

describe("Hex coordinates", () => {
  test("constructor calculates s correctly", () => {
    const hex = new Hex(1, 2);
    expect(hex.q).toBe(1);
    expect(hex.r).toBe(2);
    expect(hex.s).toBe(-3);
  });

  test("equals returns true for identical coordinates", () => {
    const hex1 = new Hex(1, -2);
    const hex2 = new Hex(1, -2);
    const hex3 = new Hex(2, -2);
    expect(hex1.equals(hex2)).toBe(true);
    expect(hex1.equals(hex3)).toBe(false);
  });

  test("add combines coordinates", () => {
    const hex1 = new Hex(1, -2);
    const hex2 = new Hex(3, 1);
    const result = hex1.add(hex2);
    expect(result.q).toBe(4);
    expect(result.r).toBe(-1);
    expect(result.s).toBe(-3);
  });

  test("subtract subtracts coordinates", () => {
    const hex1 = new Hex(3, -2);
    const hex2 = new Hex(1, 1);
    const result = hex1.subtract(hex2);
    expect(result.q).toBe(2);
    expect(result.r).toBe(-3);
    expect(result.s).toBe(1);
  });

  test("distance calculates correct distance", () => {
    const origin = new Hex(0, 0);
    expect(origin.distance(new Hex(0, 0))).toBe(0);
    expect(origin.distance(new Hex(1, 0))).toBe(1);
    expect(origin.distance(new Hex(1, -2))).toBe(2);
    expect(origin.distance(new Hex(2, -3))).toBe(3);

    const hex1 = new Hex(1, 1);
    const hex2 = new Hex(4, -2); // s = -2
    expect(hex1.distance(hex2)).toBe(3);
  });

  test("rotateCW and rotateCCW perform correct 60-degree rotations", () => {
    const hex = new Hex(1, 0); // E
    // CCW rotation of E is NE (1, -1)
    expect(hex.rotateCCW().equals(new Hex(1, -1))).toBe(true);
    // CW rotation of E is SE (0, 1)
    expect(hex.rotateCW().equals(new Hex(0, 1))).toBe(true);
  });

  test("toString returns string representation", () => {
    expect(new Hex(1, -2).toString()).toBe("Hex(1, -2)");
  });
});

describe("Hex geometry and conversions", () => {
  test("hexToPixel and pixelToHex are reversible", () => {
    const hex = new Hex(2, -3);
    const size = 36;
    const pixel = hexToPixel(hex, size);

    // Test conversion from pixel back to hex
    const reversedHex = pixelToHex(pixel.x, pixel.y, size);
    expect(reversedHex.equals(hex)).toBe(true);
  });

  test("pixelToHex correctly rounds fractional coords", () => {
    const size = 36;
    // Origin is exactly at 0,0
    expect(pixelToHex(0, 0, size).equals(new Hex(0, 0))).toBe(true);
    // Move slightly off origin, still hex(0,0)
    expect(pixelToHex(10, 10, size).equals(new Hex(0, 0))).toBe(true);

    // Move significantly to the right (x axis)
    expect(pixelToHex(62, 0, size).equals(new Hex(1, 0))).toBe(true);

    // Edge case: Force dq to be the largest diff (triggers rq = -rr - rs)
    // q = 0.6, r = 0.1 -> s = -0.7.
    // x = size * sqrt(3) * (q + r/2) = 36 * 1.732 * (0.6 + 0.05) = 40.5
    // y = size * 1.5 * r = 36 * 1.5 * 0.1 = 5.4
    expect(pixelToHex(40.5, 5.4, size).equals(new Hex(1, 0))).toBe(true);

    // Edge case: Force dr to be the largest diff (triggers rr = -rq - rs)
    // q = 0.1, r = 0.6 -> s = -0.7.
    // x = size * sqrt(3) * (0.1 + 0.3) = 36 * 1.732 * 0.4 = 24.9
    // y = size * 1.5 * 0.6 = 36 * 0.9 = 32.4
    expect(pixelToHex(24.9, 32.4, size).equals(new Hex(0, 1))).toBe(true);
  });

  test("hexCorners returns 6 corners", () => {
    const pixel = { x: 0, y: 0 };
    const corners = hexCorners(pixel, 36);
    expect(corners.length).toBe(6);
    // Each corner should be exactly 'size' distance from origin
    for (const c of corners) {
      const dist = Math.sqrt(c.x * c.x + c.y * c.y);
      expect(dist).toBeCloseTo(36, 4);
    }
  });

  test("hexPolygonPoints returns correct SVG string", () => {
    const pixel = { x: 0, y: 0 };
    const pts = hexPolygonPoints(pixel, 36);
    // Should contain 6 coordinate pairs separated by space
    expect(pts.split(" ").length).toBe(6);
    expect(pts).toContain(",");
  });
});

describe("Hex helpers", () => {
  test("hexNeighbors returns 6 neighbors", () => {
    const origin = new Hex(0, 0);
    const neighbors = hexNeighbors(origin);
    expect(neighbors.length).toBe(6);
    expect(neighbors.some((n) => n.equals(new Hex(1, 0)))).toBe(true);
    expect(neighbors.some((n) => n.equals(new Hex(0, -1)))).toBe(true);
  });

  test("hexDiagonals returns 6 diagonals", () => {
    const origin = new Hex(0, 0);
    const diagonals = hexDiagonals(origin);
    expect(diagonals.length).toBe(6);
    // All diagonals should be distance 2 from origin
    expect(diagonals.every((d) => origin.distance(d) === 2)).toBe(true);
  });

  test("hexKnightMoves returns exactly 6 moves", () => {
    const origin = new Hex(0, 0);
    const moves = hexKnightMoves(origin);
    expect(moves.length).toBe(6);
    // All knight moves should be distance 2
    expect(moves.every((m) => origin.distance(m) === 2)).toBe(true);

    // In this specific implementation, dist 2 without 0s corresponds to the 6 diagonals
    const diagonals = hexDiagonals(origin);
    for (const move of moves) {
      expect(diagonals.some((d) => d.equals(move))).toBe(true);
    }
  });

  test("hexLine returns points along a line", () => {
    const origin = new Hex(0, 0);
    const direction = new Hex(1, 0);
    const line = hexLine(origin, direction, 3);
    expect(line.length).toBe(3);
    expect(line[0].equals(new Hex(1, 0))).toBe(true);
    expect(line[1].equals(new Hex(2, 0))).toBe(true);
    expect(line[2].equals(new Hex(3, 0))).toBe(true);
  });
});
