"""Hard risk limits. Nothing upstream can override these.

Daily and weekly limits are enforced as equity floors: a new trade may only
risk the smaller of the per-trade budget and the distance to each floor, so
even a full stop-out cannot push equity through a limit (gaps and slippage
aside). Once a floor is touched, trading halts until the period rolls.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, datetime, time

from .config import RiskConfig
from .sessions import trading_day


@dataclass
class RiskDecision:
    allowed: bool
    risk_amount: float
    reason: str


class RiskManager:
    def __init__(self, config: RiskConfig, equity: float, day_rollover: time = time(17, 0)):
        self.config = config
        self.day_rollover = day_rollover
        self.equity = equity
        self._day: date | None = None
        self._week: tuple[int, int] | None = None
        self.day_start_equity = equity
        self.week_start_equity = equity
        self.trades_today = 0
        self.consecutive_losses = 0

    def mark(self, ts: datetime, equity: float) -> None:
        """Record current (mark-to-market) equity and roll day/week."""
        day = trading_day(ts, self.day_rollover)
        week = tuple(day.isocalendar())[:2]
        if day != self._day:
            self._day = day
            self.day_start_equity = equity
            self.trades_today = 0
            self.consecutive_losses = 0
        if week != self._week:
            self._week = week  # type: ignore[assignment]
            self.week_start_equity = equity
        self.equity = equity

    @property
    def daily_floor(self) -> float:
        return self.day_start_equity * (1 - self.config.max_daily_loss_pct / 100)

    @property
    def weekly_floor(self) -> float:
        return self.week_start_equity * (1 - self.config.max_weekly_loss_pct / 100)

    def check(self, open_positions: int) -> RiskDecision:
        c = self.config
        if open_positions >= c.max_open_positions:
            return RiskDecision(False, 0.0, f"RK-3 max {c.max_open_positions} open position(s)")
        if self.trades_today >= c.max_trades_per_day:
            return RiskDecision(False, 0.0, f"RK-3 max {c.max_trades_per_day} trade(s) per day reached")
        if self.consecutive_losses >= c.max_consecutive_losses:
            return RiskDecision(False, 0.0, f"RK-4 {self.consecutive_losses} consecutive losses; halted for the day")
        if self.equity <= self.daily_floor:
            return RiskDecision(False, 0.0, f"RK-2 daily loss limit {c.max_daily_loss_pct}% hit; halted for the day")
        if self.equity <= self.weekly_floor:
            return RiskDecision(False, 0.0, f"RK-2 weekly loss limit {c.max_weekly_loss_pct}% hit; halted for the week")
        budget = min(
            self.equity * c.risk_per_trade_pct / 100,
            self.equity - self.daily_floor,
            self.equity - self.weekly_floor,
        )
        return RiskDecision(True, budget, f"RK-1 risking {budget:.2f} ({budget / self.equity * 100:.2f}% of equity)")

    def record_open(self) -> None:
        self.trades_today += 1

    def record_close(self, pnl: float) -> None:
        self.consecutive_losses = self.consecutive_losses + 1 if pnl < 0 else 0


def lots_for_risk(
    risk_amount: float,
    stop_distance: float,
    value_per_price_unit_per_lot: float,
    volume_step: float,
    min_lots: float,
    max_lots: float,
) -> float:
    """Largest lot size, rounded down to the broker step, that risks at most risk_amount.

    Returns 0 when even the minimum lot would exceed the budget: the trade is
    skipped rather than over-risked.
    """
    if stop_distance <= 0 or value_per_price_unit_per_lot <= 0:
        return 0.0
    raw = risk_amount / (stop_distance * value_per_price_unit_per_lot)
    lots = math.floor(raw / volume_step + 1e-9) * volume_step
    lots = min(lots, max_lots)
    if lots < min_lots:
        return 0.0
    return round(lots, 8)
