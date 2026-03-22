# BRAIN.md — sharia-trader
> Read this at the start of every session. Update it at the end.

## What This Is
Automated Sharia-compliant stock trading bot. Screens UK and US stocks via Musaffa API, executes trades via Interactive Brokers (IBKR) API, runs inside a Stocks & Shares ISA for tax-free gains. Fully automated — OpenClaw runs daily screening and executes signals. No face, no manual intervention after setup.

## Sharia Rules (non-negotiable, hardcoded)
- No haram sectors: alcohol, tobacco, weapons/defence, gambling, pork, conventional banking/insurance, adult entertainment
- Debt ratio < 33% of market cap (AAOIFI standard)
- Haram revenue < 5% of total revenue (purification required if 1-5%)
- Spot stocks only — no CFDs, no options, no futures, no margin, no short selling
- Screener source of truth: Musaffa API (`rating: halal` only — skip `doubtful`)

## Stack
- **Language**: Python (ibkr API ecosystem is Python-native)
- **Broker**: Interactive Brokers (IBKR) — covers LSE + NYSE/NASDAQ, ISA, proper API
- **Market data**: Alpha Vantage (free tier) + IBKR data feed
- **Sharia screening**: Musaffa API
- **Execution**: ib_insync (Python IBKR wrapper)
- **Scheduler**: launchd (OpenClaw runs 6am daily)
- **Alerts**: Telegram (via OpenClaw)
- **Storage**: SQLite — positions, signals, audit log, purification tracker

## Architecture
```
scheduler (6am daily)
  → screen.py       — fetch watchlist, call Musaffa, filter halal-only
  → signal.py       — apply strategy, generate BUY/SELL/HOLD signals
  → execute.py      — place orders via IBKR API
  → notify.py       — Telegram summary of actions taken
  → audit.py        — log every decision to SQLite for review
```

## Strategy (v1 — simple momentum)
- Universe: FTSE 100 (UK) + S&P 500 (US), halal-screened subset
- Signal: 20-day momentum (price vs 20-day SMA) — buy if above, sell if 5% below entry
- Position sizing: equal weight, max 10 positions, max 10% per position
- Rebalance: weekly (not daily — reduce churn and commission costs)
- Stop loss: 8% below entry price

## Current State
- [ ] Project scaffolded
- [ ] IBKR account opened (user must do this)
- [ ] Musaffa API key obtained (user must do this)
- [ ] Python environment set up
- [ ] screen.py built
- [ ] signal.py built
- [ ] execute.py built (paper trading mode first)
- [ ] notify.py built
- [ ] audit.py built
- [ ] End-to-end paper trading running
- [ ] Live trading enabled

## Accounts Needed (user must set up)
1. **IBKR account** — interactivebrokers.co.uk — free, enable ISA, enable API in settings
2. **Musaffa API key** — musaffa.com — free tier covers ~100 requests/day (enough)
3. **Alpha Vantage key** — alphavantage.co — free

## Off-Limits
- Never trade on margin
- Never short sell
- Never use leveraged ETFs or any derivative
- Never bypass Musaffa screening — if API is down, skip trading that day
- Paper trade first — live trading only after 2 weeks clean paper run

## Purification Tracker
If a stock has 1-5% haram revenue (Musaffa: `doubtful` — we skip these by default, but log if held):
- Calculate: profit × haram_revenue_% = amount to donate to charity
- Log to purification.db

## Next Tasks (priority order)
- [ ] Set up Python project structure + requirements.txt
- [ ] Build Musaffa screener module
- [ ] Build Alpha Vantage data fetcher
- [ ] Build momentum signal generator
- [ ] Build IBKR paper trading executor
- [ ] Build Telegram notifier
- [ ] Wire up daily scheduler via OpenClaw skill
- [ ] Run 2-week paper trading validation
- [ ] Go live

## Last Session Log
_[OpenClaw updates this after each session]_
- Date:
- What was done:
- Decisions made:
- Blockers hit:
- Next recommended action:
