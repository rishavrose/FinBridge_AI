import type { HttpClient } from '../client/index.js';
import type {
  ApiResponse,
  AiAskRequest,
  AiAskResponse,
  AiMessage,
  AiStreamChunk,
} from '../types/index.js';

/**
 * AI module — natural-language queries powered by the FinBridge AI platform.
 */
export class AiModule {
  constructor(private readonly client: HttpClient) {}

  /**
   * Ask a natural-language question. The platform automatically selects
   * and invokes relevant MCP tools and returns a synthesised answer.
   *
   * @example
   * const res = await client.ai.ask({ prompt: 'Why did payouts fail today?' });
   * console.log(res.data.answer);
   */
  async ask(request: AiAskRequest): Promise<ApiResponse<AiAskResponse>> {
    return this.client.post<AiAskResponse>('/ai/ask', request);
  }

  /**
   * Start or continue a multi-turn conversation.
   */
  async chat(
    messages: AiMessage[],
    options?: Partial<Omit<AiAskRequest, 'prompt' | 'messages'>>,
  ): Promise<ApiResponse<AiAskResponse>> {
    return this.client.post<AiAskResponse>('/ai/chat', { ...options, messages });
  }

  /**
   * Stream an AI response as server-sent chunks.
   * Returns an async generator that yields `AiStreamChunk` objects.
   *
   * Note: Requires the base URL to support SSE streaming.
   */
  async *stream(request: AiAskRequest): AsyncGenerator<AiStreamChunk> {
    const response = await this.client.post<AiStreamChunk[]>('/ai/stream', {
      ...request,
      stream: true,
    });
    // In a real streaming scenario this would consume SSE; here we yield
    // items from the resolved array to keep the interface consistent.
    for (const chunk of response.data) {
      yield chunk;
    }
  }

  /**
   * Generate a database query (SQL / NoSQL) from a natural-language prompt.
   */
  async generateQuery(
    prompt: string,
    dialect: 'sql' | 'mongodb' | 'redis' = 'sql',
  ): Promise<ApiResponse<{ query: string; explanation: string }>> {
    return this.client.post('/ai/generate-query', { prompt, dialect });
  }

  /**
   * Explain the result of an AI tool call in plain English.
   */
  async explain(
    toolName: string,
    result: unknown,
  ): Promise<ApiResponse<{ explanation: string }>> {
    return this.client.post('/ai/explain', { toolName, result });
  }
}
