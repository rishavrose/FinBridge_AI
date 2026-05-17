import type { HttpClient } from '../client/index.js';
import type {
  ApiResponse,
  Payout,
  PayoutFilters,
  CreatePayoutRequest,
  RetryPayoutRequest,
  PaginationMeta,
} from '../types/index.js';
import { Cache } from '../utils/cache.js';

/**
 * Payouts module — create, query, retry, and cancel payouts.
 */
export class PayoutsModule {
  constructor(private readonly client: HttpClient) {}

  /**
   * List payouts with optional filters.
   */
  async list(filters?: PayoutFilters): Promise<ApiResponse<Payout[]> & { meta: PaginationMeta }> {
    return this.client.get<Payout[]>(
      '/payouts',
      filters as Record<string, unknown>,
    ) as Promise<ApiResponse<Payout[]> & { meta: PaginationMeta }>;
  }

  /**
   * Retrieve a single payout by ID.
   */
  async get(payoutId: string): Promise<ApiResponse<Payout>> {
    return this.client.get<Payout>(
      `/payouts/${payoutId}`,
      undefined,
      { cache: true },
    );
  }

  /**
   * Fetch all failed payouts (convenience wrapper).
   */
  async failed(filters?: Omit<PayoutFilters, 'status'>): Promise<ApiResponse<Payout[]>> {
    return this.client.get<Payout[]>('/payouts', {
      ...filters,
      status: 'failed',
    });
  }

  /**
   * Fetch all pending payouts.
   */
  async pending(filters?: Omit<PayoutFilters, 'status'>): Promise<ApiResponse<Payout[]>> {
    return this.client.get<Payout[]>('/payouts', {
      ...filters,
      status: 'pending',
    });
  }

  /**
   * Create a new payout.
   */
  async create(request: CreatePayoutRequest): Promise<ApiResponse<Payout>> {
    const response = await this.client.post<Payout>('/payouts', request);
    // Invalidate list cache after mutation
    this.client.cache.invalidatePrefix('/payouts');
    return response;
  }

  /**
   * Retry a failed payout.
   */
  async retry(request: RetryPayoutRequest): Promise<ApiResponse<Payout>> {
    const response = await this.client.post<Payout>(
      `/payouts/${request.payoutId}/retry`,
      { reason: request.reason },
    );
    this.client.cache.invalidatePrefix('/payouts');
    return response;
  }

  /**
   * Cancel a pending payout.
   */
  async cancel(payoutId: string, reason?: string): Promise<ApiResponse<Payout>> {
    const response = await this.client.post<Payout>(`/payouts/${payoutId}/cancel`, { reason });
    this.client.cache.delete(Cache.buildKey(`/payouts/${payoutId}`));
    return response;
  }

  /**
   * Fetch a summary of payout metrics.
   */
  async summary(
    startDate: string,
    endDate: string,
  ): Promise<ApiResponse<Record<string, number | string>>> {
    return this.client.get('/payouts/summary', { startDate, endDate }, { cache: true });
  }
}
