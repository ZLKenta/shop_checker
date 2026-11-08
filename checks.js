// Lookups and scoring. No API keys needed. Plain ES module so it can be
// tested from Node as well as run in the extension's service worker.

// Suffixes where the registrable domain has three labels (shop.co.uk).
// Not the full Public Suffix List, but it covers the common shopping ones.
const TWO_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk", "ac.uk", "gov.uk",
  "com.au", "net.au", "org.au", "co.nz", "net.nz", "org.nz",
  "co.za", "com.br", "com.mx", "com.ar", "com.tr", "com.cn", "com.hk",
  "com.sg", "com.my", "co.in", "co.jp", "co.kr", "com.tw", "co.il",
]);

export function registrableDomain(hostname) {
  const parts = hostname.toLowerCase().replace(/\.$/, "").split(".");
  if (parts.length <= 2) return parts.join(".");
  const lastTwo = parts.slice(-2).join(".");
  const take = TWO_PART_SUFFIXES.has(lastTwo) ? 3 : 2;
  return parts.slice(-take).join(".");
}

async function fetchWithTimeout(url, ms = 8000, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, redirect: "follow", ...init });
  } finally {
    clearTimeout(timer);
  }
}

// When was the domain registered? Uses RDAP, the free successor to WHOIS.
// Returns { ageDays, registered } or { error }.
export async function domainAge(domain) {
  try {
    const res = await fetchWithTimeout(`https://rdap.org/domain/${domain}`);
    if (!res.ok) return { error: `RDAP returned ${res.status}` };
    const data = await res.json();
    const reg = (data.events || []).find((e) => e.eventAction === "registration");
    if (!reg?.eventDate) return { error: "no registration date published" };
    const registered = new Date(reg.eventDate);
    const ageDays = Math.floor((Date.now() - registered.getTime()) / 86400000);
    return { ageDays, registered: registered.toISOString().slice(0, 10) };
  } catch (e) {
    return { error: e.name === "AbortError" ? "timed out" : String(e.message || e) };
  }
}

// ---- Review sites --------------------------------------------------------
// Each is read from its public page, with no API key. Order here is the
// order on the settings page and in the banner.
export const REVIEW_SITES = [
  {
    id: "trustpilot",
    name: "Trustpilot",
    defaultOn: true,
    pages: (d) => [`https://www.trustpilot.com/review/${d}`, `https://www.trustpilot.com/review/www.${d}`],
    // Unknown sites are redirected to a search page.
    isReviewPage: (res) => res.url.includes("/review/"),
    parse: (html) => parseTrustpilot(html),
  },
  {
    id: "sitejabber",
    name: "Sitejabber",
    defaultOn: true,
    // Sitejabber now redirects to smartcustomer.com, same page layout.
    pages: (d) => [`https://www.sitejabber.com/reviews/${d}`],
    isReviewPage: (res) => res.url.includes("/reviews/"),
    parse: (html) => parseAggregateRating(html),
  },
  {
    id: "reviewsio",
    name: "Reviews.io",
    defaultOn: true,
    // Store pages use a name the shop chose, not its domain. Try the common
    // patterns (gymshark-com, myprotein, reviewscouk) and only accept a page
    // whose listed website is this domain, as "simba" is a different company
    // from simbasleep.com.
    pages: (d) => {
      const label = d.split(".")[0];
      return [...new Set([d.replace(/\./g, "-"), label, d.replace(/\./g, "")])]
        .map((slug) => `https://www.reviews.io/company-reviews/store/${slug}`);
    },
    isReviewPage: (res) => res.url.includes("/company-reviews/store/"),
    isThisShop: (html, d) => listedWebsites(html).includes(d),
    parse: (html) => parseAggregateRating(html),
  },
];

export const DEFAULT_SITES = Object.fromEntries(REVIEW_SITES.map((s) => [s.id, s.defaultOn]));

// Look a domain up on one review site.
// Returns { found: true, score, reviews, url } | { found: false, url } | { error, url }.
export async function lookupReviews(site, domain) {
  let lastError;
  for (const url of site.pages(domain)) {
    try {
      // Send the user's own cookies for the site, as following a link would.
      const res = await fetchWithTimeout(url, 8000, { credentials: "include" });
      if (res.status === 404) continue;
      if (res.status === 403) { lastError = `${site.name} wants a bot check, open it yourself`; break; }
      if (!res.ok) { lastError = `${site.name} returned ${res.status}`; continue; }
      if (!site.isReviewPage(res)) continue;
      const html = await res.text();
      if (site.isThisShop && !site.isThisShop(html, domain)) continue;
      const parsed = site.parse(html);
      if (parsed) return { found: true, ...parsed, url: res.url };
      lastError = `couldn't read the rating from ${site.name}'s page`;
    } catch (e) {
      lastError = e.name === "AbortError" ? "timed out" : String(e.message || e);
    }
  }
  const url = site.pages(domain)[0];
  return lastError ? { error: lastError, url } : { found: false, url };
}

export function parseTrustpilot(html) {
  // 1. The page's Next.js data blob.
  const score = html.match(/"trustScore":\s*([\d.]+)/);
  const reviews = html.match(/"numberOfReviews":\s*(\d+)/);
  if (score && reviews) return { score: parseFloat(score[1]), reviews: parseInt(reviews[1], 10) };
  // 2. Fall back to schema.org markup.
  return parseAggregateRating(html);
}

// schema.org "aggregateRating": { "ratingValue": "2.5", "reviewCount": 11116 }
export function parseAggregateRating(html) {
  const block = html.match(/"aggregateRating"\s*:\s*\{([^}]*)\}/i);
  if (!block) return null;
  const rv = block[1].match(/"ratingValue"\s*:\s*"?([\d.]+)"?/);
  const rc = block[1].match(/"(?:reviewCount|ratingCount)"\s*:\s*"?(\d+)"?/);
  if (!rv || !rc) return null;
  return { score: parseFloat(rv[1]), reviews: parseInt(rc[1], 10) };
}

// Domains of the websites a review page lists, other than the review site's own.
export function listedWebsites(html) {
  return [...html.matchAll(/"url"\s*:\s*"(https?:\/\/[^"\/]+)/g)]
    .map((m) => registrableDomain(new URL(m[1]).hostname))
    .filter((d) => !/^reviews\.(io|co\.uk)$/.test(d));
}

// ---- Scoring -------------------------------------------------------------
// Turn the lookups and page signs into a verdict with reasons.
// reviews: [{ id, name, found, score, reviews, url, error }] for each site checked.
// level: "green" | "amber" | "red".
export function score({ age, reviews = [], page }) {
  let points = 0;
  const reasons = [];
  const add = (n, text, tone) => { points += n; reasons.push({ text, tone }); };
  const note = (text, tone) => reasons.push({ text, tone });

  if (age?.ageDays != null) {
    const d = age.ageDays;
    const when = d < 60 ? `${d} days ago` : d < 730 ? `${Math.round(d / 30)} months ago` : `${Math.floor(d / 365)} years ago`;
    if (d < 90) add(4, `Domain registered only ${when}`, "bad");
    else if (d < 180) add(3, `Domain registered ${when}`, "bad");
    else if (d < 365) add(1, `Domain registered ${when}`, "warn");
    else if (d > 3650) add(-2, `Domain registered ${when}`, "good");
    else add(0, `Domain registered ${when}`, "good");
  } else if (age?.error) {
    note(`Domain age unknown (${age.error})`, "info");
  }

  // One line per review site, then points from their average rating, so
  // three sites agreeing don't count three times.
  const rated = [];
  let answered = 0;
  for (const r of reviews) {
    if (r.found) {
      answered++;
      const t = `${r.name} ${r.score.toFixed(1)}\u2605 from ${r.reviews.toLocaleString()} reviews`;
      if (r.reviews < 10) note(`${t} (too few to judge)`, "warn");
      else {
        rated.push(r);
        note(t, r.score <= 2 ? "bad" : r.score < 3.5 ? "warn" : "good");
      }
    } else if (r.found === false) {
      answered++;
      note(`Not on ${r.name}`, "info");
    } else if (r.error) {
      note(`${r.name} not checked (${r.error})`, "info");
    }
  }
  if (rated.length) {
    const avg = rated.reduce((sum, r) => sum + r.score, 0) / rated.length;
    const total = rated.reduce((sum, r) => sum + r.reviews, 0);
    const label = rated.length > 1 ? `Average review rating ${avg.toFixed(1)}\u2605` : null;
    if (avg <= 2) points += 3;
    else if (avg < 3.5) points += 1;
    else if (avg >= 4 && total >= 50) points -= 2;
    if (label) note(label, avg <= 2 ? "bad" : avg < 3.5 ? "warn" : "good");
  } else if (answered) {
    add(1, "Few or no reviews on the review sites checked", "warn");
  } else if (!reviews.length) {
    note("No review sites switched on in Settings", "info");
  }

  if (page) {
    if (!page.hasContact) add(1, "No contact details found on this page", "warn");
    if (!page.hasReturns) add(1, "No returns or refund policy link found", "warn");
    if (page.maxDiscount >= 70) add(2, `Discounts of up to ${page.maxDiscount}% off`, "bad");
    if (!page.https) add(2, "Not using a secure (https) connection", "bad");
  }

  if (age?.ageDays == null && !answered) {
    add(2, "Couldn't verify this shop, so check it yourself", "warn");
  }

  const level = points >= 5 ? "red" : points >= 2 ? "amber" : "green";
  return { level, points, reasons };
}

export async function checkDomain(domain, page, enabled = DEFAULT_SITES) {
  const sites = REVIEW_SITES.filter((s) => enabled[s.id]);
  const [age, ...found] = await Promise.all([domainAge(domain), ...sites.map((s) => lookupReviews(s, domain))]);
  const reviews = found.map((r, i) => ({ id: sites[i].id, name: sites[i].name, ...r }));
  return { domain, age, reviews, ...score({ age, reviews, page }) };
}
