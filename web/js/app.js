import { parseCSV, toRecords, toCSV } from "./csv.js";
import { defaultSettings, parseProspects, scoreAll } from "./scoring.js";
import { draftEmail } from "./emails.js";
import { buildPlan, parseISO, toISO, addDays } from "./schedule.js";

const $ = (id) => document.getElementById(id);

// Safe DOM builder: every string becomes a text node, so CSV content can never inject HTML.
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const state = { text: null, source: "sample", scored: [], settings: defaultSettings() };

function readSettings() {
  const n = (id) => Number($(id).value) || 0;
  const w = { authority: n("wAuthority"), traffic: n("wTraffic"), relevance: n("wRelevance"), geo: n("wGeo") };
  const total = w.authority + w.traffic + w.relevance + w.geo;
  const note = $("weightNote");
  note.hidden = total === 100;
  note.textContent = total === 100 ? "" : `Weights add up to ${total}, not 100. Scores are scaled accordingly.`;
  const scale = total > 0 ? 100 / total : 1;
  return {
    targetNiche: $("niche").value,
    targetCountries: $("countries").value.split(",").map((c) => c.trim()).filter(Boolean),
    minDr: n("minDr"),
    minTraffic: n("minTraffic"),
    weights: Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v * scale])),
  };
}

const sender = () => ({
  name: $("senderName").value, website: $("senderSite").value, company: $("senderCompany").value, offer: $("offer").value,
});

async function currentText() {
  if (state.source === "upload" && state.text) return state.text;
  const res = await fetch("data/sample_prospects.csv");
  return res.text();
}

async function refresh() {
  const issuesBox = $("issues");
  issuesBox.replaceChildren();
  let parsed;
  try {
    const { headers, records } = toRecords(parseCSV(await currentText()));
    parsed = parseProspects(records, headers);
  } catch (err) {
    issuesBox.append(h("div", { class: "err" }, err.message));
    $("metrics").replaceChildren();
    for (const t of ["ranked", "emails", "plan"]) $("tab-" + t).replaceChildren();
    return;
  }
  parsed.issues.forEach((m) => issuesBox.append(h("div", { class: "warn" }, m)));
  if (!parsed.rows.length) {
    issuesBox.append(h("div", { class: "err" }, "No usable rows were found in this file."));
    return;
  }
  state.settings = readSettings();
  state.scored = scoreAll(parsed.rows, state.settings);
  renderMetrics();
  renderRanked();
  renderEmails();
  renderPlan();
}

function renderMetrics() {
  const counts = state.scored.reduce((m, r) => ((m[r.tier] = (m[r.tier] || 0) + 1), m), {});
  const box = $("metrics");
  box.replaceChildren(
    h("div", { class: "metric" }, h("small", {}, "Prospects"), h("b", {}, state.scored.length)),
    ...["A", "B", "C", "Skip"].map((t) =>
      h("div", { class: "metric" }, h("small", {}, `Tier ${t}`), h("b", {}, counts[t] || 0))
    )
  );
}

function renderRanked() {
  const panel = $("tab-ranked");
  const rows = state.scored;
  const table = h(
    "table", {},
    h("thead", {}, h("tr", {}, ...["Tier", "Score", "Domain", "DR", "Traffic/mo", "Niche", "Country", "Flags"].map((c) => h("th", {}, c)))),
    h("tbody", {}, rows.map((r) =>
      h("tr", {},
        h("td", {}, h("span", { class: `badge t-${r.tier}` }, r.tier)),
        h("td", {}, r.score), h("td", {}, r.domain), h("td", {}, r.dr),
        h("td", {}, r.monthly_traffic.toLocaleString("en-US")), h("td", {}, r.niche), h("td", {}, r.country), h("td", {}, r.flags.join(", "))
      )
    ))
  );
  panel.replaceChildren(
    h("div", { class: "tablewrap" }, table),
    h("button", { class: "btn", onclick: () => download("ranked_prospects.csv", toCSV(rows.map((r) => ({ ...r, flags: r.flags.join("; ") })), ["tier", "score", "domain", "dr", "monthly_traffic", "niche", "country", "contact_email", "flags"])) }, "Download ranked list (CSV)"),
    h("h3", {}, "Why each site got its score"),
    ...rows.map((r) =>
      h("details", { class: "card" },
        h("summary", {}, `${r.domain}: ${r.score} (${r.tier})`),
        h("div", { class: "body" }, h("ul", {}, r.reasons.map((x) => h("li", {}, x))), r.notes ? h("p", { class: "note" }, `Notes: ${r.notes}`) : null)
      )
    )
  );
}

function renderEmails() {
  const panel = $("tab-emails");
  const tiers = ["A", "B", "C"].filter((t) => $("tier" + t)?.checked ?? t !== "C");
  const picker = h("div", { class: "row" },
    ...["A", "B", "C"].map((t) => {
      const box = h("input", { type: "checkbox", id: "tier" + t, ...(tiers.includes(t) ? { checked: "" } : {}), onchange: renderEmails });
      return h("label", { class: "inline" }, box, `Tier ${t}`);
    })
  );
  const targets = state.scored.filter((r) => tiers.includes(r.tier));
  const s = sender();
  const body = [];
  if (!targets.length) body.push(h("p", { class: "note" }, "No prospects in the chosen tiers."));
  else if (!s.name.trim() || !s.website.trim()) body.push(h("p", { class: "note" }, "Add your name and website in the sidebar to generate drafts."));
  else {
    for (const r of targets) {
      const mail = draftEmail(r, s);
      body.push(
        h("details", { class: "card" },
          h("summary", {}, `${r.domain} · ${mail.subject}`),
          h("div", { class: "body" },
            mail.needsContact ? h("div", { class: "warn" }, "No contact email yet. Find the editor's address before sending.") : h("p", { class: "note" }, `To: ${mail.to}`),
            h("textarea", { "aria-label": `Email body for ${r.domain}` }, mail.body)
          )
        )
      );
    }
    body.push(h("p", { class: "note" }, "Review every email before sending. Personalise the first line with something specific you read on the site."));
  }
  panel.replaceChildren(picker, ...body);
}

function renderPlan() {
  const panel = $("tab-plan");
  const startInput = h("input", { type: "date", id: "planStart", value: $("planStart")?.value || toISO(addDays(new Date(), 1)), onchange: renderPlan });
  const perDayInput = h("input", { type: "number", id: "perDay", min: "1", max: "100", value: $("perDay")?.value || "15", onchange: renderPlan });
  const plan = buildPlan(state.scored, parseISO(startInput.value), ["A", "B"], Math.max(1, Number(perDayInput.value) || 15));
  const cols = ["domain", "tier", "contact_email", "email_1", "follow_up_1", "follow_up_2"];
  panel.replaceChildren(
    h("div", { class: "row" }, h("label", {}, "First send date", startInput), h("label", {}, "Max first emails per day", perDayInput)),
    ...(plan.length
      ? [
          h("div", { class: "tablewrap" }, h("table", {},
            h("thead", {}, h("tr", {}, cols.map((c) => h("th", {}, c)))),
            h("tbody", {}, plan.map((p) => h("tr", {}, cols.map((c) => h("td", {}, p[c]))))))),
          h("button", { class: "btn", onclick: () => download("followup_plan.csv", toCSV(plan, cols)) }, "Download follow-up plan (CSV)"),
          h("p", { class: "note" }, "Follow-ups go out on business days only, at +4 and +9 days."),
        ]
      : [h("p", { class: "note" }, "No tier A or B prospects to schedule.")])
  );
}

// ---- wiring ----
document.querySelectorAll(".tabs button").forEach((btn) =>
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b === btn)));
    for (const t of ["ranked", "emails", "plan"]) $("tab-" + t).hidden = t !== btn.dataset.tab;
  })
);
$("file").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  state.text = await f.text();
  state.source = "upload";
  $("useSample").checked = false;
  refresh();
});
$("useSample").addEventListener("change", () => {
  state.source = $("useSample").checked ? "sample" : state.text ? "upload" : "sample";
  if (!$("useSample").checked && !state.text) $("useSample").checked = true;
  refresh();
});
["niche", "countries", "minDr", "minTraffic", "wAuthority", "wTraffic", "wRelevance", "wGeo"].forEach((id) => $(id).addEventListener("input", refresh));
["senderName", "senderSite", "senderCompany", "offer"].forEach((id) => $(id).addEventListener("input", renderEmails));

refresh();
