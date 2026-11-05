// Claude Limits v2 - bookmarklet source (readable version).
// Build: comment lines and line breaks are removed, so every statement MUST end with a semicolon.
// Forbidden in the source: the percent sign (breaks javascript: URLs), inline comments.
(async () => {
  try {
    if (location.hostname !== "claude.ai") { alert("Claude Limits works only on claude.ai"); return; }
    var BOX_ID = "__claude_limits_v2";
    var old = document.getElementById(BOX_ID);
    if (old) { if (old.__close) { old.__close(); } else { old.remove(); } return; }
    var P = String.fromCharCode(37);
    var REFRESH_MS = 60000;

    function cookie(n) {
      var a = document.cookie.split(";");
      for (var i = 0; i < a.length; i++) {
        var s = a[i].trim();
        var k = s.indexOf("=");
        if (k > 0 && s.slice(0, k) === n) { return decodeURIComponent(s.slice(k + 1)); }
      }
      return null;
    }
    async function getJson(u) {
      var r = await fetch(u, { credentials: "include", headers: { Accept: "application/json" } });
      if (!r.ok) {
        var e = new Error(u + " HTTP " + r.status + " " + (await r.text()).slice(0, 240));
        e.status = r.status;
        throw e;
      }
      return r.json();
    }
    var orgs = null;
    async function loadOrgs() {
      if (!orgs) { var x = await getJson("/api/organizations"); orgs = Array.isArray(x) ? x : []; }
      return orgs;
    }
    function pickOrg(l) {
      for (var i = 0; i < l.length; i++) {
        var c = l[i].capabilities || [];
        if (c.indexOf("chat") >= 0) { return l[i]; }
      }
      return l[0];
    }

    var org = cookie("lastActiveOrg");
    if (!org) {
      var o = pickOrg(await loadOrgs());
      if (!o) { throw new Error("No organization found"); }
      org = o.uuid;
    }
    var ep = "/api/organizations/" + org + "/usage";
    async function fetchUsage() {
      try {
        return await getJson(ep);
      } catch (e) {
        if (e.status !== 403 && e.status !== 404) { throw e; }
        var o2 = pickOrg(await loadOrgs());
        if (!o2 || o2.uuid === org) { throw e; }
        org = o2.uuid;
        ep = "/api/organizations/" + org + "/usage";
        return await getJson(ep);
      }
    }
    var d = await fetchUsage();

    var orgObj = null;
    try {
      var ol = await loadOrgs();
      for (var i = 0; i < ol.length; i++) { if (ol[i].uuid === org) { orgObj = ol[i]; break; } }
    } catch (e) { orgObj = null; }
    console.log("Claude Limits: organization object", orgObj);

    function has(s, w) { return new RegExp("(^|[^a-z])" + w + "([^a-z]|$)").test(s); }
    function planName(o) {
      if (!o) { return "-"; }
      var caps = Array.isArray(o.capabilities) ? o.capabilities : [];
      var tier = String(o.rate_limit_tier || "");
      var s = (caps.join(" ") + " " + tier + " " + String(o.billing_type || "")).toLowerCase();
      if (has(s, "max")) { var m = s.match(/(\d+)x/); return "Max" + (m ? " " + m[1] + "x" : ""); }
      if (has(s, "enterprise")) { return "Enterprise"; }
      if (has(s, "raven") || has(s, "team")) { return "Team"; }
      if (has(s, "pro")) { return "Pro"; }
      if (has(s, "free")) { return "Free"; }
      var raw = caps.filter(function (c) { return c !== "chat"; }).join(", ");
      return tier || raw || "-";
    }
    function orgLabel(o, id) {
      var n = o && o.name ? String(o.name) : "";
      if (!n || /organization/i.test(n)) { return id; }
      return n;
    }

    function num(v) { v = Number(v); return Number.isFinite(v) ? v : 0; }
    function pad(v) { return String(v).padStart(2, "0"); }
    function toSec(iso) {
      if (!iso) { return 0; }
      var t = Date.parse(iso);
      return Number.isFinite(t) ? t / 1000 : 0;
    }
    function localTime(t) {
      if (!t) { return "-"; }
      var dt = new Date(t * 1000);
      return dt.getFullYear() + "-" + pad(dt.getMonth() + 1) + "-" + pad(dt.getDate()) + " " + pad(dt.getHours()) + ":" + pad(dt.getMinutes());
    }
    function clock(dt) { return pad(dt.getHours()) + ":" + pad(dt.getMinutes()) + ":" + pad(dt.getSeconds()); }
    function timeLeft(t) {
      if (!t) { return "-"; }
      var sec = Math.max(0, Math.floor(t - Date.now() / 1000));
      var day = Math.floor(sec / 86400); sec -= day * 86400;
      var hour = Math.floor(sec / 3600); sec -= hour * 3600;
      var min = Math.floor(sec / 60);
      if (day > 0) { return day + " d " + hour + " h " + min + " min"; }
      if (hour > 0) { return hour + " h " + min + " min"; }
      return min + " min";
    }
    function timeLeftPercent(reset, win) {
      if (!reset || !win) { return null; }
      var left = Math.max(0, reset - Date.now() / 1000);
      return Math.max(0, Math.min(100, left / win * 100));
    }
    function zoneName() {
      try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "local time"; } catch (e) { return "local time"; }
    }
    function tone(left) {
      if (left <= 10) { return ["rgb(190,50,50)", "rgb(255,235,235)"]; }
      if (left <= 30) { return ["rgb(190,125,20)", "rgb(255,245,220)"]; }
      return ["rgb(35,145,85)", "rgb(230,248,238)"];
    }
    function winSec(k, reset) {
      if (k.indexOf("five_hour") === 0) { return 18000; }
      if (k.indexOf("seven_day") === 0) { return 604800; }
      var left = reset ? reset - Date.now() / 1000 : 0;
      return left > 18000 ? 604800 : 18000;
    }
    var names = { five_hour: "5-hour / session", seven_day: "Weekly / all models", seven_day_opus: "Weekly / Opus", seven_day_sonnet: "Weekly / Sonnet", seven_day_oauth_apps: "Weekly / OAuth apps" };
    var order = ["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet", "seven_day_oauth_apps"];
    function buildRows(data) {
      var keys = order.concat(Object.keys(data || {}).filter(function (k) { return order.indexOf(k) < 0; }));
      var rows = [];
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (k === "extra_usage") { continue; }
        var v = data && data[k];
        if (!v || typeof v !== "object" || v.utilization == null) { continue; }
        var u = Number(v.utilization);
        if (!Number.isFinite(u)) { continue; }
        var used = Math.max(0, Math.min(100, u));
        var reset = toSec(v.resets_at);
        rows.push({ name: names[k] || k.replace(/_/g, " "), used: used, left: Math.max(0, 100 - used), reset: reset, tl: timeLeftPercent(reset, winSec(k, reset)) });
      }
      return rows;
    }

    function mk(tag, css, text, parent) {
      var e = document.createElement(tag);
      if (css) { e.style.cssText = css; }
      if (text != null) { e.textContent = text; }
      if (parent) { parent.appendChild(e); }
      return e;
    }
    var LBL = "font-size:11px;font-weight:700;letter-spacing:.05em;color:rgb(85,85,85)";
    function stat(parent, l1, v1, c1, l2, v2) {
      var row = mk("div", "display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-top:8px", null, parent);
      var a = mk("div", "white-space:nowrap", null, row);
      mk("span", LBL, l1 + ": ", a);
      mk("span", "font-size:15px;font-weight:800;color:" + c1, v1, a);
      var b = mk("div", "white-space:nowrap", null, row);
      mk("span", LBL, l2 + ": ", b);
      mk("span", "font-size:13px;font-weight:700;color:rgb(70,70,70)", v2, b);
    }
    function bar(parent, frac, color) {
      var t = mk("div", "height:9px;background:rgb(215,215,215);border-radius:99px;overflow:hidden;margin-top:4px", null, parent);
      mk("div", "height:9px;background:" + color + ";transform-origin:left center;transform:scaleX(" + Math.max(0, Math.min(1, frac)) + ")", null, t);
    }

    var wrap = mk("div", "position:fixed;inset:0;z-index:2147483647;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center", null, null);
    wrap.id = BOX_ID;
    var shade = mk("div", "position:absolute;inset:0;background:rgba(0,0,0,.55)", null, wrap);
    var panel = mk("div", "position:relative;width:min(550px,calc(100vw - 28px));max-height:82vh;overflow:auto;background:rgb(250,250,250);color:rgb(30,30,30);border:1px solid rgb(180,180,180);border-radius:14px;box-shadow:0 18px 55px rgba(0,0,0,.35);padding:18px 20px;box-sizing:border-box", null, wrap);
    var close = mk("button", "float:right;border:0;background:transparent;color:rgb(80,80,80);font-size:24px;cursor:pointer;line-height:1", "x", panel);
    mk("div", "font-size:21px;font-weight:700;margin-bottom:3px", "Claude usage", panel);
    mk("div", "font-size:12px;color:rgb(105,105,105);margin-bottom:4px;word-break:break-all", "Org: " + orgLabel(orgObj, org) + " / Plan: " + planName(orgObj), panel);
    mk("div", "font-size:12px;color:rgb(90,90,90);margin-bottom:6px", "Reset clock uses browser zone: " + zoneName(), panel);
    var body = mk("div", "", null, panel);
    var foot = mk("div", "font-size:11px;color:rgb(125,125,125);margin-top:12px", null, panel);
    var status = mk("div", "font-size:11px;margin-top:4px;color:rgb(125,125,125)", null, panel);

    function paint(data) {
      while (body.firstChild) { body.removeChild(body.firstChild); }
      var rows = buildRows(data);
      if (!rows.length) {
        mk("div", "padding:14px;background:rgb(240,240,240);border-radius:9px;font-size:12px;word-break:break-all;margin:8px 0", "No rate-limit windows found. Raw: " + JSON.stringify(data).slice(0, 400), body);
      }
      for (var i = 0; i < rows.length; i++) {
        var x = rows[i];
        var tc = tone(x.left);
        var card = mk("div", "margin:10px 0 12px;padding:11px 14px 13px;background:" + tc[1] + ";border:1px solid rgb(215,215,215);border-radius:10px", null, body);
        var top = mk("div", "display:flex;justify-content:space-between;gap:14px;align-items:baseline", null, card);
        var nm = mk("div", "font-weight:700;font-size:15px", x.name, top);
        if (x.used >= 100) { mk("span", "margin-left:10px;font-size:11px;font-weight:800;color:rgb(190,50,50)", "LIMIT REACHED", nm); }
        mk("div", "font-weight:800;font-size:18px;color:" + tc[0] + ";white-space:nowrap", Math.round(x.left) + P + " left", top);
        stat(card, "QUOTA LEFT", Math.round(x.left) + P, tc[0], "USED", Math.round(x.used) + P);
        bar(card, x.left / 100, tc[0]);
        stat(card, "TIME LEFT", x.tl == null ? "-" : Math.round(x.tl) + P, "rgb(55,125,215)", "ELAPSED", x.tl == null ? "-" : Math.round(100 - x.tl) + P);
        bar(card, x.tl == null ? 0 : x.tl / 100, "rgb(55,125,215)");
        var rg = mk("div", "display:grid;grid-template-columns:1fr 1fr;column-gap:18px;row-gap:2px;align-items:end;margin-top:10px", null, card);
        mk("div", "font-size:11px;font-weight:700;letter-spacing:.08em;color:rgb(95,95,95)", "RESETS IN", rg);
        mk("div", "font-size:11px;font-weight:700;letter-spacing:.08em;color:rgb(95,95,95);text-align:right", "RESETS AT", rg);
        mk("div", "font-size:21px;font-weight:800;color:" + tc[0] + ";white-space:nowrap", timeLeft(x.reset), rg);
        mk("div", "font-size:17px;font-weight:700;color:rgb(55,55,55);text-align:right;white-space:nowrap", localTime(x.reset), rg);
      }
      var ex = data && data.extra_usage;
      if (ex && typeof ex === "object") {
        var ct = "Extra usage: " + (ex.is_enabled ? "ON" : "OFF");
        if (ex.is_enabled) {
          if (ex.utilization != null && Number.isFinite(Number(ex.utilization))) { ct += " / used " + Math.round(num(ex.utilization)) + P; }
          if (ex.used_credits != null && ex.monthly_limit != null) { ct += " (" + ex.used_credits + " of " + ex.monthly_limit + ")"; }
        }
        mk("div", "margin-top:8px;padding-top:10px;border-top:1px solid rgb(210,210,210);font-weight:600", ct, body);
      }
      foot.textContent = "QUOTA LEFT = unused quota. TIME LEFT = remaining fraction of the current window. RESETS IN is timezone-independent. Source: " + ep.replace(org, "{org}");
    }

    var timer = null;
    var busy = false;
    var lastOk = null;
    function onKey(e) { if (e.key === "Escape") { closeBox(); } }
    function closeBox() {
      if (timer) { clearInterval(timer); timer = null; }
      document.removeEventListener("keydown", onKey);
      wrap.remove();
    }
    async function refresh() {
      if (busy) { return; }
      if (!document.body.contains(wrap)) { if (timer) { clearInterval(timer); timer = null; } return; }
      busy = true;
      try {
        var nd = await fetchUsage();
        paint(nd);
        lastOk = new Date();
        status.style.color = "rgb(125,125,125)";
        status.textContent = "Updated " + clock(lastOk) + " / auto-refresh every " + (REFRESH_MS / 1000) + " s";
      } catch (e) {
        status.style.color = "rgb(190,50,50)";
        status.textContent = "Update failed (" + (e && e.message ? String(e.message).slice(0, 120) : e) + ")" + (lastOk ? ", showing data from " + clock(lastOk) : "") + ". Retrying in " + (REFRESH_MS / 1000) + " s";
      }
      busy = false;
    }

    close.onclick = closeBox;
    shade.onclick = closeBox;
    wrap.__close = closeBox;
    document.addEventListener("keydown", onKey);
    paint(d);
    lastOk = new Date();
    status.textContent = "Updated " + clock(lastOk) + " / auto-refresh every " + (REFRESH_MS / 1000) + " s";
    document.body.appendChild(wrap);
    timer = setInterval(refresh, REFRESH_MS);
  } catch (e) {
    console.error("Claude Limits failed:", e);
    alert("Claude Limits error\n\n" + (e && e.message ? e.message : e));
  }
})();
