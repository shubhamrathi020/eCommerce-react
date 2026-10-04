import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { ImageRef } from '@ecom/contracts';
import { ToastService, useService, useSignal } from '@shop/core';
import { Icon, cx } from './basics';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps keyboard focus inside `ref` while `active`, focuses the first control on open and restores focus on close. */
export function useFocusTrap(ref: React.RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active || !ref.current) return;
    const container = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    container.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    container.addEventListener('keydown', onKey);
    return () => {
      container.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [active, ref]);
}

/** Slide-in panel with backdrop. Traps focus while open and restores it on close; Esc closes. */
export function Drawer({ open, onOpenChange, label, side = 'left', children }: { open: boolean; onOpenChange: (open: boolean) => void; label: string; side?: 'left' | 'right'; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(panel, open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onOpenChange(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/50" aria-hidden="true" onClick={() => onOpenChange(false)} />
      <div ref={panel} role="dialog" aria-modal="true" aria-label={label} className={cx('fixed inset-y-0 z-30 flex w-[min(20rem,85vw)] flex-col bg-surface shadow-modal', side === 'left' ? 'start-0' : 'end-0')}>
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="text-lg font-semibold">{label}</h2>
          <button type="button" className="inline-flex size-11 items-center justify-center rounded-md hover:bg-surface-alt" aria-label="Close" onClick={() => onOpenChange(false)}>
            <Icon name="x" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </>
  );
}

/** Product gallery: thumbnails, hover zoom on desktop, and a keyboard-friendly lightbox. */
export function Gallery({ images, index: controlled, onIndexChange }: { images: ImageRef[]; index?: number; onIndexChange?: (index: number) => void }) {
  const [inner, setInner] = useState(0);
  const index = controlled ?? inner;
  const setIndex = useCallback(
    (i: number) => {
      setInner(i);
      onIndexChange?.(i);
    },
    [onIndexChange],
  );
  const [lightbox, setLightbox] = useState(false);
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useFocusTrap(dialog, lightbox);

  // A new image set (navigating between products) starts at the first image.
  const key = images.map((i) => i.url).join('|');
  useEffect(() => setIndex(0), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = images[Math.min(index, images.length - 1)];
  const step = (delta: number) => setIndex((index + delta + images.length) % images.length);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(false);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  if (!current) return null;
  return (
    <div className="block">
      <div className="flex flex-col gap-3 md:flex-row-reverse">
        <div className="relative flex-1">
          <button
            type="button"
            className="group relative block aspect-square w-full overflow-hidden rounded-lg border border-border bg-surface-alt"
            aria-label="Open larger image"
            onClick={() => setLightbox(true)}
            onMouseMove={(e) => {
              if (window.matchMedia?.('(hover: none)').matches) return;
              const box = e.currentTarget.getBoundingClientRect();
              setZoom({ x: ((e.clientX - box.left) / box.width) * 100, y: ((e.clientY - box.top) / box.height) * 100 });
            }}
            onMouseLeave={() => setZoom(null)}
          >
            <img
              src={current.url}
              width={current.width}
              height={current.height}
              alt={current.alt}
              fetchPriority="high"
              className="size-full object-cover transition-transform duration-150"
              style={zoom ? { transform: 'scale(2)', transformOrigin: `${zoom.x}% ${zoom.y}%` } : undefined}
            />
          </button>
          {images.length > 1 && (
            <p className="mt-1 text-center text-xs text-text-muted" aria-live="polite">
              Image {index + 1} of {images.length}
            </p>
          )}
        </div>
        {images.length > 1 && (
          <ul className="flex gap-2 overflow-x-auto md:flex-col md:overflow-visible" aria-label="Product images">
            {images.map((img, i) => (
              <li key={img.url} className="shrink-0">
                <button
                  type="button"
                  className={cx('block size-16 overflow-hidden rounded-md border-2 md:size-20', i === index ? 'border-primary' : 'border-border')}
                  aria-label={'Show image ' + (i + 1)}
                  aria-current={i === index ? 'true' : undefined}
                  onClick={() => setIndex(i)}
                >
                  <img src={img.url} width={80} height={80} alt="" loading="lazy" className="size-full object-cover" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {lightbox && (
        <div ref={dialog} className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label="Image viewer">
          <div className="absolute inset-0" aria-hidden="true" onClick={() => setLightbox(false)} />
          <img src={current.url} alt={current.alt} className="relative max-h-full max-w-full rounded-md bg-white object-contain" />
          <button type="button" className="absolute end-3 top-3 inline-flex size-11 items-center justify-center rounded-full bg-surface" aria-label="Close image viewer" onClick={() => setLightbox(false)}>
            <Icon name="x" />
          </button>
          {images.length > 1 && (
            <>
              <button type="button" className="absolute start-3 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface" aria-label="Previous image" onClick={() => step(-1)}>
                <Icon name="chevron-right" className="rotate-180" />
              </button>
              <button type="button" className="absolute end-3 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface" aria-label="Next image" onClick={() => step(1)}>
                <Icon name="chevron-right" />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Place once in the app shell. Polite live region so screen readers announce new toasts. */
export function ToastContainer() {
  const service = useService(ToastService);
  const toasts = useSignal(service.toasts);
  return (
    <div className="print:hidden pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cx(
            'pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-md border bg-surface p-3 shadow-popover',
            toast.kind === 'success' && 'border-success',
            toast.kind === 'error' && 'border-danger',
            toast.kind === 'info' && 'border-info',
          )}
          role={toast.kind === 'error' ? 'alert' : 'status'}
        >
          <Icon name={toast.kind === 'success' ? 'check' : toast.kind === 'error' ? 'alert' : 'info'} className={cx(toast.kind === 'success' && 'text-success', toast.kind === 'error' && 'text-danger', toast.kind === 'info' && 'text-info')} />
          <p className="flex-1 text-sm text-text">{toast.message}</p>
          <button type="button" className="rounded p-1 text-text-muted hover:bg-surface-alt" aria-label="Dismiss" onClick={() => service.dismiss(toast.id)}>
            <Icon name="x" size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
