#!/usr/bin/env node
"use strict";
// Smoke tests against a mocked claude.ai (no network, no dependencies): node test/run.js
// Every bookmarklet is tested twice: the readable source and the built one-line javascript: URL.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { buildAll } = require("../tools/build.js");

const ROOT = path.join(__dirname, "..");
let passed = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) passed++;
  else { failures.push(name + (extra !== undefined ? "  -> " + extra : "")); }
}
const has = (s, sub) => String(s).includes(sub);

// ---------- build output is in sync with the sources ----------
const built = buildAll();
for (const [rel, content] of Object.entries(built)) {
  const abs = path.join(ROOT, rel);
  ok("up to date: " + rel, fs.existsSync(abs) && fs.readFileSync(abs, "utf8") === content);
}
for (const rel of ["dist/claude-export.bookmarklet.txt", "dist/claude-limits.bookmarklet.txt"]) {
  const s = built[rel].trim();
  ok(rel + " starts with javascript:", s.startsWith("javascript:"));
  ok(rel + " is one ASCII line without % or #", !/[^\x20-\x7e]/.test(s) && !s.includes("%") && !s.includes("#"));
}
const page = built["docs/index.html"];
ok("page: no unreplaced placeholders", !/\{\{[A-Z_]+\}\}/.test(page));
{
  const i18n = JSON.parse(fs.readFileSync(path.join(ROOT, "src/i18n.json"), "utf8"));
  const keys = Object.keys(i18n.en).sort().join();
  ok("i18n: en/uk/ru have identical keys", ["uk", "ru"].every(l => Object.keys(i18n[l]).sort().join() === keys));
  ok("i18n: no empty strings", Object.values(i18n).every(d => Object.values(d).every(v => v.trim())));
}

const code = {
  export: { src: fs.readFileSync(path.join(ROOT, "src/export.src.js"), "utf8"), dist: built["dist/claude-export.bookmarklet.txt"].trim().replace(/^javascript:/, "") },
  limits: { src: fs.readFileSync(path.join(ROOT, "src/limits.src.js"), "utf8"), dist: built["dist/claude-limits.bookmarklet.txt"].trim().replace(/^javascript:/, "") }
};
const tick = ms => new Promise(r => setTimeout(r, ms));

// ---------- Export ----------
const CID = "11111111-2222-4333-8444-555555555555";
const conv = {
  uuid: CID, name: 'Тест: експорт / "гілки"', created_at: "2026-10-01T10:00:00Z", model: "claude-opus-5-5", current_leaf_message_uuid: "m4",
  chat_messages: [
    { uuid: "m1", parent_message_uuid: "root", sender: "human", index: 0, created_at: "2026-10-01T10:00:00Z", content: [{ type: "text", text: "Привіт, зроби скрипт" }], attachments: [{ file_name: "data.csv", extracted_content: "a,b" }], files: [{ file_name: "pic.png", file_uuid: "f1" }], files_v2: [{ file_name: "pic.png" }] },
    { uuid: "m2", parent_message_uuid: "m1", sender: "assistant", index: 1, created_at: "2026-10-01T10:00:05Z", content: [{ type: "thinking", thinking: "secret" }, { type: "text", text: "Ось скрипт:" }, { type: "tool_use", name: "artifacts", input: { command: "create", title: "demo.py", language: "python", content: "print('```hi```')" } }, { type: "tool_result", content: [] }, { type: "text", text: "Готово." }] },
    { uuid: "m3b", parent_message_uuid: "m2", sender: "human", index: 2, created_at: "2026-10-01T10:01:00Z", content: [{ type: "text", text: "OLD BRANCH" }] },
    { uuid: "m3", parent_message_uuid: "m2", sender: "human", index: 2, created_at: "2026-10-01T10:02:00Z", content: [{ type: "text", text: "Дякую" }] },
    { uuid: "m4", parent_message_uuid: "m3", sender: "assistant", index: 3, created_at: "2026-10-01T10:02:05Z", text: "Будь ласка (legacy text)" }
  ]
};

async function runExport(source, o) {
  const downloads = {}, alerts = [], confirms = [], blobs = new Map(), fetched = [];
  let n = 0;
  const ctx = {
    location: { hostname: o.host || "claude.ai", pathname: o.path === undefined ? "/chat/" + CID : o.path },
    navigator: { language: o.lang || "en-US" },
    alert: m => alerts.push(m),
    confirm: m => { confirms.push(m); return o.confirm !== false; },
    document: {
      cookie: "foo=1; lastActiveOrg=org-bad",
      body: { appendChild() {} },
      createElement: () => { const a = { style: {}, click() { downloads[a.download] = blobs.get(a.href); }, remove() {} }; return a; }
    },
    Blob: class { constructor(p) { this.t = p.join(""); } },
    URL: { createObjectURL: b => { const u = "blob:" + (++n); blobs.set(u, b.t); return u; }, revokeObjectURL() {} },
    setTimeout: f => { f(); return 0; },
    console: { log() {}, error() {} },
    fetch: async (u, opt) => {
      fetched.push(u);
      const R = (s, j) => ({ ok: s === 200, status: s, json: async () => j, text: async () => JSON.stringify(j) });
      if (opt.credentials !== "include") throw new Error("credentials not included");
      if (u === "/api/organizations") return R(200, o.allFail ? [{ uuid: "org-bad" }] : [{ uuid: "org-bad" }, { uuid: "org-x" }, { uuid: "org-ok" }]);
      const m = u.match(/^\/api\/organizations\/([^/]+)\/chat_conversations\/([^?]+)\?tree=True/);
      if (m && m[1] === "org-ok" && m[2] === CID) return R(200, conv);
      return R(403, { error: "nope" });
    }
  };
  vm.createContext(ctx);
  await vm.runInContext(source, ctx);
  return { downloads, alerts, confirms, fetched };
}

async function testExport(label, source) {
  const T = s => label + ": " + s;
  // language of the dialog follows the browser language
  const cases = [["uk-UA", "Експортувати"], ["ru-RU", "Экспортировать"], ["en-US", "Export the current Claude conversation"], ["de-DE", "Export the current Claude conversation"]];
  for (const [lang, word] of cases) {
    const r = await runExport(source, { lang });
    ok(T("confirm text in " + lang), r.confirms.length === 1 && has(r.confirms[0], word), r.confirms[0]);
  }
  // happy path (organization from the cookie is wrong, so it must fall back to the list)
  const r = await runExport(source, { lang: "uk-UA" });
  const names = Object.keys(r.downloads);
  const mdName = names.find(x => x.endsWith(".md")), jsName = names.find(x => x.endsWith(".json"));
  ok(T("two files downloaded"), names.length === 2 && mdName && jsName, names.join());
  ok(T("file base name is sanitized and has the id prefix"), names.every(x => x.startsWith("Тест_ експорт _ _гілки_11111111.")), names.join());
  const md = r.downloads[mdName] || "", js = JSON.parse(r.downloads[jsName] || "{}");
  ok(T("md: title and header"), md.startsWith('# Тест: експорт / "гілки"') && has(md, "- Conversation ID: `" + CID + "`"));
  ok(T("md: only the active branch"), !has(md, "OLD BRANCH") && has(md, "Дякую"));
  ok(T("md: thinking hidden"), !has(md, "secret"));
  ok(T("md: artifact in a longer fence"), has(md, "````python"));
  ok(T("md: legacy text field"), has(md, "legacy text"));
  ok(T("md: attachments deduplicated, ids not shown"), has(md, "- data.csv\n- pic.png\n") && !has(md, "f1"));
  ok(T("md: speaker headings"), has(md, "## User — 2026-10-01T10:00:00Z") && has(md, "## Claude — "));
  ok(T("json: raw tree including the other branch"), js.chat_messages && js.chat_messages.length === 5);
  ok(T("no alert on success"), r.alerts.length === 0, r.alerts.join());
  // declined confirmation: nothing is fetched or saved
  const d = await runExport(source, { confirm: false });
  ok(T("declined confirm -> no requests, no files"), d.fetched.length === 0 && Object.keys(d.downloads).length === 0);
  // wrong site / wrong page, in each language
  for (const [lang, word] of [["en", "works only on"], ["uk", "працює лише"], ["ru", "работает только"]]) {
    const a = await runExport(source, { host: "example.com", lang });
    ok(T("wrong host alert (" + lang + ")"), a.alerts.length === 1 && a.alerts[0].startsWith("Export Claude: ") && has(a.alerts[0], word), a.alerts[0]);
    const b = await runExport(source, { path: "/new", lang });
    ok(T("no chat id alert (" + lang + ")"), b.alerts.length === 1 && has(b.alerts[0], "/chat/<id>"), b.alerts[0]);
  }
  // every organization refuses
  const f = await runExport(source, { allFail: true, lang: "en-US" });
  ok(T("fetch failure -> alert with HTTP status"), f.alerts.length === 1 && has(f.alerts[0], "Claude export failed") && has(f.alerts[0], "Could not fetch the conversation") && has(f.alerts[0], "HTTP 403"), f.alerts[0]);
  ok(T("fetch failure -> nothing saved"), Object.keys(f.downloads).length === 0);
}

// ---------- Limits (tiny fake DOM) ----------
class El {
  constructor(t) { this.tag = t; this.children = []; this.parent = null; this.style = {}; this._text = ""; this.id = ""; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter(x => x !== c); c.parent = null; return c; }
  get firstChild() { return this.children[0] || null; }
  remove() { if (this.parent) this.parent.removeChild(this); }
  contains(n) { for (; n; n = n.parent) if (n === this) return true; return false; }
}
function walk(e, f) { f(e); e.children.forEach(c => walk(c, f)); }
function texts(e) { const o = []; walk(e, n => { if (n._text) o.push(n._text); }); return o; }

async function limitsScenario(source, { orgs, usage, cookie }) {
  const body = new El("body"), intervals = [], cleared = [], keys = [], errors = [], alerts = [];
  let current = usage, fail = false;
  const doc = {
    cookie, body,
    getElementById: id => { let f = null; walk(body, n => { if (n.id === id) f = n; }); return f; },
    createElement: t => new El(t),
    addEventListener: (t, f) => keys.push(f),
    removeEventListener: (t, f) => { const i = keys.indexOf(f); if (i >= 0) keys.splice(i, 1); }
  };
  const ctx = {
    location: { hostname: "claude.ai" }, document: doc, alert: m => alerts.push(m),
    console: { log() {}, error: (...a) => errors.push(a.join(" ")) },
    setInterval: (f, ms) => { intervals.push({ f, ms }); return intervals.length; }, clearInterval: i => cleared.push(i),
    Intl, Date, Math, JSON, Number, String, Array, Object, RegExp, Error, Promise, decodeURIComponent,
    fetch: async u => {
      const R = (ok, s, j) => ({ ok, status: s, json: async () => j, text: async () => "boom" });
      if (u === "/api/organizations") return R(true, 200, orgs);
      if (/\/usage$/.test(u)) return fail ? R(false, 500, {}) : R(true, 200, current);
      return R(false, 404, {});
    }
  };
  vm.createContext(ctx);
  const run = () => vm.runInContext(source, ctx);
  await run(); await tick(5);
  const panel = () => doc.getElementById("__claude_limits_v2");
  const T = () => texts(panel());
  return { ctx, intervals, cleared, keys, errors, alerts, T, panel, run, setUsage: u => { current = u; }, setFail: f => { fail = f; } };
}

async function testLimits(label, source) {
  const T = s => label + ": " + s;
  const now = Date.now();
  const usage = {
    five_hour: { utilization: 0, resets_at: new Date(now + 4.9 * 3600e3).toISOString() },
    seven_day: { utilization: 31, resets_at: new Date(now + 4.4 * 86400e3).toISOString() },
    extra_usage: { is_enabled: false }
  };
  const ORG = "00000000-1111-4222-8333-444444444444";
  const plans = [
    ["Pro + default organization name -> id shown", { uuid: ORG, name: "someone@example.com's Organization", capabilities: ["chat", "claude_pro"], rate_limit_tier: "default_claude_ai" }, "Org: " + ORG + " / Plan: Pro"],
    ["Max 5x + real organization name", { uuid: ORG, name: "Acme Ltd", capabilities: ["chat", "claude_max"], rate_limit_tier: "default_claude_max_5x" }, "Org: Acme Ltd / Plan: Max 5x"],
    ["Max 20x", { uuid: ORG, name: "Acme Ltd", capabilities: ["chat", "claude_max"], rate_limit_tier: "default_claude_max_20x" }, "Org: Acme Ltd / Plan: Max 20x"],
    ["Team", { uuid: ORG, name: "Team X", capabilities: ["chat", "raven"], rate_limit_tier: "default_raven" }, "Org: Team X / Plan: Team"],
    ["Enterprise", { uuid: ORG, name: "Big Corp", capabilities: ["chat", "enterprise"] }, "Org: Big Corp / Plan: Enterprise"],
    ["unknown plan falls back to the raw value", { uuid: ORG, name: "Z", capabilities: ["chat"], rate_limit_tier: "weird_tier" }, "Org: Z / Plan: weird_tier"]
  ];
  for (const [name, org, expected] of plans) {
    const s = await limitsScenario(source, { orgs: [org], usage, cookie: "lastActiveOrg=" + ORG });
    ok(T(name), s.T().includes(expected), s.T().find(x => x.startsWith("Org:")));
    ok(T(name + ": no errors"), s.errors.length === 0 && s.alerts.length === 0, s.errors.concat(s.alerts).join());
  }
  // layout, refresh, failure, close
  const s = await limitsScenario(source, { orgs: [{ uuid: ORG, name: "Z", capabilities: ["chat", "claude_pro"] }], usage, cookie: "lastActiveOrg=" + ORG });
  const t0 = s.T();
  ok(T("compact blocks: labels and values"), ["QUOTA LEFT: ", "USED: ", "TIME LEFT: ", "ELAPSED: "].every(l => t0.includes(l)) && t0.includes("100%") && t0.includes("69%"));
  ok(T("no legacy 'Used: ... / Time elapsed' line"), !t0.some(x => /Time elapsed/.test(x)));
  ok(T("refresh interval is 60 s"), s.intervals.length === 1 && s.intervals[0].ms === 60000);
  s.setUsage(Object.assign({}, usage, { five_hour: { utilization: 77, resets_at: usage.five_hour.resets_at } }));
  await s.intervals[0].f();
  const t1 = s.T();
  ok(T("refresh updates the numbers"), t1.includes("23% left") && t1.includes("77%"));
  ok(T("refresh does not duplicate cards"), t1.filter(x => x === "QUOTA LEFT: ").length === 2);
  s.setFail(true); await s.intervals[0].f();
  ok(T("failed refresh keeps data and shows the error"), s.T().includes("QUOTA LEFT: ") && s.T().some(x => x.startsWith("Update failed")));
  s.setFail(false); await s.intervals[0].f();
  ok(T("recovers after a failure"), s.T().some(x => x.startsWith("Updated ")));
  s.run(); await tick(5);
  ok(T("second click closes the panel"), s.panel() === null);
  ok(T("timer and key listener are released"), s.cleared.length === 1 && s.keys.length === 0);
  // limit reached, window without reset time
  const u2 = { five_hour: { utilization: 100, resets_at: null }, seven_day: { utilization: 5, resets_at: new Date(now + 86400e3).toISOString() } };
  const s2 = await limitsScenario(source, { orgs: [{ uuid: ORG, name: "Z", capabilities: ["chat"] }], usage: u2, cookie: "lastActiveOrg=" + ORG });
  ok(T("LIMIT REACHED badge"), s2.T().includes("LIMIT REACHED"));
  ok(T("missing reset time is shown as '-'"), s2.T().includes("-") && s2.errors.length === 0);
  // wrong site
  const s3 = await limitsScenario("(function(){})()", { orgs: [], usage, cookie: "" });
  ok(T("harness sanity"), s3.panel() === null);
}

(async () => {
  for (const kind of ["src", "dist"]) {
    await testExport("export/" + kind, code.export[kind]);
    await testLimits("limits/" + kind, code.limits[kind]);
  }
  console.log(passed + " checks passed" + (failures.length ? ", " + failures.length + " FAILED" : ""));
  for (const f of failures) console.log("  FAIL: " + f);
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
