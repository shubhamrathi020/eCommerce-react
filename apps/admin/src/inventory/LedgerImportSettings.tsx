import { useEffect, useState } from 'react';
import { firstValueFrom } from 'rxjs';
import { ApiException, type InventoryImportReport, type MovementKind } from '@ecom/contracts';
import { SeoService, ToastService, useDate, useResource, useService } from '@shop/core';
import { AdminInventoryApi } from '@shop/data-access';
import { Badge, Button, EmptyState, ErrorState, Pagination, Skeleton, TextField, cx, inputClass, useForm } from '@shop/ui';
import { downloadText } from '../lib/download';
import { useListParams } from '../lib/list-params';

const PAGE_SIZE = 25;
const KINDS: MovementKind[] = ['receive', 'sale', 'cancellation', 'return', 'damage', 'correction', 'transfer'];

/** Read-only stock ledger: every movement ever recorded, newest first. Entries can never be edited or removed. */
export function LedgerPage() {
  const api = useService(AdminInventoryApi);
  const seo = useService(SeoService);
  const date = useDate();
  const list = useListParams();
  const q = list.str('q');
  const kind = list.str('kind') as MovementKind | undefined;
  const pageNo = list.num('page', 1);
  const [draft, setDraft] = useState(q ?? '');
  useEffect(() => setDraft(q ?? ''), [q]);
  useEffect(() => {
    seo.set({ title: 'Stock ledger', noindex: true });
  }, [seo]);
  const resource = useResource(() => api.movements({ q, kind, page: pageNo, pageSize: PAGE_SIZE }), [api, q, kind, pageNo]);
  const locations = useResource(() => api.locations(), [api]).value ?? [];
  const data = resource.value;
  const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? id;
  /** `order_placed` becomes "Order placed". */
  const reasonText = (reason: string) => {
    const text = reason.replace(/_/g, ' ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  };

  return (
    <>
      <p className="mb-4 text-sm text-text-muted">Every stock change is appended here with who made it and why. Entries are permanent: a mistake is fixed with a new correcting entry.</p>
      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        role="search"
        aria-label="Filter the ledger"
        onSubmit={(e) => {
          e.preventDefault();
          list.patch({ q: draft.trim() || null });
        }}
      >
        <div>
          <label htmlFor="lq" className="mb-1 block text-sm font-medium">
            Search
          </label>
          <input id="lq" className={inputClass} type="search" placeholder="SKU, product, reason, person or order" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </div>
        <div>
          <label htmlFor="lk" className="mb-1 block text-sm font-medium">
            Kind
          </label>
          <select id="lk" className={inputClass} value={kind ?? ''} onChange={(e) => list.patch({ kind: e.target.value || null })}>
            <option value="">All kinds</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {data ? (
        data.items.length === 0 ? (
          <EmptyState title="No movements yet" description="Sales, cancellations and adjustments will appear here." />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[52rem] text-start text-sm">
                <caption className="sr-only">Stock movements</caption>
                <thead className="bg-surface-alt">
                  <tr>
                    <th scope="col" className="p-2 text-start">When</th>
                    <th scope="col" className="p-2 text-start">Kind</th>
                    <th scope="col" className="p-2 text-start">Product</th>
                    <th scope="col" className="p-2 text-start">Location</th>
                    <th scope="col" className="p-2 text-end">Units</th>
                    <th scope="col" className="p-2 text-start">Reason</th>
                    <th scope="col" className="p-2 text-start">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.items.map((m) => (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap p-2 text-text-muted">{date(m.at, 'd MMM y, h:mm a')}</td>
                      <td className="p-2">
                        <Badge tone={m.quantity < 0 ? 'warning' : 'success'}>{m.kind}</Badge>
                      </td>
                      <td className="p-2">
                        <span className="block max-w-xs truncate" title={m.title}>
                          {m.title}
                        </span>
                        <span className="text-xs text-text-muted">{m.sku}</span>
                      </td>
                      <td className="p-2">{locationName(m.locationId)}</td>
                      <td className={cx('p-2 text-end font-medium', m.quantity < 0 && 'text-danger')}>
                        {m.quantity > 0 ? '+' : ''}
                        {m.quantity}
                      </td>
                      <td className="p-2">
                        {reasonText(m.reason)}
                        {m.orderId && <span className="block text-xs text-text-muted">Order {m.orderId}</span>}
                        {m.note && <span className="block text-xs text-text-muted">{m.note}</span>}
                      </td>
                      <td className="p-2 text-text-muted">{m.actor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-sm text-text-muted" aria-live="polite">
              {data.total} movements
            </p>
            <div className="mt-4">
              <Pagination page={data.page} pageSize={data.pageSize} total={data.total} />
            </div>
          </>
        )
      ) : resource.status === 'error' ? (
        <ErrorState onRetry={resource.reload} />
      ) : (
        <Skeleton className="h-48" />
      )}
    </>
  );
}

/** Spreadsheet round trip: export current levels, edit them, import back with a clear report of skipped rows. */
export function ImportPage() {
  const api = useService(AdminInventoryApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const [text, setText] = useState('');
  const [report, setReport] = useState<InventoryImportReport | null>(null);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    seo.set({ title: 'Stock import and export', noindex: true });
  }, [seo]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      downloadText('stock.csv', await firstValueFrom(api.exportCsv()));
    } catch (e) {
      toast.error(e instanceof ApiException ? e.message : 'The export failed.');
    } finally {
      setExporting(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_000_000) {
      setError('That file is too large (1 MB at most).');
      return;
    }
    setError('');
    setText(await file.text());
  };

  const runImport = async () => {
    setError('');
    setReport(null);
    if (!text.trim()) {
      setError('Choose a file or paste some CSV text first.');
      return;
    }
    setImporting(true);
    try {
      const r = await firstValueFrom(api.importCsv(text));
      setReport(r);
      toast.success(`${r.applied} row(s) applied`);
    } catch (e) {
      setError(e instanceof ApiException ? e.message : 'The import failed.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <section className="mb-8" aria-labelledby="ex-h">
        <h2 id="ex-h" className="mb-1 text-xl font-semibold">
          Export
        </h2>
        <p className="mb-3 text-sm text-text-muted">Download the current stock of every variant and location as a CSV file with the columns sku, product, location and on_hand.</p>
        <Button type="button" variant="secondary" loading={exporting} onClick={() => void exportCsv()}>
          Download stock CSV
        </Button>
      </section>

      <section aria-labelledby="im-h">
        <h2 id="im-h" className="mb-1 text-xl font-semibold">
          Import
        </h2>
        <p className="mb-3 text-sm text-text-muted">
          Set stock levels from a CSV file. Needed columns: sku, location (a location name) and on_hand (units to have there). Bad rows are skipped and listed; all good rows apply together. Each change becomes a correction in the ledger.
        </p>
        {error && (
          <p className="mb-3 rounded-md border border-danger p-3 text-sm" role="alert">
            {error}
          </p>
        )}
        <div className="mb-3">
          <label htmlFor="file" className="mb-1 block text-sm font-medium">
            CSV file
          </label>
          <input id="file" className={inputClass} type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e)} />
        </div>
        <div className="mb-3">
          <label htmlFor="csv" className="mb-1 block text-sm font-medium">
            Or paste CSV text
          </label>
          <textarea id="csv" className={cx(inputClass, 'font-mono text-xs')} rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="sku,location,on_hand" />
        </div>
        <Button type="button" loading={importing} onClick={() => void runImport()}>
          Import stock levels
        </Button>

        {report && (
          <div className="mt-6 rounded-lg border border-border p-4" role="status" aria-live="polite">
            <p className="font-medium">
              {report.applied} row(s) applied, {report.skipped.length} skipped.
            </p>
            {report.skipped.length > 0 && (
              <>
                <div className="mt-3 overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[28rem] text-start text-sm">
                    <caption className="sr-only">Skipped rows</caption>
                    <thead className="bg-surface-alt">
                      <tr>
                        <th scope="col" className="p-2 text-start">Line</th>
                        <th scope="col" className="p-2 text-start">SKU</th>
                        <th scope="col" className="p-2 text-start">Problem</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {report.skipped.slice(0, 50).map((s) => (
                        <tr key={s.line}>
                          <td className="p-2">{s.line}</td>
                          <td className="p-2 font-mono text-xs">{s.sku}</td>
                          <td className="p-2">{s.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {report.skipped.length > 50 && <p className="mt-1 text-sm text-text-muted">Showing the first 50. The error report has all of them.</p>}
                <Button className="mt-3" type="button" variant="secondary" onClick={() => downloadText('stock-import-errors.csv', report.errorCsv)}>
                  Download error report
                </Button>
              </>
            )}
          </div>
        )}
      </section>
    </>
  );
}

/** Reservation timeout and the default low-stock threshold. */
export function InventorySettingsPage() {
  const api = useService(AdminInventoryApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const settings = useResource(() => api.settings(), [api]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const form = useForm({ reservationMinutes: '15', lowStockThreshold: '5' });
  useEffect(() => {
    seo.set({ title: 'Inventory settings', noindex: true });
  }, [seo]);
  useEffect(() => {
    const s = settings.value;
    if (s) form.reset({ reservationMinutes: String(s.reservationMinutes), lowStockThreshold: String(s.lowStockThreshold) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.value]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setErrors({});
    const number = (text: string) => (text.trim() === '' ? Number.NaN : Number(text));
    setSaving(true);
    try {
      await firstValueFrom(api.saveSettings({ reservationMinutes: number(form.values.reservationMinutes), lowStockThreshold: number(form.values.lowStockThreshold) }));
      toast.success('Inventory settings saved');
    } catch (err) {
      if (err instanceof ApiException) {
        setFormError(err.message);
        setErrors(err.fields ?? {});
      } else {
        setFormError('The settings could not be saved.');
      }
    } finally {
      setSaving(false);
    }
  };

  // Server field errors are shown through the form helper so they clear on typing.
  useEffect(() => form.setServerErrors(errors), [errors]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <h2 className="mb-1 text-xl font-semibold">Inventory settings</h2>
      <p className="mb-4 text-sm text-text-muted">
        Unpaid online orders hold their stock for the reservation time, then release it. A variant is low when its available units reach the threshold; variants can override the default on the Stock tab.
      </p>
      {settings.value ? (
        <>
          {formError && (
            <p className="mb-3 rounded-md border border-danger p-3 text-sm" role="alert">
              {formError}
            </p>
          )}
          <form onSubmit={save} noValidate className="grid max-w-xl gap-4 md:grid-cols-2" aria-label="Inventory settings">
            <TextField form={form} name="reservationMinutes" label="Reservation time (minutes)" hint="1 to 1,440" inputMode="numeric" />
            <TextField form={form} name="lowStockThreshold" label="Default low-stock threshold (units)" hint="0 to 1,000" inputMode="numeric" />
            <div className="md:col-span-2">
              <Button type="submit" loading={saving}>
                Save settings
              </Button>
            </div>
          </form>
        </>
      ) : (
        <Skeleton className="h-32" />
      )}
    </>
  );
}
