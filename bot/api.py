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

# ── Scheduler ────────────────────────────────────────────────────────────────
# LSE opens 08:00 London (GMT=08:00 UTC, BST=07:00 UTC) → run at 09:00 UTC (always after open)
# NYSE opens 09:30 ET = 14:30 UTC → run at 14:30 UTC
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

def _scheduled_run():
    try:
        from run import run
        run()
    except Exception as e:
        print(f"[scheduler] error: {e}")

_scheduler = BackgroundScheduler(timezone="UTC")
_scheduler.add_job(_scheduled_run, CronTrigger(day_of_week="mon-fri", hour=9, minute=0))   # LSE session
_scheduler.add_job(_scheduled_run, CronTrigger(day_of_week="mon-fri", hour=14, minute=30)) # NYSE open
_scheduler.start()


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


# ── Sharia live check ────────────────────────────────────────────────────────

# Sectors that are clearly prohibited
_HARAM_SECTORS = {
    "Financial Services": "Interest-based banking/lending — riba (usury) is prohibited (Quran 2:275–276)",
    "Banks": "Interest-based lending — riba prohibited in Islam",
    "Insurance": "Conventional insurance involves riba and gharar (uncertainty) — Quran 2:219",
    "Gambling & Casinos": "Directly prohibited — Quran 5:90 'intoxicants and gambling are abomination'",
    "Alcoholic Beverages": "Alcohol prohibited — Quran 5:90; any revenue from it is haram",
    "Tobacco": "Harmful substance — prohibited by scholarly consensus (mafsadah)",
    "Defense & Aerospace": "Weapons manufacture — reviewed case by case; offensive arms are haram",
    "Adult Entertainment": "Prohibited — promotes immorality (fahisha), Quran 24:19",
}
# Sectors needing closer review (may have mixed revenue)
_BORDERLINE_SECTORS = {
    "Consumer Defensive": "Often sells alcohol/tobacco alongside halal products — purification may apply",
    "Consumer Cyclical": "May include entertainment or gaming revenue",
    "Communication Services": "May carry advertising for haram products or produce haram content",
    "Media": "May include haram content — detailed review needed",
    "Healthcare": "Generally permissible; review for contraceptive/abortion product lines",
}

@app.get("/api/sharia/check")
def sharia_check(ticker: str):
    """Live AAOIFI screening for any ticker using yfinance balance sheet data."""
    ticker = ticker.upper().strip()
    # Check if already in pre-screened universe
    if ticker in HALAL_UNIVERSE:
        meta = HALAL_UNIVERSE[ticker]
        return {
            "ticker": ticker,
            "name": meta["name"],
            "sector": meta["sector"],
            "source": "pre-screened",
            "overall": "compliant" if meta.get("haram_revenue_pct", 0) < 5 else "non-compliant",
            "criteria": [
                {
                    "name": "Business Activity",
                    "result": "pass",
                    "detail": meta["sharia_rules"][0] if meta.get("sharia_rules") else "Pre-screened halal sector",
                    "proof": "AAOIFI Standard 21 — Business activity must not involve prohibited goods/services",
                },
                {
                    "name": "Debt Ratio (Total Debt / Total Assets < 33%)",
                    "result": "pass" if meta.get("debt_ratio", 0) < 0.33 else "fail",
                    "detail": f"Debt ratio: {meta.get('debt_ratio', 0)*100:.0f}% — threshold 33%",
                    "proof": "AAOIFI Standard 21, §3.2 — Excessive debt resembles riba-laden structure (Quran 2:275)",
                    "values": {"debt_ratio": meta.get("debt_ratio")},
                },
                {
                    "name": "Haram Revenue (Non-permissible revenue / Total revenue < 5%)",
                    "result": "purify" if 0 < meta.get("haram_revenue_pct", 0) < 5 else "pass",
                    "detail": f"{meta.get('haram_revenue_pct', 0)}% impermissible revenue — "
                              + ("purification required" if meta.get("haram_revenue_pct", 0) > 0 else "clean"),
                    "proof": "AAOIFI Standard 21, §4.1 — Up to 5% haram revenue is tolerated with purification; Prophet (ﷺ) said 'Every flesh nourished by haram is more deserving of fire' (Tirmidhi 614)",
                    "values": {"haram_revenue_pct": meta.get("haram_revenue_pct", 0)},
                },
            ],
            "pass_reason": meta.get("pass_reason"),
            "purification_pct": meta.get("haram_revenue_pct", 0),
        }
    # Live check via yfinance
    try:
        import yfinance as yf
        info = yf.Ticker(ticker).info
        if not info or not info.get("shortName"):
            return {"ticker": ticker, "error": "Ticker not found"}
        sector = info.get("sector", "") or info.get("industry", "") or ""
        name = info.get("longName") or info.get("shortName", ticker)
        # Business activity
        haram_match = next(
            ((k, v) for k, v in _HARAM_SECTORS.items() if k.lower() in sector.lower()),
            None
        )
        borderline_match = next(
            ((k, v) for k, v in _BORDERLINE_SECTORS.items() if k.lower() in sector.lower()),
            None
        )
        if haram_match:
            biz_result, biz_detail = "fail", f"Sector '{sector}' — {haram_match[1]}"
        elif borderline_match:
            biz_result, biz_detail = "review", f"Sector '{sector}' — {borderline_match[1]}"
        else:
            biz_result, biz_detail = "pass", f"Sector '{sector}' — no prohibited activity identified"
        # Debt ratio
        total_debt = info.get("totalDebt") or 0
        total_assets = info.get("totalAssets") or 0
        if total_assets > 0:
            debt_ratio = total_debt / total_assets
            debt_result = "pass" if debt_ratio < 0.33 else "fail"
            debt_detail = f"Total Debt: {_fmt_billions(total_debt)} / Total Assets: {_fmt_billions(total_assets)} = {debt_ratio*100:.1f}% (threshold 33%)"
        else:
            debt_ratio = None
            debt_result = "unknown"
            debt_detail = "Balance sheet data unavailable from public filings"
        # Haram revenue — best effort based on sector flags
        haram_rev_pct = 0
        if borderline_match:
            haram_rev_pct = 2.0  # conservative estimate; real figure needs analyst data
            rev_detail = f"Estimated ~2% mixed revenue (sector average) — actual requires annual report review. Purification recommended."
            rev_result = "purify"
        else:
            rev_detail = "No significant haram revenue identified based on sector classification"
            rev_result = "pass"
        overall = "non-compliant" if biz_result == "fail" or debt_result == "fail" else \
                  "review" if biz_result == "review" or debt_result == "unknown" else "compliant"
        return {
            "ticker": ticker,
            "name": name,
            "sector": sector,
            "source": "live",
            "overall": overall,
            "criteria": [
                {
                    "name": "Business Activity",
                    "result": biz_result,
                    "detail": biz_detail,
                    "proof": "AAOIFI Standard 21 — Business activity must not involve prohibited goods/services (Quran 5:90, 2:275)",
                },
                {
                    "name": "Debt Ratio (Total Debt / Total Assets < 33%)",
                    "result": debt_result,
                    "detail": debt_detail,
                    "proof": "AAOIFI Standard 21, §3.2 — Excessive leverage resembles riba (Quran 2:275). Threshold: debt/assets < 33%.",
                    "values": {"total_debt": total_debt, "total_assets": total_assets, "debt_ratio": debt_ratio},
                },
                {
                    "name": "Haram Revenue (Non-permissible / Total revenue < 5%)",
                    "result": rev_result,
                    "detail": rev_detail,
                    "proof": "AAOIFI Standard 21, §4.1 — Tolerated up to 5% with purification. 'Every flesh nourished by haram is more deserving of fire.' (Tirmidhi 614)",
                    "values": {"haram_revenue_pct": haram_rev_pct},
                },
            ],
            "purification_pct": haram_rev_pct,
            "market_cap": info.get("marketCap"),
            "exchange": info.get("exchange"),
        }
    except Exception as e:
        return {"ticker": ticker, "error": str(e)}

def _fmt_billions(v: float) -> str:
    if not v:
        return "N/A"
    if abs(v) >= 1e12:
        return f"${v/1e12:.2f}T"
    if abs(v) >= 1e9:
        return f"${v/1e9:.2f}B"
    return f"${v/1e6:.1f}M"


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
    ticker = req.ticker.upper().strip()
    if not ticker:
        raise HTTPException(400, "Ticker required")
    if req.amount <= 0:
        raise HTTPException(400, "Amount must be positive")

    price = live_price(ticker, 0)
    if price <= 0:
        raise HTTPException(503, f"Could not fetch live price for {ticker} — check the ticker symbol")

    portfolio = get_portfolio()
    if req.amount > portfolio["cash"]:
        raise HTTPException(400, f"Insufficient cash. Available: £{portfolio['cash']:.4f}")

    result = execute_buy(ticker, price, "Manual buy via dashboard", size=req.amount, is_manual=True)
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
    t = ticker.upper().strip()
    p = live_price(t, 0)
    if p <= 0:
        raise HTTPException(503, f"Price unavailable for {t}")
    meta = HALAL_UNIVERSE.get(t, {})
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


@app.get("/api/search")
def search_stocks(q: str = ""):
    """Live ticker search via Yahoo Finance — returns up to 8 equity results."""
    if not q or len(q) < 2:
        return []
    try:
        import httpx
        resp = httpx.get(
            "https://query2.finance.yahoo.com/v1/finance/search",
            params={"q": q, "lang": "en-US", "region": "US", "quotesCount": 8, "newsCount": 0},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=5,
        )
        quotes = resp.json().get("quotes", [])
        return [
            {
                "ticker": item.get("symbol", ""),
                "name": item.get("longname") or item.get("shortname") or "",
                "exchange": item.get("exchDisp", ""),
                "type": item.get("typeDisp", ""),
            }
            for item in quotes
            if item.get("symbol") and item.get("quoteType") in ("EQUITY", "ETF")
        ]
    except Exception:
        return []


@app.get("/api/health")
def health():
    return {"status": "ok", "version": "1.0.0"}
