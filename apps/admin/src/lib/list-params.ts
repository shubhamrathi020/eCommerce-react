import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

/** URL-backed list state (filters, sort, page) so admin lists can be bookmarked and survive refresh. */
export function useListParams() {
  const [params, setParams] = useSearchParams();
  return {
    str: (name: string): string | undefined => params.get(name) || undefined,
    num: (name: string, fallback: number): number => {
      const n = Number.parseInt(params.get(name) ?? '', 10);
      return Number.isFinite(n) && n > 0 ? n : fallback;
    },
    /** Merges changes into the URL; `null` clears a key. Resets to page 1 unless `keepPage`. */
    patch: useCallback(
      (changes: Record<string, string | null>, keepPage = false): void => {
        setParams((prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries({ ...changes, ...(keepPage ? {} : { page: null }) })) {
            if (value === null || value === '') next.delete(key);
            else next.set(key, value);
          }
          return next;
        });
      },
      [setParams],
    ),
  };
}

/** Rupees typed by a person (may include decimals) to paise; NaN-safe. */
export function rupeesToPaise(text: string | number | null | undefined): number | undefined {
  if (text === null || text === undefined || String(text).trim() === '') return undefined;
  const n = Number(String(text).replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
}

export function paiseToRupees(paise: number | undefined): string {
  return paise === undefined ? '' : String(Math.round(paise) / 100);
}
