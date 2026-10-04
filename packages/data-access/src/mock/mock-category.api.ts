import { Injectable } from '@shop/core';
import { defer, from, mergeMap } from 'rxjs';
import type { Category, CategoryNode } from '@ecom/contracts';
import { CategoryApi } from '../lib/category.api';
import { createMockResponder } from './mock-latency';

function buildTree(flat: Category[]): CategoryNode[] {
  const nodes = new Map<string, CategoryNode>(flat.map((c) => [c.id, { ...c, children: [] }]));
  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const sort = (list: CategoryNode[]): CategoryNode[] => {
    list.sort((a, b) => a.order - b.order);
    list.forEach((n) => sort(n.children));
    return list;
  };
  return sort(roots);
}

@Injectable()
export class MockCategoryApi extends CategoryApi {
  private readonly respond = createMockResponder();

  tree() {
    // Loaded lazily so the fixture stays out of the initial bundle.
    return defer(() => from(import('./data/categories.json'))).pipe(
      mergeMap((m) => this.respond.ok(() => buildTree(m.default as unknown as Category[]))),
    );
  }
}
