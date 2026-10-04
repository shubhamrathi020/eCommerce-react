import { Injectable, inject } from '@shop/core';
import type { DeliveryLogEntry, DeliveryQuery, MessageTemplate, Paged } from '@ecom/contracts';
import { AdminNotificationApi } from '../../lib/notification.api';
import { MockNotificationStore } from '../notification-store';
import { createMockResponder } from '../mock-latency';
import { MockAdminState } from './admin-state';

const page = <T>(rows: T[], query: { page: number; pageSize: number }): Paged<T> => {
  const pageSize = Math.max(1, query.pageSize);
  const current = Math.min(Math.max(1, query.page), Math.max(1, Math.ceil(rows.length / pageSize)));
  return { total: rows.length, page: current, pageSize, items: rows.slice((current - 1) * pageSize, current * pageSize) };
};

@Injectable()
export class MockAdminNotificationApi extends AdminNotificationApi {
  private readonly respond = createMockResponder();
  private readonly state = inject(MockAdminState);
  private readonly store = inject(MockNotificationStore);

  templates() {
    return this.respond.okAsync<MessageTemplate[]>(async () => {
      this.state.require('notification:manage');
      return this.store.templates();
    });
  }

  template(key: string) {
    return this.respond.okAsync<MessageTemplate>(async () => {
      this.state.require('notification:manage');
      return this.store.template(key);
    });
  }

  saveTemplate(key: string, input: { subject: string; body: string }) {
    return this.respond.okAsync<MessageTemplate>(async () => {
      const actor = this.state.require('notification:manage');
      const saved = this.store.saveTemplate(key, input, actor.name);
      this.state.record('notification.template', saved.name, `Edited (version ${saved.version})`);
      return saved;
    });
  }

  restoreVersion(key: string, version: number) {
    return this.respond.okAsync<MessageTemplate>(async () => {
      const actor = this.state.require('notification:manage');
      const restored = this.store.restoreVersion(key, version, actor.name);
      this.state.record('notification.template', restored.name, `Restored version ${version} (now version ${restored.version})`);
      return restored;
    });
  }

  sendTest(key: string) {
    return this.respond.okAsync<void>(async () => {
      const actor = this.state.require('notification:manage');
      this.store.sendTest(key, actor.email);
      this.state.record('notification.test', key, `Sent a test message to ${actor.email}`);
    });
  }

  deliveryLog(query: DeliveryQuery) {
    return this.respond.okAsync<Paged<DeliveryLogEntry>>(async () => {
      this.state.require('notification:manage');
      const q = query.q?.trim().toLowerCase();
      const rows = this.store.deliveryLog().filter((e) => (!query.status || e.status === query.status) && (!q || `${e.to} ${e.subject} ${e.templateKey}`.toLowerCase().includes(q)));
      return page(rows, query);
    });
  }

  retry(id: string) {
    return this.respond.okAsync<DeliveryLogEntry>(async () => {
      const actor = this.state.require('notification:manage');
      const retried = this.store.retry(id, actor.name);
      this.state.record('notification.retry', retried.to, `Retried delivery of "${retried.subject}"`);
      return retried;
    });
  }
}
