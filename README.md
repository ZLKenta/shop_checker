# Lance's Shop Checker

A proof-of-concept Chrome extension that warns you when a shopping site looks dodgy. It needs no API keys.

## Install

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this folder.
4. After editing any file, click the reload arrow on the extension's card, then reload the shop's page.

## What it does

1. On every page, `content.js` decides whether the page is a shop. It needs at least two signs: product markup, Shopify, WooCommerce or another shop platform among the files the page loads, an "Add to basket" button, a basket link or button, a wishlist, or five or more prices.
2. For a shop, it reads warning signs from the page: no contact details, no returns or refund policy, discounts of 70% or more, no https.
3. `background.js` looks up the domain, caching each answer for 24 hours:
   - **Domain age**, from [RDAP](https://rdap.org), the free successor to WHOIS. Always on.
   - **Review sites**, each read from its public page, sending your own cookies for that site, the same as clicking a link. Choose which ones in Settings:
     - **Trustpilot**: `trustpilot.com/review/<domain>`
     - **Sitejabber** (optional): `sitejabber.com/reviews/<domain>`, which now redirects to smartcustomer.com
     - **Reviews.io** (optional): store pages use a name the shop chose, so it tries `gymshark-com`, `gymshark` and `gymsharkcom`, and only accepts a page whose listed website is the shop's own domain
4. `checks.js` adds up points and shows a banner at the top of the page, with a link to each review site's page:
   - 🟢 under 2 points: looks OK.
   - 🟡 2 to 4 points: be careful.
   - 🔴 5 or more points: may be a scam.

| Sign | Points |
|---|---|
| Domain registered under 3 months ago | +4 |
| Domain registered 3–6 months ago | +3 |
| Domain registered 6–12 months ago | +1 |
| Domain registered over 10 years ago | −2 |
| Average review rating 2★ or lower | +3 |
| Average review rating under 3.5★ | +1 |
| Average review rating 4★ or higher (50+ reviews in all) | −2 |
| Not on any review site checked, or under 10 reviews on each | +1 |
| Discounts of 70% or more | +2 |
| No https | +2 |
| No contact details / no returns policy | +1 each |
| No lookup worked at all | +2 |

The average uses only sites with 10 or more reviews, so three sites agreeing don't count three times. The banner still lists each site's own rating.

**Click the toolbar icon** to check a page that wasn't detected as a shop. **"Don't check this site again"** adds the site to a list you can undo in Settings.

## Settings

Open them from `chrome://extensions` → Lance's Shop Checker → **Details** → **Extension options**, or right-click the toolbar icon → **Options**. You can:

- Switch each review site on or off. All three start on; Sitejabber and Reviews.io are marked optional.
- See the sites you've said not to check, and click **Check again** to remove one.

Settings are kept in `chrome.storage.sync`, so they follow your Chrome sign-in.

## Known limits

- **Trustpilot sometimes answers with a bot check** ("Verifying Connection") instead of the page. Then the banner says Trustpilot wasn't checked and links to the page so you can look yourself. The extension doesn't try to get past the check.
- The Trustpilot page format hasn't been confirmed against a live page yet. If the banner says "couldn't read the rating from Trustpilot's page", update `parseTrustpilot` in `checks.js`. Sitejabber and Reviews.io were checked against live pages on 8 November 2026.
- Reviews.io misses shops whose store name doesn't follow one of the three patterns, such as `bloom-and-wild` for bloomandwild.com.
- Big, genuine brands often score badly on open review sites, Sitejabber included. Their old domain usually balances that out, but expect some 🟡 on well-known shops.
- Reading review sites' pages directly is fine for personal use, but isn't allowed under their terms for a published extension.
- Working out the registrable domain uses a short built-in list of suffixes like `co.uk`, not the full Public Suffix List.
