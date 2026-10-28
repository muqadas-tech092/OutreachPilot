"""Follow-up planning: send dates that skip weekends."""
from __future__ import annotations

from datetime import date, timedelta

import pandas as pd


def next_business_day(d: date) -> date:
    while d.weekday() >= 5:  # 5 = Saturday, 6 = Sunday
        d += timedelta(days=1)
    return d


def follow_up_dates(start: date, offsets: tuple[int, ...] = (0, 4, 9)) -> list[date]:
    return [next_business_day(start + timedelta(days=o)) for o in offsets]


def build_plan(scored: pd.DataFrame, start: date, tiers: tuple[str, ...] = ("A", "B"), per_day: int = 15) -> pd.DataFrame:
    """Spread first emails over several days so no more than `per_day` go out in one day."""
    picked = scored[scored["tier"].isin(tiers)].reset_index(drop=True)
    rows = []
    for i, row in picked.iterrows():
        first = next_business_day(start + timedelta(days=i // per_day))
        d1, d2, d3 = follow_up_dates(first)
        rows.append(
            {
                "domain": row["domain"],
                "tier": row["tier"],
                "contact_email": row["contact_email"],
                "email_1": d1,
                "follow_up_1": d2,
                "follow_up_2": d3,
            }
        )
    return pd.DataFrame(rows, columns=["domain", "tier", "contact_email", "email_1", "follow_up_1", "follow_up_2"])
