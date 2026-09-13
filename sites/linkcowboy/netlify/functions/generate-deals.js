// Live demo endpoint for the "Run the agent" button.
// Fetches a few sources, asks Claude to extract specials, returns them as JSON.
// Needs ANTHROPIC_API_KEY set in Netlify environment variables.
// Not the production path: the nightly GitHub Action writes deals.json; this is for showing the agent work.

const MODEL = "claude-sonnet-4-6";
const SYSTEM = `You extract recurring food, drink, and entertainment specials aimed at students near a campus.
Return ONLY a JSON array of objects with keys: business, deal, category (food|drink|both|entertainment),
days (array of Mon..Sun or ["daily"]), times, requirements (array), neighborhood, address, alcohol (boolean),
expires_at (YYYY-MM-DD or null), confidence (high|medium|low).
Only include specials the text actually states. Never invent prices, days, or businesses. If none, return [].`;

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 40000);
}

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "ANTHROPIC_API_KEY is not set on this site" }) };
  }
  const limit = Math.min(parseInt(event.queryStringParameters?.limit || "3", 10), 5);
  const sourcesUrl = new URL("/today/agent/sources.json", `https://${event.headers.host}`).href;

  const cfg = await fetch(sourcesUrl).then(r => r.json());
  const sources = cfg.sources.slice(0, limit);
  const log = [];
  const deals = [];

  for (const s of sources) {
    const t0 = Date.now();
    let text = "";
    try {
      const html = await fetch(s.url, { headers: { "User-Agent": "LinkCowboyDealsBot/0.1" } }).then(r => r.text());
      text = stripHtml(html);
    } catch (e) {
      log.push({ source: s.name, ok: false, error: String(e), ms: Date.now() - t0 });
      continue;
    }
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 3000,
        system: SYSTEM,
        messages: [{ role: "user", content: `Source: ${s.name} (${s.url})\nCampus: ${cfg.school_name}\n\nPAGE TEXT:\n${text}` }],
      }),
    }).then(r => r.json());

    const raw = (res.content || []).filter(b => b.type === "text").map(b => b.text).join("").replace(/^```(?:json)?\s*|\s*```$/g, "");
    let items = [];
    try { items = JSON.parse(raw); } catch { items = []; }
    const today = new Date().toISOString().slice(0, 10);
    const block = new Set((cfg.blocklist || []).map(b => b.toLowerCase()));
    for (const it of items) {
      if (!it.business || !it.deal) continue;
      if (block.has(String(it.business).trim().toLowerCase())) continue;
      deals.push({ ...it, source_url: s.url, source_name: s.name, source_type: s.type, verified_at: today });
    }
    log.push({ source: s.name, ok: true, found: items.length, ms: Date.now() - t0 });
  }

  return { statusCode: 200, headers, body: JSON.stringify({ ran_at: new Date().toISOString(), log, deals }) };
};
