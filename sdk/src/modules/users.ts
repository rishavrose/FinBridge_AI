import type { HttpClient } from '../client/index.js';
import type {
  ApiResponse,
  User,
  UserFilters,
  CreateUserRequest,
  UpdateUserRequest,
  PaginationMeta,
} from '../types/index.js';

/**
 * Users module — create and manage platform users.
 */
export class UsersModule {
  constructor(private readonly client: HttpClient) {}

  /**
   * List users with optional filters.
   */
  async list(filters?: UserFilters): Promise<ApiResponse<User[]> & { meta: PaginationMeta }> {
    return this.client.get<User[]>(
      '/users',
      filters as Record<string, unknown>,
    ) as Promise<ApiResponse<User[]> & { meta: PaginationMeta }>;
  }

  /**
   * Retrieve a user by ID.
   */
  async get(userId: string | number): Promise<ApiResponse<User>> {
    return this.client.get<User>(`/users/${userId}`, undefined, { cache: true });
  }

  /**
   * Create a new user.
   */
  async create(request: CreateUserRequest): Promise<ApiResponse<User>> {
    const response = await this.client.post<User>('/users', request);
    this.client.cache.invalidatePrefix('/users');
    return response;
  }

  /**
   * Update a user.
   */
  async update(userId: string | number, request: UpdateUserRequest): Promise<ApiResponse<User>> {
    const response = await this.client.patch<User>(`/users/${userId}`, request);
    this.client.cache.delete(`/users/${userId}`);
    return response;
  }

  /**
   * Suspend a user account.
   */
  async suspend(userId: string | number, reason?: string): Promise<ApiResponse<User>> {
    const response = await this.client.post<User>(`/users/${userId}/suspend`, { reason });
    this.client.cache.delete(`/users/${userId}`);
    return response;
  }

  /**
   * Reactivate a suspended user.
   */
  async activate(userId: string | number): Promise<ApiResponse<User>> {
    const response = await this.client.post<User>(`/users/${userId}/activate`);
    this.client.cache.delete(`/users/${userId}`);
    return response;
  }

  /**
   * Delete a user (hard delete — use with caution).
   */
  async delete(userId: string | number): Promise<ApiResponse<void>> {
    const response = await this.client.delete<void>(`/users/${userId}`);
    this.client.cache.delete(`/users/${userId}`);
    return response;
  }
}
