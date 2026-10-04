import { act, fireEvent } from '@testing-library/react';
import { MockMailbox, loadCatalogData } from '@shop/data-access';
import { button, click, field, fill, fillSelector, violations } from '@shop/ui/testing';
import { setup } from './test-harness';

const text = (root: HTMLElement) => root.textContent ?? '';

describe('admin promotions', () => {
  it('is for staff with promotion:manage only', async () => {
    const out = await setup('customer');
    await out.go('/promotions');
    expect(out.url()).toContain('/login');
  });

  it('lists the promotions, pauses and resumes one, and is accessible', async () => {
    const out = await setup();
    await out.go('/promotions', 12);
    expect(out.url()).toBe('/promotions/list');
    let root = out.root();
    expect(text(root)).toContain('Snack attack');
    expect(text(root)).toContain('Flash deal');
    expect(await violations(root)).toEqual([]);

    await click(button(root, 'Pause Snack attack'));
    await out.settle(15);
    root = out.root();
    expect(button(root, 'Resume Snack attack')).toBeDefined();
    await click(button(root, 'Resume Snack attack'));
    await out.settle(15);
    expect(button(out.root(), 'Pause Snack attack')).toBeDefined();
  });

  it('creates a promotion through the form, showing the API field errors first', async () => {
    const out = await setup();
    await out.go('/promotions/list/new', 12);
    let root = out.root();
    expect(await violations(root)).toEqual([]);

    await fill(root, 'Name', '');
    await click(button(root, 'Save promotion'));
    await out.settle(15);
    root = out.root();
    expect(text(root)).toContain('Give the promotion a name');
    expect(text(root)).toContain('Choose at least one category');

    await fill(root, 'Name', 'Books week');
    await click(root.querySelector<HTMLInputElement>('fieldset input[type="checkbox"]'));
    await click(button(root, 'Save promotion'));
    await out.settle(20);
    expect(out.url()).toBe('/promotions/list');
    expect(text(out.root())).toContain('Books week');
  });

  it('edits an existing flash deal and keeps its type fixed', async () => {
    const out = await setup();
    await out.go('/promotions/list/promo-flash-tee', 12);
    let root = out.root();
    expect(root.querySelector<HTMLSelectElement>('main select')?.disabled).toBe(true);
    expect(text(root)).toContain('Units at the deal price');
    expect(await violations(root)).toEqual([]);
    const price = Array.from(root.querySelectorAll<HTMLInputElement>('input')).find((i) => i.value === '1799') as HTMLInputElement;
    expect(price).toBeDefined();
    await fillSelector(root, `[id="${price.id}"]`, '99999999');
    await click(button(root, 'Save promotion'));
    await out.settle(15);
    root = out.root();
    expect(text(root)).toContain('must be below the current price');
    expect(out.url()).toBe('/promotions/list/promo-flash-tee');
  });

  it('simulates a cart and explains every rule', async () => {
    const out = await setup();
    const { products } = await loadCatalogData();
    const tee = products.find((p) => p.id === 'p-0001')?.variants[0].id as string;
    await out.go('/promotions/simulator', 12);
    let root = out.root();
    expect(await violations(root)).toEqual([]);

    await fill(root, 'Find products', 'Signature Linen Relaxed T-Shirt');
    await out.settle();
    await act(async () => {
      fireEvent.change(root.querySelector('fieldset select') as HTMLSelectElement, { target: { value: tee } });
    });
    await fillSelector(root, 'fieldset input', '2');
    await click(button(root, 'Run simulation'));
    await out.settle(15);
    root = out.root();
    expect(text(root)).toContain('Why each rule did or did not apply');
    expect(text(root)).toContain('Flash deal: signature tee');
    expect(text(root)).toContain('Applied');
    expect(text(root)).toContain('No matching items in the cart');
    expect(await violations(root)).toEqual([]);
  });

  it('issues gift cards with validation and shows each history', async () => {
    const out = await setup();
    await out.go('/promotions/gift-cards', 12);
    let root = out.root();
    expect(text(root)).toContain('GIFT500');
    expect(await violations(root)).toEqual([]);

    await fill(root, 'Amount', '5');
    await click(button(root, 'Issue card'));
    await out.settle(15);
    expect(text(out.root())).toContain('Enter an amount from ₹100 to ₹50,000');

    await fill(root, 'Amount', '750');
    await fill(root, 'Code', 'SPRING750');
    await click(button(root, 'Issue card'));
    await out.settle(15);
    root = out.root();
    expect(text(root)).toContain('SPRING750');
    await click(button(root, 'History for SPRING750'));
    await out.settle();
    expect(text(out.root())).toContain('issue');
    expect(await violations(out.root())).toEqual([]);
  });

  it('shows the price-health report (empty for the clean demo catalog)', async () => {
    const out = await setup();
    await out.go('/promotions/price-health', 12);
    expect(text(out.root())).toContain('No misleading discounts');
    expect(await violations(out.root())).toEqual([]);
  });
});

describe('admin analytics', () => {
  it('is for staff with analytics:read only', async () => {
    const out = await setup('customer');
    await out.go('/analytics');
    expect(out.url()).toContain('/login');
  });

  it('shows the funnel for the chosen period and keeps the period when moving between reports', async () => {
    const out = await setup();
    await out.go('/analytics', 12);
    expect(out.url()).toBe('/analytics/funnel');
    let root = out.root();
    expect(text(root)).toContain('Viewed a product');
    expect(text(root)).toContain('Placed an order');
    expect(await violations(root)).toEqual([]);

    await act(async () => {
      fireEvent.change(root.querySelector('#period') as HTMLSelectElement, { target: { value: '7' } });
    });
    await out.settle();
    expect(out.url()).toContain('days=7');
    root = out.root();
    expect(root.querySelector('caption')?.textContent).toContain('last 7 days');

    await click(Array.from(root.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Analytics sections"] a')).find((a) => a.textContent?.trim() === 'Products'));
    await out.settle();
    expect(out.url()).toContain('/analytics/products');
    expect(out.url()).toContain('days=7');
  });

  it('sorts the product table by a column from its header and paginates', async () => {
    const out = await setup();
    await out.go('/analytics/products', 12);
    let root = out.root();
    expect(root.querySelectorAll('tbody tr')).toHaveLength(25);
    expect(root.querySelector('th[aria-sort="descending"]')?.textContent).toContain('Units sold');
    expect(await violations(root)).toEqual([]);

    await click(button(root, 'Views'));
    await out.settle();
    expect(out.url()).toContain('sort=views');
    root = out.root();
    expect(root.querySelector('th[aria-sort="descending"]')?.textContent).toContain('Views');
    const views = Array.from(root.querySelectorAll('tbody tr')).map((tr) => Number(tr.querySelectorAll('td')[1].textContent));
    expect([...views].sort((a, b) => b - a)).toEqual(views);

    await click(button(root, 'Views'));
    await out.settle();
    expect(out.root().querySelector('th[aria-sort="ascending"]')?.textContent).toContain('Views');
  });

  it('lists searches that find nothing, linking each to the shop search with the term encoded', async () => {
    const out = await setup();
    await out.go('/analytics/search', 12);
    const root = out.root();
    expect(text(root)).toContain('Searches with no results');
    const link = root.querySelector<HTMLAnchorElement>('section[aria-labelledby="zero-h"] a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toMatch(/^http:\/\/shop\.test\/search\?q=[^&<> ]+$/);
    expect(link.rel).toContain('noopener');
    expect(await violations(root)).toEqual([]);
  });

  it('shows campaigns and cohorts accessibly', async () => {
    const out = await setup();
    await out.go('/analytics/campaigns', 12);
    expect(text(out.root())).toContain('first touch');
    expect(await violations(out.root())).toEqual([]);
    await out.go('/analytics/cohorts', 12);
    expect(text(out.root())).toContain('First order week');
    expect(await violations(out.root())).toEqual([]);
  });

  it('schedules a report and delivers it to the mock mailbox on demand', async () => {
    const out = await setup();
    await out.go('/analytics/reports', 12);
    let root = out.root();
    expect(await violations(root)).toEqual([]);

    await fill(root, 'Send to', 'nope');
    await click(button(root, 'Schedule'));
    await out.settle(15);
    expect(text(root)).toContain('Enter a valid email address');

    await fill(root, 'Send to', 'owner@shop.test');
    await click(button(root, 'Schedule'));
    await out.settle(15);
    root = out.root();
    expect(text(root)).toContain('Product performance');
    expect(text(root)).toContain('owner@shop.test');

    await click(button(root, 'Send now'));
    await out.settle(15);
    const mail = out.injector.get(MockMailbox).list()[0];
    expect(mail.to).toBe('owner@shop.test');
    expect(mail.subject).toContain('Product performance');
  });
});

describe('admin recommendations', () => {
  it('shows the event data, validates rules, saves them, and previews the rows', async () => {
    const out = await setup();
    await out.go('/recommendations', 12);
    let root = out.root();
    expect(text(root)).toContain('Anonymous visitors');
    expect(text(root)).toContain('Similar products');
    expect(await violations(root)).toEqual([]);

    // An unknown product id is refused beside the field.
    await fill(root, 'Pinned product ids', 'p-nope');
    await click(button(root, 'Save rules'));
    await out.settle(15);
    expect(text(root)).toContain('Unknown product id: p-nope');

    await fill(root, 'Pinned product ids', 'p-0001');
    await click(button(root, 'Save rules'));
    await out.settle(15);
    root = out.root();
    expect(root.querySelectorAll('[role="alert"]').length).toBe(0);
    expect(field(root, 'Pinned product ids')).toBeDefined();

    await click(button(root, 'Preview rows'));
    await out.settle(15);
    root = out.root();
    expect(text(root)).toContain('Popular right now');
    expect(text(root)).toContain('Trending this week');
    // The pinned product leads the trending row.
    const trending = root.querySelector('section[aria-label="Trending this week"] li');
    expect(trending?.textContent).toContain('(p-0001)');
  });
});
