import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  // Relative base so the built assets resolve correctly when the site is
  // served from a subpath (GitHub Pages publishes to /<repo>/, e.g.
  // bumblei3.github.io/trischach/). With the default base "/" the emitted
  // index.html references /main.js etc. as absolute paths from the domain
  // root, which 404 on Pages (the files live under /trischach/). "./" makes
  // every asset path relative to index.html so it works under the subpath.
  base: "./",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        "ai-worker": resolve(__dirname, "js/ai-worker.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name].[ext]",
        inlineDynamicImports: false,
        format: "es",
      },
    },
    outDir: "dist",
    sourcemap: true,
    minify: "terser",
    target: "es2022",
  },
  // Dev-Server: Die lazy geladenen Modul-Chunks beim Start vortransformieren.
  // Ohne das scheitert der jeweils erste Dynamic-Import unter Last sporadisch
  // ("Failed to fetch dynamically imported module"), was die E2E-Suite kippt:
  // der Aufruf-await wirft, das Overlay bleibt leer und der Test läuft in den
  // Timeout. Im Production-Build (statische Chunks) tritt das nicht auf.
  server: {
    warmup: {
      clientFiles: [
        "./js/puzzle.ts",
        "./js/replay.ts",
        "./js/analysis.ts",
        "./js/coach.ts",
        "./js/rps-puzzle.ts",
      ],
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "js"),
    },
  },
});
