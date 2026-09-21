import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const calendar = readFileSync(new URL("../sites/longhornlinks/calendar.html", import.meta.url), "utf8");
const script = [...calendar.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].at(-1)[1];
const element = () => ({ addEventListener() {} });
const context = {
  Date, Intl, location: { origin: "http://localhost", pathname: "/calendar.html" },
  document: { querySelector: element, addEventListener() {} }, window: {},
};
// Keep the site's inline architecture while exercising its actual date helpers.
vm.runInNewContext(script.replace("  load();", "  globalThis.helpers={campusDay,fmtT,moveMonth};"), context);
const { campusDay, fmtT, moveMonth } = context.helpers;

test("calendar times and campus date stay consistent across visitor timezones", () => {
  const before = process.env.TZ;
  try {
    for (const zone of ["America/Chicago", "America/Los_Angeles", "Asia/Tokyo", "UTC"]) {
      process.env.TZ = zone;
      assert.equal(fmtT("2026-10-13T17:30"), "5:30 PM", zone);
      assert.equal(fmtT("2026-12-11T09:00"), "9 AM", zone);
      assert.equal(fmtT("2026-10-13T22:30:00Z"), "5:30 PM", zone);
      assert.equal(fmtT("2026-12-11T15:00:00Z"), "9 AM", zone);
      assert.equal(campusDay(new Date("2026-09-22T02:00:00Z")), "2026-09-21", zone);
    }
  } finally {
    if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
  }
});

test("month navigation includes February and wraps years in both directions", () => {
  for (const [start, delta, expected] of [
    ["2026-01-31", 1, "2026-2-1"], ["2026-03-31", -1, "2026-2-1"],
    ["2028-01-31", 1, "2028-2-1"], ["2026-12-31", 1, "2027-1-1"],
    ["2027-01-31", -1, "2026-12-1"],
  ]) {
    const date = moveMonth(new Date(start + "T12:00:00"), delta);
    assert.equal(`${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()}`, expected);
  }
});

const todayHTML = readFileSync(new URL("../sites/linkcowboy/today/index.html", import.meta.url), "utf8");
const helpers = {};
vm.runInNewContext(todayHTML.slice(todayHTML.indexOf('  const TZ="America/Chicago";'), todayHTML.indexOf("  let ti, today;")) +
  "globalThis.helpers={isCurrentDeal,formatUpdated,campusDay};", helpers);

test("deals expire after their last day and after the verification-age limit", () => {
  const current = { verified_at: "2026-09-21", expires_at: null };
  const valid = (changes = {}) => helpers.helpers.isCurrentDeal({ ...current, ...changes }, "2026-09-21", 45);
  assert.equal(valid(), true);
  assert.equal(valid({ expires_at: "2026-09-21" }), true);
  assert.equal(valid({ expires_at: "2026-09-20" }), false);
  assert.equal(valid({ verified_at: "2026-08-07" }), true);
  assert.equal(valid({ verified_at: "2026-08-06" }), false);
  assert.equal(valid({ verified_at: "2026-09-22" }), false);
  assert.equal(valid({ verified_at: "invalid" }), false);
  assert.equal(valid({ verified_at: null }), false);
  assert.equal(valid({ expires_at: "2026-02-30" }), false);
});

test("freshness labels use the actual saved timestamp", () => {
  assert.match(helpers.helpers.formatUpdated("2026-09-13T16:00:00+00:00"), /Sep 13, 2026/);
  assert.equal(helpers.helpers.formatUpdated(undefined), "date unavailable");
  assert.equal(helpers.helpers.campusDay(new Date("2026-09-22T02:00:00Z")), "2026-09-21");
});

test("all changed page scripts parse", () => {
  for (const path of ["longhornlinks/calendar.html", "linkcowboy/today/index.html", "linkcowboy/about/index.html"]) {
    const html = readFileSync(new URL("../sites/" + path, import.meta.url), "utf8");
    for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (!match[1].includes("application/json")) new vm.Script(match[2], { filename: path });
    }
  }
});
