# BRAIN.md — sharia-trader
> Read this at the start of every session. Update it at the end.

## What This Is
Automated Sharia-compliant **paper trading bot**. Screens UK/US halal stocks, generates AI signals (OpenRouter/Gemini), executes paper trades, and shows everything on a live dashboard. Fully automated — Railway runs the bot daily, Vercel hosts the dashboard.

## Sharia Rules (non-negotiable, hardcoded)
- No haram sectors: alcohol, tobacco, weapons/defence, gambling, pork, conventional banking/insurance, adult entertainment
- Debt ratio < 33% of market cap (AAOIFI standard)
- Haram revenue < 5% of total revenue (purification required if 1-5%)
- Spot stocks only — no CFDs, no options, no futures, no margin, no short selling
- Universe hardcoded in `screen.py` (35 stocks, manually verified against AAOIFI)

## Actual Stack (as built)
- **Language**: Python 3.11
- **Prices**: yfinance (free, no API key needed)
- **AI signals**: OpenRouter API → Gemini Flash 1.5 (multi-agent swarm of 4 personas)
- **Fallback signals**: 20-day SMA momentum (if OpenRouter down)
- **Storage**: SQLite (`portfolio.db`) — positions, trades, bot_runs, decision_log, pnl_daily, deposits, withdrawals
- **API**: FastAPI on Railway (uvicorn, port from $PORT)
- **Dashboard**: Next.js 16 + Tailwind + Recharts, deployed on Vercel
- **Auth**: Firebase Google Sign-In (dashboard protected)
- **Hosting**: Railway (API, 24/7) + Vercel (dashboard)
- **Alerts**: Telegram (daily run summary via TELEGRAM_BOT_TOKEN)
- **Cron**: Railway daily cron → POST /api/cron/run at 6am UTC

## Architecture
```
Railway cron (6am UTC daily)
  → POST /api/cron/run
  → bot/run.py::run()
      → market_check.py    — LSE/NYSE open? (holiday-aware)
      → screen.py          — halal universe (35 stocks, instant)
      → strategy.py        — OpenRouter AI signals (4 agent swarm)
      → execute.py         — paper trade execution + portfolio update
      → db.py              — log decisions, save pnl_daily snapshot
      → Telegram alert     — daily summary via TELEGRAM_BOT_TOKEN

Vercel dashboard (https://shariatrade.vercel.app)
  → Firebase Google Auth gate
  → Next.js page fetches from NEXT_PUBLIC_API_URL (Railway)
  → Shows: portfolio, positions, trades, P&L, bot runs, screener
```

## Environment Variables

### Railway (API server)
| Var | Purpose |
|-----|---------|
| `OPENROUTER_API_KEY` | AI signals (Gemini Flash) |
| `TELEGRAM_BOT_TOKEN` | Daily Telegram alerts |
| `TELEGRAM_CHAT_ID` | 7772379116 |
| `CRON_SECRET` | Protect /api/cron/run endpoint |
| `PORT` | Auto-set by Railway |

### Vercel (dashboard)
| Var | Purpose |
|-----|---------|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase Auth |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase Auth |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | sharia-trade |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Firebase |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase |
| `NEXT_PUBLIC_API_URL` | Railway API URL ← **SET THIS** |

## Deployment URLs
- **Dashboard**: https://shariatrade.vercel.app
- **API**: Railway (URL TBD — check Railway dashboard after deploy)

## Current State (as of 2026-03-24)
- [x] SQLite schema, £10,000 starting capital
- [x] Halal universe hardcoded in screen.py (35 stocks)
- [x] Multi-agent AI strategy via OpenRouter
- [x] Paper trade executor
- [x] FastAPI backend (all endpoints)
- [x] Next.js dashboard with Firebase Auth gate
- [x] Railway deployment files (Dockerfile, railway.json)
- [x] Vercel deployed (shariatrade.vercel.app)
- [x] Firebase env vars on Vercel
- [x] Telegram daily alerts in bot/run.py
- [ ] Railway successfully deployed (Dockerfile fix pushed — awaiting build)
- [ ] NEXT_PUBLIC_API_URL set on Vercel (need Railway URL first)
- [ ] Railway cron job configured in Railway dashboard
- [ ] TELEGRAM_BOT_TOKEN set in Railway env vars
- [ ] OPENROUTER_API_KEY set in Railway env vars
- [ ] CRON_SECRET set in Railway env vars

## Working Commands (local)
```bash
cd ~/Documents/Sides/sharia-trader

# Run bot daily (local)
PYTHONPATH=. .venv/bin/python3.11 bot/run.py

# Start API (local)
PYTHONPATH=. .venv/bin/uvicorn bot.api:app --port 8787

# Start dashboard (local)
cd dashboard && npm run dev  # → localhost:3000
```

**Python:** Must use `.venv/bin/python3.11` (NOT system python3 — that's 3.9 with LibreSSL, yfinance hangs)

## First Run Results
Bought BP.L (1.778 shares @ £562.30) and SHEL.L (0.291 shares @ £3,434) on 2026-03-22.
Portfolio: £10,000 starting capital, 2 positions.

## Paper → Live Rules
- Paper trade for minimum 2 weeks
- Need consistent positive signals, not just lucky trades
- Go live with IBKR only after clean paper run
- Never bypass Sharia screening — if unsure, skip

## Off-Limits
- Never trade on margin
- Never short sell
- Never use leveraged ETFs or derivatives
- Never bypass halal screening
- Paper trade first — always

## Last Session (2026-03-24)
- Fixed nixpacks pip issue → added Dockerfile, pushed to GitHub
- Updated railway.json to use DOCKERFILE builder
- Added Telegram alerts to bot/run.py (markets closed + daily summary)
- Updated BRAIN.md to reflect actual stack
- Remaining: Railway URL → set NEXT_PUBLIC_API_URL on Vercel → configure cron
