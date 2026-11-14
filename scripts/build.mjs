#!/usr/bin/env node
/**
 * Production build for PrintFlow.
 *
 *   src/index.html + src/app.css + src/app.js  ->  dist/
 *
 * The build is intentionally dependency-free (no node_modules required) so it
 * runs anywhere, including inside a Vercel build step.
 *
 * What it does:
 *   1. Minifies CSS (safe transforms only: whitespace, comments, last semicolon)
 *   2. Minifies JS (safe transforms only: whitespace + comments, no renaming)
 *   3. Minifies HTML (collapses whitespace between tags, strips comments)
 *   4. Inlines critical CSS already present in the HTML (left as-is)
 *   5. Copies the optimized image assets
 *   6. Emits a build report with before/after sizes
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "src");
const DIST = join(root, "dist");
const ASSETS = join(root, "public", "assets");

/* ------------------------------------------------------------------ */
/* Minifiers                                                           */
/* ------------------------------------------------------------------ */

/**
 * CSS minifier. Deliberately conservative: it only removes comments and
 * redundant whitespace, and collapses the last semicolon in a block. It never
 * rewrites selectors, so it cannot break the cascade.
 */
function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s*([{}:;,>])\s*/g, "$1")
    .replace(/;}/g, "}")
    .replace(/\s+/g, " ")
    .replace(/^ | $/g, "")
    .trim();
}

/**
 * JS minifier. Strips line and block comments and collapses indentation.
 * It does NOT rename identifiers or restructure code — that would need a
 * real parser, and the file is already small enough that it does not matter.
 */
function minifyJs(js) {
  return js
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length)
    .join("\n");
}

/**
 * HTML minifier. Removes comments, collapses runs of whitespace between tags,
 * and trims text-node whitespace that cannot affect rendering.
 */
function minifyHtml(html) {
  return html
    .replace(/<!--(?!\[if)[\s\S]*?-->/g, "")
    .replace(/\s*>\s+</g, "><")
    .replace(/\n\s*/g, "\n")
    .replace(/^\n+|\n+$/g, "");
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

function bytes(p) {
  return statSync(p).size;
}

function human(n) {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

function dirSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(p) : bytes(p);
  }
  return total;
}

function main() {
  if (!existsSync(SRC)) {
    console.error(`Missing ${SRC}`);
    process.exit(1);
  }

  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(join(DIST, "assets"), { recursive: true });

  // --- assets (already optimized images) ---
  if (existsSync(ASSETS)) {
    cpSync(ASSETS, join(DIST, "assets"), { recursive: true });
  }

  // --- css ---
  const cssPath = join(SRC, "app.css");
  const cssRaw = readFileSync(cssPath, "utf8");
  const cssMin = minifyCss(cssRaw);
  writeFileSync(join(DIST, "assets", "app.css"), cssMin);

  // --- js ---
  const jsPath = join(SRC, "app.js");
  const jsRaw = readFileSync(jsPath, "utf8");
  const jsMin = minifyJs(jsRaw);
  writeFileSync(join(DIST, "assets", "app.js"), jsMin);

  // --- html ---
  const htmlPath = join(SRC, "index.html");
  const htmlRaw = readFileSync(htmlPath, "utf8");
  const htmlMin = minifyHtml(htmlRaw);
  writeFileSync(join(DIST, "index.html"), htmlMin);

  // --- static extras ---
  for (const extra of ["robots.txt", "site.webmanifest"]) {
    const p = join(root, extra);
    if (existsSync(p)) writeFileSync(join(DIST, extra), readFileSync(p));
  }
  const sitemap = join(root, "public", "sitemap.xml");
  if (existsSync(sitemap)) writeFileSync(join(DIST, "sitemap.xml"), readFileSync(sitemap));

  /* ---------------- verify referenced assets exist ----------------
     A srcset pointing at a missing file makes the browser fall back to the
     <img src>, which is a broken image. This check turns that silent
     failure into a build error. */
  const missing = [];
  const seen = new Set();

  // Asset URLs referenced from markup (src, srcset, href, preload).
  const refs = new Set();
  for (const m of htmlMin.matchAll(/\/assets\/([A-Za-z0-9._-]+)/g)) refs.add(m[1]);
  for (const m of htmlMin.matchAll(/["'(]((?:\/assets)?\/[A-Za-z0-9._/-]+\.(?:css|js|png|svg|webp|jpg|ico|webmanifest|txt))["')]/g)) {
    refs.add(m[1].replace(/^\/assets\//, ""));
  }

  for (const ref of refs) {
    if (ref === "app.css" || ref === "app.js") continue;
    if (seen.has(ref)) continue;
    seen.add(ref);
    // Root-level files (manifest, robots) live in dist/, not dist/assets/.
    const target = ref.includes("/") || !existsSync(join(DIST, "assets", ref))
      ? join(DIST, ref)
      : join(DIST, "assets", ref);
    if (!existsSync(target)) missing.push(ref);
  }

  if (missing.length) {
    console.error("\n  BUILD FAILED — referenced assets are missing:\n");
    for (const m of missing) console.error(`    - ${m}`);
    console.error("\n  Run `npm run assets` to regenerate images.\n");
    process.exit(1);
  }

  /* ---------------- content-hash assets ----------------
     Filenames get a hash of their contents so `Cache-Control: immutable` is
     safe: a changed file gets a new name, so no visitor ever gets a stale
     copy. */
  execFileSync(process.execPath, [join(root, "scripts", "hash-assets.mjs")], {
    stdio: "inherit",
  });

  /* ---------------- report ---------------- */
  // The original single-file build is a reference for the report only. It is
  // excluded from the Vercel upload (.vercelignore), so it may be absent —
  // the build must never depend on it.
  const originalPath = join(root, "PrintFlow.html");
  const hasOriginal = existsSync(originalPath);

  const distTotal = dirSize(DIST);
  const htmlOut = bytes(join(DIST, "index.html"));

  // Locate the hashed CSS/JS output for reporting.
  const distAssets = join(DIST, "assets");
  const distFiles = existsSync(distAssets) ? readdirSync(distAssets) : [];
  const cssFile = distFiles.find((f) => /^app\..*\.css$/.test(f));
  const jsFile = distFiles.find((f) => /^app\..*\.js$/.test(f));
  const cssOut = cssFile ? bytes(join(distAssets, cssFile)) : 0;
  const jsOut = jsFile ? bytes(join(distAssets, jsFile)) : 0;

  // Total weight of the images the browser actually downloads on a first visit.
  const firstVisitImageBytes = distFiles
    .filter((f) => f.endsWith(".webp"))
    .reduce((sum, f) => sum + bytes(join(distAssets, f)), 0);

  console.log("\n  Build complete -> dist/\n");
  console.log("  file            raw        minified   saved");
  console.log("  " + "-".repeat(52));
  console.log(
    `  index.html      ${human(bytes(htmlPath)).padStart(9)}  ${human(htmlOut).padStart(9)}   ` +
      `${Math.round((1 - htmlOut / bytes(htmlPath)) * 100)}%`,
  );
  console.log(
    `  app.css        ${human(bytes(cssPath)).padStart(9)}  ${human(cssOut).padStart(9)}   ` +
      `${Math.round((1 - cssOut / bytes(cssPath)) * 100)}%`,
  );
  console.log(
    `  app.js         ${human(bytes(jsPath)).padStart(9)}  ${human(jsOut).padStart(9)}   ` +
      `${Math.round((1 - jsOut / bytes(jsPath)) * 100)}%`,
  );
  console.log("  " + "-".repeat(52));
  console.log(`  dist/ total: ${human(distTotal)}\n`);

  if (hasOriginal) {
    const origHtml = bytes(originalPath);
    console.log("  vs. original single-file build:");
    console.log(`    original: ${human(origHtml)}  (1 request, inline base64 images)`);
    console.log(
      `    now:      ${human(htmlOut + cssOut + jsOut)} text + ~${human(
        firstVisitImageBytes,
      )} images (2 requests, separately cacheable)\n`,
    );
  } else {
    console.log(
      `    text: ${human(htmlOut + cssOut + jsOut)} + ~${human(
        firstVisitImageBytes,
      )} images (separately cacheable)\n`,
    );
  }
  console.log(
    `  asset filenames are content-hashed, so they can be served with\n` +
      `  Cache-Control: immutable without ever serving a stale copy.\n`,
  );
}

main();
