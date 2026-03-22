import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "portfolio.db")


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
            cached_at TEXT NOT NULL
        )
    """)

    # Seed starting portfolio if empty
    row = c.execute("SELECT COUNT(*) FROM portfolio").fetchone()[0]
    if row == 0:
        c.execute(
            "INSERT INTO portfolio (cash, updated_at) VALUES (?, datetime('now'))",
            (10000.0,)
        )

    conn.commit()
    conn.close()
