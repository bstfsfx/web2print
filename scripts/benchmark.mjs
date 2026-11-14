#!/usr/bin/env node
/**
 * Measures the real page weight of the optimized build vs. the original
 * single-file build, using the same conditions for both.
 *
 *   node scripts/benchmark.mjs
 *
 * Both pages are served locally, loaded with a cold cache, and their resource
 * timings are compared.
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

/** Serves the original single-file build from memory. */
function serveOriginal(port) {
  const body = readFileSync(join(root, "PrintFlow.html"));
  return createServer((req, res) => {
    res.writeHead(200, { "Content-Type": MIME[".html"], "Content-Length": body.length });
    res.end(body);
  }).listen(port);
}

/** Serves dist/ as static files (what Vercel would serve). */
function serveDist(port) {
  const dir = join(root, "dist");
  return createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = join(dir, p);
    if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end("not found");
      return;
    }
    const type = MIME[extname(file).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Content-Length": statSync(file).size });
    createReadStream(file).pipe(res);
  }).listen(port);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function measure(url) {
  // Fresh browser context per run => cold cache.
  const { chromium } = await import("playwright").catch(() => ({ chromium: null }));
  if (!chromium) {
    console.error("  playwright is not installed — skipping the browser measurement.");
    return null;
  }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  const data = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const res = performance.getEntriesByType("resource");
    return {
      requests: res.length + 1,
      transfer: nav.transferSize + res.reduce((s, e) => s + e.transferSize, 0),
      encoded: nav.encodedBodySize + res.reduce((s, e) => s + e.encodedBodySize, 0),
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
      loadEvent: Math.round(nav.loadEventEnd),
      responseEnd: Math.round(nav.responseEnd),
      domInteractive: Math.round(nav.domInteractive),
      lcp: (() => {
        const l = performance.getEntriesByType("largest-contentful-paint");
        return l.length ? Math.round(l[l.length - 1].startTime) : null;
      })(),
      byType: res.reduce((acc, e) => {
        const t = e.name.split("?")[0].split(".").pop();
        acc[t] = (acc[t] || 0) + e.encodedBodySize;
        return acc;
      }, {}),
    };
  });
  await browser.close();
  return data;
}

function fmt(n) {
  return n == null ? "n/a" : n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

async function main() {
  const orig = serveOriginal(4501);
  const dist = serveDist(4502);
  await sleep(300);

  console.log("\n  PrintFlow — before / after\n");
  console.log("  metric                  original      optimized     delta");
  console.log("  " + "-".repeat(58));

  const a = await measure("http://localhost:4501/");
  const b = await measure("http://localhost:4502/");

  if (a && b) {
    const rows = [
      ["requests", a.requests, b.requests, (v) => String(v)],
      ["transfer size", a.transfer, b.transfer, fmt],
      ["encoded size", a.encoded, b.encoded, fmt],
      ["response end (ms)", a.responseEnd, b.responseEnd, (v) => `${v} ms`],
      ["dom interactive (ms)", a.domInteractive, b.domInteractive, (v) => `${v} ms`],
      ["DOMContentLoaded (ms)", a.domContentLoaded, b.domContentLoaded, (v) => `${v} ms`],
      ["load event (ms)", a.loadEvent, b.loadEvent, (v) => `${v} ms`],
      ["LCP (ms)", a.lcp, b.lcp, (v) => (v == null ? "n/a" : `${v} ms`)],
    ];
    for (const [label, av, bv, f] of rows) {
      const delta = typeof av === "number" && typeof bv === "number" && av !== 0
        ? `${Math.round(((bv - av) / av) * 100)}%`
        : "—";
      console.log(
        `  ${label.padEnd(22)} ${String(f(av)).padStart(10)} ${String(f(bv)).padStart(13)} ${delta.padStart(9)}`,
      );
    }

    console.log("\n  optimized resource breakdown (encoded bytes):");
    for (const [t, size] of Object.entries(b.byType).sort((x, y) => y[1] - x[1])) {
      console.log(`    ${t.padEnd(12)} ${fmt(size)}`);
    }
  } else {
    // Playwright is not a project dependency (this repo has none), so the
    // browser comparison is optional. Fall back to static sizes.
    const origSize = statSync(join(root, "PrintFlow.html")).size;
    const distDir = join(root, "dist");
    const distSize = existsSync(distDir)
      ? readdirSync(distDir).reduce((s, f) => {
          const p = join(distDir, f);
          if (!statSync(p).isDirectory()) return s + statSync(p).size;
          return s + readdirSync(p).reduce((t, g) => t + statSync(join(p, g)).size, 0);
        }, 0)
      : 0;
    console.log(`  original single file : ${fmt(origSize)}`);
    console.log(`  optimized dist/       : ${fmt(distSize)} (text + all image variants)`);
    console.log("  (install playwright to run the browser comparison)");
  }

  orig.close();
  dist.close();
  console.log();
}

main();
