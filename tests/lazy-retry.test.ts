/**
 * retryImport — Robustheit der lazy geladenen Modul-Chunks.
 *
 * Deckt die drei Pfade ab: Erfolg beim ersten Versuch, Erfolg nach genau
 * einem Retry und endgültiges Scheitern (erster Fehler wird weitergereicht,
 * damit die Ursache sichtbar bleibt).
 */
import { describe, test, expect } from "vitest";
import { retryImport } from "../js/lazy-retry.ts";

describe("retryImport", () => {
  test("liefert das Ergebnis ohne Retry, wenn der Import gelingt", async () => {
    let calls = 0;
    const result = await retryImport(() => {
      calls++;
      return Promise.resolve("ok");
    });
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  test("wiederholt den Import einmal nach einem transienten Fehler", async () => {
    let calls = 0;
    const result = await retryImport(() => {
      calls++;
      if (calls === 1) return Promise.reject(new Error("Failed to fetch"));
      return Promise.resolve("second-attempt");
    });
    expect(result).toBe("second-attempt");
    expect(calls).toBe(2);
  });

  test("reicht den ersten Fehler weiter, wenn beide Versuche scheitern", async () => {
    let calls = 0;
    const first = new Error("Failed to fetch dynamically imported module");
    const second = new Error("zweiter Fehler");
    await expect(
      retryImport(() => {
        calls++;
        return Promise.reject(calls === 1 ? first : second);
      }),
    ).rejects.toThrow("Failed to fetch dynamically imported module");
    expect(calls).toBe(2);
  });
});
