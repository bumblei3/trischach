const fs = require("fs");
const { createCanvas } = require("canvas");

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

if (!fs.existsSync("icons")) {
  fs.mkdirSync("icons");
}

for (const size of sizes) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  // Background
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, "#FF4500");
  gradient.addColorStop(0.5, "#22CC44");
  gradient.addColorStop(1, "#0099FF");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  // TriSchach symbol
  ctx.font = `${size * 0.5}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "white";
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = size * 0.02;
  ctx.strokeText("⚔️", size / 2, size / 2 + size * 0.05);
  ctx.fillText("⚔️", size / 2, size / 2 + size * 0.05);

  // "TriSchach" text
  ctx.font = `${size * 0.12}px 'Outfit', sans-serif`;
  ctx.fontWeight = "bold";
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillText("TriSchach", size / 2, size * 0.75);

  const buffer = canvas.toBuffer("image/png");
  fs.writeFileSync(`icons/icon-${size}.png`, buffer);
  console.log(`Generated icon-${size}.png`);
}

console.log("All icons generated!");
