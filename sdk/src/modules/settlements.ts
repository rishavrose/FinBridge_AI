import type { HttpClient } from '../client/index.js';
import type {
  ApiResponse,
  Settlement,
  SettlementFilters,
  SettlementSummary,
  PaginationMeta,
} from '../types/index.js';

/**
 * Settlements module — track and manage merchant settlements.
 */
export class SettlementsModule {
  constructor(private readonly client: HttpClient) {}

  /**
   * List settlements with optional filters.
   */
  async list(
    filters?: SettlementFilters,
  ): Promise<ApiResponse<Settlement[]> & { meta: PaginationMeta }> {
    return this.client.get<Settlement[]>(
      '/settlements',
      filters as Record<string, unknown>,
    ) as Promise<ApiResponse<Settlement[]> & { meta: PaginationMeta }>;
  }

  /**
   * Retrieve a single settlement by ID.
   */
  async get(settlementId: string): Promise<ApiResponse<Settlement>> {
    return this.client.get<Settlement>(
      `/settlements/${settlementId}`,
      undefined,
      { cache: true },
    );
  }

  /**
   * Retrieve a settlement summary for a period.
   */
  async summary(startDate: string, endDate: string): Promise<ApiResponse<SettlementSummary>> {
    return this.client.get<SettlementSummary>(
      '/settlements/summary',
      { startDate, endDate },
      { cache: true },
    );
  }

  /**
   * Get settlements for a specific merchant.
   */
  async forMerchant(
    merchantId: string,
    filters?: Omit<SettlementFilters, 'merchantId'>,
  ): Promise<ApiResponse<Settlement[]>> {
    return this.client.get<Settlement[]>('/settlements', { ...filters, merchantId });
  }

  /**
   * Trigger a manual settlement run (requires elevated permissions).
   */
  async trigger(merchantId: string): Promise<ApiResponse<Settlement>> {
    return this.client.post<Settlement>('/settlements/trigger', { merchantId });
  }

  /**
   * Download settlement report as CSV (returns signed download URL).
   */
  async exportCsv(
    startDate: string,
    endDate: string,
  ): Promise<ApiResponse<{ url: string; expiresAt: string }>> {
    return this.client.post('/settlements/export', { startDate, endDate, format: 'csv' });
  }
}
