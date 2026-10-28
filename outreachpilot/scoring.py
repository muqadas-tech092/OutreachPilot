"""Prospect cleaning and transparent scoring for guest-post / link outreach."""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

import pandas as pd

REQUIRED = ["domain", "dr", "monthly_traffic", "niche"]
OPTIONAL = ["country", "contact_name", "contact_email", "traffic_trend", "notes"]

# Niches most outreach teams refuse to work with.
RED_FLAG_WORDS = {
    "casino", "gambling", "betting", "adult", "porn", "escort", "payday", "loan",
    "pills", "viagra", "replica", "crypto-casino", "essay-writing",
}

STOP = {"and", "the", "of", "for", "a", "an", "in", "on", "to", "with", "tips", "blog", "news"}


@dataclass
class Settings:
    target_niche: str = "digital marketing, seo"
    target_countries: tuple[str, ...] = ()
    min_dr: int = 20
    min_traffic: int = 1000
    weights: dict = field(
        default_factory=lambda: {"authority": 35, "traffic": 25, "relevance": 30, "geo": 10}
    )


def normalize_domain(value: str) -> str:
    value = str(value).strip().lower()
    value = re.sub(r"^[a-z]+://", "", value)
    value = re.sub(r"^www\.", "", value)
    return value.split("/")[0].split("?")[0].strip(". ")


def _tokens(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", str(text).lower()) if t not in STOP and len(t) > 2}


def _to_number(value) -> float | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    cleaned = re.sub(r"[^\d.]", "", str(value).replace(",", ""))
    if cleaned in ("", "."):
        return None
    return float(cleaned)


def parse_prospects(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """Validate columns, coerce numbers, drop duplicates. Returns (clean_df, human-readable issues)."""
    issues: list[str] = []
    df = df.copy()
    df.columns = [str(c).strip().lower().replace(" ", "_") for c in df.columns]
    missing = [c for c in REQUIRED if c not in df.columns]
    if missing:
        raise ValueError(
            "Your file is missing required column(s): " + ", ".join(missing)
            + ". Required: " + ", ".join(REQUIRED) + "."
        )
    for col in OPTIONAL:
        if col not in df.columns:
            df[col] = ""
    df["domain"] = df["domain"].map(normalize_domain)
    df["dr"] = df["dr"].map(_to_number)
    df["monthly_traffic"] = df["monthly_traffic"].map(_to_number)

    bad = df[(df["domain"] == "") | df["dr"].isna() | df["monthly_traffic"].isna()]
    for idx, row in bad.iterrows():
        issues.append(f"Row {idx + 2}: skipped because domain, DR or traffic is missing or not a number.")
    df = df.drop(bad.index)

    out_of_range = df[(df["dr"] < 0) | (df["dr"] > 100)]
    for idx, row in out_of_range.iterrows():
        issues.append(f"Row {idx + 2} ({row['domain']}): DR {row['dr']:g} is outside 0-100, skipped.")
    df = df.drop(out_of_range.index)

    before = len(df)
    df = df.sort_values("dr", ascending=False).drop_duplicates("domain", keep="first").sort_index()
    if before - len(df):
        issues.append(f"{before - len(df)} duplicate domain(s) removed (kept the row with the highest DR).")
    df["dr"] = df["dr"].astype(int)
    df["monthly_traffic"] = df["monthly_traffic"].astype(int)
    return df.reset_index(drop=True), issues


def _relevance(niche: str, target: str) -> float:
    a, b = _tokens(niche), _tokens(target)
    if not a or not b:
        return 0.0
    overlap = len(a & b)
    return min(1.0, overlap / min(len(a), len(b)))


def score_row(row: pd.Series, s: Settings) -> dict:
    w = s.weights
    reasons: list[str] = []
    flags: list[str] = []

    niche_words = _tokens(row["niche"]) | _tokens(row["domain"].replace("-", " ").replace(".", " "))
    if niche_words & RED_FLAG_WORDS:
        return {"score": 0, "tier": "Skip", "reasons": ["Niche is on the do-not-pitch list."], "flags": ["red-flag niche"]}

    authority = min(row["dr"], 80) / 80
    traffic = min(max((math.log10(max(row["monthly_traffic"], 1)) - 3) / 3, 0.0), 1.0)
    relevance = _relevance(row["niche"], s.target_niche)
    country = str(row["country"]).strip().lower()
    targets = tuple(c.strip().lower() for c in s.target_countries)
    geo = 1.0 if not targets or country in targets else 0.0

    score = (
        authority * w["authority"] + traffic * w["traffic"]
        + relevance * w["relevance"] + geo * w["geo"]
    )
    reasons.append(f"Authority: DR {row['dr']} adds {authority * w['authority']:.0f} of {w['authority']}.")
    reasons.append(f"Traffic: {row['monthly_traffic']:,}/month adds {traffic * w['traffic']:.0f} of {w['traffic']}.")
    reasons.append(
        f"Relevance to '{s.target_niche}': {relevance * 100:.0f}% match adds {relevance * w['relevance']:.0f} of {w['relevance']}."
    )
    if targets:
        reasons.append("Country matches your target." if geo else f"Country '{row['country'] or 'unknown'}' is outside your target (0 of {w['geo']}).")

    if str(row["traffic_trend"]).strip().lower() == "down":
        score -= 10
        flags.append("traffic declining")
        reasons.append("Traffic is declining: -10.")
    if not str(row["contact_email"]).strip():
        flags.append("no contact email")

    below = []
    if row["dr"] < s.min_dr:
        below.append(f"DR {row['dr']} is under your minimum of {s.min_dr}")
    if row["monthly_traffic"] < s.min_traffic:
        below.append(f"traffic {row['monthly_traffic']:,} is under your minimum of {s.min_traffic:,}")
    score = max(0, min(100, round(score)))
    tier = "A" if score >= 75 else "B" if score >= 55 else "C" if score >= 35 else "Skip"
    if below:
        flags.append("below your minimums")
        reasons.append("Capped at tier C because " + " and ".join(below) + ".")
        if tier in ("A", "B"):
            tier = "C"
    return {"score": score, "tier": tier, "reasons": reasons, "flags": flags}


def score_all(df: pd.DataFrame, s: Settings) -> pd.DataFrame:
    results = df.apply(lambda r: score_row(r, s), axis=1, result_type="expand")
    out = pd.concat([df, results], axis=1)
    order = {"A": 0, "B": 1, "C": 2, "Skip": 3}
    out["_o"] = out["tier"].map(order)
    out = out.sort_values(["_o", "score"], ascending=[True, False]).drop(columns="_o").reset_index(drop=True)
    return out
