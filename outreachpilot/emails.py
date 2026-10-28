"""Outreach email drafting with honest, placeholder-free templates and an optional LLM polish."""
from __future__ import annotations

import re
import zlib
from dataclasses import dataclass


@dataclass
class Sender:
    name: str
    website: str
    offer: str  # what you can contribute, e.g. "a data-backed guest article on email deliverability"
    company: str = ""


TEMPLATES = [
    (
        "Guest article idea for {site}",
        "Hi {greeting},\n\n"
        "I read {site} and noticed you cover {niche}. I'd like to propose {offer} for your readers.\n\n"
        "I can send a short outline first so you can decide whether it fits. "
        "For context, I work on {sender_site}.\n\n"
        "If you'd rather not hear from me, just reply \"no thanks\" and I won't email again.\n\n"
        "Best,\n{sender}",
    ),
    (
        "Contribution for {site}?",
        "Hello {greeting},\n\n"
        "I'm {sender} from {sender_site}. {site} is a good home for content about {niche}, "
        "so I wanted to offer {offer}.\n\n"
        "Happy to share a headline and outline before writing anything.\n\n"
        "If this isn't relevant, reply \"no thanks\" and I'll stop.\n\n"
        "Thanks for your time,\n{sender}",
    ),
    (
        "A resource idea for {site}'s readers",
        "Hi {greeting},\n\n"
        "Your {niche} content at {site} caught my eye. I'd be glad to write {offer} if it would be useful.\n\n"
        "I'll send a draft outline first, no obligation. You can find my work at {sender_site}.\n\n"
        "Not interested? Reply \"no thanks\" and I won't follow up.\n\n"
        "Kind regards,\n{sender}",
    ),
]

PLACEHOLDER = re.compile(r"\{[a-z_]+\}|\[[A-Za-z ]+\]|<[A-Za-z ]+>")


def has_unfilled_placeholders(text: str) -> bool:
    return bool(PLACEHOLDER.search(text))


def _pick(domain: str) -> int:
    return zlib.crc32(domain.encode()) % len(TEMPLATES)  # stable per domain, varied across domains


def draft_email(prospect: dict, sender: Sender, template_index: int | None = None) -> dict:
    if not sender.name.strip() or not sender.website.strip() or not sender.offer.strip():
        raise ValueError("Add your name, website and what you are offering before drafting emails.")
    idx = _pick(prospect["domain"]) if template_index is None else template_index % len(TEMPLATES)
    subject_t, body_t = TEMPLATES[idx]
    name = str(prospect.get("contact_name") or "").strip()
    values = {
        "site": prospect["domain"],
        "niche": str(prospect.get("niche") or "your topic").strip().lower(),
        "greeting": name.split()[0] if name else "there",
        "offer": sender.offer.strip(),
        "sender": sender.name.strip() + (f" ({sender.company.strip()})" if sender.company.strip() else ""),
        "sender_site": sender.website.strip(),
    }
    subject, body = subject_t.format(**values), body_t.format(**values)
    return {
        "domain": prospect["domain"],
        "to": str(prospect.get("contact_email") or "").strip(),
        "subject": subject,
        "body": body,
        "needs_contact": not str(prospect.get("contact_email") or "").strip(),
    }


POLISH_RULES = (
    "Improve the flow and tone of this outreach email. Rules: keep it under 120 words; do not invent "
    "any facts, statistics, credentials, past results or compliments about the recipient's site beyond what is "
    "already in the draft; keep the opt-out sentence; keep the sender name and website unchanged; return only the email body."
)


def polish_with_llm(client, model: str, draft_body: str) -> str:
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": POLISH_RULES},
            {"role": "user", "content": draft_body},
        ],
        temperature=0.4,
        max_tokens=400,
    )
    text = (response.choices[0].message.content or "").strip()
    # Never accept a rewrite that dropped the opt-out line or introduced placeholders.
    if "no thanks" not in text.lower() or has_unfilled_placeholders(text):
        return draft_body
    return text
