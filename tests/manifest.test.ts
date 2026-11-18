/**
 * Der Einstiegspunkt des PWA-Manifests hängt am absoluten Pfad — das Repo wird
 * aber unter /trischach/ ausgeliefert (vite `base: "./"`). `start_url: "/"`
 * hatte die installierte App auf https://bumblei3.github.io/ geöffnet (404),
 * und die Shortcut-Ziele lagen außerhalb des Scope. Beides sieht im Browser
 * nicht fehlerhaft aus, solange man nur die Startseite aufruft.
 *
 * Der Test löst die URLs gegen die Manifest-URL auf und verlangt, dass sie
 * innerhalb von /trischach/ bleiben. Außerdem muss jede referenzierte Icon-
 * Datei im Repo existieren — die Shortcuts zeigten auf `icon-192.png`, das es
 * nie gab.
 */
import fs from "fs";
import path from "path";
import { describe, expect, test } from "vitest";

const MANIFEST_URL = "https://bumblei3.github.io/trischach/manifest.json";
const SCOPE = "https://bumblei3.github.io/trischach/";
const ROOT = path.resolve(__dirname, "..");

interface Manifest {
  start_url: string;
  icons: { src: string; sizes: string; type?: string }[];
  shortcuts: {
    name: string;
    url: string;
    icons: { src: string; sizes: string }[];
  }[];
}

const manifest: Manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"),
) as Manifest;

describe("PWA-Manifest", () => {
  test("start_url zeigt auf die Seite, nicht auf den Host-Wurzelpfad", () => {
    expect(new URL(manifest.start_url, MANIFEST_URL).href).toBe(SCOPE);
  });

  test("Shortcut-Ziele bleiben innerhalb des Scope", () => {
    expect(manifest.shortcuts.length).toBeGreaterThan(0);
    for (const shortcut of manifest.shortcuts) {
      const resolved = new URL(shortcut.url, MANIFEST_URL).href;
      expect(resolved.startsWith(SCOPE), `${shortcut.name}: ${resolved}`).toBe(
        true,
      );
    }
  });

  test("jedes referenzierte Icon existiert im Repo", () => {
    const referenced = [
      ...manifest.icons.map((icon) => icon.src),
      ...manifest.shortcuts.flatMap((shortcut) =>
        shortcut.icons.map((icon) => icon.src),
      ),
    ];
    expect(referenced.length).toBeGreaterThan(0);
    for (const src of referenced) {
      expect(fs.existsSync(path.join(ROOT, src)), src).toBe(true);
    }
  });
});
