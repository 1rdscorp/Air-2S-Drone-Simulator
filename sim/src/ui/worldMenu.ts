import type { EnvId, EnvironmentInfo } from '../world/environment';

export interface WorldMenuHost {
  /** The place being flown in right now, if any. */
  current(): EnvId | null;
  /** Called when the pilot has chosen a place. */
  onChoose(id: EnvId): void;
  /** Called when the menu opens and when it closes, whatever the outcome. */
  onOpenChange(open: boolean): void;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

/** The entry to highlight after moving `step` up or down, skipping places that are not built. */
export function nextChoice(
  entries: readonly EnvironmentInfo[],
  from: number,
  step: 1 | -1,
): number {
  for (let moved = 1; moved <= entries.length; moved++) {
    const index = (from + step * moved + entries.length * moved) % entries.length;
    if (entries[index]?.create) {
      return index;
    }
  }
  return from;
}

/**
 * The list of places to fly: opened with E, a place is chosen with the arrow keys and
 * Enter, with its number, or with a click. Places that are not built yet are listed but
 * cannot be chosen. While it is open it takes the keyboard.
 */
export class WorldMenu {
  private readonly rows: HTMLButtonElement[] = [];
  private highlighted = 0;
  private open = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly entries: readonly EnvironmentInfo[],
    private readonly host: WorldMenuHost,
  ) {
    root.replaceChildren();
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Choose a place to fly');

    const panel = element('div', 'wm-panel');
    panel.append(element('h2', 'wm-heading', 'Where to fly'));
    const list = element('div', 'wm-list');
    entries.forEach((entry, index) => {
      const row = element('button', 'wm-row');
      row.type = 'button';
      row.dataset.env = entry.id;
      row.disabled = entry.create === null;
      row.append(
        element('span', 'wm-number', String(index + 1)),
        element('span', 'wm-name', entry.name),
        element('span', 'wm-summary', entry.create ? entry.summary : 'Not built yet'),
      );
      row.addEventListener('click', () => {
        this.choose(index);
      });
      this.rows.push(row);
      list.append(row);
    });
    const hint = element('p', 'wm-hint', '↑ ↓ and Enter, or the number · Esc closes');
    panel.append(list, hint);
    root.append(panel);
    // A click beside the panel closes the menu.
    root.addEventListener('click', (event) => {
      if (event.target === root) {
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(): void {
    if (this.open) {
      return;
    }
    this.open = true;
    const current = this.entries.findIndex((entry) => entry.id === this.host.current());
    this.highlight(current >= 0 ? current : 0);
    this.root.hidden = false;
    this.host.onOpenChange(true);
  }

  close(): void {
    if (!this.open) {
      return;
    }
    this.open = false;
    this.root.hidden = true;
    this.host.onOpenChange(false);
  }

  /**
   * Handles a key while the menu is open.
   * @returns true when the key was meant for the menu and must go nowhere else
   */
  handleKey(code: string): boolean {
    if (!this.open) {
      return false;
    }
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(code);
    if (digit) {
      this.choose(Number(digit[1]) - 1);
    } else if (code === 'ArrowDown' || code === 'ArrowUp') {
      this.highlight(nextChoice(this.entries, this.highlighted, code === 'ArrowDown' ? 1 : -1));
    } else if (code === 'Enter' || code === 'NumpadEnter') {
      this.choose(this.highlighted);
    } else if (code === 'Escape' || code === 'KeyE') {
      this.close();
    }
    // Every other key is swallowed as well: nothing flies while the menu is open.
    return true;
  }

  private highlight(index: number): void {
    this.highlighted = index;
    const current = this.host.current();
    this.rows.forEach((row, at) => {
      row.classList.toggle('is-highlighted', at === index);
      row.classList.toggle('is-current', this.entries[at]?.id === current);
    });
  }

  private choose(index: number): void {
    const entry = this.entries[index];
    if (!entry?.create) {
      return;
    }
    this.close();
    this.host.onChoose(entry.id);
  }
}

/** The label in the corner that names the place and says how to change it. */
export function worldLabelText(name: string | null): string {
  return name ? `${name} · E to change` : '';
}
