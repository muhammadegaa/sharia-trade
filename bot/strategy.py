"""
Signal generator — 20-day SMA momentum strategy with full decision logging.
Returns rich decision objects for every ticker considered.
"""
import yfinance as yf
import warnings
warnings.filterwarnings("ignore")

from db import get_conn
from screen import HALAL_UNIVERSE


def get_signals_batch(tickers: list, current_positions: set) -> list:
    """Batch download prices, generate a decision for every ticker."""
    if not tickers:
        return []

    print(f"  Fetching price data for {len(tickers)} tickers...")
    try:
        import yfinance as yf
        raw = yf.download(tickers, period="3mo", auto_adjust=True,
                          progress=False, threads=True)
        close = raw["Close"] if "Close" in raw.columns.get_level_values(0) else raw
    except Exception as e:
        print(f"  Batch download failed: {e}")
        return []

    conn = get_conn()
    positions_db = {
        r["ticker"]: r for r in conn.execute("SELECT * FROM positions").fetchall()
    }
    conn.close()

    decisions = []
    for ticker in tickers:
        meta = HALAL_UNIVERSE.get(ticker, {})
        base = {
            "ticker": ticker,
            "name": meta.get("name", ticker),
            "sector": meta.get("sector", "Unknown"),
            "sharia_status": "HALAL",
            "price": None,
            "sma20": None,
            "momentum_pct": None,
        }

        try:
            col = close[ticker] if ticker in close.columns else None
            if col is None:
                decisions.append({**base, "action": "SKIP", "reason": "No price data available", "is_executed": False})
                continue

            series = col.dropna()
            if len(series) < 20:
                decisions.append({**base, "action": "SKIP", "reason": f"Insufficient data ({len(series)} days)", "is_executed": False})
                continue

            price = float(series.iloc[-1])
            sma20 = float(series.tail(20).mean())
            prev20 = float(series.iloc[-20])
            momentum_pct = round((price - prev20) / prev20 * 100, 2)

            base.update({"price": round(price, 4), "sma20": round(sma20, 4), "momentum_pct": momentum_pct})

            if ticker in current_positions and ticker in positions_db:
                avg_price = float(positions_db[ticker]["avg_price"])
                stop_price = round(avg_price * 0.92, 4)
                sma_floor = round(sma20 * 0.95, 4)

                if price < stop_price:
                    decisions.append({**base, "action": "SELL",
                        "reason": f"Stop loss hit: price £{price:.2f} < stop £{stop_price:.2f} (8% below entry £{avg_price:.2f})",
                        "is_executed": False})
                    continue

                if price < sma_floor:
                    decisions.append({**base, "action": "SELL",
                        "reason": f"Trend broken: price £{price:.2f} < 95% of SMA20 £{sma_floor:.2f}",
                        "is_executed": False})
                    continue

                pct_above = round((price / avg_price - 1) * 100, 2)
                decisions.append({**base, "action": "HOLD",
                    "reason": f"Holding: {pct_above:+.2f}% vs entry, price £{price:.2f} vs SMA20 £{sma20:.2f}",
                    "is_executed": False})
                continue

            if price > sma20 * 1.01:
                decisions.append({**base, "action": "BUY",
                    "reason": f"Momentum signal: price £{price:.2f} is {((price/sma20)-1)*100:.1f}% above SMA20 £{sma20:.2f}, 20-day momentum {momentum_pct:+.1f}%",
                    "is_executed": False})
            else:
                gap = round((sma20 - price) / sma20 * 100, 1)
                decisions.append({**base, "action": "HOLD",
                    "reason": f"No signal: price £{price:.2f} is {gap:.1f}% below SMA20 £{sma20:.2f}",
                    "is_executed": False})

        except Exception as e:
            decisions.append({**base, "action": "SKIP", "reason": f"Error: {e}", "is_executed": False})

    return decisions


def rank_buy_signals(decisions: list) -> list:
    buys = [d for d in decisions if d["action"] == "BUY"]
    return sorted(buys, key=lambda x: x.get("momentum_pct") or 0, reverse=True)
