# Rule register

Every decision the system makes cites one of these IDs in its journal, report and
trade reasons. The **Config** column is where the value lives; the **Status**
column is to be filled in during the rule-confirmation session with the trader.
Defaults are generic ICT conventions, **not** the trader's confirmed rules.

| ID | Rule | Config | Default | Status |
|----|------|--------|---------|--------|
| KZ-1 | Entries only inside a killzone window (NY time). | `strategy.killzones` | London 02:00–05:00, NY 07:00–10:00 | ☐ confirm |
| TP-1 | Reference levels: prior trading day high/low and the high/low of each reference range once it closes. | `strategy.use_prior_day_levels`, `strategy.reference_ranges`, `strategy.day_rollover` | PDH/PDL with 17:00 rollover; Asia 20:00–00:00 | ☐ confirm |
| TP-2 | A level already traded through outside a killzone that day is spent and not traded. | `strategy.invalidate_levels_taken_outside_killzone` | on | ☐ confirm |
| TP-3 | Sweep: price trades beyond a level by at least N pips inside a killzone. Each level is used once per day. | `strategy.min_sweep_pips` | 0.5 | ☐ confirm |
| TP-4 | Reversal confirmation: a candle closes back inside the level within N bars of the sweep. Entry at the next bar's open. | `strategy.max_confirm_bars`, `strategy.timeframe_minutes` | 3 bars of 5m | ☐ confirm |
| RK-1 | Stop beyond the sweep extreme plus a buffer; skip if stop is narrower/wider than limits. Position sized to risk a fixed % of equity. | `strategy.stop_buffer_pips`, `strategy.min_stop_pips`, `strategy.max_stop_pips`, `risk.risk_per_trade_pct` | 1 pip; 3–25 pips; 0.5% | ☐ confirm |
| TG-1 | Target: nearest opposing liquidity level (draw on liquidity), or a fixed R multiple. | `strategy.target_mode`, `strategy.target_rr` | opposing level | ☐ confirm |
| TG-2 | Skip if reward:risk (re-checked at the actual fill) is below minimum. | `strategy.min_rr` | 1.5R | ☐ confirm |
| RK-2 | Daily and weekly loss limits as equity floors; no trade may risk more than the distance to a floor. Halt when hit. | `risk.max_daily_loss_pct`, `risk.max_weekly_loss_pct` | 2% / 4% | ☐ confirm |
| RK-3 | Max signals/trades per day and max open positions. | `strategy.max_signals_per_day`, `risk.max_trades_per_day`, `risk.max_open_positions` | 1 / 2 / 1 | ☐ confirm |
| RK-4 | Stop for the day after N consecutive losses. | `risk.max_consecutive_losses` | 3 | ☐ confirm |
| NF-1 | No entries within a window around high-impact news for either currency of the pair. | `news.*` | 30 min before / after | ☐ confirm |
| NF-2 | Close open trades shortly before a high-impact release. | `news.flatten_minutes_before` | 5 min | ☐ confirm |
| EX-1 | Flatten any open trade at a fixed NY time. | `strategy.flatten_time` | 16:00 | ☐ confirm |

## Questions for the confirmation session

These are the places where ICT practitioners differ. The trader's own answer goes into config.

1. Which killzones do you actually trade, and which pairs/indices in each?
2. Which levels count: prior day H/L, Asia range, London range (for the NY session), prior week H/L, midnight open?
3. Is a level that was already taken before the killzone still valid? (TP-2)
4. What confirms the reversal: a close back inside the level, a market-structure shift on a lower timeframe, or displacement with a fair value gap? (Only the first is implemented. The others are additions, not rewrites.)
5. Which timeframe do you confirm on (1m / 5m / 15m)?
6. Where does the stop go, and where is the target: opposing liquidity, a fixed R, or partials?
7. Do you trade on high-impact news days at all, or skip the whole day?
8. Exact risk per trade, daily and weekly loss limits, and when you stop for the day.
