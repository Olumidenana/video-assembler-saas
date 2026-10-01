"""Self-contained HTML performance report: equity, stats, and every trade's reasons."""

from __future__ import annotations

import html
from datetime import datetime
from typing import Any

from .metrics import Trade
from .strategy import LONG, Decision


def _equity_svg(curve: list[tuple[datetime, float]], width: int = 900, height: int = 220) -> str:
    if len(curve) < 2:
        return "<p class='muted'>Not enough data for an equity curve.</p>"
    step = max(1, len(curve) // 1500)
    pts = curve[::step] + [curve[-1]]
    lo, hi = min(e for _, e in pts), max(e for _, e in pts)
    span = hi - lo or 1.0
    coords = " ".join(
        f"{i / (len(pts) - 1) * width:.1f},{height - (e - lo) / span * (height - 20) - 10:.1f}" for i, (_, e) in enumerate(pts)
    )
    return (
        f"<svg viewBox='0 0 {width} {height}' preserveAspectRatio='none' role='img' aria-label='Equity curve'>"
        f"<polyline fill='none' stroke='var(--accent)' stroke-width='1.5' vector-effect='non-scaling-stroke' points='{coords}'/></svg>"
        f"<div class='axis'><span>{pts[0][0]:%Y-%m-%d}</span><span>low {lo:,.2f} · high {hi:,.2f}</span><span>{pts[-1][0]:%Y-%m-%d}</span></div>"
    )


def render_report(title: str, stats: dict[str, Any], trades: list[Trade], curve: list[tuple[datetime, float]], decisions: list[Decision]) -> str:
    e = html.escape
    tiles = [
        ("Trades", f"{stats['trades']}"),
        ("Win rate", f"{stats['win_rate_pct']:.1f}%"),
        ("Expectancy", f"{stats['expectancy_r']:+.3f}R"),
        ("Profit factor", f"{stats['profit_factor']:.2f}"),
        ("Return", f"{stats['return_pct']:+.2f}%"),
        ("Max drawdown", f"{stats['max_drawdown_pct']:.2f}%"),
    ]
    warning = "" if stats["statistically_meaningful"] else (
        "<p class='warn'>Sample too small, or edge not distinguishable from zero "
        f"(t = {stats['expectancy_t_stat']:.2f}). Do not risk capital on this result.</p>"
    )
    rows = "".join(
        f"<tr><td>{t.entry_time:%Y-%m-%d %H:%M}</td><td>{'Long' if t.direction == LONG else 'Short'}</td>"
        f"<td class='num'>{t.entry_price:.5f}</td><td class='num'>{t.exit_price:.5f}</td><td>{e(t.exit_reason)}</td>"
        f"<td class='num {'pos' if t.pnl > 0 else 'neg'}'>{t.r_multiple:+.2f}R</td>"
        f"<td><details><summary>rules</summary>{'<br>'.join(e(r) for r in t.reasons)}</details></td></tr>"
        for t in trades
    )
    log = "".join(f"<tr><td>{d.time:%Y-%m-%d %H:%M}</td><td>{e(d.rule)}</td><td>{e(d.message)}</td></tr>" for d in decisions[-500:])
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(title)}</title>
<style>
:root {{ --bg:#fafaf9; --fg:#1c1917; --muted:#78716c; --line:#e7e5e4; --card:#fff; --accent:#2563eb; --pos:#15803d; --neg:#b91c1c; --warnbg:#fef3c7; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg:#0c0a09; --fg:#f5f5f4; --muted:#a8a29e; --line:#292524; --card:#1c1917; --accent:#60a5fa; --pos:#4ade80; --neg:#f87171; --warnbg:#422006; }} }}
body {{ margin:0; background:var(--bg); color:var(--fg); font:14px/1.5 system-ui,sans-serif; }}
main {{ max-width:1000px; margin:0 auto; padding:24px 16px; }}
h1 {{ font-size:20px; margin:0 0 16px; }} h2 {{ font-size:15px; margin:28px 0 8px; }}
.tiles {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:8px; }}
.tile {{ background:var(--card); border:1px solid var(--line); border-radius:8px; padding:10px 12px; }}
.tile b {{ display:block; font-size:18px; font-variant-numeric:tabular-nums; }} .tile span, .muted, .axis {{ color:var(--muted); font-size:12px; }}
svg {{ width:100%; height:220px; background:var(--card); border:1px solid var(--line); border-radius:8px; }}
.axis {{ display:flex; justify-content:space-between; }}
.warn {{ background:var(--warnbg); padding:10px 12px; border-radius:8px; }}
.scroll {{ overflow-x:auto; }} table {{ width:100%; border-collapse:collapse; font-size:13px; }}
td, th {{ text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; }}
.num {{ text-align:right; font-variant-numeric:tabular-nums; }} .pos {{ color:var(--pos); }} .neg {{ color:var(--neg); }}
</style></head><body><main>
<h1>{e(title)}</h1>
<div class="tiles">{''.join(f"<div class='tile'><span>{k}</span><b>{v}</b></div>" for k, v in tiles)}</div>
{warning}
<h2>Equity</h2>{_equity_svg(curve)}
<h2>Trades</h2><div class="scroll"><table><tr><th>Entry (UTC)</th><th>Side</th><th class="num">Entry</th><th class="num">Exit</th><th>Exit reason</th><th class="num">Result</th><th>Why</th></tr>{rows}</table></div>
<h2>Decision log (latest 500)</h2><div class="scroll"><table><tr><th>Time (UTC)</th><th>Rule</th><th>Detail</th></tr>{log}</table></div>
</main></body></html>
"""
