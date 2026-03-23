"""
Market open checker — returns whether LSE or NYSE is currently open.
Accounts for weekends, UK bank holidays, US federal holidays.
"""
from datetime import date, datetime, time
import pytz

# UK Bank Holidays 2025-2026 (England)
UK_BANK_HOLIDAYS = {
    date(2025, 1, 1), date(2025, 4, 18), date(2025, 4, 21),
    date(2025, 5, 5), date(2025, 5, 26), date(2025, 8, 25),
    date(2025, 12, 25), date(2025, 12, 26),
    date(2026, 1, 1), date(2026, 4, 3), date(2026, 4, 6),
    date(2026, 5, 4), date(2026, 5, 25), date(2026, 8, 31),
    date(2026, 12, 25), date(2026, 12, 28),
}

# US Federal Holidays 2025-2026
US_FEDERAL_HOLIDAYS = {
    date(2025, 1, 1), date(2025, 1, 20), date(2025, 2, 17),
    date(2025, 5, 26), date(2025, 6, 19), date(2025, 7, 4),
    date(2025, 9, 1), date(2025, 11, 27), date(2025, 12, 25),
    date(2026, 1, 1), date(2026, 1, 19), date(2026, 2, 16),
    date(2026, 5, 25), date(2026, 6, 19), date(2026, 7, 3),
    date(2026, 9, 7), date(2026, 11, 26), date(2026, 12, 25),
}

LSE_TZ = pytz.timezone("Europe/London")
NYSE_TZ = pytz.timezone("America/New_York")

# LSE: 08:00–16:30 London time
LSE_OPEN = time(8, 0)
LSE_CLOSE = time(16, 30)

# NYSE: 09:30–16:00 New York time
NYSE_OPEN = time(9, 30)
NYSE_CLOSE = time(16, 0)


def is_lse_open(now: datetime = None) -> bool:
    now = now or datetime.now(LSE_TZ)
    d = now.date()
    if now.weekday() >= 5:
        return False
    if d in UK_BANK_HOLIDAYS:
        return False
    t = now.time()
    return LSE_OPEN <= t <= LSE_CLOSE


def is_nyse_open(now: datetime = None) -> bool:
    now_ny = (now or datetime.now(NYSE_TZ)).astimezone(NYSE_TZ)
    d = now_ny.date()
    if now_ny.weekday() >= 5:
        return False
    if d in US_FEDERAL_HOLIDAYS:
        return False
    t = now_ny.time()
    return NYSE_OPEN <= t <= NYSE_CLOSE


def is_any_market_open() -> bool:
    return is_lse_open() or is_nyse_open()


def market_status() -> dict:
    lse = is_lse_open()
    nyse = is_nyse_open()
    return {
        "lse_open": lse,
        "nyse_open": nyse,
        "any_open": lse or nyse,
        "active_market": "LSE" if lse else ("NYSE" if nyse else None),
    }


if __name__ == "__main__":
    s = market_status()
    print(f"LSE:  {'OPEN' if s['lse_open'] else 'closed'}")
    print(f"NYSE: {'OPEN' if s['nyse_open'] else 'closed'}")
