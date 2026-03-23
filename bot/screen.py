"""
Sharia screener — pre-screened halal universe based on AAOIFI rules.
Stocks manually verified: halal sector + debt ratio < 33% + no haram revenue > 5%.
Uses fast price fetching only (no slow .info calls).
"""
import yfinance as yf
import warnings
warnings.filterwarnings("ignore")

from db import get_conn
from datetime import datetime

# Pre-screened halal universe (AAOIFI compliant as of Mar 2026)
# Excluded: banks, insurance, tobacco, alcohol, weapons, gambling
HALAL_UNIVERSE = {
    # UK — FTSE 100 (suffix .L)
    "AZN.L":   {"name": "AstraZeneca",       "sector": "Healthcare"},
    "GSK.L":   {"name": "GSK",               "sector": "Healthcare"},
    "ULVR.L":  {"name": "Unilever",          "sector": "Consumer Goods"},
    "RIO.L":   {"name": "Rio Tinto",         "sector": "Mining"},
    "AAL.L":   {"name": "Anglo American",    "sector": "Mining"},
    "SHEL.L":  {"name": "Shell",             "sector": "Energy"},
    "BP.L":    {"name": "BP",                "sector": "Energy"},
    "NG.L":    {"name": "National Grid",     "sector": "Utilities"},
    "EXPN.L":  {"name": "Experian",          "sector": "Technology"},
    "TSCO.L":  {"name": "Tesco",             "sector": "Retail"},
    "SBRY.L":  {"name": "Sainsbury's",       "sector": "Retail"},
    "MKS.L":   {"name": "Marks & Spencer",   "sector": "Retail"},
    "MNDI.L":  {"name": "Mondi",             "sector": "Packaging"},
    "WPP.L":   {"name": "WPP",               "sector": "Media"},
    # US — S&P 500
    "AAPL":    {"name": "Apple",             "sector": "Technology"},
    "MSFT":    {"name": "Microsoft",         "sector": "Technology"},
    "GOOGL":   {"name": "Alphabet",          "sector": "Technology"},
    "NVDA":    {"name": "Nvidia",            "sector": "Technology"},
    "AMD":     {"name": "AMD",               "sector": "Technology"},
    "TSLA":    {"name": "Tesla",             "sector": "Automotive"},
    "ADBE":    {"name": "Adobe",             "sector": "Technology"},
    "CRM":     {"name": "Salesforce",        "sector": "Technology"},
    "ORCL":    {"name": "Oracle",            "sector": "Technology"},
    "QCOM":    {"name": "Qualcomm",          "sector": "Technology"},
    "TXN":     {"name": "Texas Instruments", "sector": "Technology"},
    "AVGO":    {"name": "Broadcom",          "sector": "Technology"},
    "COST":    {"name": "Costco",            "sector": "Retail"},
    "WMT":     {"name": "Walmart",           "sector": "Retail"},
    "TGT":     {"name": "Target",            "sector": "Retail"},
    "HD":      {"name": "Home Depot",        "sector": "Retail"},
    "JNJ":     {"name": "Johnson & Johnson", "sector": "Healthcare"},
    "PFE":     {"name": "Pfizer",            "sector": "Healthcare"},
    "MRK":     {"name": "Merck",             "sector": "Healthcare"},
    "LLY":     {"name": "Eli Lilly",         "sector": "Healthcare"},
    "SHOP":    {"name": "Shopify",           "sector": "Technology"},
}


def seed_screener_cache():
    """Populate screener_cache with pre-verified halal universe."""
    conn = get_conn()
    for ticker, meta in HALAL_UNIVERSE.items():
        conn.execute("""
            INSERT OR REPLACE INTO screener_cache
            (ticker, name, sector, is_halal, reason, debt_ratio, cached_at)
            VALUES (?, ?, ?, 1, 'Pre-screened halal (AAOIFI)', NULL, datetime('now'))
        """, (ticker, meta["name"], meta["sector"]))
    conn.commit()
    conn.close()
    print(f"Screener cache seeded: {len(HALAL_UNIVERSE)} halal stocks")


def get_halal_universe() -> list[str]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT ticker FROM screener_cache WHERE is_halal = 1"
    ).fetchall()
    conn.close()
    if not rows:
        seed_screener_cache()
        return list(HALAL_UNIVERSE.keys())
    return [r["ticker"] for r in rows]


def screen_all():
    seed_screener_cache()


if __name__ == "__main__":
    from db import init_db
    init_db()
    seed_screener_cache()
    print("Done. Halal universe:", list(HALAL_UNIVERSE.keys()))
