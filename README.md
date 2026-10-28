# OutreachPilot

Turn a messy list of guest-post prospects into a **ranked outreach plan**: transparent scores, honest email drafts and a follow-up schedule.

## The problem
Outreach teams waste hours deciding which sites to pitch. Spreadsheets are full of duplicates, spammy niches and sites whose traffic is falling, and follow-ups get forgotten. Most tools give a score with no explanation.

## What it does
- **Cleans the list:** normalises domains, removes duplicates (keeps the highest DR), skips unusable rows and tells you exactly which rows and why.
- **Scores 0-100 with reasons:** authority (DR), traffic, relevance to your niche, country fit. Every score shows how each part contributed. You control the weights and minimums.
- **Safety rules:** casino, adult, pills-type niches are always skipped. Declining traffic is penalised. Sites under your minimums are capped at tier C.
- **Honest email drafts:** three templates, no invented claims, an opt-out line in every email, a clear warning when no contact email exists. An *optional* AI polish step (Groq) is not allowed to invent facts and is rejected if it removes the opt-out line.
- **Follow-up plan:** emails spread over several days (default 15/day), follow-ups at +4 and +9 days, business days only. Export to CSV.

## Run it
```bash
pip install -r requirements.txt
streamlit run app.py
```
Works with no API key. For AI polish, set `GROQ_API_KEY` in `.streamlit/secrets.toml` or as an environment variable.

## Use your own data
Upload a CSV with: `domain, dr, monthly_traffic, niche` (required) and `country, contact_name, contact_email, traffic_trend (up/flat/down), notes` (optional). See `data/sample_prospects.csv`. The sample sites use the reserved `.example` domain, so none of them are real.

## Tests
```bash
pip install pytest
pytest
```
23 tests cover cleaning, scoring, red flags, email safety, the AI-polish guardrails, the schedule and a headless run of the full UI.

## Limits (honest list)
- DR and traffic come from your own export (Ahrefs, Semrush or similar). The tool does not fetch them.
- Relevance is keyword overlap, not understanding of the site's content. Always skim a site before you pitch.
- It drafts emails; it does not send them. Check local anti-spam rules (CAN-SPAM, GDPR) before emailing at scale.
- Sample data is fictional. This is a portfolio project and has not been used with paying clients.

Built by [Muqadas Zahoor](https://www.linkedin.com/in/muqadas-zahoor-b2a38b2b3/), from experience in off-page SEO outreach. Developed with AI assistance.
