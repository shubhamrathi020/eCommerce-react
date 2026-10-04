import { Injectable, inject } from '@shop/core';
import { STORAGE } from '@shop/core';
import type { CampaignRow, CohortRow, FunnelStep, Paged, ProductPerformance, ReportKey, ReportSchedule, ScheduleInput, SearchReport } from '@ecom/contracts';
import { ApiException, FREQUENCY_MS, REPORT_DAYS, REPORT_LABEL, campaignReport, cohortTable, funnel, productPerformance, searchReport, sortPerformance, toCsv } from '@ecom/contracts';
import { AdminAnalyticsApi, type ProductReportQuery } from '../../lib/analytics.api';
import { loadCatalogData } from '../catalog-data';
import { MockEventStore } from '../event-store';
import { createMockResponder } from '../mock-latency';
import { MockMailbox } from '../mock-mailbox';
import { MockAdminState } from './admin-state';

const SCHEDULE_KEY = 'ecom.mock.report-schedules.v1';
const MAX_SCHEDULES = 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const rupees = (paise: number) => (paise / 100).toFixed(2);

/**
 * Aggregates events into reports (BRD 16). Results are cached per report, period and data version, because computing them
 * walks every event; the cache key includes how many events exist, so new events show up straight away.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsReports {
  private readonly events = inject(MockEventStore);
  private readonly cache = new Map<string, unknown>();

  private async source() {
    const { products } = await loadCatalogData();
    const now = Date.now();
    const events = this.events.all(products, now);
    return { products, events, now, version: `${Math.floor(now / 60_000)}:${events.length}` };
  }

  private async cached<T>(key: string, build: (s: Awaited<ReturnType<AnalyticsReports['source']>>) => T): Promise<T> {
    const s = await this.source();
    const full = `${s.version}|${key}`;
    if (!this.cache.has(full)) {
      if (this.cache.size > 50) this.cache.clear();
      this.cache.set(full, build(s));
    }
    return this.cache.get(full) as T;
  }

  funnel(days: number): Promise<FunnelStep[]> {
    return this.cached(`funnel|${days}`, (s) => funnel(s.events, s.now, days));
  }

  products(days: number): Promise<ProductPerformance[]> {
    return this.cached(`products|${days}`, (s) => productPerformance(s.events, s.products, s.now, days));
  }

  search(days: number): Promise<SearchReport> {
    return this.cached(`search|${days}`, (s) => searchReport(s.events, s.now, days, 50));
  }

  campaigns(days: number): Promise<CampaignRow[]> {
    return this.cached(`campaigns|${days}`, (s) => campaignReport(s.events, s.now, days));
  }

  cohorts(): Promise<CohortRow[]> {
    return this.cached('cohorts', (s) => cohortTable(s.events, s.now));
  }

  /** A whole report as CSV. */
  async csv(report: ReportKey, days: number): Promise<string> {
    switch (report) {
      case 'funnel':
        return toCsv(['Step', 'Visitors', 'Drop-off from previous step (%)', 'Share of first step (%)'], (await this.funnel(days)).map((r) => [r.label, r.visitors, r.dropOffPercent ?? '', r.ofFirstPercent]));
      case 'products':
        return toCsv(
          ['Product ID', 'Product', 'Views', 'Added to cart', 'Add-to-cart rate (%)', 'Units sold', 'Orders', 'Item revenue (INR)', 'In stock', 'Sell-through (%)'],
          sortPerformance(await this.products(days), 'units', 'desc').map((r) => [r.productId, r.title, r.views, r.adds, r.addRatePercent, r.units, r.orders, rupees(r.revenue), r.stock, r.sellThroughPercent]),
        );
      case 'search': {
        const s = await this.search(days);
        const row = (kind: string) => (r: SearchReport['top'][number]) => [kind, r.term, r.searches, r.avgResults, r.clicks, r.clickThroughPercent];
        return toCsv(['List', 'Search term', 'Searches', 'Average results', 'Result clicks', 'Click-through (%)'], [...s.top.map(row('Top')), ...s.zeroResults.map(row('No results'))]);
      }
      case 'campaigns':
        return toCsv(['Campaign (source / medium / campaign)', 'Orders, first touch', 'Orders, last touch', 'Item revenue, last touch (INR)'], (await this.campaigns(days)).map((r) => [r.campaign, r.firstTouchOrders, r.lastTouchOrders, rupees(r.lastTouchRevenue)]));
      case 'cohorts': {
        const rows = await this.cohorts();
        return toCsv(['Cohort (week starting)', 'Buyers', ...rows.map((_, i) => `Week ${i} (%)`)], rows.map((r) => [r.weekStart, r.size, ...r.retentionPercent.map((p) => (p === null ? '' : p))]));
      }
    }
  }
}

/** Reporting for staff. All figures are aggregates over anonymous events. */
@Injectable()
export class MockAdminAnalyticsApi extends AdminAnalyticsApi {
  private readonly respond = createMockResponder();
  private readonly state = inject(MockAdminState);
  private readonly reports = inject(AnalyticsReports);
  private readonly storage = inject(STORAGE);
  private readonly mailbox = inject(MockMailbox);

  private days(value: number): number {
    return (REPORT_DAYS as readonly number[]).includes(value) ? value : 30;
  }

  funnel(days: number) {
    return this.respond.okAsync<FunnelStep[]>(async () => {
      this.state.require('analytics:read');
      return this.reports.funnel(this.days(days));
    });
  }

  products(query: ProductReportQuery) {
    return this.respond.okAsync<Paged<ProductPerformance>>(async () => {
      this.state.require('analytics:read');
      const rows = sortPerformance(await this.reports.products(this.days(query.days)), query.sort, query.dir);
      const pageSize = Math.max(1, query.pageSize);
      const page = Math.min(Math.max(1, query.page), Math.max(1, Math.ceil(rows.length / pageSize)));
      return { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize };
    });
  }

  search(days: number) {
    return this.respond.okAsync<SearchReport>(async () => {
      this.state.require('analytics:read');
      return this.reports.search(this.days(days));
    });
  }

  campaigns(days: number) {
    return this.respond.okAsync<CampaignRow[]>(async () => {
      this.state.require('analytics:read');
      return this.reports.campaigns(this.days(days));
    });
  }

  cohorts() {
    return this.respond.okAsync<CohortRow[]>(async () => {
      this.state.require('analytics:read');
      return this.reports.cohorts();
    });
  }

  exportCsv(report: ReportKey, days: number) {
    return this.respond.okAsync<string>(async () => {
      this.state.require('analytics:read');
      if (!(report in REPORT_LABEL)) throw new ApiException('validation', 'Unknown report.');
      this.state.record('analytics.export', report, `${this.days(days)} days`);
      return this.reports.csv(report, this.days(days));
    });
  }

  // ---------- scheduled reports (AN-06) ----------

  private readSchedules(): ReportSchedule[] {
    try {
      const raw = this.storage.getItem(SCHEDULE_KEY);
      return raw ? (JSON.parse(raw) as ReportSchedule[]) : [];
    } catch {
      return [];
    }
  }

  private writeSchedules(list: ReportSchedule[]): void {
    try {
      this.storage.setItem(SCHEDULE_KEY, JSON.stringify(list));
    } catch {
      // Storage full or blocked.
    }
  }

  /** Mails one report to the schedule's recipient and returns the schedule with its next run moved forward. */
  private async deliver(schedule: ReportSchedule, now: number): Promise<ReportSchedule> {
    const csv = await this.reports.csv(schedule.report, schedule.days);
    this.mailbox.send({
      to: schedule.recipient,
      subject: `Scheduled report: ${REPORT_LABEL[schedule.report]} (last ${schedule.days} days)`,
      body: `Your ${schedule.frequency} report is below. Figures are aggregates over anonymous activity.\r\n\r\n${csv}`,
    });
    return { ...schedule, lastRunAt: new Date(now).toISOString(), nextRunAt: new Date(now + FREQUENCY_MS[schedule.frequency]).toISOString() };
  }

  /** Delivers every schedule that has come due. In the real backend this is a scheduled job (BRD 23). */
  async runDue(now = Date.now()): Promise<void> {
    const list = this.readSchedules();
    let changed = false;
    for (let i = 0; i < list.length; i++) {
      if (new Date(list[i].nextRunAt).getTime() > now) continue;
      list[i] = await this.deliver(list[i], now);
      changed = true;
    }
    if (changed) this.writeSchedules(list);
  }

  schedules() {
    return this.respond.okAsync<ReportSchedule[]>(async () => {
      this.state.require('analytics:read');
      await this.runDue();
      return this.readSchedules();
    });
  }

  createSchedule(input: ScheduleInput) {
    return this.respond.okAsync<ReportSchedule>(async () => {
      const actor = this.state.require('analytics:read');
      const fields: Record<string, string> = {};
      if (!(input.report in REPORT_LABEL)) fields['report'] = 'Choose a report';
      if (!(REPORT_DAYS as readonly number[]).includes(input.days)) fields['days'] = 'Choose 7, 30 or 90 days';
      if (input.frequency !== 'daily' && input.frequency !== 'weekly') fields['frequency'] = 'Choose daily or weekly';
      if (!EMAIL.test(input.recipient.trim())) fields['recipient'] = 'Enter a valid email address';
      const list = this.readSchedules();
      if (list.length >= MAX_SCHEDULES) throw new ApiException('validation', `You can keep at most ${MAX_SCHEDULES} scheduled reports.`);
      if (Object.keys(fields).length) throw new ApiException('validation', 'Please check the highlighted fields.', fields);
      const now = Date.now();
      const schedule: ReportSchedule = {
        id: `sch_${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`,
        report: input.report,
        days: input.days,
        frequency: input.frequency,
        recipient: input.recipient.trim(),
        createdBy: actor.name,
        createdAt: new Date(now).toISOString(),
        nextRunAt: new Date(now + FREQUENCY_MS[input.frequency]).toISOString(),
      };
      this.writeSchedules([...list, schedule]);
      this.state.record('analytics.schedule', schedule.id, `${schedule.report} ${schedule.frequency} to ${schedule.recipient}`);
      return schedule;
    });
  }

  removeSchedule(id: string) {
    return this.respond.okAsync<void>(async () => {
      this.state.require('analytics:read');
      const list = this.readSchedules();
      if (!list.some((s) => s.id === id)) throw new ApiException('not_found', 'Schedule not found');
      this.writeSchedules(list.filter((s) => s.id !== id));
      this.state.record('analytics.unschedule', id, '');
    });
  }

  sendNow(id: string) {
    return this.respond.okAsync<ReportSchedule>(async () => {
      this.state.require('analytics:read');
      const list = this.readSchedules();
      const index = list.findIndex((s) => s.id === id);
      if (index < 0) throw new ApiException('not_found', 'Schedule not found');
      list[index] = await this.deliver(list[index], Date.now());
      this.writeSchedules(list);
      this.state.record('analytics.send', id, list[index].report);
      return list[index];
    });
  }
}
