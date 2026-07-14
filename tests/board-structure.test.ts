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

  test("board is 120° rotationally symmetric: each start zone maps onto the next", () => {
    // The three factions must be perfectly interchangeable — a 3-player game is
    // only fair if the board has 3-fold rotational symmetry. The centre of that
    // symmetry is NOT the origin (0,0) (that is the apex of the central
    // triangle), so we look for a single translation t such that a 120°
    // rotation about the origin followed by +t cycles FIRE→WATER→NATURE→FIRE
    // and keeps the whole board invariant.
    //
    // (A naive rotate-about-origin check gives a FALSE asymmetry: it was the
    // exact mistake that once sent NNUE debugging down a wrong path. This test
    // pins the CORRECT invariant so a real board change that breaks fairness
    // fails loudly, and the false alarm can never recur.)
    const all = [...cells.values()];
    const keyset = (hs: Hex[]) => new Set(hs.map((h) => h.key));
    const zone = (z: string) =>
      all.filter((c) => c.zone === z).map((c) => c.hex);
    // 120° rotation about origin in cube coords: (q,r,s) → (r,s,q).
    const rot120 = (h: Hex) => new Hex(h.r, -h.q - h.r);
    const allKeys = keyset(all.map((c) => c.hex));

    // Find the unique translation mapping rot120(src) onto dst (as sets).
    const findT = (src: Hex[], dst: Hex[]): Hex | null => {
      const dstKeys = keyset(dst);
      const r0 = rot120(src[0]!);
      for (const d of dst) {
        const t = new Hex(d.q - r0.q, d.r - r0.r);
        const mapped = src.map(
          (h) => new Hex(rot120(h).q + t.q, rot120(h).r + t.r),
        );
        if (
          mapped.length === dst.length &&
          mapped.every((h) => dstKeys.has(h.key))
        )
          return t;
      }
      return null;
    };

    const fire = zone(ZONE.START_FIRE);
    const water = zone(ZONE.START_WATER);
    const nature = zone(ZONE.START_NATURE);
    const tFW = findT(fire, water);
    const tWN = findT(water, nature);
    const tNF = findT(nature, fire);

    // Each zone maps onto the next in the RPS cycle.
    expect(tFW).not.toBeNull();
    expect(tWN).not.toBeNull();
    expect(tNF).not.toBeNull();
    // A single rotation centre ⇒ identical translation for all three steps.
    expect(tFW!.key).toBe(tWN!.key);
    expect(tWN!.key).toBe(tNF!.key);

    // The whole board (triangle + all wings) is invariant under rot120 + t.
    const mappedAll = all.map((c) => {
      const rr = rot120(c.hex);
      return new Hex(rr.q + tFW!.q, rr.r + tFW!.r);
    });
    expect(mappedAll.length).toBe(allKeys.size);
    expect(mappedAll.every((h) => allKeys.has(h.key))).toBe(true);
  });
});
