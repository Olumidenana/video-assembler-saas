"""Configuration for the Time-and-Price system.

Every tunable rule lives here so the trader can confirm each value against
their own methodology (see RULES.md). All session times are New York local
time, the ICT convention; bar timestamps everywhere else are UTC.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass, field, fields, replace
from datetime import time
from pathlib import Path
from typing import Any


def parse_hhmm(value: str | time) -> time:
    if isinstance(value, time):
        return value
    hh, mm = value.strip().split(":")
    return time(int(hh), int(mm))


@dataclass(frozen=True)
class Window:
    """A New York time-of-day window. `end` is exclusive; may wrap midnight."""

    name: str
    start: time
    end: time

    def contains(self, t: time) -> bool:
        if self.start <= self.end:
            return self.start <= t < self.end
        return t >= self.start or t < self.end


@dataclass(frozen=True)
class InstrumentConfig:
    symbol: str = "EURUSD"
    pip_size: float = 0.0001
    # Typical spread charged on entry/exit (prices in data are assumed to be bid).
    spread_pips: float = 0.8
    # Units per 1.0 lot, used for commission and MT5 lot conversion.
    contract_size: float = 100_000
    # Round-turn commission per 1.0 lot, in account currency.
    commission_per_lot: float = 7.0
    # Account-currency value of 1.0 in the quote currency (1.0 for EURUSD on a
    # USD account). Live trading uses the broker's tick value instead.
    quote_to_account_rate: float = 1.0
    volume_step: float = 0.01
    min_lots: float = 0.01
    # Currencies whose high-impact news blocks this symbol. Empty = derive
    # from a 6-letter FX symbol (EURUSD -> EUR, USD).
    news_currencies: tuple[str, ...] = ()

    def pips(self, n: float) -> float:
        return n * self.pip_size


@dataclass(frozen=True)
class StrategyConfig:
    timeframe_minutes: int = 5
    # Trading-day rollover in NY time; 17:00 matches the forex daily candle.
    day_rollover: time = time(17, 0)
    # Only these windows may produce entries (rule KZ-1).
    killzones: tuple[Window, ...] = (
        Window("london", time(2, 0), time(5, 0)),
        Window("new_york", time(7, 0), time(10, 0)),
    )
    # Ranges whose high/low become reference levels once the window closes (rule TP-1).
    reference_ranges: tuple[Window, ...] = (Window("asia", time(20, 0), time(0, 0)),)
    # Use prior trading day's high/low as reference levels (rule TP-1).
    use_prior_day_levels: bool = True
    # A level already traded through outside a killzone today is spent (rule TP-2).
    invalidate_levels_taken_outside_killzone: bool = True
    # Price must exceed the level by at least this much to count as a sweep (TP-3).
    min_sweep_pips: float = 0.5
    # Bars allowed after the sweep for a close back inside the level (TP-4).
    max_confirm_bars: int = 3
    # Stop goes beyond the sweep extreme by this buffer (RK-1).
    stop_buffer_pips: float = 1.0
    min_stop_pips: float = 3.0
    max_stop_pips: float = 25.0
    # "rr" = fixed reward:risk; "opposite_level" = nearest opposing liquidity (TG-1).
    target_mode: str = "opposite_level"
    target_rr: float = 2.0
    # Minimum reward:risk; a setup with less is skipped (TG-2).
    min_rr: float = 1.5
    max_signals_per_day: int = 1
    # Flatten any open trade at this NY time (EX-1). None disables.
    flatten_time: time | None = time(16, 0)


@dataclass(frozen=True)
class RiskConfig:
    risk_per_trade_pct: float = 0.5
    max_daily_loss_pct: float = 2.0
    max_weekly_loss_pct: float = 4.0
    max_consecutive_losses: int = 3
    max_trades_per_day: int = 2
    max_open_positions: int = 1
    max_lots: float = 5.0


@dataclass(frozen=True)
class NewsConfig:
    enabled: bool = True
    impacts: tuple[str, ...] = ("high",)
    minutes_before: int = 30
    minutes_after: int = 30
    # Close an open trade this many minutes before a blocking event. 0 disables.
    flatten_minutes_before: int = 5


@dataclass(frozen=True)
class LiveConfig:
    # Timezone of MT5 server timestamps: an IANA name, or "NY+7" for the common
    # broker convention of New York time + 7h (UTC+2 winter / UTC+3 summer).
    server_timezone: str = "NY+7"
    poll_seconds: float = 5.0
    magic: int = 20260901
    # Slippage tolerance for market orders, in points.
    deviation_points: int = 10
    # Ignore a signal whose bar closed longer ago than this (e.g. after a reconnect).
    max_signal_age_seconds: int = 120
    # Create this file to flatten everything and stop the live runner.
    kill_switch_file: str = "STOP"
    journal_path: str = "journal.sqlite"


@dataclass(frozen=True)
class Config:
    instrument: InstrumentConfig = field(default_factory=InstrumentConfig)
    strategy: StrategyConfig = field(default_factory=StrategyConfig)
    risk: RiskConfig = field(default_factory=RiskConfig)
    news: NewsConfig = field(default_factory=NewsConfig)
    live: LiveConfig = field(default_factory=LiveConfig)
    initial_equity: float = 10_000.0


def _windows(items: list[dict[str, str]]) -> tuple[Window, ...]:
    return tuple(Window(i["name"], parse_hhmm(i["start"]), parse_hhmm(i["end"])) for i in items)


def _build(cls: type, data: dict[str, Any]) -> Any:
    known = {f.name for f in fields(cls)}
    unknown = set(data) - known
    if unknown:
        raise ValueError(f"Unknown {cls.__name__} keys: {sorted(unknown)}")
    kwargs: dict[str, Any] = {}
    for key, value in data.items():
        if key in ("killzones", "reference_ranges"):
            value = _windows(value)
        elif key in ("day_rollover",):
            value = parse_hhmm(value)
        elif key == "flatten_time":
            value = parse_hhmm(value) if value else None
        elif isinstance(value, list):
            value = tuple(value)
        kwargs[key] = value
    return cls(**kwargs)


def load_config(path: str | Path) -> Config:
    with open(path, "rb") as fh:
        raw = tomllib.load(fh)
    return Config(
        instrument=_build(InstrumentConfig, raw.get("instrument", {})),
        strategy=_build(StrategyConfig, raw.get("strategy", {})),
        risk=_build(RiskConfig, raw.get("risk", {})),
        news=_build(NewsConfig, raw.get("news", {})),
        live=_build(LiveConfig, raw.get("live", {})),
        initial_equity=float(raw.get("initial_equity", 10_000.0)),
    )


def with_strategy(config: Config, **overrides: Any) -> Config:
    return replace(config, strategy=replace(config.strategy, **overrides))
