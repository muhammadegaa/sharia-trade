"""
Multi-agent trading strategy — swarm of AI trader personas debate each stock.
Falls back to SMA20 momentum if OpenRouter is unavailable or quota exceeded.
"""
import os
import json
import warnings
import yfinance as yf
warnings.filterwarnings("ignore")

from db import get_conn
from screen import HALAL_UNIVERSE

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
MODEL = "google/gemini-flash-1.5"  # ~$0.008/run for 35 stocks

# Four trader personas — each brings a different lens
AGENTS = [
    {
        "name": "Momentum Trader",
        "prompt": (
            "You are an aggressive momentum trader. You chase price trends and "
            "care about: price vs SMA20, recent % move, volume trends. "
            "You buy when momentum is strong, sell when it breaks down."
        ),
    },
    {
        "name": "Risk Manager",
        "prompt": (
            "You are a cautious risk manager. You care about: downside protection, "
            "debt levels, position sizing. You veto buys if risk/reward is poor. "
            "You push for sells before losses compound."
        ),
    },
    {
        "name": "Value Investor",
        "prompt": (
            "You are a patient value investor. You care about: whether the stock is "
            "overextended, if there's a better entry point ahead, and long-term "
            "fundamentals. You prefer waiting for pullbacks."
        ),
    },
    {
        "name": "Macro Analyst",
        "prompt": (
            "You are a macro analyst. You care about: sector trends, market conditions, "
            "and whether the timing is right given broader market context. "
            "You flag sector-level risks and opportunities."
        ),
    },
]


def _call_agent(agent: dict, stock_context: str) -> dict:
    """Call one agent via OpenRouter. Returns {vote, reasoning}."""
    try:
        import httpx
        payload = {
            "model": MODEL,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        f"{agent['prompt']}\n\n"
                        "You must respond with ONLY valid JSON in this exact format:\n"
                        '{"vote": "BUY" | "SELL" | "HOLD", "reasoning": "one sentence"}'
                    ),
                },
                {"role": "user", "content": stock_context},
            ],
            "max_tokens": 120,
            "temperature": 0.3,
        }
        resp = httpx.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "HTTP-Referer": "https://sharia-trader.vercel.app",
                "X-Title": "Sharia Trader Bot",
            },
            json=payload,
            timeout=20,
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"].strip()
        # Strip markdown code fences if model wraps response
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
        result = json.loads(content)
        vote = result.get("vote", "HOLD").upper()
        if vote not in ("BUY", "SELL", "HOLD"):
            vote = "HOLD"
        return {"agent": agent["name"], "vote": vote, "reasoning": result.get("reasoning", "")}
    except Exception as e:
        return {"agent": agent["name"], "vote": "HOLD", "reasoning": f"Agent unavailable: {e}"}


def _swarm_decision(ticker: str, meta: dict, price: float, sma20: float,
                    momentum_pct: float, in_position: bool, avg_price: float | None,
                    news_headlines: list) -> dict:
    """Run all 4 agents and return consensus decision."""
    headlines_text = "\n".join(f"- {h}" for h in news_headlines[:5]) if news_headlines else "No recent news."
    pct_vs_sma = round((price / sma20 - 1) * 100, 2)
    stop_pct = round((price / avg_price - 1) * 100, 2) if avg_price else None

    context = (
        f"Stock: {ticker} — {meta.get('name', ticker)} ({meta.get('sector', 'Unknown')})\n"
        f"Sharia: HALAL (AAOIFI screened, debt ratio {meta.get('debt_ratio', 'N/A')}, "
        f"haram revenue {meta.get('haram_revenue_pct', 0)}%)\n"
        f"Current price: £{price:.4f}\n"
        f"20-day SMA: £{sma20:.4f} (price is {pct_vs_sma:+.1f}% vs SMA)\n"
        f"20-day momentum: {momentum_pct:+.1f}%\n"
        f"Currently held: {'YES' if in_position else 'NO'}"
        + (f", avg entry £{avg_price:.4f} ({stop_pct:+.1f}% P&L)" if avg_price else "")
        + f"\nRecent news:\n{headlines_text}\n\n"
        "Should we BUY, SELL, or HOLD this stock right now?"
    )

    votes = [_call_agent(a, context) for a in AGENTS]
    buy_count = sum(1 for v in votes if v["vote"] == "BUY")
    sell_count = sum(1 for v in votes if v["vote"] == "SELL")

    # Consensus rules: need ≥3 votes to act, ties → HOLD
    if sell_count >= 3:
        action = "SELL"
    elif buy_count >= 3:
        action = "BUY"
    else:
        action = "HOLD"

    agent_summary = " | ".join(f"{v['agent']}: {v['vote']}" for v in votes)
    reasoning = next((v["reasoning"] for v in votes if v["vote"] == action), votes[0]["reasoning"])
    reason = f"Swarm consensus {action} ({buy_count} buy, {sell_count} sell, {4-buy_count-sell_count} hold). {reasoning} [{agent_summary}]"

    return {"action": action, "reason": reason, "agent_votes": votes}


def _sma_fallback(ticker: str, price: float, sma20: float, momentum_pct: float,
                  in_position: bool, avg_price: float | None) -> dict:
    """Simple SMA20 momentum fallback when OpenRouter is not configured."""
    if in_position and avg_price:
        stop_price = round(avg_price * 0.92, 4)
        sma_floor = round(sma20 * 0.95, 4)
        if price < stop_price:
            return {"action": "SELL", "reason": f"Stop loss hit: £{price:.2f} < stop £{stop_price:.2f}", "agent_votes": []}
        if price < sma_floor:
            return {"action": "SELL", "reason": f"Trend broken: £{price:.2f} < 95% of SMA20 £{sma_floor:.2f}", "agent_votes": []}
        pct = round((price / avg_price - 1) * 100, 2)
        return {"action": "HOLD", "reason": f"Holding: {pct:+.2f}% vs entry, SMA20 intact", "agent_votes": []}

    if price > sma20 * 1.01:
        return {"action": "BUY", "reason": f"Momentum: price {((price/sma20)-1)*100:.1f}% above SMA20, {momentum_pct:+.1f}% 20d momentum", "agent_votes": []}
    gap = round((sma20 - price) / sma20 * 100, 1)
    return {"action": "HOLD", "reason": f"No signal: price {gap:.1f}% below SMA20", "agent_votes": []}


def get_signals_batch(tickers: list, current_positions: set) -> list:
    """Batch download prices + news, then run swarm or fallback per ticker."""
    if not tickers:
        return []

    use_swarm = bool(OPENROUTER_API_KEY)
    mode = "swarm (multi-agent)" if use_swarm else "SMA20 fallback"
    print(f"  Strategy mode: {mode}")
    print(f"  Fetching price data for {len(tickers)} tickers...")

    try:
        raw = yf.download(tickers, period="3mo", auto_adjust=True, progress=False, threads=True)
        close = raw["Close"] if "Close" in raw.columns.get_level_values(0) else raw
    except Exception as e:
        print(f"  Batch download failed: {e}")
        return []

    conn = get_conn()
    positions_db = {r["ticker"]: r for r in conn.execute("SELECT * FROM positions").fetchall()}
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
                decisions.append({**base, "action": "SKIP", "reason": "No price data", "is_executed": False})
                continue

            series = col.dropna()
            if len(series) < 20:
                decisions.append({**base, "action": "SKIP", "reason": f"Insufficient data ({len(series)} days)", "is_executed": False})
                continue

            price = float(series.iloc[-1])
            sma20 = float(series.tail(20).mean())
            momentum_pct = round((price - float(series.iloc[-20])) / float(series.iloc[-20]) * 100, 2)
            base.update({"price": round(price, 4), "sma20": round(sma20, 4), "momentum_pct": momentum_pct})

            in_position = ticker in current_positions
            avg_price = float(positions_db[ticker]["avg_price"]) if in_position and ticker in positions_db else None

            # Hard stop loss — always enforce regardless of swarm (protect capital)
            if in_position and avg_price and price < avg_price * 0.92:
                decisions.append({**base, "action": "SELL",
                    "reason": f"Hard stop loss: £{price:.4f} < £{avg_price * 0.92:.4f} (8% rule, bypasses swarm)",
                    "is_executed": False})
                continue

            if use_swarm:
                # Fetch news headlines for this ticker
                news_headlines = []
                try:
                    news = yf.Ticker(ticker).news or []
                    news_headlines = [n.get("title", "") for n in news[:5] if n.get("title")]
                except Exception:
                    pass

                result = _swarm_decision(ticker, meta, price, sma20, momentum_pct,
                                         in_position, avg_price, news_headlines)
            else:
                result = _sma_fallback(ticker, price, sma20, momentum_pct, in_position, avg_price)

            decisions.append({**base, **result, "is_executed": False})

        except Exception as e:
            decisions.append({**base, "action": "SKIP", "reason": f"Error: {e}", "is_executed": False})

    return decisions


def rank_buy_signals(decisions: list) -> list:
    buys = [d for d in decisions if d["action"] == "BUY"]
    return sorted(buys, key=lambda x: x.get("momentum_pct") or 0, reverse=True)
