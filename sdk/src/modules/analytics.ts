import type { HttpClient } from '../client/index.js';
import type {
  ApiResponse,
  AnalyticsQuery,
  AnalyticsResult,
  SummaryStats,
} from '../types/index.js';

/**
 * Analytics module — metrics, time-series, and summary reporting.
 */
export class AnalyticsModule {
  constructor(private readonly client: HttpClient) {}

  /**
   * Run a custom analytics query.
   */
  async query(query: AnalyticsQuery): Promise<ApiResponse<AnalyticsResult>> {
    return this.client.post<AnalyticsResult>('/analytics/query', query);
  }

  /**
   * Get a high-level summary of transaction and payout activity.
   */
  async summary(startDate: string, endDate: string): Promise<ApiResponse<SummaryStats>> {
    return this.client.get<SummaryStats>(
      '/analytics/summary',
      { startDate, endDate },
      { cache: true },
    );
  }

  /**
   * Daily aggregated metrics for a date range.
   */
  async daily(
    startDate: string,
    endDate: string,
    currency?: string,
  ): Promise<ApiResponse<AnalyticsResult>> {
    return this.client.get<AnalyticsResult>(
      '/analytics/daily',
      { startDate, endDate, currency },
      { cache: true },
    );
  }

  /**
   * Revenue breakdown by channel / method.
   */
  async revenueBreakdown(
    startDate: string,
    endDate: string,
  ): Promise<ApiResponse<AnalyticsResult>> {
    return this.client.get<AnalyticsResult>(
      '/analytics/revenue/breakdown',
      { startDate, endDate },
      { cache: true },
    );
  }

  /**
   * Failure analysis — reasons and trends for failed transactions.
   */
  async failureAnalysis(
    startDate: string,
    endDate: string,
  ): Promise<ApiResponse<AnalyticsResult>> {
    return this.client.get<AnalyticsResult>(
      '/analytics/failures',
      { startDate, endDate },
      { cache: true },
    );
  }

  /**
   * Conversion funnel metrics.
   */
  async funnel(startDate: string, endDate: string): Promise<ApiResponse<AnalyticsResult>> {
    return this.client.get<AnalyticsResult>(
      '/analytics/funnel',
      { startDate, endDate },
      { cache: true },
    );
  }
}
