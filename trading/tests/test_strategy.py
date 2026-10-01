import unittest
from datetime import time

from ict_trader.config import StrategyConfig, Window
from ict_trader.sessions import LevelTracker, trading_day, utc
from ict_trader.strategy import LONG, SHORT, TimeAndPriceStrategy

from .helpers import ny_bar, pdh_sweep, prior_day, quiet_open, simple_config


def run(config, bars):  # type: ignore[no-untyped-def]
    strat = TimeAndPriceStrategy(config.strategy, config.instrument)
    signals = [s for s in (strat.on_bar(b) for b in bars) if s is not None]
    return strat, signals


class SessionTests(unittest.TestCase):
    def test_trading_day_rolls_at_1700_new_york(self):
        # 20:59 UTC = 16:59 NY (EDT) is still Monday's day; 21:00 UTC is Tuesday's.
        self.assertEqual(trading_day(utc(2026, 6, 1, 20, 59), time(17)).isoformat(), "2026-06-01")
        self.assertEqual(trading_day(utc(2026, 6, 1, 21, 0), time(17)).isoformat(), "2026-06-02")

    def test_killzone_follows_new_york_daylight_saving(self):
        london = Window("london", time(2), time(5))
        from ict_trader.sessions import in_any

        self.assertIsNotNone(in_any((london,), utc(2026, 6, 3, 6, 0)))  # summer: 02:00 EDT
        self.assertIsNone(in_any((london,), utc(2026, 1, 7, 6, 0)))  # winter: 01:00 EST
        self.assertIsNotNone(in_any((london,), utc(2026, 1, 7, 7, 0)))

    def test_window_wrapping_midnight(self):
        asia = Window("asia", time(20), time(0))
        self.assertTrue(asia.contains(time(23, 55)))
        self.assertFalse(asia.contains(time(0, 0)))
        self.assertFalse(asia.contains(time(19, 55)))

    def test_range_level_only_available_after_window_closes(self):
        tracker = LevelTracker(StrategyConfig())
        tracker.update(ny_bar("2026-06-02 20:00", 1.1, 1.1020, 1.0990, 1.1))
        tracker.update(ny_bar("2026-06-02 23:55", 1.1, 1.1030, 1.1000, 1.1))
        self.assertEqual([lv.name for lv in tracker.levels()], [])
        tracker.update(ny_bar("2026-06-03 00:00", 1.1, 1.1100, 1.0900, 1.1))
        levels = {lv.name: lv.price for lv in tracker.levels()}
        # The 00:00 bar is outside the window and must not leak into the range.
        self.assertEqual(levels, {"ASIA_H": 1.1030, "ASIA_L": 1.0990})


class StrategyTests(unittest.TestCase):
    def test_sweep_and_close_back_inside_gives_short(self):
        _, signals = run(simple_config(), prior_day() + quiet_open() + [pdh_sweep()])
        self.assertEqual(len(signals), 1)
        s = signals[0]
        self.assertEqual(s.direction, SHORT)
        self.assertEqual(s.level.name, "PDH")
        self.assertAlmostEqual(s.entry_ref, 1.1045)
        self.assertAlmostEqual(s.stop, 1.1057)  # extreme + 1 pip buffer
        self.assertAlmostEqual(s.target, 1.1021)  # 2R
        self.assertTrue(any(r.startswith("KZ-1") for r in s.reasons))

    def test_low_sweep_gives_long(self):
        bar = ny_bar("2026-06-03 08:00", 1.1010, 1.1012, 1.0994, 1.1006)
        _, signals = run(simple_config(), prior_day() + quiet_open() + [bar])
        self.assertEqual([s.direction for s in signals], [LONG])
        self.assertEqual(signals[0].killzone, "new_york")

    def test_no_signal_outside_killzone_and_level_is_spent(self):
        outside = ny_bar("2026-06-03 00:30", 1.1040, 1.1056, 1.1038, 1.1045)
        strat, signals = run(simple_config(), prior_day() + quiet_open() + [outside, pdh_sweep()])
        self.assertEqual(signals, [])
        self.assertTrue(any(d.rule == "TP-2" and "PDH" in d.message for d in strat.decisions))

    def test_delayed_confirmation_within_window(self):
        sweep_hold = ny_bar("2026-06-03 03:00", 1.1045, 1.1056, 1.1044, 1.1053)
        confirm = ny_bar("2026-06-03 03:05", 1.1053, 1.1058, 1.1040, 1.1042)
        _, signals = run(simple_config(), prior_day() + quiet_open() + [sweep_hold, confirm])
        self.assertEqual(len(signals), 1)
        self.assertAlmostEqual(signals[0].stop, 1.1059)  # extreme extended by the confirm bar

    def test_sweep_expires_without_confirmation(self):
        sweep_hold = ny_bar("2026-06-03 03:00", 1.1045, 1.1056, 1.1044, 1.1053)
        holds = [ny_bar(f"2026-06-03 03:{m:02d}", 1.1053, 1.1055, 1.1051, 1.1053) for m in (5, 10, 15)]
        late = ny_bar("2026-06-03 03:20", 1.1053, 1.1054, 1.1040, 1.1042)
        strat, signals = run(simple_config(max_confirm_bars=3), prior_day() + quiet_open() + [sweep_hold, *holds, late])
        self.assertEqual(signals, [])
        self.assertTrue(any(d.rule == "TP-4" for d in strat.decisions))

    def test_too_wide_stop_rejected(self):
        _, signals = run(simple_config(max_stop_pips=5), prior_day() + quiet_open() + [pdh_sweep()])
        self.assertEqual(signals, [])

    def test_opposite_level_target_requires_min_rr(self):
        # Target PDL 1.1000 from 1.1045 with 12 pips risk = 3.75R: accepted.
        _, signals = run(simple_config(target_mode="opposite_level"), prior_day() + quiet_open() + [pdh_sweep()])
        self.assertAlmostEqual(signals[0].target, 1.1000)
        _, signals = run(simple_config(target_mode="opposite_level", min_rr=4.0), prior_day() + quiet_open() + [pdh_sweep()])
        self.assertEqual(signals, [])

    def test_one_signal_per_day(self):
        low_sweep = ny_bar("2026-06-03 08:00", 1.1010, 1.1012, 1.0994, 1.1006)
        _, signals = run(simple_config(), prior_day() + quiet_open() + [pdh_sweep(), low_sweep])
        self.assertEqual(len(signals), 1)


if __name__ == "__main__":
    unittest.main()
