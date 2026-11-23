/** 'warning' is for things the pilot must not miss; it is shown longer and in another colour. */
export type ToastKind = 'info' | 'warning';

/** A short message for the pilot. */
export interface ToastMessage {
  /** Messages with the same key replace each other, so one subject never fills the list. */
  key: string;
  text: string;
  kind: ToastKind;
}

/** A message on the screen. */
export interface Toast extends ToastMessage {
  /** Counts up with every message; tells two messages with the same text apart. */
  id: number;
  /** Simulated time at which the message disappears, in seconds. */
  until: number;
}

/** How long a message stays, in simulated seconds. */
export const TOAST_SECONDS: Record<ToastKind, number> = { info: 4, warning: 7 };

/** More messages than this at once would cover the view. */
export const MAX_TOASTS = 3;

/**
 * The messages currently on the screen.
 *
 * Messages live in simulated time, not real time: they stay while the simulation is
 * paused, and a test that steps the simulation always sees the same messages.
 */
export class ToastList {
  private items: Toast[] = [];
  private nextId = 1;

  /** Shows a message from simulated time `now`. A message with the same key is replaced. */
  push(message: ToastMessage, now: number): void {
    this.items = this.items.filter((item) => item.key !== message.key);
    this.items.push({ ...message, id: this.nextId++, until: now + TOAST_SECONDS[message.kind] });
    if (this.items.length > MAX_TOASTS) {
      this.items.splice(0, this.items.length - MAX_TOASTS);
    }
  }

  /** The messages to show at simulated time `now`, oldest first. */
  active(now: number): readonly Toast[] {
    if (this.items.some((item) => item.until <= now)) {
      this.items = this.items.filter((item) => item.until > now);
    }
    return this.items;
  }

  clear(): void {
    this.items = [];
  }
}
