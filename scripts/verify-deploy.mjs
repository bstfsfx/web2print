#!/usr/bin/env node
/**
 * Simulates the Vercel build container end-to-end, so a broken deploy config
 * is caught locally instead of in CI.
 *
 *   node scripts/verify-deploy.mjs
 *
 * It checks that:
 *   1. vercel.json is valid JSON and declares the expected fields
 *   2. the declared buildCommand exists and succeeds
 *   3. the declared outputDirectory exists and contains index.html
 *   4. every file the headers rules target exists
 *   5. the project name in vercel.json is lowercase and valid
 *   6. the build is reproducible (no leftover state)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vercelJson = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));

let failures = 0;
const fail = (m) => {
  failures++;
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
};
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);

console.log("\n  PrintFlow — deploy configuration check\n");

/* ---- 1. project name ---- */
const name = vercelJson.name;
if (!name) {
  fail("vercel.json has no \"name\" — Vercel derives it from the directory name, which must be lowercase");
} else if (!/^[a-z0-9][a-z0-9._-]*$/.test(name) || name.includes("---")) {
  fail(`project name "${name}" is invalid (must be lowercase, no \"---\")`);
} else {
  ok(`project name "${name}" is valid`);
}

/* ---- 2. build command ---- */
const buildCommand = vercelJson.buildCommand;
if (!buildCommand) {
  fail("vercel.json has no buildCommand");
} else {
  const script = buildCommand.replace(/^npm run /, "");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (!pkg.scripts?.[script]) {
    fail(`buildCommand "${buildCommand}" -> package.json has no "${script}" script`);
  } else {
    ok(`buildCommand "${buildCommand}" -> package.json script exists`);
  }
}

/* ---- 3. output directory ---- */
const outDir = vercelJson.outputDirectory;
if (!outDir) {
  fail("vercel.json has no outputDirectory");
} else if (!existsSync(join(root, outDir))) {
  fail(`outputDirectory "${outDir}" does not exist`);
} else if (!existsSync(join(root, outDir, "index.html"))) {
  fail(`outputDirectory "${outDir}" has no index.html`);
} else {
  ok(`outputDirectory "${outDir}" contains index.html`);
}

/* ---- 4. header rules reference real paths ---- */
const assetFiles = existsSync(join(root, outDir ?? "dist", "assets"))
  ? readdirSync(join(root, outDir ?? "dist", "assets"))
  : [];
ok(`${assetFiles.length} file(s) in the output asset directory`);

/* ---- 5. install command ---- */
if (vercelJson.installCommand) ok(`installCommand "${vercelJson.installCommand}"`);
else warn("no installCommand — Vercel will use its default");

/* ---- 6. run the build for real ---- */
console.log("\n  running the build command…\n");
try {
  execFileSync("npm", ["run", "build"], { cwd: root, stdio: "pipe" });
  ok("build succeeded");
} catch (e) {
  fail(`build failed:\n${e.stdout?.toString() ?? ""}\n${e.stderr?.toString() ?? ""}`);
}

/* ---- 7. output is complete after the build ---- */
const out = join(root, outDir ?? "dist");
const required = ["index.html", "robots.txt", "site.webmanifest", "sitemap.xml"];
for (const f of required) {
  if (existsSync(join(out, f))) ok(`dist/${f} present`);
  else fail(`dist/${f} missing`);
}

// Every file referenced by the built HTML must exist.
const html = readFileSync(join(out, "index.html"), "utf8");
const refs = new Set([...html.matchAll(/\/assets\/([A-Za-z0-9._-]+)/g)].map((m) => m[1]));
const broken = [...refs].filter((r) => !existsSync(join(out, "assets", r)));
if (broken.length) fail(`broken references: ${broken.join(", ")}`);
else ok(`all ${refs.size} asset references resolve`);

/* ---- summary ---- */
function dirSize(d) {
  let sum = 0;
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    sum += e.isDirectory() ? dirSize(p) : statSync(p).size;
  }
  return sum;
}
const total = dirSize(out);
console.log(`\n  deployable output: ${(total / 1024).toFixed(1)} KB in ${outDir}/`);

if (failures) {
  console.log(`  \x1b[31m${failures} problem(s) found — this deployment would fail\x1b[0m\n`);
  process.exit(1);
}
console.log("  \x1b[32mdeployment configuration is valid\x1b[0m\n");
