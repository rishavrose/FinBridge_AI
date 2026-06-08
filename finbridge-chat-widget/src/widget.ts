import type { ResolvedConfig } from './config.js';
import { ChatClient, ChatError, type ChatResponse } from './api.js';
import { buildStyles } from './styles.js';
import {
  ICON_ARROW,
  ICON_CLOSE,
  ICON_LOGO,
  ICON_MINIMIZE,
  ICON_SEND,
} from './icons.js';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * Self-contained chat widget. Renders a floating launcher and a chat panel
 * inside an isolated Shadow DOM, and drives them off the FinBridge backend.
 */
export class ChatWidget {
  private readonly cfg: ResolvedConfig;
  private readonly client: ChatClient;
  private readonly host: HTMLElement;
  private readonly shadow: ShadowRoot;

  private open = false;
  private busy = false;
  private conversationId: string | null = null;
  private messages: ChatMessage[] = [];

  // Cached element handles.
  private launcher!: HTMLButtonElement;
  private panel!: HTMLDivElement;
  private messagesEl!: HTMLDivElement;
  private input!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private suggestionsEl!: HTMLDivElement;

  constructor(cfg: ResolvedConfig) {
    this.cfg = cfg;
    this.client = new ChatClient(cfg);

    this.host = document.createElement('div');
    this.host.setAttribute('data-finbridge-chat', '');
    this.shadow = this.host.attachShadow({ mode: 'open' });

    if (cfg.persistConversation) {
      this.conversationId = localStorage.getItem(this.convKey()) || null;
    }

    this.render();
    document.body.appendChild(this.host);

    if (cfg.autoOpen) this.openPanel();
  }

  // ── Storage keys ───────────────────────────────────────────────────────────
  private convKey() {
    return `${this.cfg.storageKey}:conversationId`;
  }

  // ── Markup ───────────────────────────────────────────────────────────────────
  private render(): void {
    const style = document.createElement('style');
    style.textContent = buildStyles(this.cfg);
    this.shadow.appendChild(style);

    const root = document.createElement('div');
    root.className = 'fb-root';
    root.innerHTML = `
      <button class="fb-launcher" type="button" aria-label="${esc(this.cfg.launcherLabel)}">
        ${this.logoMarkup()}
        <span>${esc(this.cfg.launcherLabel)}</span>
      </button>
      <div class="fb-panel fb-hidden" role="dialog" aria-label="${esc(this.cfg.title)} chat">
        <div class="fb-header">
          <span class="fb-logo">${this.logoMarkup()}</span>
          <span class="fb-brand">${esc(this.cfg.title)}</span>
          <span class="fb-spacer"></span>
          <button class="fb-iconbtn fb-minimize" type="button" aria-label="Minimize">${ICON_MINIMIZE}</button>
          <button class="fb-iconbtn fb-close" type="button" aria-label="Close">${ICON_CLOSE}</button>
        </div>
        <div class="fb-error fb-hidden"></div>
        <div class="fb-messages" aria-live="polite"></div>
        <div class="fb-composer">
          <div class="fb-inputrow">
            <textarea class="fb-input" rows="1" placeholder="${esc(this.cfg.placeholder)}"></textarea>
            <button class="fb-send" type="button" aria-label="Send" disabled>${ICON_SEND}</button>
          </div>
          <div class="fb-footer">${esc(this.cfg.footerText)}</div>
        </div>
      </div>
    `;
    this.shadow.appendChild(root);

    this.launcher = root.querySelector('.fb-launcher') as HTMLButtonElement;
    this.panel = root.querySelector('.fb-panel') as HTMLDivElement;
    this.messagesEl = root.querySelector('.fb-messages') as HTMLDivElement;
    this.input = root.querySelector('.fb-input') as HTMLTextAreaElement;
    this.sendBtn = root.querySelector('.fb-send') as HTMLButtonElement;
    const errorEl = root.querySelector('.fb-error') as HTMLDivElement;
    this.suggestionsEl = document.createElement('div');
    this.suggestionsEl.className = 'fb-suggestions';

    // Wire events.
    this.launcher.addEventListener('click', () => this.toggle());
    (root.querySelector('.fb-close') as HTMLElement).addEventListener('click', () => this.closePanel());
    (root.querySelector('.fb-minimize') as HTMLElement).addEventListener('click', () => this.closePanel());
    this.sendBtn.addEventListener('click', () => this.submit());

    this.input.addEventListener('input', () => {
      this.autoGrow();
      this.sendBtn.disabled = this.input.value.trim().length === 0 || this.busy;
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.submit();
      }
    });

    // Stash the error element on the instance via closure-friendly accessor.
    this.showError = (msg: string | null) => {
      if (!msg) {
        errorEl.classList.add('fb-hidden');
        errorEl.textContent = '';
      } else {
        errorEl.textContent = msg;
        errorEl.classList.remove('fb-hidden');
      }
    };

    // Seed the welcome message + suggestions.
    this.renderWelcome();
  }

  private logoMarkup(): string {
    const logo = this.cfg.logoUrl;
    if (!logo) return ICON_LOGO;
    if (logo.trim().startsWith('<svg')) return logo;
    if (/^https?:|^data:|\.(png|jpg|jpeg|svg|gif|webp)$/i.test(logo)) {
      return `<img src="${esc(logo)}" alt="" />`;
    }
    return `<span>${esc(logo)}</span>`; // emoji or short text
  }

  // ── Welcome + suggestions ──────────────────────────────────────────────────
  private renderWelcome(): void {
    this.messagesEl.innerHTML = '';
    this.appendBubble('assistant', this.cfg.welcomeMessage, { announce: false });

    if (this.cfg.suggestions.length) {
      this.suggestionsEl.innerHTML = '';
      for (const s of this.cfg.suggestions) {
        const chip = document.createElement('button');
        chip.className = 'fb-chip';
        chip.type = 'button';
        chip.innerHTML = `<span>${esc(s)}</span><span class="fb-chip-arrow">${ICON_ARROW}</span>`;
        chip.addEventListener('click', () => this.send(s));
        this.suggestionsEl.appendChild(chip);
      }
      this.messagesEl.appendChild(this.suggestionsEl);
    }
  }

  // ── Open / close ───────────────────────────────────────────────────────────
  toggle(): void {
    this.open ? this.closePanel() : this.openPanel();
  }

  openPanel(): void {
    this.open = true;
    this.panel.classList.remove('fb-hidden');
    this.launcher.classList.add('fb-hidden');
    this.scrollToBottom();
    setTimeout(() => this.input.focus(), 50);
    this.cfg.onOpen?.();
  }

  closePanel(): void {
    this.open = false;
    this.panel.classList.add('fb-hidden');
    this.launcher.classList.remove('fb-hidden');
    this.cfg.onClose?.();
  }

  // ── Sending ────────────────────────────────────────────────────────────────
  private submit(): void {
    const text = this.input.value.trim();
    if (!text) return;
    this.input.value = '';
    this.autoGrow();
    this.send(text);
  }

  /** Public: send a message programmatically (also used by the suggestion chips). */
  async send(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || this.busy) return;

    this.showError(null);
    this.removeSuggestions();
    this.appendBubble('user', trimmed);
    this.cfg.onMessage?.({ role: 'user', text: trimmed });

    this.setBusy(true);
    const typing = this.appendTyping();

    try {
      const res = await this.requestWithHealing(trimmed);
      typing.remove();
      const reply = res.reply || 'Sorry, I could not generate a response.';
      this.appendBubble('assistant', reply);
      this.cfg.onMessage?.({ role: 'assistant', text: reply });
    } catch (err) {
      typing.remove();
      const msg = err instanceof ChatError ? err.message : 'Something went wrong. Please try again.';
      this.showError(msg);
    } finally {
      this.setBusy(false);
    }
  }

  /**
   * Send through the backend, healing a stale conversation id transparently.
   *
   * The persisted conversationId can become invalid — it was created under a
   * different user/token, the server's DB was reset, or you switched backends.
   * The server then returns 404 `NOT_FOUND`. Instead of getting stuck resending
   * the dead id, we drop it and retry once as a brand-new conversation.
   */
  private async requestWithHealing(text: string): Promise<ChatResponse> {
    try {
      return await this.dispatch(text, this.conversationId);
    } catch (err) {
      const stale =
        err instanceof ChatError &&
        this.conversationId !== null &&
        (err.code === 'NOT_FOUND' || err.status === 404);
      if (stale) {
        this.forgetConversation();
        return await this.dispatch(text, null); // retry fresh — server creates a new thread
      }
      throw err;
    }
  }

  /** One request; adopts and persists whatever conversationId the server returns. */
  private async dispatch(text: string, convId: string | null): Promise<ChatResponse> {
    const res = await this.client.send(text, convId);
    if (res.conversationId) {
      this.conversationId = res.conversationId;
      if (this.cfg.persistConversation) {
        localStorage.setItem(this.convKey(), res.conversationId);
      }
    }
    return res;
  }

  /** Drop the current conversation id from memory and storage. */
  private forgetConversation(): void {
    this.conversationId = null;
    if (this.cfg.persistConversation) localStorage.removeItem(this.convKey());
  }

  // ── Rendering helpers ────────────────────────────────────────────────────────
  private appendBubble(role: ChatMessage['role'], text: string, opts: { announce?: boolean } = {}): HTMLElement {
    this.messages.push({ role, text });

    const row = document.createElement('div');
    row.className = `fb-row ${role === 'user' ? 'user' : 'ai'}`;

    const bubble = document.createElement('div');
    bubble.className = 'fb-bubble';
    bubble.innerHTML = renderMarkdown(text);

    if (role === 'assistant') {
      const avatar = document.createElement('div');
      avatar.className = 'fb-avatar';
      avatar.innerHTML = this.logoMarkup();
      row.appendChild(avatar);
    }
    row.appendChild(bubble);
    this.messagesEl.appendChild(row);
    if (opts.announce !== false) this.scrollToBottom();
    return row;
  }

  private appendTyping(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'fb-row ai';
    row.innerHTML = `
      <div class="fb-avatar">${this.logoMarkup()}</div>
      <div class="fb-bubble" style="padding:0"><div class="fb-typing"><span></span><span></span><span></span></div></div>
    `;
    this.messagesEl.appendChild(row);
    this.scrollToBottom();
    return row;
  }

  private removeSuggestions(): void {
    if (this.suggestionsEl.parentElement) this.suggestionsEl.remove();
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.sendBtn.disabled = busy || this.input.value.trim().length === 0;
    this.input.disabled = busy;
  }

  private autoGrow(): void {
    this.input.style.height = 'auto';
    this.input.style.height = `${Math.min(this.input.scrollHeight, 120)}px`;
  }

  private scrollToBottom(): void {
    requestAnimationFrame(() => {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    });
  }

  // ── Reset / teardown ─────────────────────────────────────────────────────────
  /** Clear the thread and start a fresh conversation. */
  reset(): void {
    this.forgetConversation();
    this.messages = [];
    this.showError(null);
    this.renderWelcome();
  }

  destroy(): void {
    this.host.remove();
  }

  // Assigned in render(); declared here for typing.
  private showError: (msg: string | null) => void = () => {};
}

// ── Tiny, safe markdown → HTML (escape first, then a minimal subset) ──────────
function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMarkdown(raw: string): string {
  let s = esc(raw);
  // `inline code`
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  // **bold**
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // [text](url) — only http(s) links
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  // bare URLs
  s = s.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  return s;
}
