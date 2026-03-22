"""
FastAPI backend — serves portfolio data to the Next.js dashboard.
Run: uvicorn api:app --port 8787 --reload
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from db import init_db, get_conn

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

init_db()


@app.get("/api/summary")
def summary():
    conn = get_conn()
    cash_row = conn.execute("SELECT cash FROM portfolio ORDER BY id DESC LIMIT 1").fetchone()
    positions = conn.execute("SELECT * FROM positions").fetchall()
    conn.close()

    cash = cash_row["cash"] if cash_row else 10000.0
    positions_list = [dict(r) for r in positions]

    # Get current prices
    positions_value = 0.0
    enriched = []
    for p in positions_list:
        try:
            price = yf.Ticker(p["ticker"]).fast_info["lastPrice"]
        except Exception:
            price = p["avg_price"]
        market_value = p["shares"] * price
        pnl = market_value - (p["shares"] * p["avg_price"])
        pnl_pct = (pnl / (p["shares"] * p["avg_price"])) * 100
        positions_value += market_value
        enriched.append({**p, "current_price": price, "market_value": market_value,
                         "pnl": pnl, "pnl_pct": pnl_pct})

    total = cash + positions_value
    starting = 10000.0
    total_return = ((total / starting) - 1) * 100

    return {
        "total_value": total,
        "cash": cash,
        "positions_value": positions_value,
        "total_return_pct": total_return,
        "total_return_gbp": total - starting,
        "position_count": len(enriched),
        "positions": enriched,
    }


@app.get("/api/snapshots")
def snapshots():
    conn = get_conn()
    rows = conn.execute(
        "SELECT total_value, recorded_at FROM snapshots ORDER BY recorded_at ASC"
    ).fetchall()
    conn.close()
    return [{"value": r["total_value"], "date": r["recorded_at"]} for r in rows]


@app.get("/api/trades")
def trades():
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM trades ORDER BY executed_at DESC LIMIT 50"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/screener")
def screener():
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM screener_cache ORDER BY is_halal DESC, ticker ASC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
