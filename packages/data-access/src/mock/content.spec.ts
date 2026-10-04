import { TestBed } from '@shop/core/testing';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from '@shop/core';
import { AdminContentApi, AuditApi, AuthApi, CmsApi, ContentApi, DEFAULT_SECTIONS, DEMO_ACCOUNTS, provideAdminDataAccess, provideDataAccess } from '../index';

const admin = DEMO_ACCOUNTS[1];
const customer = DEMO_ACCOUNTS[0];
const image = { url: '/mock/img/hero-1.svg', alt: 'A banner', width: 1600, height: 560 };
const banner = { title: 'Festive sale', subtitle: 'Up to 50% off', cta: 'Shop now', link: '/collections/trending', image, active: true };

describe('content management (mock)', () => {
  let auth: AuthApi;
  let content: ContentApi;
  let cms: CmsApi;
  let adminContent: AdminContentApi;

  beforeEach(async () => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: APP_CONFIG, useValue: { useMocks: true, mockLatencyMs: 0, apiBaseUrl: '', siteName: 'S', siteUrl: 'http://x', features: {} } }, provideDataAccess({ useMocks: true }), provideAdminDataAccess({ useMocks: true })],
    });
    auth = TestBed.inject(AuthApi);
    content = TestBed.inject(ContentApi);
    cms = TestBed.inject(CmsApi);
    adminContent = TestBed.inject(AdminContentApi);
  });

  const signInAdmin = () => firstValueFrom(auth.login(admin.email, admin.password));

  it('serves seeded home banners, sections and footer links to shoppers', async () => {
    const home = await firstValueFrom(content.homeConfig());
    expect(home.banners).toHaveLength(4);
    expect(home.sections.map((s) => s.key)).toEqual(DEFAULT_SECTIONS.map((s) => s.key));
    expect((await firstValueFrom(content.navigation())).map((l) => l.href)).toEqual(expect.arrayContaining(['/pages/about', '/pages/faq', '/pages/privacy']));
  });

  it('refuses every content action without the content permission', async () => {
    await expect(firstValueFrom(adminContent.banners())).rejects.toMatchObject({ code: 'unauthorized' });
    await firstValueFrom(auth.login(customer.email, customer.password));
    for (const call of [() => adminContent.banners(), () => adminContent.pages(), () => adminContent.redirects(), () => adminContent.links(), () => adminContent.sections()]) {
      await expect(firstValueFrom(call())).rejects.toMatchObject({ code: 'forbidden' });
    }
  });

  it('banners: validation, create, schedule, deactivate, reorder and delete, all reflected for shoppers', async () => {
    await signInAdmin();
    await expect(firstValueFrom(adminContent.saveBanner({ ...banner, title: '', link: 'javascript:alert(1)', image: { ...image, alt: '' } }))).rejects.toMatchObject({ fields: { title: expect.any(String), link: expect.any(String), imageAlt: expect.any(String) } });
    await expect(firstValueFrom(adminContent.saveBanner({ ...banner, startsAt: '2026-10-10T00:00:00Z', endsAt: '2026-10-01T00:00:00Z' }))).rejects.toMatchObject({ fields: { endsAt: expect.any(String) } });

    let all = await firstValueFrom(adminContent.saveBanner(banner));
    expect(all).toHaveLength(5);
    expect((await firstValueFrom(content.homeConfig())).banners).toHaveLength(5);

    const created = all[all.length - 1];
    await firstValueFrom(adminContent.saveBanner({ ...banner, id: created.id, active: false }));
    expect((await firstValueFrom(content.homeConfig())).banners).toHaveLength(4);

    await firstValueFrom(adminContent.saveBanner({ ...banner, id: created.id, startsAt: new Date(Date.now() + 86_400_000).toISOString() }));
    expect((await firstValueFrom(content.homeConfig())).banners.some((b) => b.id === created.id)).toBe(false); // not started yet
    await firstValueFrom(adminContent.saveBanner({ ...banner, id: created.id, startsAt: undefined, endsAt: new Date(Date.now() - 1000).toISOString() }));
    expect((await firstValueFrom(content.homeConfig())).banners.some((b) => b.id === created.id)).toBe(false); // already ended

    all = await firstValueFrom(adminContent.saveBanner({ ...banner, id: created.id, startsAt: undefined, endsAt: undefined }));
    const ids = all.map((b) => b.id).reverse();
    all = await firstValueFrom(adminContent.reorderBanners(ids));
    expect(all.map((b) => b.id)).toEqual(ids);
    expect((await firstValueFrom(content.homeConfig())).banners[0].id).toBe(ids[0]);

    all = await firstValueFrom(adminContent.deleteBanner(created.id));
    expect(all.some((b) => b.id === created.id)).toBe(false);
    await expect(firstValueFrom(adminContent.deleteBanner('nope'))).rejects.toMatchObject({ code: 'not_found' });
  });

  it('home sections: must keep all sections, can disable and reorder', async () => {
    await signInAdmin();
    const sections = await firstValueFrom(adminContent.sections());
    await expect(firstValueFrom(adminContent.saveSections(sections.slice(1)))).rejects.toMatchObject({ code: 'validation' });
    await expect(firstValueFrom(adminContent.saveSections(sections.map((s, i) => (i === 0 ? { ...s, title: '' } : s))))).rejects.toMatchObject({ fields: { 'sections.0.title': expect.any(String) } });
    const reordered = [...sections].reverse().map((s) => (s.key === 'deals' ? { ...s, enabled: false } : s));
    await firstValueFrom(adminContent.saveSections(reordered));
    const shopper = (await firstValueFrom(content.homeConfig())).sections;
    expect(shopper[0].key).toBe('recent');
    expect(shopper.some((s) => s.key === 'deals')).toBe(false);
  });

  it('pages: draft is hidden from shoppers, previewable by staff, rendered safely, locked pages cannot be deleted', async () => {
    await signInAdmin();
    await expect(firstValueFrom(adminContent.savePage({ slug: 'Bad Slug', title: '', source: '', status: 'draft' }, true))).rejects.toMatchObject({ fields: { slug: expect.any(String), title: expect.any(String) } });
    await expect(firstValueFrom(adminContent.savePage({ slug: 'about', title: 'Dup', source: '', status: 'draft' }, true))).rejects.toMatchObject({ fields: { slug: 'A page with this address already exists' } });

    const page = await firstValueFrom(adminContent.savePage({ slug: 'shipping-info', title: 'Shipping', source: '## Rates\n\n<script>x</script> [FAQ](/pages/faq)', status: 'draft', seoDescription: 'How shipping works' }, true));
    expect(page.body).toContain('<h2>Rates</h2>');
    expect(page.body).not.toContain('<script');

    // staff can preview the draft; the public cannot
    expect((await firstValueFrom(cms.page('shipping-info', { preview: true }))).preview).toBe(true);
    await expect(firstValueFrom(cms.page('shipping-info'))).rejects.toMatchObject({ code: 'not_found' });
    await firstValueFrom(auth.logout());
    await expect(firstValueFrom(cms.page('shipping-info', { preview: true }))).rejects.toMatchObject({ code: 'not_found' });

    await signInAdmin();
    await firstValueFrom(adminContent.savePage({ slug: 'shipping-info', title: 'Shipping', source: 'Hello', status: 'published' }, false));
    await firstValueFrom(auth.logout());
    expect((await firstValueFrom(cms.page('shipping-info'))).title).toBe('Shipping');

    await signInAdmin();
    await expect(firstValueFrom(adminContent.deletePage('privacy'))).rejects.toMatchObject({ message: 'Legal pages cannot be deleted, only edited.' });
    const after = await firstValueFrom(adminContent.deletePage('shipping-info'));
    expect(after.some((p) => p.slug === 'shipping-info')).toBe(false);
  });

  it('links: validated, grouped and ordered', async () => {
    await signInAdmin();
    await expect(firstValueFrom(adminContent.saveLinks([{ label: '', href: 'javascript:x', group: 'help' }]))).rejects.toMatchObject({ fields: { 'links.0.label': expect.any(String), 'links.0.href': expect.any(String) } });
    const saved = await firstValueFrom(adminContent.saveLinks([{ label: 'Shipping', href: '/pages/shipping-info', group: 'help' }, { label: 'Blog', href: 'https://blog.example.com', group: 'about' }, { label: 'Returns', href: '/pages/returns', group: 'help' }]));
    expect(saved.filter((l) => l.group === 'help').map((l) => l.order)).toEqual([1, 2]);
    expect((await firstValueFrom(content.navigation())).map((l) => l.label)).toContain('Blog');
  });

  it('redirects: validation, chains, loop detection and removal', async () => {
    await signInAdmin();
    await expect(firstValueFrom(adminContent.addRedirect('old', '/new'))).rejects.toMatchObject({ fields: { from: expect.any(String) } });
    await expect(firstValueFrom(adminContent.addRedirect('/a', '/a/'))).rejects.toMatchObject({ fields: { to: expect.any(String) } });
    await firstValueFrom(adminContent.addRedirect('/old-shoes', '/c/footwear'));
    const list = await firstValueFrom(adminContent.addRedirect('/oldest-shoes', '/old-shoes'));
    await expect(firstValueFrom(adminContent.addRedirect('/old-shoes', '/x'))).rejects.toMatchObject({ fields: { from: expect.any(String) } });
    await expect(firstValueFrom(adminContent.addRedirect('/c/footwear', '/oldest-shoes'))).rejects.toMatchObject({ code: 'validation', message: 'This redirect would create a loop.' });

    expect(await firstValueFrom(content.redirectFor('/old-shoes/?ref=1'))).toBe('/c/footwear');
    expect(await firstValueFrom(content.redirectFor('/oldest-shoes'))).toBe('/old-shoes'.replace('/old-shoes', '/c/footwear')); // followed through the chain
    expect(await firstValueFrom(content.redirectFor('/nothing'))).toBeNull();

    await firstValueFrom(adminContent.removeRedirect(list[0].id));
    expect(await firstValueFrom(content.redirectFor('/old-shoes'))).toBeNull();
  });

  it('records an audit entry for every change', async () => {
    await signInAdmin();
    await firstValueFrom(adminContent.saveBanner(banner));
    await firstValueFrom(adminContent.addRedirect('/x', '/y'));
    const actions = (await firstValueFrom(TestBed.inject(AuditApi).list({ page: 1, pageSize: 10 }))).items.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['content.banner.create', 'content.redirect.add']));
  });
});
