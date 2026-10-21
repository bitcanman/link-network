# Maintaining the Longhorn Links chatbot

Everything here lives in `sites/longhornlinks/netlify/` and `sites/longhornlinks/tests/`.
This file describes the real, current structure - not a plan.

## Where things live

| What | File |
|---|---|
| Behavioral rules (tone, citation discipline, safety) | `netlify/lib/rules.mjs` |
| Dated facts kept separate from behavior (academic calendar, registration access, payment deadlines, MSTC gap) | `netlify/lib/sources.mjs` |
| The resource catalog (what the bot can cite) | `netlify/lib/catalog.mjs` |
| Registry of specialized program pages (MSTC, MBA, MBA Entrepreneurship, Mechanical Engineering, ...) | `netlify/lib/pages.mjs` |
| Internal event/calendar data reused from those pages' own structured data | `netlify/lib/events.mjs` |
| Dependency-free PDF text extraction + event parsing (best-effort, no real page uses it yet) | `netlify/lib/pdfEvents.mjs` |
| The function that runs the chatbot | `netlify/functions/lhl-chat.mjs` |
| The feedback-logging function | `netlify/functions/lhl-feedback.mjs` |
| Fast regression tests (mocked, no network) | `tests/chat.test.mjs` |
| The eval question set (59 and growing) | `tests/eval/questions.mjs`, `tests/eval/fixtures.mjs`, `tests/eval/run-eval.mjs` |

## Adding or changing a rule

1. Edit `netlify/lib/rules.mjs` - it's one template literal, one rule per line/sentence.
   Keep it behavioral only; a changing fact (a date, a deadline, a URL) belongs in
   `sources.mjs` or `catalog.mjs` instead, not hardcoded into a rule's prose.
2. If the rule should be enforced, not just suggested, add the actual check to
   `validateAnswer()` in `lhl-chat.mjs` (e.g. the citation-stripping/domain-allowlist
   checks already there) rather than relying on the model to always comply.
3. Add a matching case to `tests/eval/questions.mjs` (see below) so the rule has a
   regression test, and/or a mocked case in `tests/chat.test.mjs` if it's a server-side
   enforcement change.
4. Run `node --test tests/chat.test.mjs` and `node tests/eval/run-eval.mjs` (both from
   `sites/longhornlinks`) before committing.

## Adding a catalog resource

Add an object to the `catalog` array in `catalog.mjs`. Required: `id` (next `rNNN`),
`name`, `url`, `desc`, `source`, `sourceUrl`, `cat`. Optional but recommended for
anything likely to be asked about directly: `aliases` (common student phrasings -
this is what `relevantCatalog()` matches on to decide what subset of the catalog to
send the model, and what `singleUnambiguousMatch()` uses for the no-model-call
shortcut), `purpose` (a one-line task/eligibility framing, used by the shortcut path
and worth adding even if you don't expect this one to ever short-circuit), `aliases`,
`destinationType` (`'task'` or `'reference'`), `official` (`true`/`false`),
`audience` (restricts who can see it - see `allows()` in `lhl-chat.mjs` for exactly
how this is interpreted), `login` (true if it's behind UT EID).

Not every one of the 166 entries has every field yet - only the ones this eval set
exercises were retrofitted. Add the fields for any new entry you expect to matter.

## Specialized program pages: events, PDFs, and page-aware retrieval

The chatbot's `audience` value doubles as the "selected page/program" signal -
there's no separate per-page chat embed, so whichever program a student picks in
the `/ask` selector is what `pages.mjs` and `events.mjs` key off of.

- **`pages.mjs`** is the registry: one entry per specialized page, giving its real
  route, the catalog `source` tag(s) that are "this program's own resources" (a
  modest retrieval score boost, not a hard filter - see `relevantCatalog()`'s
  `boostSources`), the catalog eligibility bucket it maps to (`eligibilityAudience`
  - e.g. `mbae` maps to `mba`, since it's a page distinction, not a separate
  eligibility tier), and, if the page has its own event feed, an `eventsKey` into
  `events.mjs` and the real, discovered `calendarUrl` (never invent an anchor/URL
  the page doesn't actually have). Adding a new specialized page later is one entry
  here - no new code path, no new prompt.
- **`events.mjs`** holds each program's actual event data, **copied from that
  page's own structured data** (mstc.html's `DATA.events` array; the literal
  arguments to mbae.html's `res(...)` calls inside its `events` topic) - never
  scraped from rendered HTML. Each event keeps its program, verified date(s),
  year, time/location, description, its own url (never shown as a raw link to the
  student - see rules.mjs), where it came from (`source:'page'|'pdf'`, `sourceUrl`,
  `pdfUrl`), and `verifiedAt`.
- **There is currently no accessible calendar PDF anywhere in this data.**
  mstc.html's own "calendar PDF" links are Canvas module-item URLs gated behind an
  MSTC-student Canvas login this server does not have; fetching them unauthenticated
  returns a login page, not a PDF. `pdfEvents.mjs`'s extractor/parser/merge pipeline
  is real and unit-tested (synthetic PDF bytes in `tests/chat.test.mjs`), ready for
  the day a page links a genuinely public calendar PDF (set `calendarPdfUrl` on that
  page's `pages.mjs` entry to turn it on) - but nothing calls it in production today.
- **Refreshing**: there is no build step, so nothing re-syncs this automatically.
  When mstc.html's `DATA.events` (or mbae.html's `events` topic) changes, hand-update
  the matching array in `events.mjs` and bump its event's `verifiedAt`. When a
  program's own Longhorn Links hub page changes its event-section anchor, update
  `calendarUrl` in `pages.mjs` *and* the matching catalog entry's `url` together (see
  the consistency test in `chat.test.mjs` that checks every `eventsKey` page has a
  catalog entry whose `url` matches its `calendarUrl` - this is what the model
  actually cites instead of a raw per-event URL, since this repo's citation system
  only resolves `[[r123]]`/`[[w1]]` tokens, not arbitrary URLs).

## Updating dates / source map

Edit `netlify/lib/sources.mjs` directly - it's a plain object, no build step. Update
`verifiedAt` whenever you re-check a URL/fact. This file is sent to the model as
labeled, dated evidence (same trust level as the catalog) every request - it is not
cached or precomputed anywhere else.

## Running the eval suite

```
cd sites/longhornlinks
node tests/eval/run-eval.mjs           # structural mode: free, fast, no network
node tests/eval/run-eval.mjs --live    # drives the REAL handler + REAL OpenAI call if
                                        # OPENAI_API_KEY is set in this shell - costs
                                        # real money, prints each answer for human
                                        # review. Never run this without deciding to.
```
Structural mode only checks resource selection and eligibility (it calls
`eligibleCatalog()`/`relevantCatalog()`/`explicitAudience()` directly - no model, no
cost). It reports four buckets, always separately: **passed**, **failed**,
**pending-verification** (the resource check may have passed, but the question's
own `status` field says the underlying fact wasn't independently re-checked - never
treat this as a pass), and **skipped** (the question depends on conversation history
or pure clarification judgment, which only the model can actually do - these need
`--live` or a human to assess).

### Adding a question

Append an object to `tests/eval/questions.mjs`. Set `status:'verified'` only if you
actually re-checked the underlying fact against an official source today - default
to `'pending-verification'` with a `notes` string explaining what's unverified.
Multi-turn cases get a `history` array; these are automatically reported as
`skipped` in structural mode (see the comment in `run-eval.mjs`'s `checkResourceSelection`),
since carrying context across turns is model behavior, not something the catalog
functions do on their own.

## Cost and usage logs

Every answered question (and every thumbs up/down) POSTs a row to
`process.env.ASK_LOG_URL` (`logAsk()` in `lhl-chat.mjs`; the feedback POST is in
`lhl-feedback.mjs`). Columns: `id` (also returned to the client, so a feedback row
can be joined back to its question row), `question` (PII-scrubbed, see
`scrubQuestion()`), `audience`, `turns`, `sources`, `webSearch`, `stripped` (citations
removed by `validateAnswer()`'s sanitizing), `calls` (0 for the no-model shortcut, 1
normally, 2 if the web-search retry fired), `model`, `latencyMs`, `cost` (estimated,
from the `PRICE` table - update that table if pricing changes or a new model is used).
This is a Google Sheet via Apps Script, not a database this repo controls - there is
no conversation storage, no raw history logged, and retention/access is whatever that
sheet's sharing settings say, not something this code enforces.

Caching is in-memory only (a `Map` inside `lhl-chat.mjs`, 10-minute TTL) - it helps
while a Netlify Function container stays warm and resets on cold start; it is not a
durable, cross-instance cache. Only no-history, non-web-search answers are cached,
keyed by `audience + question text`, never anything personal.

## How a change reaches production

Same as every other page on this site: `git add` / `git commit` / `git push` to
`main`. Netlify's GitHub App auto-builds `sites/longhornlinks` (its `netlify.toml`
`ignore` rule skips the build entirely if the push didn't touch anything in that
folder). There is no separate deploy step and no `netlify deploy` CLI usage - that
diverges from what's in git, which is exactly what this project avoids.

## Rolling back

`git revert <commit>` and push - same as any other change in this repo. Because
`rules.mjs`/`sources.mjs`/`catalog.mjs` are plain data/text files with no build step,
a revert takes effect on the very next deploy with nothing else to coordinate.
