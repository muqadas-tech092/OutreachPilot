"""OutreachPilot: turn a messy prospect list into a ranked outreach plan."""
from __future__ import annotations

import os
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import streamlit as st

from outreachpilot.emails import Sender, draft_email, polish_with_llm
from outreachpilot.schedule import build_plan
from outreachpilot.scoring import Settings, parse_prospects, score_all

ROOT = Path(__file__).parent

st.set_page_config(page_title="OutreachPilot", layout="wide")


def get_key() -> str | None:
    try:
        value = st.secrets.get("GROQ_API_KEY")
    except Exception:
        value = None
    return value or os.environ.get("GROQ_API_KEY")


def md_safe(text: str) -> str:
    return text.replace("$", "\\$")


def load_input():
    st.subheader("1. Your prospect list")
    st.caption("Columns: domain, dr, monthly_traffic, niche (required); country, contact_name, contact_email, traffic_trend (up/flat/down), notes (optional).")
    up = st.file_uploader("Upload a CSV", type="csv")
    use_sample = st.toggle("Use the sample list (fictional sites)", value=up is None)
    if up is not None and not use_sample:
        return pd.read_csv(up)
    if use_sample:
        return pd.read_csv(ROOT / "data" / "sample_prospects.csv")
    return None


def sidebar() -> tuple[Settings, Sender]:
    with st.sidebar:
        st.header("Who do you want to reach?")
        niche = st.text_input("Target niche", "digital marketing, seo")
        countries = st.text_input("Target countries (codes, comma separated, blank = any)", "")
        min_dr = st.slider("Minimum DR", 0, 80, 20)
        min_traffic = st.number_input("Minimum monthly traffic", 0, 1_000_000, 1000, step=500)
        with st.expander("Scoring weights (total 100)"):
            a = st.slider("Authority", 0, 60, 35)
            t = st.slider("Traffic", 0, 60, 25)
            r = st.slider("Relevance", 0, 60, 30)
            g = st.slider("Country fit", 0, 30, 10)
            if a + t + r + g != 100:
                st.warning(f"Weights add up to {a + t + r + g}, not 100. Scores are scaled accordingly.")
        st.divider()
        st.header("Your details (used in emails)")
        name = st.text_input("Your name", "")
        site = st.text_input("Your website", "")
        company = st.text_input("Company (optional)", "")
        offer = st.text_input("What are you offering?", "a short, practical guest article")
        total = max(a + t + r + g, 1)
        settings = Settings(
            target_niche=niche,
            target_countries=tuple(c.strip() for c in countries.split(",") if c.strip()),
            min_dr=min_dr,
            min_traffic=int(min_traffic),
            weights={k: v * 100 / total for k, v in {"authority": a, "traffic": t, "relevance": r, "geo": g}.items()},
        )
    return settings, Sender(name=name, website=site, offer=offer, company=company)


def main() -> None:
    st.title("OutreachPilot")
    st.caption("Stop guessing which sites to pitch. Score prospects transparently, draft honest emails and plan follow-ups.")
    settings, sender = sidebar()
    raw = load_input()
    if raw is None:
        st.info("Upload a CSV or switch on the sample list to begin.")
        return
    try:
        clean, issues = parse_prospects(raw)
    except ValueError as exc:
        st.error(str(exc))
        return
    if clean.empty:
        st.error("No usable rows were found in this file.")
        return
    for issue in issues:
        st.warning(issue)

    scored = score_all(clean, settings)
    counts = scored["tier"].value_counts()
    cols = st.columns(5)
    cols[0].metric("Prospects", len(scored))
    for col, tier in zip(cols[1:], ["A", "B", "C", "Skip"]):
        col.metric(f"Tier {tier}", int(counts.get(tier, 0)))

    tab1, tab2, tab3 = st.tabs(["Ranked prospects", "Email drafts", "Follow-up plan"])

    with tab1:
        show = scored[["tier", "score", "domain", "dr", "monthly_traffic", "niche", "country", "flags"]].copy()
        show["flags"] = show["flags"].map(lambda f: ", ".join(f))
        st.dataframe(show, use_container_width=True, hide_index=True)
        st.markdown("##### Why each site got its score")
        for _, row in scored.iterrows():
            with st.expander(f"{row['domain']}: {row['score']} ({row['tier']})"):
                for reason in row["reasons"]:
                    st.markdown(f"- {md_safe(reason)}")
                if row["notes"]:
                    st.caption(f"Notes: {row['notes']}")
        st.download_button("Download ranked list (CSV)", show.to_csv(index=False), "ranked_prospects.csv")

    with tab2:
        tiers = st.multiselect("Draft emails for tiers", ["A", "B", "C"], default=["A", "B"])
        key = get_key()
        use_ai = st.toggle("Polish drafts with AI (optional)", value=False, disabled=key is None,
                           help="Needs a GROQ_API_KEY secret. The AI may not invent facts and must keep the opt-out line.")
        if key is None:
            st.caption("AI polish is off because no GROQ_API_KEY is set. Template drafts work without it.")
        targets = scored[scored["tier"].isin(tiers)]
        if targets.empty:
            st.info("No prospects in the chosen tiers.")
        elif not (sender.name and sender.website):
            st.info("Add your name and website in the sidebar to generate drafts.")
        else:
            client = None
            if use_ai and key:
                from groq import Groq

                client = Groq(api_key=key)
            for _, row in targets.iterrows():
                mail = draft_email(row.to_dict(), sender)
                body = mail["body"]
                if client is not None:
                    try:
                        body = polish_with_llm(client, os.environ.get("GROQ_MODEL", "openai/gpt-oss-20b"), body)
                    except Exception:
                        st.caption(f"AI polish unavailable for {row['domain']}; showing the template draft.")
                with st.expander(f"{row['domain']}  ·  {mail['subject']}"):
                    if mail["needs_contact"]:
                        st.warning("No contact email yet. Find the editor's address before sending.")
                    else:
                        st.caption(f"To: {mail['to']}")
                    st.text_area("Body", body, height=240, key=f"body_{row['domain']}", label_visibility="collapsed")
            st.caption("Review every email before sending. Personalise the first line with something specific you read on the site.")

    with tab3:
        start = st.date_input("First send date", date.today() + timedelta(days=1))
        per_day = st.slider("Max first emails per day", 5, 40, 15)
        plan = build_plan(scored, start, per_day=per_day)
        if plan.empty:
            st.info("No tier A or B prospects to schedule.")
        else:
            st.dataframe(plan, use_container_width=True, hide_index=True)
            st.download_button("Download follow-up plan (CSV)", plan.to_csv(index=False), "followup_plan.csv")
            st.caption("Follow-ups go out on business days only, at +4 and +9 days.")


main()
