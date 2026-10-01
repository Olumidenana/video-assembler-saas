"""ICT Time-and-Price: liquidity sweep and reversal inside a killzone.

The strategy is a small deterministic state machine fed one closed bar at a
time. The backtester and the live runner both drive it via on_bar(), so the
code that is validated is exactly the code that trades.

Rule IDs (documented in RULES.md) appear in every decision so each signal can
be traced to the rule that produced or blocked it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from .config import InstrumentConfig, StrategyConfig
from .sessions import Bar, Level, LevelTracker, in_any

LONG, SHORT = 1, -1


@dataclass(frozen=True)
class Signal:
    time: datetime  # close time of the confirming bar; earliest possible entry
    direction: int
    entry_ref: float
    stop: float
    target: float
    rr: float
    level: Level
    killzone: str
    reasons: tuple[str, ...]


@dataclass(frozen=True)
class Decision:
    time: datetime
    rule: str
    message: str


@dataclass
class _Sweep:
    level: Level
    direction: int  # direction of the trade the sweep would set up
    extreme: float
    bars_waited: int = 0


@dataclass
class TimeAndPriceStrategy:
    config: StrategyConfig
    instrument: InstrumentConfig
    decisions: list[Decision] = field(default_factory=list)
    _tracker: LevelTracker = field(init=False)
    _spent: set[str] = field(default_factory=set)
    _pending: list[_Sweep] = field(default_factory=list)
    _signals_today: int = 0

    def __post_init__(self) -> None:
        self._tracker = LevelTracker(self.config)

    def _log(self, ts: datetime, rule: str, msg: str) -> None:
        self.decisions.append(Decision(ts, rule, msg))

    def _fmt(self, price: float) -> str:
        decimals = max(0, len(f"{self.instrument.pip_size:.10f}".rstrip("0").split(".")[1]) + 1)
        return f"{price:.{decimals}f}"

    def on_bar(self, bar: Bar) -> Signal | None:
        cfg, pip = self.config, self.instrument.pip_size
        close_time = bar.time + timedelta(minutes=cfg.timeframe_minutes)

        if self._tracker.update(bar):
            self._spent.clear()
            self._pending.clear()
            self._signals_today = 0
        levels = [lv for lv in self._tracker.levels() if lv.name not in self._spent]

        kz = in_any(cfg.killzones, bar.time)
        if kz is None:
            for sweep in self._pending:
                self._log(close_time, "KZ-1", f"{sweep.level.name} sweep expired: killzone closed")
            self._pending.clear()
            if cfg.invalidate_levels_taken_outside_killzone:
                for lv in levels:
                    if (lv.side == "high" and bar.high > lv.price) or (lv.side == "low" and bar.low < lv.price):
                        self._spent.add(lv.name)
                        self._log(close_time, "TP-2", f"{lv.name} {self._fmt(lv.price)} taken outside killzone; spent")
            return None

        confirmed: list[_Sweep] = []

        # TP-4: an earlier sweep confirms when a bar closes back inside the level.
        still_pending: list[_Sweep] = []
        for sweep in self._pending:
            if sweep.direction == SHORT:
                sweep.extreme = max(sweep.extreme, bar.high)
                inside = bar.close < sweep.level.price
            else:
                sweep.extreme = min(sweep.extreme, bar.low)
                inside = bar.close > sweep.level.price
            sweep.bars_waited += 1
            if inside:
                confirmed.append(sweep)
            elif sweep.bars_waited >= cfg.max_confirm_bars:
                self._log(close_time, "TP-4", f"{sweep.level.name} sweep expired: no close back inside in {cfg.max_confirm_bars} bars")
            else:
                still_pending.append(sweep)
        self._pending = still_pending

        # TP-3: a fresh sweep of a level that is not yet spent.
        threshold = cfg.min_sweep_pips * pip
        for lv in levels:
            if lv.side == "high" and bar.high >= lv.price + threshold:
                sweep = _Sweep(lv, SHORT, bar.high)
                inside = bar.close < lv.price
            elif lv.side == "low" and bar.low <= lv.price - threshold:
                sweep = _Sweep(lv, LONG, bar.low)
                inside = bar.close > lv.price
            else:
                continue
            self._spent.add(lv.name)
            depth = abs(sweep.extreme - lv.price) / pip
            self._log(close_time, "TP-3", f"{lv.name} {self._fmt(lv.price)} swept by {depth:.1f} pips in {kz.name} killzone")
            (confirmed if inside else self._pending).append(sweep)

        for sweep in confirmed:
            if self._signals_today >= cfg.max_signals_per_day:
                self._log(close_time, "RK-3", f"{sweep.level.name} setup skipped: max {cfg.max_signals_per_day} signal(s) per day reached")
                continue
            signal = self._build_signal(sweep, bar, close_time, kz.name)
            if signal is not None:
                self._signals_today += 1
                return signal
        return None

    def _build_signal(self, sweep: _Sweep, bar: Bar, close_time: datetime, kz_name: str) -> Signal | None:
        cfg, pip = self.config, self.instrument.pip_size
        d = sweep.direction
        entry = bar.close
        stop = sweep.extreme - d * cfg.stop_buffer_pips * pip
        risk = (entry - stop) * d
        risk_pips = risk / pip
        if risk_pips < cfg.min_stop_pips or risk_pips > cfg.max_stop_pips:
            self._log(close_time, "RK-1", f"{sweep.level.name} setup rejected: stop {risk_pips:.1f} pips outside [{cfg.min_stop_pips}, {cfg.max_stop_pips}]")
            return None

        target_reason: str
        if cfg.target_mode == "opposite_level":
            # TG-1: the nearest opposing liquidity is the draw on price.
            side = "low" if d == SHORT else "high"
            opposing = [lv for lv in self._tracker.levels() if lv.side == side and (lv.price - entry) * d > 0]
            if not opposing:
                self._log(close_time, "TG-1", f"{sweep.level.name} setup rejected: no opposing liquidity to target")
                return None
            draw = min(opposing, key=lambda lv: abs(lv.price - entry))
            target = draw.price
            target_reason = f"TG-1 target {draw.name} {self._fmt(target)}"
        elif cfg.target_mode == "rr":
            target = entry + d * cfg.target_rr * risk
            target_reason = f"TG-1 target fixed {cfg.target_rr}R {self._fmt(target)}"
        else:
            raise ValueError(f"Unknown target_mode {cfg.target_mode!r}")

        rr = (target - entry) * d / risk
        if rr < cfg.min_rr:
            self._log(close_time, "TG-2", f"{sweep.level.name} setup rejected: {rr:.2f}R below minimum {cfg.min_rr}R")
            return None

        side = "SHORT" if d == SHORT else "LONG"
        reasons = (
            f"KZ-1 inside {kz_name} killzone",
            f"TP-3 swept {sweep.level.name} {self._fmt(sweep.level.price)} to {self._fmt(sweep.extreme)}",
            f"TP-4 closed back inside at {self._fmt(entry)}",
            f"RK-1 stop {self._fmt(stop)}, {cfg.stop_buffer_pips} pips beyond sweep extreme ({risk_pips:.1f} pips risk)",
            target_reason,
            f"TG-2 {rr:.2f}R >= {cfg.min_rr}R",
        )
        self._log(close_time, "SIGNAL", f"{side} after {sweep.level.name} sweep, {rr:.2f}R")
        return Signal(close_time, d, entry, stop, target, rr, sweep.level, kz_name, reasons)
