"""
Main daily runner — OpenClaw calls this every morning.
1. Screen halal universe (cached, refresh weekly)
2. Generate signals for all halal stocks
3. Execute buys/sells
4. Take portfolio snapshot
5. Print summary (OpenClaw formats and sends to Telegram)
"""
import sys
import os
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(__file__))

from db import init_db, get_conn
from screen import screen_all, get_halal_universe
from signal import get_signal, rank_buy_signals
from execute import get_portfolio, execute_buy, execute_sell, take_snapshot


def should_refresh_screener() -> bool:
    conn = get_conn()
    row = conn.execute(
        "SELECT cached_at FROM screener_cache ORDER BY cached_at DESC LIMIT 1"
    ).fetchone()
    conn.close()
    if not row:
        return True
    cached = datetime.fromisoformat(row["cached_at"])
    return datetime.now() - cached > timedelta(days=7)


def run():
    print(f"\n{'='*50}")
    print(f"SHARIA TRADER — {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"{'='*50}\n")

    init_db()

    # 1. Refresh screener weekly
    if should_refresh_screener():
        print("Refreshing Sharia screener (weekly)...")
        screen_all()
    else:
        print("Using cached screener (< 7 days old)\n")

    halal = get_halal_universe()
    print(f"Halal universe: {len(halal)} stocks\n")

    # 2. Generate signals
    portfolio = get_portfolio()
    held = set(portfolio["positions"].keys())
    print(f"Current positions: {len(held)}/{10}")
    print(f"Cash available:    £{portfolio['cash']:,.2f}\n")

    signals = []
    print("Generating signals...")
    for ticker in halal:
        s = get_signal(ticker, held)
        signals.append(s)
        if s["action"] != "HOLD":
            print(f"  {ticker:12} → {s['action']} @ {s['price']:.2f} — {s['reason']}")

    # 3. Execute sells first
    sells = [s for s in signals if s["action"] == "SELL"]
    for s in sells:
        result = execute_sell(s["ticker"], s["price"], s["reason"])
        if result:
            pnl_str = f"+£{result['pnl']:.2f}" if result["pnl"] >= 0 else f"-£{abs(result['pnl']):.2f}"
            print(f"\n  SOLD  {result['ticker']} | {result['shares']:.4f} shares @ £{result['price']:.2f} | P&L: {pnl_str}")

    # 4. Execute buys (top ranked by momentum, up to 10 positions)
    portfolio = get_portfolio()
    held = set(portfolio["positions"].keys())
    buys = rank_buy_signals(signals)
    slots_available = 10 - len(held)

    for s in buys[:slots_available]:
        if s["ticker"] in held:
            continue
        result = execute_buy(s["ticker"], s["price"], s["reason"])
        if result:
            print(f"\n  BOUGHT {result['ticker']} | {result['shares']:.4f} shares @ £{result['price']:.2f} | Cost: £{result['cost']:.2f}")

    # 5. Snapshot
    total = take_snapshot()

    print(f"\n{'='*50}")
    print(f"Portfolio value: £{total:,.2f}")
    print(f"Return:          {((total / 10000) - 1) * 100:+.2f}%")
    print(f"{'='*50}\n")


if __name__ == "__main__":
    run()
