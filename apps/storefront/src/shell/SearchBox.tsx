import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { firstValueFrom } from 'rxjs';
import type { Money, SearchSuggestions } from '@ecom/contracts';
import { AnalyticsService, RecentSearchesStore, useMoney, useService, useSignal, useT } from '@shop/core';
import { SearchApi } from '@shop/data-access';
import { Icon, cx } from '@shop/ui';

type OptionKind = 'recent' | 'query' | 'product' | 'category' | 'brand';

interface SearchOption {
  id: string;
  kind: OptionKind;
  label: string;
  sub?: string;
  /** Path for navigation options; queries run a search instead. */
  link?: string;
  image?: { url: string; width: number; height: number };
  price?: Money;
}

const DEBOUNCE_MS = 150;

/** Search field with autocomplete (ARIA combobox). Arrow keys move, Enter selects, Escape closes. */
export function SearchBox({ idPrefix, placeholder }: { idPrefix: string; placeholder?: string }) {
  const t = useT();
  const money = useMoney();
  const navigate = useNavigate();
  const api = useService(SearchApi);
  const recentStore = useService(RecentSearchesStore);
  const analytics = useService(AnalyticsService);
  const recent = useSignal(recentStore.ids);

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [suggestions, setSuggestions] = useState<{ for: string; value: SearchSuggestions } | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    let current = true;
    firstValueFrom(api.suggest(debounced))
      .then((value) => current && setSuggestions({ for: debounced, value }))
      .catch(() => current && setSuggestions(null));
    return () => {
      current = false;
    };
  }, [api, debounced]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  const options = useMemo<SearchOption[]>(() => {
    const out: SearchOption[] = [];
    const q = query.trim();
    if (!q) for (const term of recent) out.push({ id: `recent-${term}`, kind: 'recent', label: term });
    // Ignore a stale answer that belongs to an older query.
    if (!suggestions || suggestions.for !== q) return out;
    const s = suggestions.value;
    for (const term of s.queries) if (!out.some((o) => o.label.toLowerCase() === term.toLowerCase())) out.push({ id: `q-${term}`, kind: 'query', label: term });
    for (const p of s.products) out.push({ id: `p-${p.id}`, kind: 'product', label: p.title, sub: p.brandName, link: `/p/${p.slug}`, image: p.image, price: p.priceMin });
    for (const c of s.categories) out.push({ id: `c-${c.slug}`, kind: 'category', label: c.name, sub: t('search.sub.category'), link: `/c/${c.slug}` });
    for (const b of s.brands) out.push({ id: `b-${b.slug}`, kind: 'brand', label: b.name, sub: t('search.sub.brand'), link: `/b/${b.slug}` });
    return out;
  }, [query, recent, suggestions, t]);

  const close = () => {
    setOpen(false);
    setActive(-1);
  };

  const run = (term: string) => {
    const q = term.trim().slice(0, 100);
    if (!q) return;
    recentStore.add(q);
    setQuery(q);
    close();
    navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  const choose = (option: SearchOption) => {
    analytics.track({ name: 'search_suggestion_selected', props: { kind: option.kind } });
    if (option.link) {
      close();
      navigate(option.link);
      return;
    }
    run(option.label);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const count = options.length;
    if (e.key === 'ArrowDown' && count) {
      e.preventDefault();
      setOpen(true);
      setActive((active + 1) % count);
    } else if (e.key === 'ArrowUp' && count) {
      e.preventDefault();
      setActive(active <= 0 ? count - 1 : active - 1);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      choose(options[active]);
    } else if (e.key === 'Escape') close();
    else if (e.key === 'Tab') setOpen(false);
  };

  const showList = open && options.length > 0;
  return (
    <div ref={root} className="relative block">
      <form
        role="search"
        className="flex"
        onSubmit={(e) => {
          e.preventDefault();
          if (active >= 0) return;
          run(query);
        }}
      >
        <label htmlFor={`${idPrefix}-input`} className="sr-only">
          {t('search.label')}
        </label>
        <input
          id={`${idPrefix}-input`}
          type="search"
          name="q"
          role="combobox"
          autoComplete="off"
          maxLength={100}
          placeholder={placeholder ?? t('search.placeholder')}
          className="min-h-11 w-full rounded-s-md border border-e-0 border-border-strong bg-surface px-3 text-base"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={`${idPrefix}-list`}
          aria-activedescendant={active >= 0 ? `${idPrefix}-opt-${active}` : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className="inline-flex min-h-11 items-center justify-center rounded-e-md bg-primary px-4 text-primary-contrast hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50" aria-label={t('search.submit')}>
          <Icon name="search" />
        </button>
      </form>

      <p className="sr-only" role="status" aria-live="polite">
        {showList ? t('search.available', { count: options.length }) : ''}
      </p>

      {showList && (
        <ul id={`${idPrefix}-list`} role="listbox" aria-label={t('search.suggestions')} className="absolute start-0 end-0 top-full z-30 mt-1 max-h-[70vh] overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-popover">
          {options.map((option, i) => (
            <li key={option.id} role="presentation" className="contents">
              {(i === 0 || options[i - 1].kind !== option.kind) && (
                <span role="presentation" className="block w-full px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {t(`search.group.${option.kind}`)}
                </span>
              )}
              <div
                role="option"
                tabIndex={-1}
                id={`${idPrefix}-opt-${i}`}
                aria-selected={active === i}
                className={cx('flex min-h-11 w-full cursor-pointer items-center gap-3 px-3 py-1.5', active === i && 'bg-surface-alt')}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(option);
                }}
                onMouseEnter={() => setActive(i)}
              >
                {option.image ? <img src={option.image.url} width={option.image.width} height={option.image.height} alt="" loading="lazy" className="size-10 shrink-0 rounded object-cover" /> : <Icon name={option.kind === 'recent' ? 'chevron-right' : 'search'} size={16} className="text-text-muted" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{option.label}</span>
                  {option.sub && <span className="block truncate text-xs text-text-muted">{option.sub}</span>}
                </span>
                {option.price && <span className="text-sm font-medium">{money(option.price)}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
