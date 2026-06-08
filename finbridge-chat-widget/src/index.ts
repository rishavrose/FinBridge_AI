/**
 * FinBridge Chat Widget — public entry point.
 *
 * Two ways to use it (see README):
 *   1. Set window.FinBridgeChatConfig before loading the script → auto-inits.
 *   2. Call FinBridgeChat.init({ ... }) yourself.
 *
 * The build bundles this as an IIFE exposing `window.FinBridgeChat`.
 */

import { resolveConfig, type FinBridgeChatConfig } from './config.js';
import { ChatWidget } from './widget.js';

let instance: ChatWidget | null = null;

const FinBridgeChat = {
  /** Mount the widget. Safe to call once; a second call replaces the first. */
  init(config: FinBridgeChatConfig): ChatWidget {
    if (instance) instance.destroy();
    instance = new ChatWidget(resolveConfig(config));
    return instance;
  },
  /** Open the chat panel. */
  open(): void {
    instance?.openPanel();
  },
  /** Close the chat panel. */
  close(): void {
    instance?.closePanel();
  },
  /** Toggle the chat panel open/closed. */
  toggle(): void {
    instance?.toggle();
  },
  /** Programmatically send a message (opens the panel if needed). */
  send(message: string): void {
    if (!instance) return;
    instance.openPanel();
    void instance.send(message);
  },
  /** Clear the current thread and start fresh. */
  reset(): void {
    instance?.reset();
  },
  /** Remove the widget from the page entirely. */
  destroy(): void {
    instance?.destroy();
    instance = null;
  },
  /** The live widget instance, or null if not initialised. */
  get instance(): ChatWidget | null {
    return instance;
  },
};

// ── Auto-init from a global config object, if present ──────────────────────────
declare global {
  interface Window {
    FinBridgeChat: typeof FinBridgeChat;
    FinBridgeChatConfig?: FinBridgeChatConfig;
  }
}

if (typeof window !== 'undefined') {
  window.FinBridgeChat = FinBridgeChat;
  const boot = () => {
    if (window.FinBridgeChatConfig && !instance) {
      try {
        FinBridgeChat.init(window.FinBridgeChatConfig);
      } catch (err) {
        console.error('[FinBridgeChat] failed to initialise:', err);
      }
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}

export default FinBridgeChat;
export type { FinBridgeChatConfig };
