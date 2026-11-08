import { registrableDomain, domainAge, lookupReviews, score, REVIEW_SITES, DEFAULT_SITES } from "./checks.js";

const CACHE_MS = 24 * 60 * 60 * 1000;
const inFlight = new Map(); // cache key -> Promise, so tabs share one fetch

// Fetch once a day per domain and source. Failures aren't cached, so a
// timeout or bot check is retried on the next visit.
async function cached(key, fetcher, isFailure) {
  const { [key]: hit } = await chrome.storage.local.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  if (!inFlight.has(key)) {
    inFlight.set(key, (async () => {
      const value = await fetcher();
      if (!isFailure(value)) await chrome.storage.local.set({ [key]: { at: Date.now(), value } });
      return value;
    })().finally(() => inFlight.delete(key)));
  }
  return inFlight.get(key);
}

async function enabledSites() {
  const { sites = {} } = await chrome.storage.sync.get("sites");
  const on = { ...DEFAULT_SITES, ...sites };
  return REVIEW_SITES.filter((s) => on[s.id]);
}

async function check(domain, page) {
  const sites = await enabledSites();
  const failed = (v) => Boolean(v.error);
  const [age, ...found] = await Promise.all([
    cached(`age:${domain}`, () => domainAge(domain), failed),
    ...sites.map((s) => cached(`rev:${s.id}:${domain}`, () => lookupReviews(s, domain), failed)),
  ]);
  const reviews = found.map((r, i) => ({ id: sites[i].id, name: sites[i].name, ...r }));
  return { domain, age, reviews, ...score({ age, reviews, page }) };
}

async function isAllowed(domain) {
  const { allowList = [] } = await chrome.storage.sync.get("allowList");
  return allowList.includes(domain);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    const domain = registrableDomain(msg.hostname || "");
    if (msg.type === "check") {
      if (!msg.force && await isAllowed(domain)) return sendResponse({ skipped: true });
      sendResponse(await check(domain, msg.page));
    } else if (msg.type === "allow") {
      const { allowList = [] } = await chrome.storage.sync.get("allowList");
      if (!allowList.includes(domain)) allowList.push(domain);
      await chrome.storage.sync.set({ allowList });
      sendResponse({ ok: true });
    }
  })().catch((e) => sendResponse({ error: String(e) }));
  return true; // reply asynchronously
});

// Clicking the toolbar icon checks the page even if it doesn't look like a shop.
chrome.action.onClicked.addListener((tab) => {
  if (tab.id != null) chrome.tabs.sendMessage(tab.id, { type: "force" }).catch(() => {});
});
