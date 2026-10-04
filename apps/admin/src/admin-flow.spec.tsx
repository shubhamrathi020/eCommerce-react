import { act, fireEvent } from '@testing-library/react';
import { button, click, field, fill, fillSelector, violations } from '@shop/ui/testing';
import { admin, customer, setup } from './test-harness';

const text = (root: HTMLElement) => root.textContent ?? '';

describe('admin console', () => {
  it('sends signed-out users to the admin sign in and refuses customer accounts', async () => {
    const out = await setup('none', '/orders');
    await out.settle();
    expect(out.url()).toContain('/login');
    expect(await violations(out.root())).toEqual([]);

    await fill(out.root(), 'Email', customer.email);
    await fill(out.root(), 'Password', customer.password);
    await click(button(out.root(), 'Sign in'));
    await out.settle(20);
    expect(text(out.root())).toContain('does not have access');
    expect(out.auth.loggedIn()).toBe(false);

    await fill(out.root(), 'Email', admin.email);
    await fill(out.root(), 'Password', admin.password);
    await click(button(out.root(), 'Sign in'));
    await out.settle(20);
    expect(out.url()).toBe('/orders'); // returns to the page that was asked for
  });

  it('blocks a signed-in customer from every admin page', async () => {
    const out = await setup('customer', '/products');
    await out.settle();
    expect(out.url()).toContain('/login');
  });

  it('dashboard shows key figures, chart summary and lists, and has no serious a11y issues', async () => {
    const out = await setup();
    await out.go('/', 20);
    const root = out.root();
    expect(text(root)).toContain('Revenue');
    expect(text(root)).toContain('Average order value');
    expect(root.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toContain('Bar chart of revenue per day over 30 days');
    expect(root.querySelectorAll('svg rect').length).toBe(30);
    expect(text(root)).toContain('Top products');
    expect(await violations(root)).toEqual([]);

    await act(async () => {
      fireEvent.change(root.querySelector('#period') as HTMLSelectElement, { target: { value: '7' } });
    });
    await out.settle(15);
    expect(root.querySelectorAll('svg rect').length).toBe(7);
  }, 30000);

  it('products: lists, filters by status through the URL, bulk archives, and edits with validation', async () => {
    const out = await setup();
    await out.go('/products');
    let root = out.root();
    expect(root.querySelectorAll('tbody tr').length).toBe(20);
    expect(await violations(root)).toEqual([]);

    // select two rows, archive them
    const boxes = root.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]');
    await click(boxes[0]);
    await click(boxes[1]);
    await out.settle();
    expect(text(root)).toContain('2 selected');
    await click(button(root, 'Archive'));
    await out.settle(15);
    await out.go('/products?status=archived');
    root = out.root();
    expect(root.querySelectorAll('tbody tr').length).toBe(2);

    // open the first product and try to save invalid data
    const href = root.querySelector('tbody a')?.getAttribute('href') ?? '';
    await out.go(href);
    root = out.root();
    expect(root.querySelector('h1')?.textContent).toContain('Edit product');
    expect(await violations(root)).toEqual([]);
    await fill(root, 'Title', '');
    await fill(root, 'Price', '0');
    await click(button(root, 'Save changes'));
    await out.settle(15);
    expect(text(root)).toContain('Please check the highlighted fields.');
    expect(text(root)).toContain('Price must be greater than zero');

    await fill(root, 'Title', 'Updated title');
    await fill(root, 'Price', '999');
    await click(button(root, 'Save changes'));
    await out.settle(15);
    expect(text(root)).not.toContain('Please check the highlighted fields.');
  }, 40000);

  it('creates a product through the form and lands on its edit page', async () => {
    const out = await setup();
    await out.go('/products/new');
    const root = out.root();
    expect(root.querySelector('h1')?.textContent).toContain('New product');
    const category = field(root, 'Category') as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(category, { target: { value: category.options[1].value } });
    });
    await fill(root, 'Title', 'Brand New Gadget');
    await fill(root, 'Brand', 'Ferro');
    await fill(root, 'SKU', 'NEW-GADGET-1');
    await fill(root, 'Price', '1499');
    await fill(root, 'Opening stock', '12');
    await click(button(root, 'Create product'));
    await out.settle(20);
    expect(out.url()).toMatch(/^\/products\/p-new-/);
  }, 30000);

  it('orders: filter, open, advance through allowed steps, add a note', async () => {
    const out = await setup();
    await out.go('/orders?status=confirmed');
    let root = out.root();
    expect(root.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
    expect(await violations(root)).toEqual([]);
    const href = root.querySelector('tbody a')?.getAttribute('href') ?? '';
    await out.go(href);
    root = out.root();
    expect(text(root)).toContain('Mark as packed');
    expect(text(root)).not.toContain('Mark as delivered');
    expect(await violations(root)).toEqual([]);
    await click(button(root, 'Mark as packed'));
    await out.settle(15);
    expect(text(root)).toContain('Mark as shipped');
    await fillSelector(root, 'input[maxlength="500"]', 'Called the customer');
    await click(button(root, 'Add note'));
    await out.settle(15);
    expect(text(root)).toContain('Called the customer');
  }, 40000);

  it('coupons: create with validation, users: grant admin, audit log lists the changes', async () => {
    const out = await setup();
    await out.go('/coupons');
    let root = out.root();
    expect(text(root)).toContain('WELCOME10');
    expect(await violations(root)).toEqual([]);
    await click(button(root, 'New coupon'));
    await out.settle();
    await fill(root, 'Code', 'x');
    await fill(root, 'Description', 'Test');
    await click(button(root, 'Save coupon'));
    await out.settle(15);
    expect(text(root)).toContain('Use 3 to 20 letters or numbers');
    await fill(root, 'Code', 'SAVE20');
    await click(button(root, 'Save coupon'));
    await out.settle(15);
    expect(text(root)).toContain('SAVE20');

    await out.go('/users');
    root = out.root();
    expect(await violations(root)).toEqual([]);
    await click(Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes('Grant admin')));
    await out.settle(15);
    expect(text(root)).toContain('Revoke admin');

    await out.go('/audit');
    root = out.root();
    expect(text(root)).toContain('coupon.create');
    expect(text(root)).toContain('user.role');
    expect(await violations(root)).toEqual([]);

    await out.go('/settings', 10);
    expect(text(out.root())).toContain('Razorpay');
  }, 60000);

  it('review moderation: shows the flagged queue, approves and rejects, and is accessible', async () => {
    const out = await setup();
    await out.go('/reviews');
    const root = out.root();
    expect(root.querySelectorAll('main li, ul > li').length).toBeGreaterThan(5);
    expect(text(root)).toContain('Contains a link');
    expect(text(root)).toContain('Contains blocked language');
    expect(await violations(root)).toEqual([]);

    await click(button(root, 'Approve'));
    await out.settle(15);
    await click(button(root, 'Reject'));
    await out.settle(15);
    expect(text(root)).toContain('6 reviews');

    await out.go('/reviews?status=approved');
    expect(out.root().querySelectorAll('li').length).toBeGreaterThan(0);
    expect(text(out.root())).toContain('1 reviews');
  }, 40000);

  it('content: banners, sections, pages (with live safe preview), links and redirects', async () => {
    const out = await setup();
    await out.go('/content');
    expect(out.url()).toBe('/content/banners');
    let root = out.root();
    expect(root.querySelectorAll('ol[aria-label="Banners in display order"] li')).toHaveLength(4);
    expect(await violations(root)).toEqual([]);

    // banner validation and create
    await click(button(root, 'New banner'));
    await out.settle();
    await fill(root, 'Title', 'Festive sale');
    await fill(root, 'Link', 'javascript:alert(1)');
    await click(button(root, 'Save banner'));
    await out.settle(15);
    expect(text(root)).toContain('Use an internal path');
    expect(text(root)).toContain('Describe the image for screen readers');
    await fill(root, 'Link', '/collections/trending');
    await fill(root, 'Image description', 'A festive banner');
    await click(button(root, 'Save banner'));
    await out.settle(20);
    expect(root.querySelectorAll('ol[aria-label="Banners in display order"] li')).toHaveLength(5);

    // sections
    await out.go('/content/sections');
    root = out.root();
    expect(await violations(root)).toEqual([]);
    await click(root.querySelector<HTMLInputElement>('ol li input[type="checkbox"]'));
    await out.settle();
    await click(button(root, 'Save sections'));
    await out.settle(15);

    // pages: the preview never runs scripts
    await out.go('/content/pages');
    root = out.root();
    expect(text(root)).toContain('/pages/about');
    await click(button(root, 'New page'));
    await out.settle();
    await fill(root, 'Title', 'Shipping');
    await fill(root, 'Address', 'shipping');
    await fill(root, 'Text', '## Rates\n\n<script>alert(1)</script> and **bold**');
    await out.settle();
    const preview = root.querySelector('[aria-labelledby="preview-h"]') as HTMLElement;
    expect(preview.innerHTML).toContain('<h2>Rates</h2>');
    expect(preview.querySelector('script')).toBeNull();
    expect(await violations(root)).toEqual([]);
    await click(button(root, 'Save page'));
    await out.settle(20);
    expect(text(root)).toContain('/pages/shipping');
    expect(text(root)).toContain('draft');

    // links
    await out.go('/content/links');
    root = out.root();
    expect(await violations(root)).toEqual([]);
    await click(button(root, 'Add link'));
    await out.settle();
    await click(button(root, 'Save links'));
    await out.settle(15);
    expect(text(root)).toContain('Label is required');

    // redirects
    await out.go('/content/redirects');
    root = out.root();
    expect(await violations(root)).toEqual([]);
    await fill(root, 'From', '/old-page');
    await fill(root, 'To', '/pages/about');
    await click(button(root, 'Add redirect'));
    await out.settle(15);
    expect(text(root)).toContain('/old-page');
    await fill(root, 'From', '/pages/about');
    await fill(root, 'To', '/old-page');
    await click(button(root, 'Add redirect'));
    await out.settle(15);
    expect(text(root)).toContain('Creates a redirect loop');
  }, 60000);

  it('inventory: stock table, adjustment with a required reason, ledger, import report and settings', async () => {
    const out = await setup();
    await out.go('/inventory');
    expect(out.url()).toBe('/inventory/stock');
    let root = out.root();
    expect(root.querySelectorAll('tbody tr')).toHaveLength(20);
    expect(await violations(root)).toEqual([]);

    // open the editor for the first row and try to save without a reason
    await click(Array.from(root.querySelectorAll('tbody button')).find((b) => b.textContent?.startsWith('Manage')));
    await out.settle();
    await fill(root, 'Units', '5');
    await click(button(root, 'Record change'));
    await out.settle(15);
    expect(text(root)).toContain('Please check the highlighted fields.');
    expect(text(root)).toContain('Choose a reason');
    expect(await violations(root)).toEqual([]);

    await act(async () => {
      fireEvent.change(field(root, 'Reason'), { target: { value: 'received_shipment' } });
    });
    await click(button(root, 'Record change'));
    await out.settle(20);
    expect(root.querySelector('[aria-label="Adjust stock"]')).toBeNull(); // editor closes after saving

    // the ledger shows the entry
    await out.go('/inventory/ledger');
    root = out.root();
    expect(root.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(text(root)).toContain('Received shipment');
    expect(text(root)).toContain('+5');
    expect(await violations(root)).toEqual([]);

    // import: a bad row is reported
    await out.go('/inventory/import');
    root = out.root();
    expect(await violations(root)).toEqual([]);
    await fillSelector(root, '#csv', 'sku,location,on_hand\nNOPE-1,Main warehouse,3');
    await click(button(root, 'Import stock levels'));
    await out.settle(15);
    expect(text(root)).toContain('0 row(s) applied, 1 skipped');
    expect(text(root)).toContain('Unknown SKU');

    // settings
    await out.go('/inventory/settings');
    root = out.root();
    expect(await violations(root)).toEqual([]);
    await fill(root, 'Reservation time', '0');
    await click(button(root, 'Save settings'));
    await out.settle(15);
    expect(text(root)).toContain('Use a whole number from 1 to 1,440 minutes');
    await fill(root, 'Reservation time', '20');
    await click(button(root, 'Save settings'));
    await out.settle(15);
    expect(text(root)).not.toContain('Use a whole number');
  }, 60000);

  it('notifications: template editor rejects an unknown variable, versions, sends a test, and the delivery log can retry', async () => {
    const out = await setup();
    await out.go('/notifications');
    expect(out.url()).toBe('/notifications/templates');
    let root = out.root();
    expect(await violations(root)).toEqual([]);
    expect(text(root)).toContain('Order placed');

    await click(Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes('Order placed')));
    await out.settle(15);
    root = out.root();
    await fill(root, 'Subject', 'Order {{bogus}} confirmed');
    await click(button(root, 'Save (new version)'));
    await out.settle(15);
    expect(text(root)).toContain('Unknown variable');

    await fill(root, 'Subject', 'Your order {{orderId}} is confirmed!');
    await click(button(root, 'Save (new version)'));
    await out.settle(20);
    expect(text(root)).toContain('v2');
    expect(text(root)).toContain('Previous versions');
    await click(button(root, 'Restore this version'));
    await out.settle(20);
    expect(text(root)).toContain('v3');

    await click(button(root, 'Send test to my mailbox'));
    await out.settle(15);

    await out.go('/notifications/log');
    root = out.root();
    expect(await violations(root)).toEqual([]);
    expect(text(root)).toContain(admin.email);
    await out.go('/notifications/log?status=failed');
    root = out.root();
    expect(root.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
    await click(button(root, 'Retry'));
    await out.settle(15);
    expect(button(root, 'Retry')).toBeUndefined();
  }, 60000);
});
