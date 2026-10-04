import { Injectable, inject } from '@shop/core';
import { STORAGE } from '@shop/core';

export interface MockMail {
  id: string;
  to: string;
  subject: string;
  body: string;
  /** Optional call-to-action path inside the app (for example a reset link). */
  link?: string;
  sentAt: string;
}

const KEY = 'ecom.mock.mailbox.v1';
const MAX = 50;

/** Stand-in for the email service: mails are stored locally and shown on the dev-only mailbox page. */
@Injectable({ providedIn: 'root' })
export class MockMailbox {
  private readonly storage = inject(STORAGE);

  send(mail: Omit<MockMail, 'id' | 'sentAt'>): void {
    const entry: MockMail = { ...mail, id: `mail_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, sentAt: new Date().toISOString() };
    this.write([entry, ...this.list()].slice(0, MAX));
  }

  list(): MockMail[] {
    try {
      const raw = this.storage.getItem(KEY);
      return raw ? (JSON.parse(raw) as MockMail[]) : [];
    } catch {
      return [];
    }
  }

  clear(): void {
    this.write([]);
  }

  private write(mails: MockMail[]): void {
    try {
      this.storage.setItem(KEY, JSON.stringify(mails));
    } catch {
      // Storage full or blocked.
    }
  }
}
