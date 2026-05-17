import type { HttpClient } from '../client/index.js';
import type {
  ApiResponse,
  McpTool,
  McpCallRequest,
  McpCallResult,
} from '../types/index.js';

/**
 * MCP (Model Context Protocol) module — discover and invoke AI tools.
 */
export class McpModule {
  private toolCache: McpTool[] | null = null;

  constructor(private readonly client: HttpClient) {}

  /**
   * List all available MCP tools.
   * Results are cached in-memory for the lifetime of the client instance.
   */
  async listTools(forceRefresh = false): Promise<ApiResponse<McpTool[]>> {
    if (!forceRefresh && this.toolCache) {
      return { data: this.toolCache, status: 200 };
    }

    const response = await this.client.get<McpTool[]>('/mcp/tools', undefined, { cache: true });
    this.toolCache = response.data;
    return response;
  }

  /**
   * Retrieve details for a specific tool by name.
   */
  async getTool(toolName: string): Promise<ApiResponse<McpTool>> {
    return this.client.get<McpTool>(`/mcp/tools/${toolName}`, undefined, { cache: true });
  }

  /**
   * Invoke an MCP tool by name with the given arguments.
   *
   * @example
   * const result = await client.mcp.call({
   *   toolName: 'get_failed_payouts',
   *   arguments: { userId: 101, limit: 10 },
   * });
   */
  async call(request: McpCallRequest): Promise<ApiResponse<McpCallResult>> {
    return this.client.post<McpCallResult>('/mcp/call', request);
  }

  /**
   * Execute multiple tools in a single request (batch).
   */
  async batchCall(requests: McpCallRequest[]): Promise<ApiResponse<McpCallResult[]>> {
    return this.client.post<McpCallResult[]>('/mcp/batch', { calls: requests });
  }

  /**
   * Get the MCP server manifest (protocol version, capabilities).
   */
  async manifest(): Promise<ApiResponse<Record<string, unknown>>> {
    return this.client.get('/mcp/manifest', undefined, { cache: true });
  }

  /**
   * Dynamically load and register tools matching a category.
   */
  async loadCategory(category: string): Promise<ApiResponse<McpTool[]>> {
    return this.client.get<McpTool[]>('/mcp/tools', { category }, { cache: true });
  }
}
