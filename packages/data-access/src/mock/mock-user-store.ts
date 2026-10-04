import { Injectable, inject } from '@shop/core';
import { STORAGE } from '@shop/core';
import type { Role, Session, User } from '@ecom/contracts';
import { DEMO_ACCOUNTS, permissionsFor } from './demo-accounts';

/** Server-side record. The password hash and tokens never leave the mock "server". */
export interface StoredUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  roles: Role[];
  emailVerified: boolean;
  createdAt: string;
  salt: string;
  passwordHash: string;
  verifyToken?: string;
  reset?: { token: string; expiresAt: string };
}

interface AttemptRecord {
  count: number;
  firstAt: number;
  lockedUntil?: number;
}

const USERS_KEY = 'ecom.mock.users.v1';
const SESSION_KEY = 'ecom.mock.session.v1';
const ATTEMPTS_KEY = 'ecom.mock.login-attempts.v1';
const SESSION_HOURS = 12;

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

/** cyrb53 string hash: only a fallback for contexts without Web Crypto (plain http, some test runners). */
function fallbackHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `fb${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)}`;
}

/** Salted SHA-256 (mock). A real backend uses Argon2id and never exposes hashes to the browser. */
export async function hashPassword(password: string, salt: string): Promise<string> {
  const text = `${salt}:${password}`;
  if (!globalThis.crypto?.subtle) return fallbackHash(text);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export const toUser = (u: StoredUser): User => ({
  id: u.id,
  name: u.name,
  email: u.email,
  ...(u.phone ? { phone: u.phone } : {}),
  roles: u.roles,
  permissions: permissionsFor(u.roles),
  emailVerified: u.emailVerified,
  createdAt: u.createdAt,
});

/** Device-local identity storage for the mock adapters. */
@Injectable({ providedIn: 'root' })
export class MockUserStore {
  private readonly storage = inject(STORAGE);
  private seeding?: Promise<void>;

  /** Seeds the demo accounts once. Call before reading users. */
  ensureSeeded(): Promise<void> {
    this.seeding ??= (async () => {
      // Demo accounts added by later features (for example the demo seller) are created for browsers that already hold users.
      const users: StoredUser[] = this.storage.getItem(USERS_KEY) ? this.users() : [];
      const missing = DEMO_ACCOUNTS.filter((d) => !users.some((u) => u.id === d.id));
      if (missing.length === 0) return;
      for (const demo of missing) {
        const salt = randomToken();
        users.push({ id: demo.id, name: demo.name, email: demo.email, roles: demo.roles, emailVerified: true, createdAt: new Date().toISOString(), salt, passwordHash: await hashPassword(demo.password, salt) });
      }
      this.saveUsers(users);
    })();
    return this.seeding;
  }

  users(): StoredUser[] {
    return this.read<StoredUser[]>(USERS_KEY, []);
  }

  saveUsers(users: StoredUser[]): void {
    this.write(USERS_KEY, users);
  }

  findByEmail(email: string): StoredUser | undefined {
    const e = email.trim().toLowerCase();
    return this.users().find((u) => u.email.toLowerCase() === e);
  }

  update(user: StoredUser): void {
    this.saveUsers(this.users().map((u) => (u.id === user.id ? user : u)));
  }

  // ---- session (mock of the HttpOnly cookie) ----
  session(): Session | null {
    const stored = this.read<{ userId: string; expiresAt: string } | null>(SESSION_KEY, null);
    if (!stored || new Date(stored.expiresAt).getTime() < Date.now()) return null;
    const user = this.users().find((u) => u.id === stored.userId);
    return user ? { user: toUser(user), expiresAt: stored.expiresAt } : null;
  }

  currentUserId(): string | null {
    return this.session()?.user.id ?? null;
  }

  startSession(user: StoredUser): Session {
    const expiresAt = new Date(Date.now() + SESSION_HOURS * 3_600_000).toISOString();
    this.write(SESSION_KEY, { userId: user.id, expiresAt });
    return { user: toUser(user), expiresAt };
  }

  endSession(): void {
    this.storage.removeItem(SESSION_KEY);
  }

  /**
   * Transitional bridge while only identity runs on the real API (`realAuth`): mirrors the real session here so
   * the mock cart, orders, reviews and admin screens still know who is signed in. The mirrored record holds no
   * password and cannot be used to sign in to the mock.
   */
  mirrorSession(session: Session): void {
    const { user } = session;
    const existing = this.users().find((u) => u.id === user.id);
    const mirrored: StoredUser = { ...(existing ?? { salt: '', passwordHash: '' }), id: user.id, name: user.name, email: user.email, ...(user.phone ? { phone: user.phone } : {}), roles: user.roles, emailVerified: user.emailVerified, createdAt: user.createdAt };
    this.saveUsers([...this.users().filter((u) => u.id !== user.id), mirrored]);
    this.write(SESSION_KEY, { userId: user.id, expiresAt: session.expiresAt });
  }

  // ---- brute-force protection ----
  attemptsFor(email: string): AttemptRecord | undefined {
    return this.read<Record<string, AttemptRecord>>(ATTEMPTS_KEY, {})[email.trim().toLowerCase()];
  }

  saveAttempts(email: string, record: AttemptRecord | null): void {
    const all = this.read<Record<string, AttemptRecord>>(ATTEMPTS_KEY, {});
    const key = email.trim().toLowerCase();
    if (record) all[key] = record;
    else delete all[key];
    this.write(ATTEMPTS_KEY, all);
  }

  private read<T>(key: string, fallback: T): T {
    try {
      const raw = this.storage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }

  private write(key: string, value: unknown): void {
    try {
      this.storage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full or blocked.
    }
  }
}
