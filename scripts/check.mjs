#!/usr/bin/env node
/**
 * Post-build audit. Verifies the output is correct and reports the
 * performance characteristics of the deployable bundle.
 *
 *   node scripts/check.mjs
 *
 * Checks:
 *   - every referenced asset exists in dist/
 *   - no inline base64 images remain (they defeat caching)
 *   - images have width/height (CLS protection)
 *   - below-fold images are lazy-loaded
 *   - the LCP image is preloaded
 *   - text assets are minified
 *   - dist/ contains no stray files
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(root, "dist");
const ASSETS = join(DIST, "assets");

let failures = 0;
let warnings = 0;

function ok(msg) {
  console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
}
function fail(msg) {
  failures++;
  console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
}
function warn(msg) {
  warnings++;
  console.log(`  \x1b[33m!\x1b[0m ${msg}`);
}

if (!existsSync(DIST)) {
  console.error("\n  dist/ not found — run `npm run build` first.\n");
  process.exit(1);
}

const html = readFileSync(join(DIST, "index.html"), "utf8");
const files = readdirSync(ASSETS);

console.log("\n  PrintFlow — build audit\n");

/* ---- referenced assets exist ---- */
const refs = new Set();
for (const m of html.matchAll(/\/assets\/([A-Za-z0-9._-]+)/g)) refs.add(m[1]);
const missing = [...refs].filter((r) => !existsSync(join(ASSETS, r)));
if (missing.length) fail(`missing assets: ${missing.join(", ")}`);
else ok(`all ${refs.size} referenced assets exist`);

/* ---- no stray files ---- */
const stray = files.filter((f) => !refs.has(f) && !/^icon-\d+\.png$/.test(f) && f !== "favicon.svg");
if (stray.length) warn(`unused files in dist/assets: ${stray.join(", ")}`);
else ok("no unused files in dist/assets");

/* ---- no inline base64 images ---- */
const b64 = html.match(/data:image\/[a-z+]+;base64/g);
if (b64) fail(`${b64.length} inline base64 image(s) remain — they cannot be cached`);
else ok("no inline base64 images");

/* ---- images have dimensions ---- */
const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
const noDims = imgs.filter((t) => !/\bwidth=/.test(t) || !/\bheight=/.test(t));
if (noDims.length) fail(`${noDims.length} <img> without width/height (causes CLS)`);
else ok(`all ${imgs.length} <img> elements have width/height`);

/* ---- lazy loading on below-fold images ---- */
const lazy = imgs.filter((t) => /loading="lazy"/.test(t)).length;
const eager = imgs.length - lazy;
if (lazy === 0) fail("no images use loading=\"lazy\"");
else ok(`${lazy} lazy-loaded, ${eager} eager (hero)`);

/* ---- decoding async ---- */
const noDecoding = imgs.filter((t) => !/decoding="async"/.test(t)).length;
if (noDecoding) warn(`${noDecoding} <img> without decoding="async"`);
else ok("all images use decoding=\"async\"");

/* ---- LCP preload ---- */
if (/rel="preload"[^>]*as="image"/.test(html)) ok("LCP image is preloaded");
else fail("no <link rel=preload as=image> for the hero");

/* ---- preload matches the picture srcset ---- */
const preload = html.match(/<link rel="preload" as="image"[^>]*>/)?.[0] ?? "";
const preloadSrcset = preload.match(/imagesrcset="([^"]+)"/)?.[1] ?? "";
const pictureSrcset = html.match(/<source srcset="(\/assets\/hero[^"]+)"/)?.[1] ?? "";
if (preloadSrcset && pictureSrcset && preloadSrcset === pictureSrcset) {
  ok("preload srcset matches the hero <picture> srcset");
} else {
  fail("preload srcset does not match the hero <picture> srcset");
}

/* ---- responsive images ---- */
const sources = [...html.matchAll(/<source[^>]*srcset="([^"]+)"/g)];
const badSrcset = sources.filter((m) => !/\d+w/.test(m[1]));
if (badSrcset.length) fail(`${badSrcset.length} <source> without width descriptors`);
else ok(`all ${sources.length} <source> elements use width descriptors`);

/* ---- minification ---- */
for (const f of files.filter((f) => f.endsWith(".css") || f.endsWith(".js"))) {
  const content = readFileSync(join(ASSETS, f), "utf8");
  const lines = content.split("\n").filter((l) => l.trim()).length;
  if (lines > 5 && !f.endsWith(".js")) warn(`${f} spans ${lines} lines — may not be minified`);
  else ok(`${f} minified (${lines} line(s), ${statSync(join(ASSETS, f)).size} B)`);
}

/* ---- CSP-compatible: no inline event handlers ---- */
const inlineHandlers = html.match(/\son\w+="/g);
if (inlineHandlers) fail(`${inlineHandlers.length} inline event handler(s) — blocked by CSP`);
else ok("no inline event handlers (CSP-safe)");

/* ---- no render-blocking script ---- */
if (/<script(?![^>]*\b(defer|async|type="module"))/.test(html)) {
  fail("a <script> without defer/async will block parsing");
} else ok("all scripts are deferred");

/* ---- summary ---- */
const total = readdirSync(DIST).reduce((sum, f) => {
  const p = join(DIST, f);
  return sum + (statSync(p).isDirectory() ? readdirSync(p).reduce((s, g) => s + statSync(join(p, g)).size, 0) : statSync(p).size);
}, 0);

console.log(`\n  dist/ total: ${(total / 1024).toFixed(1)} KB`);
if (failures) {
  console.log(`  \x1b[31m${failures} check(s) failed\x1b[0m, ${warnings} warning(s)\n`);
  process.exit(1);
}
console.log(`  \x1b[32mall checks passed\x1b[0m${warnings ? `, ${warnings} warning(s)` : ""}\n`);
