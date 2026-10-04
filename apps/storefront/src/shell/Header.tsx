import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { APP_CONFIG, useService, useSignal, useT } from '@shop/core';
import { AuthStore, CartStore, NotificationStore } from '@shop/state';
import { Drawer, Icon, cx } from '@shop/ui';
import { CategoryMenuStore } from './category-menu.store';
import { SearchBox } from './SearchBox';

export function Header() {
  const t = useT();
  const siteName = useService(APP_CONFIG).siteName;
  const auth = useService(AuthStore);
  const cart = useService(CartStore);
  const notifications = useService(NotificationStore);
  const roots = useSignal(useService(CategoryMenuStore).roots);
  const loggedIn = useSignal(auth.loggedIn);
  const user = useSignal(auth.user);
  const unread = useSignal(notifications.unreadCount);
  const cartCount = useSignal(cart.count);

  const [scrolled, setScrolled] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const openedBy = useRef<'hover' | 'click'>('click');
  const host = useRef<HTMLElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenMenu(null);
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const bellLabel = unread > 0 ? t('nav.notificationsUnread', { count: unread }) : t('nav.notifications');
  const accountLabel = user ? t('nav.myAccount', { name: user.name.split(' ')[0] }) : t('nav.signIn');
  const iconLink = 'inline-flex size-11 items-center justify-center rounded-md hover:bg-surface-alt';
  const badge = 'absolute end-0 top-0 min-w-5 rounded-full bg-sale px-1 text-center text-xs font-semibold text-on-status';

  return (
    <header
      ref={host}
      className={cx('sticky top-0 z-20 block print:hidden border-b border-border bg-surface transition-shadow', scrolled && 'shadow-card')}
      onBlur={(e) => {
        // Close the mega menu when keyboard focus leaves the header.
        const next = e.relatedTarget as Node | null;
        if (next && !e.currentTarget.contains(next)) setOpenMenu(null);
      }}
    >
      <div className={cx('mx-auto flex max-w-7xl items-center gap-3 px-4 md:px-6', scrolled ? 'py-2' : 'py-3')}>
        <button type="button" className={cx(iconLink, 'lg:hidden')} aria-label={t('nav.openMenu')} onClick={() => setDrawerOpen(true)}>
          <Icon name="menu" size={24} />
        </button>

        <Link to="/" className="text-xl font-bold text-primary" aria-label={t('nav.siteHome', { site: siteName })}>
          {siteName}
        </Link>

        <div className="order-last hidden min-w-0 flex-1 md:order-none md:block">
          <SearchBox idPrefix="search-d" />
        </div>

        <nav aria-label={t('nav.accountCart')} className="ms-auto flex items-center gap-1 md:ms-0">
          {loggedIn && (
            <Link to="/notifications" className={cx('relative', iconLink)} aria-label={bellLabel}>
              <Icon name="bell" size={24} />
              {unread > 0 && (
                <span className={badge} aria-hidden="true">
                  {unread}
                </span>
              )}
            </Link>
          )}
          <Link to="/wishlist" className={iconLink} aria-label={t('nav.wishlist')}>
            <Icon name="heart" size={24} />
          </Link>
          <Link to={loggedIn ? '/account' : '/account/login'} className={iconLink} aria-label={accountLabel}>
            <Icon name="user" size={24} />
          </Link>
          <Link to="/cart" className={cx('relative', iconLink)} aria-label={t('nav.cart', { count: cartCount })}>
            <Icon name="cart" size={24} />
            {cartCount > 0 && (
              <span className={badge} aria-hidden="true">
                {cartCount}
              </span>
            )}
          </Link>
        </nav>
      </div>

      <div className="block px-4 pb-3 md:hidden">
        <SearchBox idPrefix="search-m" placeholder={t('search.label')} />
      </div>

      {!scrolled && (
        <nav aria-label={t('nav.categories')} className="relative hidden border-t border-border lg:block">
          <ul className="mx-auto flex max-w-7xl gap-1 px-6">
            {roots.map((root) => (
              <li key={root.id}>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center gap-1 rounded-md px-3 text-sm font-medium hover:bg-surface-alt"
                  aria-expanded={openMenu === root.id}
                  aria-controls={`menu-${root.id}`}
                  onClick={() => {
                    if (openMenu === root.id && openedBy.current === 'click') setOpenMenu(null);
                    else {
                      setOpenMenu(root.id);
                      openedBy.current = 'click';
                    }
                  }}
                  onPointerEnter={(e) => {
                    // Hover opens the menu for mouse users only; touch and keyboard use click.
                    if (e.pointerType !== 'mouse' || openMenu === root.id) return;
                    setOpenMenu(root.id);
                    openedBy.current = 'hover';
                  }}
                >
                  {root.name}
                  <Icon name="chevron-down" size={14} />
                </button>
                {openMenu === root.id && (
                  <div id={`menu-${root.id}`} className="absolute inset-x-0 top-full z-10 border-b border-border bg-surface shadow-popover" onMouseLeave={() => setOpenMenu(null)}>
                    <ul className="mx-auto grid max-w-7xl grid-cols-3 gap-2 px-6 py-4">
                      <li className="col-span-3 mb-1">
                        <Link to={`/c/${root.slug}`} className="font-semibold text-primary hover:underline" onClick={() => setOpenMenu(null)}>
                          {t('nav.allIn', { name: root.name })}
                        </Link>
                      </li>
                      {root.children.map((child) => (
                        <li key={child.id}>
                          <Link to={`/c/${child.slug}`} className="block truncate rounded-md px-2 py-2 text-text hover:bg-surface-alt" title={child.name} onClick={() => setOpenMenu(null)}>
                            {child.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </nav>
      )}

      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen} label={t('nav.menu')} side="left">
        <ul className="space-y-1">
          {roots.map((root) => (
            <li key={root.id}>
              <button type="button" className="flex min-h-11 w-full items-center justify-between rounded-md px-2 font-medium hover:bg-surface-alt" aria-expanded={expanded === root.id} onClick={() => setExpanded(expanded === root.id ? null : root.id)}>
                {root.name}
                <Icon name="chevron-down" size={16} className={expanded === root.id ? 'rotate-180' : ''} />
              </button>
              {expanded === root.id && (
                <ul className="ms-3 border-s border-border ps-2">
                  <li>
                    <Link to={`/c/${root.slug}`} className="block min-h-11 rounded-md px-2 py-2.5 font-medium text-primary" onClick={() => setDrawerOpen(false)}>
                      {t('nav.allIn', { name: root.name })}
                    </Link>
                  </li>
                  {root.children.map((child) => (
                    <li key={child.id}>
                      <Link to={`/c/${child.slug}`} className="block min-h-11 rounded-md px-2 py-2.5 hover:bg-surface-alt" onClick={() => setDrawerOpen(false)}>
                        {child.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </Drawer>
    </header>
  );
}
