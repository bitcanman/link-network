# link-network

Source of truth for the Link Cowboy college link-directory network.
The sites are static HTML, CSS, and JavaScript, with no frontend build step or
framework. The optional deals crawler uses Python dependencies and an Anthropic
API key; the live deals demo runs as a Netlify function. Push to `main` → Netlify publishes.

## Layout

```
link-network/
├─ sites/
│  ├─ longhornlinks/     → longhornlinks.com        (Netlify project: longhornlinks)
│  │  ├─ index.html
│  │  ├─ mba.html
│  │  ├─ _redirects
│  │  ├─ _headers
│  │  ├─ favicon.ico, og-image.png, …
│  │  └─ netlify.toml
│  └─ linkcowboy/        → linkcowboy.com           (Netlify project: serene-peony-a10dcf)
│     ├─ index.html
│     ├─ about/index.html
│     ├─ deals/index.html
│     ├─ today/          → restaurant specials and Python crawler
│     ├─ netlify/functions/ → optional live deals demo
│     └─ netlify.toml
└─ README.md
```

Current school directories live under `sites/linkcowboy/` (`texas`, `aggies`,
`beavers`, `illini`, `sundevils`, `wolverines`, and `buckeyes`). Longhorn Links
also includes an MBA calendar, calendar feeds, and the separate `/panel/` showcase.

## Local preview and checks

From the repository root, run either site with Python 3:

```bash
python3 -m http.server 8000 --bind 127.0.0.1 --directory sites/longhornlinks
# In a separate terminal:
python3 -m http.server 8001 --bind 127.0.0.1 --directory sites/linkcowboy
```

Use `/mba.html` for the MBA page on the Python server; Netlify's `/mba`
rewrite is not applied locally. The calendar falls back to its embedded data
when `events.json` is absent. The event-pasting control has been removed until
a parser is implemented. Quick Links customization is available on Longhorn
Links and its MBA page, with choices saved in the visitor's browser.

Run the regression checks with Node.js 22+ and Python 3.12+, without installing
packages or calling external services:

```bash
node --test tests/*.test.mjs
python3 -B -m unittest discover -s tests -p 'test_*.py'
```

## Live deals demo

The optional demo is served at `/api/generate-deals?limit=3` by
`netlify/functions/generate-deals.mjs`, using the modern Netlify function API.
It requires `ANTHROPIC_API_KEY` in the function environment. Static previews
use the saved roundup when the endpoint is unavailable.

The endpoint accepts integer limits from 1 through 5. Netlify's exported
configuration limits each IP/domain pair to two requests per minute. Warm
function instances also reuse results for 15 minutes, share concurrent runs,
and enforce a one-minute cooldown between fresh runs. These controls reduce
repeated API usage; they are not an account-wide spending cap. Source and model
requests have timeouts, and failed extractions are reported as failures.

After deployment, verify the rate-limit rule in Netlify's deploy log as described
in the [Netlify rate-limiting documentation](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/).
The platform rule is not emulated by the unit tests. The existing nightly crawl
still updates `today/deals.json`; the page displays its actual update timestamp
and hides expired deals or entries older than the file's `stale_days` limit.

## Netlify projects

| Folder                 | Netlify project        | Site ID                                | Live URL                |
|------------------------|------------------------|----------------------------------------|-------------------------|
| `sites/longhornlinks`  | `longhornlinks`        | `e0ca4296-f3c0-4341-9909-7a817257db01` | https://longhornlinks.com |
| `sites/linkcowboy`     | `serene-peony-a10dcf`  | `39b8c7b1-7300-46e7-9ddd-6e14b29bc3c0` | https://linkcowboy.com    |

Each Netlify project is linked to **this same repo** with a different
**Base directory**. The `ignore` rule in each `netlify.toml` means a commit
that only touches one site's folder only redeploys that one site.

## Deploying

```bash
git add .
git commit -m "Add spring registration deadline link"
git push
```

That's the whole deploy process. Netlify builds and publishes in ~15 seconds.
Watch it at https://app.netlify.com/projects/longhornlinks/deploys

## Rolling back

Netlify → project → **Deploys** → pick the last good deploy →
**Publish deploy**. Instant, no git needed. Then fix forward in the repo.

## Editing links

Link data lives in the `LINKS` array inside each `index.html`'s `<script>`
block. Categories live in `CATS` just below it. Add an entry, commit, push.
