#!/usr/bin/env node
// Copy static assets to dist/ after vite build

import fs from "fs";
import path from "path";

const assets = [
  { src: "index.html", dest: "dist/index.html" },
  { src: "manifest.json", dest: "dist/manifest.json" },
  { src: "sw.js", dest: "dist/sw.js" },
  { src: "css", dest: "dist/css", isDir: true },
  { src: "icons", dest: "dist/icons", isDir: true },
];

for (const asset of assets) {
  const src = asset.src;
  const dest = asset.dest;

  if (!fs.existsSync(src)) {
    console.warn(`⚠️  Source not found: ${src}`);
    continue;
  }

  if (asset.isDir) {
    fs.cpSync(src, dest, { recursive: true });
    console.log(`📁 Copied ${src}/ → ${dest}/`);
  } else {
    fs.copyFileSync(src, dest);
    console.log(`📄 Copied ${src} → ${dest}`);
  }
}

console.log("✅ Assets copied to dist/");
