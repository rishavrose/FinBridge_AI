import { useEffect, useRef, useState, useCallback } from 'react';
import { io, type Socket } from 'socket.io-client';

export type SocketStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected';

interface UseSocketOptions {
  url: string;
  enabled?: boolean;
  onMetrics?: (data: unknown) => void;
  onAlert?: (data: unknown) => void;
  onAlertResolved?: (id: string) => void;
  onIncident?: (data: unknown) => void;
}

export function useSocket({ url, enabled = true, onMetrics, onAlert, onAlertResolved, onIncident }: UseSocketOptions) {
  const [status, setStatus] = useState<SocketStatus>('idle');
  const socketRef = useRef<Socket | null>(null);
  const handlersRef = useRef({ onMetrics, onAlert, onAlertResolved, onIncident });

  // Keep handlers current without reconnecting
  useEffect(() => {
    handlersRef.current = { onMetrics, onAlert, onAlertResolved, onIncident };
  }, [onMetrics, onAlert, onAlertResolved, onIncident]);

  useEffect(() => {
    if (!enabled) return;
    setStatus('connecting');

    const socket = io(url, {
      path: '/ws',
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });

    socketRef.current = socket;

    socket.on('connect',    () => setStatus('connected'));
    socket.on('disconnect', () => setStatus('disconnected'));
    socket.on('connect_error', () => setStatus('error'));

    socket.on('metrics:update', (e: { data: unknown }) => handlersRef.current.onMetrics?.(e.data));
    socket.on('alert:new',      (e: { data: unknown }) => handlersRef.current.onAlert?.(e.data));
    socket.on('alert:resolved', (e: { id: string })   => handlersRef.current.onAlertResolved?.(e.id));
    socket.on('incident:update',(e: { data: unknown }) => handlersRef.current.onIncident?.(e.data));

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setStatus('idle');
    };
  }, [url, enabled]);

  const emit = useCallback((event: string, data?: unknown) => {
    socketRef.current?.emit(event, data);
  }, []);

  return { status, emit };
}
