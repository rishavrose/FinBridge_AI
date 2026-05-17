import type { HttpClient } from '../client/index.js';
import type {
  ApiResponse,
  Transaction,
  TransactionFilters,
  PaginationMeta,
} from '../types/index.js';

/**
 * Transactions module — query, inspect, and reconcile financial transactions.
 */
export class TransactionsModule {
  constructor(private readonly client: HttpClient) {}

  /**
   * List transactions with optional filters.
   */
  async list(
    filters?: TransactionFilters,
  ): Promise<ApiResponse<Transaction[]> & { meta: PaginationMeta }> {
    return this.client.get<Transaction[]>(
      '/transactions',
      filters as Record<string, unknown>,
    ) as Promise<ApiResponse<Transaction[]> & { meta: PaginationMeta }>;
  }

  /**
   * Retrieve a single transaction by ID.
   */
  async get(transactionId: string): Promise<ApiResponse<Transaction>> {
    return this.client.get<Transaction>(
      `/transactions/${transactionId}`,
      undefined,
      { cache: true },
    );
  }

  /**
   * Fetch all failed transactions.
   */
  async failed(filters?: Omit<TransactionFilters, 'status'>): Promise<ApiResponse<Transaction[]>> {
    return this.client.get<Transaction[]>('/transactions', {
      ...filters,
      status: 'failed',
    });
  }

  /**
   * Search transactions by reference number.
   */
  async findByReference(reference: string): Promise<ApiResponse<Transaction[]>> {
    return this.client.get<Transaction[]>('/transactions', { reference });
  }

  /**
   * Get transactions for a specific user.
   */
  async forUser(
    userId: string | number,
    filters?: Omit<TransactionFilters, 'userId'>,
  ): Promise<ApiResponse<Transaction[]>> {
    return this.client.get<Transaction[]>('/transactions', {
      ...filters,
      userId,
    });
  }

  /**
   * Reverse (refund) a completed transaction.
   */
  async reverse(transactionId: string, reason?: string): Promise<ApiResponse<Transaction>> {
    return this.client.post<Transaction>(`/transactions/${transactionId}/reverse`, { reason });
  }

  /**
   * Get a reconciliation report for a date range.
   */
  async reconcile(
    startDate: string,
    endDate: string,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return this.client.get('/transactions/reconcile', { startDate, endDate }, { cache: true });
  }
}
