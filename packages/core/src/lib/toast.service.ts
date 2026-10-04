import { Injectable, signal } from '../runtime';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 1;
  private readonly _toasts = signal<Toast[]>([]);
  readonly toasts = this._toasts.asReadonly();

  show(kind: ToastKind, message: string, durationMs = 5000): void {
    const id = this.nextId++;
    this._toasts.update((list) => [...list, { id, kind, message }]);
    if (durationMs > 0) setTimeout(() => this.dismiss(id), durationMs);
  }
  success(message: string): void {
    this.show('success', message);
  }
  error(message: string): void {
    this.show('error', message, 8000);
  }
  info(message: string): void {
    this.show('info', message);
  }
  dismiss(id: number): void {
    this._toasts.update((list) => list.filter((t) => t.id !== id));
  }
}
