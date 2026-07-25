# Longhorn Links + Link Cowboy → GitHub → Netlify

**Goal:** one GitHub repo holding both sites, wired to Netlify so that
`git push` from Claude Code publishes the site. No zip dragging, ever again.

**Time:** about 25 minutes, once.

---

## Where you are today

I checked your Netlify account. Both sites are live and both are **manual
drag-and-drop deploys** — `deploy_source: "drop"`, no repository attached:

| Project | Live URL | Last published | Source |
|---|---|---|---|
| `longhornlinks` | https://longhornlinks.com | Jul 22, 2026 | manual drop |
| `serene-peony-a10dcf` | https://linkcowboy.com | manual drop | manual drop |

The longhornlinks deploy also carries **5 redirect rules and 1 header rule**
(`_redirects` and `_headers` files). Those are *not* in your Claude project
docs — they only exist inside the deploy. That's the single most important
reason to seed the repo from the Netlify download rather than from the saved
HTML: rebuild from the docs and you'd silently drop your redirects.

---

## Step 1 — Download what's actually live

Do this for both sites.

**Longhorn Links**

1. Open https://app.netlify.com/projects/longhornlinks/deploys
2. Click the newest deploy marked **Published**.
3. In the deploy detail header, click **Download**.
4. Wait for it to say **Download ready**, then click that. You get a zip of
   every published file.

**Link Cowboy**

Same, at https://app.netlify.com/projects/serene-peony-a10dcf/deploys

> If a file in the zip looks older than something you have in the
> "organizing scattered UT links" chat, the chat version wins — paste it over
> the downloaded file before you commit. The Netlify download tells you what
> the *world* currently sees; that's the baseline you don't want to regress.

---

## Step 2 — Assemble the repo

Unzip `link-network-scaffold.zip` (attached) somewhere permanent — I'd use
`~/Projects/link-network`. It already contains the folder structure, the
per-site `netlify.toml` files, a `README.md`, and a `CLAUDE.md` so Claude Code
knows the house rules.

Then move the contents of each Netlify download into its folder:

```
link-network/
├─ README.md
├─ CLAUDE.md
├─ .gitignore
└─ sites/
   ├─ longhornlinks/     ← contents of the longhornlinks zip go here
   │  ├─ netlify.toml       (already there — keep it)
   │  ├─ index.html
   │  ├─ mba.html
   │  ├─ _redirects
   │  ├─ _headers
   │  └─ favicon.ico, og-image.png, …
   └─ linkcowboy/        ← contents of the linkcowboy zip go here
      ├─ netlify.toml       (already there — keep it)
      ├─ index.html
      ├─ about.html
      └─ deals.html
```

Move the **contents** of each zip, not the zip's top-level folder. Then delete
the two `DROP-DEPLOY-FILES-HERE.md` placeholders.

---

## Step 3 — Push it to GitHub

Prereqs, one time:

```bash
# Homebrew's GitHub CLI — easiest way to create the repo and auth git at once
brew install gh
gh auth login          # choose GitHub.com → HTTPS → login with a browser
```

Then, from inside `link-network/`:

```bash
git init -b main
git add .
git commit -m "Import live longhornlinks.com and linkcowboy.com deploys"

gh repo create link-network --private --source=. --remote=origin --push
```

That creates the repo *and* pushes in one shot. Use `--public` instead of
`--private` if you want it open — Netlify works with either.

Sanity check: `gh browse` opens the repo in your browser. You should see
`sites/longhornlinks/index.html` there.

---

## Step 4 — Point Netlify at the repo

This is the part that turns `git push` into a deploy. Do it **once per site**.

### 4a. Longhorn Links

1. https://app.netlify.com/projects/longhornlinks
2. **Project configuration → Build & deploy → Continuous deployment → Repository**
3. Click **Link repository** → **GitHub**.
4. If prompted, install/authorize the **Netlify GitHub App** and grant it access
   to `link-network` (you can grant "only select repositories").
5. Pick `link-network`, branch **`main`**.
6. On the build settings screen, set:

   | Field | Value |
   |---|---|
   | Base directory | `sites/longhornlinks` |
   | Build command | *(leave completely empty)* |
   | Publish directory | `sites/longhornlinks` |

7. Deploy.

### 4b. Link Cowboy

Identical, at https://app.netlify.com/projects/serene-peony-a10dcf — same repo,
same branch, but:

| Field | Value |
|---|---|
| Base directory | `sites/linkcowboy` |
| Build command | *(empty)* |
| Publish directory | `sites/linkcowboy` |

**Nothing else changes.** Your custom domains, DNS, SSL certs, and analytics all
stay exactly as they are — linking a repo only changes where the *files* come
from.

---

## Step 5 — Verify before you trust it

The first Git deploy **replaces** the live site with whatever is in the repo.
So check, in this order:

1. Netlify → **Deploys** → the new deploy should say *Published*.
2. Open https://longhornlinks.com and https://linkcowboy.com in a private
   window. Compare against what you remember — especially the favicon and the
   OG image, which are the things people forget to copy.
3. Netlify → Deploys → the new deploy's summary should still list
   **"5 redirect rules processed"** and **"1 header rule processed"** for
   longhornlinks. If it says 0, your `_redirects`/`_headers` didn't make it into
   the folder — fix and push again.
4. Test a redirect directly, e.g. an old URL you know is redirected.

**If anything looks wrong:** Netlify → Deploys → click the last known-good
drag-and-drop deploy → **Publish deploy**. You're instantly back, with the repo
still linked. Fix the repo and push again.

---

## Step 6 — The everyday workflow

From here on, the whole thing is:

```bash
cd ~/Projects/link-network
claude
```

> "Add a link to the UT parking permit page under Housing on Longhorn Links"

Claude Code edits `sites/longhornlinks/index.html`, then:

```bash
git add .
git commit -m "Add parking permit link"
git push
```

Netlify picks up the push and republishes in roughly 15 seconds. You can tell
Claude Code to do the commit and push too — it's just shell.

### Why this is the efficient path

- **One repo, both sites.** One clone, one `claude` session, and you can edit
  both properties in the same conversation.
- **Per-site deploy skipping.** The `ignore` line in each `netlify.toml` runs
  `git diff --quiet HEAD^ HEAD -- .` — if the commit didn't touch that site's
  folder, Netlify cancels the build. Editing Link Cowboy never redeploys
  Longhorn Links.
- **Full history + instant rollback.** Every version of every site is
  recoverable two ways: `git revert` or Netlify's deploy list.
- **Deploy previews for free.** Push a branch, open a PR, and Netlify gives you
  a live preview URL before it touches production. Worth it once you start
  making layout changes rather than just adding links.

### The alternative, and why not

You *could* skip GitHub and run `netlify deploy --prod --dir=sites/longhornlinks`
from the Netlify CLI. It's one command and it works. But it gives you no
history, no rollback beyond Netlify's own list, no previews, and no shared
source of truth — and if you ever add a second machine or a collaborator, the
two copies diverge with no way to reconcile. Use the CLI only for a one-off
emergency push. `CLAUDE.md` in the scaffold tells Claude Code not to.

---

## Adding the next school

When `aggielinks` or `beaverlinks` goes live:

```bash
mkdir -p sites/aggielinks
cp sites/longhornlinks/netlify.toml sites/aggielinks/   # edit the comments
# add index.html
git add . && git commit -m "Add Aggie Links" && git push
```

Then in Netlify: **Add new project → Import an existing project → GitHub →
`link-network`**, and set Base directory and Publish directory to
`sites/aggielinks`. Point the domain at it. That's the whole per-school cost
from now on.

---

## Gotchas worth knowing

- **Empty build command is correct.** Netlify may warn that no build command is
  set. That's fine — these are hand-written static files with nothing to
  compile.
- **`_redirects` and `_headers` must sit at the root of the publish directory**,
  i.e. directly in `sites/longhornlinks/`, not in a subfolder. Netlify ignores
  them anywhere else, silently.
- **The Google Apps Script endpoints are hard-coded in the HTML** and will be
  visible in a public repo. They're write-only form/analytics endpoints so
  that's low risk, but it's the reason I defaulted the repo to `--private`.
- **Don't mix deploy methods.** Once the repo is linked, dragging a folder into
  Netlify still works — and it will put the live site out of sync with `main`
  until the next push overwrites it. Pick git and stay there.
- **Branch name matters.** Netlify watches whatever branch you selected. If you
  used `main`, don't push to `master`.

---

## Sources

- [Manage deploys — downloading a deploy](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/)
- [Repository permissions and linking](https://docs.netlify.com/build/git-workflows/repo-permissions-linking/)
- [Configure builds: monorepos](https://docs.netlify.com/build/configure-builds/monorepos/)
- [Build configuration overview](https://docs.netlify.com/build/configure-builds/overview/)
- [Deploy from your repository](https://docs.netlify.com/start/quickstarts/deploy-from-repository/)
