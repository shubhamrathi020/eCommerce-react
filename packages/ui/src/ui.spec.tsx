import { useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProductSummary } from '@ecom/contracts';
import { ToastService } from '@shop/core';
import { Badge, Breadcrumb, Button, Chip, Drawer, EmptyState, ErrorState, FormField, Gallery, LanguagePicker, Pagination, Price, ProductCard, QuantityStepper, Rating, RatingInput, Stepper, Tabs, ThemeToggle, ToastContainer, inputClass, pageItems } from './index';
import { renderWithApp, violations } from './test-utils';

const money = (amount: number) => ({ amount, currency: 'INR' as const });
const image = { url: '/i.svg', alt: 'A thing', width: 400, height: 400 };
const summary = (over: Partial<ProductSummary> = {}): ProductSummary => ({
  id: 'p1',
  slug: 'thing',
  title: 'A thing',
  brandName: 'Acme',
  categoryName: 'Stuff',
  image,
  priceMin: money(79_900),
  priceMax: money(79_900),
  mrpMin: money(99_900),
  rating: { average: 4.2, count: 12 },
  stockStatus: 'in_stock',
  variantCount: 1,
  quickAddVariantId: 'v1',
  ...over,
});

describe('shared ui', () => {
  it('Button shows a busy state while loading and ignores clicks', async () => {
    const onClick = vi.fn();
    renderWithApp(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('Price shows the selling price, MRP and discount, and a plain price when nothing is discounted', () => {
    const { container } = renderWithApp(<Price price={money(79_900)} mrp={money(99_900)} />);
    expect(container.textContent).toContain('₹799');
    expect(container.textContent).toContain('₹999');
    expect(container.textContent).toContain('20% off');
    const plain = renderWithApp(<Price price={money(79_900)} />);
    expect(plain.container.textContent).not.toContain('off');
  });

  it('QuantityStepper respects min and max', async () => {
    function Harness() {
      const [v, setV] = useState(2);
      return <QuantityStepper value={v} onChange={setV} min={1} max={3} label="Qty" />;
    }
    renderWithApp(<Harness />);
    const dec = screen.getByRole('button', { name: /decrease/i });
    const inc = screen.getByRole('button', { name: /increase/i });
    await userEvent.click(inc);
    expect(inc).toBeDisabled();
    await userEvent.click(dec);
    await userEvent.click(dec);
    expect(dec).toBeDisabled();
  });

  it('Rating exposes an accessible label; RatingInput is a radio group moved with arrow keys', async () => {
    renderWithApp(<Rating value={4.2} count={10} />);
    expect(screen.getByRole('img', { name: 'Rated 4.2 out of 5 from 10 reviews' })).toBeInTheDocument();
    function Harness() {
      const [v, setV] = useState(0);
      return <RatingInput value={v} onChange={setV} />;
    }
    renderWithApp(<Harness />);
    const first = screen.getByRole('radio', { name: '1 star' });
    first.focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(screen.getByRole('radio', { name: '3 stars' })).toHaveAttribute('aria-checked', 'true');
  });

  it('Drawer renders only when open, closes on Escape and returns focus', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open menu</button>
          <Drawer open={open} onOpenChange={setOpen} label="Menu">
            <a href="/x">Link</a>
          </Drawer>
        </>
      );
    }
    renderWithApp(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
    const opener = screen.getByRole('button', { name: 'Open menu' });
    await userEvent.click(opener);
    expect(screen.getByRole('dialog', { name: 'Menu' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('Tabs switch with arrow keys and Home/End and render only the selected panel', async () => {
    renderWithApp(
      <Tabs
        tabs={[
          { label: 'One', content: <p>first</p> },
          { label: 'Two', content: <p>second</p> },
          { label: 'Three', content: <p>third</p> },
        ]}
      />,
    );
    expect(screen.getByText('first')).toBeInTheDocument();
    expect(screen.queryByText('second')).toBeNull();
    screen.getByRole('tab', { name: 'One' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByText('second')).toBeInTheDocument();
    await userEvent.keyboard('{End}');
    expect(screen.getByText('third')).toBeInTheDocument();
    await userEvent.keyboard('{Home}');
    expect(screen.getByText('first')).toBeInTheDocument();
  });

  it('Toasts are announced politely and can be dismissed', async () => {
    const { injector } = renderWithApp(<ToastContainer />);
    injector.get(ToastService).success('Saved');
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('the language picker switches the language and the theme toggle changes data-theme', async () => {
    renderWithApp(
      <>
        <LanguagePicker />
        <ThemeToggle />
      </>,
    );
    const language = screen.getAllByRole('combobox')[0];
    await userEvent.selectOptions(language, 'hi');
    expect(document.documentElement.lang).toBe('hi');
    await userEvent.selectOptions(screen.getAllByRole('combobox')[1], 'dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.lang = 'en';
  });

  it('has no serious accessibility violations across the basic components', async () => {
    const { container } = renderWithApp(
      <div>
        <Breadcrumb items={[{ label: 'Home', link: '/' }, { label: 'Shoes' }]} />
        <Stepper steps={['Cart', 'Address', 'Payment']} current={1} />
        <FormField label="Email" hint="We never share it" required>
          {(f) => <input id={f.id} aria-describedby={f.describedBy} className={inputClass} type="email" />}
        </FormField>
        <FormField label="Name" error="Name is required">
          {(f) => <input id={f.id} aria-describedby={f.describedBy} aria-invalid="true" className={inputClass} />}
        </FormField>
        <Rating value={3} count={4} />
        <Badge tone="sale">20% off</Badge>
        <Chip label="Red" onRemove={() => undefined}>
          Red
        </Chip>
        <EmptyState title="Nothing here" description="Try later" />
        <ErrorState onRetry={() => undefined} />
        <Gallery images={[image, { ...image, url: '/j.svg' }]} />
        <ProductCard product={summary()} />
      </div>,
    );
    expect(await violations(container)).toEqual([]);
  });
});

describe('pageItems', () => {
  it('shows every page when there are few', () => expect(pageItems(2, 5)).toEqual([1, 2, 3, 4, 5]));
  it('collapses long ranges with gaps around the current page', () => {
    expect(pageItems(1, 20)).toEqual([1, 2, 'gap', 20]);
    expect(pageItems(10, 20)).toEqual([1, 'gap', 9, 10, 11, 'gap', 20]);
    expect(pageItems(20, 20)).toEqual([1, 'gap', 19, 20]);
  });
});

describe('Pagination', () => {
  it('renders real links that merge the page into the current query, and nothing for a single page', () => {
    const { container } = renderWithApp(<Pagination page={2} pageSize={10} total={55} />, '/c/shoes?sort=price-asc');
    expect(screen.getByRole('link', { name: /Page 3/ }).getAttribute('href')).toBe('/c/shoes?sort=price-asc&page=3');
    expect(screen.getByRole('link', { name: /Page 1/ }).getAttribute('href')).toBe('/c/shoes?sort=price-asc');
    expect(screen.getByRole('link', { name: /Page 2/ })).toHaveAttribute('aria-current', 'page');
    expect(container.querySelector('[rel="prev"]')).not.toBeNull();
    const single = renderWithApp(<Pagination page={1} pageSize={10} total={5} />);
    expect(single.container.querySelector('nav')).toBeNull();
  });
});

describe('ProductCard', () => {
  it('shows discount, low stock, from-price and links the title to the product page', () => {
    renderWithApp(<ProductCard product={summary({ stockStatus: 'low_stock', stockLeft: 3, priceMax: money(99_900) })} />);
    expect(screen.getAllByText('20% off').length).toBeGreaterThan(0);
    expect(screen.getByText(/Only 3 left/)).toBeInTheDocument();
    expect(screen.getByText(/From/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'A thing' }).getAttribute('href')).toBe('/p/thing');
  });

  it('wishlist button reflects and toggles state with an accessible name', async () => {
    const toggle = vi.fn();
    renderWithApp(<ProductCard product={summary()} onWishlistToggle={toggle} />);
    const button = screen.getByRole('button', { name: /wishlist/i });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(button);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('offers quick add only for single-variant products', () => {
    const quickAdd = vi.fn();
    renderWithApp(<ProductCard product={summary()} onQuickAdd={quickAdd} />);
    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }));
    expect(quickAdd).toHaveBeenCalled();
    const multi = renderWithApp(<ProductCard product={summary({ quickAddVariantId: undefined, variantCount: 3 })} />);
    expect(multi.container.querySelector('button[class*="text-primary"]')).toBeNull();
  });
});
