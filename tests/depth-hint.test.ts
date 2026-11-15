import fs from "fs";
import path from "path";
import { describe, expect, test } from "vitest";

describe("KI-Tiefe hint", () => {
  test("says the opening is one ply until fewer than 25 pieces", () => {
    // eslint-disable-next-line no-undef
    const html = fs.readFileSync(
      path.resolve(__dirname, "../index.html"),
      "utf8",
    );
    const hint = html.slice(
      html.indexOf('id="depth-hint"'),
      html.indexOf('id="personality-select"'),
    );
    expect(hint).toContain("spielt die KI einzügig");
    expect(hint).toContain("weniger als 25 Figuren");
    expect(html).toContain('aria-describedby="depth-hint"');
  });
});
