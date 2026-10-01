import os
import tempfile
import unittest
from dataclasses import replace
from datetime import time, timedelta, timezone

from ict_trader.backtest import Backtester
from ict_trader.broker.base import BrokerPosition, SymbolSpec
from ict_trader.config import Config, LiveConfig, NewsConfig, RiskConfig, load_config
from ict_trader.data import synthetic_bars
from ict_trader.live import Journal, LiveRunner
from ict_trader.news import NewsEvent, NewsFilter
from ict_trader.risk import RiskManager, lots_for_risk
from ict_trader.sessions import utc
from ict_trader.strategy import SHORT
from ict_trader.walkforward import walk_forward

from .helpers import ny_bar, pdh_sweep, prior_day, quiet_open, simple_config

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def setup_bars():  # type: ignore[no-untyped-def]
    return prior_day() + quiet_open() + [pdh_sweep(), ny_bar("2026-06-03 03:05", 1.1045, 1.1046, 1.1040, 1.1042)]


class BacktestTests(unittest.TestCase):
    def test_short_hits_target(self):
        bars = setup_bars() + [ny_bar("2026-06-03 03:10", 1.1042, 1.1043, 1.1015, 1.1018)]
        result = Backtester(simple_config()).run(bars)
        self.assertEqual(len(result.trades), 1)
        t = result.trades[0]
        self.assertEqual(t.direction, SHORT)
        self.assertEqual(t.exit_reason, "TP target")
        self.assertAlmostEqual(t.entry_price, 1.1045)  # filled at next bar's open (bid)
        self.assertAlmostEqual(t.lots, 0.41)  # floor(50 / (12 pips * 100k) / 0.01) * 0.01
        self.assertAlmostEqual(t.pnl, 0.0024 * 41_000 - 7 * 0.41, places=6)

    def test_stop_assumed_first_when_bar_touches_both(self):
        bars = setup_bars() + [ny_bar("2026-06-03 03:10", 1.1042, 1.1060, 1.1015, 1.1030)]
        t = Backtester(simple_config()).run(bars).trades[0]
        self.assertEqual(t.exit_reason, "SL stop loss")
        self.assertLess(t.r_multiple, -1.0)  # commission makes a full stop worse than -1R

    def test_news_blocks_entry(self):
        cfg = simple_config()
        news = NewsFilter(cfg.news, cfg.instrument, [NewsEvent(utc(2026, 6, 3, 7, 20), "USD", "high", "Test")])
        result = Backtester(cfg, news).run(setup_bars())
        self.assertEqual(result.trades, [])
        self.assertTrue(any(d.rule == "NF-1" for d in result.decisions))

    def test_flatten_time_closes_trade(self):
        cfg = simple_config(flatten_time=time(3, 30))
        bars = setup_bars() + [ny_bar(f"2026-06-03 03:{m}", 1.1042, 1.1044, 1.1038, 1.1040) for m in (10, 15, 20, 25, 30)]
        t = Backtester(cfg).run(bars).trades[0]
        self.assertEqual(t.exit_reason, "EX-1 flatten time")

    def test_demo_pipeline_runs_without_lookahead_crash(self):
        result = Backtester(Config()).run(synthetic_bars(utc(2025, 1, 5), days=40))
        self.assertGreater(len(result.equity_curve), 1000)
        for t in result.trades:
            self.assertGreater(t.exit_time, t.entry_time - timedelta(seconds=1))


class RiskTests(unittest.TestCase):
    def test_budget_never_crosses_daily_floor(self):
        rm = RiskManager(RiskConfig(risk_per_trade_pct=1.0, max_daily_loss_pct=2.0), 10_000)
        rm.mark(utc(2026, 6, 3, 7), 10_000)
        rm.mark(utc(2026, 6, 3, 8), 9_850)
        decision = rm.check(open_positions=0)
        self.assertTrue(decision.allowed)
        self.assertAlmostEqual(decision.risk_amount, 50.0)  # 9850 - 9800 floor, not 98.5

    def test_halts_at_daily_limit_and_resets_next_day(self):
        rm = RiskManager(RiskConfig(max_daily_loss_pct=2.0, max_weekly_loss_pct=10.0), 10_000)
        rm.mark(utc(2026, 6, 3, 7), 10_000)
        rm.mark(utc(2026, 6, 3, 8), 9_790)
        self.assertFalse(rm.check(0).allowed)
        rm.mark(utc(2026, 6, 4, 7), 9_790)
        self.assertTrue(rm.check(0).allowed)

    def test_consecutive_losses_halt(self):
        rm = RiskManager(RiskConfig(max_consecutive_losses=2, max_trades_per_day=10), 10_000)
        rm.mark(utc(2026, 6, 3, 7), 10_000)
        rm.record_close(-10)
        rm.record_close(-10)
        self.assertIn("RK-4", rm.check(0).reason)

    def test_lot_rounding_never_exceeds_budget(self):
        self.assertAlmostEqual(lots_for_risk(50, 0.0012, 100_000, 0.01, 0.01, 50), 0.41)
        self.assertEqual(lots_for_risk(4, 0.0050, 100_000, 0.01, 0.01, 50), 0.0)  # min lot too big
        self.assertEqual(lots_for_risk(10_000, 0.0010, 100_000, 0.01, 0.01, 2.0), 2.0)


class NewsTests(unittest.TestCase):
    def test_window_and_currency_matching(self):
        cfg = Config()
        events = [
            NewsEvent(utc(2026, 6, 5, 12, 30), "USD", "high", "NFP"),
            NewsEvent(utc(2026, 6, 5, 9, 0), "JPY", "high", "Irrelevant"),
            NewsEvent(utc(2026, 6, 5, 10, 0), "EUR", "low", "Minor"),
        ]
        nf = NewsFilter(cfg.news, cfg.instrument, events)
        self.assertIsNotNone(nf.blocking_event(utc(2026, 6, 5, 12, 0)))
        self.assertIsNotNone(nf.blocking_event(utc(2026, 6, 5, 13, 0)))
        self.assertIsNone(nf.blocking_event(utc(2026, 6, 5, 13, 1)))
        self.assertIsNone(nf.blocking_event(utc(2026, 6, 5, 9, 0)))
        self.assertIsNone(nf.blocking_event(utc(2026, 6, 5, 10, 0)))
        self.assertIsNotNone(nf.should_flatten(utc(2026, 6, 5, 12, 25)))
        self.assertIsNone(nf.should_flatten(utc(2026, 6, 5, 12, 0)))


class FakeBroker:
    def __init__(self, bars):  # type: ignore[no-untyped-def]
        self.bars = bars
        self.visible = 0
        self.orders: list[tuple] = []
        self.positions: list[BrokerPosition] = []

    def connect(self): pass
    def is_real_account(self): return False
    def closed_bars(self, count): return self.bars[: self.visible][-count:]
    def equity(self): return 10_000.0
    def symbol_spec(self): return SymbolSpec(1.1044, 1.10448, 100_000, 0.01, 0.01, 100, 5)
    def open_positions(self): return list(self.positions)
    def realized_pnl(self, ticket): return 25.0
    def close_position(self, position, comment): self.positions.remove(position)

    def market_order(self, direction, lots, stop, target, comment):  # type: ignore[no-untyped-def]
        self.orders.append((direction, lots, stop, target))
        self.positions.append(BrokerPosition(1, direction, lots, 1.1044, stop, target, utc(2026, 6, 3, 7, 5)))
        return 1


class LiveTests(unittest.TestCase):
    def _runner(self, execute: bool, tmp: str):  # type: ignore[no-untyped-def]
        cfg = replace(simple_config(), news=NewsConfig(enabled=False), live=LiveConfig(kill_switch_file=os.path.join(tmp, "STOP")))
        bars = setup_bars()[:3]
        broker = FakeBroker(bars)
        broker.visible = 2  # warm up on the prior-day bars only
        now = [bars[2].time + timedelta(minutes=5, seconds=3)]
        runner = LiveRunner(cfg, broker, None, Journal(os.path.join(tmp, "j.sqlite")), dry_run=not execute, clock=lambda: now[0])
        runner.start()
        broker.visible = 3
        return runner, broker, now

    def test_dry_run_sends_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            runner, broker, _ = self._runner(False, tmp)
            self.assertTrue(runner.poll())
            self.assertEqual(broker.orders, [])
            rows = runner.journal.db.execute("SELECT rule FROM decisions WHERE rule = 'DRY-RUN'").fetchall()
            self.assertEqual(len(rows), 1)

    def test_execute_places_one_order_then_books_close(self):
        with tempfile.TemporaryDirectory() as tmp:
            runner, broker, now = self._runner(True, tmp)
            runner.poll()
            runner.poll()  # same bar again must not re-trade
            self.assertEqual(len(broker.orders), 1)
            direction, lots, stop, _ = broker.orders[0]
            self.assertEqual(direction, SHORT)
            self.assertAlmostEqual(stop, 1.1057)
            broker.positions.clear()  # broker hit SL/TP
            runner.poll()
            pnl = runner.journal.db.execute("SELECT pnl FROM trades WHERE ticket = 1").fetchone()[0]
            self.assertEqual(pnl, 25.0)

    def test_kill_switch_flattens_and_stops(self):
        with tempfile.TemporaryDirectory() as tmp:
            runner, broker, _ = self._runner(True, tmp)
            runner.poll()
            open(os.path.join(tmp, "STOP"), "w").close()
            self.assertFalse(runner.poll())
            self.assertEqual(broker.positions, [])

    def test_stale_signal_ignored(self):
        with tempfile.TemporaryDirectory() as tmp:
            runner, broker, now = self._runner(True, tmp)
            now[0] += timedelta(hours=1)
            runner.poll()
            self.assertEqual(broker.orders, [])

    def test_refuses_to_run_without_calendar(self):
        with self.assertRaises(ValueError):
            LiveRunner(Config(), FakeBroker([]), None, Journal(":memory:"))


class ValidationTests(unittest.TestCase):
    def test_walk_forward_produces_out_of_sample_windows(self):
        bars = synthetic_bars(utc(2025, 1, 1), days=125)
        result = walk_forward(bars, Config(), {"min_rr": [1.5, 2.0]}, train_months=2, test_months=1, min_trades=1)
        self.assertGreaterEqual(len(result.windows), 2)
        for w in result.windows:
            self.assertEqual(w.test_start.tzinfo, timezone.utc)
        for t in result.oos_trades:
            self.assertGreaterEqual(t.entry_time, result.windows[0].test_start)

    def test_example_config_loads(self):
        cfg = load_config(os.path.join(ROOT, "examples", "config.example.toml"))
        self.assertEqual(cfg.instrument.symbol, "EURUSD")
        self.assertEqual([k.name for k in cfg.strategy.killzones], ["london", "new_york"])


if __name__ == "__main__":
    unittest.main()
