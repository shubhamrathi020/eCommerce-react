import { NavLink, Outlet } from 'react-router';
import { cx } from '@shop/ui';

export interface Tab {
  label: string;
  link: string;
}

export const tabClass = ({ isActive }: { isActive: boolean }) =>
  cx('min-h-11 border-b-2 px-4 py-2.5 text-sm font-medium', isActive ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text');

/** Title and tab navigation shared by the screens of one admin area. */
export function SectionLayout({ title, label, tabs }: { title: string; label: string; tabs: Tab[] }) {
  return (
    <>
      <h1 className="mb-3 text-2xl font-bold">{title}</h1>
      <nav aria-label={label} className="mb-6 flex flex-wrap gap-1 border-b border-border">
        {tabs.map((tab) => (
          <NavLink key={tab.link} to={tab.link} className={tabClass}>
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}

export const ContentLayout = () => (
  <SectionLayout
    title="Content"
    label="Content sections"
    tabs={[
      { label: 'Banners', link: '/content/banners' },
      { label: 'Home sections', link: '/content/sections' },
      { label: 'Pages', link: '/content/pages' },
      { label: 'Footer links', link: '/content/links' },
      { label: 'Redirects', link: '/content/redirects' },
    ]}
  />
);

export const InventoryLayout = () => (
  <SectionLayout
    title="Inventory"
    label="Inventory sections"
    tabs={[
      { label: 'Stock', link: '/inventory/stock' },
      { label: 'Ledger', link: '/inventory/ledger' },
      { label: 'Import and export', link: '/inventory/import' },
      { label: 'Settings', link: '/inventory/settings' },
    ]}
  />
);

export const MarketplaceLayout = () => (
  <SectionLayout
    title="Marketplace"
    label="Marketplace sections"
    tabs={[
      { label: 'Applications', link: '/marketplace/applications' },
      { label: 'Sellers', link: '/marketplace/sellers' },
      { label: 'Listings', link: '/marketplace/listings' },
      { label: 'Commission', link: '/marketplace/commission' },
      { label: 'Payouts', link: '/marketplace/payouts' },
    ]}
  />
);

export const NotificationsLayout = () => (
  <SectionLayout
    title="Notifications"
    label="Notification sections"
    tabs={[
      { label: 'Templates', link: '/notifications/templates' },
      { label: 'Delivery log', link: '/notifications/log' },
    ]}
  />
);

export const PromotionsLayout = () => (
  <SectionLayout
    title="Promotions"
    label="Promotion sections"
    tabs={[
      { label: 'Promotions', link: '/promotions/list' },
      { label: 'Simulator', link: '/promotions/simulator' },
      { label: 'Gift cards', link: '/promotions/gift-cards' },
      { label: 'Price health', link: '/promotions/price-health' },
    ]}
  />
);

export const ReturnsLayout = () => (
  <SectionLayout
    title="Returns and refunds"
    label="Returns sections"
    tabs={[
      { label: 'Return requests', link: '/returns/queue' },
      { label: 'Cancelled-order refunds', link: '/returns/refunds' },
      { label: 'Policy', link: '/returns/policy' },
    ]}
  />
);
