import { REVIEW_SITES, DEFAULT_SITES } from "./checks.js";

const DESCRIPTIONS = {
  trustpilot: "The biggest review site. Anyone can post, so big brands often score low.",
  sitejabber: "The second biggest open review site, now also called SmartCustomer. Strongest in the US.",
  reviewsio: "Popular with UK shops, mostly reviews from invited customers. Found only if the shop's page name matches its domain.",
};

const savedEl = document.getElementById("saved");
let savedTimer;
function showSaved(text = "Saved. Applies to the next site you open.") {
  savedEl.textContent = text;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => (savedEl.textContent = ""), 2500);
}

async function renderSites() {
  const { sites = {} } = await chrome.storage.sync.get("sites");
  const on = { ...DEFAULT_SITES, ...sites };
  const box = document.getElementById("sites");
  box.replaceChildren();
  REVIEW_SITES.forEach((site, i) => {
    const label = document.createElement("label");
    label.className = "site";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(on[site.id]);
    input.addEventListener("change", async () => {
      const { sites: current = {} } = await chrome.storage.sync.get("sites");
      await chrome.storage.sync.set({ sites: { ...current, [site.id]: input.checked } });
      showSaved();
    });
    const text = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = site.name;
    text.append(name);
    if (i > 0) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = "optional";
      text.append(tag);
    }
    const small = document.createElement("small");
    small.textContent = DESCRIPTIONS[site.id] || "";
    text.append(small);
    label.append(input, text);
    box.append(label);
  });
}

async function renderAllowList() {
  const { allowList = [] } = await chrome.storage.sync.get("allowList");
  const ul = document.getElementById("allow");
  ul.replaceChildren();
  if (!allowList.length) {
    const li = document.createElement("li");
    li.textContent = "None yet.";
    ul.append(li);
    return;
  }
  for (const domain of allowList) {
    const li = document.createElement("li");
    li.textContent = domain;
    const btn = document.createElement("button");
    btn.textContent = "Check again";
    btn.addEventListener("click", async () => {
      const { allowList: list = [] } = await chrome.storage.sync.get("allowList");
      await chrome.storage.sync.set({ allowList: list.filter((d) => d !== domain) });
      renderAllowList();
      showSaved(`${domain} will be checked again.`);
    });
    li.append(btn);
    ul.append(li);
  }
}

renderSites();
renderAllowList();
