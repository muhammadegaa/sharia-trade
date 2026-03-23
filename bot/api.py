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
from screen import HALAL_UNIVERSE
from execute import execute_buy, execute_sell, get_portfolio
from market_check import market_status

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
init_db()


# ── Helpers ──────────────────────────────────────────────────────────────────

def get_total_deposited(conn) -> float:
    row = conn.execute("SELECT COALESCE(SUM(amount),0) as t FROM deposits").fetchone()
    return row["t"] or 0.0

def get_total_withdrawn(conn) -> float:
    row = conn.execute("SELECT COALESCE(SUM(amount),0) as t FROM withdrawals").fetchone()
    return row["t"] or 0.0

def live_price(ticker: str, fallback: float) -> float:
    try:
        return yf.Ticker(ticker).fast_info["lastPrice"]
    except Exception:
        return fallback


# ── Summary ──────────────────────────────────────────────────────────────────

@app.get("/api/summary")
def summary():
    conn = get_conn()
    cash_row = conn.execute("SELECT cash FROM portfolio ORDER BY id DESC LIMIT 1").fetchone()
    positions = conn.execute("SELECT * FROM positions").fetchall()
    total_deposited = get_total_deposited(conn)
    total_withdrawn = get_total_withdrawn(conn)

    # Last bot run
    last_run = conn.execute(
        "SELECT * FROM bot_runs ORDER BY id DESC LIMIT 1"
    ).fetchone()
    conn.close()

    cash = cash_row["cash"] if cash_row else 0.0
    positions_list = [dict(r) for r in positions]

    positions_value = 0.0
    enriched = []
    for p in positions_list:
        price = live_price(p["ticker"], p["avg_price"])
        market_value = p["shares"] * price
        cost_basis = p["shares"] * p["avg_price"]
        pnl = market_value - cost_basis
        pnl_pct = (pnl / cost_basis * 100) if cost_basis > 0 else 0.0
        positions_value += market_value
        meta = HALAL_UNIVERSE.get(p["ticker"], {})
        enriched.append({
            **p, "current_price": price, "market_value": market_value,
            "pnl": pnl, "pnl_pct": pnl_pct,
            "name": meta.get("name", p["ticker"]),
            "sector": meta.get("sector", ""),
        })

    total = cash + positions_value
    net_deposited = total_deposited - total_withdrawn
    total_return_gbp = total - net_deposited
    total_return_pct = ((total / net_deposited) - 1) * 100 if net_deposited > 0 else 0.0

    mkt = market_status()

    return {
        "total_value": total,
        "cash": cash,
        "positions_value": positions_value,
        "total_deposited": total_deposited,
        "total_withdrawn": total_withdrawn,
        "net_deposited": net_deposited,
        "total_return_pct": total_return_pct,
        "total_return_gbp": total_return_gbp,
        "position_count": len(enriched),
        "positions": enriched,
        "market": mkt,
        "last_run": dict(last_run) if last_run else None,
    }


# ── Snapshots ────────────────────────────────────────────────────────────────

@app.get("/api/snapshots")
def snapshots():
    conn = get_conn()
    rows = conn.execute(
        "SELECT total_value, recorded_at FROM snapshots ORDER BY recorded_at ASC"
    ).fetchall()
    conn.close()
    return [{"value": r["total_value"], "date": r["recorded_at"]} for r in rows]


# ── Trades ───────────────────────────────────────────────────────────────────

@app.get("/api/trades")
def trades():
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM trades ORDER BY executed_at DESC LIMIT 100"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ── Screener ─────────────────────────────────────────────────────────────────

@app.get("/api/screener")
def screener():
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM screener_cache ORDER BY ticker ASC"
    ).fetchall()
    conn.close()
    # Enrich with full HALAL_UNIVERSE metadata
    result = []
    for r in rows:
        d = dict(r)
        meta = HALAL_UNIVERSE.get(d["ticker"], {})
        d["name"] = d.get("name") or meta.get("name", d["ticker"])
        d["sector"] = d.get("sector") or meta.get("sector", "")
        d["sharia_rules"] = meta.get("sharia_rules", [])
        result.append(d)
    return result


# ── Deposits ─────────────────────────────────────────────────────────────────

@app.get("/api/deposits")
def get_deposits():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM deposits ORDER BY deposited_at DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


class DepositRequest(BaseModel):
    amount: float
    note: str = ""

@app.post("/api/deposit")
def deposit(req: DepositRequest):
    if req.amount <= 0:
        raise HTTPException(400, "Amount must be positive")
    conn = get_conn()
    conn.execute(
        "INSERT INTO deposits (amount, note, deposited_at) VALUES (?, ?, datetime('now'))",
        (req.amount, req.note)
    )
    conn.execute(
        "UPDATE portfolio SET cash = cash + ?, updated_at = datetime('now')", (req.amount,)
    )
    conn.commit()
    cash = conn.execute("SELECT cash FROM portfolio").fetchone()["cash"]
    conn.close()
    return {"success": True, "new_cash": cash, "deposited": req.amount}


# ── Withdrawals ───────────────────────────────────────────────────────────────

class WithdrawRequest(BaseModel):
    amount: float
    note: str = ""

@app.post("/api/withdraw")
def withdraw(req: WithdrawRequest):
    if req.amount <= 0:
        raise HTTPException(400, "Amount must be positive")
    conn = get_conn()
    cash_row = conn.execute("SELECT cash FROM portfolio ORDER BY id DESC LIMIT 1").fetchone()
    cash = cash_row["cash"] if cash_row else 0.0
    if req.amount > cash:
        raise HTTPException(400, f"Insufficient cash. Available: £{cash:.2f}")
    conn.execute(
        "INSERT INTO withdrawals (amount, note, withdrawn_at) VALUES (?, ?, datetime('now'))",
        (req.amount, req.note)
    )
    conn.execute(
        "UPDATE portfolio SET cash = cash - ?, updated_at = datetime('now')", (req.amount,)
    )
    conn.commit()
    new_cash = conn.execute("SELECT cash FROM portfolio").fetchone()["cash"]
    conn.close()
    return {"success": True, "new_cash": new_cash, "withdrawn": req.amount}


# ── Manual trades ─────────────────────────────────────────────────────────────

class ManualBuyRequest(BaseModel):
    ticker: str
    amount: float  # £ amount to invest

@app.post("/api/trade/buy")
def manual_buy(req: ManualBuyRequest):
    ticker = req.ticker.upper()
    if ticker not in HALAL_UNIVERSE:
        raise HTTPException(400, f"{ticker} is not in the halal universe. Only AAOIFI-screened stocks allowed.")
    if req.amount <= 0:
        raise HTTPException(400, "Amount must be positive")

    price = live_price(ticker, 0)
    if price <= 0:
        raise HTTPException(503, f"Could not fetch price for {ticker}")

    portfolio = get_portfolio()
    if req.amount > portfolio["cash"]:
        raise HTTPException(400, f"Insufficient cash. Available: £{portfolio['cash']:.4f}")

    result = execute_buy(ticker, price, f"Manual buy via dashboard", size=req.amount, is_manual=True)
    if not result:
        raise HTTPException(400, "Buy failed — max positions reached or insufficient cash")

    return {"success": True, **result}


class ManualSellRequest(BaseModel):
    ticker: str

@app.post("/api/trade/sell")
def manual_sell(req: ManualSellRequest):
    ticker = req.ticker.upper()
    portfolio = get_portfolio()
    if ticker not in portfolio["positions"]:
        raise HTTPException(404, f"No open position for {ticker}")

    price = live_price(ticker, portfolio["positions"][ticker]["avg_price"])
    result = execute_sell(ticker, price, "Manual sell via dashboard", is_manual=True)
    if not result:
        raise HTTPException(400, "Sell failed")

    return {"success": True, **result}


# ── Bot runs ──────────────────────────────────────────────────────────────────

@app.get("/api/runs")
def bot_runs():
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM bot_runs ORDER BY id DESC LIMIT 30"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/runs/{run_id}")
def bot_run_detail(run_id: int):
    conn = get_conn()
    run = conn.execute("SELECT * FROM bot_runs WHERE id = ?", (run_id,)).fetchone()
    if not run:
        raise HTTPException(404, "Run not found")
    decisions = conn.execute(
        "SELECT * FROM decision_log WHERE run_id = ? ORDER BY action, ticker",
        (run_id,)
    ).fetchall()
    conn.close()
    return {
        "run": dict(run),
        "decisions": [dict(d) for d in decisions],
    }


# ── P&L Report ────────────────────────────────────────────────────────────────

@app.get("/api/pnl")
def pnl_report():
    conn = get_conn()

    # All sell trades with their cost basis from matching buys
    sell_trades = conn.execute("""
        SELECT t.id, t.ticker, t.shares, t.price as sell_price, t.value as sell_value,
               t.executed_at, t.is_manual,
               (SELECT price FROM trades b
                WHERE b.ticker = t.ticker AND b.action = 'BUY'
                  AND b.executed_at <= t.executed_at
                ORDER BY b.executed_at DESC LIMIT 1) as buy_price
        FROM trades t WHERE t.action = 'SELL'
        ORDER BY t.executed_at DESC
    """).fetchall()

    realized = []
    total_realized = 0.0
    wins = 0
    losses = 0
    best_trade = None
    worst_trade = None

    for t in sell_trades:
        d = dict(t)
        buy_price = d.get("buy_price") or d["sell_price"]
        cost_basis = d["shares"] * buy_price
        pnl = d["sell_value"] - cost_basis
        pnl_pct = (pnl / cost_basis * 100) if cost_basis > 0 else 0
        d["pnl"] = pnl
        d["pnl_pct"] = pnl_pct
        d["buy_price"] = buy_price
        total_realized += pnl
        if pnl >= 0:
            wins += 1
        else:
            losses += 1
        if best_trade is None or pnl > best_trade["pnl"]:
            best_trade = d
        if worst_trade is None or pnl < worst_trade["pnl"]:
            worst_trade = d
        realized.append(d)

    total_trades = wins + losses
    win_rate = (wins / total_trades * 100) if total_trades > 0 else 0

    # Unrealized — current open positions
    positions = conn.execute("SELECT * FROM positions").fetchall()
    unrealized = []
    total_unrealized = 0.0
    for p in positions:
        price = live_price(p["ticker"], p["avg_price"])
        cost_basis = p["shares"] * p["avg_price"]
        market_val = p["shares"] * price
        pnl = market_val - cost_basis
        pnl_pct = (pnl / cost_basis * 100) if cost_basis > 0 else 0
        total_unrealized += pnl
        meta = HALAL_UNIVERSE.get(p["ticker"], {})
        unrealized.append({
            **dict(p),
            "current_price": price,
            "market_value": market_val,
            "cost_basis": cost_basis,
            "pnl": pnl,
            "pnl_pct": pnl_pct,
            "name": meta.get("name", p["ticker"]),
        })

    # Daily P&L
    daily = conn.execute(
        "SELECT * FROM pnl_daily ORDER BY date ASC LIMIT 90"
    ).fetchall()

    # Purification — flag tickers with borderline haram revenue
    purification = []
    for ticker, meta in HALAL_UNIVERSE.items():
        haram_rev = meta.get("haram_revenue_pct", 0)
        if haram_rev and haram_rev > 0:
            purification.append({
                "ticker": ticker,
                "name": meta.get("name"),
                "haram_revenue_pct": haram_rev,
                "note": f"Up to {haram_rev}% revenue may be from impermissible activities. Donate that % of profit to charity.",
            })

    conn.close()

    return {
        "summary": {
            "total_realized": total_realized,
            "total_unrealized": total_unrealized,
            "total_pnl": total_realized + total_unrealized,
            "win_rate": win_rate,
            "total_trades": total_trades,
            "wins": wins,
            "losses": losses,
            "best_trade": best_trade,
            "worst_trade": worst_trade,
        },
        "realized": realized,
        "unrealized": unrealized,
        "daily": [dict(d) for d in daily],
        "purification": purification,
    }


# ── Activity feed ─────────────────────────────────────────────────────────────

@app.get("/api/activity")
def activity():
    conn = get_conn()
    events = []

    for r in conn.execute("SELECT *, 'bot_run' as type FROM bot_runs ORDER BY started_at DESC LIMIT 20").fetchall():
        d = dict(r)
        d["timestamp"] = d["started_at"]
        events.append(d)

    for r in conn.execute("SELECT *, 'trade' as type FROM trades ORDER BY executed_at DESC LIMIT 20").fetchall():
        d = dict(r)
        d["timestamp"] = d["executed_at"]
        events.append(d)

    for r in conn.execute("SELECT *, 'deposit' as type FROM deposits ORDER BY deposited_at DESC LIMIT 10").fetchall():
        d = dict(r)
        d["timestamp"] = d["deposited_at"]
        events.append(d)

    for r in conn.execute("SELECT *, 'withdrawal' as type FROM withdrawals ORDER BY withdrawn_at DESC LIMIT 10").fetchall():
        d = dict(r)
        d["timestamp"] = d["withdrawn_at"]
        events.append(d)

    conn.close()
    events.sort(key=lambda x: x["timestamp"], reverse=True)
    return events[:50]


# ── Market status ─────────────────────────────────────────────────────────────

@app.get("/api/market")
def market():
    return market_status()


# ── Price lookup ──────────────────────────────────────────────────────────────

@app.get("/api/price/{ticker}")
def price(ticker: str):
    t = ticker.upper()
    if t not in HALAL_UNIVERSE:
        raise HTTPException(400, f"{t} not in halal universe")
    p = live_price(t, 0)
    if p <= 0:
        raise HTTPException(503, "Price unavailable")
    meta = HALAL_UNIVERSE[t]
    return {"ticker": t, "price": p, "name": meta.get("name"), "sector": meta.get("sector")}


# ── Cron trigger — called by Railway cron or any HTTP scheduler ───────────────

@app.post("/api/cron/run")
def cron_run(x_cron_secret: str = None):
    """
    Triggers the daily bot run. Protected by CRON_SECRET env var.
    Railway cron config: POST /api/cron/run every weekday at 08:05 and 14:35.
    """
    import threading
    secret = os.environ.get("CRON_SECRET", "")
    if secret and x_cron_secret != secret:
        raise HTTPException(401, "Unauthorized")

    status = market_status()

    def run_bot():
        import importlib.util, sys
        bot_dir = os.path.dirname(__file__)
        if bot_dir not in sys.path:
            sys.path.insert(0, bot_dir)
        from run import run
        run(force=True)

    thread = threading.Thread(target=run_bot, daemon=True)
    thread.start()

    return {
        "triggered": True,
        "market": status,
        "note": "Bot run started in background thread",
    }


@app.get("/api/health")
def health():
    return {"status": "ok", "version": "1.0.0"}
