import test from "node:test";
import assert from "node:assert/strict";

let sequence = 0;
async function setup(t, providerStatus = 200, items = [{ business: "Example Cafe", deal: "$5 lunch", days: ["daily"], alcohol: false }]) {
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key-never-sent";
  t.after(() => { if (previous === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previous; });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    if (url === "https://api.anthropic.com/v1/messages") return Response.json(
      providerStatus === 200 ? { content: [{ type: "text", text: JSON.stringify(items) }] } : { error: { message: "Upstream failed" } },
      { status: providerStatus },
    );
    return new Response("<html><body>Example Cafe: $5 lunch daily.</body></html>");
  });
  const module = await import(new URL(`../sites/linkcowboy/netlify/functions/generate-deals.mjs?test=${++sequence}`, import.meta.url));
  const request = (query = "", method = "GET", path = "/api/generate-deals") => module.default(new Request("http://localhost" + path + query, { method }));
  return { module, request, calls };
}

test("invalid limits, methods, and legacy routes make no external calls", async t => {
  const { request, calls } = await setup(t);
  for (const value of ["-1", "0", "6", "1.5", "3abc", "", "NaN", "1000000"]) {
    assert.equal((await request("?limit=" + value)).status, 400, value);
  }
  assert.equal((await request("?limit=1&limit=5")).status, 400);
  assert.equal((await request("", "POST")).status, 405);
  assert.equal((await request("", "GET", "/.netlify/functions/generate-deals")).status, 404);
  assert.equal(calls.length, 0);
});

test("default request crawls three sources and reuses concurrent and cached results", async t => {
  const { request, calls, module } = await setup(t);
  const [first, simultaneous] = await Promise.all([request(), request()]);
  assert.equal(first.status, 200);
  const body = await first.json();
  assert.equal(body.log.length, 3);
  assert.equal(body.deals.length, 3);
  assert.equal((await simultaneous.json()).cached, true);
  assert.equal((await (await request()).json()).cached, true);
  assert.equal(calls.length, 6);
  assert.equal(calls.some(call => call.url.includes("localhost")), false);
  const cooldown = await request("?limit=2");
  assert.equal(cooldown.status, 429);
  assert.ok(Number(cooldown.headers.get("Retry-After")) > 0);
  assert.deepEqual(module.config.rateLimit, { windowLimit: 2, windowSize: 60, aggregateBy: ["ip", "domain"] });
  assert.equal(module.config.path, "/api/generate-deals");
});

test("maximum limit performs exactly five source and five extraction calls", async t => {
  const { request, calls } = await setup(t);
  const result = await request("?limit=5");
  assert.equal(result.status, 200);
  assert.equal((await result.json()).log.length, 5);
  assert.equal(calls.length, 10);
});

test("provider failures return an error rather than a successful empty crawl", async t => {
  const { request } = await setup(t, 429);
  const response = await request("?limit=1");
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.ok(body.error);
  assert.equal(body.log[0].ok, false);
});

test("malformed model output fails safely", async t => {
  const { request } = await setup(t, 200, { business: "not an array" });
  assert.equal((await request("?limit=1")).status, 503);
});

test("cache expires so later requests can refresh sources", async t => {
  const { request, calls } = await setup(t);
  await request("?limit=1");
  const later = Date.now() + 16 * 60 * 1000;
  t.mock.method(Date, "now", () => later);
  const response = await request("?limit=1");
  assert.equal((await response.json()).cached, false);
  assert.equal(calls.length, 4);
});

test("missing API key falls back without contacting sources", async t => {
  const { request, calls } = await setup(t);
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal((await request()).status, 503);
  assert.equal(calls.length, 0);
});
