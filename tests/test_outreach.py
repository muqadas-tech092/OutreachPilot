from datetime import date
from pathlib import Path

import pandas as pd
import pytest

from outreachpilot.emails import Sender, draft_email, has_unfilled_placeholders, polish_with_llm
from outreachpilot.schedule import build_plan, follow_up_dates, next_business_day
from outreachpilot.scoring import Settings, normalize_domain, parse_prospects, score_all, score_row

ROOT = Path(__file__).resolve().parent.parent
SAMPLE = pd.read_csv(ROOT / "data" / "sample_prospects.csv")
SENDER = Sender(name="Muqadas Zahoor", website="https://example.com", offer="a short guide on outreach automation")


def scored(settings=None):
    clean, _ = parse_prospects(SAMPLE)
    return score_all(clean, settings or Settings())


def test_domain_normalisation():
    assert normalize_domain("https://www.Example.com/blog?x=1") == "example.com"
    assert normalize_domain("WWW.example.com/") == "example.com"


def test_parse_dedupes_and_keeps_highest_dr():
    clean, issues = parse_prospects(SAMPLE)
    assert (clean["domain"] == "copycatseo.example").sum() == 1
    assert clean.loc[clean["domain"] == "copycatseo.example", "dr"].iloc[0] == 44
    assert any("duplicate" in i for i in issues)


def test_missing_required_column_gives_clear_error():
    with pytest.raises(ValueError, match="missing required column"):
        parse_prospects(pd.DataFrame({"domain": ["a.com"], "dr": [10]}))


def test_bad_rows_are_skipped_with_a_reason():
    df = pd.DataFrame(
        {"domain": ["ok.com", "bad.com", ""], "dr": [50, "n/a", 40], "monthly_traffic": [5000, 100, 100], "niche": ["seo"] * 3}
    )
    clean, issues = parse_prospects(df)
    assert list(clean["domain"]) == ["ok.com"] and len(issues) == 2


def test_dr_out_of_range_is_rejected():
    df = pd.DataFrame({"domain": ["x.com"], "dr": [250], "monthly_traffic": [5000], "niche": ["seo"]})
    clean, issues = parse_prospects(df)
    assert clean.empty and "outside 0-100" in issues[0]


def test_red_flag_niche_is_rejected_whatever_the_metrics():
    out = scored().set_index("domain")
    assert out.loc["luckyspinhub.example", "tier"] == "Skip" and out.loc["luckyspinhub.example", "score"] == 0


def test_best_site_ranks_first_and_is_tier_a():
    out = scored()
    assert out.iloc[0]["domain"] == "growthledger.example" and out.iloc[0]["tier"] == "A"


def test_below_minimums_is_capped_at_c_and_explained():
    row = scored().set_index("domain").loc["tinytechtips.example"]
    assert row["tier"] in ("C", "Skip") and "below your minimums" in row["flags"]


def test_declining_traffic_is_penalised():
    base = pd.Series({"domain": "x.com", "dr": 50, "monthly_traffic": 20000, "niche": "seo", "country": "US",
                      "traffic_trend": "flat", "contact_email": "a@x.com"})
    down = base.copy()
    down["traffic_trend"] = "down"
    s = Settings(target_niche="seo")
    assert score_row(base, s)["score"] - score_row(down, s)["score"] == 10


def test_country_filter_changes_the_score():
    s_any, s_us = Settings(), Settings(target_countries=("US",))
    germany = SAMPLE[SAMPLE.domain == "cloudcartnews.example"]
    a = score_all(parse_prospects(germany)[0], s_any).iloc[0]["score"]
    b = score_all(parse_prospects(germany)[0], s_us).iloc[0]["score"]
    assert a > b


def test_every_scored_row_explains_itself():
    out = scored()
    assert all(len(r) >= 1 for r in out["reasons"])


def test_email_has_no_placeholders_and_includes_opt_out():
    prospect = scored().iloc[0].to_dict()
    mail = draft_email(prospect, SENDER)
    assert not has_unfilled_placeholders(mail["subject"] + mail["body"])
    assert "no thanks" in mail["body"].lower() and "Muqadas Zahoor" in mail["body"]


def test_email_greets_by_first_name_or_falls_back():
    p = {"domain": "a.com", "niche": "SEO", "contact_name": "Dana Whitfield", "contact_email": "d@a.com"}
    assert "Hi Dana" in draft_email(p, SENDER, 0)["body"]
    p["contact_name"] = ""
    assert "Hi there" in draft_email(p, SENDER, 0)["body"]


def test_email_requires_sender_details():
    with pytest.raises(ValueError):
        draft_email({"domain": "a.com", "niche": "seo"}, Sender("", "", ""))


def test_prospect_without_email_is_flagged_for_research():
    p = {"domain": "a.com", "niche": "seo", "contact_email": ""}
    assert draft_email(p, SENDER)["needs_contact"] is True


class _Resp:
    def __init__(self, text):
        self.choices = [type("C", (), {"message": type("M", (), {"content": text})()})()]


class _FakeClient:
    def __init__(self, text):
        self.chat = type("Chat", (), {"completions": self})()
        self._text, self.last = text, None

    def create(self, **kw):
        self.last = kw
        return _Resp(self._text)


def test_llm_polish_rejects_rewrites_that_drop_the_opt_out():
    original = "Hi there,\n\nHello.\n\nReply \"no thanks\" to stop.\n\nBest,\nM"
    assert polish_with_llm(_FakeClient("Great email without opt out"), "m", original) == original


def test_llm_polish_accepts_good_rewrite_and_sends_guardrails():
    client = _FakeClient("Hi there, short note. Reply no thanks to stop. Best, M")
    out = polish_with_llm(client, "m", "draft")
    assert out.startswith("Hi there") and "do not invent" in client.last["messages"][0]["content"]


def test_follow_ups_skip_weekends():
    friday = date(2026, 11, 6)
    dates = follow_up_dates(friday)
    assert all(d.weekday() < 5 for d in dates)
    assert next_business_day(date(2026, 11, 7)) == date(2026, 11, 9)


def test_plan_respects_daily_limit_and_only_includes_chosen_tiers():
    plan = build_plan(scored(), date(2026, 11, 2), per_day=2)
    assert set(plan["tier"]) <= {"A", "B"}
    assert plan.groupby("email_1").size().max() <= 2
