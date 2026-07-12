import type { Faction } from "./types.ts";
import { FACTION, FACTION_COLORS } from "./board.ts";

/**
 * Board colour skins.
 *
 * A skin re-colours the three factions without touching gameplay: the faction
 * *names* (Feuer/Wasser/Natur) and the RPS relationships stay identical, only
 * the rendered colours change. Colours reach the board via two channels that a
 * skin must keep in sync:
 *   1. CSS custom properties (`--fire`/`--water`/`--nature` + `2` variants) —
 *      used by pieces, zones and UI accents in `css/style.css`.
 *   2. The `FACTION_COLORS` object in `board.ts` — used by inline `style="..."`
 *      strings in `main.ts` (turn indicator, combat overlay, promotion dialog).
 *
 * `applySkin()` updates both: it sets `data-skin` on <html> (CSS side) and
 * mutates `FACTION_COLORS` in place (JS side), then persists the choice.
 */

export interface FactionColor {
  primary: string;
  secondary: string;
  glow: string;
}

export interface Skin {
  id: string;
  /** Human-readable label shown in the settings selector. */
  label: string;
  colors: Record<Faction, FactionColor>;
}

/** Colours of the default (classic elemental) skin, mirrored from board.ts. */
const DEFAULT_COLORS: Record<Faction, FactionColor> = {
  [FACTION.FIRE]: { primary: "#FF4500", secondary: "#FF6B35", glow: "#FF6B3566" },
  [FACTION.WATER]: { primary: "#0099FF", secondary: "#00BFFF", glow: "#00BFFF66" },
  [FACTION.NATURE]: { primary: "#22CC44", secondary: "#32CD32", glow: "#32CD3266" },
} as Record<Faction, FactionColor>;

export const SKINS: Record<string, Skin> = {
  default: {
    id: "default",
    label: "🎨 Klassisch (Elemente)",
    colors: DEFAULT_COLORS,
  },
  "schwarz-rot-gold": {
    id: "schwarz-rot-gold",
    label: "🇩🇪 Schwarz-Rot-Gold",
    colors: {
      // Feuer → Rot
      [FACTION.FIRE]: {
        primary: "#E30613",
        secondary: "#FF3B3B",
        glow: "#FF3B3B66",
      },
      // Wasser → Schwarz (mid-grey so pieces stay visible on dark AND light bg)
      [FACTION.WATER]: {
        primary: "#4B5563",
        secondary: "#9CA3AF",
        glow: "#9CA3AF66",
      },
      // Natur → Gold
      [FACTION.NATURE]: {
        primary: "#F5C518",
        secondary: "#FFD84D",
        glow: "#FFD84D66",
      },
    } as Record<Faction, FactionColor>,
  },
};

export const DEFAULT_SKIN_ID = "default";
export const SKIN_STORAGE_KEY = "trischach-skin";

export function getSkin(id: string): Skin {
  return SKINS[id] ?? SKINS[DEFAULT_SKIN_ID]!;
}

/**
 * Apply a skin everywhere: CSS custom properties, the `data-skin` attribute,
 * and the JS-side `FACTION_COLORS` object. Returns the resolved skin id (falls
 * back to the default for an unknown id). Callers should re-render pieces
 * afterwards so inline colours refresh.
 *
 * The `root` / `colorTarget` parameters exist for testing in a DOM-less or
 * partial environment; production callers use the defaults.
 */
export function applySkin(
  id: string,
  root: { setAttribute(name: string, value: string): void; style?: { setProperty(prop: string, value: string): void } } | null =
    typeof document !== "undefined" ? document.documentElement : null,
  colorTarget: Record<Faction, { primary: string; secondary: string; glow: string; name: string }> =
    FACTION_COLORS,
): string {
  const skin = getSkin(id);

  // JS channel: mutate FACTION_COLORS in place (names are intentionally kept).
  for (const f of [FACTION.FIRE, FACTION.WATER, FACTION.NATURE] as Faction[]) {
    const c = skin.colors[f];
    colorTarget[f].primary = c.primary;
    colorTarget[f].secondary = c.secondary;
    colorTarget[f].glow = c.glow;
  }

  // CSS channel: data-skin attribute + custom properties.
  if (root) {
    root.setAttribute("data-skin", skin.id);
    const style = root.style;
    if (style) {
      style.setProperty("--fire", skin.colors[FACTION.FIRE].primary);
      style.setProperty("--fire2", skin.colors[FACTION.FIRE].secondary);
      style.setProperty("--water", skin.colors[FACTION.WATER].primary);
      style.setProperty("--water2", skin.colors[FACTION.WATER].secondary);
      style.setProperty("--nature", skin.colors[FACTION.NATURE].primary);
      style.setProperty("--nature2", skin.colors[FACTION.NATURE].secondary);
    }
  }

  return skin.id;
}

/** Load the persisted skin id (falls back to default). */
export function loadSkinId(): string {
  try {
    const stored =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(SKIN_STORAGE_KEY)
        : null;
    if (stored && SKINS[stored]) return stored;
  } catch {
    /* localStorage unavailable — use default */
  }
  return DEFAULT_SKIN_ID;
}

/** Persist a skin id. */
export function saveSkinId(id: string): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(SKIN_STORAGE_KEY, getSkin(id).id);
    }
  } catch {
    /* localStorage unavailable — ignore */
  }
}
