#!/usr/bin/env node
"use strict";
// Build script (no dependencies, Node >= 18).
//   node tools/build.js          writes dist/*.txt and docs/index.html
//   node tools/build.js --check  exits with 1 if the committed files differ from a fresh build
//
// src/export.src.js, src/limits.src.js -> dist/*.bookmarklet.txt  (one-line javascript: URLs)
// src/page.template.html + src/i18n.json + the two bookmarklets -> docs/index.html

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const VERSIONS = { export: "1.1", limits: "2" };
const REPO_URL = "https://github.com/OlegH-Consense/claude-export-limits";

const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");

// Readable source -> one-line javascript: URL.
// Full-line comments and line breaks are removed, so every statement in the source must end with a semicolon.
// The result must survive being stored in a URL: ASCII only, no percent sign (URL-decoding would corrupt it), no hash sign.
function bookmarklet(srcPath) {
  const src = read(srcPath);
  let body = src.split("\n")
    .filter(l => !/^\s*\/\//.test(l))
    .map(l => l.replace(/\s\/\/\s.*$/, "").trim())
    .filter(Boolean)
    .join("")
    .replace(/;$/, "");
  // Non-ASCII characters and the hash sign only occur inside string literals, where a \uXXXX escape is equivalent.
  body = body.replace(/[^\x00-\x7f]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"))
    .replace(/#/g, "\\u0023");
  if (body.includes("%")) throw new Error(srcPath + ": the percent sign is not allowed (use String.fromCharCode(37))");
  if (/[^\x20-\x7e]/.test(body)) throw new Error(srcPath + ": non-printable characters in the build output");
  new vm.Script(body, { filename: srcPath }); // syntax check only, nothing is executed
  return "javascript:" + body;
}

const escAttr = s => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function buildPage(exportUrl, limitsUrl) {
  const i18n = JSON.parse(read("src/i18n.json"));
  const langs = Object.keys(i18n);
  for (const l of langs) {
    for (const k of Object.keys(i18n.en)) if (!(k in i18n[l])) throw new Error("i18n: key '" + k + "' is missing in '" + l + "'");
    for (const k of Object.keys(i18n[l])) if (!(k in i18n.en)) throw new Error("i18n: unknown key '" + k + "' in '" + l + "'");
  }
  let html = read("src/page.template.html");
  // Static English text for browsers without JavaScript; the script re-applies the chosen language at load time.
  html = html.replace(/<(\w+)([^>]*?)\sdata-i18n="([^"]+)"([^>]*)><\/\1>/g, (m, tag, a, key, b) => {
    if (!(key in i18n.en)) throw new Error("i18n: unknown key in template: " + key);
    return "<" + tag + a + ' data-i18n="' + key + '"' + b + ">" + i18n.en[key] + "</" + tag + ">";
  });
  html = html.replace(/\sdata-i18n-title="([^"]+)"/g, (m, key) => {
    if (!(key in i18n.en)) throw new Error("i18n: unknown title key in template: " + key);
    return ' data-i18n-title="' + key + '" title="' + escAttr(i18n.en[key]) + '"';
  });
  const json = JSON.stringify(i18n).replace(/</g, "\\u003c");
  html = html
    .replace("{{I18N_JSON}}", () => json)
    .replace("{{EXPORT_HREF}}", () => escAttr(exportUrl))
    .replace("{{LIMITS_HREF}}", () => escAttr(limitsUrl))
    .replace("{{EXPORT_VER}}", VERSIONS.export)
    .replace("{{LIMITS_VER}}", VERSIONS.limits)
    .split("{{REPO_URL}}").join(REPO_URL);
  const left = html.match(/\{\{[A-Z_]+\}\}/);
  if (left) throw new Error("unreplaced placeholder in the page: " + left[0]);
  return html;
}

function buildAll() {
  const exportUrl = bookmarklet("src/export.src.js");
  const limitsUrl = bookmarklet("src/limits.src.js");
  return {
    "dist/claude-export.bookmarklet.txt": exportUrl + "\n",
    "dist/claude-limits.bookmarklet.txt": limitsUrl + "\n",
    "docs/index.html": buildPage(exportUrl, limitsUrl)
  };
}

module.exports = { buildAll, bookmarklet, VERSIONS, REPO_URL };

if (require.main === module) {
  const files = buildAll();
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(ROOT, rel);
    if (check) {
      const cur = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
      if (cur !== content) { console.error("out of date: " + rel); stale++; }
    } else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
      console.log("wrote " + rel + " (" + content.length + " chars)");
    }
  }
  if (check) {
    if (stale) { console.error("Run: node tools/build.js"); process.exit(1); }
    console.log("dist/ and docs/ are up to date");
  }
}
