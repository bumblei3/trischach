import fs from "fs";
import path from "path";
import { describe, expect, test } from "vitest";

describe("Spiel-Leiste", () => {
  test("uses German labels and does not reset them to English", () => {
    // eslint-disable-next-line no-undef
    const root = path.resolve(__dirname, "..");
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const main = fs.readFileSync(path.join(root, "js/main.ts"), "utf8");
    expect(html).toContain("↩ Rückgängig");
    expect(html).toContain("🤖 Automatisch");
    expect(html).toContain(">Runde zu dritt</option>");
    expect(html).not.toContain("Undo");
    expect(html).not.toContain("Auto Battle");
    expect(html).not.toContain("Alle Menschen");
    expect(main).toContain("🤖 Automatisch");
    expect(main).toContain("⏹ Automatisch stoppen");
    expect(main).not.toContain("Auto Battle");
  });
});
