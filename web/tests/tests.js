import { test, assert, assertEq, assertThrows } from "./harness.js";
import { parseCSV, toRecords, toCSV } from "../js/csv.js";
import {
  defaultSettings, normalizeDomain, parseProspects, scoreAll, scoreRow, bankersRound,
} from "../js/scoring.js";
import { draftEmail, hasUnfilledPlaceholders, crc32, TEMPLATES } from "../js/emails.js";
import { buildPlan, followUpDates, nextBusinessDay, parseISO, toISO } from "../js/schedule.js";

const csvText = await (await fetch("../data/sample_prospects.csv")).text();
const expected = await (await fetch("./python_expected.json")).json();
const expectedUS = await (await fetch("./python_expected_us.json")).json();
const { headers, records } = toRecords(parseCSV(csvText));
const SENDER = { name: "Muqadas Zahoor", website: "https://example.com", offer: "a short guide on outreach automation", company: "" };
const prepared = () => parseProspects(records, headers);
const scored = (settings = defaultSettings()) => scoreAll(prepared().rows, settings);

// ---- CSV ----
test("csv: quotes, commas, CRLF and newlines inside quotes", () => {
  const rows = parseCSV('a,b\r\n"x, y","say ""hi""\nthere"\r\n');
  assertEq(rows, [["a", "b"], ["x, y", 'say "hi"\nthere']]);
});
test("csv: BOM and blank lines are ignored", () => {
  assertEq(parseCSV("﻿a,b\n\n1,2\n"), [["a", "b"], ["1", "2"]]);
});
test("csv export neutralises spreadsheet formulas but keeps negative numbers", () => {
  const out = toCSV([{ a: "=HYPERLINK(1)", b: "-5", c: "x,y" }], ["a", "b", "c"]);
  assert(out.includes("'=HYPERLINK(1)") && out.includes(",-5,") && out.includes('"x,y"'), out);
});

// ---- scoring ----
test("domain normalisation", () => {
  assertEq(normalizeDomain("https://www.Example.com/blog?x=1"), "example.com");
  assertEq(normalizeDomain("WWW.example.com/"), "example.com");
});
test("bankers rounding matches Python round()", () => {
  assertEq([0.5, 1.5, 2.5, 3.4, 3.6].map(bankersRound), [0, 2, 2, 3, 4]);
});
test("parse dedupes and keeps the highest DR", () => {
  const { rows, issues } = prepared();
  const copy = rows.filter((r) => r.domain === "copycatseo.example");
  assertEq(copy.length, 1);
  assertEq(copy[0].dr, 44);
  assert(issues.some((i) => i.includes("duplicate")));
});
test("missing required column gives a clear error", async () => {
  await assertThrows(() => parseProspects([{ domain: "a.com", dr: "10" }], ["domain", "dr"]), "missing required column");
});
test("bad rows are skipped with a reason", () => {
  const recs = [
    { domain: "ok.com", dr: "50", monthly_traffic: "5000", niche: "seo" },
    { domain: "bad.com", dr: "n/a", monthly_traffic: "100", niche: "seo" },
    { domain: "", dr: "40", monthly_traffic: "100", niche: "seo" },
  ];
  const { rows, issues } = parseProspects(recs, ["domain", "dr", "monthly_traffic", "niche"]);
  assertEq(rows.map((r) => r.domain), ["ok.com"]);
  assertEq(issues.length, 2);
});
test("DR outside 0-100 is rejected", () => {
  const { rows, issues } = parseProspects([{ domain: "x.com", dr: "250", monthly_traffic: "5000", niche: "seo" }], ["domain", "dr", "monthly_traffic", "niche"]);
  assertEq(rows.length, 0);
  assert(issues[0].includes("outside 0-100"));
});
test("a number with two decimal points is treated as invalid, not guessed", () => {
  const { rows, issues } = parseProspects([{ domain: "x.com", dr: "1.2.3", monthly_traffic: "5000", niche: "seo" }], ["domain", "dr", "monthly_traffic", "niche"]);
  assertEq(rows.length, 0);
  assertEq(issues.length, 1);
});
test("red-flag niche is skipped whatever the metrics", () => {
  const row = scored().find((r) => r.domain === "luckyspinhub.example");
  assertEq([row.tier, row.score], ["Skip", 0]);
});
test("best site ranks first and is tier A", () => {
  const top = scored()[0];
  assertEq([top.domain, top.tier], ["growthledger.example", "A"]);
});
test("below minimums is capped at C and explained", () => {
  const row = scored().find((r) => r.domain === "tinytechtips.example");
  assert(["C", "Skip"].includes(row.tier) && row.flags.includes("below your minimums"));
});
test("declining traffic costs exactly 10 points", () => {
  const base = { domain: "x.com", dr: 50, monthly_traffic: 20000, niche: "seo", country: "US", traffic_trend: "flat", contact_email: "a@x.com" };
  const s = { ...defaultSettings(), targetNiche: "seo" };
  assertEq(scoreRow(base, s).score - scoreRow({ ...base, traffic_trend: "down" }, s).score, 10);
});
test("country target changes the score", () => {
  const de = prepared().rows.filter((r) => r.domain === "cloudcartnews.example");
  assert(scoreAll(de, defaultSettings())[0].score > scoreAll(de, { ...defaultSettings(), targetCountries: ["US"] })[0].score);
});
test("every scored row explains itself", () => {
  assert(scored().every((r) => r.reasons.length >= 1));
});
test("PARITY: all 12 scores, tiers and flags equal the Python version's", () => {
  const got = {};
  scored().forEach((r) => { got[r.domain] = [r.score, r.tier, r.flags]; });
  const want = {};
  expected.ranked.forEach((r) => { want[r.domain] = [r.score, r.tier, r.flags]; });
  assertEq(got, want);
});
test("PARITY: ranking order equals the Python version's", () => {
  assertEq(scored().map((r) => r.domain), expected.ranked.map((r) => r.domain));
});
test("PARITY: duplicate warning text equals the Python version's", () => {
  assertEq(prepared().issues, expected.issues);
});
test("PARITY: scores with a US-only target equal the Python version's", () => {
  const got = scored({ ...defaultSettings(), targetCountries: ["US"] }).map((r) => [r.domain, r.score, r.tier]);
  assertEq(got, expectedUS.map((r) => [r.domain, r.score, r.tier]));
});

// ---- emails ----
test("crc32 matches known values (so template choice matches Python)", () => {
  assertEq(crc32("123456789"), 0xcbf43926);
  assertEq(crc32("growthledger.example") % TEMPLATES.length, crc32("growthledger.example") % 3);
});
test("emails have no placeholders, an opt-out line and the sender's name", () => {
  const mail = draftEmail(scored()[0], SENDER);
  assert(!hasUnfilledPlaceholders(mail.subject + mail.body), mail.body);
  assert(mail.body.toLowerCase().includes("no thanks") && mail.body.includes("Muqadas Zahoor"));
});
test("every template renders cleanly for every prospect", () => {
  for (const p of scored()) for (let i = 0; i < TEMPLATES.length; i++) {
    const m = draftEmail(p, SENDER, i);
    assert(!hasUnfilledPlaceholders(m.subject + m.body) && m.body.includes("no thanks"), `${p.domain} template ${i}`);
  }
});
test("greets by first name or falls back to 'there'", () => {
  const p = { domain: "a.com", niche: "SEO", contact_name: "Dana Whitfield", contact_email: "d@a.com" };
  assert(draftEmail(p, SENDER, 0).body.startsWith("Hi Dana,"));
  assert(draftEmail({ ...p, contact_name: "" }, SENDER, 0).body.startsWith("Hi there,"));
});
test("emails require the sender's details", async () => {
  await assertThrows(() => draftEmail({ domain: "a.com", niche: "seo" }, { name: "", website: "", offer: "" }), "Add your name");
});
test("a prospect without an email is flagged for research", () => {
  assertEq(draftEmail({ domain: "a.com", niche: "seo", contact_email: "" }, SENDER).needsContact, true);
});

// ---- schedule ----
test("follow-ups skip weekends", () => {
  const dates = followUpDates(parseISO("2026-11-06"));
  assertEq(dates.map(toISO), ["2026-11-06", "2026-11-10", "2026-11-16"]);
  assertEq(toISO(nextBusinessDay(parseISO("2026-11-07"))), "2026-11-09");
});
test("plan respects the daily limit and only includes chosen tiers", () => {
  const plan = buildPlan(scored(), parseISO("2026-11-02"), ["A", "B"], 2);
  assert(plan.every((p) => ["A", "B"].includes(p.tier)));
  const perDay = {};
  plan.forEach((p) => { perDay[p.email_1] = (perDay[p.email_1] || 0) + 1; });
  assert(Math.max(...Object.values(perDay)) <= 2);
});

// ---- the real page, loaded in a frame ----
async function loadApp() {
  const f = document.createElement("iframe");
  f.src = "../index.html";
  f.style.cssText = "width:1200px;height:800px;border:1px solid #ccc";
  document.body.append(f);
  await new Promise((r) => f.addEventListener("load", r));
  await new Promise((r) => setTimeout(r, 1200));
  return f;
}
const setVal = (f, id, v) => { const e = f.contentDocument.getElementById(id); e.value = v; e.dispatchEvent(new f.contentWindow.Event("input")); };

test("UI: sample data renders every section with no '[object' artefacts", async () => {
  const f = await loadApp();
  const d = f.contentDocument;
  assert(!d.body.textContent.includes("[object"), "found '[object ...]' text in the page");
  assertEq(d.querySelectorAll("#tab-ranked tbody tr").length, 12);
  assertEq(d.querySelectorAll("#tab-ranked details.card").length, 12);
  assertEq(d.querySelectorAll("#tab-plan tbody tr").length, 6);
  assert(d.getElementById("metrics").textContent.includes("12"));
});
test("UI: email drafts appear once the sender's details are entered", async () => {
  const f = await loadApp();
  setVal(f, "senderName", "Muqadas Zahoor");
  setVal(f, "senderSite", "https://example.com");
  await new Promise((r) => setTimeout(r, 400));
  const bodies = [...f.contentDocument.querySelectorAll("#tab-emails textarea")].map((t) => t.value);
  assertEq(bodies.length, 6);
  assert(bodies.every((b) => b.includes("no thanks") && !/\bnan\b|undefined|\{/.test(b)));
});
test("UI: a hostile CSV cannot inject HTML or run script", async () => {
  const f = await loadApp();
  const w = f.contentWindow;
  w.__pwned = false;
  const csv = 'domain,dr,monthly_traffic,niche,notes,contact_name,contact_email\n"<img src=x onerror=window.__pwned=true>.com",50,20000,"<script>window.__pwned=true</script> seo","<b onmouseover=window.__pwned=true>hi</b>","<i>Eve</i>","e@x.com"\n';
  const dt = new w.DataTransfer();
  dt.items.add(new w.File([csv], "evil.csv", { type: "text/csv" }));
  const input = f.contentDocument.getElementById("file");
  input.files = dt.files;
  input.dispatchEvent(new w.Event("change"));
  await new Promise((r) => setTimeout(r, 700));
  const d = f.contentDocument;
  assertEq(w.__pwned, false);
  assertEq(d.querySelectorAll("main img, main script, main i, main b[onmouseover]").length, 0);
  assertEq(d.querySelectorAll("#tab-ranked tbody tr").length, 1);
});
test("UI: a file missing required columns shows a clear error", async () => {
  const f = await loadApp();
  const w = f.contentWindow;
  const dt = new w.DataTransfer();
  dt.items.add(new w.File(["domain,dr\na.com,10\n"], "bad.csv", { type: "text/csv" }));
  const input = f.contentDocument.getElementById("file");
  input.files = dt.files;
  input.dispatchEvent(new w.Event("change"));
  await new Promise((r) => setTimeout(r, 500));
  assert(f.contentDocument.getElementById("issues").textContent.includes("missing required column"));
});
