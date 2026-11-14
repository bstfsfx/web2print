#!/usr/bin/env node
/**
 * Generates the PWA / favicon icon set from the vector logo.
 *
 * Kept separate from the raster optimizer because these are vector-derived
 * rather than photo-derived, and they must survive an asset rebuild.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "public", "assets");

// A font-free variant of the logo. ImageMagick's SVG renderer has no fonts
// available, so the "PF" wordmark is stripped for the rasterized icons.
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256"><rect width="256" height="256" rx="58" fill="#087cf5"/><g transform="translate(44 24)"><path d="M64 0 112 36 67 75 31 25Z" fill="#f34e72"/><path d="M31 25 67 75 20 114 0 54Z" fill="#ffc02b"/><path d="m67 75 45-39 10 53-49 35z" fill="#54cbb1"/><path d="M20 114 67 75l6 74-53-12z" fill="#fff"/></g></svg>
`;

mkdirSync(OUT, { recursive: true });

const faviconPath = join(OUT, "favicon.svg");
writeFileSync(faviconPath, FAVICON_SVG);

for (const size of [180, 192, 512]) {
  execFileSync("magick", [
    "-background",
    "none",
    faviconPath,
    "-resize",
    `${size}x${size}`,
    "-depth",
    "8",
    join(OUT, `icon-${size}.png`),
  ]);
}

console.log("  icons: favicon.svg, icon-180.png, icon-192.png, icon-512.png");
