import type { Observable } from 'rxjs';
import type {
  InventoryAlert,
  InventoryImportReport,
  InventoryQuery,
  InventoryRow,
  InventorySettings,
  MovementQuery,
  Paged,
  StockAdjustInput,
  StockLocation,
  StockMovement,
  StockTransferInput,
  VariantPolicy,
} from '@ecom/contracts';

/**
 * Staff-facing stock management. Reads need `product:read`; every change needs `inventory:write`,
 * is appended to the stock ledger and is recorded in the audit log.
 * Errors are `ApiException`s (`forbidden`, `validation`, `not_found`).
 */
export abstract class AdminInventoryApi {
  abstract overview(query: InventoryQuery): Observable<Paged<InventoryRow>>;
  abstract locations(): Observable<StockLocation[]>;
  /** The permanent ledger, newest first. */
  abstract movements(query: MovementQuery): Observable<Paged<StockMovement>>;
  /** Variants currently at or below their low-stock threshold (one alert each until replenished). */
  abstract alerts(): Observable<InventoryAlert[]>;
  abstract adjust(input: StockAdjustInput): Observable<void>;
  abstract transfer(input: StockTransferInput): Observable<void>;
  /** Low-stock threshold override and backorder flag for one variant. */
  abstract setPolicy(variantId: string, policy: VariantPolicy): Observable<void>;
  abstract settings(): Observable<InventorySettings>;
  abstract saveSettings(settings: InventorySettings): Observable<InventorySettings>;
  /** CSV text: `sku,product,location,on_hand` for every variant and location. */
  abstract exportCsv(): Observable<string>;
  /** Sets stock levels from CSV text. Bad rows are skipped and reported; good rows apply together. */
  abstract importCsv(csv: string): Observable<InventoryImportReport>;
}
