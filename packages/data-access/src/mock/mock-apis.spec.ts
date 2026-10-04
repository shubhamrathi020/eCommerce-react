import { TestBed } from '@shop/core/testing';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from '@shop/core';
import { CategoryApi, CmsApi, NewsletterApi, provideDataAccess } from '../index';

describe('mock APIs', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: APP_CONFIG, useValue: { useMocks: true, mockLatencyMs: 0, apiBaseUrl: '', siteName: 'S', siteUrl: 'http://x', features: {} } },
        provideDataAccess({ useMocks: true }),
      ],
    });
  });

  it('builds an ordered category tree with children', async () => {
    const tree = await firstValueFrom(TestBed.inject(CategoryApi).tree());
    expect(tree.length).toBeGreaterThanOrEqual(8);
    expect(tree[0].children.length).toBeGreaterThan(0);
    expect(tree.every((root) => root.parentId === undefined)).toBe(true);
  });

  it('returns a CMS page and a not_found error for unknown slugs', async () => {
    const api = TestBed.inject(CmsApi);
    expect((await firstValueFrom(api.page('about'))).slug).toBe('about');
    await expect(firstValueFrom(api.page('nope'))).rejects.toMatchObject({ code: 'not_found' });
  });

  it('validates newsletter emails', async () => {
    const api = TestBed.inject(NewsletterApi);
    await expect(firstValueFrom(api.subscribe('a@b.co'), { defaultValue: undefined })).resolves.toBeUndefined();
    await expect(firstValueFrom(api.subscribe('bad'))).rejects.toMatchObject({ code: 'validation' });
  });

  it('refuses to run without mocks until HTTP adapters exist', () => {
    expect(() => provideDataAccess({ useMocks: false })).toThrow();
  });
});
