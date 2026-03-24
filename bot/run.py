"""
Main daily runner — called by launchd at market open.
Logs every decision to decision_log for full transparency.
"""
import sys
import os
from datetime import datetime, date

sys.path.insert(0, os.path.dirname(__file__))

from db import init_db, get_conn
from screen import get_halal_universe, screen_all
from strategy import get_signals_batch, rank_buy_signals
from execute import get_portfolio, execute_buy, execute_sell, take_snapshot
from market_check import market_status


def send_telegram(message: str):
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "7772379116")
    if not token:
        return
    try:
        import httpx
        httpx.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": message, "parse_mode": "HTML"},
            timeout=10,
        )
    except Exception:
        pass


def get_position_size(cash: float, total_value: float) -> float:
    """Proportional sizing: 10% of portfolio, min £1, max £500."""
    size = total_value * 0.10
    return max(1.0, min(size, 500.0))


def log_decisions(run_id: int, decisions: list):
    conn = get_conn()
    for d in decisions:
        conn.execute("""
            INSERT INTO decision_log
            (run_id, ticker, name, sector, action, price, sma20, momentum_pct,
             reason, sharia_status, is_executed, logged_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        """, (
            run_id, d["ticker"], d.get("name"), d.get("sector"),
            d["action"], d.get("price"), d.get("sma20"), d.get("momentum_pct"),
            d.get("reason"), d.get("sharia_status", "HALAL"),
            1 if d.get("is_executed") else 0,
        ))
    conn.commit()
    conn.close()


def save_daily_pnl(total_value: float):
    conn = get_conn()
    today = date.today().isoformat()

    # Realized PnL today = sum of SELL trade profits today
    realized = conn.execute("""
        SELECT COALESCE(SUM(
            CASE WHEN t.action='SELL' THEN t.value - (t.shares * p_cost.avg_price) ELSE 0 END
        ), 0)
        FROM trades t
        WHERE date(t.executed_at) = ? AND t.action = 'SELL'
    """, (today,)).fetchone()[0] or 0.0

    # Unrealized = current positions value - cost basis
    positions = conn.execute("SELECT * FROM positions").fetchall()
    unrealized = 0.0
    for p in positions:
        try:
            import yfinance as yf
            price = yf.Ticker(p["ticker"]).fast_info["lastPrice"]
        except Exception:
            price = p["avg_price"]
        unrealized += (price - p["avg_price"]) * p["shares"]

    deposits_total = conn.execute("SELECT COALESCE(SUM(amount),0) FROM deposits").fetchone()[0] or 0.0

    conn.execute("""
        INSERT OR REPLACE INTO pnl_daily (date, realized_pnl, unrealized_pnl, total_value, deposits_total)
        VALUES (?, ?, ?, ?, ?)
    """, (today, realized, unrealized, total_value, deposits_total))
    conn.commit()
    conn.close()


def run(force: bool = False):
    print(f"\n{'='*55}")
    print(f"  SHARIA TRADER — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*55}\n")

    init_db()

    # Market check
    status = market_status()
    if not status["any_open"] and not force:
        print(f"  Markets closed. LSE: {'open' if status['lse_open'] else 'closed'}, NYSE: {'open' if status['nyse_open'] else 'closed'}")
        print("  Use run(force=True) to override.\n")
        send_telegram(
            f"🕌 <b>Sharia Trader — {datetime.now().strftime('%d %b %Y')}</b>\n\n"
            f"🔴 Markets closed — no trades today.\n"
            f"LSE: {'open' if status['lse_open'] else 'closed'} · NYSE: {'open' if status['nyse_open'] else 'closed'}"
        )
        return

    active_market = status.get("active_market") or "Manual"
    print(f"  Market open: {active_market}\n")

    screen_all()
    halal = get_halal_universe()
    print(f"  Halal universe: {len(halal)} stocks\n")

    portfolio = get_portfolio()
    portfolio_before = portfolio["total_value"]
    held = set(portfolio["positions"].keys())

    print(f"  Positions:  {len(held)}/10")
    print(f"  Cash:       £{portfolio['cash']:,.4f}")
    print(f"  Total:      £{portfolio_before:,.4f}\n")

    # Start bot_run record
    conn = get_conn()
    cur = conn.execute("""
        INSERT INTO bot_runs (started_at, portfolio_before, market)
        VALUES (datetime('now'), ?, ?)
    """, (portfolio_before, active_market))
    run_id = cur.lastrowid
    conn.commit()
    conn.close()

    # Generate all decisions
    decisions = get_signals_batch(halal, held)

    buys = [d for d in decisions if d["action"] == "BUY"]
    sells = [d for d in decisions if d["action"] == "SELL"]
    holds = [d for d in decisions if d["action"] == "HOLD"]
    skips = [d for d in decisions if d["action"] == "SKIP"]

    print(f"  Signals: {len(buys)} BUY · {len(sells)} SELL · {len(holds)} HOLD · {len(skips)} SKIP\n")

    trades_executed = 0

    # Execute sells first
    for d in sells:
        result = execute_sell(d["ticker"], d["price"], d["reason"])
        if result:
            d["is_executed"] = True
            trades_executed += 1
            pnl = result["pnl"]
            sign = "+" if pnl >= 0 else "-"
            print(f"  SELL  {d['ticker']:12} @ £{d['price']:.4f}  P&L: {sign}£{abs(pnl):.4f}")
            print(f"        {d['reason']}")

    # Execute top buys
    portfolio = get_portfolio()
    held = set(portfolio["positions"].keys())
    slots = 10 - len(held)
    position_size = get_position_size(portfolio["cash"], portfolio["total_value"])

    for d in rank_buy_signals(decisions)[:slots]:
        if d["ticker"] in held:
            continue
        if portfolio["cash"] < position_size * 0.5:
            print(f"  Insufficient cash (£{portfolio['cash']:.4f}) for new position")
            break
        result = execute_buy(d["ticker"], d["price"], d["reason"], size=position_size)
        if result:
            d["is_executed"] = True
            trades_executed += 1
            portfolio["cash"] -= result["cost"]
            print(f"  BUY   {d['ticker']:12} @ £{d['price']:.4f}  Size: £{result['cost']:.4f}")
            print(f"        {d['reason']}")

    # Log all decisions
    log_decisions(run_id, decisions)

    # Snapshot
    total_after = take_snapshot()
    save_daily_pnl(total_after)

    # Update bot_run record
    conn = get_conn()
    conn.execute("""
        UPDATE bot_runs SET
            finished_at = datetime('now'),
            stocks_screened = ?,
            signals_buy = ?,
            signals_sell = ?,
            signals_hold = ?,
            trades_executed = ?,
            portfolio_after = ?
        WHERE id = ?
    """, (len(halal), len(buys), len(sells), len(holds), trades_executed, total_after, run_id))
    conn.commit()
    conn.close()

    change = total_after - portfolio_before
    sign = "+" if change >= 0 else "-"
    print(f"\n{'='*55}")
    print(f"  Portfolio: £{total_after:,.4f}  ({sign}£{abs(change):.4f} this run)")
    print(f"  Run #{run_id} complete — {trades_executed} trade(s) executed")
    print(f"{'='*55}\n")

    send_telegram(
        f"🕌 <b>Sharia Trader — {datetime.now().strftime('%d %b %Y')}</b>\n\n"
        f"📊 Market: {active_market}\n"
        f"🔍 Screened: {len(halal)} halal stocks\n"
        f"📈 Signals: {len(buys)} BUY · {len(sells)} SELL · {len(holds)} HOLD\n"
        f"✅ Trades: {trades_executed} executed\n\n"
        f"💼 Portfolio: <b>£{total_after:,.2f}</b>\n"
        f"{'📈' if change >= 0 else '📉'} Run P&L: {sign}£{abs(change):.2f}\n\n"
        f"<i>Run #{run_id} complete</i>"
    )


if __name__ == "__main__":
    force = "--force" in sys.argv
    run(force=force)
