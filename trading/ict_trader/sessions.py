"""Time handling: bars, New York session clock, and reference levels."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from .config import StrategyConfig, Window

NY = ZoneInfo("America/New_York")


@dataclass(frozen=True)
class Bar:
    """One OHLC bar. `time` is the bar's open time, timezone-aware UTC."""

    time: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0

    def __post_init__(self) -> None:
        if self.time.tzinfo is None:
            raise ValueError("Bar.time must be timezone-aware (UTC)")


def to_ny(ts: datetime) -> datetime:
    return ts.astimezone(NY)


def trading_day(ts: datetime, rollover: time) -> date:
    """The trading day a timestamp belongs to.

    With a 17:00 rollover, Monday 17:00 NY onwards counts as Tuesday, matching
    the forex daily candle. With a 00:00 rollover it is the NY calendar date.
    """
    ny = to_ny(ts)
    day = ny.date()
    if rollover != time(0, 0) and ny.time() >= rollover:
        day += timedelta(days=1)
    return day


def in_any(windows: tuple[Window, ...], ts: datetime) -> Window | None:
    t = to_ny(ts).time()
    for w in windows:
        if w.contains(t):
            return w
    return None


@dataclass(frozen=True)
class Level:
    name: str  # e.g. "PDH", "ASIA_L"
    price: float
    side: str  # "high" (buy-side liquidity) or "low" (sell-side liquidity)


@dataclass
class _Range:
    high: float = float("-inf")
    low: float = float("inf")
    seen: bool = False
    complete: bool = False


@dataclass
class LevelTracker:
    """Builds reference levels bar by bar, never using data from the future.

    A range level only becomes available on the first bar after its window
    ends, and prior-day levels only once the day has rolled over.
    """

    config: StrategyConfig
    day: date | None = None
    _day_high: float = float("-inf")
    _day_low: float = float("inf")
    _prior_high: float | None = None
    _prior_low: float | None = None
    _ranges: dict[str, _Range] = field(default_factory=dict)

    def update(self, bar: Bar) -> bool:
        """Feed a bar. Returns True if this bar started a new trading day."""
        day = trading_day(bar.time, self.config.day_rollover)
        new_day = day != self.day
        if new_day:
            if self.day is not None and self._day_high > float("-inf"):
                self._prior_high, self._prior_low = self._day_high, self._day_low
            self.day = day
            self._day_high, self._day_low = float("-inf"), float("inf")
            self._ranges = {w.name: _Range() for w in self.config.reference_ranges}

        t = to_ny(bar.time).time()
        for w in self.config.reference_ranges:
            r = self._ranges[w.name]
            if r.complete:
                continue
            if w.contains(t):
                r.high, r.low, r.seen = max(r.high, bar.high), min(r.low, bar.low), True
            elif r.seen:
                r.complete = True

        self._day_high = max(self._day_high, bar.high)
        self._day_low = min(self._day_low, bar.low)
        return new_day

    def levels(self) -> list[Level]:
        """Levels that are fully formed as of the last bar fed to update().

        None of them include that bar: prior-day levels exclude the current
        day, and a range completes only on the first bar after its window.
        """
        out: list[Level] = []
        if self.config.use_prior_day_levels and self._prior_high is not None:
            out.append(Level("PDH", self._prior_high, "high"))
            out.append(Level("PDL", self._prior_low, "low"))  # type: ignore[arg-type]
        for name, r in self._ranges.items():
            if r.complete:
                out.append(Level(f"{name.upper()}_H", r.high, "high"))
                out.append(Level(f"{name.upper()}_L", r.low, "low"))
        return out


def flatten_deadline(entry: datetime, flatten_time: time | None) -> datetime | None:
    """The next NY flatten_time at or after entry (rule EX-1)."""
    if flatten_time is None:
        return None
    ny = to_ny(entry)
    day = ny.date() if ny.time() < flatten_time else ny.date() + timedelta(days=1)
    return datetime.combine(day, flatten_time, tzinfo=NY)


def utc(year: int, month: int, day: int, hour: int = 0, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)
