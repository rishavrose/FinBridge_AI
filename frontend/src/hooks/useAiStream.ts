/**
 * useAiStream — subscribes to Socket.io AI progress events emitted by the
 * backend during AI chat processing.
 *
 * Features 1, 7, 8:
 *  - Joins a user-specific Socket.io room so events are targeted (not broadcast)
 *  - Handles ai:job_complete / ai:job_failed / ai:job_cancelled for background jobs
 *  - Auto-reconnects with exponential backoff (Feature 8)
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, type Socket } from 'socket.io-client';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AiProgressStage =
  | 'start'
  | 'cache_check'
  | 'context_load'
  | 'tool_start'
  | 'tool_done'
  | 'generating'
  | 'validating'
  | 'complete'
  | 'cache_hit';

export interface AiProgressEvent {
  ts: number;
  conversationId: string | null;
  stage: AiProgressStage;
  message: string;
}

export interface AiToolEvent {
  ts: number;
  conversationId: string | null;
  tool: string;
}

export interface AiJobCompleteEvent {
  ts: number;
  jobId: string;
  conversationId: string;
  messageId: string;
  reply: string;
}

export interface AiJobFailedEvent {
  ts: number;
  jobId: string;
  conversationId: string;
  error: string;
}

export interface AiJobCancelledEvent {
  ts: number;
  jobId: string;
  conversationId: string;
}

export interface AiStreamState {
  stage: AiProgressStage | null;
  message: string;
  activeTools: string[];
  completedTools: string[];
  steps: string[];
  isStreaming: boolean;
  socketConnected: boolean;
}

const INITIAL_STATE: AiStreamState = {
  stage: null,
  message: '',
  activeTools: [],
  completedTools: [],
  steps: [],
  isStreaming: false,
  socketConnected: false,
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

const API_BASE = ((import.meta as any).env?.VITE_API_URL as string | undefined) ?? '';

export function useAiStream(
  token: string | null,
  onJobComplete?: (event: AiJobCompleteEvent) => void,
  onJobFailed?: (event: AiJobFailedEvent) => void,
) {
  const [state, setState] = useState<AiStreamState>(INITIAL_STATE);
  const socketRef = useRef<Socket | null>(null);
  const onJobCompleteRef = useRef(onJobComplete);
  const onJobFailedRef = useRef(onJobFailed);

  // Keep callbacks up-to-date without reconnecting the socket
  useEffect(() => { onJobCompleteRef.current = onJobComplete; }, [onJobComplete]);
  useEffect(() => { onJobFailedRef.current = onJobFailed; }, [onJobFailed]);

  useEffect(() => {
    if (!token) return;

    const socket = io(API_BASE || window.location.origin, {
      path: '/ws',
      transports: ['websocket', 'polling'],
      auth: { token },              // server uses this to join user:{userId} room
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,  // Feature 8: auto-reconnect with backoff
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setState(prev => ({ ...prev, socketConnected: true }));
    });

    socket.on('disconnect', () => {
      setState(prev => ({ ...prev, socketConnected: false }));
    });

    // ── Real-time progress events ─────────────────────────────────────────────
    socket.on('ai:progress', (event: AiProgressEvent) => {
      setState(prev => ({
        ...prev,
        stage: event.stage,
        message: event.message,
        isStreaming: event.stage !== 'complete',
        steps: event.stage !== 'complete'
          ? [...prev.steps.slice(-6), event.message]
          : prev.steps,
      }));
    });

    socket.on('ai:tool_start', (event: AiToolEvent) => {
      setState(prev => ({
        ...prev,
        activeTools: [...prev.activeTools.filter(t => t !== event.tool), event.tool],
      }));
    });

    socket.on('ai:tool_done', (event: AiToolEvent) => {
      setState(prev => ({
        ...prev,
        activeTools: prev.activeTools.filter(t => t !== event.tool),
        completedTools: [...prev.completedTools.filter(t => t !== event.tool), event.tool],
        steps: [...prev.steps.slice(-6), `Loaded ${humanizeTool(event.tool)}`],
      }));
    });

    // ── Background job completion events (Feature 1, 7) ───────────────────────
    socket.on('ai:job_complete', (event: AiJobCompleteEvent) => {
      setState(prev => ({
        ...prev,
        stage: 'complete',
        isStreaming: false,
        activeTools: [],
        message: 'Response ready.',
      }));
      onJobCompleteRef.current?.(event);
    });

    socket.on('ai:job_failed', (event: AiJobFailedEvent) => {
      setState(prev => ({
        ...prev,
        stage: null,
        isStreaming: false,
        activeTools: [],
        message: '',
      }));
      onJobFailedRef.current?.(event);
    });

    socket.on('ai:job_cancelled', () => {
      setState(prev => ({
        ...prev,
        stage: null,
        isStreaming: false,
        activeTools: [],
        message: '',
      }));
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Call this when a new message is sent to reset accumulated state */
  const startStream = useCallback((_conversationId: string | null) => {
    setState({
      stage: 'start',
      message: 'Initializing...',
      activeTools: [],
      completedTools: [],
      steps: ['Analyzing your query...'],
      isStreaming: true,
      socketConnected: socketRef.current?.connected ?? false,
    });
  }, []);

  /** Call this when the response has been received */
  const endStream = useCallback(() => {
    setState(prev => ({
      ...prev,
      stage: 'complete',
      isStreaming: false,
      activeTools: [],
    }));
  }, []);

  return { streamState: state, startStream, endStream };
}

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Convert a raw MCP tool name to a human-readable label */
export function humanizeTool(name: string): string {
  return name
    .replace(/^query_/, '')
    .replace(/^[a-z0-9]+_api_/, '')
    .replace(/^[a-z0-9]+_merchant_[a-z0-9]+_api_/, '')
    .replace(/tbl_/, '')
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
