// Export Claude - bookmarklet source (readable version).
// Exports the current claude.ai conversation to JSON (raw API response, the whole branch tree)
// and Markdown (active branch only: visible text + artifacts + attachment names).
// Sends nothing to third-party sites: it only calls claude.ai with your own session.
// Build: comment lines and line breaks are removed, so every statement MUST end with a semicolon.
(async () => {
  const INCLUDE_THINKING = false; // true: add thinking blocks to the Markdown as <details>
  const LANG_OVERRIDE = ""; // "", "en", "uk" or "ru": language of the dialog messages ("" = browser language)
  const N = "Export Claude";
  const MSG = {
    en: {
      only: "This bookmarklet works only on https://claude.ai/",
      open: "Open a specific Claude conversation (/chat/<id>) and try again.",
      confirm: "Export the current Claude conversation to JSON and Markdown?\n\nNo data is sent to third-party sites.",
      fetchFail: "Could not fetch the conversation.\n",
      noMsgs: "No chat_messages in the response",
      failed: "Claude export failed.\n\n"
    },
    uk: {
      only: "Ця закладка працює лише на https://claude.ai/",
      open: "Відкрийте конкретну розмову Claude (/chat/<id>) і повторіть.",
      confirm: "Експортувати поточну розмову Claude у JSON і Markdown?\n\nЖодні дані не надсилаються на сторонні сайти.",
      fetchFail: "Не вдалося отримати розмову.\n",
      noMsgs: "У відповіді немає chat_messages",
      failed: "Помилка експорту Claude.\n\n"
    },
    ru: {
      only: "Эта закладка работает только на https://claude.ai/",
      open: "Откройте конкретный разговор Claude (/chat/<id>) и повторите.",
      confirm: "Экспортировать текущий разговор Claude в JSON и Markdown?\n\nДанные не отправляются на сторонние сайты.",
      fetchFail: "Не удалось получить разговор.\n",
      noMsgs: "В ответе нет chat_messages",
      failed: "Ошибка экспорта Claude.\n\n"
    }
  };
  const lg = String(LANG_OVERRIDE || (typeof navigator !== "undefined" && navigator.language) || "en").slice(0, 2).toLowerCase();
  const M = MSG[lg] || MSG.en;
  try {
    if (location.hostname !== "claude.ai") { alert(N + ": " + M.only); return; }
    const pm = location.pathname.match(/\/chat\/([0-9a-f-]{36})/i);
    if (!pm) { alert(N + ": " + M.open); return; }
    const id = pm[1];
    if (!confirm(M.confirm)) return;

    const get = url => fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
    const q = "?tree=True&rendering_mode=messages&render_all_tools=true";
    let lastErr = "";
    const tryOrg = async o => {
      const r = await get("/api/organizations/" + encodeURIComponent(o) + "/chat_conversations/" + id + q);
      if (r.ok) return r.json();
      lastErr = o + " -> HTTP " + r.status + " " + (await r.text()).slice(0, 300);
      return null;
    };

    // 1) organization from the lastActiveOrg cookie; 2) if it does not match, try every organization from /api/organizations
    const tried = [];
    let d = null;
    const ck = document.cookie.match(/(?:^|;\s*)lastActiveOrg=([^;]+)/);
    if (ck) { const o = decodeURIComponent(ck[1]); tried.push(o); d = await tryOrg(o); }
    if (!d) {
      const r = await get("/api/organizations");
      if (!r.ok) throw Error("/api/organizations -> HTTP " + r.status);
      const list = await r.json();
      for (const o of Array.isArray(list) ? list : []) {
        if (!o || !o.uuid || tried.includes(o.uuid)) continue;
        tried.push(o.uuid);
        d = await tryOrg(o.uuid);
        if (d) break;
      }
    }
    if (!d) throw Error(M.fetchFail + lastErr);
    const msgs = d.chat_messages;
    if (!Array.isArray(msgs)) throw Error(M.noMsgs);

    // Active branch: from current_leaf_message_uuid up through parent_message_uuid
    const by = new Map(msgs.map(x => [x.uuid, x]));
    let chain = [];
    const leaf = d.current_leaf_message_uuid;
    if (leaf && by.has(leaf)) {
      const seen = new Set();
      let n = by.get(leaf);
      while (n && !seen.has(n.uuid)) { seen.add(n.uuid); chain.push(n); n = by.get(n.parent_message_uuid); }
      chain.reverse();
    } else {
      chain = msgs.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0) || String(a.created_at).localeCompare(String(b.created_at)));
    }

    const sf = (s, m = 100) => {
      s = String(s || "").replace(/[\x00-\x1F\x7F]/g, "").replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().replace(/^[ ._-]+|[ ._-]+$/g, "");
      return (s || "claude-conversation").slice(0, m).replace(/[ ._-]+$/g, "");
    };
    const tr = s => String(s ?? "").trim();
    const fence = (s, lang) => { const t = String(s); let f = "```"; while (t.includes(f)) f += "`"; return f + (lang || "") + "\n" + t + "\n" + f; };

    let skipped = 0;
    const render = msg => {
      const parts = [];
      const c = Array.isArray(msg.content) ? msg.content : null;
      if (c && c.length) {
        for (const b of c) {
          if (!b || typeof b !== "object") continue;
          if (b.type === "text") { if (tr(b.text)) parts.push(tr(b.text)); }
          else if (b.type === "thinking" && INCLUDE_THINKING && tr(b.thinking)) {
            parts.push("<details><summary>Thinking</summary>\n\n" + tr(b.thinking) + "\n\n</details>");
          } else if (b.type === "tool_use" && b.name === "artifacts" && b.input && typeof b.input.content === "string") {
            const i = b.input;
            parts.push("**Artifact" + (i.title ? ": " + i.title : "") + "**" + (i.command && i.command !== "create" ? " (" + i.command + ")" : "") + "\n\n" + fence(i.content, i.language));
          } else skipped++;
        }
      } else if (tr(msg.text)) parts.push(tr(msg.text));
      const names = [...(msg.attachments || []), ...(msg.files || []), ...(msg.files_v2 || [])]
        .map(a => a && (a.file_name || a.name || a.file_uuid || a.uuid)).filter(Boolean);
      const uniq = [...new Set(names)];
      if (uniq.length) parts.push("**Attachments:**\n" + uniq.map(x => "- " + x).join("\n"));
      return parts.join("\n\n");
    };

    const title = String(d.name || "Claude conversation");
    const base = sf(title) + "_" + id.slice(0, 8);
    const o = ["# " + title, "", "- Conversation ID: `" + id + "`", "- URL: https://claude.ai/chat/" + id];
    if (d.created_at) o.push("- Created: " + d.created_at);
    if (d.updated_at) o.push("- Updated: " + d.updated_at);
    if (d.model) o.push("- Model: " + d.model);
    if (tr(d.summary)) o.push("", "> " + tr(d.summary).replace(/\n/g, "\n> "));
    o.push("", "---", "");

    let uc = 0, ac = 0;
    for (const m of chain) {
      const t = render(m);
      if (!t) { skipped++; continue; }
      const lab = m.sender === "human" ? (uc++, "User") : (ac++, "Claude");
      o.push("## " + lab + (m.created_at ? " — " + m.created_at : ""), "", t, "", "---", "");
    }

    const dl = (n, t, ty) => {
      const b = new Blob([t], { type: ty }), u = URL.createObjectURL(b), a = document.createElement("a");
      a.href = u; a.download = n; a.style.display = "none";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 3e4);
    };
    dl(base + ".json", JSON.stringify(d, null, 2) + "\n", "application/json;charset=utf-8");
    setTimeout(() => dl(base + ".md", o.join("\n").replace(/\s+$/, "") + "\n", "text/markdown;charset=utf-8"), 350);
    console.log("Export complete:", title, uc + " user + " + ac + " assistant messages; " + skipped + " non-visible blocks skipped; " + (msgs.length - chain.length) + " messages in other branches (JSON only)");
  } catch (e) {
    console.error("Claude export failed:", e);
    alert(M.failed + (e && e.message || e));
  }
})();
