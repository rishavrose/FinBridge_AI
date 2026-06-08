import type { ResolvedConfig } from './config.js';

/**
 * All widget CSS, scoped to the Shadow DOM so it can never clash with — or be
 * overridden by — the host page. Theme values are injected as CSS variables.
 */
export function buildStyles(cfg: ResolvedConfig): string {
  const edge = cfg.position === 'bottom-left' ? 'left' : 'right';
  return `
  :host {
    --fb-primary: ${cfg.primaryColor};
    --fb-primary-ink: #ffffff;
    --fb-bg: #ffffff;
    --fb-panel-bg: #f4f5f8;
    --fb-text: #1f2533;
    --fb-muted: #6b7280;
    --fb-border: #e3e8f4;
    --fb-user-bubble: var(--fb-primary);
    --fb-ai-bubble: #ffffff;
    --fb-radius: 16px;
    --fb-offset: ${cfg.offset}px;
    all: initial;
  }

  * { box-sizing: border-box; }

  .fb-root {
    position: fixed;
    bottom: var(--fb-offset);
    ${edge}: var(--fb-offset);
    z-index: ${cfg.zIndex};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 15px;
    line-height: 1.5;
    color: var(--fb-text);
  }

  /* ── Launcher button ──────────────────────────────────────────────────── */
  .fb-launcher {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 12px 18px;
    border: none;
    border-radius: 999px;
    background: var(--fb-primary);
    color: var(--fb-primary-ink);
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 10px 30px rgba(20, 30, 80, 0.28);
    transition: transform .15s ease, box-shadow .15s ease, opacity .15s ease;
  }
  .fb-launcher:hover { transform: translateY(-2px); box-shadow: 0 14px 36px rgba(20, 30, 80, 0.34); }
  .fb-launcher:active { transform: translateY(0); }
  .fb-launcher svg { display: block; }

  /* ── Panel ────────────────────────────────────────────────────────────── */
  .fb-panel {
    position: absolute;
    bottom: 0;
    ${edge}: 0;
    width: 384px;
    max-width: calc(100vw - 24px);
    height: 600px;
    max-height: calc(100vh - 48px);
    display: flex;
    flex-direction: column;
    background: var(--fb-panel-bg);
    border-radius: 20px;
    overflow: hidden;
    box-shadow: 0 24px 70px rgba(20, 30, 80, 0.28);
    transform-origin: bottom ${edge};
    animation: fb-pop .22s cubic-bezier(.16,1,.3,1);
  }
  @keyframes fb-pop {
    from { opacity: 0; transform: translateY(16px) scale(.96); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }

  .fb-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 18px;
    background: var(--fb-panel-bg);
  }
  .fb-header .fb-brand { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 18px; color: var(--fb-text); }
  .fb-header .fb-logo { display: inline-flex; color: var(--fb-primary); }
  .fb-header .fb-logo img { width: 22px; height: 22px; border-radius: 6px; object-fit: cover; }
  .fb-header .fb-spacer { flex: 1; }
  .fb-iconbtn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 32px; height: 32px; border: none; border-radius: 8px;
    background: transparent; color: var(--fb-muted); cursor: pointer; transition: background .15s ease;
  }
  .fb-iconbtn:hover { background: rgba(20,30,80,.07); color: var(--fb-text); }

  /* ── Messages ─────────────────────────────────────────────────────────── */
  .fb-messages {
    flex: 1;
    overflow-y: auto;
    padding: 8px 18px 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    scroll-behavior: smooth;
  }
  .fb-messages::-webkit-scrollbar { width: 8px; }
  .fb-messages::-webkit-scrollbar-thumb { background: rgba(20,30,80,.16); border-radius: 8px; }

  .fb-row { display: flex; gap: 10px; align-items: flex-end; }
  .fb-row.user { justify-content: flex-end; }
  .fb-avatar {
    flex: 0 0 auto; width: 28px; height: 28px; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    background: var(--fb-primary); color: #fff;
  }
  .fb-avatar img { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; }

  .fb-bubble {
    max-width: 80%;
    padding: 11px 14px;
    border-radius: 16px;
    white-space: pre-wrap;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  .fb-row.ai .fb-bubble {
    background: var(--fb-ai-bubble);
    color: var(--fb-text);
    border-bottom-left-radius: 4px;
    box-shadow: 0 2px 8px rgba(20,30,80,.06);
  }
  .fb-row.user .fb-bubble {
    background: var(--fb-user-bubble);
    color: #fff;
    border-bottom-right-radius: 4px;
  }
  .fb-bubble a { color: inherit; text-decoration: underline; }
  .fb-row.ai .fb-bubble a { color: var(--fb-primary); }
  .fb-bubble code {
    background: rgba(20,30,80,.08); padding: 1px 5px; border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px;
  }
  .fb-bubble strong { font-weight: 700; }

  /* ── Suggestion chips ─────────────────────────────────────────────────── */
  .fb-suggestions {
    display: flex; flex-direction: column; gap: 10px;
    background: var(--fb-bg); border-radius: 14px; padding: 12px;
    box-shadow: 0 2px 10px rgba(20,30,80,.06); margin-left: 38px;
  }
  .fb-chip {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    text-align: left; width: 100%; padding: 12px 14px;
    border: 1px solid var(--fb-border); border-radius: 12px;
    background: #fff; color: var(--fb-text); font-size: 14px; font-weight: 500; cursor: pointer;
    transition: border-color .15s ease, transform .1s ease, box-shadow .15s ease;
  }
  .fb-chip:hover { border-color: var(--fb-primary); box-shadow: 0 4px 14px rgba(20,30,80,.08); }
  .fb-chip:active { transform: scale(.99); }
  .fb-chip .fb-chip-arrow { color: var(--fb-muted); flex: 0 0 auto; }

  /* ── Typing indicator ─────────────────────────────────────────────────── */
  .fb-typing { display: inline-flex; gap: 4px; padding: 14px 16px; }
  .fb-typing span {
    width: 7px; height: 7px; border-radius: 50%; background: var(--fb-muted);
    animation: fb-blink 1.2s infinite ease-in-out both;
  }
  .fb-typing span:nth-child(2) { animation-delay: .2s; }
  .fb-typing span:nth-child(3) { animation-delay: .4s; }
  @keyframes fb-blink { 0%, 80%, 100% { opacity: .25; transform: scale(.85); } 40% { opacity: 1; transform: scale(1); } }

  /* ── Composer ─────────────────────────────────────────────────────────── */
  .fb-composer { padding: 12px 16px 8px; }
  .fb-inputrow {
    display: flex; align-items: flex-end; gap: 8px;
    background: #fff; border: 1px solid var(--fb-border); border-radius: 14px; padding: 6px 6px 6px 14px;
  }
  .fb-inputrow:focus-within { border-color: var(--fb-primary); }
  .fb-input {
    flex: 1; border: none; outline: none; resize: none; background: transparent;
    font: inherit; color: var(--fb-text); max-height: 120px; padding: 8px 0; line-height: 1.4;
  }
  .fb-input::placeholder { color: var(--fb-muted); }
  .fb-send {
    flex: 0 0 auto; width: 40px; height: 40px; border: none; border-radius: 10px;
    background: var(--fb-primary); color: #fff; cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center; transition: opacity .15s ease;
  }
  .fb-send:disabled { opacity: .45; cursor: not-allowed; }
  .fb-footer { text-align: center; font-size: 11px; color: var(--fb-muted); padding: 6px 0 12px; }
  .fb-error {
    margin: 0 18px; padding: 8px 12px; border-radius: 10px;
    background: #fff3f2; color: #b42318; font-size: 13px; border: 1px solid #fdd;
  }

  .fb-hidden { display: none !important; }

  @media (max-width: 480px) {
    .fb-panel { width: calc(100vw - 16px); height: calc(100vh - 32px); }
  }
  @media (prefers-reduced-motion: reduce) {
    .fb-panel { animation: none; }
    .fb-launcher { transition: none; }
  }
  `;
}
