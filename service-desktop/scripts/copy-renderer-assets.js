#!/usr/bin/env node
/**
 * Copy non-TS renderer assets (HTML, CSS) from src/renderer into dist/renderer
 * so the packaged app can load them alongside the compiled renderer JS. Run
 * after `tsc -p tsconfig.renderer.json`.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const SRC = path.resolve(__dirname, "..", "src", "renderer");
const DEST = path.resolve(__dirname, "..", "dist", "renderer");

fs.mkdirSync(DEST, { recursive: true });
for (const entry of fs.readdirSync(SRC)) {
  if (entry.endsWith(".html") || entry.endsWith(".css")) {
    fs.copyFileSync(path.join(SRC, entry), path.join(DEST, entry));
  }
}
process.stdout.write(`Copied renderer HTML/CSS into ${DEST}\n`);
