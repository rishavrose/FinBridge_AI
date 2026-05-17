import { useState, useRef, useEffect, useCallback } from 'react';
import { aiChat, listConversations, getConversation, deleteConversation } from '../../api/client';
import type { ChatMessage, AiChatResponse, Conversation, ConversationMessage } from '../../types';
import { useVoice } from '../../hooks/useVoice';

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

// Detect and parse "Label: Number (unit)" style financial responses
function tryParseMetrics(content: string): Array<{ label: string; value: string; unit: string; color: string }> | null {
  const lines = content.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return null;

  const metricLine = /^(.+?):\s*([\d,.-]+)\s*(?:\(([^)]+)\))?$/;
  const results: Array<{ label: string; value: string; unit: string; color: string }> = [];

  for (const line of lines) {
    const m = line.match(metricLine);
    if (!m) return null;
    const [, rawLabel, value, unit = ''] = m;
    // Strip date context like "(2026-04-10)" from the label
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
  // query_sprint_merchant_api_tbl_payouts → "Payouts"
  // query_tbl_transactions → "Transactions"
  return name
    .replace(/^query_/, '')
    .replace(/^[a-z0-9]+_api_/, '')          // strip connection prefix
    .replace(/^[a-z0-9]+_merchant_[a-z0-9]+_api_/, '')
    .replace(/tbl_/, '')
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function DataSourcesBadge({ toolCalls }: { toolCalls: Array<{ name: string; args: Record<string, unknown> }> }) {
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

// ─── Record-list parser ───────────────────────────────────────────────────────

interface RecordRow { id: string; fields: Record<string, string> }
interface ParsedRecords {
  entity: string;
  summary: Array<{ label: string; value: string; unit: string; color: string }>;
  rows: RecordRow[];
}

function tryParseRecords(content: string): ParsedRecords | null {
  const lines = content.trim().split('\n').filter(l => l.trim());
  // Need at least one record line: "<Word> ID <n>: key: val | key: val"
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
        const k = pair.slice(0, idx).trim();
        const v = pair.slice(idx + 1).trim();
        if (k) fields[k] = v;
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

  // Decide which fields to show as columns (skip id-like keys already shown)
  const allKeys = data.rows.length > 0
    ? Object.keys(data.rows[0].fields)
    : [];

  return (
    <div className="flex flex-col gap-3 w-full">
      {/* Summary chips */}
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

      {/* Records table */}
      <div className="rounded-2xl border border-[#EBEBEB] overflow-hidden shadow-sm">
        {/* Header */}
        <div className="grid bg-gray-50 border-b border-[#EBEBEB] px-4 py-2.5"
          style={{ gridTemplateColumns: `40px repeat(${allKeys.length}, 1fr)` }}>
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">#</span>
          {allKeys.map(k => (
            <span key={k} className="text-[10px] font-bold text-gray-400 uppercase tracking-wide truncate pr-2">{k}</span>
          ))}
        </div>

        {/* Rows */}
        {data.rows.map((row, i) => (
          <div
            key={row.id}
            className={`grid px-4 py-3 items-center gap-x-2 ${i !== data.rows.length - 1 ? 'border-b border-[#F0F0F0]' : ''} hover:bg-gray-50/60 transition-colors`}
            style={{ gridTemplateColumns: `40px repeat(${allKeys.length}, 1fr)` }}
          >
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

// ─── Dynamic loading hook ─────────────────────────────────────────────────────

const LOADING_STEPS = [
  { icon: '🔌', text: 'Connecting to database...' },
  { icon: '🔍', text: 'Running your query...' },
  { icon: '📦', text: 'Fetching records...' },
  { icon: '⚙️',  text: 'Processing data...' },
  { icon: '🧮', text: 'Crunching numbers...' },
  { icon: '✨', text: 'Preparing response...' },
];

function useLoadingPhrase(active: boolean) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!active) { setIdx(0); return; }
    const t = setInterval(() => setIdx(i => Math.min(i + 1, LOADING_STEPS.length - 1)), 1800);
    return () => clearInterval(t);
  }, [active]);
  return LOADING_STEPS[idx];
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

export function ChatPage({ token }: ChatPageProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const loadingStep = useLoadingPhrase(loading);
  const [sidebarLoading, setSidebarLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showConvList, setShowConvList] = useState(false);
  const [voiceAutoPlay, setVoiceAutoPlay] = useState(false);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    isListening,
    sttSupported,
    startListening,
    stopListening,
    isSpeaking,
    ttsSupported,
    speak,
    cancelSpeech,
    error: voiceError,
    clearError: clearVoiceError,
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

  // Auto-close modal if recognition ends without a transcript (no-speech timeout)
  useEffect(() => {
    if (!isListening && showVoiceModal) {
      const t = setTimeout(() => {
        setShowVoiceModal(false);
        setVoiceDraft('');
      }, 400);
      return () => clearTimeout(t);
    }
  }, [isListening, showVoiceModal]);

  const openVoiceModal = () => {
    setVoiceDraft('');
    setShowVoiceModal(true);
    startListening();
  };

  const closeVoiceModal = () => {
    stopListening();
    setShowVoiceModal(false);
    setVoiceDraft('');
  };

  // Escape key closes the voice modal
  useEffect(() => {
    if (!showVoiceModal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeVoiceModal(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  // closeVoiceModal is stable within a render; showVoiceModal is the real dep
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showVoiceModal]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-play TTS for the latest assistant message when voice auto-play is enabled
  useEffect(() => {
    if (!voiceAutoPlay || !ttsSupported) return;
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant') {
      setSpeakingMsgId(last.id);
      speak(last.content);
    }
  // Only fire when messages array changes length
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  const loadConversations = useCallback(async () => {
    setSidebarLoading(true);
    try {
      const res = await listConversations(token);
      setConversations(res.conversations);
    } catch { /* silently ignore */ } finally {
      setSidebarLoading(false);
    }
  }, [token]);

  useEffect(() => { void loadConversations(); }, [loadConversations]);

  const openConversation = async (id: string) => {
    if (id === activeConvId) return;
    setShowConvList(false);
    setLoading(true);
    try {
      const res = await getConversation(id, token);
      setActiveConvId(id);
      setMessages(toUiMessages(res.messages));
    } catch { /* silently ignore */ } finally {
      setLoading(false);
    }
  };

  const startNewChat = () => {
    setActiveConvId(null);
    setMessages([]);
    setInput('');
    setShowConvList(false);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeletingId(id);
    try {
      await deleteConversation(id, token);
      if (activeConvId === id) startNewChat();
      setConversations(prev => prev.filter(c => c.id !== id));
    } catch { /* silently ignore */ } finally {
      setDeletingId(null);
    }
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

    const userMsg: ChatMessage = {
      id: randomId(),
      role: 'user',
      content: text.trim(),
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    setLoading(true);

    try {
      const res: AiChatResponse = await aiChat(text.trim(), token, activeConvId ?? undefined);

      if (!activeConvId) {
        setActiveConvId(res.conversationId);
        void loadConversations();
      } else {
        setConversations(prev =>
          prev.map(c => c.id === res.conversationId
            ? { ...c, updated_at: new Date().toISOString() }
            : c,
          ).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
        );
      }

      const assistantMsg: ChatMessage = {
        id: randomId(),
        role: 'assistant',
        content: res.reply,
        toolCalls: res.toolCallsTrace?.length
          ? res.toolCallsTrace
          : (res.toolsUsed?.map(name => ({ name, args: {} })) ?? undefined),
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      const errMsg: ChatMessage = {
        id: randomId(),
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Request failed'}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleSpeakMessage = (msg: ChatMessage) => {
    if (speakingMsgId === msg.id && isSpeaking) {
      cancelSpeech();
      setSpeakingMsgId(null);
    } else {
      setSpeakingMsgId(msg.id);
      speak(msg.content);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  };

  return (
    <div className="flex h-full overflow-hidden relative">

      {/* Mobile overlay */}
      {showConvList && (
        <div
          className="fixed inset-0 bg-black/60 z-20 md:hidden backdrop-blur-sm"
          onClick={() => setShowConvList(false)}
        />
      )}

      {/* ── Sidebar ── */}
      <aside className={`
        fixed md:static inset-y-0 left-0 z-30
        w-64 flex-shrink-0 flex flex-col
        bg-white border-r border-[#EBEBEB]
        transition-transform duration-300 ease-in-out
        ${showConvList ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        {/* Sidebar brand header */}
        <div className="px-4 pt-5 pb-4 border-b border-[#EBEBEB]">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand to-brand-700 flex items-center justify-center shadow-md shadow-brand/25 flex-shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-[#1a1a1a] leading-none">FinBridge AI</p>
              <p className="text-[10px] text-gray-400 mt-0.5">Financial Intelligence</p>
            </div>
          </div>

          <button
            onClick={startNewChat}
            className="w-full flex items-center gap-2 px-3.5 py-2.5 rounded-xl
                       bg-[#F5F5F5] hover:bg-brand-50 border border-[#E8E8E8] hover:border-brand/20
                       text-sm font-medium text-gray-500 hover:text-brand transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Chat
          </button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto py-3 px-2">
          {conversations.length > 0 && (
            <p className="text-[10px] font-semibold text-gray-300 uppercase tracking-widest px-3 mb-2">
              Recent
            </p>
          )}
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
                ${activeConvId === conv.id
                  ? 'bg-brand-50 border border-brand/15'
                  : 'hover:bg-[#F5F5F5] border border-transparent'}`}
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
                className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-gray-300 hover:text-red-400 hover:bg-red-50 transition-all flex-shrink-0"
                title="Delete"
              >
                {deletingId === conv.id
                  ? <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>
                  : <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                }
              </button>
            </div>
          ))}
        </div>

        {/* Sidebar footer status */}
        <div className="px-4 py-3 border-t border-[#EBEBEB]">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
            <span className="text-[11px] text-gray-300">MCP tools connected</span>
          </div>
        </div>
      </aside>

      {/* ── Main Chat Area ── */}
      <div className="flex flex-col flex-1 min-w-0 bg-[#FAFAFA]">

        {/* Header bar */}
        <div className="px-4 md:px-6 py-3 border-b border-[#EBEBEB] flex items-center gap-3 flex-shrink-0 bg-white shadow-sm shadow-black/[0.03]">
          {/* Mobile menu button */}
          <button
            onClick={() => setShowConvList(true)}
            className="md:hidden p-1.5 rounded-lg text-gray-400 hover:text-brand hover:bg-brand-50 transition-colors flex-shrink-0"
            aria-label="Open conversations"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <div className="flex-1 min-w-0 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="hidden md:flex w-8 h-8 rounded-xl bg-gradient-to-br from-brand to-brand-700 items-center justify-center shadow-md shadow-brand/25 flex-shrink-0">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div className="min-w-0">
                <h1 className="text-sm font-semibold text-[#1a1a1a] truncate">
                  {activeConvId
                    ? (conversations.find(c => c.id === activeConvId)?.title ?? 'Chat')
                    : 'FinBridge AI Chat'}
                </h1>
                <p className="text-[11px] text-gray-400 hidden sm:block mt-0.5">
                  Powered by OpenAI · MCP tools called automatically
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {ttsSupported && (
                <button
                  onClick={() => { setVoiceAutoPlay(v => !v); if (isSpeaking) cancelSpeech(); }}
                  title={voiceAutoPlay ? 'Voice auto-play on — click to disable' : 'Enable voice auto-play'}
                  className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all
                    ${voiceAutoPlay
                      ? 'text-brand bg-brand-50 border-brand/20 font-medium'
                      : 'text-gray-400 hover:text-brand hover:bg-brand-50 border-transparent hover:border-brand/20'}`}
                >
                  {voiceAutoPlay ? (
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-9.536a5 5 0 000 7.072" />
                    </svg>
                  )}
                  <span className="hidden sm:inline">{voiceAutoPlay ? 'Voice on' : 'Voice'}</span>
                </button>
              )}
              {messages.length > 0 && (
                <button
                  onClick={startNewChat}
                  className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-brand px-3 py-1.5 rounded-lg
                             hover:bg-brand-50 border border-transparent hover:border-brand/20 transition-all"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  New Chat
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Messages ── */}
        <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-6">

          {/* Empty / welcome state */}
          {messages.length === 0 && (
            <div className="max-w-2xl mx-auto pt-6">
              <div className="text-center mb-10">
                <div className="inline-flex w-16 h-16 rounded-2xl bg-gradient-to-br from-brand to-brand-700 items-center justify-center mb-5 shadow-2xl shadow-brand/30">
                  <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-[#1a1a1a] tracking-tight">
                  Ask about your financial data
                </h2>
                <p className="text-gray-400 text-sm mt-2.5 max-w-sm mx-auto leading-relaxed">
                  Get instant insights on transactions, payouts, settlements, and bank health.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {SUGGESTIONS.map(s => (
                  <button
                    key={s.text}
                    onClick={() => void sendMessage(s.text)}
                    className="group text-left px-4 py-4 rounded-2xl border border-[#E8E8E8] bg-white
                               hover:border-brand/30 hover:shadow-lg hover:shadow-brand/8 transition-all duration-200"
                  >
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
            <div
              key={msg.id}
              className={`msg-animate flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
            >
              {/* AI avatar */}
              {msg.role === 'assistant' && (
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand to-brand-700 flex items-center justify-center flex-shrink-0 shadow-md shadow-brand/25 mt-5">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
              )}

              <div className={`flex flex-col gap-1.5 max-w-2xl ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                {/* Sender + time */}
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[11px] font-semibold text-gray-400">
                    {msg.role === 'user' ? 'You' : 'FinBridge AI'}
                  </span>
                  <span className="text-[10px] text-gray-300">
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                {/* Message bubble */}
                {msg.role === 'user' ? (
                  <div className="bg-gradient-to-br from-brand to-brand-700 text-white rounded-2xl rounded-tr-sm px-5 py-3.5 text-sm leading-relaxed shadow-lg shadow-brand/25 whitespace-pre-wrap">
                    {msg.content}
                  </div>
                ) : (
                  <div className="bg-white border border-[#EBEBEB] rounded-2xl rounded-tl-sm px-5 py-4 shadow-sm min-w-0 w-full">
                    <MessageContent content={msg.content} />
                  </div>
                )}

                {/* Per-message TTS button */}
                {msg.role === 'assistant' && ttsSupported && (
                  <button
                    onClick={() => handleSpeakMessage(msg)}
                    title={speakingMsgId === msg.id && isSpeaking ? 'Stop speaking' : 'Read aloud'}
                    className={`self-start flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] transition-all border
                      ${speakingMsgId === msg.id && isSpeaking
                        ? 'text-brand bg-brand-50 border-brand/15 font-medium'
                        : 'text-gray-300 hover:text-gray-500 hover:bg-gray-50 border-transparent hover:border-gray-100'}`}
                  >
                    {speakingMsgId === msg.id && isSpeaking ? (
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M6 6h4v12H6V6zm8 0h4v12h-4V6z"/>
                      </svg>
                    ) : (
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                      </svg>
                    )}
                    <span>{speakingMsgId === msg.id && isSpeaking ? 'Stop' : 'Speak'}</span>
                  </button>
                )}

                {/* Data sources badge */}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <DataSourcesBadge toolCalls={msg.toolCalls} />
                )}
              </div>
            </div>
          ))}

          {/* Typing / loading indicator */}
          {loading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand to-brand-700 flex items-center justify-center flex-shrink-0 shadow-md shadow-brand/25 mt-5 animate-pulse">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-gray-400 px-1">FinBridge AI</span>
                <div className="bg-white border border-[#EBEBEB] rounded-2xl rounded-tl-sm px-5 py-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="flex gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-brand animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 rounded-full bg-brand/70 animate-bounce" style={{ animationDelay: '160ms' }} />
                      <div className="w-2 h-2 rounded-full bg-brand/40 animate-bounce" style={{ animationDelay: '320ms' }} />
                    </div>
                    <span className="text-xs text-gray-400 transition-all duration-500">
                      {loadingStep.icon} {loadingStep.text}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* ── Input Area ── */}
        <div className="px-4 md:px-8 py-4 border-t border-[#EBEBEB] flex-shrink-0 bg-white">
          {/* Voice error banner */}
          {voiceError && (
            <div className="max-w-3xl mx-auto mb-3">
              <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600">
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span className="flex-1">{voiceError}</span>
                <button
                  type="button"
                  onClick={clearVoiceError}
                  className="p-0.5 hover:text-red-800 transition-colors flex-shrink-0"
                  title="Dismiss"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          )}
          <form
            onSubmit={e => { e.preventDefault(); void sendMessage(input); }}
            className="max-w-3xl mx-auto"
          >
            <div className={`flex items-end gap-3 bg-white rounded-2xl px-4 py-3
                            transition-all duration-200 shadow-sm border
                            ${isListening
                              ? 'border-red-400/60 shadow-lg shadow-red-500/[0.08]'
                              : 'border-[#E0E0E0] focus-within:border-brand/50 focus-within:shadow-lg focus-within:shadow-brand/[0.08]'}`}>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => { setInput(e.target.value); autoResizeTextarea(e.target); }}
                onKeyDown={handleKeyDown}
                disabled={loading}
                rows={1}
                placeholder="Ask about transactions, bank health, payouts…"
                className="flex-1 bg-transparent text-sm text-[#404040] placeholder-gray-300
                           focus:outline-none disabled:opacity-50 resize-none leading-relaxed"
                style={{ minHeight: '24px', maxHeight: '160px' }}
              />
              {sttSupported && (
                <button
                  type="button"
                  onClick={openVoiceModal}
                  disabled={loading}
                  title={isListening ? 'Stop listening' : 'Voice input'}
                  className={`flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl transition-all
                    ${isListening
                      ? 'bg-red-500 text-white shadow-md shadow-red-500/30'
                      : 'text-gray-400 hover:text-brand hover:bg-brand-50 disabled:opacity-30'}`}
                >
                  {isListening ? (
                    <svg className="w-4 h-4 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                      <rect x="6" y="6" width="12" height="12" rx="2" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                  )}
                </button>
              )}
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl
                           bg-gradient-to-br from-brand to-brand-700
                           hover:from-brand-600 hover:to-brand-800 active:scale-95
                           disabled:from-gray-200 disabled:to-gray-200 disabled:shadow-none
                           text-white shadow-md shadow-brand/30 transition-all"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
            <p className="text-center text-[11px] text-gray-300 mt-2.5">
              <kbd className="px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-400 font-mono text-[10px] border border-gray-200">Enter</kbd>
              {' '}to send ·{' '}
              <kbd className="px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-400 font-mono text-[10px] border border-gray-200">Shift+Enter</kbd>
              {' '}for new line
              {sttSupported && ' · 🎤 for voice'}
            </p>
          </form>
        </div>

      </div>

      {/* ── Voice Recording Modal (full-screen, light theme) ── */}
      {showVoiceModal && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#FAFAFA]">

          {/* Header — matches the chat header */}
          <div className="px-4 md:px-6 py-3 border-b border-[#EBEBEB] flex items-center justify-between flex-shrink-0 bg-white shadow-sm shadow-black/[0.03]">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand to-brand-700 flex items-center justify-center shadow-md shadow-brand/25">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-[#1a1a1a] leading-none">FinBridge AI</p>
                <p className="text-[11px] text-gray-400 mt-0.5">Voice Input</p>
              </div>
            </div>
            <button
              onClick={closeVoiceModal}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-brand px-3 py-1.5 rounded-lg
                         hover:bg-brand-50 border border-transparent hover:border-brand/20 transition-all"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Cancel
            </button>
          </div>

          {/* Main content — centered */}
          <div className="flex-1 flex flex-col items-center justify-center px-8 gap-10">

            {/* Pulsing orb */}
            <div className="relative flex items-center justify-center w-56 h-56 select-none">
              {/* Outermost slow ring */}
              <span
                className="absolute inset-0 rounded-full bg-red-500/[0.06] animate-ping"
                style={{ animationDuration: '2.8s' }}
              />
              {/* Mid ring */}
              <span
                className="absolute inset-6 rounded-full bg-red-500/[0.09] animate-ping"
                style={{ animationDuration: '2.2s', animationDelay: '0.3s' }}
              />
              {/* Inner ring */}
              <span
                className="absolute inset-12 rounded-full bg-red-500/[0.13] animate-ping"
                style={{ animationDuration: '1.6s', animationDelay: '0.6s' }}
              />
              {/* Soft glow */}
              <span className="absolute inset-16 rounded-full bg-red-400/20 blur-2xl" />
              {/* Core circle */}
              <span className="relative w-24 h-24 rounded-full bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center shadow-2xl shadow-red-400/40">
                {isListening ? (
                  <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                      d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                ) : (
                  <svg className="w-9 h-9 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                )}
              </span>
            </div>

            {/* Status text */}
            <div className="text-center">
              <h2 className="text-3xl font-bold text-[#1a1a1a] tracking-tight">
                {isListening ? 'Listening…' : 'Processing…'}
              </h2>
              <p className="text-gray-400 text-sm mt-3 leading-relaxed max-w-xs mx-auto">
                {isListening
                  ? voiceDraft
                    ? 'Keep speaking, or stay silent for 5 s to send'
                    : "Speak clearly — we'll wait until you're done"
                  : 'Preparing your message…'}
              </p>
            </div>

            {/* Live transcript card — matches AI message bubble */}
            <div className="w-full max-w-lg min-h-[80px] flex items-center justify-center">
              {voiceDraft ? (
                <div className="w-full bg-white border border-[#EBEBEB] rounded-2xl rounded-tl-sm px-6 py-5 shadow-sm">
                  <p className="text-[#404040] text-base leading-relaxed text-center italic">
                    "{voiceDraft}"
                  </p>
                </div>
              ) : (
                <div className="flex items-end gap-1.5 h-8">
                  {[0, 160, 320].map(delay => (
                    <span
                      key={delay}
                      className="w-2 h-2 rounded-full bg-brand animate-bounce"
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Bottom hint — matches the input hint bar */}
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
