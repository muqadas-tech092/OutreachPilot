// Small, dependency-free CSV reader/writer (handles quotes, commas and newlines inside quotes, CRLF, BOM).

export function parseCSV(text) {
  text = String(text).replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = ""; rows.push(row); row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/** First row is the header. Returns {headers, records} with trimmed, lower_snake_case headers. */
export function toRecords(rows) {
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map((h) => String(h).trim().toLowerCase().replace(/ /g, "_"));
  const records = rows.slice(1).map((r) => {
    const o = {};
    headers.forEach((h, i) => { o[h] = r[i] !== undefined ? r[i] : ""; });
    return o;
  });
  return { headers, records };
}

// Cells starting with = + - @ can run as formulas when a CSV is opened in Excel; neutralise them.
function safeCell(value) {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCSV(records, columns) {
  const lines = [columns.join(",")];
  for (const r of records) lines.push(columns.map((c) => safeCell(r[c])).join(","));
  return lines.join("\n") + "\n";
}
