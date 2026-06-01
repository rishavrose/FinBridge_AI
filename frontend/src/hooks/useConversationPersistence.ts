/**
 * useConversationPersistence — Features 2, 3, 4, 10, 11
 *
 * Persists conversation state across page refreshes and multi-tab sessions:
 *  - activeConversationId in localStorage (Feature 4)
 *  - input draft autosaved every 2s (Feature 10)
 *  - BroadcastChannel to sync state across tabs (Feature 11)
 */

import { useState, useEffect, useRef, useCallback } from 'react';

const ACTIVE_CONV_KEY = 'finbridge_active_conv';
const DRAFT_KEY = 'finbridge_chat_draft';
const CHANNEL_NAME = 'finbridge_chat_sync';

export interface ConvSyncMessage {
  type: 'conv_changed' | 'draft_changed' | 'message_sent' | 'response_received' | 'conv_deleted';
  conversationId?: string | null;
  draft?: string;
}

export function useConversationPersistence() {
  // Restore active conversation from localStorage on mount
  const [persistedConvId, setPersistedConvId] = useState<string | null>(() =>
    localStorage.getItem(ACTIVE_CONV_KEY),
  );

  // Restore draft from localStorage on mount
  const [persistedDraft, setPersistedDraft] = useState<string>(() =>
    localStorage.getItem(DRAFT_KEY) ?? '',
  );

  const channelRef = useRef<BroadcastChannel | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── BroadcastChannel for cross-tab sync (Feature 11) ─────────────────────
  useEffect(() => {
    if (!window.BroadcastChannel) return;

    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;

    channel.onmessage = (event: MessageEvent<ConvSyncMessage>) => {
      const { data } = event;
      if (data.type === 'conv_changed' && data.conversationId !== undefined) {
        setPersistedConvId(data.conversationId);
      }
      if (data.type === 'draft_changed' && data.draft !== undefined) {
        setPersistedDraft(data.draft);
      }
    };

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, []);

  // ── Persist active conversation ───────────────────────────────────────────
  const setActiveConvId = useCallback((id: string | null) => {
    setPersistedConvId(id);

    if (id) {
      localStorage.setItem(ACTIVE_CONV_KEY, id);
    } else {
      localStorage.removeItem(ACTIVE_CONV_KEY);
    }

    // Broadcast to other tabs
    channelRef.current?.postMessage({
      type: 'conv_changed',
      conversationId: id,
    } satisfies ConvSyncMessage);
  }, []);

  // ── Draft autosave every 2s (Feature 10) ─────────────────────────────────
  const saveDraft = useCallback((text: string) => {
    setPersistedDraft(text);

    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);

    draftTimerRef.current = setTimeout(() => {
      if (text) {
        localStorage.setItem(DRAFT_KEY, text);
      } else {
        localStorage.removeItem(DRAFT_KEY);
      }
    }, 2000);
  }, []);

  const clearDraft = useCallback(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    setPersistedDraft('');
    localStorage.removeItem(DRAFT_KEY);
  }, []);

  // ── Broadcast helpers for other tab-sync events ───────────────────────────
  const broadcastMessage = useCallback((msg: ConvSyncMessage) => {
    channelRef.current?.postMessage(msg);
  }, []);

  useEffect(() => {
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, []);

  return {
    persistedConvId,
    persistedDraft,
    setActiveConvId,
    saveDraft,
    clearDraft,
    broadcastMessage,
  };
}
