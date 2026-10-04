import { type ReactNode, useId, useRef, useState } from 'react';
import { I18nService, type LocaleCode, type ThemePreference, ThemeService, useService, useSignal, useT } from '@shop/core';
import { Icon, cx, inputClass } from './basics';

/** Accessible tabs (arrow keys, Home/End). A panel's content is rendered only while its tab is selected. */
export function Tabs({ tabs, label = 'Sections' }: { tabs: Array<{ label: string; content: ReactNode }>; label?: string }) {
  const uid = useId();
  const [selected, setSelected] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const count = tabs.length;
    const move = ({ ArrowRight: 1, ArrowLeft: -1 } as Record<string, number>)[e.key];
    let next = selected;
    if (move) next = (selected + move + count) % count;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = count - 1;
    else return;
    e.preventDefault();
    setSelected(next);
    list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };
  return (
    <div className="block">
      <div ref={list} role="tablist" className="flex gap-1 overflow-x-auto border-b border-border" aria-label={label}>
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            type="button"
            role="tab"
            id={`${uid}-tab-${i}`}
            aria-selected={selected === i}
            aria-controls={`${uid}-panel-${i}`}
            tabIndex={selected === i ? 0 : -1}
            className={cx('min-h-11 shrink-0 border-b-2 px-4 font-medium', selected === i ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text')}
            onClick={() => setSelected(i)}
            onKeyDown={onKeyDown}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map(
        (tab, i) =>
          selected === i && (
            <div key={tab.label} role="tabpanel" tabIndex={0} className="pt-4" id={`${uid}-panel-${i}`} aria-labelledby={`${uid}-tab-${i}`}>
              {tab.content}
            </div>
          ),
      )}
    </div>
  );
}

/** Horizontally scrolling row with scroll-snap and previous/next buttons (for product rows). */
export function Scroller({ label = 'Products', children }: { label?: string; children: ReactNode }) {
  const track = useRef<HTMLDivElement>(null);
  const scroll = (direction: 1 | -1) => {
    const el = track.current;
    el?.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' });
  };
  const arrow = 'absolute top-1/3 hidden size-11 items-center justify-center rounded-full border border-border bg-surface shadow-card hover:bg-surface-alt md:inline-flex';
  return (
    <div className="relative block">
      <div ref={track} className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:thin]" role="list" aria-label={label}>
        {children}
      </div>
      <button type="button" className={cx(arrow, '-start-3')} aria-label="Scroll left" onClick={() => scroll(-1)}>
        <Icon name="chevron-right" className="rotate-180" />
      </button>
      <button type="button" className={cx(arrow, '-end-3')} aria-label="Scroll right" onClick={() => scroll(1)}>
        <Icon name="chevron-right" />
      </button>
    </div>
  );
}

const THEMES: ThemePreference[] = ['system', 'light', 'dark'];

/** Light, dark or follow-my-device. */
export function ThemeToggle() {
  const t = useT();
  const theme = useService(ThemeService);
  const preference = useSignal(theme.preference);
  const id = useId();
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <label htmlFor={id} className="text-text-muted">
        {t('theme.label')}
      </label>
      <select id={id} className={cx(inputClass, '!w-auto !min-h-9 !py-1')} value={preference} onChange={(e) => theme.set(e.target.value as ThemePreference)}>
        {THEMES.map((o) => (
          <option key={o} value={o}>
            {t('theme.' + o)}
          </option>
        ))}
      </select>
    </span>
  );
}

/** Language menu. A draft translation is labelled as one. */
export function LanguagePicker() {
  const t = useT();
  const i18n = useService(I18nService);
  const locale = useSignal(i18n.locale);
  const info = useSignal(i18n.info);
  const id = useId();
  return (
    <span className="inline-flex flex-col gap-1 text-sm">
      <span className="inline-flex items-center gap-2">
        <label htmlFor={id} className="text-text-muted">
          {t('lang.label')}
        </label>
        <select id={id} className={cx(inputClass, '!w-auto !min-h-9 !py-1')} value={locale} onChange={(e) => i18n.set(e.target.value as LocaleCode)}>
          {i18n.available.map((l) => (
            <option key={l.code} value={l.code} lang={l.html}>
              {l.label}
              {l.draft ? ` (${t('lang.draft')})` : ''}
            </option>
          ))}
        </select>
      </span>
      {info.draft && <span className="max-w-md text-xs text-text-muted">{t('lang.note')}</span>}
    </span>
  );
}
