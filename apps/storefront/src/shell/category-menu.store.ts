import { firstValueFrom } from 'rxjs';
import type { CategoryNode } from '@ecom/contracts';
import { Injectable, inject, signal } from '@shop/core';
import { CategoryApi } from '@shop/data-access';

/** Category tree for navigation. Loaded once for the app lifetime (categories change rarely). */
@Injectable({ providedIn: 'root' })
export class CategoryMenuStore {
  private readonly api = inject(CategoryApi);
  private readonly _roots = signal<CategoryNode[]>([]);
  private readonly _loading = signal(true);
  readonly roots = this._roots.asReadonly();
  readonly loading = this._loading.asReadonly();

  constructor() {
    firstValueFrom(this.api.tree())
      .then((tree) => this._roots.set(tree))
      .catch(() => this._roots.set([]))
      .finally(() => this._loading.set(false));
  }
}
