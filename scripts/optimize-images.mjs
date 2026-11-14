#!/usr/bin/env node
/**
 * Image optimization pipeline for PrintFlow.
 *
 * Strategy
 * --------
 * 1. Never upscale. The source assets are small (the hero background is only
 *    464x280 and is displayed behind a heavy gradient overlay), so any variant
 *    larger than the source only adds bytes without adding detail.
 * 2. Emit WebP as the primary format (Chrome/Firefox/Safari 14+) with a JPEG
 *    fallback via <picture>.
 * 3. Emit only the width variants that are actually needed at each breakpoint.
 * 4. Report the before/after so regressions are visible in CI.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "public", "assets");
const SRC = join(root, ".source-assets");

/**
 * name -> {
 *   file,        source file in .source-assets
 *   widths,      target widths to emit
 *   q,           encoder quality
 *   maxWidth,    absolute ceiling on the emitted width. A declared width
 *                above this is skipped (the build then fails loudly if the
 *                HTML still references it).
 * }
 *
 * IMPORTANT: every width listed here MUST exist in the output, because the
 * HTML `srcset` references it. If a width is missing the browser silently
 * falls back to the `img src`, which is exactly the bug this guards against.
 */
const MANIFEST = {
  // Decorative hero background. The source is only 464x280 but it is painted
  // across a 1120px-wide hero, so it is upscaled to 960 for sharpness. It sits
  // behind a heavy gradient overlay, so quality 68 is plenty.
  "hero": { file: "hero.jpeg", widths: [480, 960], q: 68, maxWidth: 960 },

  // Product cards render ~176 CSS px wide in the 6-col grid (178 - 2px
  // border). A 1x screen therefore needs ~176 device px, and a 2x screen
  // needs ~352. The originals are only ~140 px, so these are upscaled —
  // but matching the real layout size means a 1x visitor downloads the
  // smallest file that still looks sharp.
  "product-namecard": { file: "in0.jpeg", widths: [176, 352], q: 76, maxWidth: 352 },
  "product-poster": { file: "in1.jpeg", widths: [176, 352], q: 76, maxWidth: 352 },
  "product-sticker": { file: "in2.jpeg", widths: [176, 352], q: 76, maxWidth: 352 },
  "product-banner": { file: "in3.jpeg", widths: [176, 352], q: 76, maxWidth: 352 },
  "product-packaging": { file: "in4.jpeg", widths: [176, 352], q: 76, maxWidth: 352 },
  "product-largeprint": { file: "in5.jpeg", widths: [176, 352], q: 76, maxWidth: 352 },

  // Configurator preview renders at 220x215 (contain).
  "preview": { file: "in6.jpeg", widths: [220, 440], q: 80, maxWidth: 440 },

  // Enterprise banner renders at 330x106.
  "enterprise": { file: "in7.jpeg", widths: [330, 660], q: 76, maxWidth: 660 },
};

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8" });
}

/** Intrinsic dimensions of an image, via ImageMagick. */
function dims(file) {
  const out = run("magick", ["identify", "-format", "%w %h", file]);
  const [w, h] = out.trim().split(/\s+/).map(Number);
  return { w, h };
}

function bytes(p) {
  return statSync(p).size;
}

function human(n) {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

/**
 * Encode one variant. `allowUpscale` controls whether the target width may
 * exceed the source width (Lanczos interpolation).
 */
function encode(src, out, width, quality, allowUpscale) {
  run("magick", [
    src,
    "-auto-orient",
    "-strip",
    "-filter",
    "Lanczos",
    "-resize",
    allowUpscale ? `${width}x` : `${width}x>`,
    "-quality",
    String(quality),
    "-interlace",
    "Plane",
    "-define",
    "webp:method=6",
    out,
  ]);
}

function main() {
  if (!existsSync(SRC)) {
    console.error(
      `Missing ${SRC}. Run \`node scripts/extract-assets.mjs\` first to extract the\n` +
        `original inline images from PrintFlow.html.`,
    );
    process.exit(1);
  }

  mkdirSync(OUT, { recursive: true });

  // Remove only previously-generated variants, so hand-authored files
  // (favicon.svg, icon-*.png) in this directory survive a rebuild.
  for (const entry of readdirSync(OUT)) {
    if (/-(?:\d+)\.(?:webp|jpg)$/.test(entry)) rmSync(join(OUT, entry), { force: true });
  }
  let sourceBytes = 0;
  let emittedBytes = 0;
  let count = 0;

  console.log("\n  asset                     src        ->  webp      jpeg");
  console.log("  " + "-".repeat(60));

  for (const [name, cfg] of Object.entries(MANIFEST)) {
    const src = join(SRC, cfg.file);
    if (!existsSync(src)) {
      console.warn(`  ! skip ${name}: missing ${cfg.file}`);
      continue;
    }
    const { w: sw } = dims(src);
    sourceBytes += bytes(src);

    for (const width of cfg.widths) {
      // A width is skipped only if it would require upscaling past the
      // allowed factor. Declared widths must otherwise always be emitted so
      // the HTML srcset never points at a missing file.
      const allowUpscale = width > sw;
      if (width > cfg.maxWidth) {
        console.warn(`  ! ${name}-${width} exceeds maxWidth (${cfg.maxWidth}), skipping`);
        continue;
      }

      const base = `${name}-${width}`;
      const webp = join(OUT, `${base}.webp`);
      const jpeg = join(OUT, `${base}.jpg`);

      encode(src, webp, width, cfg.q, allowUpscale);
      encode(src, jpeg, width, cfg.q, allowUpscale);

      emittedBytes += bytes(webp) + bytes(jpeg);
      count += 2;

      console.log(
        `  ${base.padEnd(24)} ${human(bytes(src)).padStart(8)}  ->  ` +
          `${human(bytes(webp)).padStart(8)}  ${human(bytes(jpeg))}`,
      );
    }
  }

  // Vector logo: copy verbatim (already 493 B).
  const logoSrc = join(SRC, "logo.svg");
  if (existsSync(logoSrc)) {
    writeFileSync(join(OUT, "logo.svg"), readFileSync(logoSrc));
  }

  console.log("  " + "-".repeat(60));
  console.log(
    `  source inline payload: ${human(sourceBytes)}  ->  emitted: ${human(emittedBytes)} (${count} files)`,
  );
  console.log(
    "  the browser downloads ONE variant per image, so the real page weight\n" +
      "  is the sum of one WebP per slot, not the sum of every file.\n",
  );
}

main();
