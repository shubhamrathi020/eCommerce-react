import { Injectable, inject } from '@shop/core';
import { STORAGE } from '@shop/core';
import type { SavedAddress } from '@ecom/contracts';
import { ApiException } from '@ecom/contracts';
import { type AddressInput, AddressBookApi } from '../lib/account.api';
import { createMockResponder } from './mock-latency';
import { MockUserStore } from './mock-user-store';

const KEY = 'ecom.mock.addresses.v1';
const PHONE = /^[6-9][0-9]{9}$/;
const PINCODE = /^[1-9][0-9]{5}$/;
const MAX_ADDRESSES = 10;

@Injectable({ providedIn: 'root' })
export class MockAddressStore {
  private readonly storage = inject(STORAGE);

  list(userId: string): SavedAddress[] {
    return this.readAll()[userId] ?? [];
  }

  save(userId: string, list: SavedAddress[]): void {
    this.writeAll({ ...this.readAll(), [userId]: list });
  }

  removeAll(userId: string): void {
    const all = this.readAll();
    delete all[userId];
    this.writeAll(all);
  }

  private readAll(): Record<string, SavedAddress[]> {
    try {
      const raw = this.storage.getItem(KEY);
      return raw ? (JSON.parse(raw) as Record<string, SavedAddress[]>) : {};
    } catch {
      return {};
    }
  }

  private writeAll(value: Record<string, SavedAddress[]>): void {
    try {
      this.storage.setItem(KEY, JSON.stringify(value));
    } catch {
      // Storage full or blocked.
    }
  }
}

function validate(input: AddressInput): void {
  const fields: Record<string, string> = {};
  if (!input.label.trim() || input.label.length > 30) fields['label'] = 'Give this address a short label';
  if (!input.name.trim()) fields['name'] = 'Name is required';
  if (!PHONE.test(input.phone)) fields['phone'] = 'Enter a valid 10-digit mobile number';
  if (!input.address.line1.trim()) fields['line1'] = 'Address is required';
  if (!input.address.city.trim()) fields['city'] = 'City is required';
  if (!input.address.state.trim()) fields['state'] = 'State is required';
  if (!PINCODE.test(input.address.pincode)) fields['pincode'] = 'Enter a valid 6-digit pin code';
  if (Object.keys(fields).length) throw new ApiException('validation', 'Please check the highlighted fields.', fields);
}

const normalise = (input: AddressInput): AddressInput => ({
  label: input.label.trim(),
  name: input.name.trim(),
  phone: input.phone,
  address: { line1: input.address.line1.trim(), ...(input.address.line2?.trim() ? { line2: input.address.line2.trim() } : {}), city: input.address.city.trim(), state: input.address.state.trim(), pincode: input.address.pincode },
});

@Injectable()
export class MockAddressBookApi extends AddressBookApi {
  private readonly respond = createMockResponder();
  private readonly users = inject(MockUserStore);
  private readonly store = inject(MockAddressStore);

  private userId(): string {
    const id = this.users.currentUserId();
    if (!id) throw new ApiException('unauthorized', 'Please sign in to manage your addresses.');
    return id;
  }

  list() {
    return this.respond.okAsync(async () => {
      await this.users.ensureSeeded();
      return this.store.list(this.userId());
    });
  }

  add(input: AddressInput) {
    return this.respond.okAsync(async () => {
      const userId = this.userId();
      validate(input);
      const list = this.store.list(userId);
      if (list.length >= MAX_ADDRESSES) throw new ApiException('validation', `You can save up to ${MAX_ADDRESSES} addresses.`);
      const next = [...list, { id: `addr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, ...normalise(input), isDefault: list.length === 0 }];
      this.store.save(userId, next);
      return next;
    });
  }

  update(id: string, input: AddressInput) {
    return this.respond.okAsync(async () => {
      const userId = this.userId();
      validate(input);
      const list = this.store.list(userId);
      if (!list.some((a) => a.id === id)) throw new ApiException('not_found', 'Address not found');
      const next = list.map((a) => (a.id === id ? { ...a, ...normalise(input) } : a));
      this.store.save(userId, next);
      return next;
    });
  }

  remove(id: string) {
    return this.respond.okAsync(async () => {
      const userId = this.userId();
      let next = this.store.list(userId).filter((a) => a.id !== id);
      // Removing the default promotes the first remaining address.
      if (next.length && !next.some((a) => a.isDefault)) next = next.map((a, i) => ({ ...a, isDefault: i === 0 }));
      this.store.save(userId, next);
      return next;
    });
  }

  setDefault(id: string) {
    return this.respond.okAsync(async () => {
      const userId = this.userId();
      const list = this.store.list(userId);
      if (!list.some((a) => a.id === id)) throw new ApiException('not_found', 'Address not found');
      const next = list.map((a) => ({ ...a, isDefault: a.id === id }));
      this.store.save(userId, next);
      return next;
    });
  }
}
