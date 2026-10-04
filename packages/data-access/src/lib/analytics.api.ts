import type { Observable } from 'rxjs';
import type { CampaignRow, CohortRow, FunnelStep, Paged, ProductPerformance, ProductSort, ReportKey, ReportSchedule, ScheduleInput, SearchReport } from '@ecom/contracts';

export interface ProductReportQuery {
  days: number;
  sort: ProductSort;
  dir: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

/**
 * Staff reporting (BRD 16). Needs `analytics:read`. Everything returned is an aggregate over anonymous events: there is no
 * call that returns one shopper's activity. Large tables paginate and results are cached for a short time.
 */
export abstract class AdminAnalyticsApi {
  abstract funnel(days: number): Observable<FunnelStep[]>;
  abstract products(query: ProductReportQuery): Observable<Paged<ProductPerformance>>;
  abstract search(days: number): Observable<SearchReport>;
  abstract campaigns(days: number): Observable<CampaignRow[]>;
  abstract cohorts(): Observable<CohortRow[]>;
  /** A CSV of the whole report (not just the current page), safe to open in a spreadsheet. */
  abstract exportCsv(report: ReportKey, days: number): Observable<string>;
  /** Saved schedules. Any schedule that has come due is delivered to the recipient's mailbox first. */
  abstract schedules(): Observable<ReportSchedule[]>;
  abstract createSchedule(input: ScheduleInput): Observable<ReportSchedule>;
  abstract removeSchedule(id: string): Observable<void>;
  /** Delivers a schedule's report right now. */
  abstract sendNow(id: string): Observable<ReportSchedule>;
}
