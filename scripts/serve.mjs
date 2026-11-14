#!/usr/bin/env node
/**
 * Zero-dependency static server for local development.
 *   node scripts/serve.mjs [dir] [port]
 * Serves `dist/` by default so what you test is what Vercel serves.
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(root, process.argv[2] || "dist");
const port = Number(process.argv[3] || 4173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  } catch {
    res.writeHead(400).end("Bad Request");
    return;
  }

  if (pathname.endsWith("/")) pathname += "index.html";
  const filePath = join(dir, normalize(pathname).replace(/^(\.\.[/\\])+/, ""));

  if (!filePath.startsWith(dir) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    // SPA fallback
    const fallback = join(dir, "index.html");
    if (existsSync(fallback)) {
      res.writeHead(200, { "Content-Type": MIME[".html"] }).end(readFileSync(fallback));
      return;
    }
    res.writeHead(404).end("Not Found");
    return;
  }

  const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
  const headers = { "Content-Type": type };
  // Mirror the production caching policy so local testing reflects Vercel.
  if (/\.(webp|png|jpe?g|svg|ico|avif|css|js)$/.test(filePath)) {
    headers["Cache-Control"] = "public, max-age=31536000, immutable";
  } else {
    headers["Cache-Control"] = "public, max-age=0, must-revalidate";
  }
  res.writeHead(200, headers);
  createReadStream(filePath).pipe(res);
}).listen(port, () => {
  console.log(`  serving ${dir}`);
  console.log(`  → http://localhost:${port}`);
});
