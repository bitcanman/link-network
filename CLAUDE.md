# Working in this repo

This file is read automatically by Claude Code. Keep it short and true.

## What this is

A monorepo of static, single-file HTML link directories for college students.
Every site is one `index.html` with inline `<style>` and inline `<script>`.
There is **no build step, no npm install, no framework, no bundler**. Do not
add one. Do not split CSS/JS into separate files. Do not introduce React.

## Where things live

- `sites/<sitename>/index.html` — the entire site
- `sites/<sitename>/_redirects` and `_headers` — Netlify routing/security rules
- `sites/<sitename>/netlify.toml` — publish + per-site build-skip config

Link data is the `LINKS` array near the top of the `<script>` block in each
`index.html`. Categories are the `CATS` array right below it. To add a link,
append an object to `LINKS` — nothing else needs to change.

```js
{cat:"academics", name:"Course Schedule", desc:"…", url:"https://…", login:true}
```

`login:true` renders the UT EID lock badge. `ext:true` renders the "External"
badge. Omit both for a plain arrow.

## Deploying

Pushing to `main` deploys. Each Netlify project has a Base directory pointed at
its own `sites/<sitename>` folder, and each `netlify.toml` has an `ignore`
command so a commit only redeploys the site(s) it actually touched.

Never run `netlify deploy` by hand — that creates an untracked deploy that
doesn't match the repo and silently diverges from git.

## Before committing

- Open the changed `index.html` in a browser and confirm the page renders,
  search works, and the category chips filter.
- Check any new URL actually resolves (these sites exist to not send students
  to dead links).
- Keep the `Prototype vX.Y` string in the footer bumped when the layout changes.

## House style

- Warm palette defined in `:root` — `--brand:#A24D12`, `--bg:#F6F0E4`.
  Deliberately *not* UT burnt orange `#BF5700`, for trademark distance.
- Every site carries an "Unofficial · not affiliated" disclaimer. Do not
  remove it or soften it.
- No cookies, no PII, no third-party analytics scripts. Click counts go to a
  Google Apps Script endpoint via `navigator.sendBeacon` and are anonymous.
