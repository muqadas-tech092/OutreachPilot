// Honest, placeholder-free outreach email drafts. Port of outreachpilot/emails.py (template choice matches Python's CRC32 pick).

export const TEMPLATES = [
  [
    "Guest article idea for {site}",
    "Hi {greeting},\n\n" +
      "I read {site} and noticed you cover {niche}. I'd like to propose {offer} for your readers.\n\n" +
      "I can send a short outline first so you can decide whether it fits. " +
      "For context, I work on {sender_site}.\n\n" +
      'If you\'d rather not hear from me, just reply "no thanks" and I won\'t email again.\n\n' +
      "Best,\n{sender}",
  ],
  [
    "Contribution for {site}?",
    "Hello {greeting},\n\n" +
      "I'm {sender} from {sender_site}. {site} is a good home for content about {niche}, " +
      "so I wanted to offer {offer}.\n\n" +
      "Happy to share a headline and outline before writing anything.\n\n" +
      'If this isn\'t relevant, reply "no thanks" and I\'ll stop.\n\n' +
      "Thanks for your time,\n{sender}",
  ],
  [
    "A resource idea for {site}'s readers",
    "Hi {greeting},\n\n" +
      "Your {niche} content at {site} caught my eye. I'd be glad to write {offer} if it would be useful.\n\n" +
      "I'll send a draft outline first, no obligation. You can find my work at {sender_site}.\n\n" +
      'Not interested? Reply "no thanks" and I won\'t follow up.\n\n' +
      "Kind regards,\n{sender}",
  ],
];

const PLACEHOLDER = /\{[a-z_]+\}|\[[A-Za-z ]+\]|<[A-Za-z ]+>/;
export const hasUnfilledPlaceholders = (text) => PLACEHOLDER.test(text);

let CRC_TABLE = null;
export function crc32(str) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of new TextEncoder().encode(str)) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const fill = (tpl, values) => tpl.replace(/\{([a-z_]+)\}/g, (_, k) => values[k]);

export function draftEmail(prospect, sender, templateIndex = null) {
  if (!sender.name.trim() || !sender.website.trim() || !sender.offer.trim()) {
    throw new Error("Add your name, website and what you are offering before drafting emails.");
  }
  const idx = templateIndex === null ? crc32(prospect.domain) % TEMPLATES.length : templateIndex % TEMPLATES.length;
  const [subjectT, bodyT] = TEMPLATES[idx];
  const name = String(prospect.contact_name || "").trim();
  const company = (sender.company || "").trim();
  const values = {
    site: prospect.domain,
    niche: String(prospect.niche || "your topic").trim().toLowerCase(),
    greeting: name ? name.split(/\s+/)[0] : "there",
    offer: sender.offer.trim(),
    sender: sender.name.trim() + (company ? ` (${company})` : ""),
    sender_site: sender.website.trim(),
  };
  const email = String(prospect.contact_email || "").trim();
  return {
    domain: prospect.domain,
    to: email,
    subject: fill(subjectT, values),
    body: fill(bodyT, values),
    needsContact: !email,
  };
}
