import { test, expect, describe } from "vitest";
import { FACTION, FACTION_COLORS } from "../js/board.ts";
import {
  SKINS,
  DEFAULT_SKIN_ID,
  applySkin,
  getSkin,
  loadSkinId,
  saveSkinId,
} from "../js/skins.ts";

describe("Skins module", () => {
  test("default skin maps the three factions to the elemental palette", () => {
    const def = SKINS[DEFAULT_SKIN_ID]!;
    expect(def.colors[FACTION.FIRE].primary).toBe("#FF4500");
    expect(def.colors[FACTION.WATER].primary).toBe("#0099FF");
    expect(def.colors[FACTION.NATURE].primary).toBe("#22CC44");
  });

  test("schwarz-rot-gold maps Feuer→Rot, Wasser→Schwarz, Natur→Gold", () => {
    const skin = SKINS["schwarz-rot-gold"]!;
    expect(skin.id).toBe("schwarz-rot-gold");
    expect(skin.colors[FACTION.FIRE].primary).toBe("#E30613"); // Rot
    expect(skin.colors[FACTION.WATER].primary).toBe("#4B5563"); // Schwarz-grau
    expect(skin.colors[FACTION.NATURE].primary).toBe("#F5C518"); // Gold
  });

  test("applySkin mutates FACTION_COLORS in place and keeps names", () => {
    const fireBefore = FACTION_COLORS[FACTION.FIRE].name;
    const id = applySkin("schwarz-rot-gold");
    expect(id).toBe("schwarz-rot-gold");
    expect(FACTION_COLORS[FACTION.FIRE].primary).toBe("#E30613");
    expect(FACTION_COLORS[FACTION.WATER].primary).toBe("#4B5563");
    expect(FACTION_COLORS[FACTION.NATURE].primary).toBe("#F5C518");
    // Names must stay untouched — RPS logic depends on them.
    expect(FACTION_COLORS[FACTION.FIRE].name).toBe(fireBefore);
    expect(FACTION_COLORS[FACTION.FIRE].name).toContain("Feuer");

    // Restore so other suites keep the default colours.
    applySkin("default");
    expect(FACTION_COLORS[FACTION.FIRE].primary).toBe("#FF4500");
  });

  test("applySkin sets data-skin and CSS custom properties on the root", () => {
    const root = makeFakeRoot();
    applySkin("schwarz-rot-gold", root, FACTION_COLORS);
    expect(root.attrs["data-skin"]).toBe("schwarz-rot-gold");
    expect(root.styleProps["--fire"]).toBe("#E30613");
    expect(root.styleProps["--water"]).toBe("#4B5563");
    expect(root.styleProps["--nature"]).toBe("#F5C518");
    applySkin("default", root, FACTION_COLORS);
  });

  test("getSkin falls back to default for an unknown id", () => {
    expect(getSkin("nope").id).toBe(DEFAULT_SKIN_ID);
  });

  test("loadSkinId returns default when storage is empty", () => {
    const saved = (globalThis as any).localStorage?.getItem("trischach-skin");
    (globalThis as any).localStorage?.removeItem("trischach-skin");
    expect(loadSkinId()).toBe(DEFAULT_SKIN_ID);
    if (saved !== undefined && saved !== null) {
      (globalThis as any).localStorage?.setItem("trischach-skin", saved);
    }
  });

  test("saveSkinId persists the resolved id and loadSkinId round-trips", () => {
    const saved = localStorage.getItem("trischach-skin");
    try {
      saveSkinId("schwarz-rot-gold");
      expect(localStorage.getItem("trischach-skin")).toBe("schwarz-rot-gold");
      // loadSkinId must read back the persisted, valid id.
      expect(loadSkinId()).toBe("schwarz-rot-gold");
    } finally {
      if (saved !== null && saved !== undefined) {
        localStorage.setItem("trischach-skin", saved);
      } else {
        localStorage.removeItem("trischach-skin");
      }
    }
  });

  test("saveSkinId falls back to default id for an unknown skin", () => {
    const saved = localStorage.getItem("trischach-skin");
    try {
      saveSkinId("does-not-exist");
      expect(localStorage.getItem("trischach-skin")).toBe(DEFAULT_SKIN_ID);
    } finally {
      if (saved !== null && saved !== undefined) {
        localStorage.setItem("trischach-skin", saved);
      } else {
        localStorage.removeItem("trischach-skin");
      }
    }
  });
});

// ─── helpers ──────────────────────────────────────────────────────────────
function makeFakeRoot(): {
  attrs: Record<string, string>;
  styleProps: Record<string, string>;
  setAttribute(name: string, value: string): void;
  style: { setProperty(prop: string, value: string): void };
} {
  const attrs: Record<string, string> = {};
  const styleProps: Record<string, string> = {};
  return {
    attrs,
    styleProps,
    setAttribute(name, value) {
      attrs[name] = value;
    },
    style: {
      setProperty(prop, value) {
        styleProps[prop] = value;
      },
    },
  };
}
