import { useState, useEffect } from 'react';
import { fetchHealth, executeTool, fetchDashboardWidgetData, fetchBankHealthLive, fetchRecentPayoutsLive } from '../../api/client';
import type { HealthStatus, BankHealthRow, TransactionRow } from '../../types';

interface DashboardPageProps {
  token: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatUptime(secs: number) {
  if (secs < 60) return `${Math.floor(secs)}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  return `${Math.floor(secs / 86400)}d ${Math.floor((secs % 86400) / 3600)}h`;
}

function formatAmount(amount: number, currency = 'INR') {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr className="border-b border-[#F5F5F5]">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-5 py-3.5">
          <div className="h-3.5 bg-gray-100 rounded-full animate-pulse" style={{ width: `${60 + (i * 17) % 40}%` }} />
        </td>
      ))}
    </tr>
  );
}

function ServicePill({ label, ok, detail }: { label: string; ok: boolean | null; detail?: string }) {
  const base = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all';
  if (ok === null) return (
    <span className={`${base} bg-gray-50 border-gray-100 text-gray-300`}>
      <span className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-pulse" />
      {label}
    </span>
  );
  return (
    <span className={`${base} ${ok
      ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
      : 'bg-red-50 border-red-100 text-red-600'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
      {label}
      {detail && <span className="opacity-60 font-normal">{detail}</span>}
    </span>
  );
}

function MetricCard({
  icon, label, value, sub, accent, loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  accent: string;
  loading?: boolean;
}) {
  return (
    <div className="bg-white border border-[#EBEBEB] rounded-2xl p-5 shadow-sm flex items-start gap-4">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${accent}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</p>
        {loading ? (
          <div className="h-7 w-20 bg-gray-100 rounded-lg animate-pulse" />
        ) : (
          <p className="text-2xl font-bold text-[#1a1a1a] leading-none">{value}</p>
        )}
        {sub && !loading && <p className="text-xs text-gray-400 mt-1.5">{sub}</p>}
      </div>
    </div>
  );
}

function SuccessBar({ rate }: { rate: number }) {
  const pct = Math.min(Math.max(Number(rate), 0), 100);
  const color = pct >= 99 ? 'bg-emerald-500' : pct >= 95 ? 'bg-amber-400' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2.5 justify-end">
      <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-semibold w-11 text-right ${pct >= 99 ? 'text-emerald-600' : pct >= 95 ? 'text-amber-500' : 'text-red-500'}`}>
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: string | number | null | undefined }) {
  const raw = String(status ?? '');
  const s = raw.toLowerCase();
  const map: Record<string, string> = {
    up:       'bg-emerald-50 text-emerald-700 border-emerald-100',
    active:   'bg-emerald-50 text-emerald-700 border-emerald-100',
    success:  'bg-emerald-50 text-emerald-700 border-emerald-100',
    '1':      'bg-emerald-50 text-emerald-700 border-emerald-100',
    down:     'bg-red-50    text-red-600    border-red-100',
    failed:   'bg-red-50    text-red-600    border-red-100',
    error:    'bg-red-50    text-red-600    border-red-100',
    '4':      'bg-red-50    text-red-600    border-red-100',
    pending:  'bg-amber-50  text-amber-600  border-amber-100',
    initiated:'bg-amber-50  text-amber-600  border-amber-100',
    '2':      'bg-amber-50  text-amber-600  border-amber-100',
    processed:'bg-blue-50   text-blue-600   border-blue-100',
    '6':      'bg-blue-50   text-blue-600   border-blue-100',
    reversed: 'bg-purple-50 text-purple-600 border-purple-100',
    '8':      'bg-purple-50 text-purple-600 border-purple-100',
  };
  const cls = map[s] ?? 'bg-gray-50 text-gray-500 border-gray-100';
  // Render numeric statuses as friendly labels so the dashboard isn't full of bare digits.
  const codeLabel: Record<string, string> = {
    '0': 'initiated', '1': 'success', '2': 'pending', '3': 'sent to bank',
    '4': 'failed', '6': 'processed', '8': 'reversed', '9': 'deemed success',
  };
  const label = codeLabel[s] ?? raw;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border capitalize ${cls}`}>
      {label}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DashboardPage({ token }: DashboardPageProps) {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [bankHealth, setBankHealth] = useState<BankHealthRow[]>([]);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [failedCount, setFailedCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [healthRes, bankRes, bankFallbackRes, recentLiveRes, recentRes, failedRes] = await Promise.allSettled([
        fetchHealth(token),
        // Primary: live bank health derived from tbl_payouts + tbl_bank_lists
        fetchBankHealthLive(token),
        // Fallback: legacy bank_health tool — used only if the live endpoint fails
        executeTool('get_bank_health', { limit: 10 }, token).catch(() => null),
        // Primary: recent payouts with bank join + addedtime
        fetchRecentPayoutsLive(token, 8),
        // Fallback: widget API (no join, addeddate only)
        fetchDashboardWidgetData('recent_transactions', token),
        fetchDashboardWidgetData('failed_payouts', token),
      ]);

      if (healthRes.status === 'fulfilled') setHealth(healthRes.value);

      if (bankRes.status === 'fulfilled' && bankRes.value?.rows?.length) {
        setBankHealth(bankRes.value.rows as unknown as BankHealthRow[]);
      } else if (bankFallbackRes.status === 'fulfilled' && bankFallbackRes.value) {
        const rows = Array.isArray((bankFallbackRes.value.data as { rows?: BankHealthRow[] })?.rows)
          ? (bankFallbackRes.value.data as { rows: BankHealthRow[] }).rows : [];
        setBankHealth(rows);
      }
      if (recentLiveRes.status === 'fulfilled' && recentLiveRes.value?.rows?.length) {
        setTransactions(recentLiveRes.value.rows as unknown as TransactionRow[]);
      } else if (recentRes.status === 'fulfilled') {
        const widget = recentRes.value;
        setTransactions((widget.rows ?? []) as unknown as TransactionRow[]);
      }
      if (failedRes.status === 'fulfilled') {
        const widget = failedRes.value;
        // Prefer exact aggregate count when available; otherwise fall back to row length.
        setFailedCount(widget.count ?? widget.rows.length);
      }
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [token]);

  const isReady  = health?.status === 'ready';
  const dbOk     = health?.checks?.database?.status === 'ok';
  const redisOk  = health?.checks?.redis?.status === 'ok';
  const toolsOk  = health?.checks?.tools?.status === 'ok';
  const uptime   = health?.uptime ?? null;

  const totalVolume = transactions.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const successCount = transactions.filter(r => {
    const s = String(r.status ?? '').toLowerCase();
    return s === 'success' || s === '1';
  }).length;

  return (
    <div className="min-h-full bg-[#FAFAFA]">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-6 space-y-6">

        {/* ── Page Header ── */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#1a1a1a] tracking-tight">Overview</h1>
            <p className="text-gray-400 text-sm mt-1">
              Live data from your MCP tool server
              {lastUpdated && (
                <span className="ml-2 text-gray-300">· Updated {relativeTime(lastUpdated.toISOString())}</span>
              )}
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-[#E0E0E0] rounded-xl
                       text-sm font-medium text-gray-500 hover:text-brand hover:border-brand/30
                       hover:bg-brand-50 transition-all disabled:opacity-50 shadow-sm active:scale-95"
          >
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {/* ── Error Banner ── */}
        {error && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-100 rounded-2xl px-5 py-4">
            <svg className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-red-700">{error}</p>
              <p className="text-xs text-red-400 mt-0.5">Some tools may not have data yet — run DB seed scripts first.</p>
            </div>
          </div>
        )}

        {/* ── Service Status Bar ── */}
        <div className="bg-white border border-[#EBEBEB] rounded-2xl px-5 py-4 shadow-sm">
          <p className="text-[11px] font-semibold text-gray-300 uppercase tracking-widest mb-3">System Services</p>
          <div className="flex flex-wrap gap-2">
            <ServicePill label="API" ok={health ? isReady : null} detail={isReady ? ' · Ready' : health ? ' · Not Ready' : undefined} />
            <ServicePill label="Database" ok={health ? dbOk : null} detail={dbOk ? ' · Connected' : health ? ' · Error' : undefined} />
            <ServicePill label="Redis Cache" ok={health ? redisOk : null} detail={redisOk ? ' · Connected' : health ? ' · Error' : undefined} />
            <ServicePill label="MCP Tools" ok={health ? toolsOk ?? isReady : null} />
            {health?.version && (
              <span className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs text-gray-300 border border-gray-100 bg-gray-50">
                v{health.version}
              </span>
            )}
          </div>
        </div>

        {/* ── Metric Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            loading={loading}
            label="Uptime"
            value={uptime != null ? formatUptime(uptime) : '—'}
            sub={health?.environment ? `env: ${health.environment}` : undefined}
            accent="bg-brand-50 text-brand"
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
          <MetricCard
            loading={loading}
            label="Recent Transactions"
            value={transactions.length > 0 ? transactions.length : '—'}
            sub={totalVolume > 0 ? `Vol: ${formatAmount(totalVolume)}` : 'No data'}
            accent="bg-blue-50 text-blue-600"
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            }
          />
          <MetricCard
            loading={loading}
            label="Failed Payouts"
            value={failedCount ?? '—'}
            sub={failedCount ? 'Needs attention' : 'All clear'}
            accent={failedCount ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-600'}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            }
          />
          <MetricCard
            loading={loading}
            label="Banks Monitored"
            value={bankHealth.length > 0 ? bankHealth.length : '—'}
            sub={bankHealth.length > 0
              ? `${bankHealth.filter(b => b.status === 'up' || b.status === 'active').length} healthy`
              : undefined}
            accent="bg-purple-50 text-purple-600"
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l9-4 9 4M3 6v14l9 4 9-4V6M12 2v20" />
              </svg>
            }
          />
        </div>

        {/* ── Two-column row: Bank Health + Transaction Summary ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Bank Health Table — 2/3 width */}
          <div className="lg:col-span-2 bg-white border border-[#EBEBEB] rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#F0F0F0]">
              <div>
                <h2 className="text-sm font-bold text-[#1a1a1a]">Bank / PSP Health</h2>
                <p className="text-[11px] text-gray-400 mt-0.5">Real-time payment gateway status</p>
              </div>
              {bankHealth.length > 0 && (
                <span className="text-[11px] font-semibold text-gray-400 bg-gray-50 border border-gray-100 px-2.5 py-1 rounded-full">
                  {bankHealth.length} banks
                </span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[500px]">
                <thead>
                  <tr className="bg-[#FAFAFA] border-b border-[#F0F0F0]">
                    <th className="text-left px-6 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Bank</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Status</th>
                    <th className="text-right px-6 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Success Rate</th>
                    <th className="text-right px-6 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Avg Response</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && bankHealth.length === 0
                    ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={4} />)
                    : bankHealth.length === 0
                      ? (
                        <tr>
                          <td colSpan={4} className="px-6 py-12 text-center text-gray-300 text-sm">
                            No bank data available
                          </td>
                        </tr>
                      )
                      : bankHealth.map((row, i) => (
                          <tr key={i} className="border-b border-[#F5F5F5] hover:bg-[#FAFAFA] transition-colors">
                            <td className="px-6 py-3.5">
                              <div>
                                <p className="font-mono font-bold text-[#1a1a1a] text-xs">{row.bank_code}</p>
                                {row.bank_name && <p className="text-[11px] text-gray-400 mt-0.5 truncate max-w-[120px]">{row.bank_name}</p>}
                              </div>
                            </td>
                            <td className="px-4 py-3.5">
                              <StatusBadge status={row.status} />
                            </td>
                            <td className="px-6 py-3.5 text-right">
                              {row.success_rate != null
                                ? <SuccessBar rate={Number(row.success_rate)} />
                                : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-6 py-3.5 text-right">
                              {row.avg_response_ms != null ? (
                                <span className={`text-xs font-semibold ${Number(row.avg_response_ms) < 300 ? 'text-emerald-600' : Number(row.avg_response_ms) < 800 ? 'text-amber-500' : 'text-red-500'}`}>
                                  {row.avg_response_ms}ms
                                </span>
                              ) : <span className="text-gray-300 text-xs">—</span>}
                            </td>
                          </tr>
                        ))
                  }
                </tbody>
              </table>
            </div>
          </div>

          {/* Transaction Summary — 1/3 width */}
          <div className="bg-white border border-[#EBEBEB] rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-[#F0F0F0]">
              <h2 className="text-sm font-bold text-[#1a1a1a]">Transaction Mix</h2>
              <p className="text-[11px] text-gray-400 mt-0.5">Last {transactions.length || '—'} transactions</p>
            </div>
            <div className="px-6 py-5 space-y-4">
              {loading && transactions.length === 0 ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="h-3 w-24 bg-gray-100 rounded-full animate-pulse" />
                    <div className="h-3 w-12 bg-gray-100 rounded-full animate-pulse" />
                  </div>
                ))
              ) : transactions.length === 0 ? (
                <p className="text-sm text-gray-300 text-center py-6">No transactions yet</p>
              ) : (
                (() => {
                  const groups = transactions.reduce<Record<string, number>>((acc, t) => {
                    const k = String(t.status ?? 'unknown');
                    acc[k] = (acc[k] ?? 0) + 1;
                    return acc;
                  }, {});
                  const total = transactions.length;
                  return Object.entries(groups).map(([status, count]) => {
                    const pct = Math.round((count / total) * 100);
                    const colors: Record<string, string> = {
                      success: 'bg-emerald-500', '1': 'bg-emerald-500',
                      failed:  'bg-red-500',     '4': 'bg-red-500',
                      pending: 'bg-amber-400',   '2': 'bg-amber-400',
                      processed:'bg-blue-500',   '6': 'bg-blue-500',
                      reversed:'bg-purple-500',  '8': 'bg-purple-500',
                    };
                    const bar = colors[String(status).toLowerCase()] ?? 'bg-gray-400';
                    return (
                      <div key={status}>
                        <div className="flex items-center justify-between mb-1.5">
                          <StatusBadge status={status} />
                          <span className="text-xs font-bold text-[#1a1a1a]">{count} <span className="font-normal text-gray-400">({pct}%)</span></span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${bar} transition-all`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  });
                })()
              )}

              {transactions.length > 0 && successCount > 0 && (
                <div className="pt-3 border-t border-[#F5F5F5]">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">Success Rate</span>
                    <span className={`font-bold ${(successCount / transactions.length) >= 0.95 ? 'text-emerald-600' : 'text-amber-500'}`}>
                      {((successCount / transactions.length) * 100).toFixed(1)}%
                    </span>
                  </div>
                  {totalVolume > 0 && (
                    <div className="flex items-center justify-between text-xs mt-1.5">
                      <span className="text-gray-400">Total Volume</span>
                      <span className="font-bold text-[#1a1a1a]">{formatAmount(totalVolume)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Recent Transactions ── */}
        <div className="bg-white border border-[#EBEBEB] rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#F0F0F0]">
            <div>
              <h2 className="text-sm font-bold text-[#1a1a1a]">Recent Transactions</h2>
              <p className="text-[11px] text-gray-400 mt-0.5">Latest activity across all payment channels</p>
            </div>
            {transactions.length > 0 && (
              <span className="text-[11px] font-semibold text-gray-400 bg-gray-50 border border-gray-100 px-2.5 py-1 rounded-full">
                {transactions.length} rows
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="bg-[#FAFAFA] border-b border-[#F0F0F0]">
                  <th className="text-left px-6 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Transaction ID</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Bank</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Status</th>
                  <th className="text-right px-6 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Amount</th>
                  <th className="text-right px-6 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Time</th>
                </tr>
              </thead>
              <tbody>
                {loading && transactions.length === 0
                  ? Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} cols={5} />)
                  : transactions.length === 0
                    ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-16 text-center">
                          <svg className="w-10 h-10 mx-auto mb-3 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                          </svg>
                          <p className="text-sm text-gray-400">No transactions found</p>
                          <p className="text-xs text-gray-300 mt-1">Seed your database to see live rows here</p>
                        </td>
                      </tr>
                    )
                    : transactions.map((row, i) => {
                        const rawId = String(row.rrn ?? row.id ?? '');
                        const rawUserId = row.user_id != null ? String(row.user_id) : '';
                        return (
                        <tr key={i} className="border-b border-[#F5F5F5] hover:bg-[#FAFAFA] transition-colors group">
                          <td className="px-6 py-3.5">
                            <div>
                              <p className="font-mono text-xs text-[#404040] font-medium">
                                {rawId.slice(0, 16)}
                                {rawId.length > 16 && <span className="text-gray-300">…</span>}
                              </p>
                              {rawUserId && (
                                <p className="text-[10px] text-gray-300 mt-0.5 font-mono">uid: {rawUserId.slice(0, 8)}…</p>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            {row.bank_code
                              ? <span className="font-mono text-xs font-semibold text-gray-500 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-lg">{row.bank_code}</span>
                              : <span className="text-gray-300 text-xs">—</span>}
                          </td>
                          <td className="px-4 py-3.5">
                            <StatusBadge status={row.status} />
                          </td>
                          <td className="px-6 py-3.5 text-right">
                            <span className="font-bold text-[#1a1a1a] tabular-nums">
                              {formatAmount(Number(row.amount), row.currency ?? 'INR')}
                            </span>
                          </td>
                          <td className="px-6 py-3.5 text-right">
                            <span className="text-xs text-gray-400">{relativeTime(String(row.created_at ?? ''))}</span>
                          </td>
                        </tr>
                        );
                      })
                }
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Empty state (no data at all) ── */}
        {!loading && !error && bankHealth.length === 0 && transactions.length === 0 && (
          <div className="bg-white border border-[#EBEBEB] rounded-2xl shadow-sm text-center py-20 px-8">
            <div className="inline-flex w-16 h-16 rounded-2xl bg-gray-50 items-center justify-center mb-5">
              <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            </div>
            <h3 className="text-base font-bold text-[#1a1a1a] mb-2">No data yet</h3>
            <p className="text-sm text-gray-400 max-w-sm mx-auto leading-relaxed">
              Seed your MySQL database to see live rows here. MCP tools are connected and ready.
            </p>
            <div className="flex items-center justify-center gap-2 mt-4">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-gray-300">MCP tools connected</span>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
