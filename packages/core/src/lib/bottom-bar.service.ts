import { Injectable, signal } from '../runtime';

/**
 * Lets independent fixed bottom bars stack instead of overlap on small screens, without one feature
 * needing to import another (the module boundaries do not allow that). A page with its own full-width
 * mobile action bar (for example the product page) reports it here; other bars (for example the compare
 * bar) read it and get out of the way on mobile, where there is only room for one.
 */
@Injectable({ providedIn: 'root' })
export class BottomBarService {
  private readonly _primaryActionVisible = signal(false);
  readonly primaryActionVisible = this._primaryActionVisible.asReadonly();

  setPrimaryActionVisible(visible: boolean): void {
    this._primaryActionVisible.set(visible);
  }
}
