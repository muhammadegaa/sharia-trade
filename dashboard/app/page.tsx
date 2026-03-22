"use client"

import { useEffect, useState } from "react"
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine
} from "recharts"

const API = "http://localhost:8787"

type Summary = {
  total_value: number
  cash: number
  positions_value: number
  total_return_pct: number
  total_return_gbp: number
  position_count: number
  positions: Position[]
}

type Position = {
  ticker: string
  shares: number
  avg_price: number
  current_price: number
  market_value: number
  pnl: number
  pnl_pct: number
  opened_at: string
}

type Trade = {
  id: number
  ticker: string
  action: string
  shares: number
  price: number
  value: number
  reason: string
  executed_at: string
}

type Snapshot = { value: number; date: string }

function fmt(n: number) {
  return `£${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function sign(n: number) { return n >= 0 ? "+" : "-" }

export default function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [trades, setTrades] = useState<Trade[]>([])
  const [tab, setTab] = useState<"positions" | "trades">("positions")
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<string>("")

  async function load() {
    try {
      const [s, snaps, t] = await Promise.all([
        fetch(`${API}/api/summary`).then(r => r.json()),
        fetch(`${API}/api/snapshots`).then(r => r.json()),
        fetch(`${API}/api/trades`).then(r => r.json()),
      ])
      setSummary(s)
      setSnapshots(snaps)
      setTrades(t)
      setLastUpdated(new Date().toLocaleTimeString("en-GB"))
    } catch {
      // API not running yet
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [])

  const chartData = snapshots.map(s => ({
    date: new Date(s.date).toLocaleDateString("en-GB", { month: "short", day: "numeric" }),
    value: s.value,
  }))

  const isPositive = (summary?.total_return_pct ?? 0) >= 0

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-[#555] text-sm">Connecting to trading engine...</div>
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center space-y-2">
          <div className="text-[#555] text-sm">Trading engine offline</div>
          <div className="text-[#333] text-xs font-mono bg-white/[0.03] px-4 py-2 rounded-lg border border-white/[0.06]">
            cd sharia-trader && uvicorn bot.api:app --port 8787
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Nav */}
      <nav className="border-b border-white/[0.06] px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-md bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <span className="text-emerald-400 text-xs font-bold">S</span>
          </div>
          <span className="font-semibold text-[15px]">Sharia Trader</span>
          <span className="text-[11px] text-[#555] px-2 py-0.5 rounded-full border border-white/[0.06]">
            paper trading
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs text-[#555]">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live data
          </div>
          {lastUpdated && <span>Updated {lastUpdated}</span>}
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-10">

        {/* Hero metric */}
        <div className="mb-10">
          <div className="text-[#555] text-xs uppercase tracking-widest mb-3">Portfolio value</div>
          <div className="flex items-end gap-4">
            <span className="text-5xl font-bold tracking-tight tabular-nums">
              {fmt(summary.total_value)}
            </span>
            <div className={`mb-1 ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
              <span className="text-lg font-medium">
                {sign(summary.total_return_pct)}{Math.abs(summary.total_return_pct).toFixed(2)}%
              </span>
              <span className="text-sm ml-2 opacity-60">
                {sign(summary.total_return_gbp)}{fmt(summary.total_return_gbp).replace("£", "£")}
              </span>
            </div>
          </div>
          <div className="text-[#444] text-xs mt-1.5">Starting capital £10,000.00 · Halal universe only</div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 mb-10">
          {[
            {
              label: "Cash",
              value: fmt(summary.cash),
              sub: `${((summary.cash / summary.total_value) * 100).toFixed(0)}% of portfolio`,
            },
            {
              label: "Invested",
              value: fmt(summary.positions_value),
              sub: `${summary.position_count} open positions`,
            },
            {
              label: "All-time return",
              value: `${sign(summary.total_return_pct)}${Math.abs(summary.total_return_pct).toFixed(2)}%`,
              sub: `${sign(summary.total_return_gbp)}${fmt(summary.total_return_gbp).replace("£", "£")}`,
              colored: true,
              positive: isPositive,
            },
          ].map(s => (
            <div key={s.label} className="border border-white/[0.06] rounded-xl p-5 bg-white/[0.015]">
              <div className="text-[#555] text-xs mb-2.5">{s.label}</div>
              <div className={`text-xl font-semibold tabular-nums ${
                s.colored ? (s.positive ? "text-emerald-400" : "text-red-400") : ""
              }`}>
                {s.value}
              </div>
              <div className="text-[#444] text-xs mt-1">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Chart */}
        <div className="border border-white/[0.06] rounded-xl p-6 bg-white/[0.015] mb-10">
          <div className="text-[#555] text-xs uppercase tracking-widest mb-5">Performance</div>
          {chartData.length > 1 ? (
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={chartData}>
                <XAxis dataKey="date" tick={{ fill: "#444", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#444", fontSize: 11 }} axisLine={false} tickLine={false}
                  tickFormatter={v => `£${(v / 1000).toFixed(1)}k`} domain={["auto", "auto"]} width={55} />
                <Tooltip
                  contentStyle={{ background: "#111", border: "1px solid #222", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#666" }}
                  formatter={(v: number) => [fmt(v), "Value"]}
                />
                <ReferenceLine y={10000} stroke="#222" strokeDasharray="3 3" />
                <Line type="monotone" dataKey="value" stroke="#34d399" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-40 flex flex-col items-center justify-center gap-2">
              <div className="text-[#444] text-sm">Chart appears after first run</div>
              <div className="text-[#333] text-xs font-mono">cd sharia-trader/bot && python run.py</div>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-0 mb-6 border-b border-white/[0.06]">
          {(["positions", "trades"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm capitalize transition-colors -mb-px border-b ${
                tab === t
                  ? "text-white border-white font-medium"
                  : "text-[#555] border-transparent hover:text-[#888]"
              }`}>
              {t}
              <span className="ml-2 text-xs text-[#444]">
                {t === "positions" ? summary.position_count : trades.length}
              </span>
            </button>
          ))}
        </div>

        {/* Positions table */}
        {tab === "positions" && (
          summary.positions.length === 0 ? (
            <div className="text-center py-20 space-y-2">
              <div className="text-[#444] text-sm">No positions yet</div>
              <div className="text-[#333] text-xs font-mono">python bot/run.py</div>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[#444] text-xs border-b border-white/[0.04]">
                  {["Ticker", "Shares", "Avg price", "Current", "Value", "P&L"].map((h, i) => (
                    <th key={h} className={`pb-3 font-normal ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {summary.positions.map(p => (
                  <tr key={p.ticker} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-4 font-mono font-medium text-[13px]">{p.ticker}</td>
                    <td className="py-4 text-right text-[#666] tabular-nums">{p.shares.toFixed(4)}</td>
                    <td className="py-4 text-right text-[#666] tabular-nums">{fmt(p.avg_price)}</td>
                    <td className="py-4 text-right tabular-nums">{fmt(p.current_price)}</td>
                    <td className="py-4 text-right font-medium tabular-nums">{fmt(p.market_value)}</td>
                    <td className="py-4 text-right tabular-nums">
                      <span className={p.pnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                        {sign(p.pnl)}{fmt(p.pnl).replace("£","")}
                        <span className="text-xs opacity-60 ml-1">
                          ({sign(p.pnl_pct)}{Math.abs(p.pnl_pct).toFixed(1)}%)
                        </span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {/* Trades table */}
        {tab === "trades" && (
          trades.length === 0 ? (
            <div className="text-center py-20 text-[#444] text-sm">No trades yet</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[#444] text-xs border-b border-white/[0.04]">
                  <th className="text-left pb-3 font-normal">Date</th>
                  <th className="text-left pb-3 font-normal">Ticker</th>
                  <th className="text-left pb-3 font-normal">Action</th>
                  <th className="text-right pb-3 font-normal">Price</th>
                  <th className="text-right pb-3 font-normal">Value</th>
                  <th className="text-left pb-3 font-normal pl-6">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {trades.map(t => (
                  <tr key={t.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3.5 text-[#555] text-xs tabular-nums">
                      {new Date(t.executed_at).toLocaleDateString("en-GB")}
                    </td>
                    <td className="py-3.5 font-mono font-medium text-[13px]">{t.ticker}</td>
                    <td className="py-3.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        t.action === "BUY"
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : "bg-red-500/10 text-red-400 border border-red-500/20"
                      }`}>
                        {t.action}
                      </span>
                    </td>
                    <td className="py-3.5 text-right text-[#666] tabular-nums">{fmt(t.price)}</td>
                    <td className="py-3.5 text-right font-medium tabular-nums">{fmt(t.value)}</td>
                    <td className="py-3.5 text-[#555] text-xs pl-6 max-w-xs truncate">{t.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

      </main>
    </div>
  )
}
