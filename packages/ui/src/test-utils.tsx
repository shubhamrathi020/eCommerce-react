import { type ReactElement } from 'react';
import { render } from '@testing-library/react';
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
