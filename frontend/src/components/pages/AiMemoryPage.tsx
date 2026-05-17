/**
 * AiMemoryPage — Admin-only AI Memory & Semantic Cache Dashboard
 *
 * Sections:
 *  1. Live Stats Bar     — hit rate, avg latency, redis/qdrant/openai counters
 *  2. Interactive Chat   — send messages via /ai/chat/message with memory metadata shown
 *  3. Knowledge Base Tab — top learned entries sorted by hit count
 *  4. Chat History Tab   — full request audit log with cache source badges
 *  5. Cache Logs Tab     — per-request latency & hit/miss timeline
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  fetchAiCacheStats,
  aiMemoryChat,
  submitAiFeedback,
  fetchAiKnowledge,
  fetchAiChatHistory,
  fetchAiCacheLogs,
} from '../../api/client';
import type {
  AiCacheStats,
  AiMemoryChatResponse,
  AiKnowledgeRow,
  AiChatHistoryRow,
  AiCacheLogRow,
  CacheSource,
} from '../../types';

interface Props {
  token: string;
}

// ─── Small UI primitives ──────────────────────────────────────────────────────

function CacheBadge({ source }: { source: CacheSource | 'none' }) {
  const MAP: Record<string, string> = {
    redis:  'bg-emerald-100 text-emerald-700 border-emerald-200',
    qdrant: 'bg-blue-100 text-blue-700 border-blue-200',
    openai: 'bg-amber-100 text-amber-700 border-amber-200',
    none:   'bg-gray-100 text-gray-500 border-gray-200',
  };
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wide ${MAP[source] ?? MAP.none}`}>
      {source === 'redis'  && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />}
      {source === 'qdrant' && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />}
      {source === 'openai' && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />}
      {source}
    </span>
  );
}

function ConfidenceBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 95 ? 'bg-emerald-500' : pct >= 85 ? 'bg-blue-500' : 'bg-amber-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-gray-400 w-8 text-right">{pct}%</span>
    </div>
  );
}

function StatCard({
  label, value, sub, color = 'text-[#404040]',
}: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-white border border-[#EBEBEB] rounded-xl p-4 shadow-sm">
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── Tab list ─────────────────────────────────────────────────────────────────

type Tab = 'chat' | 'knowledge' | 'history' | 'logs';

// ─── Main page ────────────────────────────────────────────────────────────────

export function AiMemoryPage({ token }: Props) {
  const [tab, setTab] = useState<Tab>('chat');
  const [stats, setStats] = useState<AiCacheStats | null>(null);
  const [statsError, setStatsError] = useState(false);

  // Chat state
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string; meta?: AiMemoryChatResponse }[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [convId, setConvId] = useState<string | undefined>();
  const [feedbackSent, setFeedbackSent] = useState<Record<string, boolean>>({});
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Data tabs state
  const [knowledge, setKnowledge] = useState<AiKnowledgeRow[]>([]);
  const [history, setHistory] = useState<AiChatHistoryRow[]>([]);
  const [cacheLogs, setCacheLogs] = useState<AiCacheLogRow[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  // ── Load stats every 15 seconds ──────────────────────────────────────────
  const loadStats = useCallback(async () => {
    try {
      const s = await fetchAiCacheStats(token);
      setStats(s);
      setStatsError(false);
    } catch {
      setStatsError(true);
    }
  }, [token]);

  useEffect(() => {
    void loadStats();
    const iv = setInterval(() => { void loadStats(); }, 15_000);
    return () => clearInterval(iv);
  }, [loadStats]);

  // ── Scroll chat to bottom ─────────────────────────────────────────────────
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Load data when switching tabs ─────────────────────────────────────────
  useEffect(() => {
    if (tab === 'chat') return;
    setDataLoading(true);
    const loaders: Record<Tab, () => Promise<void>> = {
      chat:      async () => { /* no-op */ },
      knowledge: async () => { setKnowledge(await fetchAiKnowledge(token, 50)); },
      history:   async () => { setHistory(await fetchAiChatHistory(token, 100)); },
      logs:      async () => { setCacheLogs(await fetchAiCacheLogs(token, 200)); },
    };
    loaders[tab]().finally(() => setDataLoading(false));
  }, [tab, token]);

  // ── Send chat message ─────────────────────────────────────────────────────
  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    try {
      const res = await aiMemoryChat(text, token, convId);
      if (!convId) setConvId(res.conversationId);
      setMessages((prev) => [...prev, { role: 'assistant', content: res.reply, meta: res }]);
      void loadStats();
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Error: ${err instanceof Error ? err.message : 'Request failed'}` },
      ]);
    } finally {
      setSending(false);
    }
  };

  // ── Feedback ──────────────────────────────────────────────────────────────
  const sendFeedback = async (messageId: string, positive: boolean) => {
    if (feedbackSent[messageId]) return;
    await submitAiFeedback(messageId, positive ? 5 : 1, positive ? 'positive' : 'negative', undefined, token).catch(() => {});
    setFeedbackSent((prev) => ({ ...prev, [messageId]: true }));
  };

  // ── Hit-rate formatted ────────────────────────────────────────────────────
  const hitRatePct = stats ? Math.round(stats.hitRate * 100) : null;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-[#EBEBEB] bg-white">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-base font-bold text-[#404040]">AI Memory Dashboard</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Redis → Qdrant → OpenAI pipeline · admin only
            </p>
          </div>
          <button
            onClick={() => { void loadStats(); }}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-[#404040] px-3 py-1.5 rounded-lg border border-[#EBEBEB] hover:border-gray-300 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh stats
          </button>
        </div>
      </div>

      {/* ── Stats bar ─────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-[#EBEBEB] bg-gray-50/50">
        {statsError ? (
          <p className="text-xs text-amber-600">Stats unavailable — /ai/chat/stats returned an error</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard
              label="Hit Rate"
              value={hitRatePct !== null ? `${hitRatePct}%` : '—'}
              sub="cache efficiency"
              color={hitRatePct !== null && hitRatePct >= 80 ? 'text-emerald-600' : 'text-amber-600'}
            />
            <StatCard label="Total Requests" value={stats?.totalRequests ?? '—'} sub="all-time" />
            <StatCard
              label="Redis Hits"
              value={stats?.redisHits ?? '—'}
              sub="exact cache"
              color="text-emerald-600"
            />
            <StatCard
              label="Qdrant Hits"
              value={stats?.qdrantHits ?? '—'}
              sub="semantic cache"
              color="text-blue-600"
            />
            <StatCard
              label="OpenAI Calls"
              value={stats?.openaiCalls ?? '—'}
              sub="cache misses"
              color="text-amber-600"
            />
            <StatCard
              label="Avg Latency"
              value={stats ? `${stats.avgResponseMs} ms` : '—'}
              sub="mean response"
              color={stats && stats.avgResponseMs < 100 ? 'text-emerald-600' : 'text-[#404040]'}
            />
          </div>
        )}
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex gap-1 px-6 pt-3 pb-0 border-b border-[#EBEBEB] bg-white">
        {([
          { id: 'chat', label: 'Test Chat' },
          { id: 'knowledge', label: 'Knowledge Base' },
          { id: 'history', label: 'Chat History' },
          { id: 'logs', label: 'Cache Logs' },
        ] as { id: Tab; label: string }[]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors ${
              tab === t.id
                ? 'border-[#5B6AF9] text-[#5B6AF9] bg-[#5B6AF9]/5'
                : 'border-transparent text-gray-400 hover:text-[#404040]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden">

        {/* ──── Chat Tab ──────────────────────────────────────────────────── */}
        {tab === 'chat' && (
          <div className="flex flex-col h-full">
            {/* Message list */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 py-16">
                  <svg className="w-10 h-10 mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  <p className="text-sm font-medium">Test the AI Memory pipeline</p>
                  <p className="text-xs mt-1">Ask a fintech question — repeated questions will be served from cache</p>
                  <div className="flex flex-wrap gap-2 mt-4 justify-center">
                    {[
                      'Why did the payout fail?',
                      'What is the bank health status?',
                      'Show recent failed transactions',
                      'What are settlement delays?',
                    ].map((q) => (
                      <button
                        key={q}
                        onClick={() => { setInput(q); }}
                        className="text-xs px-3 py-1.5 rounded-full border border-[#EBEBEB] hover:border-[#5B6AF9] hover:text-[#5B6AF9] transition-colors"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] ${msg.role === 'user' ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                    {/* Bubble */}
                    <div
                      className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                        msg.role === 'user'
                          ? 'bg-[#5B6AF9] text-white rounded-br-sm'
                          : 'bg-white border border-[#EBEBEB] text-[#404040] rounded-bl-sm shadow-sm'
                      }`}
                    >
                      {msg.content}
                    </div>

                    {/* Meta row for assistant messages */}
                    {msg.role === 'assistant' && msg.meta && (
                      <div className="flex flex-wrap items-center gap-2 px-1">
                        <CacheBadge source={msg.meta.cacheSource} />
                        {msg.meta.confidence !== undefined && (
                          <span className="text-[10px] text-gray-400">
                            {Math.round(msg.meta.confidence * 100)}% match
                          </span>
                        )}
                        <span className="text-[10px] text-gray-400">
                          {msg.meta.responseMs} ms
                        </span>
                        {msg.meta.toolCallsExecuted > 0 && (
                          <span className="text-[10px] text-gray-400">
                            {msg.meta.toolCallsExecuted} tool{msg.meta.toolCallsExecuted > 1 ? 's' : ''}
                          </span>
                        )}
                        {msg.meta.cached && (
                          <span className="text-[10px] text-emerald-600 font-semibold">✓ cached</span>
                        )}
                        {/* Feedback buttons */}
                        {msg.meta.messageId && !feedbackSent[msg.meta.messageId] ? (
                          <div className="flex gap-1 ml-1">
                            <button
                              title="Helpful"
                              onClick={() => { void sendFeedback(msg.meta!.messageId, true); }}
                              className="text-gray-300 hover:text-emerald-500 transition-colors"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                              </svg>
                            </button>
                            <button
                              title="Not helpful"
                              onClick={() => { void sendFeedback(msg.meta!.messageId, false); }}
                              className="text-gray-300 hover:text-red-400 transition-colors"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.095c.5 0 .905-.405.905-.905 0-.714.211-1.412.608-2.006L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5" />
                              </svg>
                            </button>
                          </div>
                        ) : msg.meta.messageId && feedbackSent[msg.meta.messageId] ? (
                          <span className="text-[10px] text-gray-400">feedback sent</span>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {sending && (
                <div className="flex justify-start">
                  <div className="bg-white border border-[#EBEBEB] rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
                    <div className="flex gap-1 items-center">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}

              <div ref={chatBottomRef} />
            </div>

            {/* Input */}
            <div className="flex-shrink-0 px-6 py-4 border-t border-[#EBEBEB] bg-white">
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 px-4 py-2.5 text-sm border border-[#EBEBEB] rounded-xl focus:outline-none focus:border-[#5B6AF9] bg-gray-50 placeholder:text-gray-400"
                  placeholder="Ask a fintech question…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }}
                  disabled={sending}
                />
                <button
                  onClick={() => { void sendMessage(); }}
                  disabled={!input.trim() || sending}
                  className="px-4 py-2.5 bg-[#5B6AF9] text-white text-sm font-medium rounded-xl hover:bg-[#4A5AE8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
              {convId && (
                <p className="text-[10px] text-gray-400 mt-1.5 px-1">
                  Conversation: <code className="font-mono">{convId}</code>
                  <button
                    onClick={() => { setConvId(undefined); setMessages([]); }}
                    className="ml-2 text-gray-400 hover:text-red-400 underline"
                  >
                    new conversation
                  </button>
                </p>
              )}
            </div>
          </div>
        )}

        {/* ──── Knowledge Base Tab ─────────────────────────────────────────── */}
        {tab === 'knowledge' && (
          <div className="h-full overflow-y-auto px-6 py-4">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-gray-400">
                {knowledge.length} learned entries · sorted by hit count
              </p>
              <button
                onClick={() => { setDataLoading(true); fetchAiKnowledge(token, 50).then(setKnowledge).finally(() => setDataLoading(false)); }}
                className="text-xs text-gray-400 hover:text-[#404040] px-2.5 py-1 rounded-lg border border-[#EBEBEB] hover:border-gray-300 transition-colors"
              >
                Refresh
              </button>
            </div>

            {dataLoading ? (
              <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>
            ) : knowledge.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                No knowledge entries yet — send a chat message first.
              </div>
            ) : (
              <div className="space-y-2">
                {knowledge.map((row) => (
                  <div key={row.id} className="bg-white border border-[#EBEBEB] rounded-xl p-4 hover:border-gray-300 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#404040] truncate">{row.original_prompt}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5 truncate font-mono">{row.normalized_prompt}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className="text-[10px] font-bold text-[#5B6AF9]">{row.hit_count} hits</span>
                        <span className="text-[10px] text-gray-400">{row.intent_category}</span>
                      </div>
                    </div>
                    <div className="mt-2">
                      <ConfidenceBar score={row.confidence} />
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1">
                      {new Date(row.created_at).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ──── Chat History Tab ───────────────────────────────────────────── */}
        {tab === 'history' && (
          <div className="h-full overflow-y-auto px-6 py-4">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-gray-400">{history.length} recent requests</p>
              <button
                onClick={() => { setDataLoading(true); fetchAiChatHistory(token, 100).then(setHistory).finally(() => setDataLoading(false)); }}
                className="text-xs text-gray-400 hover:text-[#404040] px-2.5 py-1 rounded-lg border border-[#EBEBEB] hover:border-gray-300 transition-colors"
              >
                Refresh
              </button>
            </div>

            {dataLoading ? (
              <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>
            ) : history.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">No chat history yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#EBEBEB]">
                      {['Time', 'User', 'Prompt', 'Source', 'Confidence', 'Latency', 'Tools'].map((h) => (
                        <th key={h} className="text-left py-2 px-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row) => (
                      <tr key={row.id} className="border-b border-[#EBEBEB]/50 hover:bg-gray-50/50 transition-colors">
                        <td className="py-2 px-3 text-gray-400 whitespace-nowrap">
                          {new Date(row.created_at).toLocaleTimeString()}
                        </td>
                        <td className="py-2 px-3 font-mono text-gray-500 max-w-[80px] truncate">
                          {row.user_id.slice(0, 8)}
                        </td>
                        <td className="py-2 px-3 text-[#404040] max-w-[240px] truncate" title={row.original_prompt}>
                          {row.original_prompt}
                        </td>
                        <td className="py-2 px-3">
                          <CacheBadge source={row.cache_source} />
                        </td>
                        <td className="py-2 px-3 w-24">
                          {row.confidence_score != null ? (
                            <ConfidenceBar score={row.confidence_score} />
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          <span className={row.response_ms < 100 ? 'text-emerald-600 font-medium' : 'text-[#404040]'}>
                            {row.response_ms} ms
                          </span>
                        </td>
                        <td className="py-2 px-3 text-gray-400">{row.tool_calls_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ──── Cache Logs Tab ─────────────────────────────────────────────── */}
        {tab === 'logs' && (
          <div className="h-full overflow-y-auto px-6 py-4">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-gray-400">{cacheLogs.length} recent log entries</p>
              <button
                onClick={() => { setDataLoading(true); fetchAiCacheLogs(token, 200).then(setCacheLogs).finally(() => setDataLoading(false)); }}
                className="text-xs text-gray-400 hover:text-[#404040] px-2.5 py-1 rounded-lg border border-[#EBEBEB] hover:border-gray-300 transition-colors"
              >
                Refresh
              </button>
            </div>

            {/* Mini bar chart: source distribution */}
            {cacheLogs.length > 0 && (() => {
              const counts = cacheLogs.reduce((acc, r) => {
                if (r.hit) acc[r.cache_source] = (acc[r.cache_source] ?? 0) + 1;
                else acc.miss = (acc.miss ?? 0) + 1;
                return acc;
              }, {} as Record<string, number>);
              const total = cacheLogs.length;
              return (
                <div className="flex gap-2 mb-4 p-3 bg-gray-50 rounded-xl border border-[#EBEBEB]">
                  {(['redis', 'qdrant', 'openai', 'miss'] as const).map((key) => {
                    const count = counts[key] ?? 0;
                    const pct = Math.round((count / total) * 100);
                    const colors: Record<string, string> = {
                      redis: 'bg-emerald-500', qdrant: 'bg-blue-500', openai: 'bg-amber-500', miss: 'bg-gray-300'
                    };
                    return (
                      <div key={key} className="flex-1 text-center">
                        <div className="text-lg font-bold text-[#404040]">{count}</div>
                        <div className={`h-1 rounded-full ${colors[key]} mx-2 mb-1`} style={{ opacity: pct > 0 ? 1 : 0.2 }} />
                        <div className="text-[10px] text-gray-400 uppercase">{key}</div>
                        <div className="text-[10px] text-gray-400">{pct}%</div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {dataLoading ? (
              <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>
            ) : cacheLogs.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">No cache logs yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#EBEBEB]">
                      {['Time', 'Prompt Hash', 'Source', 'Hit', 'Confidence', 'Latency'].map((h) => (
                        <th key={h} className="text-left py-2 px-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cacheLogs.map((row) => (
                      <tr key={row.id} className="border-b border-[#EBEBEB]/50 hover:bg-gray-50/50 transition-colors">
                        <td className="py-2 px-3 text-gray-400 whitespace-nowrap">
                          {new Date(row.created_at).toLocaleTimeString()}
                        </td>
                        <td className="py-2 px-3 font-mono text-gray-400 text-[10px]">
                          {row.prompt_hash.slice(0, 12)}…
                        </td>
                        <td className="py-2 px-3">
                          <CacheBadge source={row.cache_source} />
                        </td>
                        <td className="py-2 px-3">
                          {row.hit ? (
                            <span className="text-emerald-600 font-bold">HIT</span>
                          ) : (
                            <span className="text-red-400 font-bold">MISS</span>
                          )}
                        </td>
                        <td className="py-2 px-3 w-24">
                          {row.confidence != null ? (
                            <ConfidenceBar score={row.confidence} />
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          <span className={row.response_ms < 100 ? 'text-emerald-600 font-medium' : 'text-[#404040]'}>
                            {row.response_ms} ms
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
