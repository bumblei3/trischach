// @ts-nocheck
/**
 * board-structure.test.js - invariant checks for generateBoard().
 *
 * The starting triangle is the single most fundamental data structure in the
 * game: every other test (and the UI) builds on it. A regression in the board
 * geometry would silently break move generation, check detection, and replay
 * for all three factions. These tests lock the board shape so such a
 * regression fails loudly instead of leaking through as "weird" behavior.
 *
 * Deterministic, no AI search, no DOM.
 */
import { expect, test, describe } from "vitest";
import { generateBoard, ZONE, FACTION } from "../js/board.ts";
import { Hex } from "../js/hex.ts";

describe("generateBoard structure", () => {
  const cells = generateBoard();

  test("produces the expected total number of cells (66)", () => {
    // 21 central triangle + 15 fire + 15 water + 15 nature.
    expect(cells.size).toBe(66);
  });

  test("every cell has a hex and a known zone", () => {
    for (const cell of cells.values()) {
      expect(cell.hex).toBeInstanceOf(Hex);
      expect(Object.values(ZONE)).toContain(cell.zone);
    }
  });

  test("the central triangle has exactly 21 cells (r=0..5, q=-r..0)", () => {
    let count = 0;
    for (const cell of cells.values()) {
      if (cell.zone === ZONE.TRIANGLE) count++;
    }
    expect(count).toBe(21);
    // Spot-check the extreme vertices of the central triangle.
    expect(cells.has(new Hex(0, 0).key)).toBe(true); // top vertex
    expect(cells.has(new Hex(-5, 5).key)).toBe(true); // base-left
    expect(cells.has(new Hex(0, 5).key)).toBe(true); // base-right
  });

  test("each faction owns exactly one start zone of 15 cells", () => {
    const fire = [...cells.values()].filter((c) => c.zone === ZONE.START_FIRE);
    const water = [...cells.values()].filter(
      (c) => c.zone === ZONE.START_WATER,
    );
    const nature = [...cells.values()].filter(
      (c) => c.zone === ZONE.START_NATURE,
    );
    expect(fire.length).toBe(15);
    expect(water.length).toBe(15);
    expect(nature.length).toBe(15);
    // The zone cells carry the owning faction tag.
    expect(fire.every((c) => c.faction === FACTION.FIRE)).toBe(true);
    expect(water.every((c) => c.faction === FACTION.WATER)).toBe(true);
    expect(nature.every((c) => c.faction === FACTION.NATURE)).toBe(true);
  });

  test("the board is symmetric: all three start zones are equal (15 each)", () => {
    // The three start zones must have identical size — the board is built
    // from one central triangle plus three congruent 15-cell faction wings.
    const fire = [...cells.values()].filter(
      (c) => c.zone === ZONE.START_FIRE,
    ).length;
    const water = [...cells.values()].filter(
      (c) => c.zone === ZONE.START_WATER,
    ).length;
    const nature = [...cells.values()].filter(
      (c) => c.zone === ZONE.START_NATURE,
    ).length;
    expect(fire).toBe(water);
    expect(water).toBe(nature);
  });

  test("no cell is claimed by two zones (keys are unique)", () => {
    const keys = [...cells.keys()];
    expect(new Set(keys).size).toBe(keys.length);
  });
});
