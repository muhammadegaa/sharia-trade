"""
Signal generator — simple 20-day momentum strategy.
BUY  if price > 20-day SMA and not already held
SELL if price < entry_price * 0.92 (8% stop loss) or price < 20-day SMA * 0.95
HOLD otherwise
"""
import yfinance as yf
import pandas as pd
from db import get_conn


def get_signal(ticker: str, current_positions: set) -> dict:
    try:
        hist = yf.Ticker(ticker).history(period="3mo")
        if hist.empty or len(hist) < 20:
            return {"ticker": ticker, "action": "HOLD", "price": None, "reason": "Insufficient data"}

        hist["sma20"] = hist["Close"].rolling(20).mean()
        price = float(hist["Close"].iloc[-1])
        sma20 = float(hist["sma20"].iloc[-1])

        if ticker in current_positions:
            # Check stop loss
            conn = get_conn()
            pos = conn.execute(
                "SELECT avg_price FROM positions WHERE ticker = ?", (ticker,)
            ).fetchone()
            conn.close()

            if pos:
                avg_price = pos["avg_price"]
                if price < avg_price * 0.92:
                    return {"ticker": ticker, "action": "SELL", "price": price,
                            "reason": f"Stop loss hit ({price:.2f} < {avg_price * 0.92:.2f})"}
                if price < sma20 * 0.95:
                    return {"ticker": ticker, "action": "SELL", "price": price,
                            "reason": f"Price below SMA20 ({price:.2f} < {sma20 * 0.95:.2f})"}

            return {"ticker": ticker, "action": "HOLD", "price": price,
                    "reason": f"Holding — price {price:.2f}, SMA20 {sma20:.2f}"}

        # Buy signal — price above SMA20 with momentum
        if price > sma20 * 1.01:
            momentum = (price - float(hist["Close"].iloc[-20])) / float(hist["Close"].iloc[-20])
            return {"ticker": ticker, "action": "BUY", "price": price,
                    "reason": f"Price above SMA20, momentum {momentum:.1%}",
                    "momentum": momentum}

        return {"ticker": ticker, "action": "HOLD", "price": price,
                "reason": f"Price {price:.2f} below SMA20 {sma20:.2f}"}

    except Exception as e:
        return {"ticker": ticker, "action": "HOLD", "price": None, "reason": f"Error: {e}"}


def rank_buy_signals(signals: list) -> list:
    """Sort BUY signals by momentum descending."""
    buys = [s for s in signals if s["action"] == "BUY"]
    return sorted(buys, key=lambda x: x.get("momentum", 0), reverse=True)
