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

  test("nennt in der Statistik Automatisch, Tages-Serie und Bestwert", () => {
    // eslint-disable-next-line no-undef
    const main = fs.readFileSync(
      path.resolve(__dirname, "../js/main.ts"),
      "utf8",
    );
    const stats = main.slice(
      main.indexOf("📊 Statistiken"),
      main.indexOf("stats-feedback-section"),
    );
    expect(stats).toContain("🤖 Automatisch:");
    expect(stats).toContain("Tages-Serie:");
    expect(stats).toContain("(Bestwert:");
    expect(stats).not.toContain("Auto-Battle");
    expect(stats).not.toContain("Daily-Streak");
    expect(stats).not.toContain("Best:");
  });

  test("Puzzle nennt Tages-Serie, Bestwert, Bestzeit und Mittel", () => {
    // eslint-disable-next-line no-undef
    const main = fs.readFileSync(
      path.resolve(__dirname, "../js/main.ts"),
      "utf8",
    );
    expect(main).toContain("🔥 Tages-Serie:");
    expect(main).toContain("Bestwert:");
    expect(main).toContain("🏅 Bestzeit:");
    expect(main).toContain('? "Mittel"');
    expect(main).not.toContain("🔥 Streak:");
    expect(main).not.toContain(">Best: <");
    expect(main).not.toContain("(Best ");
    expect(main).not.toContain('? "Medium"');
  });

  test("Lernergebnis bricht mit echten Zeilen um", () => {
    // eslint-disable-next-line no-undef
    const main = fs.readFileSync(
      path.resolve(__dirname, "../js/main.ts"),
      "utf8",
    );
    const css = fs.readFileSync(
      path.resolve(__dirname, "../css/style.css"),
      "utf8",
    );
    expect(main).toContain("Spiele gespielt.\\n");
    expect(main).toContain("Spiele insgesamt.\\n");
    expect(main).not.toContain("gespielt.\\\\n");
    expect(main).not.toContain("insgesamt.\\\\n");
    expect(css).toContain("white-space: pre-wrap");
  });
});
