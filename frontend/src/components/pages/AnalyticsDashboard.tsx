import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useSocket } from '../../hooks/useSocket';

// ─── Types ────────────────────────────────────────────────────────────────────

interface OverviewMetrics {
  currentTps: number; successRate1h: number; failedPayoutsToday: number;
  totalTransactions24h: number; totalPayoutVolume24h: number;
  avgResponseMs: number; banksDown: number; activeIncidents: number;
}
interface TpsBucket  { time: string; tps: number; count: number; success: number; failed: number; successRate: number }
interface PayoutStat { status: string; count: number; totalAmount: number }
interface BankStat   { bankCode: string; bankName: string | null; status: string; successRate: number; avgResponseMs: number }
interface FailureReason { reason: string; count: number; pct: number }
interface Alert { id: string; severity: string; title: string; message: string; triggeredAt: string; status: string }
interface Incident { id: string; title: string; severity: string; status: string; affectedSystem: string; createdAt: string }

interface DashboardState {
  overview: OverviewMetrics | null;
  tps: TpsBucket[];
  payouts: PayoutStat[];
  payoutTimeseries: { time: string; success: number; failed: number; pending: number }[];
  banks: BankStat[];
  failures: FailureReason[];
  alerts: Alert[];
  incidents: Incident[];
  insight: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const API_BASE = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:3000';
const WS_URL   = API_BASE;

const STATUS_COLORS: Record<string, string> = {
  success: '#10b981', '1': '#10b981',
  failed:  '#ef4444', '4': '#ef4444',
  pending: '#f59e0b', initiated: '#f59e0b', '2': '#f59e0b',
  processed: '#3b82f6', '6': '#3b82f6',
  reversed: '#8b5cf6', '8': '#8b5cf6',
};

const SEVERITY_STYLES: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  critical: { bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-100',    dot: 'bg-red-500'    },
  warning:  { bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-100',  dot: 'bg-amber-500'  },
  info:     { bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-100',   dot: 'bg-blue-500'   },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relTime(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60)  return `${Math.floor(d)}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  return `${Math.floor(d / 3600)}h ago`;
}

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString('en-IN');
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function formatTime(bucket: string) {
  const d = new Date(bucket);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LiveDot({ color = 'bg-emerald-500' }: { color?: string }) {
  return (
    <span className="relative flex h-2 w-2">
      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${color} opacity-75`} />
      <span className={`relative inline-flex rounded-full h-2 w-2 ${color}`} />
    </span>
  );
}

function KpiCard({
  label, value, sub, icon, trend, color = 'brand', loading,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ReactNode; trend?: { dir: 'up' | 'down'; label: string };
  color?: 'brand' | 'green' | 'red' | 'amber' | 'purple' | 'blue';
  loading?: boolean;
}) {
  const clr = {
    brand:  { bg: 'bg-brand-50',   icon: 'text-brand',      val: 'text-[#1a1a1a]' },
    green:  { bg: 'bg-emerald-50', icon: 'text-emerald-600', val: 'text-emerald-700' },
    red:    { bg: 'bg-red-50',     icon: 'text-red-500',     val: 'text-red-700' },
    amber:  { bg: 'bg-amber-50',   icon: 'text-amber-500',   val: 'text-amber-700' },
    purple: { bg: 'bg-purple-50',  icon: 'text-purple-600',  val: 'text-purple-700' },
    blue:   { bg: 'bg-blue-50',    icon: 'text-blue-600',    val: 'text-blue-700' },
  }[color];

  return (
    <div className="bg-white border border-[#EBEBEB] rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl ${clr.bg} flex items-center justify-center flex-shrink-0`}>
          <span className={clr.icon}>{icon}</span>
        </div>
        {trend && (
          <span className={`text-[11px] font-semibold flex items-center gap-1 ${trend.dir === 'up' ? 'text-emerald-600' : 'text-red-500'}`}>
            {trend.dir === 'up' ? '▲' : '▼'} {trend.label}
          </span>
        )}
      </div>
      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      {loading ? (
        <div className="h-7 w-24 bg-gray-100 rounded-lg animate-pulse" />
      ) : (
        <p className={`text-2xl font-bold leading-none ${clr.val}`}>{value}</p>
      )}
      {sub && !loading && <p className="text-xs text-gray-400 mt-1.5">{sub}</p>}
    </div>
  );
}

function SectionHeader({ title, sub, live }: { title: string; sub?: string; live?: boolean }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      {live && <LiveDot />}
      <div>
        <h2 className="text-sm font-bold text-[#1a1a1a]">{title}</h2>
        {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-[#EBEBEB] rounded-xl shadow-lg px-3 py-2.5 text-xs">
      <p className="font-semibold text-gray-500 mb-1.5">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
          <span className="text-gray-500 capitalize">{p.name}:</span>
          <span className="font-semibold text-[#1a1a1a]">{p.value}</span>
        </div>
      ))}
    </div>
  );
};

// ─── Main Dashboard ───────────────────────────────────────────────────────────

interface Props { token: string }

export function AnalyticsDashboard({ token }: Props) {
  const [state, setState] = useState<DashboardState>({
    overview: null, tps: [], payouts: [], payoutTimeseries: [],
    banks: [], failures: [], alerts: [], incidents: [], insight: '',
  });
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [wsStatus, setWsStatus] = useState<string>('connecting');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // ── Data fetching ───────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    try {
      const [ovRes, tpsRes, payRes, bankRes, failRes, alertRes, incRes] = await Promise.allSettled([
        fetch(`${API_BASE}/analytics/overview`, { headers }).then(r => r.json()),
        fetch(`${API_BASE}/analytics/tps?minutes=60`, { headers }).then(r => r.json()),
        fetch(`${API_BASE}/analytics/payouts`, { headers }).then(r => r.json()),
        fetch(`${API_BASE}/analytics/banks`, { headers }).then(r => r.json()),
        fetch(`${API_BASE}/analytics/failures`, { headers }).then(r => r.json()),
        fetch(`${API_BASE}/alerts`, { headers }).then(r => r.json()),
        fetch(`${API_BASE}/incidents`, { headers }).then(r => r.json()),
      ]);

      setState(prev => ({
        ...prev,
        overview:         ovRes.status  === 'fulfilled' ? ovRes.value.data         : prev.overview,
        tps:              tpsRes.status === 'fulfilled' ? tpsRes.value.series ?? [] : prev.tps,
        payouts:          payRes.status === 'fulfilled' ? payRes.value.breakdown ?? [] : prev.payouts,
        payoutTimeseries: payRes.status === 'fulfilled' ? payRes.value.timeseries ?? [] : prev.payoutTimeseries,
        banks:            bankRes.status === 'fulfilled' ? bankRes.value.banks ?? [] : prev.banks,
        failures:         failRes.status === 'fulfilled' ? failRes.value.reasons ?? [] : prev.failures,
        alerts:           alertRes.status === 'fulfilled' ? alertRes.value.alerts ?? [] : prev.alerts,
        incidents:        incRes.status === 'fulfilled' ? incRes.value.incidents ?? [] : prev.incidents,
      }));
      setLastRefresh(new Date());
    } catch { /* silently retry on next poll */ } finally {
      setLoading(false);
    }
  }, [token]);

  const fetchInsight = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/ai/insights`, { headers });
      const j = await res.json();
      setState(prev => ({ ...prev, insight: j.insight ?? '' }));
    } catch { /* optional */ }
  }, [token]);

  useEffect(() => {
    void fetchAll();
    void fetchInsight();
    // Poll REST every 15 s as fallback to WebSocket
    pollRef.current = setInterval(() => void fetchAll(), 15_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchAll]);

  // ── Socket.io live updates ──────────────────────────────────────────────────

  const { status: socketStatus } = useSocket({
    url: WS_URL,
    onMetrics: (data: any) => {
      if (data?.overview) setState(prev => ({ ...prev, overview: data.overview }));
      if (data?.tps)      setState(prev => ({ ...prev, tps: data.tps }));
      if (data?.banks)    setState(prev => ({ ...prev, banks: data.banks }));
      if (data?.payouts)  setState(prev => ({ ...prev, payouts: data.payouts }));
      setLastRefresh(new Date());
    },
    onAlert: (alert: any) => {
      setState(prev => ({
        ...prev,
        alerts: [alert, ...prev.alerts.filter(a => a.id !== alert.id)].slice(0, 50),
      }));
    },
    onAlertResolved: (id: string) => {
      setState(prev => ({ ...prev, alerts: prev.alerts.filter(a => a.id !== id) }));
    },
  });

  useEffect(() => { setWsStatus(socketStatus); }, [socketStatus]);

  // ── Derived values ──────────────────────────────────────────────────────────

  const ov = state.overview;
  const criticalAlerts = state.alerts.filter(a => a.severity === 'critical' && a.status === 'active');
  const warningAlerts  = state.alerts.filter(a => a.severity === 'warning'  && a.status === 'active');
  const openIncidents  = state.incidents.filter(i => i.status !== 'resolved');

  const successRateColor = !ov ? 'brand'
    : ov.successRate1h >= 99 ? 'green'
    : ov.successRate1h >= 95 ? 'brand'
    : ov.successRate1h >= 85 ? 'amber'
    : 'red';

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-full bg-[#FAFAFA]">
      <div className="max-w-[1600px] mx-auto px-4 md:px-8 py-6 space-y-6">

        {/* ── Page header ── */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <h1 className="text-2xl font-bold text-[#1a1a1a] tracking-tight">Analytics & Alerts</h1>
              {criticalAlerts.length > 0 && (
                <span className="flex items-center gap-1 px-2.5 py-1 bg-red-100 text-red-700 rounded-full text-xs font-bold border border-red-200 animate-pulse">
                  ⚠ {criticalAlerts.length} Critical
                </span>
              )}
            </div>
            <p className="text-gray-400 text-sm flex items-center gap-2">
              Realtime fintech operations monitoring
              {lastRefresh && <span className="text-gray-300">· Updated {relTime(lastRefresh.toISOString())}</span>}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* WebSocket status */}
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${
              wsStatus === 'connected'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                : wsStatus === 'error' || wsStatus === 'disconnected'
                ? 'bg-red-50 text-red-600 border-red-100'
                : 'bg-gray-50 text-gray-500 border-gray-100'
            }`}>
              <LiveDot color={wsStatus === 'connected' ? 'bg-emerald-500' : 'bg-amber-500'} />
              {wsStatus === 'connected' ? 'Live' : 'Polling'}
            </div>
            <button
              onClick={() => { void fetchAll(); void fetchInsight(); }}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2.5 bg-white border border-[#E0E0E0] rounded-xl text-sm font-medium text-gray-500
                         hover:text-brand hover:border-brand/30 hover:bg-brand-50 transition-all shadow-sm disabled:opacity-50"
            >
              <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
          </div>
        </div>

        {/* ── Critical alert banner ── */}
        {criticalAlerts.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-2xl px-5 py-4 flex items-start gap-3">
            <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="font-bold text-sm text-red-800">🚨 {criticalAlerts.length} Critical Alert{criticalAlerts.length > 1 ? 's' : ''} Active</p>
              <p className="text-xs text-red-600 mt-0.5">{criticalAlerts.map(a => a.title).join(' · ')}</p>
            </div>
          </div>
        )}

        {/* ── KPI row ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4">
          <KpiCard loading={loading} label="Live TPS"
            value={ov ? `${ov.currentTps}` : '—'} sub="txns/sec"
            color="brand"
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>}
          />
          <KpiCard loading={loading} label="Success Rate"
            value={ov ? `${ov.successRate1h.toFixed(1)}%` : '—'} sub="24h window"
            color={successRateColor}
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>}
          />
          <KpiCard loading={loading} label="Failed Payouts"
            value={ov?.failedPayoutsToday ?? '—'} sub="today"
            color={ov && ov.failedPayoutsToday > 0 ? 'red' : 'green'}
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>}
          />
          <KpiCard loading={loading} label="24h Transactions"
            value={ov ? fmt(ov.totalTransactions24h) : '—'} sub={ov ? fmtCurrency(ov.totalPayoutVolume24h) : undefined}
            color="blue"
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>}
          />
          <KpiCard loading={loading} label="Banks Down"
            value={ov?.banksDown ?? '—'} sub={`of ${state.banks.length} monitored`}
            color={ov && ov.banksDown > 0 ? 'red' : 'green'}
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l9-4 9 4M3 6v14l9 4 9-4V6M12 2v20"/></svg>}
          />
          <KpiCard loading={loading} label="Active Alerts"
            value={state.alerts.filter(a => a.status === 'active').length}
            sub={`${criticalAlerts.length} critical · ${warningAlerts.length} warning`}
            color={criticalAlerts.length > 0 ? 'red' : warningAlerts.length > 0 ? 'amber' : 'green'}
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>}
          />
          <KpiCard loading={loading} label="Open Incidents"
            value={openIncidents.length}
            sub="requiring action"
            color={openIncidents.length > 0 ? 'amber' : 'green'}
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>}
          />
        </div>

        {/* ── Row 2: TPS chart + Success Rate ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* TPS Over Time */}
          <div className="bg-white border border-[#EBEBEB] rounded-2xl shadow-sm p-6">
            <SectionHeader title="Transaction Volume (TPS)" sub="Last 60 minutes — 1-minute buckets" live />
            {state.tps.length === 0 && loading ? (
              <div className="h-48 bg-gray-50 rounded-xl animate-pulse" />
            ) : state.tps.length === 0 ? (
              <EmptyChart label="No transaction data yet" />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={state.tps} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="tpsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" vertical={false} />
                  <XAxis dataKey="time" tickFormatter={formatTime} tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="tps" name="TPS" stroke="#6366f1" strokeWidth={2} fill="url(#tpsGrad)" dot={false} activeDot={{ r: 4, fill: '#6366f1' }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Success Rate Over Time */}
          <div className="bg-white border border-[#EBEBEB] rounded-2xl shadow-sm p-6">
            <SectionHeader title="Success Rate Trend" sub="% of successful transactions per minute" live />
            {state.tps.length === 0 && loading ? (
              <div className="h-48 bg-gray-50 rounded-xl animate-pulse" />
            ) : state.tps.length === 0 ? (
              <EmptyChart label="No data yet" />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={state.tps} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="srGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#10b981" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" vertical={false} />
                  <XAxis dataKey="time" tickFormatter={formatTime} tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                  <Tooltip content={<CustomTooltip />} formatter={(v: any) => [`${v}%`, 'Success Rate']} />
                  <Area type="monotone" dataKey="successRate" name="Success Rate" stroke="#10b981" strokeWidth={2} fill="url(#srGrad)" dot={false} activeDot={{ r: 4, fill: '#10b981' }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* ── Row 3: Bank Health Grid + Failure Analysis ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Bank Health Grid — 2/3 */}
          <div className="lg:col-span-2 bg-white border border-[#EBEBEB] rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-[#F0F0F0] flex items-center justify-between">
              <SectionHeader title="Bank / PSP Health" sub="Real-time payment gateway status" live />
              <span className="text-[11px] font-semibold text-gray-400 bg-gray-50 border border-gray-100 px-2.5 py-1 rounded-full">
                {state.banks.filter(b => b.status === 'up' || b.status === 'active').length}/{state.banks.length} healthy
              </span>
            </div>
            <div className="divide-y divide-[#F5F5F5]">
              {loading && state.banks.length === 0
                ? Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="px-6 py-3.5 flex items-center gap-4">
                      <div className="h-3 w-16 bg-gray-100 rounded animate-pulse" />
                      <div className="h-3 w-20 bg-gray-100 rounded animate-pulse flex-1" />
                      <div className="h-3 w-24 bg-gray-100 rounded animate-pulse" />
                    </div>
                  ))
                : state.banks.length === 0
                  ? <p className="text-center text-gray-300 text-sm py-10">No bank data available</p>
                  : state.banks.map(b => {
                      const ok = b.status === 'up' || b.status === 'active';
                      const pct = Math.min(Math.max(Number(b.successRate), 0), 100);
                      const barColor = pct >= 99 ? 'bg-emerald-500' : pct >= 95 ? 'bg-amber-400' : 'bg-red-500';
                      return (
                        <div key={b.bankCode} className="px-6 py-3 flex items-center gap-4 hover:bg-[#FAFAFA] transition-colors">
                          <div className="w-28 flex-shrink-0">
                            <p className="font-mono font-bold text-xs text-[#1a1a1a]">{b.bankCode}</p>
                            {b.bankName && <p className="text-[10px] text-gray-400 truncate max-w-[100px]">{b.bankName}</p>}
                          </div>
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border flex-shrink-0 ${ok ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
                            {b.status}
                          </span>
                          <div className="flex-1 flex items-center gap-2.5 min-w-0">
                            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                            </div>
                            <span className={`text-xs font-bold w-12 text-right flex-shrink-0 ${pct >= 99 ? 'text-emerald-600' : pct >= 95 ? 'text-amber-500' : 'text-red-500'}`}>
                              {pct.toFixed(1)}%
                            </span>
                          </div>
                          <span className={`text-xs font-semibold flex-shrink-0 w-16 text-right ${Number(b.avgResponseMs) < 300 ? 'text-emerald-600' : Number(b.avgResponseMs) < 800 ? 'text-amber-500' : 'text-red-500'}`}>
                            {b.avgResponseMs}ms
                          </span>
                        </div>
                      );
                    })
              }
            </div>
          </div>

          {/* Failure Analysis — 1/3 */}
          <div className="bg-white border border-[#EBEBEB] rounded-2xl shadow-sm p-6">
            <SectionHeader title="Failure Reasons" sub="Top causes (24h)" />
            {state.failures.length === 0 && loading ? (
              <div className="space-y-3 mt-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}</div>
            ) : state.failures.length === 0 ? (
              <EmptyChart label="No failures yet 🎉" />
            ) : (
              <div className="space-y-3 mt-2">
                {state.failures.slice(0, 6).map((f, i) => (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs text-[#404040] truncate max-w-[160px]" title={f.reason}>{f.reason}</p>
                      <span className="text-xs font-bold text-[#1a1a1a] ml-1">{f.count} <span className="font-normal text-gray-400">({f.pct}%)</span></span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-red-400 rounded-full transition-all" style={{ width: `${f.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Row 4: Payout Analytics + Alerts Panel ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Payout time series — 2/3 */}
          <div className="lg:col-span-2 bg-white border border-[#EBEBEB] rounded-2xl shadow-sm p-6">
            <SectionHeader title="Payout Flow" sub="Success / Failed / Pending by hour (24h)" live />
            {state.payoutTimeseries.length === 0 && loading ? (
              <div className="h-52 bg-gray-50 rounded-xl animate-pulse" />
            ) : state.payoutTimeseries.length === 0 ? (
              <EmptyChart label="No payout data yet" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={state.payoutTimeseries} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" vertical={false} />
                  <XAxis dataKey="time" tickFormatter={formatTime} tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="success" name="Success" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="pending" name="Pending" stackId="a" fill="#f59e0b" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="failed"  name="Failed"  stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Live Alerts Panel — 1/3 */}
          <div className="bg-white border border-[#EBEBEB] rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-[#F0F0F0] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <LiveDot color={criticalAlerts.length > 0 ? 'bg-red-500' : 'bg-emerald-500'} />
                <h2 className="text-sm font-bold text-[#1a1a1a]">Live Alerts</h2>
              </div>
              <span className="text-[11px] font-semibold text-gray-400 bg-gray-50 border border-gray-100 px-2.5 py-1 rounded-full">
                {state.alerts.filter(a => a.status === 'active').length} active
              </span>
            </div>
            <div className="overflow-y-auto max-h-[260px]">
              {state.alerts.length === 0 ? (
                <div className="py-10 text-center">
                  <div className="text-2xl mb-2">✅</div>
                  <p className="text-sm text-gray-400 font-medium">All clear</p>
                  <p className="text-xs text-gray-300 mt-1">No active alerts</p>
                </div>
              ) : state.alerts.map(a => {
                  const s = SEVERITY_STYLES[a.severity] ?? SEVERITY_STYLES.info;
                  return (
                    <div key={a.id} className={`px-5 py-3.5 border-b border-[#F5F5F5] ${a.status !== 'active' ? 'opacity-50' : ''}`}>
                      <div className="flex items-start gap-2.5">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${s.dot}`} />
                        <div className="min-w-0 flex-1">
                          <p className={`text-xs font-bold ${s.text} truncate`}>{a.title}</p>
                          <p className="text-[11px] text-gray-400 mt-0.5 leading-snug line-clamp-2">{a.message}</p>
                          <p className="text-[10px] text-gray-300 mt-1">{relTime(a.triggeredAt)}</p>
                        </div>
                        <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold border ${s.bg} ${s.text} ${s.border} capitalize`}>
                          {a.severity}
                        </span>
                      </div>
                    </div>
                  );
                })
              }
            </div>
          </div>
        </div>

        {/* ── Row 5: AI Insights + Incidents ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* AI Insights */}
          <div className="bg-white border border-[#EBEBEB] rounded-2xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand to-brand-700 flex items-center justify-center shadow-md shadow-brand/25">
                  <svg className="w-4.5 h-4.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z"/>
                  </svg>
                </div>
                <div>
                  <h2 className="text-sm font-bold text-[#1a1a1a]">AI Operational Insight</h2>
                  <p className="text-[11px] text-gray-400">Powered by OpenAI</p>
                </div>
              </div>
              <button
                onClick={() => void fetchInsight()}
                className="text-[11px] text-brand hover:underline font-semibold"
              >
                Refresh
              </button>
            </div>
            {state.insight ? (
              <div className="space-y-2">
                {state.insight.split('\n').filter(Boolean).map((line, i) => (
                  <div key={i} className="flex items-start gap-2.5 bg-[#FAFAFA] rounded-xl px-4 py-2.5 border border-[#F0F0F0]">
                    <span className="text-brand font-bold text-sm flex-shrink-0">•</span>
                    <p className="text-sm text-[#404040] leading-relaxed">{line.replace(/^[•·-]\s*/, '')}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-10 bg-gray-50 rounded-xl animate-pulse border border-[#F0F0F0]" />
                ))}
              </div>
            )}
          </div>

          {/* Incidents */}
          <div className="bg-white border border-[#EBEBEB] rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-[#F0F0F0] flex items-center justify-between">
              <h2 className="text-sm font-bold text-[#1a1a1a]">Incidents</h2>
              <span className="text-[11px] font-semibold text-gray-400 bg-gray-50 border border-gray-100 px-2.5 py-1 rounded-full">
                {openIncidents.length} open
              </span>
            </div>
            <div className="overflow-y-auto max-h-[260px]">
              {state.incidents.length === 0 ? (
                <div className="py-10 text-center">
                  <div className="text-2xl mb-2">🟢</div>
                  <p className="text-sm text-gray-400 font-medium">No incidents</p>
                  <p className="text-xs text-gray-300 mt-1">System operating normally</p>
                </div>
              ) : state.incidents.map(inc => {
                  const s = SEVERITY_STYLES[inc.severity] ?? SEVERITY_STYLES.info;
                  const statusColor = inc.status === 'resolved' ? 'text-emerald-600 bg-emerald-50 border-emerald-100' : inc.status === 'investigating' ? 'text-amber-600 bg-amber-50 border-amber-100' : 'text-red-600 bg-red-50 border-red-100';
                  return (
                    <div key={inc.id} className={`px-5 py-3.5 border-b border-[#F5F5F5] ${inc.status === 'resolved' ? 'opacity-60' : ''}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${s.bg} ${s.text} ${s.border}`}>
                              {inc.severity}
                            </span>
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusColor} capitalize`}>
                              {inc.status}
                            </span>
                          </div>
                          <p className="text-xs font-semibold text-[#1a1a1a] truncate">{inc.title}</p>
                          <p className="text-[10px] text-gray-400 mt-0.5">{inc.affectedSystem} · {relTime(inc.createdAt)}</p>
                        </div>
                      </div>
                    </div>
                  );
                })
              }
            </div>
          </div>
        </div>

        {/* ── Payout Status Breakdown (Pie) ── */}
        {state.payouts.length > 0 && (
          <div className="bg-white border border-[#EBEBEB] rounded-2xl shadow-sm p-6">
            <SectionHeader title="Payout Status Distribution" sub="24-hour breakdown by status" />
            <div className="flex flex-col sm:flex-row items-center gap-8">
              <ResponsiveContainer width={180} height={180}>
                <PieChart>
                  <Pie data={state.payouts} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={80} innerRadius={48} strokeWidth={2}>
                    {state.payouts.map((p, i) => (
                      <Cell key={i} fill={STATUS_COLORS[p.status] ?? `hsl(${i * 60}, 60%, 55%)`} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: any, n: any) => [v, n]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-3">
                {state.payouts.map((p, i) => (
                  <div key={i} className="flex items-center gap-2.5 bg-[#FAFAFA] border border-[#F0F0F0] rounded-xl px-4 py-2.5 min-w-[140px]">
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: STATUS_COLORS[p.status] ?? `hsl(${i * 60}, 60%, 55%)` }} />
                    <div>
                      <p className="text-xs font-semibold text-[#1a1a1a] capitalize">{p.status}</p>
                      <p className="text-[11px] text-gray-400">{p.count.toLocaleString()} · {fmtCurrency(p.totalAmount)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-40 flex flex-col items-center justify-center text-gray-300">
      <svg className="w-8 h-8 mb-2 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
      <p className="text-sm">{label}</p>
    </div>
  );
}
