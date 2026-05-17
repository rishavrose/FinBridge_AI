import { useState } from 'react';
import { useMcpSse } from '../../hooks/useMcpSse';

interface McpPageProps {
  token: string;
}

const STATUS_COLOR: Record<string, string> = {
  idle:         'text-gray-400',
  connecting:   'text-amber-500',
  connected:    'text-emerald-600',
  error:        'text-red-500',
  disconnected: 'text-gray-400',
};

const STATUS_DOT: Record<string, string> = {
  idle:         'bg-gray-300',
  connecting:   'bg-amber-400 animate-pulse',
  connected:    'bg-emerald-500',
  error:        'bg-red-500',
  disconnected: 'bg-gray-400',
};

export function McpPage({ token }: McpPageProps) {
  const { sessionId, status, events, error, connect, disconnect, sendRequest, clearEvents } = useMcpSse(token);
  const [customMethod, setCustomMethod] = useState('tools/list');
  const [customParams, setCustomParams] = useState('{}');
  const [paramsError, setParamsError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'events' | 'send'>('events');

  const handleSend = async () => {
    setParamsError(null);
    setSendError(null);
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(customParams) as Record<string, unknown>;
    } catch {
      setParamsError('Invalid JSON in params');
      return;
    }
    try {
      await sendRequest(customMethod, parsed);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Send failed');
    }
  };

  const quickSend = (method: string, params: Record<string, unknown> = {}) => {
    void sendRequest(method, params).catch(err => setSendError(err instanceof Error ? err.message : 'Send failed'));
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 md:px-8 py-4 md:py-5 border-b border-[#EBEBEB] flex-shrink-0 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[#404040]">MCP Console</h1>
            <p className="text-gray-400 text-xs mt-0.5">
              Raw Model Context Protocol SSE session
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-sm">
              <span className={`w-2 h-2 rounded-full ${STATUS_DOT[status]}`} />
              <span className={STATUS_COLOR[status]}>{status}</span>
            </span>
            {status === 'connected' ? (
              <button
                onClick={disconnect}
                className="px-4 py-2 rounded-lg border border-red-200 text-red-500 text-sm hover:bg-red-50 transition-colors"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={connect}
                className="px-4 py-2 rounded-lg bg-brand hover:bg-brand-600 text-white text-sm font-medium transition-colors shadow-sm shadow-brand/20"
              >
                Connect SSE
              </button>
            )}
          </div>
        </div>

        {sessionId && (
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1 bg-gray-50 border border-[#EBEBEB] rounded-lg px-4 py-2 flex items-center gap-2">
              <span className="text-xs text-gray-400">Session ID:</span>
              <code className="text-xs text-emerald-600 font-mono">{sessionId}</code>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-600">
            {error}
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
        {/* Mobile tab bar */}
        <div className="flex md:hidden border-b border-[#EBEBEB] bg-white flex-shrink-0">
          <button
            onClick={() => setActiveTab('events')}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors border-b-2 ${
              activeTab === 'events' ? 'text-brand border-brand' : 'text-gray-400 border-transparent'
            }`}
          >
            Events {events.length > 0 && `(${events.length})`}
          </button>
          <button
            onClick={() => setActiveTab('send')}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors border-b-2 ${
              activeTab === 'send' ? 'text-brand border-brand' : 'text-gray-400 border-transparent'
            }`}
          >
            Send
          </button>
        </div>

        {/* Left: event stream */}
        <div className={`${
          activeTab === 'events' ? 'flex' : 'hidden md:flex'
        } flex-1 flex-col overflow-hidden border-r border-[#EBEBEB] min-h-0`}>
          <div className="px-5 py-3 border-b border-[#EBEBEB] bg-white flex items-center justify-between flex-shrink-0">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              SSE Events {events.length > 0 && `(${events.length})`}
            </span>
            {events.length > 0 && (
              <button onClick={clearEvents} className="text-xs text-gray-400 hover:text-brand transition-colors">
                Clear
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto font-mono text-xs p-4 space-y-2 bg-gray-50">
            {events.length === 0 && (
              <div className="text-gray-400 text-center py-12">
                {status === 'idle' || status === 'disconnected'
                  ? 'Connect to start receiving events'
                  : 'Waiting for events…'}
              </div>
            )}

            {events.map((ev, i) => (
              <div key={i} className="border border-[#EBEBEB] rounded-lg overflow-hidden bg-white shadow-sm">
                <div className="flex items-center gap-3 px-3 py-1.5 bg-gray-50 border-b border-[#EBEBEB]">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                    ev.event === 'endpoint' ? 'bg-blue-100 text-blue-600' :
                    ev.event === 'message'  ? 'bg-emerald-100 text-emerald-600' :
                    'bg-gray-100 text-gray-500'
                  }`}>
                    event: {ev.event}
                  </span>
                  <span className="text-gray-400 text-[10px]">{ev.receivedAt.toLocaleTimeString()}</span>
                </div>
                <pre className="px-3 py-2 text-[#404040] whitespace-pre-wrap break-all leading-relaxed">
                  {(() => {
                    try { return JSON.stringify(JSON.parse(ev.data), null, 2); }
                    catch { return ev.data; }
                  })()}
                </pre>
              </div>
            ))}
          </div>
        </div>

        {/* Right: send panel */}
        <div className={`${
          activeTab === 'send' ? 'flex' : 'hidden md:flex'
        } w-full md:w-80 flex-shrink-0 flex-col overflow-hidden bg-white`}>
          <div className="px-5 py-3 border-b border-[#EBEBEB] flex-shrink-0">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Send Message</span>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Quick actions */}
            <div>
              <p className="text-xs text-gray-400 font-medium mb-2">Quick Actions</p>
              <div className="space-y-1.5">
                {[
                  { label: 'List Tools', method: 'tools/list', params: {} },
                  { label: 'Call get_bank_health', method: 'tools/call', params: { name: 'get_bank_health', arguments: { limit: 10 } } },
                  { label: 'Call get_recent_transactions', method: 'tools/call', params: { name: 'get_recent_transactions', arguments: { limit: 5 } } },
                  { label: 'Call get_failed_payouts', method: 'tools/call', params: { name: 'get_failed_payouts', arguments: { limit: 5 } } },
                ].map(q => (
                  <button
                    key={q.label}
                    disabled={status !== 'connected'}
                    onClick={() => quickSend(q.method, q.params)}
                    className="w-full text-left px-3 py-2.5 rounded-lg border border-[#EBEBEB] bg-gray-50 text-xs text-gray-500
                               hover:text-brand hover:border-brand/30 hover:bg-brand-50 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-[#EBEBEB]" />

            {/* Custom request */}
            <div className="space-y-3">
              <p className="text-xs text-gray-400 font-medium">Custom JSON-RPC</p>
              <div>
                <label className="text-xs text-[#404040] mb-1 block">Method</label>
                <input
                  value={customMethod}
                  onChange={e => setCustomMethod(e.target.value)}
                  className="w-full bg-gray-50 border border-[#EBEBEB] text-[#404040] rounded-lg px-3 py-2 text-xs font-mono
                             focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
                />
              </div>
              <div>
                <label className="text-xs text-[#404040] mb-1 block">Params (JSON)</label>
                <textarea
                  value={customParams}
                  onChange={e => setCustomParams(e.target.value)}
                  rows={5}
                  className="w-full bg-gray-50 border border-[#EBEBEB] text-[#404040] rounded-lg px-3 py-2 text-xs font-mono
                             focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand resize-none"
                />
                {paramsError && <p className="text-xs text-red-500 mt-1">{paramsError}</p>}
              </div>
              <button
                onClick={handleSend}
                disabled={status !== 'connected'}
                className="w-full py-2.5 rounded-lg bg-brand hover:bg-brand-600 text-white text-xs font-semibold
                           transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm shadow-brand/20"
              >
                Send Request
              </button>
              {sendError && <p className="text-xs text-red-500">{sendError}</p>}
            </div>

            <div className="border-t border-[#EBEBEB]" />

            {/* How it works */}
            <div className="space-y-2">
              <p className="text-xs text-gray-400 font-medium">How it works</p>
              <div className="text-[11px] text-gray-400 space-y-2 leading-relaxed">
                <p>1. <span className="text-[#404040]">Connect</span> — opens <code className="text-gray-500">GET /mcp/sse</code> via fetch (supports Auth header, unlike EventSource)</p>
                <p>2. Server sends <code className="text-gray-500">event: endpoint</code> with a unique <code className="text-gray-500">sessionId</code></p>
                <p>3. <span className="text-[#404040]">Send</span> — POSTs JSON-RPC to <code className="text-gray-500">/mcp/messages?sessionId=…</code></p>
                <p>4. Server returns <code className="text-gray-500">event: message</code> via the open SSE stream</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
