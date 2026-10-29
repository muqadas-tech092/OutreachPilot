// Prospect cleaning and transparent scoring. Port of outreachpilot/scoring.py (parity-tested against it).

export const REQUIRED = ["domain", "dr", "monthly_traffic", "niche"];
export const OPTIONAL = ["country", "contact_name", "contact_email", "traffic_trend", "notes"];

const RED_FLAG_WORDS = new Set([
  "casino", "gambling", "betting", "adult", "porn", "escort", "payday", "loan",
  "pills", "viagra", "replica", "crypto-casino", "essay-writing",
]);
const STOP = new Set(["and", "the", "of", "for", "a", "an", "in", "on", "to", "with", "tips", "blog", "news"]);

export function defaultSettings() {
  return {
    targetNiche: "digital marketing, seo",
    targetCountries: [],
    minDr: 20,
    minTraffic: 1000,
    weights: { authority: 35, traffic: 25, relevance: 30, geo: 10 },
  };
}

// Python's round() rounds halves to the nearest even number; match it so scores agree exactly.
export function bankersRound(x) {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

export function normalizeDomain(value) {
  let s = String(value ?? "").trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "");
  s = s.split("/")[0].split("?")[0];
  return s.replace(/^[. ]+|[. ]+$/g, "");
}

function tokens(text) {
  const found = String(text ?? "").toLowerCase().match(/[a-z0-9]+/g) || [];
  return new Set(found.filter((t) => !STOP.has(t) && t.length > 2));
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/,/g, "").replace(/[^\d.]/g, "");
  if (cleaned === "" || cleaned === "." || (cleaned.match(/\./g) || []).length > 1) return null;
  return parseFloat(cleaned);
}

/** records: array of objects with lower_snake_case keys. Returns {rows, issues}; throws Error on missing columns. */
export function parseProspects(records, headers) {
  const missing = REQUIRED.filter((c) => !headers.includes(c));
  if (missing.length) {
    throw new Error(
      "Your file is missing required column(s): " + missing.join(", ") + ". Required: " + REQUIRED.join(", ") + "."
    );
  }
  const issues = [];
  const rows = [];
  records.forEach((rec, idx) => {
    const row = { ...rec };
    OPTIONAL.forEach((c) => { if (row[c] === undefined) row[c] = ""; });
    row.domain = normalizeDomain(row.domain);
    row.dr = toNumber(row.dr);
    row.monthly_traffic = toNumber(row.monthly_traffic);
    row._line = idx + 2;
    if (row.domain === "" || row.dr === null || row.monthly_traffic === null) {
      issues.push(`Row ${row._line}: skipped because domain, DR or traffic is missing or not a number.`);
      return;
    }
    if (row.dr < 0 || row.dr > 100) {
      issues.push(`Row ${row._line} (${row.domain}): DR ${row.dr} is outside 0-100, skipped.`);
      return;
    }
    row.dr = Math.trunc(row.dr);
    row.monthly_traffic = Math.trunc(row.monthly_traffic);
    rows.push(row);
  });
  // Keep the highest-DR row for each domain, preserving the original order.
  const best = new Map();
  rows.forEach((r) => { if (!best.has(r.domain) || r.dr > best.get(r.domain).dr) best.set(r.domain, r); });
  const kept = rows.filter((r) => best.get(r.domain) === r);
  if (rows.length - kept.length) {
    issues.push(`${rows.length - kept.length} duplicate domain(s) removed (kept the row with the highest DR).`);
  }
  return { rows: kept, issues };
}

function relevance(niche, target) {
  const a = tokens(niche);
  const b = tokens(target);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  a.forEach((t) => { if (b.has(t)) overlap++; });
  return Math.min(1, overlap / Math.min(a.size, b.size));
}

export function scoreRow(row, s) {
  const w = s.weights;
  const reasons = [];
  const flags = [];

  const nicheWords = new Set([...tokens(row.niche), ...tokens(row.domain.replace(/-/g, " ").replace(/\./g, " "))]);
  for (const t of nicheWords) {
    if (RED_FLAG_WORDS.has(t)) {
      return { score: 0, tier: "Skip", reasons: ["Niche is on the do-not-pitch list."], flags: ["red-flag niche"] };
    }
  }

  const authority = Math.min(row.dr, 80) / 80;
  const traffic = Math.min(Math.max((Math.log10(Math.max(row.monthly_traffic, 1)) - 3) / 3, 0), 1);
  const rel = relevance(row.niche, s.targetNiche);
  const country = String(row.country ?? "").trim().toLowerCase();
  const targets = s.targetCountries.map((c) => c.trim().toLowerCase()).filter(Boolean);
  const geo = targets.length === 0 || targets.includes(country) ? 1 : 0;

  let score = authority * w.authority + traffic * w.traffic + rel * w.relevance + geo * w.geo;
  const r0 = (x) => String(bankersRound(x));
  reasons.push(`Authority: DR ${row.dr} adds ${r0(authority * w.authority)} of ${r0(w.authority)}.`);
  reasons.push(`Traffic: ${row.monthly_traffic.toLocaleString("en-US")}/month adds ${r0(traffic * w.traffic)} of ${r0(w.traffic)}.`);
  reasons.push(`Relevance to '${s.targetNiche}': ${r0(rel * 100)}% match adds ${r0(rel * w.relevance)} of ${r0(w.relevance)}.`);
  if (targets.length) {
    reasons.push(geo ? "Country matches your target." : `Country '${row.country || "unknown"}' is outside your target (0 of ${r0(w.geo)}).`);
  }

  if (String(row.traffic_trend ?? "").trim().toLowerCase() === "down") {
    score -= 10;
    flags.push("traffic declining");
    reasons.push("Traffic is declining: -10.");
  }
  if (!String(row.contact_email ?? "").trim()) flags.push("no contact email");

  const below = [];
  if (row.dr < s.minDr) below.push(`DR ${row.dr} is under your minimum of ${s.minDr}`);
  if (row.monthly_traffic < s.minTraffic) {
    below.push(`traffic ${row.monthly_traffic.toLocaleString("en-US")} is under your minimum of ${s.minTraffic.toLocaleString("en-US")}`);
  }
  score = Math.max(0, Math.min(100, bankersRound(score)));
  let tier = score >= 75 ? "A" : score >= 55 ? "B" : score >= 35 ? "C" : "Skip";
  if (below.length) {
    flags.push("below your minimums");
    reasons.push("Capped at tier C because " + below.join(" and ") + ".");
    if (tier === "A" || tier === "B") tier = "C";
  }
  return { score, tier, reasons, flags };
}

export function scoreAll(rows, s) {
  const order = { A: 0, B: 1, C: 2, Skip: 3 };
  return rows
    .map((r) => ({ ...r, ...scoreRow(r, s) }))
    .sort((x, y) => order[x.tier] - order[y.tier] || y.score - x.score);
}
