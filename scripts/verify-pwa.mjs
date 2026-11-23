#!/usr/bin/env node
/**
 * verify-pwa.mjs — comprobación rápida de requisitos PWA (Rol A)
 * Uso:  node scripts/verify-pwa.mjs
 * Revisa: manifest válido, íconos existentes con el tamaño declarado,
 * enlace al manifest en index.html y recursos precacheados por el Service Worker.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(resolve(root, f), "utf8");
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? "✅" : "❌"} ${msg}`); if (!ok) failures++; };

// 1. Manifest
let manifest = {};
try { manifest = JSON.parse(read("manifest.webmanifest")); check(true, "manifest.webmanifest es JSON válido"); }
catch (e) { check(false, `manifest inválido: ${e.message}`); }

for (const f of ["name", "short_name", "start_url", "display", "icons", "theme_color", "background_color"])
  check(Boolean(manifest[f]), `manifest.${f} definido`);
check(["standalone", "fullscreen", "minimal-ui"].includes(manifest.display), "display es instalable");

// 2. Íconos (PNG: ancho/alto en bytes 16-23 de la cabecera)
const sizes = new Set();
for (const icon of manifest.icons ?? []) {
  const p = resolve(root, icon.src);
  if (!existsSync(p)) { check(false, `ícono no existe: ${icon.src}`); continue; }
  const buf = readFileSync(p);
  const [w, h] = [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  check(`${w}x${h}` === icon.sizes, `${icon.src} mide ${w}x${h} (declarado ${icon.sizes})`);
  sizes.add(icon.sizes);
}
check(sizes.has("192x192") && sizes.has("512x512"), "existen íconos 192x192 y 512x512");
check((manifest.icons ?? []).some((i) => i.purpose === "maskable"), "existe ícono maskable");

// 3. index.html
const html = read("index.html");
check(/<link[^>]+rel=["']manifest["'][^>]*>/i.test(html), 'index.html enlaza <link rel="manifest">');
check(/apple-touch-icon/i.test(html), "index.html declara apple-touch-icon");
check(/pwa-install\.js/.test(html) || /pwa-install\.js/.test(read("app.js")), "pwa-install.js se carga");

// 4. Service Worker
const sw = read("service-worker.js");
check(/addEventListener\(["']fetch["']/.test(sw), "service-worker maneja 'fetch'");
const listed = [...sw.matchAll(/["']\.\/([^"']+)["']/g)].map((m) => m[1]);
for (const f of listed) check(existsSync(resolve(root, f)), `precache existe: ${f}`);
for (const f of ["manifest.webmanifest", "pwa-install.js", "icons/icon-192.png"])
  check(listed.includes(f), `service-worker precachea ${f}`);

console.log(failures ? `\n${failures} comprobación(es) fallaron.` : "\nTodo en orden ✔");
process.exit(failures ? 1 : 0);
