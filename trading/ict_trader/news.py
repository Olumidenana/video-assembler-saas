"""Fundamentals filter: stay out of the market around high-impact news.

The calendar is a CSV with columns: time_utc, currency, impact, title
(time_utc in ISO 8601, e.g. 2026-10-02T12:30:00Z). Export it from your
calendar provider of choice; the system never trades blind if the file is
missing in live mode (see live.py).
"""

from __future__ import annotations

import csv
from bisect import bisect_left
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .config import InstrumentConfig, NewsConfig


@dataclass(frozen=True)
class NewsEvent:
    time: datetime
    currency: str
    impact: str
    title: str


def parse_utc(value: str) -> datetime:
    value = value.strip().replace("Z", "+00:00")
    ts = datetime.fromisoformat(value)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc)


def load_calendar_csv(path: str | Path) -> list[NewsEvent]:
    with open(path, newline="") as fh:
        rows = csv.DictReader(fh)
        events = [
            NewsEvent(parse_utc(r["time_utc"]), r["currency"].strip().upper(), r["impact"].strip().lower(), r.get("title", "").strip())
            for r in rows
        ]
    return sorted(events, key=lambda e: e.time)


def symbol_currencies(instrument: InstrumentConfig) -> tuple[str, ...]:
    if instrument.news_currencies:
        return tuple(c.upper() for c in instrument.news_currencies)
    s = instrument.symbol.upper()
    if len(s) >= 6 and s[:6].isalpha():
        return (s[:3], s[3:6])
    raise ValueError(f"Set instrument.news_currencies for non-FX symbol {instrument.symbol!r}")


class NewsFilter:
    def __init__(self, config: NewsConfig, instrument: InstrumentConfig, events: list[NewsEvent]):
        self.config = config
        currencies = set(symbol_currencies(instrument))
        impacts = set(config.impacts)
        self.events = [e for e in events if e.currency in currencies and e.impact in impacts]
        self._times = [e.time for e in self.events]

    def _first_event_after(self, ts: datetime) -> int:
        return bisect_left(self._times, ts)

    def blocking_event(self, ts: datetime) -> NewsEvent | None:
        """The event whose blackout window covers ts, if any (rule NF-1)."""
        if not self.config.enabled:
            return None
        before, after = timedelta(minutes=self.config.minutes_before), timedelta(minutes=self.config.minutes_after)
        i = self._first_event_after(ts - after)
        if i < len(self.events) and self.events[i].time <= ts + before:
            return self.events[i]
        return None

    def should_flatten(self, ts: datetime) -> NewsEvent | None:
        """An upcoming event close enough that open trades must close (NF-2)."""
        if not self.config.enabled or self.config.flatten_minutes_before <= 0:
            return None
        i = self._first_event_after(ts)
        if i < len(self.events) and self.events[i].time - ts <= timedelta(minutes=self.config.flatten_minutes_before):
            return self.events[i]
        return None
