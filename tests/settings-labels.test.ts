import fs from "fs";
import path from "path";
import { describe, expect, test } from "vitest";

describe("Einstellungen", () => {
  test("nennt Lernen und Eröffnungsbuch und den Browser als Speicher", () => {
    // eslint-disable-next-line no-undef
    const root = path.resolve(__dirname, "..");
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const main = fs.readFileSync(path.join(root, "js/main.ts"), "utf8");
    const settings = html.slice(
      html.indexOf('id="settings-overlay"'),
      html.indexOf('src="js/main.ts"'),
    );
    expect(settings).toContain("Lernen");
    expect(settings).toContain("Eröffnungsbuch");
    expect(settings).toContain("bleiben in");
    expect(settings).toContain("diesem Browser");
    expect(settings).not.toContain("Auto-Battle Learning");
    expect(settings).not.toContain("Opening Book");
    expect(settings).not.toContain("opening-book.learned.json");
    expect(settings).not.toContain("Self-Play");
    expect(main).toContain("Lernen abgeschlossen");
    expect(main).toContain("In diesem Browser gespeichert");
    expect(main).toContain("Lade das Eröffnungsbuch");
    expect(main).not.toContain("Auto-Battle Learning abgeschlossen");
    expect(main).not.toContain("Auto-Battle Learning fehlgeschlagen");
    expect(main).not.toContain("Auto-Battle Learning fortgesetzt");
    expect(main).not.toContain("Auto-Battle Learning Fortsetzen");
    expect(main).not.toContain("Opening Book Statistiken");
    expect(main).not.toContain("Opening Book Daten");
    expect(main).not.toContain("In localStorage gespeichert");
  });
});
