import type { HttpClient } from '../client/index.js';
import type {
  ApiResponse,
  HealthStatus,
  MetricsData,
  AlertConfig,
} from '../types/index.js';

/**
 * Monitoring module — health checks, metrics, and alerts.
 */
export class MonitoringModule {
  constructor(private readonly client: HttpClient) {}

  /**
   * Get the current health status of all platform services.
   */
  async health(): Promise<ApiResponse<HealthStatus>> {
    return this.client.get<HealthStatus>('/health');
  }

  /**
   * Fetch real-time performance metrics.
   */
  async metrics(): Promise<ApiResponse<MetricsData>> {
    return this.client.get<MetricsData>('/monitoring/metrics');
  }

  /**
   * Get historical metrics for a time range.
   */
  async metricsHistory(
    startDate: string,
    endDate: string,
    resolution?: '1m' | '5m' | '1h' | '1d',
  ): Promise<ApiResponse<MetricsData[]>> {
    return this.client.get<MetricsData[]>(
      '/monitoring/metrics/history',
      { startDate, endDate, resolution },
      { cache: true },
    );
  }

  /**
   * List active alerts.
   */
  async alerts(): Promise<ApiResponse<AlertConfig[]>> {
    return this.client.get<AlertConfig[]>('/monitoring/alerts');
  }

  /**
   * Configure a new alert threshold.
   */
  async createAlert(config: AlertConfig): Promise<ApiResponse<AlertConfig & { id: string }>> {
    return this.client.post<AlertConfig & { id: string }>('/monitoring/alerts', config);
  }

  /**
   * Delete an alert by ID.
   */
  async deleteAlert(alertId: string): Promise<ApiResponse<void>> {
    return this.client.delete<void>(`/monitoring/alerts/${alertId}`);
  }

  /**
   * Get the current uptime percentage for the past 30 days.
   */
  async uptime(): Promise<ApiResponse<{ percentage: number; incidents: number }>> {
    return this.client.get('/monitoring/uptime', undefined, { cache: true });
  }
}
