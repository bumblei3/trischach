import type { Game } from "./game.ts";

let GameClass: typeof Game | null = null;

/**
 * Lazy-Import der Game-Klasse. Verhindert, dass game.ts (784 Zeilen) im
 * main-Chunk landet — rollup kann es sonst nicht splitten, weil main.ts es
 * sowohl statisch als auch dynamisch importiert.
 */
export async function loadGame(): Promise<typeof Game> {
  if (!GameClass) {
    const mod = await import("./game.ts");
    GameClass = mod.Game;
  }
  return GameClass;
}

/**
 * synchroner Zugriff auf eine Game-Instanz.
 * Nur in async-Kontexten verwenden!
 */
export async function createGame(): Promise<Game> {
  const Ctor = await loadGame();
  return new Ctor();
}
