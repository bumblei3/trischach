// Global test setup - suppress opening book debug output
import { vi } from "vitest";

const originalLog = console.log;
const originalWarn = console.warn;

console.log = (...args) => {
  const msg = args.join(" ");
  // Suppress opening book debug output
  if (
    msg.includes("Opening book built:") ||
    msg.includes("Opening book (") ||
    (msg.includes("Move ") && msg.includes("failed at ply")) ||
    msg.startsWith("Opening book: ")
  ) {
    return;
  }
  originalLog(...args);
};

console.warn = (...args) => {
  const msg = args.join(" ");
  // Suppress opening book warnings
  if (
    (msg.includes("Opening book (") &&
      (msg.includes("Invalid move") ||
        msg.includes("Failed to select piece") ||
        msg.includes("failed at ply"))) ||
    msg.includes("Web Worker not supported")
  ) {
    return;
  }
  originalWarn(...args);
};

// Restore on teardown (optional - vitest isolates globals per test)
