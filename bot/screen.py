"""
Sharia screener — uses yfinance fundamentals, no external API needed.
Rules (AAOIFI standard):
  1. Sector not in haram list
  2. Total debt / market cap < 33%
  3. (Revenue purity — skipped at v1, no reliable free source)
"""
import yfinance as yf
from datetime import datetime
from db import get_conn

HARAM_SECTORS = {
    "Beverages—Brewers",
    "Beverages—Wineries & Distilleries",
    "Tobacco",
    "Gambling",
    "Aerospace & Defense",
    "Banks—Diversified",
    "Banks—Regional",
    "Insurance—Diversified",
    "Insurance—Life",
    "Insurance—Property & Casualty",
    "Insurance—Specialty",
    "Insurance—Reinsurance",
    "Financial Conglomerates",
    "Mortgage Finance",
    "Credit Services",
    "Capital Markets",
}

# FTSE 100 halal candidates (UK, suffix .L) + S&P 500 subset
WATCHLIST = [
    # UK — FTSE 100
    "SHEL.L", "BP.L", "RIO.L", "AAL.L", "ULVR.L",
    "AZN.L", "GSK.L", "DGE.L", "NG.L", "LGEN.L",
    "VOD.L", "BT-A.L", "EXPN.L", "SGRO.L", "LAND.L",
    "MNDI.L", "MKS.L", "TSCO.L", "SBRY.L", "WPP.L",
    # US — S&P 500 subset (tech-heavy, typically lower debt)
    "AAPL", "MSFT", "GOOGL", "AMZN", "META",
    "NVDA", "TSLA", "AMD", "INTC", "CRM",
    "ADBE", "ORCL", "QCOM", "TXN", "AVGO",
    "V", "MA", "PYPL", "SQ", "SHOP",
    "COST", "WMT", "TGT", "HD", "LOW",
    "JNJ", "PFE", "MRK", "ABBV", "LLY",
]


def screen_ticker(ticker: str) -> dict:
    try:
        info = yf.Ticker(ticker).info
        sector = info.get("sector", "")
        name = info.get("longName", ticker)
        market_cap = info.get("marketCap") or 0
        total_debt = info.get("totalDebt") or 0

        # Rule 1: sector
        if sector in HARAM_SECTORS:
            return _result(ticker, name, sector, False, f"Haram sector: {sector}", None)

        # Rule 2: debt ratio
        if market_cap > 0:
            debt_ratio = total_debt / market_cap
            if debt_ratio > 0.33:
                return _result(ticker, name, sector, False,
                               f"Debt ratio {debt_ratio:.1%} > 33%", debt_ratio)
        else:
            debt_ratio = None

        return _result(ticker, name, sector, True, "Passes AAOIFI screen", debt_ratio)

    except Exception as e:
        return _result(ticker, ticker, "", False, f"Error: {e}", None)


def _result(ticker, name, sector, is_halal, reason, debt_ratio):
    conn = get_conn()
    conn.execute("""
        INSERT OR REPLACE INTO screener_cache
        (ticker, name, sector, is_halal, reason, debt_ratio, cached_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    """, (ticker, name, sector, int(is_halal), reason, debt_ratio))
    conn.commit()
    conn.close()
    return {
        "ticker": ticker, "name": name, "sector": sector,
        "is_halal": is_halal, "reason": reason, "debt_ratio": debt_ratio
    }


def get_halal_universe() -> list[str]:
    """Return cached halal tickers (run screen_all first)."""
    conn = get_conn()
    rows = conn.execute(
        "SELECT ticker FROM screener_cache WHERE is_halal = 1"
    ).fetchall()
    conn.close()
    return [r["ticker"] for r in rows]


def screen_all():
    print(f"Screening {len(WATCHLIST)} tickers...")
    results = []
    for i, ticker in enumerate(WATCHLIST):
        r = screen_ticker(ticker)
        status = "HALAL" if r["is_halal"] else "SKIP"
        print(f"  [{i+1}/{len(WATCHLIST)}] {ticker:12} {status:6} — {r['reason']}")
        results.append(r)
    halal = [r for r in results if r["is_halal"]]
    print(f"\nUniverse: {len(halal)}/{len(WATCHLIST)} halal stocks")
    return results


if __name__ == "__main__":
    from db import init_db
    init_db()
    screen_all()
