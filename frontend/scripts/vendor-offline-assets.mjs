#!/usr/bin/env node
/**
 * Скачивает шрифты, Bootstrap, MathJax, Skulpt и Pyodide в frontend/public,
 * чтобы сайт открывался без VPN / зарубежных CDN.
 *
 * Запуск: node scripts/vendor-offline-assets.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, "..", "public");
const FONTS = path.join(PUBLIC, "fonts");
const VENDOR = path.join(PUBLIC, "vendor");
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function mkdir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function download(url, dest, { binary = true } = {}) {
  mkdir(path.dirname(dest));
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`  ${path.relative(PUBLIC, dest)}  (${(buf.length / 1024).toFixed(0)} KB)`);
  return binary ? buf : buf.toString("utf8");
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/css,*/*;q=0.1" },
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function vendorGoogleFonts(cssUrl, outCssName) {
  mkdir(FONTS);
  let css = await fetchText(cssUrl);
  const urls = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]))];
  for (const fileUrl of urls) {
    const parsed = new URL(fileUrl);
    const base = path.basename(parsed.pathname);
    const dest = path.join(FONTS, base);
    if (!fs.existsSync(dest)) await download(fileUrl, dest);
    css = css.split(fileUrl).join(`/${path.posix.join("fonts", base)}`);
  }
  css = css.replaceAll("https://fonts.gstatic.com", "");
  const outCss = path.join(FONTS, outCssName);
  fs.writeFileSync(outCss, css);
  console.log(`  fonts/${outCssName}`);
}

async function vendorBootstrap() {
  const dir = path.join(VENDOR, "bootstrap");
  mkdir(dir);
  await download(
    "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css",
    path.join(dir, "bootstrap.min.css"),
  );
  await download(
    "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.min.js",
    path.join(dir, "bootstrap.min.js"),
  );
}

async function vendorMathjax() {
  const dest = path.join(VENDOR, "mathjax");
  const localConfig = path.join(dest, "itflux-config.js");
  const configBackup = fs.existsSync(localConfig) ? fs.readFileSync(localConfig) : null;
  const tgz = path.join(VENDOR, "mathjax.tgz");
  await download("https://registry.npmjs.org/mathjax/-/mathjax-3.2.2.tgz", tgz);
  const extractDir = path.join(VENDOR, "mathjax-extract");
  fs.rmSync(extractDir, { recursive: true, force: true });
  mkdir(extractDir);
  execFileSync("tar", ["-xzf", tgz, "-C", extractDir]);
  const es5 = path.join(extractDir, "package", "es5");
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(es5, dest, { recursive: true });
  if (configBackup) fs.writeFileSync(localConfig, configBackup);
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.rmSync(tgz, { force: true });
  console.log("  vendor/mathjax/ (es5)");
}

async function vendorSkulpt() {
  const dir = path.join(VENDOR, "skulpt");
  mkdir(dir);
  await download(
    "https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt.min.js",
    path.join(dir, "skulpt.min.js"),
  );
  await download(
    "https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt-stdlib.min.js",
    path.join(dir, "skulpt-stdlib.min.js"),
  );
}

async function vendorPyodide() {
  const dir = path.join(VENDOR, "pyodide");
  mkdir(dir);
  const base = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
  const files = [
    "pyodide.mjs",
    "pyodide.asm.js",
    "pyodide.asm.wasm",
    "python_stdlib.zip",
    "pyodide-lock.json",
  ];
  for (const name of files) {
    const dest = path.join(dir, name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
      console.log(`  vendor/pyodide/${name} (exists)`);
      continue;
    }
    await download(base + name, dest);
  }
}

const SITE_FONTS =
  "https://fonts.googleapis.com/css2?family=TikTok+Sans:wght@400;500;600;700;800&family=Manrope:wght@400;500;700;800&family=Onest:wght@600;700;800;900&family=Nunito:wght@400;600;700&family=JetBrains+Mono:wght@500&display=swap";
const DJANGO_FONTS =
  "https://fonts.googleapis.com/css2?family=Unbounded:wght@400;600;700&family=Montserrat:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap";
const HISTORY_FONTS =
  "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Manrope:wght@400;500;600&display=swap";
const WORKBOOK_FONTS =
  "https://fonts.googleapis.com/css2?family=PT+Serif:ital,wght@0,400;0,700;1,400&display=swap";

console.log("Vendoring offline assets into frontend/public …");
await vendorGoogleFonts(SITE_FONTS, "site.css");
await vendorGoogleFonts(DJANGO_FONTS, "django.css");
await vendorGoogleFonts(HISTORY_FONTS, "history-map.css");
await vendorGoogleFonts(WORKBOOK_FONTS, "workbook.css");
await vendorBootstrap();
await vendorMathjax();
await vendorSkulpt();
await vendorPyodide();
console.log("Done.");
