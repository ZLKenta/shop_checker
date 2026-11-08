// Runs on every page. If the page looks like a shop, asks the background
// worker for a verdict and shows a banner at the top of the page.
(() => {
  if (window.top !== window || window.__shopCheckerLoaded) return;
  window.__shopCheckerLoaded = true;

  // ---- Is this a shop? -------------------------------------------------
  function shopSignals() {
    const found = [];
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      if (/"@type"\s*:\s*"(Product|Offer|AggregateOffer|Store|OnlineStore)"/.test(s.textContent)) {
        found.push("product markup"); break;
      }
    }
    if (document.querySelector('meta[property="og:type"][content*="product" i], [itemtype*="schema.org/Product"]')) found.push("product meta");
    // Shop platforms, judged by the files the page loads, not by words on it.
    const assets = [...document.querySelectorAll("script[src], link[href]")]
      .map((e) => e.getAttribute("src") || e.getAttribute("href")).join("\n");
    if (/cdn\.shopify\.com|\/cdn\/shop\//.test(assets)) found.push("Shopify");
    if (/\/plugins\/woocommerce\//.test(assets)) found.push("WooCommerce");
    if (/\/static\/version\d+\/frontend\/|bigcommerce\.com|\/modules\/ps_/i.test(assets)) found.push("shop platform");
    const buttons = [...document.querySelectorAll('button, input[type="submit"], a')].slice(0, 2000);
    if (buttons.some((b) => /\b(add to (cart|basket|bag)|buy now|checkout)\b/i.test(b.textContent || b.value || ""))) found.push("buy button");
    if (document.querySelector('a[href*="/cart"], a[href*="/basket"], a[href*="/checkout"]')) found.push("cart link");
    const labels = [...document.querySelectorAll('a, button')].slice(0, 2000)
      .map((e) => `${e.getAttribute("aria-label") || ""} ${e.textContent.slice(0, 60)}`).join("\n");
    if (/\b(your|view|my) (basket|cart|bag)\b|\bitems? in (your )?(basket|cart|bag)\b/i.test(labels)) found.push("basket button");
    if (/\bwish ?list\b/i.test(labels)) found.push("wishlist");
    const prices = (document.body?.innerText || "").match(/[\u00A3$\u20AC]\s?\d[\d,]*(\.\d{2})?/g) || [];
    if (prices.length >= 5) found.push("prices");
    return found;
  }

  // ---- Warning signs on the page --------------------------------------
  function pageSigns() {
    const text = document.body?.innerText || "";
    const links = [...document.querySelectorAll("a")].map((a) => `${a.textContent} ${a.getAttribute("href") || ""}`).join("\n");
    const hasContact =
      /\b(contact( us)?|customer service|help centre|help center|support)\b/i.test(links) ||
      /mailto:|tel:/i.test(links) ||
      /[\w.+-]+@[\w-]+\.[\w.]+/.test(text);
    const hasReturns = /\b(returns?|refunds?)\b/i.test(links);
    let maxDiscount = 0;
    for (const m of text.matchAll(/(?:-\s?(\d{2})\s?%|(\d{2})\s?%\s*off)/gi)) {
      const n = parseInt(m[1] || m[2], 10);
      if (n <= 95 && n > maxDiscount) maxDiscount = n;
    }
    return { hasContact, hasReturns, maxDiscount, https: location.protocol === "https:" };
  }

  // ---- Banner ----------------------------------------------------------
  const COLOURS = {
    green: { bg: "#e7f6ec", border: "#2e7d4f", icon: "\u{1F7E2}", title: "This shop looks OK" },
    amber: { bg: "#fff4dc", border: "#b7791f", icon: "\u{1F7E1}", title: "Be careful with this shop" },
    red:   { bg: "#fde8e8", border: "#c53030", icon: "\u{1F534}", title: "This shop may be a scam" },
    wait:  { bg: "#eef1f5", border: "#5a6b82", icon: "\u23F3", title: "Checking this shop\u2026" },
  };
  const TONE_ICON = { good: "\u2713", warn: "!", bad: "\u2717", info: "\u00B7" };

  let host;
  function showBanner(result) {
    host?.remove();
    host = document.createElement("div");
    host.style.cssText = "all: initial; position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483647;";
    const root = host.attachShadow({ mode: "closed" });
    const c = COLOURS[result.level] || COLOURS.wait;
    const reasons = (result.reasons || [])
      .map((r) => `<li class="${r.tone}"><span>${TONE_ICON[r.tone] || "\u00B7"}</span>${escapeHtml(r.text)}</li>`).join("");
    // A link to each review site's page, found or not, so you can look yourself.
    const siteLinks = (result.reviews || []).filter((r) => r.url)
      .map((r) => `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.name)}</a>`).join("");
    root.innerHTML = `
      <style>
        .box { font: 14px/1.4 system-ui, sans-serif; color: #1d1d1f; background: ${c.bg};
               border: 2px solid ${c.border}; border-radius: 12px; padding: 12px 16px;
               box-shadow: 0 6px 24px rgba(0,0,0,.18); width: min(440px, 90vw); }
        .head { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 15px; }
        .head .domain { font-weight: 400; color: #555; }
        .head .logo { width: 30px; height: 30px; flex-shrink: 0; margin: -4px 0 -4px -4px; }
        .close { margin-left: auto; border: none; background: none; font-size: 18px; cursor: pointer; color: #444; }
        ul { margin: 8px 0 0; padding: 0; list-style: none; }
        li { display: flex; gap: 8px; margin: 3px 0; }
        li span { width: 1em; text-align: center; font-weight: 700; }
        li.good span { color: #2e7d4f; } li.warn span { color: #b7791f; }
        li.bad span { color: #c53030; } li.info { color: #666; }
        .foot { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 10px; font-size: 13px; }
        .foot .allow { margin-left: auto; }
        a, button.link { color: #8a3a00; background: none; border: none; padding: 0; font: inherit; cursor: pointer; text-decoration: underline; }
      </style>
      <div class="box" role="alert">
        <div class="head"><img class="logo" src="${chrome.runtime.getURL("icons/icon-48.png")}" alt="" title="Lance's Shop Checker">${c.icon} ${c.title} <span class="domain">${escapeHtml(result.domain || location.hostname)}</span>
          <button class="close" title="Close">&times;</button></div>
        ${reasons ? `<ul>${reasons}</ul>` : ""}
        ${result.level && result.level !== "wait" ? `<div class="foot">${siteLinks}<button class="link allow">Don't check this site again</button></div>` : ""}
      </div>`;
    // If a site blocks the icon from loading, leave it out rather than show a broken image.
    root.querySelector(".logo").addEventListener("error", (e) => e.target.remove());
    root.querySelector(".close").onclick = () => host.remove();
    root.querySelector(".allow")?.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "allow", hostname: location.hostname });
      host.remove();
    });
    document.documentElement.appendChild(host);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  // ---- Run -------------------------------------------------------------
  let checking = false;
  async function run(force) {
    if (checking) return;
    if (!force && shopSignals().length < 2) return;
    checking = true;
    showBanner({ level: "wait" });
    try {
      const result = await chrome.runtime.sendMessage({
        type: "check", force, hostname: location.hostname, page: pageSigns(),
      });
      if (result?.skipped) host?.remove();
      else if (result?.error) showBanner({ level: "amber", reasons: [{ tone: "info", text: `Check failed: ${result.error}` }] });
      else showBanner(result);
    } finally {
      checking = false;
    }
  }

  chrome.runtime.onMessage.addListener((msg) => { if (msg.type === "force") run(true); });
  // Expose for testing outside the extension.
  window.__shopChecker = { shopSignals, pageSigns, showBanner };
  run(false);
})();
