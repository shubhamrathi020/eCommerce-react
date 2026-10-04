import { type ReactElement } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import axe from 'axe-core';
import { APP_CONFIG, InjectorProvider, MemoryStorage, STORAGE, createInjector } from '@shop/core';

export const config = { useMocks: true, mockLatencyMs: 0, apiBaseUrl: '', siteName: 'Shop', siteUrl: 'http://x', features: {} };

/** Renders inside a fresh injector (its own storage, so tests cannot leak into each other) and a router. */
export function renderWithApp(ui: ReactElement, route = '/') {
  localStorage.clear();
  const injector = createInjector([
    { provide: APP_CONFIG, useValue: config },
    { provide: STORAGE, useValue: new MemoryStorage() },
  ]);
  const result = render(
    <InjectorProvider injector={injector}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </InjectorProvider>,
  );
  return { ...result, injector };
}

/** Serious and critical accessibility problems in the rendered container (colour contrast is checked separately from the CSS tokens). */
export async function violations(container: HTMLElement): Promise<string[]> {
  const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
  return result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 110)}`);
}

// ---------- Helpers shared by the app-level flow tests ----------


/**
 * Waits at least `rounds` rounds, then until the page text has stopped changing. A fixed number of rounds is enough on a fast
 * machine but not on a busy CI runner. Reads `textContent`, which is much cheaper than serialising the markup.
 */
export async function settle(root: () => HTMLElement | null = () => document.body, rounds = 12): Promise<void> {
  let last = '';
  let steady = 0;
  for (let i = 0; i < rounds || (steady < 3 && i < 150); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const now = root()?.textContent ?? '';
    steady = now === last ? steady + 1 : 0;
    last = now;
  }
}

/** The first button whose text starts with `text`. */
export function button(root: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim().startsWith(text)) as HTMLButtonElement | undefined;
}

/** Clicks inside `act` so React flushes the update. */
export async function click(el: Element | undefined | null): Promise<void> {
  if (!el) throw new Error('nothing to click');
  await act(async () => {
    (el as HTMLElement).click();
  });
}

/** The control a label points at. `text` is matched at the start of the label, so a trailing required marker does not matter. */
export function field(root: HTMLElement, text: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const label = Array.from(root.querySelectorAll('label')).find((l) => l.textContent?.trim().startsWith(text));
  const id = label?.getAttribute('for');
  const control = id ? root.querySelector<HTMLInputElement>(`[id="${id}"]`) : label?.querySelector('input,select,textarea');
  if (!control) throw new Error(`no field labelled "${text}"`);
  return control as HTMLInputElement;
}

/** Types a value into the field labelled `text`, the way a person would (one change event). */
export async function fill(root: HTMLElement, text: string, value: string): Promise<void> {
  const control = field(root, text);
  await act(async () => {
    fireEvent.change(control, { target: { value } });
  });
}

/** Sets a control found by CSS selector (for the few controls with no label). */
export async function fillSelector(root: HTMLElement, selector: string, value: string): Promise<void> {
  const control = root.querySelector<HTMLInputElement>(selector);
  if (!control) throw new Error(`missing ${selector}`);
  await act(async () => {
    fireEvent.change(control, { target: { value } });
  });
}
