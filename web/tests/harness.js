// Tiny test harness that runs in the browser (no Node needed). Open tests/test.html.
const tests = [];
export const test = (name, fn) => tests.push({ name, fn });

export function assert(cond, msg = "assertion failed") {
  if (!cond) throw new Error(msg);
}
export function assertEq(actual, expected, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} expected ${e} but got ${a}`.trim());
}
export async function assertThrows(fn, pattern) {
  try { await fn(); } catch (err) {
    if (pattern && !String(err.message).includes(pattern)) throw new Error(`threw "${err.message}", expected to include "${pattern}"`);
    return;
  }
  throw new Error("expected an error but none was thrown");
}

export async function run() {
  const out = document.getElementById("out");
  let passed = 0;
  const failures = [];
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      out.insertAdjacentHTML("beforeend", `<div class="ok">PASS ${t.name}</div>`);
    } catch (err) {
      failures.push({ name: t.name, error: String(err.message) });
      const div = document.createElement("div");
      div.className = "bad";
      div.textContent = `FAIL ${t.name}: ${err.message}`;
      out.appendChild(div);
    }
  }
  window.__results = { total: tests.length, passed, failed: failures.length, failures };
  document.title = `${passed}/${tests.length} passed`;
  document.getElementById("summary").textContent = `${passed} of ${tests.length} tests passed`;
}
