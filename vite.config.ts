import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "js/main.js"),
        "ai-worker": resolve(__dirname, "js/ai-worker.js"),
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
  resolve: {
    alias: {
      "@": resolve(__dirname, "js"),
    },
  },
});
