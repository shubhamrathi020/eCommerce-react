import { useEffect } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import DOMPurify from 'dompurify';
import { ApiException } from '@ecom/contracts';
import { SeoService, useResource, useService } from '@shop/core';
import { CmsApi, ContentApi } from '@shop/data-access';
import { ErrorState, NotFound, Skeleton } from '@shop/ui';

/** Renders a CMS page by slug. The HTML is sanitised before it is inserted. */
export function StaticPage() {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  const preview = params.get('preview') === '1';
  const seo = useService(SeoService);
  const api = useService(CmsApi);
  const page = useResource(() => api.page(slug, { preview }), [api, slug, preview]);

  useEffect(() => {
    const p = page.value;
    if (page.status === 'ready' && p) seo.set({ title: p.seo?.title ?? p.title, description: p.seo?.description, path: `/pages/${p.slug}`, noindex: !!p.preview });
  }, [page.status, page.value, seo]);

  if (page.status === 'loading') {
    return (
      <>
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="mt-4 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-3/4" />
      </>
    );
  }
  if (page.status === 'error') {
    return page.error instanceof ApiException && page.error.code === 'not_found' ? <NotFound /> : <ErrorState onRetry={page.reload} />;
  }
  const p = page.value;
  if (!p) return null;
  return (
    <article className="max-w-3xl">
      {p.preview && (
        <p className="mb-4 rounded-md border border-warning p-3 text-sm" role="status">
          Preview: this draft is not visible to shoppers.
        </p>
      )}
      <h1 className="mb-4 text-3xl font-bold">{p.title}</h1>
      <div className="space-y-3 text-text [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(p.body) }} />
    </article>
  );
}

/**
 * Catch-all route. If staff set up a redirect for this address it navigates there permanently; otherwise it shows the 404 page.
 */
export function RedirectOrNotFound() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const api = useService(ContentApi);
  const lookup = useResource(() => api.redirectFor(pathname), [api, pathname]);
  const target = lookup.status === 'ready' ? lookup.value : undefined;

  useEffect(() => {
    if (!target) return;
    if (target.startsWith('/')) navigate(target, { replace: true });
    else window.location.replace(target);
  }, [target, navigate]);

  return lookup.status === 'ready' && lookup.value === null ? <NotFound /> : null;
}
