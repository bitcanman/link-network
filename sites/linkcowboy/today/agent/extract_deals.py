#!/usr/bin/env python3
"""
Link Cowboy deals agent
-----------------------
Crawls a seed list of sources near a campus, asks Claude to extract food & drink
specials into a strict schema, merges them with the existing deals file, expires
stale entries, and writes deals.json for the static page to render.

Run nightly (GitHub Action) or by hand:

    export ANTHROPIC_API_KEY=sk-ant-...
    python agent/extract_deals.py --sources agent/sources.json --out deals.json

Flags:
    --limit N     only crawl the first N sources (handy for a live demo)
    --only ID     crawl a single source id
    --dry-run     crawl + extract, print what would change, don't write
    --stale-days  days after which an unverified deal is dropped (default 45)
"""

import argparse
import datetime as dt
import hashlib
import json
import re
import sys
from pathlib import Path

MODEL = "claude-sonnet-4-6"
UA = "LinkCowboyDealsBot/0.1 (+https://linkcowboy.com; student project; contact via site)"

SCHEMA_INSTRUCTIONS = """
You extract recurring food, drink, and entertainment specials aimed at students near a campus.

Return ONLY a JSON array. Each item:
{
  "business": "exact business name",
  "deal": "one line, concrete: prices, items, discount",
  "category": "food" | "drink" | "both" | "entertainment",
  "days": ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"] or ["daily"],
  "times": "e.g. '2-6pm' or 'all day' or '' if unknown",
  "requirements": ["student ID","21+","dine-in only","app required"] (only if stated),
  "neighborhood": "if stated, else ''",
  "address": "street address if stated, else ''",
  "alcohol": true | false,
  "expires_at": "YYYY-MM-DD if the page states an end date, else null",
  "confidence": "high" | "medium" | "low"
}

Rules:
- One item per distinct special. A weekday happy hour and a Tuesday-only special are two items.
- Only include specials the text actually states. Never invent prices, days, or businesses.
- Mark confidence "high" only if the price, day, and business are all explicit.
- If the page has no specials, return [].
"""


def fetch_text(url: str, timeout: int = 20) -> str:
    """Fetch a page and reduce it to readable text. Returns '' on failure."""
    import requests
    from bs4 import BeautifulSoup

    try:
        r = requests.get(url, headers={"User-Agent": UA}, timeout=timeout)
        r.raise_for_status()
    except requests.RequestException as e:
        print(f"    fetch failed: {e}", file=sys.stderr)
        return ""
    soup = BeautifulSoup(r.text, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header", "noscript", "svg"]):
        tag.decompose()
    text = soup.get_text("\n")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()[:60000]  # keep prompts bounded


def extract_with_claude(client, source: dict, page_text: str) -> list:
    """Ask Claude to pull structured deals out of page text."""
    if not page_text:
        return []
    prompt = (
        f"Source: {source['name']} ({source['url']})\n"
        f"Source type: {source.get('type','')}\n"
        f"Campus: {source.get('school_name','')}\n\n"
        f"PAGE TEXT:\n{page_text}"
    )
    msg = client.messages.create(
        model=MODEL,
        max_tokens=4000,
        system=SCHEMA_INSTRUCTIONS,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.S)
    try:
        items = json.loads(raw)
    except json.JSONDecodeError:
        print("    could not parse model output; skipping source", file=sys.stderr)
        return []
    return [i for i in items if isinstance(i, dict) and i.get("business") and i.get("deal")]


def deal_id(item: dict) -> str:
    key = f"{item['business'].lower().strip()}|{item['deal'].lower().strip()}"
    return hashlib.sha1(key.encode()).hexdigest()[:12]


def normalize(item: dict, source: dict, today: str) -> dict:
    days = item.get("days") or []
    if isinstance(days, str):
        days = [days]
    normalized = {
        "id": deal_id(item),
        "business": item["business"].strip(),
        "deal": item["deal"].strip(),
        "category": item.get("category", "both"),
        "days": days,
        "times": (item.get("times") or "").strip(),
        "requirements": item.get("requirements") or [],
        "neighborhood": item.get("neighborhood") or source.get("neighborhood", ""),
        "address": item.get("address") or "",
        "alcohol": bool(item.get("alcohol", False)),
        "expires_at": item.get("expires_at"),
        "confidence": item.get("confidence", "medium"),
        "source_url": source["url"],
        "source_name": source["name"],
        "source_type": source.get("type", "business"),
        "verified_at": today,
        "first_seen": today,
    }
    # Absence means "not supplied"; explicit null/empty values clear old data.
    for key in ("category", "days", "times", "requirements", "address", "alcohol", "expires_at", "confidence"):
        if key not in item:
            normalized.pop(key)
    if "neighborhood" not in item and "neighborhood" not in source:
        normalized.pop("neighborhood")
    return normalized


def merge(existing: list, fresh: list, stale_days: int, today: str) -> tuple[list, dict]:
    """Merge fresh deals into existing ones; re-verify matches, expire the rest."""
    by_id = {d["id"]: dict(d) for d in existing}
    mutable = ("business", "deal", "category", "days", "times", "requirements",
               "neighborhood", "address", "alcohol", "expires_at", "confidence",
               "source_url", "source_name", "source_type")
    added, refreshed = 0, 0
    for d in fresh:
        if d["id"] in by_id:
            keep = by_id[d["id"]]
            keep.update({k: d[k] for k in mutable if k in d})
            keep["verified_at"] = today
            refreshed += 1
        else:
            by_id[d["id"]] = {
                "category": "both", "days": [], "times": "", "requirements": [],
                "neighborhood": "", "address": "", "alcohol": False,
                "expires_at": None, "confidence": "medium", **d,
            }
            added += 1

    cutoff = (dt.date.fromisoformat(today) - dt.timedelta(days=stale_days)).isoformat()
    kept, expired = [], 0
    for d in by_id.values():
        past_end = d.get("expires_at") and d["expires_at"] < today
        gone_stale = d["verified_at"] < cutoff
        if past_end or gone_stale:
            expired += 1
            continue
        kept.append(d)

    kept.sort(key=lambda d: (d["business"].lower(), d["deal"].lower()))
    return kept, {"added": added, "refreshed": refreshed, "expired": expired, "total": len(kept)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sources", default="agent/sources.json")
    ap.add_argument("--out", default="deals.json")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--only", default="")
    ap.add_argument("--stale-days", type=int, default=45)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    try:
        import anthropic
    except ImportError:
        sys.exit("pip install -r agent/requirements.txt")
    client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY

    cfg = json.loads(Path(args.sources).read_text())
    sources = cfg["sources"]
    if args.only:
        sources = [s for s in sources if s["id"] == args.only]
    if args.limit:
        sources = sources[: args.limit]

    out_path = Path(args.out)
    existing = json.loads(out_path.read_text())["deals"] if out_path.exists() else []
    today = dt.date.today().isoformat()

    fresh, log = [], []
    for s in sources:
        s = {**s, "school_name": cfg.get("school_name", "")}
        print(f"-> {s['name']}")
        text = fetch_text(s["url"])
        items = extract_with_claude(client, s, text) if text else []
        block = {b.lower() for b in cfg.get("blocklist", [])}
        items = [i for i in items if i.get("business", "").strip().lower() not in block]
        norm = [normalize(i, s, today) for i in items]
        fresh.extend(norm)
        log.append({"source": s["id"], "fetched": bool(text), "deals_found": len(norm)})
        print(f"    {len(norm)} deal(s)")

    deals, stats = merge(existing, fresh, args.stale_days, today)
    print(f"\nadded {stats['added']}, refreshed {stats['refreshed']}, expired {stats['expired']}, total {stats['total']}")

    if args.dry_run:
        print("(dry run: nothing written)")
        return

    out_path.write_text(json.dumps({
        "school": cfg["school"],
        "school_name": cfg.get("school_name", ""),
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "stale_days": args.stale_days,
        "crawl_log": log,
        "stats": stats,
        "deals": deals,
    }, indent=2))
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
