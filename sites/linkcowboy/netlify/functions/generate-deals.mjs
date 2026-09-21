// Optional live demo. The nightly Python crawler remains the saved-data path.
// Import static configuration so local HTTP previews never need a self-fetch.
import sourcesConfig from "../../today/agent/sources.json" with { type: "json" };

export const config = {
  path: "/api/generate-deals",
  rateLimit: { windowLimit: 2, windowSize: 60, aggregateBy: ["ip", "domain"] },
};

const MODEL = "claude-sonnet-4-6";
const CACHE_MS = 15 * 60 * 1000;
const COOLDOWN_MS = 60 * 1000;
// These caches reduce work within a warm instance. Netlify's rate limit above
// is the cross-instance per-visitor protection; this is not a global spend cap.
const cache = new Map(), pending = new Map();
let nextRunAt = 0;
const SYSTEM = `You extract recurring food, drink, and entertainment specials aimed at students near a campus.
Return ONLY a JSON array of objects with keys: business, deal, category (food|drink|both|entertainment),
days (array of Mon..Sun or ["daily"]), times, requirements (array), neighborhood, address, alcohol (boolean),
expires_at (YYYY-MM-DD or null), confidence (high|medium|low).
Only include specials the text actually states. Never invent prices, days, or businesses. If none, return [].`;

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function stripHtml(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 40000);
}

function normalize(item, source, today) {
  const days = new Set(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "daily"]);
  if (!item || typeof item.business !== "string" || !item.business.trim()
      || typeof item.deal !== "string" || !item.deal.trim()
      || !Array.isArray(item.days) || !item.days.length || !item.days.every(d => days.has(d))
      || typeof item.alcohol !== "boolean") return null;
  const blocked = (sourcesConfig.blocklist || []).some(b => b.toLowerCase() === item.business.trim().toLowerCase());
  if (blocked) return null;
  const str = value => typeof value === "string" ? value.trim() : "";
  return {
    business: item.business.trim(), deal: item.deal.trim(), days: [...new Set(item.days)],
    category: ["food", "drink", "both", "entertainment"].includes(item.category) ? item.category : "both",
    times: str(item.times), requirements: Array.isArray(item.requirements) ? item.requirements.filter(r => typeof r === "string") : [],
    neighborhood: str(item.neighborhood) || source.neighborhood || "", address: str(item.address), alcohol: item.alcohol,
    expires_at: /^\d{4}-\d{2}-\d{2}$/.test(item.expires_at) ? item.expires_at : null,
    confidence: ["high", "medium", "low"].includes(item.confidence) ? item.confidence : "low",
    source_url: source.url, source_name: source.name, source_type: source.type, verified_at: today,
  };
}

async function crawl(limit) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = type => parts.find(p => p.type === type).value;
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const results = await Promise.all(sourcesConfig.sources.slice(0, limit).map(async source => {
    const started = Date.now();
    try {
      const page = await fetch(source.url, {
        headers: { "User-Agent": "LinkCowboyDealsBot/0.1" }, signal: AbortSignal.timeout(8000),
      });
      if (!page.ok) throw new Error(`Source returned HTTP ${page.status}`);
      const text = stripHtml(await page.text());
      if (!text) throw new Error("Source returned no readable text");
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", signal: AbortSignal.timeout(20000),
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: MODEL, max_tokens: 3000, system: SYSTEM,
          messages: [{ role: "user", content: `Source: ${source.name} (${source.url})\nCampus: ${sourcesConfig.school_name}\n\nPAGE TEXT:\n${text}` }],
        }),
      });
      if (!response.ok) throw new Error(`Extraction returned HTTP ${response.status}`);
      const output = await response.json();
      if (!Array.isArray(output.content)) throw new Error("Extraction returned no content");
      const raw = output.content.filter(b => b.type === "text").map(b => b.text).join("").trim()
        .replace(/^```(?:json)?\s*|\s*```$/g, "");
      const items = JSON.parse(raw);
      if (!Array.isArray(items)) throw new Error("Extraction returned an invalid list");
      const deals = items.map(item => normalize(item, source, today)).filter(Boolean);
      return { deals, log: { source: source.name, ok: true, found: deals.length, ms: Date.now() - started } };
    } catch (error) {
      return { deals: [], log: { source: source.name, ok: false, error: error.message, ms: Date.now() - started } };
    }
  }));
  const log = results.map(result => result.log);
  if (!log.some(entry => entry.ok)) return { error: "Live sources are unavailable. Use the saved roundup.", log };
  return { ran_at: new Date().toISOString(), log, deals: results.flatMap(result => result.deals) };
}

export default async function handler(request) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/generate-deals") return json({ error: "Not found" }, 404);
  if (request.method !== "GET") return json({ error: "Use GET" }, 405, { Allow: "GET" });
  const values = url.searchParams.getAll("limit");
  const rawLimit = values.length ? values[0] : "3";
  if (values.length > 1 || !/^[1-5]$/.test(rawLimit)) return json({ error: "limit must be an integer from 1 to 5" }, 400);
  const limit = Number(rawLimit), now = Date.now();
  const saved = cache.get(limit);
  if (saved && saved.expires > now) return json({ ...saved.body, cached: true });
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: "Live generation is unavailable" }, 503);
  if (pending.has(limit)) return pending.get(limit).then(body => json({ ...body, cached: true }, body.error ? 503 : 200));
  if (now < nextRunAt) return json({ error: "Please wait before running the agent again" }, 429, {
    "Retry-After": String(Math.ceil((nextRunAt - now) / 1000)),
  });
  nextRunAt = now + COOLDOWN_MS;
  const job = crawl(limit);
  pending.set(limit, job);
  try {
    const body = await job;
    if (body.error) return json(body, 503);
    cache.set(limit, { body, expires: Date.now() + CACHE_MS });
    return json({ ...body, cached: false });
  } finally {
    pending.delete(limit);
  }
}
