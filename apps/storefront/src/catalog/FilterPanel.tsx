import { useEffect, useState } from 'react';
import type { Facet } from '@ecom/contracts';
import { Button, Checkbox, inputClass } from '@shop/ui';

export interface PriceRange {
  /** Rupees; undefined means open-ended. */
  min?: number;
  max?: number;
}

const COLLAPSED_COUNT = 6;

const toRupeeText = (paise: number | undefined): string => (paise === undefined ? '' : String(Math.round(paise / 100)));

/** Facet checkboxes plus a price range. Emits changes; the page owns the URL state. */
export function FilterPanel({
  facets,
  priceBounds,
  priceMin,
  priceMax,
  idPrefix = 'f',
  onOptionToggle,
  onPrice,
}: {
  facets: Facet[];
  /** Bounds in paise. */
  priceBounds: { min: number; max: number };
  /** Current price selection in paise. */
  priceMin?: number;
  priceMax?: number;
  /** The panel is rendered twice (sidebar and drawer), so ids need a prefix. */
  idPrefix?: string;
  onOptionToggle: (key: string, value: string) => void;
  onPrice: (range: PriceRange) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Text boxes follow the applied price, but stay editable until applied.
  const [minText, setMinText] = useState(toRupeeText(priceMin));
  const [maxText, setMaxText] = useState(toRupeeText(priceMax));
  useEffect(() => setMinText(toRupeeText(priceMin)), [priceMin]);
  useEffect(() => setMaxText(toRupeeText(priceMax)), [priceMax]);

  const toggleExpanded = (key: string) =>
    setExpanded((set) => {
      const next = new Set(set);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const parse = (text: string): number | undefined => {
    const v = Number.parseInt(text, 10);
    return Number.isFinite(v) && v >= 0 ? v : undefined;
  };

  return (
    <form
      className="space-y-5"
      aria-label="Filters"
      onSubmit={(e) => {
        e.preventDefault();
        onPrice({ min: parse(minText), max: parse(maxText) });
      }}
    >
      <fieldset className="border-b border-border pb-4">
        <legend className="mb-2 font-semibold">Price (₹)</legend>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor={`${idPrefix}-price-min`}>
            Minimum price
          </label>
          <input id={`${idPrefix}-price-min`} className={inputClass} type="number" inputMode="numeric" min="0" placeholder="Min" name="min" value={minText} onChange={(e) => setMinText(e.target.value)} />
          <span aria-hidden="true">–</span>
          <label className="sr-only" htmlFor={`${idPrefix}-price-max`}>
            Maximum price
          </label>
          <input id={`${idPrefix}-price-max`} className={inputClass} type="number" inputMode="numeric" min="0" placeholder="Max" name="max" value={maxText} onChange={(e) => setMaxText(e.target.value)} />
        </div>
        <p className="mt-1 text-xs text-text-muted">
          Available: ₹{Math.floor(priceBounds.min / 100).toLocaleString('en-IN')} to ₹{Math.ceil(priceBounds.max / 100).toLocaleString('en-IN')}
        </p>
        <Button size="sm" variant="secondary" type="submit" className="mt-2">
          Apply
        </Button>
      </fieldset>

      {facets.map((facet) => {
        const isOpen = expanded.has(facet.key);
        return (
          <fieldset key={facet.key} className="border-b border-border pb-3">
            <legend className="mb-1 font-semibold">{facet.label}</legend>
            {(isOpen ? facet.options : facet.options.slice(0, COLLAPSED_COUNT)).map((option) => (
              <Checkbox key={option.value} checked={option.selected} count={option.count} onChange={() => onOptionToggle(facet.key, option.value)}>
                {option.label}
              </Checkbox>
            ))}
            {facet.options.length > COLLAPSED_COUNT && (
              <button type="button" className="min-h-11 text-sm font-medium text-primary hover:underline" aria-expanded={isOpen} onClick={() => toggleExpanded(facet.key)}>
                {isOpen ? 'Show less' : `Show all ${facet.options.length}`}
              </button>
            )}
          </fieldset>
        );
      })}
    </form>
  );
}
