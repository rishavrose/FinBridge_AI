import type { HttpClient } from '../client/index.js';
import type {
  ApiResponse,
  AuthTokens,
  LoginRequest,
  RefreshRequest,
  ApiKeyInfo,
} from '../types/index.js';

/**
 * Authentication module — login, token refresh, and API key management.
 */
export class AuthModule {
  constructor(private readonly client: HttpClient) {}

  /**
   * Login with email + password. Returns access and refresh tokens.
   */
  async login(request: LoginRequest): Promise<ApiResponse<AuthTokens>> {
    const response = await this.client.post<AuthTokens>('/auth/login', request);
    // Auto-configure the client to use the returned JWT
    this.client.setToken(response.data.accessToken);
    return response;
  }

  /**
   * Refresh an expired access token using a refresh token.
   */
  async refresh(request: RefreshRequest): Promise<ApiResponse<AuthTokens>> {
    const response = await this.client.post<AuthTokens>('/auth/refresh', request);
    this.client.setToken(response.data.accessToken);
    return response;
  }

  /**
   * Invalidate the current session.
   */
  async logout(): Promise<ApiResponse<void>> {
    const response = await this.client.post<void>('/auth/logout');
    this.client.clearToken();
    return response;
  }

  /**
   * List all API keys for the current account.
   */
  async listApiKeys(): Promise<ApiResponse<ApiKeyInfo[]>> {
    return this.client.get<ApiKeyInfo[]>('/auth/api-keys');
  }

  /**
   * Rotate / regenerate an API key.
   */
  async rotateApiKey(keyId: string): Promise<ApiResponse<ApiKeyInfo & { secret: string }>> {
    return this.client.post<ApiKeyInfo & { secret: string }>(`/auth/api-keys/${keyId}/rotate`);
  }

  /**
   * Revoke an API key.
   */
  async revokeApiKey(keyId: string): Promise<ApiResponse<void>> {
    return this.client.delete<void>(`/auth/api-keys/${keyId}`);
  }
}
