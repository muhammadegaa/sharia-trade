"use client";

import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";

const API = "http://localhost:8787";

type Position = {
  ticker: string;
  shares: number;
  avg_price: number;
  current_price: number;
  market_value: number;
  pnl: number;
  pnl_pct: number;
  opened_at: string;
};

type Trade = {
  id: number;
  ticker: string;
  action: string;
  shares: number;
  price: number;
  value: number;
  reason: string;
  executed_at: string;
};

type Summary = {
  total_value: number;
  cash: number;
  positions_value: number;
  total_deposited: number;
  total_return_pct: number;
  total_return_gbp: number;
  position_count: number;
  positions: Position[];
};

type Snapshot = { value: number; date: string };

function fmt(n: number, decimals = 2) {
  return n.toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function pct(n: number) {
  return `${n >= 0 ? "+" : ""}${fmt(n)}%`;
}
function gbp(n: number) {
  return n === 0 ? "£0.00" : `${n >= 0 ? "+" : "-"}£${fmt(Math.abs(n))}`;
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({ onDeposit }: { onDeposit: () => void }) {
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 rounded-2xl bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center mx-auto mb-6">
          <span className="text-3xl">☾</span>
        </div>
        <h2 className="text-white text-xl font-semibold mb-2">Add funds to start</h2>
        <p className="text-[#666] text-sm mb-8 leading-relaxed">
          Paper trading demo using real market data.<br />
          Halal-screened stocks only (AAOIFI compliant).
        </p>
        <button
          onClick={onDeposit}
          className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-sm transition-colors"
        >
          Add Funds
        </button>
      </div>
    </div>
  );
}

// ── Deposit modal ─────────────────────────────────────────────────────────────
function DepositModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: val, note }),
      });
      if (!res.ok) throw new Error("Failed");
      onSuccess();
    } catch {
      setError("Something went wrong. Is the API running?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="bg-[#111] border border-[#222] rounded-2xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-white font-semibold">Add Funds</h3>
          <button onClick={onClose} className="text-[#666] hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex gap-2 mb-4">
          {[10, 50, 100, 500].map(p => (
            <button
              key={p}
              onClick={() => { setAmount(String(p)); setError(""); }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                amount === String(p)
                  ? "bg-emerald-500 text-black"
                  : "bg-[#1a1a1a] text-[#888] hover:text-white border border-[#2a2a2a]"
              }`}
            >
              £{p}
            </button>
          ))}
        </div>

        <div className="mb-4 relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#666] font-medium">£</span>
          <input
            type="number"
            value={amount}
            onChange={e => { setAmount(e.target.value); setError(""); }}
            placeholder="0.00"
            className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl pl-8 pr-4 py-3 text-white text-lg font-semibold placeholder-[#333] focus:outline-none focus:border-emerald-500 transition-colors"
          />
        </div>

        <div className="mb-6">
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 text-white text-sm placeholder-[#333] focus:outline-none focus:border-[#444] transition-colors"
          />
        </div>

        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

        <button
          onClick={submit}
          disabled={loading}
          className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-semibold text-sm transition-colors"
        >
          {loading ? "Adding..." : "Confirm Deposit"}
        </button>

        <p className="text-center text-[#555] text-xs mt-4">Paper trading only — no real money involved</p>
      </div>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, positive }: {
  label: string; value: string; sub?: string; positive?: boolean | null;
}) {
  return (
    <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl p-5">
      <p className="text-[#555] text-xs font-medium uppercase tracking-wider mb-2">{label}</p>
      <p className="text-white text-2xl font-semibold">{value}</p>
      {sub && (
        <p className={`text-sm mt-1 font-medium ${
          positive === true ? "text-emerald-400" :
          positive === false ? "text-red-400" : "text-[#555]"
        }`}>{sub}</p>
      )}
    </div>
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 shadow-xl">
      <p className="text-[#666] text-xs mb-1">{label}</p>
      <p className="text-white font-semibold">£{fmt(payload[0].value)}</p>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Home() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [tab, setTab] = useState<"positions" | "trades">("positions");
  const [showDeposit, setShowDeposit] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const [s, sn, tr] = await Promise.all([
        fetch(`${API}/api/summary`).then(r => r.json()),
        fetch(`${API}/api/snapshots`).then(r => r.json()),
        fetch(`${API}/api/trades`).then(r => r.json()),
      ]);
      setSummary(s);
      setSnapshots(sn);
      setTrades(tr);
    } catch { /* API not reachable */ }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { const t = setInterval(load, 60_000); return () => clearInterval(t); }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#333] border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!summary || summary.total_deposited === 0) {
    return (
      <>
        <EmptyState onDeposit={() => setShowDeposit(true)} />
        {showDeposit && (
          <DepositModal onClose={() => setShowDeposit(false)} onSuccess={() => { setShowDeposit(false); load(); }} />
        )}
      </>
    );
  }

  const isUp = summary.total_return_gbp >= 0;
  const chartColor = isUp ? "#10b981" : "#f87171";
  const chartData = snapshots.map(s => ({
    date: new Date(s.date).toLocaleDateString("en-GB", { month: "short", day: "numeric" }),
    value: s.value,
  }));

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <header className="border-b border-[#1a1a1a] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
            <span className="text-emerald-400 text-lg">☾</span>
          </div>
          <div>
            <h1 className="text-white font-semibold text-sm">Sharia Trader</h1>
            <p className="text-[#555] text-xs">Paper trading</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[#555] text-xs mr-2">Live</span>
          <button
            onClick={() => setShowDeposit(true)}
            className="px-4 py-1.5 rounded-lg bg-[#1a1a1a] hover:bg-[#222] border border-[#2a2a2a] text-sm text-white transition-colors"
          >
            + Add Funds
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
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
            {gbp(summary.total_return_gbp)} · deposited £{fmt(summary.total_deposited)}
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Cash" value={`£${fmt(summary.cash)}`}
            sub={`${((summary.cash / summary.total_value) * 100).toFixed(0)}% of portfolio`} positive={null} />
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
                <ReferenceLine y={summary.total_deposited} stroke="#333" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="value" stroke={chartColor} strokeWidth={2}
                  dot={false} activeDot={{ r: 4, fill: chartColor }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Tabs */}
        <div>
          <div className="flex gap-1 mb-4 bg-[#111] border border-[#1e1e1e] rounded-xl p-1 w-fit">
            {(["positions", "trades"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${
                  tab === t ? "bg-[#1e1e1e] text-white" : "text-[#555] hover:text-[#888]"
                }`}>
                {t}
                {t === "positions" && summary.position_count > 0 &&
                  <span className="ml-2 text-xs text-[#444]">{summary.position_count}</span>}
                {t === "trades" && trades.length > 0 &&
                  <span className="ml-2 text-xs text-[#444]">{trades.length}</span>}
              </button>
            ))}
          </div>

          {tab === "positions" && (
            summary.positions.length === 0 ? (
              <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl p-8 text-center">
                <p className="text-[#333] text-sm">No open positions — bot buys when momentum signals trigger</p>
              </div>
            ) : (
              <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#1e1e1e]">
                      {["Ticker", "Shares", "Avg price", "Current", "Value", "P&L"].map(h => (
                        <th key={h} className="text-left text-[#444] text-xs font-medium uppercase tracking-wider px-5 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {summary.positions.map((p, i) => (
                      <tr key={p.ticker} className={i < summary.positions.length - 1 ? "border-b border-[#1a1a1a]" : ""}>
                        <td className="px-5 py-4 text-white font-semibold">{p.ticker}</td>
                        <td className="px-5 py-4 text-[#888]">{fmt(p.shares, 4)}</td>
                        <td className="px-5 py-4 text-[#888]">£{fmt(p.avg_price)}</td>
                        <td className="px-5 py-4 text-white">£{fmt(p.current_price)}</td>
                        <td className="px-5 py-4 text-white">£{fmt(p.market_value)}</td>
                        <td className="px-5 py-4">
                          <span className={p.pnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                            {gbp(p.pnl)} <span className="text-xs opacity-70">({pct(p.pnl_pct)})</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {tab === "trades" && (
            trades.length === 0 ? (
              <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl p-8 text-center">
                <p className="text-[#333] text-sm">No trades yet</p>
              </div>
            ) : (
              <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#1e1e1e]">
                      {["Date", "Ticker", "Action", "Shares", "Price", "Value", "Reason"].map(h => (
                        <th key={h} className="text-left text-[#444] text-xs font-medium uppercase tracking-wider px-5 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((t, i) => (
                      <tr key={t.id} className={i < trades.length - 1 ? "border-b border-[#1a1a1a]" : ""}>
                        <td className="px-5 py-3 text-[#555] text-xs whitespace-nowrap">
                          {new Date(t.executed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="px-5 py-3 text-white font-medium">{t.ticker}</td>
                        <td className="px-5 py-3">
                          <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${
                            t.action === "BUY" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
                          }`}>{t.action}</span>
                        </td>
                        <td className="px-5 py-3 text-[#888]">{fmt(t.shares, 4)}</td>
                        <td className="px-5 py-3 text-[#888]">£{fmt(t.price)}</td>
                        <td className="px-5 py-3 text-white">£{fmt(t.value)}</td>
                        <td className="px-5 py-3 text-[#555] text-xs max-w-xs truncate">{t.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      </main>

      {showDeposit && (
        <DepositModal onClose={() => setShowDeposit(false)} onSuccess={() => { setShowDeposit(false); load(); }} />
      )}
    </div>
  );
}
