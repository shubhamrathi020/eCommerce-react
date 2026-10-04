import { Injectable } from '@shop/core';
import { NewsletterApi } from '../lib/newsletter.api';
import { createMockResponder } from './mock-latency';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class MockNewsletterApi extends NewsletterApi {
  private readonly respond = createMockResponder();

  subscribe(email: string) {
    return EMAIL.test(email.trim())
      ? this.respond.ok(() => undefined)
      : this.respond.fail<void>({ code: 'validation', message: 'Enter a valid email address', fields: { email: 'Invalid email' } });
  }
}
