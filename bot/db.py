import sqlite3
import os

# On Railway, use /data (persistent volume). Locally, use bot/ directory.
_data_dir = "/data" if os.path.isdir("/data") else os.path.dirname(__file__)
DB_PATH = os.environ.get("DB_PATH", os.path.join(_data_dir, "portfolio.db"))


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_conn()
    c = conn.cursor()

    c.execute("""
        CREATE TABLE IF NOT EXISTS portfolio (
            id INTEGER PRIMARY KEY,
            cash REAL NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS positions (
            ticker TEXT PRIMARY KEY,
            shares REAL NOT NULL,
            avg_price REAL NOT NULL,
            opened_at TEXT NOT NULL
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            action TEXT NOT NULL,
            shares REAL NOT NULL,
            price REAL NOT NULL,
            value REAL NOT NULL,
            reason TEXT,
            is_manual INTEGER NOT NULL DEFAULT 0,
            executed_at TEXT NOT NULL
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            total_value REAL NOT NULL,
            cash REAL NOT NULL,
            positions_value REAL NOT NULL,
            recorded_at TEXT NOT NULL
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS screener_cache (
            ticker TEXT PRIMARY KEY,
            name TEXT,
            sector TEXT,
            is_halal INTEGER NOT NULL,
            reason TEXT,
            debt_ratio REAL,
            haram_revenue_pct REAL,
            pass_reason TEXT,
            cached_at TEXT NOT NULL
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS deposits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            amount REAL NOT NULL,
            note TEXT,
            deposited_at TEXT NOT NULL
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS withdrawals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            amount REAL NOT NULL,
            note TEXT,
            withdrawn_at TEXT NOT NULL
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS bot_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at TEXT NOT NULL,
            finished_at TEXT,
            stocks_screened INTEGER DEFAULT 0,
            signals_buy INTEGER DEFAULT 0,
            signals_sell INTEGER DEFAULT 0,
            signals_hold INTEGER DEFAULT 0,
            trades_executed INTEGER DEFAULT 0,
            portfolio_before REAL,
            portfolio_after REAL,
            market TEXT,
            notes TEXT
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS decision_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id INTEGER NOT NULL,
            ticker TEXT NOT NULL,
            name TEXT,
            sector TEXT,
            action TEXT NOT NULL,
            price REAL,
            sma20 REAL,
            momentum_pct REAL,
            reason TEXT,
            sharia_status TEXT,
            is_executed INTEGER NOT NULL DEFAULT 0,
            logged_at TEXT NOT NULL,
            FOREIGN KEY (run_id) REFERENCES bot_runs(id)
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS pnl_daily (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL UNIQUE,
            realized_pnl REAL NOT NULL DEFAULT 0,
            unrealized_pnl REAL NOT NULL DEFAULT 0,
            total_value REAL NOT NULL,
            deposits_total REAL NOT NULL DEFAULT 0
        )
    """)

    # Start with £0 — user must deposit via Add Funds
    row = c.execute("SELECT COUNT(*) FROM portfolio").fetchone()[0]
    if row == 0:
        c.execute(
            "INSERT INTO portfolio (cash, updated_at) VALUES (?, datetime('now'))",
            (0.0,)
        )

    conn.commit()
    conn.close()
