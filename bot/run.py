"""
Main daily runner — OpenClaw calls this every morning.
1. Seed halal universe (pre-screened, instant)
2. Batch fetch prices for all halal stocks
3. Generate signals
4. Execute buys/sells
5. Take portfolio snapshot
"""
import sys
import os
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))

from db import init_db, get_conn
from screen import get_halal_universe, screen_all
from strategy import get_signals_batch, rank_buy_signals
from execute import get_portfolio, execute_buy, execute_sell, take_snapshot


def run():
    print(f"\n{'='*50}")
    print(f"SHARIA TRADER — {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"{'='*50}\n")

    init_db()
    screen_all()  # instant — seeds pre-screened halal universe

    halal = get_halal_universe()
    print(f"Halal universe: {len(halal)} stocks\n")

    portfolio = get_portfolio()
    held = set(portfolio["positions"].keys())
    print(f"Positions: {len(held)}/10   Cash: £{portfolio['cash']:,.2f}\n")

    # Batch fetch + generate signals (one network call for all tickers)
    signals = get_signals_batch(halal, held)

    buys_found = [s for s in signals if s["action"] == "BUY"]
    sells_found = [s for s in signals if s["action"] == "SELL"]
    print(f"Signals: {len(buys_found)} BUY, {len(sells_found)} SELL\n")

    # Execute sells first
    for s in sells_found:
        result = execute_sell(s["ticker"], s["price"], s["reason"])
        if result:
            pnl = result["pnl"]
            sign = "+" if pnl >= 0 else "-"
            print(f"  SELL  {result['ticker']:12} @ £{result['price']:.2f}  P&L: {sign}£{abs(pnl):.2f}")

    # Execute top buys
    portfolio = get_portfolio()
    held = set(portfolio["positions"].keys())
    slots = 10 - len(held)

    for s in rank_buy_signals(signals)[:slots]:
        if s["ticker"] in held:
            continue
        result = execute_buy(s["ticker"], s["price"], s["reason"])
        if result:
            print(f"  BUY   {result['ticker']:12} @ £{result['price']:.2f}  Cost: £{result['cost']:.2f}")

    total = take_snapshot()

    print(f"\n{'='*50}")
    print(f"Portfolio value: £{total:,.2f}")
    print(f"Return:          {((total / 10000) - 1) * 100:+.2f}%")
    print(f"{'='*50}\n")


if __name__ == "__main__":
    run()
