# link-network

Source of truth for the Link Cowboy college link-directory network.
Every site is a static, single-file HTML page. No build step, no framework,
no dependencies. Push to `main` → Netlify publishes.

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
│     ├─ about.html
│     ├─ deals.html
│     └─ netlify.toml
└─ README.md
```

Future schools (`aggielinks`, `beaverlinks`, `illinilinks`, …) get their own
folder under `sites/` plus their own Netlify project pointed at that folder.

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
