import type { ResolvedConfig } from './config.js';

/** Shape of POST /ai/chat/message — matches the FinBridge backend contract. */
export interface ChatResponse {
  reply: string;
  conversationId: string;
  messageId: string | null;
  cached?: boolean;
  responseMs?: number;
  toolCallsExecuted?: number;
  /** Set when the backend punted the work to its background queue. */
  requiresBackground?: boolean;
  refused?: boolean;
}

export class ChatError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) {
    super(message);
    this.name = 'ChatError';
  }
}

/** Thin client around the single chat endpoint. Resolves the auth token per call. */
export class ChatClient {
  constructor(private readonly cfg: ResolvedConfig) {}

  private async resolveToken(): Promise<string | null> {
    const { token, getToken, tokenUrl } = this.cfg;
    if (typeof getToken === 'function') return await getToken();
    if (tokenUrl) {
      const res = await fetch(tokenUrl, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new ChatError('Could not obtain an auth token.', res.status);
      const body = (await res.json()) as { token?: string };
      if (!body.token) throw new ChatError('Token endpoint did not return a token.');
      return body.token;
    }
    return token ?? null;
  }

  /** Send one message. `conversationId` continues an existing thread when provided. */
  async send(message: string, conversationId: string | null): Promise<ChatResponse> {
    const token = await this.resolveToken();

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let res: Response;
    try {
      res = await fetch(`${this.cfg.apiUrl}/ai/chat/message`, {
        method: 'POST',
        headers,
        body: JSON.stringify(conversationId ? { message, conversationId } : { message }),
      });
    } catch {
      throw new ChatError('Unable to reach the server. Please check your connection.');
    }

    // 202 (background/heavy query) still carries a usable `reply` string, so we
    // accept it the same as 200 and surface the queued message to the user.
    if (!res.ok && res.status !== 202) {
      const { message: detail, code } = await safeError(res);
      if (res.status === 401 || res.status === 403) {
        throw new ChatError(detail || 'Not authorized. Please check your access token.', res.status, code);
      }
      if (res.status === 429) {
        throw new ChatError(detail || 'Too many requests — please slow down and try again.', res.status, code);
      }
      throw new ChatError(detail || 'Something went wrong. Please try again.', res.status, code);
    }

    return (await res.json()) as ChatResponse;
  }
}

async function safeError(res: Response): Promise<{ message: string; code?: string }> {
  try {
    const body = (await res.json()) as { message?: string; error?: string; code?: string };
    return { message: body.message ?? body.error ?? '', code: body.code };
  } catch {
    return { message: '' };
  }
}
