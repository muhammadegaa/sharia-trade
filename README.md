# sharia-trade

Sharia-compliant paper trading bot with real-time dashboard.

- Halal universe only (AAOIFI screened — no banks, insurance, tobacco, alcohol, weapons)
- 20-day SMA momentum strategy
- 8% stop loss
- Paper trading with £10 starting capital

## Stack
- Bot: Python 3.11 + yfinance
- API: FastAPI
- Dashboard: Next.js 16 + Tailwind

## Run locally
```bash
# API
PYTHONPATH=. .venv/bin/uvicorn bot.api:app --port 8787

# Dashboard
cd dashboard && npm run dev

# Daily bot
PYTHONPATH=. .venv/bin/python3.11 bot/run.py
```
