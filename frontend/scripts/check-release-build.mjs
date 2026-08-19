#!/usr/bin/env node
/**
 * Post-build checks for production update safety.
 * Usage: node scripts/check-release-build.mjs [distDir]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(process.argv[2] || path.join(__dirname, "..", "dist"));

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`OK: ${msg}`);
}

if (!fs.existsSync(distDir)) fail(`dist not found: ${distDir}`);

const indexHtml = path.join(distDir, "index.html");
const swPath = path.join(distDir, "sw.js");
const versionPath = path.join(distDir, "version.json");
const assetsDir = path.join(distDir, "assets");

if (!fs.existsSync(indexHtml)) fail("index.html missing");
if (!fs.existsSync(swPath)) fail("sw.js missing");
if (!fs.existsSync(versionPath)) fail("version.json missing");
if (!fs.existsSync(assetsDir)) fail("assets/ missing");

const version = JSON.parse(fs.readFileSync(versionPath, "utf8"));
if (!version.version || String(version.version).includes("__ITFLUX")) {
  fail(`invalid version.json: ${JSON.stringify(version)}`);
}
ok(`version ${version.version}`);

const sw = fs.readFileSync(swPath, "utf8");
if (sw.includes("__ITFLUX_APP_VERSION__")) fail("sw.js still has version placeholder");
if (!sw.includes(String(version.version))) fail("sw.js does not embed build version");
if (/caches\.open\s*\(/.test(sw)) fail("sw.js must not open runtime caches");
if (/addEventListener\s*\(\s*['"]fetch['"]/.test(sw)) fail("sw.js must not intercept fetch (API/HTML)");
if (!sw.includes("skipWaiting")) fail("sw.js missing skipWaiting");
if (!sw.includes("clients.claim")) fail("sw.js missing clients.claim");
if (!sw.includes("caches.delete") && !sw.includes("caches.keys")) {
  fail("sw.js should clear old caches on activate");
}
if (!sw.includes("push")) fail("sw.js must keep Web Push handler");
ok("service worker update + push-only caching policy");

const index = fs.readFileSync(indexHtml, "utf8");
if (!index.includes("window.__APP_VERSION__")) fail("index.html missing __APP_VERSION__");
if (!index.includes(String(version.version))) fail("index.html version mismatch");
if (/fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|unpkg\.com/.test(index)) {
  fail("index.html must not load Google Fonts / jsDelivr / unpkg (blocked without VPN)");
}
ok("index.html embeds app version");
ok("index.html has no blocked CDN URLs");

const mains = fs.readdirSync(assetsDir).filter((f) => /^main-[a-zA-Z0-9_-]+\.js$/.test(f));
if (!mains.length) fail("no hashed main-*.js chunks");
const hashed = fs.readdirSync(assetsDir).filter((f) => /-[a-zA-Z0-9_-]{6,}\.(js|css)$/.test(f));
if (hashed.length < 1) fail("production assets must include content hashes");
ok(`hashed assets: ${hashed.length} (entry ${mains[0]})`);

console.log("Release build checks passed.");
