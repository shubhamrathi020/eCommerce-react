import type { Observable } from 'rxjs';

export abstract class NewsletterApi {
  /** Completes on success; errors with an `ApiError` (`validation`) for a bad address. */
  abstract subscribe(email: string): Observable<void>;
}
