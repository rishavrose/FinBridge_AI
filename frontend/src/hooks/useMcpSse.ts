import { useState, useEffect, useRef, useCallback } from 'react';
import { openMcpSse, sendMcpMessage } from '../api/client';
import type { JsonRpcRequest, JsonRpcResponse } from '../types';

interface McpEvent {
  event: string;
  data: string;
  parsedData?: JsonRpcResponse;
  receivedAt: Date;
}

interface UseMcpSseReturn {
  sessionId: string | null;
  status: 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected';
  events: McpEvent[];
  error: string | null;
  connect: () => void;
  disconnect: () => void;
  sendRequest: (method: string, params?: Record<string, unknown>) => Promise<number>;
  clearEvents: () => void;
}

let reqIdCounter = 1;

export function useMcpSse(token: string | null): UseMcpSseReturn {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<UseMcpSseReturn['status']>('idle');
  const [events, setEvents] = useState<McpEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const disconnect = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus('disconnected');
    setSessionId(null);
  }, []);

  const connect = useCallback(() => {
    if (!token) return;
    disconnect();

    setStatus('connecting');
    setError(null);
    setEvents([]);

    abortRef.current = openMcpSse(
      token,
      // onEvent
      (event, data) => {
        let parsedData: JsonRpcResponse | undefined;
        try { parsedData = JSON.parse(data) as JsonRpcResponse; } catch { /* raw */ }

        setEvents(prev => [...prev, { event, data, parsedData, receivedAt: new Date() }]);
      },
      // onSessionId
      (id) => {
        setSessionId(id);
        setStatus('connected');
      },
      // onError
      (err) => {
        setError(err);
        setStatus('error');
      },
    );
  }, [token, disconnect]);

  // Auto-disconnect on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const sendRequest = useCallback(
    async (method: string, params: Record<string, unknown> = {}): Promise<number> => {
      if (!sessionId || !token) throw new Error('Not connected');
      const id = reqIdCounter++;
      const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
      await sendMcpMessage(sessionId, req, token);
      return id;
    },
    [sessionId, token],
  );

  const clearEvents = useCallback(() => setEvents([]), []);

  return { sessionId, status, events, error, connect, disconnect, sendRequest, clearEvents };
}
