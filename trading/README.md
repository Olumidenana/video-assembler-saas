# ICT Time-and-Price trading system

A transparent, rules-based implementation of the proposal's single strategy:

1. **Killzone**: look for setups only inside fixed New York-time windows.
2. **Time and Price**: inside the window, wait for price to sweep a reference level
   (prior-day or Asia-range high/low), then close back inside it. Enter on the next bar.
3. **Fundamentals filter**: no entries around high-impact news, and flatten before it.
4. **Hard risk limits**: fixed % risk per trade, daily/weekly loss floors, a
   consecutive-loss halt and trade-count caps. Nothing can override them.

Deterministic, no machine learning: every signal carries the rule IDs that produced it
([RULES.md](RULES.md)). The backtester and the live runner call the *same* strategy and
risk code, so what you validate is exactly what trades.

The core is pure Python 3.11+ standard library. The only optional dependency is
`MetaTrader5`, used for live trading.

## Quick start

```bash
cd trading
python -m unittest discover -s tests -t .          # test suite
python -m ict_trader demo --report demo.html       # whole pipeline on synthetic data
```

`demo` uses a random walk that has no edge by construction, so it **should** lose a
little to costs. If a configuration looks profitable on it, that configuration is overfit.

## Validation pipeline (proposal §3)

Export M5 history from MT5 (or any source) to CSV with `time,open,high,low,close[,volume]`
columns, and an economic calendar to CSV (see `examples/calendar.example.csv`).

```bash
# 1. Backtest, with an HTML report showing every trade and the rule behind it
python -m ict_trader --config examples/config.example.toml backtest \
    --data data/EURUSD_M5.csv --tz UTC --news data/calendar.csv --report reports/eurusd.html

# 2. Walk-forward: tune on 6 months, test on the next unseen month, roll forward
python -m ict_trader --config examples/config.example.toml walkforward \
    --data data/EURUSD_M5.csv --news data/calendar.csv --grid examples/grid.example.json

# 3. Demo account, dry run (logs what it would do, sends nothing)
python -m ict_trader --config my.toml live --news data/calendar.csv

# 4. Demo account, sending orders
python -m ict_trader --config my.toml live --news data/calendar.csv --execute
```

Only the **out-of-sample** walk-forward numbers count. The report and CLI print a
warning unless there are at least 30 trades and mean R is more than about two
standard errors above zero.

> **Timezones matter.** MT5 CSV exports are in broker server time, often UTC+2/+3.
> Pass `--tz` (e.g. `--tz Europe/Athens`, or the IANA zone matching your broker) or
> every killzone will be shifted by hours.

## Going live

Live trading runs on Windows with the MT5 terminal installed (a Windows VPS):

```powershell
pip install MetaTrader5
$env:MT5_LOGIN="..."; $env:MT5_PASSWORD="..."; $env:MT5_SERVER="..."
python -m ict_trader --config my.toml live --news calendar.csv --execute
```

Safeguards:
- Dry run unless `--execute`; refuses a real-money account unless `--allow-real-account`.
- Refuses to start without a news calendar while the news filter is enabled.
- Historical bars only warm up levels. Signals older than `live.max_signal_age_seconds` are ignored.
- Reward:risk is re-checked at the live price before every order.
- Create a file named `STOP` (configurable) to flatten all positions and stop.
- Every decision, entry and exit is written to `journal.sqlite`.

The news calendar must be refreshed (e.g. weekly) from your calendar provider.

## Layout

| Path | Purpose |
|------|---------|
| `ict_trader/config.py` | All tunable rules (TOML-loadable) |
| `ict_trader/sessions.py` | NY session clock, DST-safe killzones, look-ahead-free reference levels |
| `ict_trader/strategy.py` | Sweep-and-reverse state machine with an audit log |
| `ict_trader/news.py` | Economic-calendar blackout filter |
| `ict_trader/risk.py` | Hard limits and lot sizing |
| `ict_trader/backtest.py` | Conservative bar-by-bar simulator (spread, commission, stop-first) |
| `ict_trader/walkforward.py` | Rolling out-of-sample validation |
| `ict_trader/report.py` | HTML performance dashboard |
| `ict_trader/live.py`, `broker/mt5.py` | Live/demo execution on MetaTrader 5 |

## Not yet built

- **Rule extraction from the trader's YouTube content** (proposal §3, step 1). Defaults
  in `RULES.md` are generic ICT conventions until confirmed with the trader.
- Comparing the engine against the trader's own trade journal.
- Live monitoring dashboard over `journal.sqlite`. Backtests already produce an HTML report.
- Additional confirmation types (market-structure shift, FVG) if the trader uses them.

## Expectations

No system can guarantee profit, and most retail FX/CFD accounts lose money. What this
code guarantees is that the rules are explicit, the tests are honest, and nothing reaches
live capital without passing walk-forward and demo stages first.
