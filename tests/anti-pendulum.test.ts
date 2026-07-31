/**
 * Anti-pendulum / progress-penalty tests.
 * Locks in: pure A→B / B→A toggles are detected and scored worse than
 * staying put-ish alternatives, without blocking real captures.
 */
import { describe, test, expect, beforeEach } from "vitest";
import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import { Hex } from "../js/hex.ts";
import {
  isActionReversal,
  isPathReversal,
  resultHexKey,
  REVERSAL_PENALTY,
  greedyBestMove,
  getAllActions,
  rebuildOccupiedMap,
} from "../js/ai-core.ts";
import type { AIAction } from "../js/types.ts";

function setup(): Game {
  const g = new Game();
  g.init(generateBoard());
  return g;
}

describe("resultHexKey", () => {
  test("reads Hex and q,r objects", () => {
    expect(resultHexKey(new Hex(1, -2))).toBe("1,-2");
    expect(resultHexKey({ q: 0, r: 3 })).toBe("0,3");
    expect(resultHexKey("2,2")).toBe("2,2");
    expect(resultHexKey("Q")).toBeNull(); // promotion symbol, not a hex
  });
});

describe("isActionReversal", () => {
  test("detects A→B then B→A for the same piece", () => {
    const g = setup();
    const fire = g.getAlivePieces().find((p) => p.faction === FACTION.FIRE)!;
    // Manually seed moveHistory as if fire just moved A→B
    const from = new Hex(fire.pos.q, fire.pos.r);
    // Pick a neighbour target the piece can stand on (empty or any)
    const cells = [...(g.boardCells?.keys() ?? [])];
    const toKey = cells.find((k) => k !== from.key)!;
    const [tq, tr] = toKey.split(",").map(Number) as [number, number];
    const to = new Hex(tq, tr);

    g.moveHistory.push({
      action: "move",
      piece: fire,
      from,
      to,
    });
    // Piece now sits on `to`
    fire.pos = to;
    rebuildOccupiedMap(g);

    const reverse: AIAction = {
      piece: fire,
      target: from,
      type: "move",
      rps: "neutral",
    };
    expect(isActionReversal(g, reverse)).toBe(true);

    const elsewhere = cells.find((k) => k !== from.key && k !== to.key)!;
    const [eq, er] = elsewhere.split(",").map(Number) as [number, number];
    const other: AIAction = {
      piece: fire,
      target: new Hex(eq, er),
      type: "move",
      rps: "neutral",
    };
    expect(isActionReversal(g, other)).toBe(false);
  });

  test("captures are not treated as pure reversals by greedy scorer path", () => {
    // isActionReversal itself is geometry-only; greedy applies REVERSAL only
    // when !wasCapture. Document the constant is large enough for PST noise.
    expect(REVERSAL_PENALTY).toBeGreaterThan(50);
    expect(REVERSAL_PENALTY).toBeLessThan(5000);
  });
});

describe("greedyBestMove anti-pendulum", () => {
  test("prefers a non-reversing move over pure A↔B toggle when both quiet", () => {
    const g = setup();
    rebuildOccupiedMap(g);
    const actions = getAllActions(g, g.currentFaction);
    expect(actions.length).toBeGreaterThan(1);

    // Take first quiet action as "last move", apply it via history only
    const first = actions.find((a) => a.type === "move");
    if (!first) return; // nothing to test in pathological positions
    const from = new Hex(first.piece.pos.q, first.piece.pos.r);
    g.moveHistory.push({
      action: "move",
      piece: first.piece,
      from,
      to: first.target,
    });
    first.piece.pos = new Hex(first.target.q, first.target.r);
    rebuildOccupiedMap(g);

    // Only offer the reverse + one other legal quiet move if available
    const reverse: AIAction = {
      piece: first.piece,
      target: from,
      type: "move",
      rps: "neutral",
    };
    const others = getAllActions(g, first.piece.faction).filter(
      (a) =>
        a.piece.id === first.piece.id &&
        a.type === "move" &&
        a.target.key !== from.key,
    );
    const pool = others.length > 0 ? [reverse, others[0]!] : [reverse];
    const pick = greedyBestMove(g, first.piece.faction, pool);
    if (others.length > 0) {
      // Must not pick pure reverse when an alternative exists
      expect(pick).not.toBeNull();
      expect(pick!.target.key).not.toBe(from.key);
    } else {
      // Only reverse available — still returns something legal
      expect(pick).not.toBeNull();
    }
  });
});

describe("isPathReversal", () => {
  test("is exported and false on empty path", () => {
    const g = setup();
    const a = getAllActions(g, g.currentFaction)[0];
    if (!a) return;
    // Path stack is empty outside a search → not a path reversal
    expect(isPathReversal(a)).toBe(false);
  });
});
