#!/usr/bin/env node
/**
 * Extract the inline assets (base64 images) from the original single-file
 * PrintFlow.html into `.source-assets/` so the image optimizer can work on
 * real files. This runs once; the originals are kept for reproducibility.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, ".source-assets");
const ORIGIN = join(root, "PrintFlow.html");

if (!existsSync(ORIGIN)) {
  console.error(`Missing ${ORIGIN}`);
  process.exit(1);
}

mkdirSync(SRC, { recursive: true });
const html = await import("node:fs").then((fs) => fs.readFileSync(ORIGIN, "utf8"));

// SVG logos (header + footer) are identical — keep a single copy.
const svgs = [...html.matchAll(/src="data:image\/svg\+xml;base64,([^"]+)"/g)].map((m) => m[1]);
if (svgs.length) {
  writeFileSync(join(SRC, "logo.svg"), Buffer.from(svgs[0], "base64"));
  console.log(`  logo.svg        (${svgs.length} occurrences deduplicated)`);
}

// Hero background lives inside the <style> block as a css url().
const hero = html.match(/url\("data:image\/jpeg;base64,([^"]+)"\)/);
if (hero) {
  writeFileSync(join(SRC, "hero.jpeg"), Buffer.from(hero[1], "base64"));
  console.log("  hero.jpeg       (from CSS background)");
}

// Remaining raster images in document order.
const jpgs = [...html.matchAll(/src="data:image\/jpeg;base64,([^"]+)"/g)].map((m) => m[1]);
jpgs.forEach((b64, i) => {
  writeFileSync(join(SRC, `in${i}.jpeg`), Buffer.from(b64, "base64"));
});
console.log(`  in0..in${jpgs.length - 1}.jpeg (${jpgs.length} raster images)`);
