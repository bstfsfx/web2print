#!/usr/bin/env node
/**
 * Rewrites asset references in the built HTML to include a content hash, so
 * assets can be served with `Cache-Control: immutable` safely.
 *
 *   /assets/hero-960.webp  ->  /assets/hero-960.a1b2c3d4.webp
 *
 * The hashed file is written next to the original and the original is removed
 * after all references have been rewritten, so `dist/` contains exactly the
 * files that are referenced.
 */
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(root, "dist");
const ASSETS = join(DIST, "assets");

if (!existsSync(DIST)) {
  console.error("  dist/ not found — run `npm run build` first.");
  process.exit(1);
}

const htmlPath = join(DIST, "index.html");
let html = readFileSync(htmlPath, "utf8");

function shortHash(buf) {
  return createHash("sha256").update(buf).digest("hex").slice(0, 8);
}

// Collect every asset referenced from the HTML.
const referenced = new Set();
for (const m of html.matchAll(/\/assets\/([A-Za-z0-9._-]+)/g)) referenced.add(m[1]);

// Build the rename map.
const renameMap = new Map();
for (const name of referenced) {
  const src = join(ASSETS, name);
  if (!existsSync(src)) continue;
  // Leave the icons and favicon alone — they are referenced by the manifest
  // and apple-touch-icon, which we do not rewrite here.
  if (/^icon-\d+\.png$/.test(name) || name === "favicon.svg") continue;

  const ext = name.slice(name.lastIndexOf("."));
  const stem = name.slice(0, name.lastIndexOf("."));
  const hash = shortHash(readFileSync(src));
  const next = `${stem}.${hash}${ext}`;
  renameMap.set(name, next);
}

if (renameMap.size === 0) {
  console.log("  no assets to hash");
  process.exit(0);
}

// Rewrite references in the HTML.
for (const [from, to] of renameMap) {
  html = html.split(`/assets/${from}`).join(`/assets/${to}`);
}

// Move the files.
for (const [from, to] of renameMap) {
  renameSync(join(ASSETS, from), join(ASSETS, to));
}

writeFileSync(htmlPath, html);

console.log(`  hashed ${renameMap.size} asset(s):`);
for (const [from, to] of renameMap) console.log(`    ${from} -> ${to}`);

// Remove any generated asset that is no longer referenced.
const referencedNow = new Set();
for (const m of html.matchAll(/\/assets\/([A-Za-z0-9._-]+)/g)) referencedNow.add(m[1]);
for (const entry of readdirSync(ASSETS)) {
  if (!referencedNow.has(entry)) {
    rmSync(join(ASSETS, entry), { force: true });
  }
}
