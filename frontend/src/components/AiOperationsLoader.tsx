/**
 * AiOperationsLoader — Premium AI loading experience for FinBridge AI.
 *
 * Replaces the basic bouncing dots with:
 *   • Live progress stages with smart per-query-type messaging
 *   • MCP activity chips (animated, pulsing)
 *   • AI operations panel (step-by-step log)
 *   • Rotating insight cards
 *   • Animated KPI skeleton cards
 */

import { useState, useEffect, useRef } from 'react';
import type { AiStreamState } from '../hooks/useAiStream';
import { humanizeTool } from '../hooks/useAiStream';

// ─── Query type detection ─────────────────────────────────────────────────────

type QueryType = 'payout' | 'bank' | 'fraud' | 'settlement' | 'transaction' | 'general';

function detectQueryType(query: string): QueryType {
  const q = query.toLowerCase();
  if (/payout|disburse|utr|beneficiar/.test(q)) return 'payout';
  if (/bank|psp|latency|health|hdfc|icici|sbi|axis|yes bank|kotak/.test(q)) return 'bank';
  if (/fraud|anomal|suspicious|risk|chargeback|dispute/.test(q)) return 'fraud';
  if (/settle|reconcil|neft|imps|clearing/.test(q)) return 'settlement';
  if (/transaction|txn|payment|rrn|volume|tps/.test(q)) return 'transaction';
  return 'general';
}

// ─── Stage configs ────────────────────────────────────────────────────────────

const STAGE_MESSAGES: Record<QueryType, string[]> = {
  payout: [
    'Connecting to payout engine...',
    'Fetching live payout records...',
    'Calculating success rates...',
    'Analyzing failure patterns...',
    'Running AI insights...',
    'Preparing verified response...',
  ],
  bank: [
    'Scanning bank health systems...',
    'Analyzing PSP performance...',
    'Detecting latency spikes...',
    'Cross-checking uptime metrics...',
    'Generating health report...',
    'Preparing verified response...',
  ],
  fraud: [
    'Initiating anomaly detection...',
    'Scanning suspicious patterns...',
    'Cross-validating risk signals...',
    'Running fraud scoring engine...',
    'Generating risk report...',
    'Preparing verified response...',
  ],
  settlement: [
    'Checking settlement queue...',
    'Verifying reconciliation records...',
    'Analyzing settlement delays...',
    'Checking clearing schedules...',
    'Generating settlement report...',
    'Preparing verified response...',
  ],
  transaction: [
    'Querying transaction ledger...',
    'Fetching live transaction data...',
    'Calculating volume metrics...',
    'Analyzing transaction patterns...',
    'Running AI analysis...',
    'Preparing verified response...',
  ],
  general: [
    'Understanding your query...',
    'Fetching live financial data...',
    'Running analytics engine...',
    'Generating AI insights...',
    'Verifying response data...',
    'Preparing verified response...',
  ],
};

// ─── MCP tool categories for activity chips ──────────────────────────────────

const TOOL_CHIP_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  default:     { bg: 'bg-brand-50 border border-brand/20',  text: 'text-brand',       dot: 'bg-brand'       },
  bank:        { bg: 'bg-blue-50 border border-blue-200',   text: 'text-blue-700',    dot: 'bg-blue-500'    },
  payout:      { bg: 'bg-purple-50 border border-purple-200', text: 'text-purple-700', dot: 'bg-purple-500' },
  settlement:  { bg: 'bg-emerald-50 border border-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  transaction: { bg: 'bg-amber-50 border border-amber-200', text: 'text-amber-700',   dot: 'bg-amber-500'   },
  fraud:       { bg: 'bg-red-50 border border-red-200',     text: 'text-red-700',     dot: 'bg-red-500'     },
};

function chipColor(toolName: string) {
  const n = toolName.toLowerCase();
  if (n.includes('bank') || n.includes('psp') || n.includes('health')) return TOOL_CHIP_COLORS.bank;
  if (n.includes('payout') || n.includes('disburse')) return TOOL_CHIP_COLORS.payout;
  if (n.includes('settl') || n.includes('reconcil')) return TOOL_CHIP_COLORS.settlement;
  if (n.includes('transact') || n.includes('txn')) return TOOL_CHIP_COLORS.transaction;
  if (n.includes('fraud') || n.includes('anomal') || n.includes('risk')) return TOOL_CHIP_COLORS.fraud;
  return TOOL_CHIP_COLORS.default;
}

// ─── Rotating insight cards ───────────────────────────────────────────────────

const INSIGHT_CARDS: Record<QueryType, string[]> = {
  payout: [
    'Payout success rates vary by bank corridor',
    'Retry logic can recover ~12% of failed payouts',
    'NEFT cut-off times affect settlement windows',
    'UTR mismatches cause 8% of reconciliation issues',
  ],
  bank: [
    'Bank latency spikes usually occur during 9-11 AM',
    'HDFC IMPS has highest throughput on weekdays',
    'Switching PSPs can reduce failure rates by 15%',
    'Network issues often precede bank health drops',
  ],
  fraud: [
    'Velocity checks catch 72% of fraud attempts',
    'Device fingerprinting reduces false positives',
    'Unusual geolocation is a key fraud signal',
    'ML anomaly detection operates in < 50ms',
  ],
  settlement: [
    'NEFT settles in 30-minute batches during business hours',
    'IMPS provides 24/7 real-time settlement',
    'Reconciliation gaps often trace to timing mismatches',
    'Auto-reconciliation reduces manual effort by 80%',
  ],
  transaction: [
    'Peak TPS occurs between 10 AM – 12 PM IST',
    'UPI transactions dominate payment volume',
    'Failed transactions spike on bank maintenance windows',
    'P99 latency is a critical success metric',
  ],
  general: [
    'FinBridge AI queries live systems in real-time',
    'All responses are verified against live data',
    'Redis caching reduces query latency by 60%',
    'AI memory learns from every interaction',
  ],
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function McpChip({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  const c = chipColor(label);
  return (
    <div className={`
      inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold
      transition-all duration-300 ${c.bg} ${c.text}
      ${active ? 'shadow-md scale-[1.03]' : ''}
      ${done ? 'opacity-60' : ''}
    `}>
      <span className={`
        w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.dot}
        ${active ? 'animate-ping-slow' : done ? '' : 'opacity-40'}
      `} />
      {done && (
        <svg className="w-3 h-3 opacity-80 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      )}
      {active && (
        <span className="w-3 h-3 flex-shrink-0">
          <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
        </span>
      )}
      {humanizeTool(label)}
    </div>
  );
}

function SkeletonKpiCard({ color }: { color: string }) {
  const colors = {
    red:    'from-red-100 to-red-50 border-red-100',
    blue:   'from-blue-100 to-blue-50 border-blue-100',
    green:  'from-emerald-100 to-emerald-50 border-emerald-100',
    amber:  'from-amber-100 to-amber-50 border-amber-100',
    purple: 'from-purple-100 to-purple-50 border-purple-100',
  };
  const cls = colors[color as keyof typeof colors] ?? colors.blue;
  return (
    <div className={`rounded-2xl border bg-gradient-to-br ${cls} p-4 flex flex-col gap-2 animate-pulse`}>
      <div className="h-2.5 w-16 rounded-full bg-current opacity-20" />
      <div className="h-7 w-20 rounded-lg bg-current opacity-15" />
      <div className="h-2 w-12 rounded-full bg-current opacity-10" />
    </div>
  );
}

function OperationsPanel({ steps, activeTools }: { steps: string[]; activeTools: string[] }) {
  return (
    <div className="rounded-2xl border border-[#EBEBEB] bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#F0F0F0] bg-[#FAFAFA]">
        <div className="flex gap-1">
          <span className="w-2 h-2 rounded-full bg-red-400" />
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        </div>
        <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
          FinBridge AI — Operations
        </span>
      </div>

      {/* Steps */}
      <div className="px-4 py-3 space-y-1.5 max-h-36 overflow-hidden">
        {steps.map((step, i) => {
          const isDone = i < steps.length - 1;
          const isActive = i === steps.length - 1;
          return (
            <div
              key={i}
              className={`flex items-start gap-2 text-xs transition-all duration-300 ${
                isActive ? 'text-[#404040] font-medium' : 'text-gray-400'
              }`}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              {isDone ? (
                <svg className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5 text-brand flex-shrink-0 mt-0.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
              )}
              <span className="leading-snug">{step}</span>
            </div>
          );
        })}

        {/* Active tool inline */}
        {activeTools.length > 0 && (
          <div className="flex items-center gap-2 text-[11px] text-brand font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse flex-shrink-0" />
            Querying {humanizeTool(activeTools[activeTools.length - 1])}...
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface AiOperationsLoaderProps {
  query: string;
  streamState: AiStreamState;
}

export function AiOperationsLoader({ query, streamState }: AiOperationsLoaderProps) {
  const queryType = detectQueryType(query);
  const [stepIdx, setStepIdx] = useState(0);
  const [insightIdx, setInsightIdx] = useState(0);
  const [showInsight, setShowInsight] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stages = STAGE_MESSAGES[queryType];
  const insights = INSIGHT_CARDS[queryType];

  // Advance loading stage every ~1.6s (if no backend event overrides it)
  useEffect(() => {
    setStepIdx(0);
    intervalRef.current = setInterval(() => {
      setStepIdx(i => Math.min(i + 1, stages.length - 1));
    }, 1600);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [query, stages.length]);

  // Rotate insight cards every 3s with fade
  useEffect(() => {
    const t = setInterval(() => {
      setShowInsight(false);
      setTimeout(() => {
        setInsightIdx(i => (i + 1) % insights.length);
        setShowInsight(true);
      }, 300);
    }, 3200);
    return () => clearInterval(t);
  }, [insights.length]);

  // If backend sends a step, add it to displayed steps
  const displayedSteps = streamState.steps.length > 0
    ? streamState.steps
    : stages.slice(0, stepIdx + 1);

  const allTools = [
    ...streamState.activeTools,
    ...streamState.completedTools,
  ];

  const currentMsg = streamState.message || stages[stepIdx];

  return (
    <div className="flex flex-col gap-4 w-full max-w-xl">

      {/* ── Primary status pill ── */}
      <div className="flex items-center gap-3">
        {/* Animated brand ring */}
        <div className="relative flex-shrink-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand to-brand-700 flex items-center justify-center shadow-md shadow-brand/25">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-white animate-pulse" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-[#1a1a1a] leading-none">FinBridge AI</p>
          <p className="text-[11px] text-gray-400 mt-0.5 truncate transition-all duration-500">{currentMsg}</p>
        </div>

        {/* Stage badge */}
        <div className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full bg-brand-50 border border-brand/15">
          <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
          <span className="text-[10px] font-bold text-brand uppercase tracking-wide">Live</span>
        </div>
      </div>

      {/* ── MCP Activity chips ── */}
      {allTools.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {streamState.activeTools.map(t => (
            <McpChip key={`active-${t}`} label={t} active done={false} />
          ))}
          {streamState.completedTools.map(t => (
            <McpChip key={`done-${t}`} label={t} active={false} done />
          ))}
        </div>
      )}

      {/* ── Operations panel ── */}
      {displayedSteps.length > 0 && (
        <OperationsPanel
          steps={displayedSteps}
          activeTools={streamState.activeTools}
        />
      )}

      {/* ── Skeleton KPI cards ── */}
      <div className="grid grid-cols-3 gap-2">
        <SkeletonKpiCard color="blue" />
        <SkeletonKpiCard color="green" />
        <SkeletonKpiCard color="amber" />
      </div>

      {/* ── Rotating insight card ── */}
      <div
        className={`
          rounded-xl border border-[#EBEBEB] bg-gradient-to-r from-[#FAFAFA] to-white
          px-4 py-3 flex items-start gap-2.5
          transition-all duration-300 ${showInsight ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'}
        `}
      >
        <span className="text-brand flex-shrink-0 mt-0.5">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        </span>
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-0.5">Insight</p>
          <p className="text-xs text-[#404040] leading-snug">{insights[insightIdx]}</p>
        </div>
      </div>

      {/* ── Verification trust bar ── */}
      <div className="flex items-center gap-3 text-[11px] text-gray-400">
        <div className="flex items-center gap-1">
          <svg className="w-3 h-3 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <span>Verified from live systems</span>
        </div>
        <span className="text-gray-200">·</span>
        <div className="flex items-center gap-1">
          <svg className="w-3 h-3 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span>Refreshed now</span>
        </div>
        <span className="text-gray-200">·</span>
        <div className="flex items-center gap-1">
          <svg className="w-3 h-3 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
          </svg>
          <span>AI-powered analysis</span>
        </div>
      </div>
    </div>
  );
}
