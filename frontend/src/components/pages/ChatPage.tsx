import { useState, useRef, useEffect, useCallback } from 'react';
import {
  aiChat,
  queueAiChat,
  cancelAiJob,
  editMessage as editMessageApi,
  listConversations,
  getConversation,
  deleteConversation,
} from '../../api/client';
import type {
  ChatMessage, AiChatResponse, Conversation, ConversationMessage, ToolCallInfo,
} from '../../types';
import { useVoice } from '../../hooks/useVoice';
import { useAiStream } from '../../hooks/useAiStream';
import type { AiJobCompleteEvent, AiJobFailedEvent } from '../../hooks/useAiStream';
import { humanizeTool } from '../../hooks/useAiStream';
import { useConversationPersistence } from '../../hooks/useConversationPersistence';

interface ChatPageProps {
  token: string;
}

function randomId() {
  return Math.random().toString(36).slice(2);
}

function toUiMessages(rows: ConversationMessage[]): ChatMessage[] {
  return rows.map(r => ({
    id: r.id,
    role: r.role,
    content: r.content,
    toolCalls: r.tool_calls?.map(name => ({ name, args: {} })),
    timestamp: new Date(r.created_at),
  }));
}



// ─── Metric / record parsers ──────────────────────────────────────────────────

function tryParseMetrics(content: string): Array<{ label: string; value: string; unit: string; color: string }> | null {
  const lines = content.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return null;
  const metricLine = /^(.+?):\s*([\d,.-]+)\s*(?:\(([^)]+)\))?$/;
  const results: Array<{ label: string; value: string; unit: string; color: string }> = [];
  for (const line of lines) {
    const m = line.match(metricLine);
    if (!m) return null;
    const [, rawLabel, value, unit = ''] = m;
    const label = rawLabel.replace(/\s*\(\d{4}-\d{2}-\d{2}\)/g, '').trim();
    const ll = label.toLowerCase();
    let color = 'blue';
    if (ll.includes('fail') || ll.includes('error') || ll.includes('reject')) color = 'red';
    else if (ll.includes('success') || ll.includes('complet') || ll.includes('settled')) color = 'green';
    else if (ll.includes('pend') || ll.includes('process') || ll.includes('queue')) color = 'amber';
    else if (ll.includes('total') || ll.includes('count') || ll.includes('volume')) color = 'purple';
    results.push({ label, value, unit, color });
  }
  return results.length >= 2 ? results : null;
}

const COLOR_MAP: Record<string, { bg: string; border: string; label: string; value: string; dot: string }> = {
  red:    { bg: 'bg-red-50',    border: 'border-red-100',    label: 'text-red-500',    value: 'text-red-700',    dot: 'bg-red-400'    },
  green:  { bg: 'bg-emerald-50', border: 'border-emerald-100', label: 'text-emerald-500', value: 'text-emerald-700', dot: 'bg-emerald-400' },
  amber:  { bg: 'bg-amber-50',  border: 'border-amber-100',  label: 'text-amber-500',  value: 'text-amber-700',  dot: 'bg-amber-400'  },
  purple: { bg: 'bg-purple-50', border: 'border-purple-100', label: 'text-purple-500', value: 'text-purple-700', dot: 'bg-purple-400' },
  blue:   { bg: 'bg-blue-50',   border: 'border-blue-100',   label: 'text-blue-500',   value: 'text-blue-700',   dot: 'bg-blue-400'   },
};

const SUGGESTIONS = [
  { icon: '🏦', text: 'What is the health of all payment banks?',    tag: 'Bank Health'   },
  { icon: '❌', text: 'Show me the last 10 failed payouts',           tag: 'Payouts'       },
  { icon: '📊', text: 'Get recent transactions with status failed',   tag: 'Transactions'  },
  { icon: '📋', text: 'What is the settlement report for this month?', tag: 'Settlements'  },
  { icon: '🔍', text: 'Look up RRN 123456789012',                     tag: 'Lookup'        },
  { icon: '💳', text: "Show today's total transaction volume",         tag: 'Analytics'    },
];

function MetricCard({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  const c = COLOR_MAP[color] ?? COLOR_MAP.blue;
  return (
    <div className={`${c.bg} ${c.border} border rounded-2xl p-4 flex flex-col gap-1.5`}>
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.dot}`} />
        <span className={`text-[11px] font-semibold uppercase tracking-wide ${c.label} truncate`}>{label}</span>
      </div>
      <span className={`text-3xl font-bold leading-none ${c.value}`}>{value}</span>
      {unit && <span className={`text-[11px] font-medium ${c.label} opacity-70 capitalize`}>{unit}</span>}
    </div>
  );
}

function toolLabel(name: string): string {
  return name
    .replace(/^query_/, '')
    .replace(/^[a-z0-9]+_api_/, '')
    .replace(/^[a-z0-9]+_merchant_[a-z0-9]+_api_/, '')
    .replace(/tbl_/, '')
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function DataSourcesBadge({ toolCalls }: { toolCalls: ToolCallInfo[] }) {
  const unique = [...new Set(toolCalls.map(t => toolLabel(t.name)))];
  return (
    <div className="flex items-center gap-2 mt-2 px-1">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
        <svg className="w-3 h-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
        </svg>
        Live data
      </div>
      <div className="flex flex-wrap gap-1">
        {unique.map((label, i) => (
          <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-50 border border-brand/15 text-brand text-[10px] font-semibold">
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function QueryInspector({ toolCalls }: { toolCalls: ToolCallInfo[] }) {
  const [open, setOpen] = useState(false);
  if (toolCalls.length === 0) return null;
  const renderArgs = (args: Record<string, unknown>): string => {
    try { return JSON.stringify(args, null, 2); } catch { return String(args); }
  };
  return (
    <div className="mt-1 px-1">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-[10px] font-semibold text-gray-400 hover:text-brand uppercase tracking-wide transition">
        <svg className={`w-2.5 h-2.5 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
        </svg>
        {open ? 'Hide query' : `View query (${toolCalls.length})`}
      </button>
      {open && (
        <div className="mt-1.5 space-y-2">
          {toolCalls.map((t, i) => (
            <div key={i} className="border border-gray-100 rounded-lg bg-gray-50/60 p-2 text-[11px]">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-mono text-[10px] text-gray-500">{t.name}</span>
                <span className="text-[10px] text-gray-400">#{i + 1}</span>
              </div>
              {t.sql ? (
                <>
                  <div className="text-[9px] uppercase font-semibold text-gray-400 tracking-wide mt-1.5 mb-0.5">SQL</div>
                  <pre className="font-mono text-[10.5px] text-indigo-700 bg-white border border-indigo-50 rounded px-2 py-1.5 whitespace-pre-wrap break-all leading-snug">{t.sql}</pre>
                  {t.params && t.params.length > 0 && (
                    <>
                      <div className="text-[9px] uppercase font-semibold text-gray-400 tracking-wide mt-1.5 mb-0.5">Params</div>
                      <pre className="font-mono text-[10.5px] text-emerald-700 bg-white border border-emerald-50 rounded px-2 py-1 whitespace-pre-wrap break-all leading-snug">{JSON.stringify(t.params)}</pre>
                    </>
                  )}
                </>
              ) : (
                <>
                  <div className="text-[9px] uppercase font-semibold text-gray-400 tracking-wide mt-1.5 mb-0.5">Arguments</div>
                  <pre className="font-mono text-[10.5px] text-gray-700 bg-white border border-gray-100 rounded px-2 py-1.5 whitespace-pre-wrap break-all leading-snug">{renderArgs(t.args)}</pre>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface RecordRow { id: string; fields: Record<string, string> }
interface ParsedRecords {
  entity: string;
  summary: Array<{ label: string; value: string; unit: string; color: string }>;
  rows: RecordRow[];
}

function tryParseRecords(content: string): ParsedRecords | null {
  const lines = content.trim().split('\n').filter(l => l.trim());
  const recPattern = /^(\w+)\s+ID\s+(\d+):\s+(.+)$/i;
  const rows: RecordRow[] = [];
  const summaryLines: string[] = [];
  let entity = 'Record';
  for (const line of lines) {
    const m = line.match(recPattern);
    if (m) {
      entity = m[1];
      const fields: Record<string, string> = {};
      m[3].split(/\s*\|\s*/).forEach(pair => {
        const idx = pair.indexOf(':');
        if (idx === -1) return;
        fields[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
      });
      rows.push({ id: m[2], fields });
    } else {
      summaryLines.push(line);
    }
  }
  if (rows.length === 0) return null;
  const metricPattern = /^(.+?):\s*([\d,.-]+)\s*(?:\(([^)]+)\))?$/;
  const summary: ParsedRecords['summary'] = [];
  for (const line of summaryLines) {
    const sm = line.match(metricPattern);
    if (!sm) continue;
    const [, rawLabel, value, unit = ''] = sm;
    const label = rawLabel.replace(/\s*\(\d{4}-\d{2}-\d{2}\)/g, '').trim();
    const ll = label.toLowerCase();
    let color = 'blue';
    if (ll.includes('fail') || ll.includes('error')) color = 'red';
    else if (ll.includes('success') || ll.includes('complet')) color = 'green';
    else if (ll.includes('pend') || ll.includes('process')) color = 'amber';
    else if (ll.includes('total') || ll.includes('count') || ll.includes('amount')) color = 'purple';
    summary.push({ label, value, unit, color });
  }
  return { entity, summary, rows };
}

function fmtDate(val: string): string {
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return val;
    return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return val; }
}

function fmtAmount(val: string): string {
  const n = parseFloat(val);
  if (isNaN(n)) return val;
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function FieldValue({ k, v }: { k: string; v: string }) {
  const kl = k.toLowerCase();
  if (kl.includes('amount') || kl.includes('amt')) return <span className="font-semibold text-[#1a1a2e]">{fmtAmount(v)}</span>;
  if (kl.includes('_at') || kl.includes('date') || kl.includes('time')) return <span className="text-gray-500">{fmtDate(v)}</span>;
  if (kl === 'status') {
    const sl = v.toLowerCase();
    const cls = sl === 'success' || sl === '1' ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
              : sl === 'failed' || sl === '0' ? 'bg-red-50 text-red-700 border-red-100'
              : 'bg-amber-50 text-amber-700 border-amber-100';
    const label = sl === '1' ? 'Success' : sl === '0' ? 'Failed' : v;
    return <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${cls}`}>{label}</span>;
  }
  if (kl === 'utr' || kl === 'rrn' || kl === 'ref') return <span className="font-mono text-xs text-indigo-600">{v}</span>;
  return <span className="text-gray-700">{v}</span>;
}

function RecordsView({ data }: { data: ParsedRecords }) {
  const SUMMARY_COLORS: Record<string, { bg: string; text: string; val: string }> = {
    red:    { bg: 'bg-red-50 border-red-100',     text: 'text-red-500',     val: 'text-red-700'     },
    green:  { bg: 'bg-emerald-50 border-emerald-100', text: 'text-emerald-500', val: 'text-emerald-700' },
    amber:  { bg: 'bg-amber-50 border-amber-100', text: 'text-amber-500',   val: 'text-amber-700'   },
    purple: { bg: 'bg-purple-50 border-purple-100', text: 'text-purple-500', val: 'text-purple-700' },
    blue:   { bg: 'bg-blue-50 border-blue-100',   text: 'text-blue-500',    val: 'text-blue-700'    },
  };
  const allKeys = data.rows.length > 0 ? Object.keys(data.rows[0].fields) : [];
  return (
    <div className="flex flex-col gap-3 w-full">
      {data.summary.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {data.summary.map((s, i) => {
            const c = SUMMARY_COLORS[s.color] ?? SUMMARY_COLORS.blue;
            return (
              <div key={i} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border ${c.bg}`}>
                <span className={`text-[11px] font-semibold ${c.text} uppercase tracking-wide`}>{s.label}</span>
                <span className={`text-sm font-bold ${c.val}`}>{s.value}</span>
                {s.unit && <span className={`text-[10px] ${c.text} opacity-70`}>{s.unit}</span>}
              </div>
            );
          })}
        </div>
      )}
      <div className="rounded-2xl border border-[#EBEBEB] overflow-hidden shadow-sm">
        <div className="grid bg-gray-50 border-b border-[#EBEBEB] px-4 py-2.5"
          style={{ gridTemplateColumns: `40px repeat(${allKeys.length}, 1fr)` }}>
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">#</span>
          {allKeys.map(k => (
            <span key={k} className="text-[10px] font-bold text-gray-400 uppercase tracking-wide truncate pr-2">{k}</span>
          ))}
        </div>
        {data.rows.map((row, i) => (
          <div key={row.id}
            className={`grid px-4 py-3 items-center gap-x-2 ${i !== data.rows.length - 1 ? 'border-b border-[#F0F0F0]' : ''} hover:bg-gray-50/60 transition-colors`}
            style={{ gridTemplateColumns: `40px repeat(${allKeys.length}, 1fr)` }}>
            <span className="text-[11px] font-bold text-gray-400">{row.id}</span>
            {allKeys.map(k => (
              <div key={k} className="text-sm truncate pr-2">
                <FieldValue k={k} v={row.fields[k] ?? '—'} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-400 text-right px-1">{data.rows.length} record{data.rows.length !== 1 ? 's' : ''} returned</p>
    </div>
  );
}

function MessageContent({ content }: { content: string }) {
  const records = tryParseRecords(content);
  if (records) return <RecordsView data={records} />;
  const metrics = tryParseMetrics(content);
  if (metrics) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {metrics.map((m, i) => <MetricCard key={i} {...m} />)}
      </div>
    );
  }
  return <p className="text-sm leading-relaxed whitespace-pre-wrap text-[#404040]">{content}</p>;
}

// ─── Processing animation card (shown in chat bubble while loading) ───────────

function ProcessingCard({ query }: { query: string }) {
  return (
    <div className="w-full">
      <p className="text-sm font-semibold text-[#1a1a2e]">Processing your request...</p>
      <p className="text-xs text-gray-400 mt-0.5 mb-5">
        {query
          ? `Retrieving details for: ${query.length > 55 ? query.slice(0, 55) + '…' : query}`
          : 'Analyzing your query...'}
      </p>

      {/* Flow: Database → AI → Checkmark */}
      <div className="flex items-center justify-between mb-5 px-2">
        {/* Database icon */}
        <div className="w-14 h-14 rounded-full bg-blue-50 border-2 border-blue-100 flex items-center justify-center flex-shrink-0">
          <svg className="w-7 h-7 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
              d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
          </svg>
        </div>

        {/* Animated dots (left) */}
        <div className="flex-1 flex items-center justify-center gap-1.5 mx-1">
          {[0, 1, 2, 3, 4].map(i => (
            <span key={i} className="w-2 h-2 rounded-full bg-brand/60 animate-pulse"
              style={{ animationDelay: `${i * 120}ms` }} />
          ))}
        </div>

        {/* FinBridge AI icon (pulsing) */}
        <div className="w-14 h-14 rounded-full bg-brand flex items-center justify-center flex-shrink-0 animate-pulse shadow-lg shadow-brand/30">
          <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>

        {/* Static dots (right) */}
        <div className="flex-1 flex items-center justify-center gap-1.5 mx-1">
          {[0, 1, 2, 3, 4].map(i => (
            <span key={i} className="w-2 h-2 rounded-full bg-gray-200" />
          ))}
        </div>

        {/* Checkmark (pending) */}
        <div className="w-14 h-14 rounded-full bg-gray-50 border-2 border-gray-100 flex items-center justify-center flex-shrink-0">
          <svg className="w-7 h-7 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      </div>

      {/* Trust badges */}
      <div className="flex items-center gap-4 text-[11px] text-gray-500 flex-wrap justify-center">
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.14 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
          </svg>
          Live Data
        </div>
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          Encrypted Connection
        </div>
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
          AI Verified
        </div>
      </div>
    </div>
  );
}

// ─── Main ChatPage ────────────────────────────────────────────────────────────

export function ChatPage({ token }: ChatPageProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingQuery, setPendingQuery] = useState('');
  const [sidebarLoading, setSidebarLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showConvList, setShowConvList] = useState(false);
  const [voiceAutoPlay, setVoiceAutoPlay] = useState(false);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState('');

  // ── Persistence, background jobs, stop generation, edit/resend ──
  const {
    persistedConvId,
    persistedDraft,
    setActiveConvId: persistConvId,
    saveDraft,
    clearDraft,
    broadcastMessage,
  } = useConversationPersistence();

  // Feature 5: stop generation
  const pendingJobIdRef = useRef<string | null>(null);
  const syncAbortRef = useRef<AbortController | null>(null);

  // Feature 6: edit & resend
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  // Feature 7: "completed while you were away" banner
  const [completedWhileAway, setCompletedWhileAway] = useState(false);
  const isPageVisibleRef = useRef(true);


  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    isListening, sttSupported, startListening, stopListening,
    isSpeaking, ttsSupported, speak, cancelSpeech,
    error: voiceError, clearError: clearVoiceError,
  } = useVoice({
    silenceMs: 5000,
    onTranscript: (text) => {
      setShowVoiceModal(false);
      setVoiceDraft('');
      setInput(text);
      setTimeout(() => {
        if (textareaRef.current) {
          autoResizeTextarea(textareaRef.current);
          textareaRef.current.focus();
        }
      }, 50);
    },
    onInterim: (text) => setVoiceDraft(text),
  });

  // Feature 1: background job completion → update UI even after tab-switch
  const onJobComplete = useCallback((event: AiJobCompleteEvent) => {
    pendingJobIdRef.current = null;
    const assistantMsg: ChatMessage = {
      id: event.messageId,
      role: 'assistant',
      content: event.reply,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, assistantMsg]);
    setLoading(false);

    // Feature 7: show banner if user was away
    if (!isPageVisibleRef.current) {
      setCompletedWhileAway(true);
    }

    // Feature 11: broadcast to other tabs
    broadcastMessage({ type: 'response_received', conversationId: event.conversationId });
  }, [broadcastMessage]);

  const onJobFailed = useCallback((event: AiJobFailedEvent) => {
    pendingJobIdRef.current = null;
    setMessages(prev => [...prev, {
      id: randomId(), role: 'assistant',
      content: `Error: ${event.error}`,
      timestamp: new Date(),
    }]);
    setLoading(false);
  }, []);

  const { streamState, startStream, endStream } = useAiStream(token, onJobComplete, onJobFailed);


  useEffect(() => {
    if (!isListening && showVoiceModal) {
      const t = setTimeout(() => { setShowVoiceModal(false); setVoiceDraft(''); }, 400);
      return () => clearTimeout(t);
    }
  }, [isListening, showVoiceModal]);

  const openVoiceModal = () => { setVoiceDraft(''); setShowVoiceModal(true); startListening(); };
  const closeVoiceModal = () => { stopListening(); setShowVoiceModal(false); setVoiceDraft(''); };

  useEffect(() => {
    if (!showVoiceModal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeVoiceModal(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showVoiceModal]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    if (!voiceAutoPlay || !ttsSupported) return;
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant') { setSpeakingMsgId(last.id); speak(last.content); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  const loadConversations = useCallback(async () => {
    setSidebarLoading(true);
    try {
      const res = await listConversations(token);
      setConversations(res.conversations);
    } catch { /* silently ignore */ } finally { setSidebarLoading(false); }
  }, [token]);

  useEffect(() => { void loadConversations(); }, [loadConversations]);

  // Feature 3 & 4: restore last active conversation on mount
  useEffect(() => {
    if (persistedConvId && !activeConvId) {
      void openConversation(persistedConvId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistedConvId]);

  // Feature 10: restore draft on mount
  useEffect(() => {
    if (persistedDraft && !input) {
      setInput(persistedDraft);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Feature 7: track page visibility for "completed while away" banner
  useEffect(() => {
    const onVisible = () => { isPageVisibleRef.current = document.visibilityState === 'visible'; };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const openConversation = async (id: string) => {
    if (id === activeConvId) return;
    setShowConvList(false);
    setLoading(true);
    try {
      const res = await getConversation(id, token);
      setActiveConvId(id);
      persistConvId(id);                          // Feature 4: persist
      setMessages(toUiMessages(res.messages));
      setCompletedWhileAway(false);
    } catch { /* silently ignore */ } finally { setLoading(false); }
  };

  const startNewChat = () => {
    setActiveConvId(null);
    persistConvId(null);                          // Feature 4: clear persisted
    setMessages([]);
    setInput('');
    clearDraft();                                 // Feature 10: clear draft
    setShowConvList(false);
    setCompletedWhileAway(false);
    setEditingMessageId(null);
    setEditContent('');
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeletingId(id);
    try {
      await deleteConversation(id, token);
      if (activeConvId === id) startNewChat();
      setConversations(prev => prev.filter(c => c.id !== id));
    } catch { /* silently ignore */ } finally { setDeletingId(null); }
  };

  const relativeTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const autoResizeTextarea = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;

    const trimmed = text.trim();
    const userMsg: ChatMessage = { id: randomId(), role: 'user', content: trimmed, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    clearDraft();                                 // Feature 10: clear saved draft
    setPendingQuery(trimmed);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setLoading(true);
    startStream(activeConvId);

    // ── Try background-queue first; fall back to synchronous ─────────────────
    try {
      const queued = await queueAiChat(trimmed, token, activeConvId ?? undefined);

      // Job queued — the response arrives asynchronously via Socket.io
      pendingJobIdRef.current = queued.jobId;

      if (!activeConvId) {
        setActiveConvId(queued.conversationId);
        persistConvId(queued.conversationId);     // Feature 4: persist
        void loadConversations();
      } else {
        setConversations(prev =>
          prev.map(c => c.id === queued.conversationId
            ? { ...c, updated_at: new Date().toISOString() }
            : c)
            .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
        );
      }

      // Loading stays true — cleared by onJobComplete / onJobFailed
    } catch (queueErr) {
      // Feature 1 fallback: if the queue endpoint is unavailable, use sync HTTP
      pendingJobIdRef.current = null;
      try {
        const abortCtrl = new AbortController();
        syncAbortRef.current = abortCtrl;

        const res: AiChatResponse = await aiChat(trimmed, token, activeConvId ?? undefined);

        if (!activeConvId) {
          setActiveConvId(res.conversationId);
          persistConvId(res.conversationId);
          void loadConversations();
        } else {
          setConversations(prev =>
            prev.map(c => c.id === res.conversationId
              ? { ...c, updated_at: new Date().toISOString() }
              : c)
              .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
          );
        }

        const assistantMsg: ChatMessage = {
          id: randomId(), role: 'assistant', content: res.reply,
          toolCalls: res.toolCallsTrace?.length
            ? res.toolCallsTrace
            : (res.toolsUsed?.map(name => ({ name, args: {} })) ?? undefined),
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, assistantMsg]);
      } catch (syncErr) {
        if ((syncErr as Error)?.name !== 'AbortError') {
          setMessages(prev => [...prev, {
            id: randomId(), role: 'assistant',
            content: `Error: ${syncErr instanceof Error ? syncErr.message : String(queueErr)}`,
            timestamp: new Date(),
          }]);
        }
      } finally {
        syncAbortRef.current = null;
        setLoading(false);
        endStream();
        setPendingQuery('');
      }
    }
  };

  // Feature 5: stop generation
  const stopGeneration = async () => {
    if (pendingJobIdRef.current) {
      try { await cancelAiJob(pendingJobIdRef.current, token); } catch { /* ignore */ }
      pendingJobIdRef.current = null;
    }
    syncAbortRef.current?.abort();
    syncAbortRef.current = null;

    setMessages(prev => [...prev, {
      id: randomId(), role: 'assistant',
      content: 'Generation stopped.',
      timestamp: new Date(),
    }]);
    setLoading(false);
    endStream();
    setPendingQuery('');
  };

  // Feature 6: start editing a message
  const startEditMessage = (msg: ChatMessage) => {
    setEditingMessageId(msg.id);
    setEditContent(msg.content);
  };

  const cancelEditMessage = () => {
    setEditingMessageId(null);
    setEditContent('');
  };

  // Feature 6: submit edited message
  const submitEditMessage = async () => {
    if (!editingMessageId || !editContent.trim() || loading) return;
    const trimmed = editContent.trim();

    // Optimistically remove messages after the edited one
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === editingMessageId);
      if (idx === -1) return prev;
      const updated = [...prev];
      updated[idx] = { ...updated[idx], content: trimmed };
      return updated.slice(0, idx + 1);
    });

    setEditingMessageId(null);
    setEditContent('');
    setPendingQuery(trimmed);
    setLoading(true);
    startStream(activeConvId);

    try {
      const result = await editMessageApi(editingMessageId ?? '', trimmed, token);
      pendingJobIdRef.current = result.jobId;
      // Response arrives via ai:job_complete Socket.io event
    } catch {
      // Fallback: just resend as new message
      setLoading(false);
      void sendMessage(trimmed);
    }
  };

  const handleSpeakMessage = (msg: ChatMessage) => {
    if (speakingMsgId === msg.id && isSpeaking) { cancelSpeech(); setSpeakingMsgId(null); }
    else { setSpeakingMsgId(msg.id); speak(msg.content); }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(input); }
  };

  return (
    <div className="flex h-full overflow-hidden relative">

      {/* ── Mobile conversations overlay ── */}
      {showConvList && (
        <div className="fixed inset-0 bg-black/60 z-20 md:hidden backdrop-blur-sm" onClick={() => setShowConvList(false)} />
      )}
      <aside className={`
        fixed md:hidden inset-y-0 left-0 z-30
        w-64 flex flex-col bg-white border-r border-[#EBEBEB]
        transition-transform duration-300 ease-in-out
        ${showConvList ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="px-4 pt-5 pb-4 border-b border-[#EBEBEB]">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-xl bg-brand flex items-center justify-center shadow-md shadow-brand/25 flex-shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-[#1a1a1a] leading-none">FinBridge AI</p>
              <p className="text-[10px] text-gray-400 mt-0.5">Conversation History</p>
            </div>
          </div>
          <button onClick={startNewChat}
            className="w-full flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-brand text-white text-sm font-semibold hover:bg-brand/90 transition-all shadow-sm">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-3 px-2">
          {sidebarLoading && conversations.length === 0 && (
            <div className="flex justify-center mt-10">
              <div className="w-5 h-5 border-2 border-gray-200 border-t-brand/50 rounded-full animate-spin" />
            </div>
          )}
          {!sidebarLoading && conversations.length === 0 && (
            <p className="text-xs text-gray-300 text-center mt-8 px-4 leading-relaxed">No conversations yet.</p>
          )}
          {conversations.map(conv => (
            <div key={conv.id} onClick={() => void openConversation(conv.id)}
              className={`group mb-0.5 px-3 py-2.5 rounded-xl cursor-pointer flex items-start gap-2.5 transition-all
                ${activeConvId === conv.id ? 'bg-brand-50 border border-brand/15' : 'hover:bg-[#F5F5F5] border border-transparent'}`}>
              <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-medium truncate leading-tight ${activeConvId === conv.id ? 'text-brand' : 'text-[#404040]'}`}>{conv.title}</p>
                <p className="text-[10px] text-gray-300 mt-0.5">{relativeTime(conv.updated_at)}</p>
              </div>
              <button onClick={e => void handleDelete(e, conv.id)} disabled={deletingId === conv.id}
                className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-gray-300 hover:text-red-400 hover:bg-red-50 transition-all flex-shrink-0">
                {deletingId === conv.id
                  ? <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>
                  : <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                }
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* ── Main layout ── */}
      <div className="flex flex-1 h-full overflow-hidden">

        {/* ── Desktop conversations sidebar (always visible ≥ md) ── */}
        <aside className="hidden md:flex w-64 flex-shrink-0 flex-col bg-white border-r border-[#EBEBEB] overflow-hidden">
          <div className="px-4 pt-5 pb-4 border-b border-[#EBEBEB]">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-xl bg-brand flex items-center justify-center shadow-md shadow-brand/25 flex-shrink-0">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-[#1a1a1a] leading-none">FinBridge AI</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Conversation History</p>
              </div>
            </div>
            <button
              onClick={startNewChat}
              className="w-full flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-brand text-white text-sm font-semibold hover:bg-brand/90 transition-all shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Chat
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-3 px-2">
            {sidebarLoading && conversations.length === 0 && (
              <div className="flex justify-center mt-10">
                <div className="w-5 h-5 border-2 border-gray-200 border-t-brand/50 rounded-full animate-spin" />
              </div>
            )}
            {!sidebarLoading && conversations.length === 0 && (
              <p className="text-xs text-gray-300 text-center mt-8 px-4 leading-relaxed">
                No conversations yet.<br />Start a new chat above.
              </p>
            )}
            {conversations.map(conv => (
              <div
                key={conv.id}
                onClick={() => void openConversation(conv.id)}
                className={`group mb-0.5 px-3 py-2.5 rounded-xl cursor-pointer flex items-start gap-2.5 transition-all
                  ${activeConvId === conv.id ? 'bg-brand-50 border border-brand/15' : 'hover:bg-[#F5F5F5] border border-transparent'}`}
              >
                <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-medium truncate leading-tight ${activeConvId === conv.id ? 'text-brand' : 'text-[#404040]'}`}>
                    {conv.title}
                  </p>
                  <p className="text-[10px] text-gray-300 mt-0.5">{relativeTime(conv.updated_at)}</p>
                </div>
                <button
                  onClick={e => void handleDelete(e, conv.id)}
                  disabled={deletingId === conv.id}
                  title="Delete"
                  className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-gray-300 hover:text-red-400 hover:bg-red-50 transition-all flex-shrink-0"
                >
                  {deletingId === conv.id
                    ? <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>
                    : <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  }
                </button>
              </div>
            ))}
          </div>
        </aside>

        {/* ── Chat Area ── */}
        <div className="flex flex-col flex-1 min-w-0 bg-[#FAFAFA]">

          {/* ── Header ── */}
          <div className="px-4 md:px-6 py-3 border-b border-[#EBEBEB] flex items-center justify-between flex-shrink-0 bg-white shadow-sm shadow-black/[0.03]">
            <div className="flex items-center gap-3 min-w-0">
              {/* Mobile menu */}
              <button onClick={() => setShowConvList(true)}
                className="md:hidden p-1.5 rounded-lg text-gray-400 hover:text-brand hover:bg-brand-50 transition-colors flex-shrink-0">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>

              {/* Waveform icon */}
              <div className="flex-shrink-0 hidden md:block">
                <svg className="w-5 h-5 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-[#1a1a2e]">AI Chat</span>
                  <span className="text-gray-300 hidden sm:block">•</span>
                  <span className="text-sm font-medium text-emerald-500 hidden sm:block">Live Operations Mode</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse hidden sm:block" />
                </div>
                <p className="text-[11px] text-gray-400 hidden sm:block">Real-time analysis from live financial systems</p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Voice auto-play toggle */}
              {ttsSupported && (
                <button
                  onClick={() => { setVoiceAutoPlay(v => !v); if (isSpeaking) cancelSpeech(); }}
                  title={voiceAutoPlay ? 'Voice auto-play on' : 'Enable voice auto-play'}
                  className={`hidden sm:flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all
                    ${voiceAutoPlay ? 'text-brand bg-brand-50 border-brand/20 font-medium' : 'text-gray-400 hover:text-brand hover:bg-brand-50 border-transparent hover:border-brand/20'}`}>
                  <svg className="w-3.5 h-3.5" fill={voiceAutoPlay ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke={voiceAutoPlay ? 'none' : 'currentColor'}>
                    {voiceAutoPlay
                      ? <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                      : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-9.536a5 5 0 000 7.072" />}
                  </svg>
                </button>
              )}

              {/* Live System badge */}
              <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#E0E0E0] rounded-full shadow-sm">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[11px] font-semibold text-[#1a1a2e]">Live System</span>
              </div>

              {/* Settings icon */}
              <button className="p-2 text-gray-400 hover:text-brand hover:bg-gray-50 rounded-xl transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                    d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
              </button>
            </div>
          </div>

          {/* ── Messages ── */}
          <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-6">

            {/* Feature 7: "Completed while you were away" banner */}
            {completedWhileAway && (
              <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-100 text-xs text-emerald-700 font-medium">
                <svg className="w-4 h-4 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Response completed while you were away.
                <button
                  type="button"
                  onClick={() => setCompletedWhileAway(false)}
                  className="ml-auto text-emerald-400 hover:text-emerald-600 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}

            {/* Welcome / empty state */}
            {messages.length === 0 && !loading && (
              <div className="max-w-2xl mx-auto pt-6">
                <div className="text-center mb-10">
                  <div className="inline-flex w-16 h-16 rounded-2xl bg-brand items-center justify-center mb-5 shadow-2xl shadow-brand/30">
                    <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-bold text-[#1a1a1a] tracking-tight">Ask about your financial data</h2>
                  <p className="text-gray-400 text-sm mt-2.5 max-w-sm mx-auto leading-relaxed">
                    Get instant insights on transactions, payouts, settlements, and bank health.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {SUGGESTIONS.map(s => (
                    <button key={s.text} onClick={() => void sendMessage(s.text)}
                      className="group text-left px-4 py-4 rounded-2xl border border-[#E8E8E8] bg-white hover:border-brand/30 hover:shadow-lg hover:shadow-brand/8 transition-all duration-200">
                      <div className="flex items-start gap-3">
                        <span className="text-xl leading-none mt-0.5 flex-shrink-0">{s.icon}</span>
                        <div className="min-w-0">
                          <span className="text-[10px] font-bold text-brand uppercase tracking-widest">{s.tag}</span>
                          <p className="text-sm text-[#404040] mt-1 group-hover:text-brand transition-colors leading-snug">{s.text}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Message list */}
            {messages.map(msg => (
              <div key={msg.id} className={`msg-animate flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                {msg.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-xl bg-brand flex items-center justify-center flex-shrink-0 shadow-md shadow-brand/25 mt-5">
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                )}
                <div className={`flex flex-col gap-1.5 max-w-2xl ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className="flex items-center gap-2 px-1">
                    <span className="text-[11px] font-semibold text-gray-400">
                      {msg.role === 'user' ? 'You' : 'FinBridge AI'}
                    </span>
                    <span className="text-[10px] text-gray-300">
                      {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  {msg.role === 'user' ? (
                    editingMessageId === msg.id ? (
                      /* Feature 6: inline edit form */
                      <div className="w-full max-w-2xl">
                        <textarea
                          value={editContent}
                          onChange={e => setEditContent(e.target.value)}
                          rows={3}
                          className="w-full px-4 py-3 text-sm text-[#404040] border border-brand/40 rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand/20 resize-none bg-white shadow-inner"
                          autoFocus
                          onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submitEditMessage(); }
                            if (e.key === 'Escape') cancelEditMessage();
                          }}
                        />
                        <div className="flex items-center gap-2 mt-2 justify-end">
                          <button type="button" onClick={cancelEditMessage}
                            className="text-xs text-gray-400 hover:text-gray-600 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-all">
                            Cancel
                          </button>
                          <button type="button" onClick={() => void submitEditMessage()} disabled={!editContent.trim() || loading}
                            className="text-xs text-white bg-brand hover:bg-brand/90 px-3 py-1.5 rounded-lg disabled:bg-gray-200 transition-all">
                            Send
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="group/msg relative">
                        <div className="bg-brand text-white rounded-2xl rounded-tr-sm px-5 py-3.5 text-sm leading-relaxed shadow-lg shadow-brand/25 whitespace-pre-wrap">
                          {msg.content}
                        </div>
                        {/* Feature 6: edit button — show on hover, only on last user message when not loading */}
                        {!loading && messages[messages.length - 1]?.id === msg.id && (
                          <button
                            type="button"
                            onClick={() => startEditMessage(msg)}
                            title="Edit message"
                            className="absolute -bottom-6 right-0 opacity-0 group-hover/msg:opacity-100 flex items-center gap-1 text-[10px] text-gray-400 hover:text-brand transition-all px-2 py-0.5 rounded-lg hover:bg-brand-50"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                            Edit
                          </button>
                        )}
                      </div>
                    )
                  ) : (
                    <div className="bg-white border border-[#EBEBEB] rounded-2xl rounded-tl-sm px-5 py-4 shadow-sm min-w-0 w-full">
                      <MessageContent content={msg.content} />
                    </div>
                  )}

                  {msg.role === 'assistant' && ttsSupported && (
                    <button onClick={() => handleSpeakMessage(msg)}
                      title={speakingMsgId === msg.id && isSpeaking ? 'Stop speaking' : 'Read aloud'}
                      className={`self-start flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] transition-all border
                        ${speakingMsgId === msg.id && isSpeaking
                          ? 'text-brand bg-brand-50 border-brand/15 font-medium'
                          : 'text-gray-300 hover:text-gray-500 hover:bg-gray-50 border-transparent hover:border-gray-100'}`}>
                      {speakingMsgId === msg.id && isSpeaking
                        ? <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h4v12H6V6zm8 0h4v12h-4V6z"/></svg>
                        : <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>
                      }
                      <span>{speakingMsgId === msg.id && isSpeaking ? 'Stop' : 'Speak'}</span>
                    </button>
                  )}

                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <>
                      <DataSourcesBadge toolCalls={msg.toolCalls} />
                      <QueryInspector toolCalls={msg.toolCalls} />
                    </>
                  )}
                </div>
              </div>
            ))}

            {/* Processing state */}
            {loading && (
              <div className="flex gap-3 msg-animate">
                <div className="w-8 h-8 rounded-xl bg-brand flex items-center justify-center flex-shrink-0 shadow-md shadow-brand/25 mt-5">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div className="flex flex-col gap-1.5 max-w-2xl w-full">
                  <div className="flex items-center gap-2 px-1">
                    <span className="text-[11px] font-semibold text-gray-400">FinBridge AI</span>
                    <span className="text-[10px] text-gray-300">
                      {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="bg-white border border-[#EBEBEB] rounded-2xl rounded-tl-sm px-5 py-4 shadow-sm">
                    <ProcessingCard query={pendingQuery} />
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* ── Input Area ── */}
          <div className="px-4 md:px-6 py-4 border-t border-[#EBEBEB] flex-shrink-0 bg-white">
            {/* Voice error */}
            {voiceError && (
              <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600">
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span className="flex-1">{voiceError}</span>
                <button type="button" onClick={clearVoiceError} className="p-0.5 hover:text-red-800 transition-colors flex-shrink-0">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}

            <form onSubmit={e => { e.preventDefault(); void sendMessage(input); }}>
              <div className={`rounded-2xl border bg-white overflow-hidden transition-all duration-200
                ${isListening ? 'border-red-400/60 shadow-lg shadow-red-500/[0.08]' : 'border-[#E0E0E0] focus-within:border-brand/40 focus-within:shadow-lg focus-within:shadow-brand/[0.06]'}`}>

                {/* Textarea */}
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={e => {
                    setInput(e.target.value);
                    autoResizeTextarea(e.target);
                    saveDraft(e.target.value);   // Feature 10: autosave draft
                  }}
                  onKeyDown={handleKeyDown}
                  disabled={loading || !!editingMessageId}
                  rows={2}
                  placeholder={loading ? 'Processing...' : 'Ask about transactions, analytics, bank health, settlements...'}
                  className="w-full px-4 pt-4 pb-2 text-sm text-[#404040] placeholder-gray-300 bg-transparent focus:outline-none disabled:opacity-40 resize-none leading-relaxed"
                  style={{ minHeight: '56px', maxHeight: '160px' }}
                />

                {/* Action bar */}
                <div className="flex items-center gap-1 px-3 py-2.5 border-t border-[#F5F5F5]">
                  {/* Attach File */}
                  <button type="button"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs text-gray-400 hover:text-brand hover:bg-gray-50 transition-all">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                    <span className="hidden sm:inline">Attach File</span>
                  </button>

                  {/* Voice Input */}
                  {sttSupported && (
                    <button type="button" onClick={openVoiceModal} disabled={loading}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs transition-all
                        ${isListening ? 'text-red-500 bg-red-50' : 'text-gray-400 hover:text-brand hover:bg-gray-50 disabled:opacity-40'}`}>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      </svg>
                      <span className="hidden sm:inline">Voice Input</span>
                    </button>
                  )}

                  {/* Tools */}
                  <button type="button"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs text-gray-400 hover:text-brand hover:bg-gray-50 transition-all">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span className="hidden sm:inline">Tools</span>
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  <div className="flex-1" />

                  {/* Feature 5: Stop Generation button (shown during processing) */}
                  {loading ? (
                    <button
                      type="button"
                      onClick={() => void stopGeneration()}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-red-500 bg-red-50 border border-red-100 hover:bg-red-100 transition-all"
                    >
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M6 6h12v12H6z" />
                      </svg>
                      Stop
                    </button>
                  ) : (
                    /* Send button (round) */
                    <button type="submit" disabled={!input.trim()}
                      className="w-9 h-9 bg-brand rounded-full flex items-center justify-center text-white shadow-md shadow-brand/30
                                 hover:bg-brand/90 disabled:bg-gray-200 disabled:shadow-none transition-all active:scale-95">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>

        </div>
      </div>

      {/* ── Voice Recording Modal ── */}
      {showVoiceModal && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#FAFAFA]">
          <div className="px-4 md:px-6 py-3 border-b border-[#EBEBEB] flex items-center justify-between flex-shrink-0 bg-white shadow-sm shadow-black/[0.03]">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-brand flex items-center justify-center shadow-md shadow-brand/25">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-[#1a1a1a] leading-none">FinBridge AI</p>
                <p className="text-[11px] text-gray-400 mt-0.5">Voice Input</p>
              </div>
            </div>
            <button onClick={closeVoiceModal}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-brand px-3 py-1.5 rounded-lg hover:bg-brand-50 border border-transparent hover:border-brand/20 transition-all">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Cancel
            </button>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center px-8 gap-10">
            <div className="relative flex items-center justify-center w-56 h-56 select-none">
              <span className="absolute inset-0 rounded-full bg-red-500/[0.06] animate-ping" style={{ animationDuration: '2.8s' }} />
              <span className="absolute inset-6 rounded-full bg-red-500/[0.09] animate-ping" style={{ animationDuration: '2.2s', animationDelay: '0.3s' }} />
              <span className="absolute inset-12 rounded-full bg-red-500/[0.13] animate-ping" style={{ animationDuration: '1.6s', animationDelay: '0.6s' }} />
              <span className="absolute inset-16 rounded-full bg-red-400/20 blur-2xl" />
              <span className="relative w-24 h-24 rounded-full bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center shadow-2xl shadow-red-400/40">
                {isListening ? (
                  <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                ) : (
                  <svg className="w-9 h-9 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                )}
              </span>
            </div>

            <div className="text-center">
              <h2 className="text-3xl font-bold text-[#1a1a1a] tracking-tight">
                {isListening ? 'Listening…' : 'Processing…'}
              </h2>
              <p className="text-gray-400 text-sm mt-3 leading-relaxed max-w-xs mx-auto">
                {isListening
                  ? voiceDraft ? 'Keep speaking, or stay silent for 5 s to send' : "Speak clearly — we'll wait until you're done"
                  : 'Preparing your message…'}
              </p>
            </div>

            <div className="w-full max-w-lg min-h-[80px] flex items-center justify-center">
              {voiceDraft ? (
                <div className="w-full bg-white border border-[#EBEBEB] rounded-2xl rounded-tl-sm px-6 py-5 shadow-sm">
                  <p className="text-[#404040] text-base leading-relaxed text-center italic">"{voiceDraft}"</p>
                </div>
              ) : (
                <div className="flex items-end gap-1.5 h-8">
                  {[0, 160, 320].map(delay => (
                    <span key={delay} className="w-2 h-2 rounded-full bg-brand animate-bounce" style={{ animationDelay: `${delay}ms` }} />
                  ))}
                </div>
              )}
            </div>
          </div>

          <p className="text-center text-[11px] text-gray-300 pb-8 flex-shrink-0">
            Press{' '}
            <kbd className="px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-400 font-mono text-[10px] border border-gray-200">Esc</kbd>
            {' '}to cancel
          </p>
        </div>
      )}
    </div>
  );
}
