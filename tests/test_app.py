"""Headless end-to-end run of the OutreachPilot UI."""
import os
from pathlib import Path

from streamlit.testing.v1 import AppTest

APP = str(Path(__file__).resolve().parent.parent / "app.py")


def run() -> AppTest:
    os.environ.pop("GROQ_API_KEY", None)
    at = AppTest.from_file(APP, default_timeout=30)
    at.run()
    return at


def test_loads_sample_and_shows_tier_metrics():
    at = run()
    assert not at.exception
    labels = [m.label for m in at.metric]
    assert "Prospects" in labels and any("Tier A" in l for l in labels)


def test_duplicate_warning_is_shown_for_sample_data():
    at = run()
    assert any("duplicate" in w.value for w in at.warning)


def test_email_tab_asks_for_sender_details_first():
    at = run()
    assert any("Add your name and website" in i.value for i in at.info)


def test_emails_generate_once_sender_details_are_given():
    at = run()
    at.sidebar.text_input[2].set_value("Muqadas Zahoor")   # your name
    at.sidebar.text_input[3].set_value("https://example.com")  # your website
    at.run()
    assert not at.exception
    bodies = [t.value for t in at.text_area]
    assert bodies, "no email drafts were generated"
    assert all("no thanks" in b.lower() and "Muqadas Zahoor" in b for b in bodies)
    assert not any("{" in b or "[" in b for b in bodies)  # no unfilled placeholders
