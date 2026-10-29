// Follow-up planning on business days. All dates are handled in UTC so time zones cannot shift them.

const DAY = 86400000;

export function parseISO(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export const toISO = (d) => d.toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(d.getTime() + n * DAY);

export function nextBusinessDay(d) {
  let x = d;
  while (x.getUTCDay() === 0 || x.getUTCDay() === 6) x = addDays(x, 1);
  return x;
}

export function followUpDates(start, offsets = [0, 4, 9]) {
  return offsets.map((o) => nextBusinessDay(addDays(start, o)));
}

export function buildPlan(scored, start, tiers = ["A", "B"], perDay = 15) {
  const picked = scored.filter((r) => tiers.includes(r.tier));
  return picked.map((row, i) => {
    const first = nextBusinessDay(addDays(start, Math.floor(i / perDay)));
    const [d1, d2, d3] = followUpDates(first);
    return {
      domain: row.domain,
      tier: row.tier,
      contact_email: row.contact_email,
      email_1: toISO(d1),
      follow_up_1: toISO(d2),
      follow_up_2: toISO(d3),
    };
  });
}
