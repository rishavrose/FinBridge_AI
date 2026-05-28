/**
 * useAiStream — subscribes to Socket.io AI progress events emitted by the
 * backend during AI chat processing.
 *
 * Events listened to:
 *   ai:progress  — stage + message updates from the AI pipeline
 *   ai:tool_start — an MCP tool started executing
 *   ai:tool_done  — an MCP tool finished executing
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

export interface AiStreamState {
  stage: AiProgressStage | null;
  message: string;
  activeTools: string[];      // tools currently running
  completedTools: string[];   // tools that have finished
  steps: string[];            // ordered log of business-safe messages
  isStreaming: boolean;
}

const INITIAL_STATE: AiStreamState = {
  stage: null,
  message: '',
  activeTools: [],
  completedTools: [],
  steps: [],
  isStreaming: false,
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

const API_BASE = ((import.meta as any).env?.VITE_API_URL as string | undefined) ?? '';

export function useAiStream(token: string | null) {
  const [state, setState] = useState<AiStreamState>(INITIAL_STATE);
  const socketRef = useRef<Socket | null>(null);
  const connectedRef = useRef(false);

  // Connect once when token is available
  useEffect(() => {
    if (!token || connectedRef.current) return;
    connectedRef.current = true;

    const socket = io(API_BASE || window.location.origin, {
      path: '/ws',
      transports: ['websocket', 'polling'],
      auth: { token },
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });

    socketRef.current = socket;

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

    return () => {
      socket.disconnect();
      socketRef.current = null;
      connectedRef.current = false;
    };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Call this when a new message is sent to reset accumulated state */
  const startStream = useCallback((conversationId: string | null) => {
    setState({
      stage: 'start',
      message: 'Initializing...',
      activeTools: [],
      completedTools: [],
      steps: ['Analyzing your query...'],
      isStreaming: true,
    });
    void conversationId; // used by caller for correlation
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
