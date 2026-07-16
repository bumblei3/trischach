// Regression test for the GitHub Pages subpath 404 bug.
//
// TriSchach is published to a subpath (https://bumblei3.github.io/trischach/),
// not the domain root. Without `base: "./"` in vite.config.ts, Vite emits
// absolute asset URLs like `/main.js`, which 404 on Pages (the file lives at
// /trischach/main.js). This spec serves the *built* dist/ under a subpath and
// asserts the board actually renders — catching the exact production regression
// that slipped through CI before (#24 deployed an index.html whose module
// script 404'd, leaving a blank board).
//
// It serves dist locally (no external network dependency), so it is
// deterministic in CI and still exercises the real base-"./" resolution.
import { test, expect } from "./base";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const DIST = join(process.cwd(), "dist");
const SUBPATH = "/trischach";
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".map": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

test("built site renders the board under a subpath (base './')", async ({
  page,
}) => {
  const server = createServer(async (req, res) => {
    try {
      const raw = req.url ?? "/";
      let p = decodeURIComponent(raw.split("?")[0] ?? "");
      if (p.startsWith(SUBPATH)) p = p.slice(SUBPATH.length) || "/";
      const file = normalize(join(DIST, p === "/" ? "index.html" : p));
      if (!file.startsWith(DIST)) {
        res.writeHead(403);
        return res.end();
      }
      const data = await readFile(file);
      res.writeHead(200, {
        "content-type": MIME[extname(file)] || "text/plain",
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  const url = `http://localhost:${port}${SUBPATH}/`;

  const failed: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  page.on("pageerror", (e) => failed.push("pageerror: " + e.message));

  const resp = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  expect(resp?.status(), "HTTP status").toBeLessThan(400);
  // Wait for the board to render. Use a fixed settle window rather than
  // networkidle: the app lazily fetches optional assets (e.g.
  // opening-book.learned.json) that never reach a fully-idle network state,
  // which made the networkidle wait flaky under CI load.
  await page.waitForSelector("#board-svg [class*='piece']", { timeout: 10000 });
  await page.waitForTimeout(500);

  const pieceCount = await page.locator("#board-svg [class*='piece']").count();

  console.log("SUBPATH piece count:", pieceCount, "| failures:", failed);
  expect(
    pieceCount,
    `expected pieces on board under subpath, got ${pieceCount}. failures=${failed.join("; ")}`,
  ).toBeGreaterThan(20);

  // The only acceptable 404 is the optional learned opening book, which the
  // app fetches lazily and tolerates when absent. Anything else (main.js,
  // css, chunks) means the base-"./" fix regressed.
  const unacceptable = failed.filter(
    (f) => !f.includes("opening-book.learned.json"),
  );
  expect(
    unacceptable,
    `unexpected failed requests: ${unacceptable.join("; ")}`,
  ).toEqual([]);

  await new Promise<void>((r) => server.close(() => r()));
});
