"""
FastAPI backend — serves portfolio data to the Next.js dashboard.
Run: PYTHONPATH=. uvicorn bot.api:app --port 8787 --reload
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import yfinance as yf
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from db import init_db, get_conn

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

init_db()


def get_total_deposited(conn) -> float:
    row = conn.execute("SELECT SUM(amount) as total FROM deposits").fetchone()
    return row["total"] or 0.0


@app.get("/api/summary")
def summary():
    conn = get_conn()
    cash_row = conn.execute("SELECT cash FROM portfolio ORDER BY id DESC LIMIT 1").fetchone()
    positions = conn.execute("SELECT * FROM positions").fetchall()
    total_deposited = get_total_deposited(conn)
    conn.close()

    cash = cash_row["cash"] if cash_row else 0.0
    positions_list = [dict(r) for r in positions]

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
    total_return_gbp = total - total_deposited
    total_return_pct = ((total / total_deposited) - 1) * 100 if total_deposited > 0 else 0.0

    return {
        "total_value": total,
        "cash": cash,
        "positions_value": positions_value,
        "total_deposited": total_deposited,
        "total_return_pct": total_return_pct,
        "total_return_gbp": total_return_gbp,
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
        "SELECT * FROM screener_cache ORDER BY ticker ASC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/deposits")
def get_deposits():
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM deposits ORDER BY deposited_at DESC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


class DepositRequest(BaseModel):
    amount: float
    note: str = ""


@app.post("/api/deposit")
def deposit(req: DepositRequest):
    if req.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")

    conn = get_conn()
    conn.execute(
        "INSERT INTO deposits (amount, note, deposited_at) VALUES (?, ?, datetime('now'))",
        (req.amount, req.note)
    )
    conn.execute(
        "UPDATE portfolio SET cash = cash + ?, updated_at = datetime('now')",
        (req.amount,)
    )
    conn.commit()
    cash_row = conn.execute("SELECT cash FROM portfolio").fetchone()
    conn.close()

    return {"success": True, "new_cash": cash_row["cash"], "deposited": req.amount}
