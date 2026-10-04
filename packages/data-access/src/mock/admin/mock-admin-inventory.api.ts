import { Injectable, inject } from '@shop/core';
import type {
  InventoryAlert,
  InventoryFilter,
  InventoryImportIssue,
  InventoryImportReport,
  InventoryQuery,
  InventoryRow,
  InventorySettings,
  MovementQuery,
  Paged,
  Product,
  StockAdjustInput,
  StockLocation,
  StockMovement,
  StockTransferInput,
  VariantPolicy,
} from '@ecom/contracts';
import { ApiException } from '@ecom/contracts';
import { AdminInventoryApi } from '../../lib/inventory.api';
import { LOCATIONS } from '../inventory-store';
import { createMockResponder } from '../mock-latency';
import { MockAdminState } from './admin-state';
import { loadProducts } from './mock-admin.api';

export const IMPORT_LIMITS = { maxRows: 5000, maxChars: 1_000_000 } as const;

/** Quotes a CSV cell and defuses spreadsheet formulas (a cell starting with = + - @ would otherwise run in Excel). */
export function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text) && typeof value === 'string') text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Minimal RFC 4180 reader: quoted cells, doubled quotes, CRLF or LF line ends. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const page = <T>(rows: T[], query: { page: number; pageSize: number }): Paged<T> => {
  const pageSize = Math.max(1, query.pageSize);
  const current = Math.min(Math.max(1, query.page), Math.max(1, Math.ceil(rows.length / pageSize)));
  return { total: rows.length, page: current, pageSize, items: rows.slice((current - 1) * pageSize, current * pageSize) };
};

const FILTERS: Record<InventoryFilter, (r: InventoryRow) => boolean> = {
  all: () => true,
  low: (r) => r.low,
  out: (r) => r.available <= 0,
  backorder: (r) => r.backorder,
};

@Injectable()
export class MockAdminInventoryApi extends AdminInventoryApi {
  private readonly respond = createMockResponder();
  private readonly state = inject(MockAdminState);

  private get store() {
    return this.state.inventory;
  }

  /** Products with their opening stock, the base the ledger is added to. */
  private async baselines(): Promise<Product[]> {
    return (await loadProducts(this.state)).map((e) => e.baseline);
  }

  private skuOf(products: Product[], variantId: string): string {
    return products.flatMap((p) => p.variants).find((v) => v.id === variantId)?.sku ?? variantId;
  }

  private locationName(id: string): string {
    return LOCATIONS.find((l) => l.id === id)?.name ?? id;
  }

  overview(query: InventoryQuery) {
    return this.respond.okAsync<Paged<InventoryRow>>(async () => {
      this.state.require('product:read');
      const q = query.q?.trim().toLowerCase();
      const rows = this.store
        .rows(await this.baselines())
        .filter((r) => FILTERS[query.filter](r) && (!q || `${r.title} ${r.sku}`.toLowerCase().includes(q)))
        .sort((a, b) => a.title.localeCompare(b.title) || a.sku.localeCompare(b.sku));
      return page(rows, query);
    });
  }

  locations() {
    return this.respond.okAsync<StockLocation[]>(async () => {
      this.state.require('product:read');
      return this.store.locations();
    });
  }

  movements(query: MovementQuery) {
    return this.respond.okAsync<Paged<StockMovement>>(async () => {
      this.state.require('product:read');
      const q = query.q?.trim().toLowerCase();
      const rows = this.store.movements().filter((m) => (!query.kind || m.kind === query.kind) && (!q || `${m.sku} ${m.title} ${m.reason} ${m.actor} ${m.orderId ?? ''}`.toLowerCase().includes(q)));
      return page(rows, query);
    });
  }

  alerts() {
    return this.respond.okAsync<InventoryAlert[]>(async () => {
      this.state.require('product:read');
      return this.store.alerts();
    });
  }

  adjust(input: StockAdjustInput) {
    return this.respond.okAsync<void>(async () => {
      const actor = this.state.require('inventory:write');
      const products = await this.baselines();
      this.store.adjust(input, products, actor.name);
      this.state.record('inventory.adjust', this.skuOf(products, input.variantId), `${input.kind} ${input.quantity} at ${this.locationName(input.locationId)} (${input.reason})`);
    });
  }

  transfer(input: StockTransferInput) {
    return this.respond.okAsync<void>(async () => {
      const actor = this.state.require('inventory:write');
      const products = await this.baselines();
      this.store.transfer(input, products, actor.name);
      this.state.record('inventory.transfer', this.skuOf(products, input.variantId), `${input.quantity} from ${this.locationName(input.fromLocationId)} to ${this.locationName(input.toLocationId)}`);
    });
  }

  setPolicy(variantId: string, policy: VariantPolicy) {
    return this.respond.okAsync<void>(async () => {
      this.state.require('inventory:write');
      const products = await this.baselines();
      this.store.setPolicy(variantId, policy, products);
      this.state.record('inventory.policy', this.skuOf(products, variantId), `Backorder ${policy.backorder ? 'on' : 'off'}${policy.threshold !== undefined ? `, threshold ${policy.threshold}` : ''}`);
    });
  }

  settings() {
    return this.respond.okAsync<InventorySettings>(async () => {
      this.state.require('product:read');
      return this.store.settings();
    });
  }

  saveSettings(settings: InventorySettings) {
    return this.respond.okAsync<InventorySettings>(async () => {
      this.state.require('inventory:write');
      this.store.saveSettings(settings, await this.baselines());
      this.state.record('inventory.settings', 'Inventory settings', `Reservation ${settings.reservationMinutes} min, low-stock threshold ${settings.lowStockThreshold}`);
      return this.store.settings();
    });
  }

  exportCsv() {
    return this.respond.okAsync<string>(async () => {
      this.state.require('product:read');
      const lines = ['sku,product,location,on_hand'];
      for (const r of this.store.rows(await this.baselines())) for (const loc of LOCATIONS) lines.push([csvCell(r.sku), csvCell(r.title), csvCell(loc.name), r.byLocation[loc.id]].join(','));
      return lines.join('\n');
    });
  }

  importCsv(csv: string) {
    return this.respond.okAsync<InventoryImportReport>(async () => {
      const actor = this.state.require('inventory:write');
      if (csv.length > IMPORT_LIMITS.maxChars) throw new ApiException('validation', 'That file is too large (1 MB at most).');
      const table = parseCsv(csv);
      const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
      const col = { sku: header.indexOf('sku'), location: header.indexOf('location'), onHand: header.indexOf('on_hand') };
      if (col.sku < 0 || col.location < 0 || col.onHand < 0) throw new ApiException('validation', 'The file needs the columns: sku, location, on_hand.');
      if (table.length - 1 > IMPORT_LIMITS.maxRows) throw new ApiException('validation', `Too many rows (${IMPORT_LIMITS.maxRows.toLocaleString('en-IN')} at most per file).`);

      const products = await this.baselines();
      const variants = new Map(products.flatMap((p) => p.variants).map((v) => [v.sku, v.id]));
      const skipped: InventoryImportIssue[] = [];
      const good: { variantId: string; locationId: string; target: number }[] = [];
      const seen = new Set<string>();
      table.slice(1).forEach((cells, i) => {
        const line = i + 2;
        // A leading apostrophe is how the export defuses spreadsheet formulas; it is not part of the SKU.
        const sku = (cells[col.sku] ?? '').trim().replace(/^'/, '');
        const variantId = variants.get(sku);
        const location = LOCATIONS.find((l) => [l.id, l.name].some((x) => x.toLowerCase() === (cells[col.location] ?? '').trim().toLowerCase()));
        const raw = (cells[col.onHand] ?? '').trim();
        let message = '';
        if (!sku) message = 'SKU is missing';
        else if (!variantId) message = 'Unknown SKU';
        else if (!location) message = 'Unknown location';
        else if (!/^\d{1,7}$/.test(raw)) message = 'on_hand must be a whole number, 0 or more';
        else if (seen.has(`${sku}|${location.id}`)) message = 'Duplicate row for this SKU and location';
        if (message || !variantId || !location) {
          skipped.push({ line, sku, message });
          return;
        }
        seen.add(`${sku}|${location.id}`);
        good.push({ variantId, locationId: location.id, target: Number(raw) });
      });

      // Good rows apply together in one save; the bad ones are reported back.
      const changed = good.length ? this.store.applyLevels(good, products, actor.name) : 0;
      this.state.record('inventory.import', 'Stock import', `${good.length} row(s) read, ${changed} changed, ${skipped.length} skipped`);
      const errorCsv = skipped.length ? ['line,sku,error', ...skipped.map((s) => [s.line, csvCell(s.sku), csvCell(s.message)].join(','))].join('\n') : '';
      return { applied: good.length, skipped, errorCsv };
    });
  }
}
