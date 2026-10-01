from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone

from ict_trader.config import Config, InstrumentConfig, StrategyConfig
from ict_trader.sessions import NY, Bar


def ny_bar(ts: str, o: float, h: float, l: float, c: float) -> Bar:  # noqa: E741
    """A bar whose open time is given as New York local 'YYYY-MM-DD HH:MM'."""
    local = datetime.strptime(ts, "%Y-%m-%d %H:%M").replace(tzinfo=NY)
    return Bar(local.astimezone(timezone.utc), o, h, l, c)


def simple_config(**strategy_overrides) -> Config:  # type: ignore[no-untyped-def]
    """Prior-day levels only, fixed 2R target: easy to reason about by hand."""
    strategy = StrategyConfig(reference_ranges=(), target_mode="rr", target_rr=2.0, min_rr=1.5, flatten_time=None)
    strategy = replace(strategy, **strategy_overrides)
    return Config(instrument=InstrumentConfig(), strategy=strategy)


def prior_day() -> list[Bar]:
    """Trading day Tue 2026-06-02 (starts Mon 17:00 NY): high 1.1050, low 1.1000."""
    return [ny_bar("2026-06-01 18:00", 1.1020, 1.1050, 1.1000, 1.1020)]


def quiet_open() -> list[Bar]:
    """First bar of trading day Wed 2026-06-03, inside the prior range."""
    return [ny_bar("2026-06-02 18:00", 1.1030, 1.1040, 1.1010, 1.1035)]


def pdh_sweep() -> Bar:
    """London killzone bar that wicks 6 pips above PDH and closes back below."""
    return ny_bar("2026-06-03 03:00", 1.1040, 1.1056, 1.1038, 1.1045)
