"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, BarChart, Bar, Cell,
} from "recharts";
import { useAuth } from "../lib/auth-context";
import { savePortfolioState, saveTrade, saveFundsEvent } from "../lib/firestore-sync";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787";

// ── Login Screen ──────────────────────────────────────────────────────────────
function LoginScreen() {
  const { signInWithGoogle } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin() {
    setLoading(true);
    setError("");
    try {
      await signInWithGoogle();
    } catch (e: any) {
      setError(e.message || "Sign-in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="text-center max-w-sm w-full">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-6">
          <span className="text-3xl">☾</span>
        </div>
        <h1 className="text-white text-2xl font-bold mb-2">Sharia Trader</h1>
        <p className="text-[#555] text-sm mb-8">Halal paper trading · AAOIFI compliant</p>

        <button
          onClick={handleLogin}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl bg-white hover:bg-gray-100 disabled:opacity-50 text-gray-900 font-semibold text-sm transition-colors"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          {loading ? "Signing in..." : "Continue with Google"}
        </button>

        {error && <p className="text-red-400 text-sm mt-4">{error}</p>}

        <p className="text-[#333] text-xs mt-6">Private — only you can access this dashboard</p>
      </div>
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────
type Position = {
  ticker: string; name: string; sector: string; shares: number;
  avg_price: number; current_price: number; market_value: number;
  pnl: number; pnl_pct: number; opened_at: string;
};
type Trade = {
  id: number; ticker: string; action: string; shares: number;
  price: number; value: number; reason: string; is_manual: number; executed_at: string;
};
type Summary = {
  total_value: number; cash: number; positions_value: number;
  total_deposited: number; total_withdrawn: number; net_deposited: number;
  total_return_pct: number; total_return_gbp: number; position_count: number;
  positions: Position[];
  market: { lse_open: boolean; nyse_open: boolean; any_open: boolean; active_market: string | null };
  last_run: { id: number; started_at: string; trades_executed: number; signals_buy: number; signals_sell: number; portfolio_before: number; portfolio_after: number } | null;
};
type Snapshot = { value: number; date: string };
type BotRun = {
  id: number; started_at: string; finished_at: string; market: string;
  stocks_screened: number; signals_buy: number; signals_sell: number; signals_hold: number;
  trades_executed: number; portfolio_before: number; portfolio_after: number; notes: string;
};
type Decision = {
  ticker: string; name: string; sector: string; action: string;
  price: number; sma20: number; momentum_pct: number; reason: string;
  sharia_status: string; is_executed: number;
};
type PnlSummary = {
  total_realized: number; total_unrealized: number; total_pnl: number;
  win_rate: number; total_trades: number; wins: number; losses: number;
  best_trade: any; worst_trade: any;
};
type HalalStock = {
  ticker: string; name: string; sector: string; debt_ratio: number;
  haram_revenue_pct: number; pass_reason: string; sharia_rules: string[];
};
type ActivityEvent = {
  type: string; timestamp: string; [key: string]: any;
};

// ── Formatters ────────────────────────────────────────────────────────────────
const fmt = (n: number | undefined | null, d = 2) =>
  (n ?? 0).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n: number | undefined | null) => `${(n ?? 0) >= 0 ? "+" : ""}${fmt(n)}%`;
const gbp = (n: number) => n === 0 ? "£0.00" : `${n >= 0 ? "+" : "-"}£${fmt(Math.abs(n))}`;
const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// ── Reusable UI ───────────────────────────────────────────────────────────────
function Badge({ text, color }: { text: string; color: "green" | "red" | "yellow" | "gray" | "blue" }) {
  const cls = {
    green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    red: "bg-red-500/10 text-red-400 border-red-500/20",
    yellow: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    gray: "bg-[#1a1a1a] text-[#666] border-[#2a2a2a]",
    blue: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  }[color];
  return <span className={`px-2 py-0.5 rounded-md text-xs font-semibold border ${cls}`}>{text}</span>;
}

function StatCard({ label, value, sub, positive, small }: {
  label: string; value: string; sub?: string; positive?: boolean | null; small?: boolean;
}) {
  return (
    <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl p-5">
      <p className="text-[#555] text-xs font-medium uppercase tracking-wider mb-2">{label}</p>
      <p className={`text-white font-semibold ${small ? "text-xl" : "text-2xl"}`}>{value}</p>
      {sub && <p className={`text-sm mt-1 font-medium ${
        positive === true ? "text-emerald-400" : positive === false ? "text-red-400" : "text-[#555]"
      }`}>{sub}</p>}
    </div>
  );
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 shadow-xl">
      <p className="text-[#666] text-xs mb-1">{label}</p>
      <p className="text-white font-semibold">£{fmt(payload[0].value)}</p>
    </div>
  );
}

// ── Modals ────────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className={`bg-[#111] border border-[#222] rounded-2xl w-full ${wide ? "max-w-md" : "max-w-sm"} p-6`}>
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-white font-semibold">{title}</h3>
          <button onClick={onClose} className="text-[#666] hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DepositModal({ userId, onClose, onSuccess }: { userId?: string; onClose: () => void; onSuccess: () => void }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    const val = parseFloat(amount);
    if (!val || val <= 0) { setError("Enter a valid amount"); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/deposit`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: val, note }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || "Failed");
      const data = await res.json();
      if (userId) saveFundsEvent(userId, { type: "deposit", amount: val, note, new_cash: data.cash ?? val });
      onSuccess();
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <Modal title="Add Funds" onClose={onClose}>
      <div className="flex gap-2 mb-4">
        {[10, 50, 100, 500].map(p => (
          <button key={p} onClick={() => { setAmount(String(p)); setError(""); }}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              amount === String(p) ? "bg-emerald-500 text-black" : "bg-[#1a1a1a] text-[#888] hover:text-white border border-[#2a2a2a]"
            }`}>£{p}</button>
        ))}
      </div>
      <div className="mb-4 relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#666]">£</span>
        <input type="number" value={amount} onChange={e => { setAmount(e.target.value); setError(""); }}
          placeholder="0.00" className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl pl-8 pr-4 py-3 text-white text-lg font-semibold placeholder-[#333] focus:outline-none focus:border-emerald-500 transition-colors" />
      </div>
      <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)"
        className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 text-white text-sm placeholder-[#333] focus:outline-none focus:border-[#444] mb-6 transition-colors" />
      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
      <button onClick={submit} disabled={loading}
        className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-semibold text-sm transition-colors">
        {loading ? "Adding..." : "Confirm Deposit"}
      </button>
      <p className="text-center text-[#555] text-xs mt-4">Paper trading only — no real money</p>
    </Modal>
  );
}

function WithdrawModal({ userId, cash, onClose, onSuccess }: { userId?: string; cash: number; onClose: () => void; onSuccess: () => void }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    const val = parseFloat(amount);
    if (!val || val <= 0) { setError("Enter a valid amount"); return; }
    if (val > cash) { setError(`Max available: £${fmt(cash)}`); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/withdraw`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: val, note }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || "Failed");
      const data = await res.json();
      if (userId) saveFundsEvent(userId, { type: "withdrawal", amount: val, note, new_cash: data.cash ?? (cash - val) });
      onSuccess();
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <Modal title="Withdraw Cash" onClose={onClose}>
      <p className="text-[#555] text-sm mb-4">Available: <span className="text-white font-semibold">£{fmt(cash)}</span></p>
      <div className="mb-4 relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#666]">£</span>
        <input type="number" value={amount} onChange={e => { setAmount(e.target.value); setError(""); }}
          placeholder="0.00" max={cash}
          className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl pl-8 pr-4 py-3 text-white text-lg font-semibold placeholder-[#333] focus:outline-none focus:border-red-500 transition-colors" />
      </div>
      <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)"
        className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 text-white text-sm placeholder-[#333] focus:outline-none focus:border-[#444] mb-6 transition-colors" />
      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
      <button onClick={submit} disabled={loading}
        className="w-full py-3 rounded-xl bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white font-semibold text-sm transition-colors">
        {loading ? "Processing..." : "Confirm Withdrawal"}
      </button>
    </Modal>
  );
}

// ── ManualTradeModal — stock picker ───────────────────────────────────────────
function ManualTradeModal({ type, ticker, cash, onClose, onSuccess }: {
  type: "buy" | "sell"; ticker?: string; cash: number; onClose: () => void; onSuccess: () => void;
}) {
  const [selectedTicker, setSelectedTicker] = useState(ticker || "");
  const [selectedStock, setSelectedStock] = useState<HalalStock | null>(null);
  const [amount, setAmount] = useState("");
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [halalStocks, setHalalStocks] = useState<HalalStock[]>([]);
  const [stockSearch, setStockSearch] = useState("");
  const [fetchingPrice, setFetchingPrice] = useState(false);
  const [liveSuggestions, setLiveSuggestions] = useState<{ticker: string; name: string; exchange: string; type: string}[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Fetch halal universe on mount
  useEffect(() => {
    fetch(`${API}/api/screener`)
      .then(r => r.json())
      .then(d => setHalalStocks(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  // Fetch live price whenever selected ticker changes
  useEffect(() => {
    if (!selectedTicker) { setLivePrice(null); return; }
    setFetchingPrice(true);
    fetch(`${API}/api/price/${selectedTicker}`)
      .then(r => r.json())
      .then(d => setLivePrice(d.price ?? null))
      .catch(() => setLivePrice(null))
      .finally(() => setFetchingPrice(false));
  }, [selectedTicker]);

  // Live search via Yahoo Finance (debounced 300ms)
  useEffect(() => {
    if (stockSearch.length < 2) { setLiveSuggestions([]); return; }
    setIsSearching(true);
    const t = setTimeout(() => {
      fetch(`${API}/api/search?q=${encodeURIComponent(stockSearch)}`)
        .then(r => r.json())
        .then(d => setLiveSuggestions(Array.isArray(d) ? d : []))
        .catch(() => setLiveSuggestions([]))
        .finally(() => setIsSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [stockSearch]);

  const halalTickers = new Set(halalStocks.map(s => s.ticker));

  const filteredStocks = halalStocks.filter(s =>
    !stockSearch ||
    s.ticker.toLowerCase().includes(stockSearch.toLowerCase()) ||
    s.name?.toLowerCase().includes(stockSearch.toLowerCase()) ||
    s.sector?.toLowerCase().includes(stockSearch.toLowerCase())
  );

  // When typing, prefer live suggestions; otherwise show halal universe
  const showLive = stockSearch.length >= 2;

  function selectStock(stock: HalalStock | {ticker: string; name: string; exchange?: string; type?: string}) {
    setSelectedTicker(stock.ticker);
    // If it's in the halal universe, attach full metadata; otherwise just name
    const halal = halalStocks.find(h => h.ticker === stock.ticker) ?? null;
    setSelectedStock(halal);
    setStockSearch("");
    setLiveSuggestions([]);
    setError("");
  }

  async function submit() {
    setLoading(true);
    try {
      const endpoint = type === "buy" ? "/api/trade/buy" : "/api/trade/sell";
      const body = type === "buy"
        ? { ticker: selectedTicker, amount: parseFloat(amount) }
        : { ticker: selectedTicker };
      const res = await fetch(`${API}${endpoint}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).detail || "Trade failed");
      onSuccess();
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }

  const estimatedShares = amount && livePrice && parseFloat(amount) > 0
    ? parseFloat(amount) / livePrice
    : null;

  return (
    <Modal title={type === "buy" ? "Manual Buy" : "Manual Sell"} onClose={onClose} wide>
      {/* Stock picker — only shown when no ticker is pre-selected */}
      {!ticker && (
        <div className="mb-5">
          <label className="text-[#555] text-xs uppercase tracking-wider mb-2 block">Select stock</label>
          {/* Search */}
          <div className="relative mb-2">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#555]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={stockSearch}
              onChange={e => setStockSearch(e.target.value)}
              placeholder="Search ticker, name or sector..."
              className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl pl-9 pr-4 py-2.5 text-white text-sm placeholder-[#444] focus:outline-none focus:border-emerald-500/50 transition-colors"
              autoFocus
            />
          </div>

          {/* Scrollable stock list */}
          <div className="rounded-xl border border-[#2a2a2a] overflow-hidden" style={{ maxHeight: 300, overflowY: "scroll" }}>
            {isSearching ? (
              <div className="flex items-center justify-center py-8">
                <p className="text-[#444] text-sm">Searching...</p>
              </div>
            ) : showLive ? (
              liveSuggestions.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <p className="text-[#444] text-sm">No results for "{stockSearch}"</p>
                </div>
              ) : liveSuggestions.map(s => {
                const isSelected = selectedTicker === s.ticker;
                const isHalal = halalTickers.has(s.ticker);
                return (
                  <button
                    key={s.ticker}
                    onClick={() => selectStock(s)}
                    className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors border-b border-[#1a1a1a] last:border-0 ${
                      isSelected ? "bg-emerald-500/10" : "bg-[#0f0f0f] hover:bg-[#161616]"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`font-bold text-sm ${isSelected ? "text-emerald-400" : "text-white"}`}>{s.ticker}</span>
                        {isHalal && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-medium">☾ Halal</span>
                        )}
                        {s.exchange && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#1a1a1a] text-[#555] border border-[#2a2a2a] font-medium">{s.exchange}</span>
                        )}
                      </div>
                      <p className="text-[#555] text-xs mt-0.5 truncate">{s.name}</p>
                    </div>
                  </button>
                );
              })
            ) : filteredStocks.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <p className="text-[#444] text-sm">No halal stocks match</p>
              </div>
            ) : filteredStocks.map(stock => {
              const isSelected = selectedTicker === stock.ticker;
              return (
                <button
                  key={stock.ticker}
                  onClick={() => selectStock(stock)}
                  className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors border-b border-[#1a1a1a] last:border-0 ${
                    isSelected ? "bg-emerald-500/10 border-l-2 border-l-emerald-500" : "bg-[#0f0f0f] hover:bg-[#161616]"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`font-bold text-sm ${isSelected ? "text-emerald-400" : "text-white"}`}>{stock.ticker}</span>
                      {stock.sector && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#1a1a1a] text-[#555] border border-[#2a2a2a] font-medium truncate max-w-[80px]">{stock.sector}</span>
                      )}
                    </div>
                    <p className="text-[#555] text-xs mt-0.5 truncate">{stock.name}</p>
                  </div>
                  {isSelected && (
                    <svg className="w-4 h-4 text-emerald-400 flex-shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Selected stock + live price */}
      {selectedTicker && (
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 mb-4 flex items-center justify-between">
          <div>
            <span className="text-white font-bold">{selectedTicker}</span>
            {selectedStock && <span className="text-[#555] text-xs ml-2">{selectedStock.name}</span>}
          </div>
          <div className="text-right">
            {fetchingPrice ? (
              <span className="text-[#555] text-xs">Fetching price...</span>
            ) : livePrice ? (
              <span className="text-white font-semibold">£{fmt(livePrice, 4)}</span>
            ) : (
              <span className="text-[#444] text-xs">Price unavailable</span>
            )}
          </div>
        </div>
      )}

      {/* Amount input for buy */}
      {type === "buy" && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-[#555] text-xs uppercase tracking-wider">Amount</label>
            <span className="text-[#444] text-xs">Available: <span className="text-white font-medium">£{fmt(cash)}</span></span>
          </div>
          {/* Quick select */}
          <div className="flex gap-2 mb-2">
            {[10, 25, 50, 100].map(p => (
              <button key={p} onClick={() => { setAmount(String(p)); setError(""); }}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  amount === String(p) ? "bg-emerald-500 text-black" : "bg-[#1a1a1a] text-[#777] hover:text-white border border-[#2a2a2a]"
                }`}>£{p}</button>
            ))}
          </div>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#666]">£</span>
            <input
              type="number"
              value={amount}
              onChange={e => { setAmount(e.target.value); setError(""); }}
              placeholder="0.00"
              max={cash}
              className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl pl-8 pr-4 py-3 text-white text-lg font-semibold placeholder-[#333] focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>
          {estimatedShares !== null && (
            <p className="text-[#555] text-xs mt-1.5">
              approx. <span className="text-[#888]">{fmt(estimatedShares, 4)} shares</span>
            </p>
          )}
        </div>
      )}

      {type === "sell" && (
        <p className="text-[#666] text-sm mb-6">
          Sell entire position in <span className="text-white font-semibold">{ticker}</span> at market price.
        </p>
      )}

      <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl px-4 py-3 mb-6">
        <p className="text-emerald-400 text-xs">☾ Sharia compliant — verified against AAOIFI criteria</p>
      </div>
      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
      <button
        onClick={submit}
        disabled={loading || !selectedTicker || (type === "buy" && (!amount || parseFloat(amount) <= 0))}
        className={`w-full py-3 rounded-xl font-semibold text-sm transition-colors disabled:opacity-50 ${
          type === "buy" ? "bg-emerald-500 hover:bg-emerald-400 text-black" : "bg-red-500 hover:bg-red-400 text-white"
        }`}
      >
        {loading ? "Executing..." : type === "buy" ? "Confirm Buy" : "Confirm Sell"}
      </button>
    </Modal>
  );
}

function SellConfirmModal({ ticker, onClose, onSuccess }: { ticker: string; onClose: () => void; onSuccess: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/trade/sell`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || "Failed");
      onSuccess();
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <Modal title="Confirm Sell" onClose={onClose}>
      <p className="text-[#888] text-sm mb-6">Sell entire position in <span className="text-white font-semibold">{ticker}</span> at current market price?</p>
      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
      <div className="flex gap-3">
        <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] text-[#888] text-sm">Cancel</button>
        <button onClick={confirm} disabled={loading} className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white font-semibold text-sm transition-colors">
          {loading ? "Selling..." : "Sell"}
        </button>
      </div>
    </Modal>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────
function EmptyState({ onDeposit }: { onDeposit: () => void }) {
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 rounded-2xl bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center mx-auto mb-6">
          <span className="text-3xl">☾</span>
        </div>
        <h2 className="text-white text-xl font-semibold mb-2">Add funds to start</h2>
        <p className="text-[#666] text-sm mb-4 leading-relaxed">
          Paper trading with real market data.<br />Halal-screened stocks only (AAOIFI).
        </p>
        <div className="bg-[#111] border border-[#1e1e1e] rounded-xl p-4 mb-8 text-left space-y-2">
          {["No banks, insurance, alcohol, tobacco, weapons", "Debt ratio < 33% of total assets", "Haram revenue < 5% of total revenue", "Profit purification for borderline holdings"].map(r => (
            <div key={r} className="flex items-center gap-2">
              <span className="text-emerald-400 text-xs">✓</span>
              <span className="text-[#666] text-xs">{r}</span>
            </div>
          ))}
        </div>
        <button onClick={onDeposit} className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-sm transition-colors">
          Add Funds
        </button>
      </div>
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
type Tab = "portfolio" | "activity" | "pnl" | "sharia";

// ── Position Card ─────────────────────────────────────────────────────────────
function PositionCard({ position, onSell }: { position: Position; onSell: () => void }) {
  const isUp = position.pnl >= 0;
  return (
    <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl p-5">
      <div className="flex items-start justify-between mb-3">
        {/* Left: ticker + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-white text-xl font-bold">{position.ticker}</span>
          </div>
          <p className="text-[#555] text-xs truncate">{position.name}</p>
          {position.sector && (
            <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] bg-[#1a1a1a] text-[#555] border border-[#2a2a2a] font-medium">
              {position.sector}
            </span>
          )}
        </div>

        {/* Right: value + P&L */}
        <div className="text-right flex-shrink-0 ml-4">
          <p className="text-white text-lg font-bold">£{fmt(position.market_value)}</p>
          <p className={`text-sm font-semibold ${isUp ? "text-emerald-400" : "text-red-400"}`}>
            {gbp(position.pnl)}
          </p>
          <p className={`text-xs ${isUp ? "text-emerald-400/70" : "text-red-400/70"}`}>
            {pct(position.pnl_pct)}
          </p>
        </div>
      </div>

      {/* Bottom row: avg price · shares + sell button */}
      <div className="flex items-center justify-between pt-3 border-t border-[#1a1a1a]">
        <p className="text-[#444] text-xs">
          Avg £{fmt(position.avg_price, 4)} · {fmt(position.shares, 4)} shares
        </p>
        <button
          onClick={onSell}
          className="px-3 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium transition-colors border border-red-500/20"
        >
          Sell
        </button>
      </div>
    </div>
  );
}

// ── PORTFOLIO TAB ─────────────────────────────────────────────────────────────
function PortfolioTab({ summary, snapshots, trades, onSell, onReload }: {
  summary: Summary; snapshots: Snapshot[]; trades: Trade[];
  onSell: (ticker: string) => void; onReload: () => void;
}) {
  const [subTab, setSubTab] = useState<"positions" | "trades">("positions");
  const isUp = summary.total_return_gbp >= 0;
  const chartColor = isUp ? "#10b981" : "#f87171";
  const chartData = snapshots.map(s => ({
    date: new Date(s.date).toLocaleDateString("en-GB", { month: "short", day: "numeric" }),
    value: s.value,
  }));

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl p-6">
        <p className="text-[#555] text-sm mb-1">Portfolio value</p>
        <div className="flex items-end gap-4 mb-1">
          <h2 className="text-white text-4xl font-bold">£{fmt(summary.total_value)}</h2>
          <span className={`text-lg font-semibold mb-0.5 ${isUp ? "text-emerald-400" : "text-red-400"}`}>
            {pct(summary.total_return_pct)}
          </span>
        </div>
        <p className="text-[#555] text-sm">
          {gbp(summary.total_return_gbp)} · deposited £{fmt(summary.net_deposited)}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Cash" value={`£${fmt(summary.cash)}`}
          sub={`${summary.total_value > 0 ? ((summary.cash / summary.total_value) * 100).toFixed(0) : 0}% of portfolio`} positive={null} />
        <StatCard label="Invested" value={`£${fmt(summary.positions_value)}`}
          sub={`${summary.position_count} position${summary.position_count !== 1 ? "s" : ""}`} positive={null} />
        <StatCard label="All-time return" value={gbp(summary.total_return_gbp)}
          sub={pct(summary.total_return_pct)} positive={isUp} />
      </div>

      {/* Chart */}
      <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl p-6">
        <h3 className="text-[#555] text-xs font-medium uppercase tracking-wider mb-6">Performance</h3>
        {chartData.length < 2 ? (
          <div className="h-40 flex items-center justify-center">
            <p className="text-[#333] text-sm">Chart appears after a few bot runs</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData}>
              <XAxis dataKey="date" tick={{ fill: "#555", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#555", fontSize: 11 }} axisLine={false} tickLine={false}
                tickFormatter={v => `£${v}`} width={60} />
              <Tooltip content={<ChartTooltip />} />
              <ReferenceLine y={summary.net_deposited} stroke="#333" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="value" stroke={chartColor} strokeWidth={2}
                dot={false} activeDot={{ r: 4, fill: chartColor }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Sub-tabs */}
      <div>
        <div className="flex gap-1 mb-4 bg-[#111] border border-[#1e1e1e] rounded-xl p-1 w-fit">
          {(["positions", "trades"] as const).map(t => (
            <button key={t} onClick={() => setSubTab(t)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${
                subTab === t ? "bg-[#1e1e1e] text-white" : "text-[#555] hover:text-[#888]"
              }`}>
              {t}
              {t === "positions" && summary.position_count > 0 && <span className="ml-2 text-xs text-[#444]">{summary.position_count}</span>}
              {t === "trades" && trades.length > 0 && <span className="ml-2 text-xs text-[#444]">{trades.length}</span>}
            </button>
          ))}
        </div>

        {/* Positions — card layout */}
        {subTab === "positions" && (
          summary.positions.length === 0 ? (
            <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl p-8 text-center">
              <p className="text-[#333] text-sm">No open positions — bot buys on momentum signals</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {summary.positions.map(p => (
                <PositionCard key={p.ticker} position={p} onSell={() => onSell(p.ticker)} />
              ))}
            </div>
          )
        )}

        {/* Trades — list with colored left border */}
        {subTab === "trades" && (
          trades.length === 0 ? (
            <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl p-8 text-center">
              <p className="text-[#333] text-sm">No trades yet</p>
            </div>
          ) : (
            <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl overflow-hidden">
              {trades.map((t, i) => (
                <div
                  key={t.id}
                  className={`flex items-center gap-4 px-5 py-3.5 border-l-2 ${
                    t.action === "BUY" ? "border-l-emerald-500" : "border-l-red-500"
                  } ${i < trades.length - 1 ? "border-b border-[#1a1a1a]" : ""}`}
                >
                  <div className="flex-shrink-0">
                    <Badge text={t.action} color={t.action === "BUY" ? "green" : "red"} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-white text-sm font-semibold">{t.ticker}</span>
                      {t.is_manual === 1 && <Badge text="manual" color="blue" />}
                    </div>
                    <p className="text-[#444] text-xs truncate mt-0.5">{t.reason}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-white text-sm font-medium">£{fmt(t.value)}</p>
                    <p className="text-[#555] text-xs">{fmt(t.shares, 4)} sh @ £{fmt(t.price, 4)}</p>
                  </div>
                  <div className="text-right flex-shrink-0 hidden sm:block">
                    <p className="text-[#444] text-xs whitespace-nowrap">{fmtDate(t.executed_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}

// ── ACTIVITY TAB ──────────────────────────────────────────────────────────────
function ActivityTab() {
  const [runs, setRuns] = useState<BotRun[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loadingDecisions, setLoadingDecisions] = useState(false);
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/runs`).then(r => r.json()).catch(() => []),
      fetch(`${API}/api/activity`).then(r => r.json()).catch(() => []),
    ]).then(([r, a]) => {
      setRuns(Array.isArray(r) ? r : []);
      setEvents(Array.isArray(a) ? a : []);
    });
  }, []);

  async function expandRun(id: number) {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    setLoadingDecisions(true);
    const data = await fetch(`${API}/api/runs/${id}`).then(r => r.json());
    setDecisions(data.decisions || []);
    setLoadingDecisions(false);
  }

  const actionColor = (a: string) =>
    a === "BUY" ? "green" : a === "SELL" ? "red" : a === "HOLD" ? "gray" : "yellow";

  return (
    <div className="space-y-6">
      {/* Bot runs */}
      <div>
        <h3 className="text-[#555] text-xs font-medium uppercase tracking-wider mb-4">Bot runs</h3>
        {runs.length === 0 ? (
          <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl p-8 text-center">
            <p className="text-[#333] text-sm">No bot runs yet — runs automatically at market open</p>
          </div>
        ) : (
          <div className="space-y-2">
            {runs.map(run => {
              const change = run.portfolio_after - run.portfolio_before;
              const isOpen = expanded === run.id;
              return (
                <div key={run.id} className="bg-[#111] border border-[#1e1e1e] rounded-2xl overflow-hidden">
                  <button onClick={() => expandRun(run.id)} className="w-full px-5 py-4 flex items-center gap-4 hover:bg-[#161616] transition-colors text-left">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-emerald-400 text-xs font-bold">#{run.id}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-white text-sm font-medium">{fmtDate(run.started_at)}</span>
                        {run.market && <Badge text={run.market} color="blue" />}
                      </div>
                      <div className="text-[#555] text-xs">
                        {run.stocks_screened} screened · {run.signals_buy} buy · {run.signals_sell} sell · {run.signals_hold} hold · {run.trades_executed} executed
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className={`text-sm font-semibold ${change >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {change >= 0 ? "+" : ""}£{fmt(Math.abs(change))}
                      </div>
                      <div className="text-[#444] text-xs mt-0.5">{isOpen ? "▲" : "▼"}</div>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-[#1a1a1a] px-5 py-4">
                      {loadingDecisions ? (
                        <div className="flex items-center justify-center py-8">
                          <div className="w-5 h-5 border-2 border-[#333] border-t-emerald-500 rounded-full animate-spin" />
                        </div>
                      ) : (
                        <div>
                          <p className="text-[#444] text-xs uppercase tracking-wider mb-3">Decision log — every stock considered</p>
                          <div className="space-y-1">
                            {decisions.map((d, i) => (
                              <div key={i} className="flex items-start gap-3 py-2 border-b border-[#161616] last:border-0">
                                <Badge text={d.action} color={actionColor(d.action) as any} />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-white text-xs font-semibold">{d.ticker}</span>
                                    <span className="text-[#444] text-xs">{d.name}</span>
                                    {d.is_executed === 1 && <span className="text-emerald-400 text-xs">✓ executed</span>}
                                  </div>
                                  <p className="text-[#555] text-xs mt-0.5 leading-relaxed">{d.reason}</p>
                                  {d.price && (
                                    <div className="flex gap-4 mt-1">
                                      <span className="text-[#444] text-xs">Price: £{fmt(d.price, 4)}</span>
                                      {d.sma20 && <span className="text-[#444] text-xs">SMA20: £{fmt(d.sma20, 4)}</span>}
                                      {d.momentum_pct != null && <span className="text-[#444] text-xs">Momentum: {pct(d.momentum_pct)}</span>}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Event feed */}
      <div>
        <h3 className="text-[#555] text-xs font-medium uppercase tracking-wider mb-4">All events</h3>
        <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl overflow-hidden">
          {events.length === 0 ? (
            <div className="p-8 text-center"><p className="text-[#333] text-sm">No events yet</p></div>
          ) : events.map((e, i) => (
            <div key={i} className={`flex items-center gap-4 px-5 py-3 ${i < events.length - 1 ? "border-b border-[#1a1a1a]" : ""}`}>
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{
                background: e.type === "deposit" ? "#10b981" : e.type === "withdrawal" ? "#f87171" :
                  e.type === "trade" ? (e.action === "BUY" ? "#10b981" : "#f87171") : "#6366f1"
              }} />
              <div className="flex-1 min-w-0">
                <span className="text-white text-sm">
                  {e.type === "deposit" && `Deposited £${fmt(e.amount)}`}
                  {e.type === "withdrawal" && `Withdrew £${fmt(e.amount)}`}
                  {e.type === "trade" && `${e.action} ${e.ticker} — £${fmt(e.value)}`}
                  {e.type === "bot_run" && `Bot run #${e.id} — ${e.trades_executed ?? 0} trades`}
                </span>
                {e.note && <span className="text-[#444] text-xs ml-2">{e.note}</span>}
              </div>
              <span className="text-[#444] text-xs flex-shrink-0">{fmtDate(e.timestamp)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── P&L TAB ───────────────────────────────────────────────────────────────────
function PnlTab() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch(`${API}/api/pnl`).then(r => r.json()).then(d => {
      if (d && typeof d === "object") setData(d);
    }).catch(() => setData({}));
  }, []);

  if (!data) return <div className="flex items-center justify-center py-20"><div className="w-5 h-5 border-2 border-[#333] border-t-emerald-500 rounded-full animate-spin" /></div>;

  const s: PnlSummary = data.summary ?? {
    total_pnl: 0, total_realized: 0, total_unrealized: 0,
    win_rate: 0, total_trades: 0, wins: 0, losses: 0,
    best_trade: null, worst_trade: null,
  };
  const daily = Array.isArray(data.daily) ? data.daily : [];
  const purification = Array.isArray(data.purification) ? data.purification : [];

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4">
        <StatCard label="Total P&L" value={gbp(s.total_pnl)} sub={s.total_pnl >= 0 ? "Overall gain" : "Overall loss"} positive={s.total_pnl >= 0} small />
        <StatCard label="Win rate" value={`${fmt(s.win_rate, 0)}%`} sub={`${s.wins} wins / ${s.losses} losses`} positive={s.win_rate >= 50} small />
        <StatCard label="Realized P&L" value={gbp(s.total_realized)} sub="Closed trades" positive={s.total_realized >= 0} small />
        <StatCard label="Unrealized P&L" value={gbp(s.total_unrealized)} sub="Open positions" positive={s.total_unrealized >= 0} small />
      </div>

      {/* Best / worst */}
      {(s.best_trade || s.worst_trade) && (
        <div className="grid grid-cols-2 gap-4">
          {s.best_trade && (
            <div className="bg-[#111] border border-emerald-500/20 rounded-2xl p-5">
              <p className="text-emerald-400 text-xs font-medium uppercase tracking-wider mb-2">Best trade</p>
              <p className="text-white font-semibold">{s.best_trade.ticker}</p>
              <p className="text-emerald-400 text-lg font-bold">{gbp(s.best_trade.pnl)}</p>
              <p className="text-[#555] text-xs mt-1">{fmtDate(s.best_trade.executed_at)}</p>
            </div>
          )}
          {s.worst_trade && (
            <div className="bg-[#111] border border-red-500/20 rounded-2xl p-5">
              <p className="text-red-400 text-xs font-medium uppercase tracking-wider mb-2">Worst trade</p>
              <p className="text-white font-semibold">{s.worst_trade.ticker}</p>
              <p className="text-red-400 text-lg font-bold">{gbp(s.worst_trade.pnl)}</p>
              <p className="text-[#555] text-xs mt-1">{fmtDate(s.worst_trade.executed_at)}</p>
            </div>
          )}
        </div>
      )}

      {/* Daily chart */}
      {daily.length > 1 && (
        <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl p-6">
          <h3 className="text-[#555] text-xs font-medium uppercase tracking-wider mb-6">Daily P&L</h3>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={daily}>
              <XAxis dataKey="date" tick={{ fill: "#555", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#555", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `£${v}`} width={55} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="realized_pnl" radius={[3, 3, 0, 0]}>
                {daily.map((d: any, i: number) => <Cell key={i} fill={d.realized_pnl >= 0 ? "#10b981" : "#f87171"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Realized trades */}
      <div>
        <h3 className="text-[#555] text-xs font-medium uppercase tracking-wider mb-4">Realized trades</h3>
        {(data.realized ?? []).length === 0 ? (
          <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl p-8 text-center">
            <p className="text-[#333] text-sm">No closed trades yet</p>
          </div>
        ) : (
          <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1e1e1e]">
                  {["Date", "Ticker", "Bought @", "Sold @", "Shares", "P&L"].map(h => (
                    <th key={h} className="text-left text-[#444] text-xs font-medium uppercase tracking-wider px-5 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data.realized ?? []).map((t: any, i: number) => (
                  <tr key={t.id} className={i < data.realized.length - 1 ? "border-b border-[#1a1a1a]" : ""}>
                    <td className="px-5 py-3 text-[#555] text-xs whitespace-nowrap">{fmtDate(t.executed_at)}</td>
                    <td className="px-5 py-3 text-white font-medium">{t.ticker}</td>
                    <td className="px-5 py-3 text-[#888]">£{fmt(t.buy_price, 4)}</td>
                    <td className="px-5 py-3 text-[#888]">£{fmt(t.sell_price, 4)}</td>
                    <td className="px-5 py-3 text-[#888]">{fmt(t.shares, 4)}</td>
                    <td className="px-5 py-3">
                      <span className={t.pnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                        {gbp(t.pnl)} <span className="text-xs opacity-70">({pct(t.pnl_pct)})</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Purification */}
      {purification.length > 0 && (
        <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-2xl p-5">
          <h3 className="text-yellow-400 text-xs font-medium uppercase tracking-wider mb-3">☾ Profit purification required</h3>
          <p className="text-[#888] text-xs mb-4 leading-relaxed">
            Some holdings have borderline impermissible revenue (&lt;5%). Per AAOIFI standards, donate that percentage of your profit from these stocks to charity.
          </p>
          <div className="space-y-2">
            {purification.map((p: any) => (
              <div key={p.ticker} className="flex items-center justify-between">
                <div>
                  <span className="text-white text-sm font-medium">{p.ticker}</span>
                  <span className="text-[#555] text-xs ml-2">{p.name}</span>
                </div>
                <span className="text-yellow-400 text-sm font-semibold">Donate {p.haram_revenue_pct}% of profit</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── SHARIA TAB ────────────────────────────────────────────────────────────────
type ShariaCheckResult = {
  ticker: string; name: string; sector: string; source: string;
  overall: "compliant" | "non-compliant" | "review" | string;
  criteria: { name: string; result: string; detail: string; proof: string; values?: Record<string, any> }[];
  pass_reason?: string; purification_pct?: number;
  market_cap?: number; exchange?: string; error?: string;
};

const AAOIFI_CRITERIA = [
  {
    rule: "Business Activity",
    detail: "No banks, insurance, alcohol, tobacco, weapons, pork, gambling, or adult content",
    proof: "AAOIFI Standard 21 — Quran 5:90 ('intoxicants and gambling are abomination'); Quran 2:275 (riba prohibited)",
    icon: "☾",
  },
  {
    rule: "Debt Ratio < 33%",
    detail: "Total debt / total assets must be less than 33% — excessive leverage resembles riba",
    proof: "AAOIFI Standard 21, §3.2 — based on ruling that majority of assets must be tangible (Quran 2:275–279)",
    icon: "⚖",
  },
  {
    rule: "Haram Revenue < 5%",
    detail: "Non-permissible revenue / total revenue must be less than 5% of total income",
    proof: "AAOIFI Standard 21, §4.1 — Hadith: 'Every flesh nourished by haram is more deserving of fire' (Tirmidhi 614)",
    icon: "%",
  },
  {
    rule: "Purification",
    detail: "If haram revenue is 0–5%, donate that same % of profit to a charitable cause",
    proof: "AAOIFI Standard 21, §4.2 — purification (tathir) cleanses any residual impermissible earnings",
    icon: "♡",
  },
];

function ShariaTab({ summary }: { summary: Summary | null }) {
  const [stocks, setStocks] = useState<HalalStock[]>([]);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [checkTicker, setCheckTicker] = useState("");
  const [checkResult, setCheckResult] = useState<ShariaCheckResult | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/screener`).then(r => r.json()).then(d => {
      setStocks(Array.isArray(d) ? d : []);
    }).catch(() => {});
  }, []);

  const filtered = stocks.filter(s =>
    s.ticker.toLowerCase().includes(filter.toLowerCase()) ||
    s.name?.toLowerCase().includes(filter.toLowerCase()) ||
    s.sector?.toLowerCase().includes(filter.toLowerCase())
  );

  async function runCheck() {
    if (!checkTicker.trim()) return;
    setChecking(true); setCheckResult(null);
    try {
      const res = await fetch(`${API}/api/sharia/check?ticker=${encodeURIComponent(checkTicker.trim())}`);
      setCheckResult(await res.json());
    } catch { setCheckResult({ ticker: checkTicker, error: "Request failed", name: "", sector: "", source: "live", overall: "review", criteria: [] }); }
    finally { setChecking(false); }
  }

  // Purification summary from current holdings
  const purificationItems: { ticker: string; name: string; pct: number; holdingValue: number; donateAmount: number }[] = [];
  if (summary?.positions) {
    for (const pos of summary.positions) {
      const meta = stocks.find(s => s.ticker === pos.ticker);
      const pct = meta?.haram_revenue_pct || 0;
      if (pct > 0) {
        const holdingValue = pos.market_value || 0;
        purificationItems.push({
          ticker: pos.ticker, name: meta?.name || pos.ticker, pct,
          holdingValue, donateAmount: holdingValue * (pct / 100),
        });
      }
    }
  }

  const resultColor = (r: string) =>
    r === "pass" ? "text-emerald-400" : r === "fail" ? "text-red-400" : r === "purify" ? "text-yellow-400" : "text-[#888]";
  const resultLabel = (r: string) =>
    r === "pass" ? "Pass" : r === "fail" ? "Fail" : r === "purify" ? "Purify" : r === "unknown" ? "No data" : "Review";
  const overallBadge = (o: string) =>
    o === "compliant" ? <Badge text="Compliant" color="green" /> :
    o === "non-compliant" ? <Badge text="Non-Compliant" color="red" /> :
    <Badge text="Needs Review" color="yellow" />;

  return (
    <div className="space-y-6">
      {/* AAOIFI criteria with scholarly references */}
      <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl p-5">
        <h3 className="text-white font-semibold mb-1">AAOIFI Screening Criteria</h3>
        <p className="text-[#555] text-xs mb-4">Accounting and Auditing Organisation for Islamic Financial Institutions — Standard 21</p>
        <div className="grid grid-cols-2 gap-3">
          {AAOIFI_CRITERIA.map(r => (
            <div key={r.rule} className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-emerald-400 text-xs">{r.icon}</span>
                <span className="text-white text-xs font-semibold">{r.rule}</span>
              </div>
              <p className="text-[#555] text-xs leading-relaxed mb-2">{r.detail}</p>
              <p className="text-[#333] text-xs italic leading-relaxed border-t border-[#1a1a1a] pt-2">{r.proof}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Live screener — check any stock */}
      <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl p-5">
        <h3 className="text-white font-semibold mb-1">Screen Any Stock</h3>
        <p className="text-[#555] text-xs mb-4">Enter any ticker for a live AAOIFI compliance check using public balance sheet data</p>
        <div className="flex gap-3">
          <input
            value={checkTicker} onChange={e => setCheckTicker(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === "Enter" && runCheck()}
            placeholder="e.g. TSLA, AMZN, HSBA.L"
            className="flex-1 bg-[#0f0f0f] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-sm placeholder-[#333] focus:outline-none focus:border-emerald-500 transition-colors"
          />
          <button onClick={runCheck} disabled={checking || !checkTicker.trim()}
            className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-black text-sm font-semibold transition-colors">
            {checking ? "Checking..." : "Check"}
          </button>
        </div>

        {checkResult && !checkResult.error && (
          <div className="mt-4 bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-white font-semibold">{checkResult.name}</span>
                <span className="text-[#555] text-xs ml-2">{checkResult.ticker}</span>
                {checkResult.sector && <span className="text-[#444] text-xs ml-2">· {checkResult.sector}</span>}
              </div>
              {overallBadge(checkResult.overall)}
            </div>
            <div className="space-y-3">
              {checkResult.criteria.map(c => (
                <div key={c.name} className="border border-[#1a1a1a] rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[#888] text-xs font-medium">{c.name}</span>
                    <span className={`text-xs font-semibold ${resultColor(c.result)}`}>{resultLabel(c.result)}</span>
                  </div>
                  <p className="text-[#666] text-xs mb-1.5">{c.detail}</p>
                  <p className="text-[#333] text-xs italic border-t border-[#1a1a1a] pt-2">{c.proof}</p>
                </div>
              ))}
            </div>
            {checkResult.source === "live" && (
              <p className="text-[#333] text-xs">* Live data from public filings. Haram revenue estimate is based on sector classification — consult annual report for exact breakdown.</p>
            )}
          </div>
        )}
        {checkResult?.error && (
          <p className="mt-3 text-red-400 text-xs">{checkResult.ticker}: {checkResult.error}</p>
        )}
      </div>

      {/* Purification calculator */}
      {purificationItems.length > 0 && (
        <div className="bg-[#111] border border-yellow-500/20 rounded-2xl p-5">
          <h3 className="text-white font-semibold mb-1">Purification Required</h3>
          <p className="text-[#555] text-xs mb-4">You hold stocks with minor haram revenue. Donate the corresponding % of your holding value to charity (AAOIFI §4.2).</p>
          <div className="space-y-3">
            {purificationItems.map(p => (
              <div key={p.ticker} className="flex items-center justify-between py-3 border-b border-[#1a1a1a] last:border-0">
                <div>
                  <span className="text-white text-sm font-semibold">{p.ticker}</span>
                  <span className="text-[#555] text-xs ml-2">{p.name}</span>
                  <span className="text-yellow-400 text-xs ml-2">{p.pct}% haram rev</span>
                </div>
                <div className="text-right">
                  <p className="text-yellow-400 text-sm font-semibold">£{p.donateAmount.toFixed(2)}</p>
                  <p className="text-[#444] text-xs">of £{p.holdingValue.toFixed(2)} holding</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-[#1a1a1a] flex justify-between">
            <span className="text-[#555] text-xs">Total to donate</span>
            <span className="text-yellow-400 text-sm font-bold">£{purificationItems.reduce((a, p) => a + p.donateAmount, 0).toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Screened stock list */}
      <div>
        <input
          type="text" value={filter} onChange={e => setFilter(e.target.value)}
          placeholder="Filter by ticker, name or sector..."
          className="w-full bg-[#111] border border-[#1e1e1e] rounded-xl px-4 py-3 text-white text-sm placeholder-[#333] focus:outline-none focus:border-[#444] transition-colors mb-4"
        />
        <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-[#1a1a1a] flex items-center justify-between">
            <span className="text-[#444] text-xs uppercase tracking-wider">{filtered.length} pre-screened halal stocks</span>
            <Badge text="AAOIFI Standard 21" color="green" />
          </div>
          <div>
            {filtered.map((s, i) => {
              const needsPurif = (s.haram_revenue_pct || 0) > 0;
              const borderlineDebt = (s.debt_ratio || 0) >= 0.30;
              const isExpanded = expanded === s.ticker;
              return (
                <div key={s.ticker} className={i < filtered.length - 1 ? "border-b border-[#1a1a1a]" : ""}>
                  <button
                    className="w-full flex items-center px-5 py-4 hover:bg-[#0f0f0f] transition-colors text-left"
                    onClick={() => setExpanded(isExpanded ? null : s.ticker)}
                  >
                    <span className="w-20 text-white font-semibold text-sm">{s.ticker}</span>
                    <span className="flex-1 text-[#888] text-sm">{s.name}</span>
                    <span className="w-28 text-[#888] text-xs hidden sm:block">{s.sector}</span>
                    <span className={`w-16 text-xs text-right ${borderlineDebt ? "text-yellow-400" : "text-[#888]"}`}>
                      {s.debt_ratio != null ? `${(s.debt_ratio * 100).toFixed(0)}%` : "—"}{borderlineDebt ? " ⚠" : ""}
                    </span>
                    <span className={`w-16 text-xs text-right ${needsPurif ? "text-yellow-400" : "text-[#888]"}`}>
                      {s.haram_revenue_pct != null ? `${s.haram_revenue_pct}%` : "0%"}
                    </span>
                    <span className="w-20 flex justify-end">
                      {needsPurif ? <Badge text="Purify" color="yellow" /> : borderlineDebt ? <Badge text="Monitor" color="yellow" /> : <Badge text="Clean" color="green" />}
                    </span>
                    <span className="ml-3 text-[#444] text-xs">{isExpanded ? "▲" : "▼"}</span>
                  </button>

                  {isExpanded && (
                    <div className="px-5 pb-5 bg-[#0a0a0a] border-t border-[#1a1a1a]">
                      <div className="pt-4 space-y-3">
                        {/* Criteria breakdown */}
                        <div className="grid grid-cols-1 gap-2">
                          <div className="flex items-start gap-3 p-3 bg-[#111] rounded-lg border border-[#1a1a1a]">
                            <span className="text-emerald-400 text-sm mt-0.5">✓</span>
                            <div>
                              <p className="text-white text-xs font-semibold mb-0.5">Business Activity — Pass</p>
                              <p className="text-[#555] text-xs">{s.sector} — no prohibited goods or services</p>
                              <p className="text-[#333] text-xs italic mt-1">Ref: AAOIFI Std 21 · Quran 5:90, 2:275</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-3 p-3 bg-[#111] rounded-lg border border-[#1a1a1a]">
                            <span className={`text-sm mt-0.5 ${borderlineDebt ? "text-yellow-400" : "text-emerald-400"}`}>
                              {borderlineDebt ? "⚠" : "✓"}
                            </span>
                            <div>
                              <p className="text-white text-xs font-semibold mb-0.5">
                                Debt Ratio — {borderlineDebt ? "Monitor" : "Pass"} ({s.debt_ratio != null ? `${(s.debt_ratio * 100).toFixed(0)}%` : "N/A"})
                              </p>
                              <p className="text-[#555] text-xs">
                                Debt/assets = {s.debt_ratio != null ? `${(s.debt_ratio * 100).toFixed(0)}%` : "unknown"}
                                {" "}— AAOIFI threshold is 33%.
                                {borderlineDebt && " Approaching limit — review quarterly."}
                              </p>
                              <p className="text-[#333] text-xs italic mt-1">Ref: AAOIFI Std 21 §3.2 · Quran 2:275–279 (riba prohibition)</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-3 p-3 bg-[#111] rounded-lg border border-[#1a1a1a]">
                            <span className={`text-sm mt-0.5 ${needsPurif ? "text-yellow-400" : "text-emerald-400"}`}>
                              {needsPurif ? "⚠" : "✓"}
                            </span>
                            <div>
                              <p className="text-white text-xs font-semibold mb-0.5">
                                Haram Revenue — {needsPurif ? `Purify (${s.haram_revenue_pct}%)` : "Pass (0%)"}
                              </p>
                              <p className="text-[#555] text-xs">
                                {needsPurif
                                  ? `~${s.haram_revenue_pct}% of revenue from impermissible sources (${s.sharia_rules?.find(r => r.includes("alcohol") || r.includes("tobacco")) || "mixed goods"}). Donate ${s.haram_revenue_pct}% of your profit from this holding to charity.`
                                  : "No haram revenue identified."}
                              </p>
                              <p className="text-[#333] text-xs italic mt-1">Ref: AAOIFI Std 21 §4.1–4.2 · Tirmidhi 614</p>
                            </div>
                          </div>
                        </div>

                        {/* Sharia rules summary */}
                        {s.sharia_rules?.length > 0 && (
                          <div className="p-3 bg-[#111] rounded-lg border border-[#1a1a1a]">
                            <p className="text-[#444] text-xs uppercase tracking-wider mb-2">Screening Notes</p>
                            <ul className="space-y-1">
                              {s.sharia_rules.map((r, i) => (
                                <li key={i} className="text-[#555] text-xs flex items-start gap-2">
                                  <span className="text-emerald-600 mt-0.5">·</span>
                                  {r}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {filtered.some(s => (s.haram_revenue_pct || 0) > 0) && (
            <div className="px-5 py-3 border-t border-[#1a1a1a]">
              <p className="text-[#444] text-xs">Purification: donate the haram revenue % of your profit to charity — AAOIFI Standard 21, §4.2</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
export default function Home() {
  const { user, loading: authLoading, logout } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [tab, setTab] = useState<Tab>("portfolio");
  const [modal, setModal] = useState<"deposit" | "withdraw" | "buy" | null>(null);
  const [sellTicker, setSellTicker] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const lastSyncedTradeId = useRef(0);

  const load = useCallback(async () => {
    try {
      const [s, sn, tr] = await Promise.all([
        fetch(`${API}/api/summary`).then(r => r.json()),
        fetch(`${API}/api/snapshots`).then(r => r.json()),
        fetch(`${API}/api/trades`).then(r => r.json()),
      ]);
      setSummary(s); setSnapshots(sn); setTrades(tr);
      if (user?.uid && s) {
        savePortfolioState(user.uid, {
          total_value: s.total_value ?? 0,
          cash: s.cash ?? 0,
          positions_value: s.positions_value ?? 0,
          position_count: s.position_count ?? 0,
          total_return_pct: s.total_return_pct ?? 0,
          positions: Object.fromEntries((s.positions ?? []).map((p: Position) => [p.ticker, p])),
        });
        const newTrades = (tr as Trade[]).filter(t => t.id > lastSyncedTradeId.current);
        for (const t of newTrades) {
          saveTrade(user.uid, {
            ticker: t.ticker, action: t.action, shares: t.shares,
            price: t.price, value: t.value, reason: t.reason,
            is_manual: !!t.is_manual, executed_at: t.executed_at,
          });
        }
        if (newTrades.length > 0)
          lastSyncedTradeId.current = Math.max(...newTrades.map(t => t.id));
      }
    } catch { /* offline */ }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  const closeModal = useCallback(() => { setModal(null); setSellTicker(null); }, []);
  const onSuccess = useCallback(() => { closeModal(); load(); }, [closeModal, load]);

  if (authLoading) return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-[#333] border-t-emerald-500 rounded-full animate-spin" />
    </div>
  );

  if (!user) return <LoginScreen />;

  if (loading) return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-[#333] border-t-emerald-500 rounded-full animate-spin" />
    </div>
  );

  if (!summary || summary.net_deposited === 0) return (
    <>
      <EmptyState onDeposit={() => setModal("deposit")} />
      {modal === "deposit" && <DepositModal userId={user?.uid} onClose={closeModal} onSuccess={onSuccess} />}
    </>
  );

  const mkt = summary.market ?? { lse_open: false, nyse_open: false, any_open: false, active_market: null };
  const lastRun = summary.last_run ?? null;
  const TABS: { id: Tab; label: string }[] = [
    { id: "portfolio", label: "Portfolio" },
    { id: "activity", label: "Activity" },
    { id: "pnl", label: "P&L Report" },
    { id: "sharia", label: "Sharia" },
  ];

  // Market badges: show per-market status
  const marketBadges = [];
  if (mkt.lse_open) marketBadges.push({ label: "LSE", color: "green" as const });
  if (mkt.nyse_open) marketBadges.push({ label: "NYSE", color: "green" as const });

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Header */}
      <header className="border-b border-[#1a1a1a] px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <span className="text-emerald-400">☾</span>
            </div>
            <div>
              <h1 className="text-white font-semibold text-sm">Sharia Trader</h1>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                {mkt.any_open ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-emerald-400 text-xs">Market open</span>
                    {marketBadges.map(b => (
                      <span key={b.label} className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
                        {b.label}
                      </span>
                    ))}
                  </>
                ) : (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-[#333]" />
                    <span className="text-[#444] text-xs">Markets closed</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setModal("buy")}
              className="px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-sm font-medium border border-emerald-500/20 transition-colors">
              + Buy
            </button>
            <button onClick={() => setModal("withdraw")}
              className="px-3 py-1.5 rounded-lg bg-[#1a1a1a] hover:bg-[#222] border border-[#2a2a2a] text-[#888] text-sm transition-colors">
              Withdraw
            </button>
            <button onClick={() => setModal("deposit")}
              className="px-3 py-1.5 rounded-lg bg-[#1a1a1a] hover:bg-[#222] border border-[#2a2a2a] text-white text-sm transition-colors">
              + Deposit
            </button>
            <div className="flex items-center gap-2 ml-1 pl-3 border-l border-[#222]">
              {user.photoURL ? (
                <img src={user.photoURL} alt="" className="w-7 h-7 rounded-full" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 text-xs font-bold">
                  {user.displayName?.[0] ?? "U"}
                </div>
              )}
              <button onClick={logout} className="text-[#444] hover:text-[#888] text-xs transition-colors">
                Sign out
              </button>
            </div>
          </div>
        </div>

        {/* Bot health bar */}
        <div className="max-w-5xl mx-auto mt-2 pt-2 border-t border-[#151515]">
          {lastRun ? (
            <p className="text-[#444] text-xs">
              Bot watching halal stocks
              <span className="text-[#555] mx-1">·</span>
              Last run: <span className="text-[#666]">{fmtDate(lastRun.started_at)}</span>
              <span className="text-[#555] mx-1">·</span>
              <span className="text-[#555]">{lastRun.trades_executed} trade{lastRun.trades_executed !== 1 ? "s" : ""} executed</span>
            </p>
          ) : (
            <p className="text-[#333] text-xs">Bot runs Mon–Fri at 6am UTC — no runs yet</p>
          )}
        </div>
      </header>

      {/* Nav */}
      <nav className="border-b border-[#1a1a1a] px-6">
        <div className="max-w-5xl mx-auto flex gap-0">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? "border-emerald-400 text-white"
                  : "border-transparent text-[#555] hover:text-[#888]"
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-6 py-8">
        {tab === "portfolio" && (
          <PortfolioTab
            summary={summary} snapshots={snapshots} trades={trades}
            onSell={ticker => setSellTicker(ticker)} onReload={load}
          />
        )}
        {tab === "activity" && <ActivityTab />}
        {tab === "pnl" && <PnlTab />}
        {tab === "sharia" && <ShariaTab summary={summary} />}
      </main>

      {/* Modals */}
      {modal === "deposit" && <DepositModal userId={user?.uid} onClose={closeModal} onSuccess={onSuccess} />}
      {modal === "withdraw" && <WithdrawModal userId={user?.uid} cash={summary.cash} onClose={closeModal} onSuccess={onSuccess} />}
      {modal === "buy" && <ManualTradeModal type="buy" cash={summary.cash} onClose={closeModal} onSuccess={onSuccess} />}
      {sellTicker && <SellConfirmModal ticker={sellTicker} onClose={closeModal} onSuccess={onSuccess} />}
    </div>
  );
}
