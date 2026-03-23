"""
Paper trade executor — simulates trades against real prices, stores in SQLite.
No real money moves.
"""
from db import get_conn

MAX_POSITIONS = 10


def get_portfolio() -> dict:
    conn = get_conn()
    cash_row = conn.execute("SELECT cash FROM portfolio ORDER BY id DESC LIMIT 1").fetchone()
    positions = conn.execute("SELECT * FROM positions").fetchall()
    pos_dict = {r["ticker"]: dict(r) for r in positions}
    conn.close()
    cash = cash_row["cash"] if cash_row else 0.0
    total_value = cash + sum(p["shares"] * p["avg_price"] for p in pos_dict.values())
    return {"cash": cash, "positions": pos_dict, "total_value": total_value}


def get_portfolio_value(positions: dict) -> float:
    import yfinance as yf
    total = 0.0
    for ticker, pos in positions.items():
        try:
            price = yf.Ticker(ticker).fast_info["lastPrice"]
            total += pos["shares"] * price
        except Exception:
            total += pos["shares"] * pos["avg_price"]
    return total


def execute_buy(ticker: str, price: float, reason: str,
                size: float = None, is_manual: bool = False) -> dict | None:
    portfolio = get_portfolio()
    cash = portfolio["cash"]
    positions = portfolio["positions"]

    if len(positions) >= MAX_POSITIONS:
        return None
    if price is None or price <= 0:
        return None

    # Use provided size or default to 10% of portfolio
    if size is None:
        total_est = portfolio["total_value"]
        size = max(1.0, min(total_est * 0.10, 500.0))

    size = min(size, cash * 0.99)
    if size < 0.50:
        return None

    shares = size / price
    cost = shares * price

    conn = get_conn()
    conn.execute("UPDATE portfolio SET cash = cash - ?, updated_at = datetime('now')", (cost,))
    conn.execute("""
        INSERT OR REPLACE INTO positions (ticker, shares, avg_price, opened_at)
        VALUES (?, ?, ?, datetime('now'))
    """, (ticker, shares, price))
    conn.execute("""
        INSERT INTO trades (ticker, action, shares, price, value, reason, is_manual, executed_at)
        VALUES (?, 'BUY', ?, ?, ?, ?, ?, datetime('now'))
    """, (ticker, shares, price, cost, reason, 1 if is_manual else 0))
    conn.commit()
    conn.close()

    return {"ticker": ticker, "action": "BUY", "shares": shares, "price": price,
            "cost": cost, "is_manual": is_manual}


def execute_sell(ticker: str, price: float, reason: str,
                 is_manual: bool = False) -> dict | None:
    portfolio = get_portfolio()
    pos = portfolio["positions"].get(ticker)
    if not pos:
        return None
    if price is None or price <= 0:
        return None

    shares = pos["shares"]
    value = shares * price
    pnl = value - (shares * pos["avg_price"])

    conn = get_conn()
    conn.execute("UPDATE portfolio SET cash = cash + ?, updated_at = datetime('now')", (value,))
    conn.execute("DELETE FROM positions WHERE ticker = ?", (ticker,))
    conn.execute("""
        INSERT INTO trades (ticker, action, shares, price, value, reason, is_manual, executed_at)
        VALUES (?, 'SELL', ?, ?, ?, ?, ?, datetime('now'))
    """, (ticker, shares, price, value, reason, 1 if is_manual else 0))
    conn.commit()
    conn.close()

    return {"ticker": ticker, "action": "SELL", "shares": shares, "price": price,
            "value": value, "pnl": pnl, "is_manual": is_manual}


def take_snapshot() -> float:
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
