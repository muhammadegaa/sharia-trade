"""
Signal generator — 20-day momentum strategy using yfinance batch download.
BUY  if price > 20-day SMA and not already held
SELL if price < entry_price * 0.92 (8% stop loss) or price < SMA20 * 0.95
"""
import yfinance as yf
import warnings
warnings.filterwarnings("ignore")

from db import get_conn


def get_signals_batch(tickers: list, current_positions: set) -> list:
    """Fetch all prices in one batch call — much faster than per-ticker."""
    if not tickers:
        return []

    print(f"Fetching price data for {len(tickers)} tickers...")
    try:
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

    signals = []
    for ticker in tickers:
        try:
            col = close[ticker] if ticker in close.columns else None
            if col is None:
                continue
            series = col.dropna()
            if len(series) < 20:
                continue

            price = float(series.iloc[-1])
            sma20 = float(series.tail(20).mean())
            prev20 = float(series.iloc[-20])
            momentum = (price - prev20) / prev20

            if ticker in current_positions and ticker in positions_db:
                avg_price = float(positions_db[ticker]["avg_price"])
                if price < avg_price * 0.92:
                    signals.append({"ticker": ticker, "action": "SELL", "price": price,
                                    "reason": f"Stop loss ({price:.2f} < {avg_price*0.92:.2f})"})
                    continue
                if price < sma20 * 0.95:
                    signals.append({"ticker": ticker, "action": "SELL", "price": price,
                                    "reason": f"Below SMA20 ({price:.2f} < {sma20*0.95:.2f})"})
                    continue
                signals.append({"ticker": ticker, "action": "HOLD", "price": price,
                                 "reason": f"Holding — {price:.2f} vs SMA20 {sma20:.2f}"})
                continue

            if price > sma20 * 1.01:
                signals.append({"ticker": ticker, "action": "BUY", "price": price,
                                 "reason": f"Above SMA20, momentum {momentum:.1%}",
                                 "momentum": momentum})
            else:
                signals.append({"ticker": ticker, "action": "HOLD", "price": price,
                                 "reason": "Below SMA20 — no entry"})

        except Exception as e:
            signals.append({"ticker": ticker, "action": "HOLD", "price": None,
                             "reason": f"Error: {e}"})

    return signals


def rank_buy_signals(signals: list) -> list:
    buys = [s for s in signals if s["action"] == "BUY"]
    return sorted(buys, key=lambda x: x.get("momentum", 0), reverse=True)
