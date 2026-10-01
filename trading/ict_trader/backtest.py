"""Bar-by-bar backtester.

Conventions, chosen to be conservative rather than flattering:
- Data prices are bid. Longs fill at ask (bid + spread) and exit at bid;
  shorts fill at bid and exit at ask.
- A signal on bar N fills at the open of bar N+1. Nothing sees the future.
- If a bar touches both stop and target, the stop is assumed to hit first.
- A gap through the stop fills at the (worse) open price.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from .config import Config
from .metrics import Trade, summarize
from .news import NewsFilter
from .risk import RiskManager, lots_for_risk
from .sessions import Bar, flatten_deadline
from .strategy import LONG, Decision, Signal, TimeAndPriceStrategy


@dataclass
class _Position:
    signal: Signal
    entry_time: datetime
    entry_price: float
    lots: float
    risk_amount: float
    deadline: datetime | None


@dataclass
class BacktestResult:
    trades: list[Trade]
    equity_curve: list[tuple[datetime, float]]
    decisions: list[Decision]
    stats: dict[str, Any] = field(default_factory=dict)


class Backtester:
    def __init__(self, config: Config, news: NewsFilter | None = None):
        self.config = config
        self.news = news
        inst = config.instrument
        self.spread = inst.pips(inst.spread_pips)
        self.value_per_unit = inst.contract_size * inst.quote_to_account_rate

    def _exit_price(self, d: int, bid: float) -> float:
        return bid if d == LONG else bid + self.spread

    def _pnl(self, pos: _Position, exit_price: float) -> float:
        d = pos.signal.direction
        gross = (exit_price - pos.entry_price) * d * pos.lots * self.value_per_unit
        return gross - self.config.instrument.commission_per_lot * pos.lots

    def run(self, bars: list[Bar], trade_from: datetime | None = None, trade_until: datetime | None = None) -> BacktestResult:
        """Run over bars. Bars before trade_from only warm up the levels."""
        cfg = self.config
        strategy = TimeAndPriceStrategy(cfg.strategy, cfg.instrument)
        risk = RiskManager(cfg.risk, cfg.initial_equity, cfg.strategy.day_rollover)
        log: list[Decision] = []
        trades: list[Trade] = []
        curve: list[tuple[datetime, float]] = []
        balance = cfg.initial_equity
        pos: _Position | None = None
        pending: Signal | None = None
        tf = timedelta(minutes=cfg.strategy.timeframe_minutes)

        def close(bar_time: datetime, price: float, reason: str) -> None:
            nonlocal pos, balance
            assert pos is not None
            pnl = self._pnl(pos, price)
            balance += pnl
            risk.record_close(pnl)
            s = pos.signal
            trades.append(Trade(
                cfg.instrument.symbol, s.direction, pos.entry_time, pos.entry_price, s.stop, s.target,
                pos.lots, pos.risk_amount, bar_time, price, reason, pnl,
                pnl / pos.risk_amount if pos.risk_amount else 0.0, s.reasons,
            ))
            pos = None

        def equity_at(bid: float) -> float:
            return balance + (self._pnl(pos, self._exit_price(pos.signal.direction, bid)) if pos else 0.0)

        for bar in bars:
            risk.mark(bar.time, equity_at(bar.open))

            # Forced exits at the open: end-of-day flatten (EX-1) and news (NF-2).
            if pos is not None:
                if pos.deadline is not None and bar.time >= pos.deadline:
                    close(bar.time, self._exit_price(pos.signal.direction, bar.open), "EX-1 flatten time")
                elif self.news and (ev := self.news.should_flatten(bar.time)):
                    close(bar.time, self._exit_price(pos.signal.direction, bar.open), f"NF-2 flatten before {ev.currency} {ev.title}")

            if pending is not None:
                if pos is None:
                    pos = self._try_open(pending, bar, risk, log)
                pending = None

            if pos is not None:
                self._intrabar_exit(pos, bar, close)

            signal = strategy.on_bar(bar)
            if signal is not None:
                if (trade_from and signal.time < trade_from) or (trade_until and signal.time >= trade_until):
                    pass
                elif pos is not None:
                    log.append(Decision(signal.time, "RK-3", "signal ignored: position already open"))
                else:
                    pending = signal

            curve.append((bar.time + tf, equity_at(bar.close)))

        if pos is not None and bars:
            last = bars[-1]
            close(last.time + tf, self._exit_price(pos.signal.direction, last.close), "END end of data")
            curve.append((last.time + tf, balance))

        decisions = sorted(strategy.decisions + log, key=lambda d: d.time)
        if trade_from:
            curve = [(t, e) for t, e in curve if t >= trade_from]
        result = BacktestResult(trades, curve, decisions)
        result.stats = summarize(trades, curve, curve[0][1] if curve else cfg.initial_equity)
        return result

    def _try_open(self, sig: Signal, bar: Bar, risk: RiskManager, log: list[Decision]) -> _Position | None:
        d = sig.direction
        if self.news and (ev := self.news.blocking_event(bar.time)):
            log.append(Decision(bar.time, "NF-1", f"entry blocked: {ev.impact} {ev.currency} {ev.title} at {ev.time:%H:%M}Z"))
            return None
        decision = risk.check(open_positions=0)
        if not decision.allowed:
            log.append(Decision(bar.time, decision.reason.split()[0], f"entry blocked: {decision.reason}"))
            return None
        fill = bar.open + self.spread if d == LONG else bar.open
        stop_dist = (fill - sig.stop) * d
        reward = (sig.target - fill) * d
        if stop_dist <= 0 or reward <= 0:
            log.append(Decision(bar.time, "RK-1", "entry skipped: price gapped past stop or target"))
            return None
        rr = reward / stop_dist
        if rr < self.config.strategy.min_rr:
            log.append(Decision(bar.time, "TG-2", f"entry skipped: {rr:.2f}R at fill below minimum"))
            return None
        inst = self.config.instrument
        lots = lots_for_risk(decision.risk_amount, stop_dist, self.value_per_unit, inst.volume_step, inst.min_lots, self.config.risk.max_lots)
        if lots <= 0:
            log.append(Decision(bar.time, "RK-1", "entry skipped: minimum lot would exceed risk budget"))
            return None
        risk.record_open()
        log.append(Decision(bar.time, "ENTRY", f"{'LONG' if d == LONG else 'SHORT'} {lots} lots at {fill:.5f}; {decision.reason}"))
        return _Position(sig, bar.time, fill, lots, lots * stop_dist * self.value_per_unit, flatten_deadline(bar.time, self.config.strategy.flatten_time))

    def _intrabar_exit(self, pos: _Position, bar: Bar, close) -> None:  # type: ignore[no-untyped-def]
        s, d = pos.signal, pos.signal.direction
        # Exit-side prices for this bar: bid for longs, ask for shorts.
        adj = 0.0 if d == LONG else self.spread
        o, hi, lo = bar.open + adj, bar.high + adj, bar.low + adj
        if d == LONG:
            if o <= s.stop:
                close(bar.time, o, "SL gap through stop")
            elif o >= s.target:
                close(bar.time, o, "TP gap through target")
            elif lo <= s.stop:
                close(bar.time, s.stop, "SL stop loss")
            elif hi >= s.target:
                close(bar.time, s.target, "TP target")
        else:
            if o >= s.stop:
                close(bar.time, o, "SL gap through stop")
            elif o <= s.target:
                close(bar.time, o, "TP gap through target")
            elif hi >= s.stop:
                close(bar.time, s.stop, "SL stop loss")
            elif lo <= s.target:
                close(bar.time, s.target, "TP target")
