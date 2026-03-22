"""
Paper trade executor — simulates trades against real prices, stores in SQLite.
No real money moves. £10,000 starting capital.
"""
from datetime import datetime
from db import get_conn

MAX_POSITIONS = 10
MAX_POSITION_PCT = 0.10  # 10% of portfolio per position


def get_portfolio():
    conn = get_conn()
    cash_row = conn.execute("SELECT cash FROM portfolio ORDER BY id DESC LIMIT 1").fetchone()
    positions = conn.execute("SELECT * FROM positions").fetchall()
    conn.close()
    return {
        "cash": cash_row["cash"] if cash_row else 10000.0,
        "positions": {r["ticker"]: dict(r) for r in positions}
    }


def get_portfolio_value(positions: dict) -> float:
    """Current market value of all positions."""
    import yfinance as yf
    total = 0.0
    for ticker, pos in positions.items():
        try:
            price = yf.Ticker(ticker).fast_info["lastPrice"]
            total += pos["shares"] * price
        except Exception:
            total += pos["shares"] * pos["avg_price"]
    return total


def execute_buy(ticker: str, price: float, reason: str) -> dict | None:
    portfolio = get_portfolio()
    cash = portfolio["cash"]
    positions = portfolio["positions"]

    if len(positions) >= MAX_POSITIONS:
        return None

    # Size: 10% of total portfolio
    total_est = cash + sum(p["shares"] * p["avg_price"] for p in positions.values())
    position_size = total_est * MAX_POSITION_PCT
    position_size = min(position_size, cash * 0.95)  # don't use more than 95% of cash

    if position_size < 50:  # minimum £50 trade
        return None

    shares = position_size / price
    cost = shares * price

    conn = get_conn()
    conn.execute("UPDATE portfolio SET cash = cash - ?, updated_at = datetime('now')", (cost,))
    conn.execute("""
        INSERT OR REPLACE INTO positions (ticker, shares, avg_price, opened_at)
        VALUES (?, ?, ?, datetime('now'))
    """, (ticker, shares, price))
    conn.execute("""
        INSERT INTO trades (ticker, action, shares, price, value, reason, executed_at)
        VALUES (?, 'BUY', ?, ?, ?, ?, datetime('now'))
    """, (ticker, shares, price, cost, reason))
    conn.commit()
    conn.close()

    return {"ticker": ticker, "action": "BUY", "shares": shares, "price": price, "cost": cost}


def execute_sell(ticker: str, price: float, reason: str) -> dict | None:
    portfolio = get_portfolio()
    pos = portfolio["positions"].get(ticker)
    if not pos:
        return None

    shares = pos["shares"]
    value = shares * price
    pnl = value - (shares * pos["avg_price"])

    conn = get_conn()
    conn.execute("UPDATE portfolio SET cash = cash + ?, updated_at = datetime('now')", (value,))
    conn.execute("DELETE FROM positions WHERE ticker = ?", (ticker,))
    conn.execute("""
        INSERT INTO trades (ticker, action, shares, price, value, reason, executed_at)
        VALUES (?, 'SELL', ?, ?, ?, ?, datetime('now'))
    """, (ticker, shares, price, value, reason))
    conn.commit()
    conn.close()

    return {"ticker": ticker, "action": "SELL", "shares": shares, "price": price,
            "value": value, "pnl": pnl}


def take_snapshot():
    """Record portfolio total value for charting."""
    portfolio = get_portfolio()
    positions_value = get_portfolio_value(portfolio["positions"])
    total = portfolio["cash"] + positions_value

    conn = get_conn()
    conn.execute("""
        INSERT INTO snapshots (total_value, cash, positions_value, recorded_at)
        VALUES (?, ?, ?, datetime('now'))
    """, (total, portfolio["cash"], positions_value))
    conn.commit()
    conn.close()
    return total
