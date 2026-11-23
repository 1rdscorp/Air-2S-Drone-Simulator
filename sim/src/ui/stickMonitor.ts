import type { InputManager } from '../input/inputManager';
import { AXIS_FUNCTION_NAMES, STICK_LAYOUTS } from '../input/stickModes';
import {
  BUTTON_IDS,
  type ButtonId,
  FLIGHT_MODE_NAMES,
  type FlightMode,
  type StickMode,
} from '../input/types';

const BUTTON_LABELS: Record<ButtonId, string> = {
  takeoffLand: 'Take-off',
  rth: 'RTH',
  pause: 'Pause',
  record: 'Rec',
  shutter: 'Photo',
  c1: 'C1',
  c2: 'C2',
};

/** Text under a stick: what its two axes do in this stick mode, vertical axis first. */
export function stickCaption(side: 'left' | 'right', stickMode: StickMode): string {
  const layout = STICK_LAYOUTS[stickMode];
  const vertical = side === 'left' ? layout.leftY : layout.rightY;
  const horizontal = side === 'left' ? layout.leftX : layout.rightX;
  return `${AXIS_FUNCTION_NAMES[vertical]} · ${AXIS_FUNCTION_NAMES[horizontal]}`;
}

/** The line under the sticks: which device is in use, stick mode and flight mode. */
export function statusLine(
  sourceLabel: string,
  connected: boolean,
  stickMode: StickMode,
  flightMode: FlightMode,
): string {
  const device = connected ? sourceLabel : `${sourceLabel} (not connected)`;
  return `${device} · Stick mode ${stickMode} · ${FLIGHT_MODE_NAMES[flightMode]}`;
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

interface StickView {
  pad: HTMLElement;
  caption: HTMLElement;
}

/**
 * Shows the two sticks, the gimbal dial and the buttons as the simulator sees them.
 * The ring is the stick as the device reports it; the dot is the value after deadzone
 * and expo, which is what flies the drone.
 */
export class StickMonitor {
  private readonly left: StickView;
  private readonly right: StickView;
  private readonly gimbal: HTMLElement;
  private readonly buttons = new Map<ButtonId, HTMLElement>();
  private readonly status: HTMLElement;
  private lastStatus = '';
  private lastStickMode: StickMode | null = null;

  constructor(private readonly root: HTMLElement) {
    root.replaceChildren();

    const row = element('div', 'sm-row');
    this.left = this.buildStick('left');
    this.right = this.buildStick('right');

    const gimbalBox = element('div', 'sm-gimbal');
    const track = element('div', 'sm-gimbal-track');
    this.gimbal = element('i', 'sm-gimbal-thumb');
    track.append(this.gimbal);
    gimbalBox.append(track, element('span', 'sm-caption', 'Gimbal'));

    row.append(this.left.pad.parentElement ?? this.left.pad, gimbalBox);
    row.append(this.right.pad.parentElement ?? this.right.pad);

    const buttonRow = element('ul', 'sm-buttons');
    for (const id of BUTTON_IDS) {
      const pill = element('li', 'sm-button', BUTTON_LABELS[id]);
      pill.dataset.button = id;
      this.buttons.set(id, pill);
      buttonRow.append(pill);
    }

    this.status = element('p', 'sm-status');
    root.append(row, buttonRow, this.status);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  set visible(value: boolean) {
    this.root.hidden = !value;
  }

  toggle(): void {
    this.visible = !this.visible;
  }

  /** Call once per display frame. */
  update(input: InputManager): void {
    if (!this.visible) {
      return;
    }
    const { frame, raw, shaped, settings, activeSource } = input;

    this.place(this.left.pad, raw.leftX, raw.leftY, shaped.leftX, shaped.leftY);
    this.place(this.right.pad, raw.rightX, raw.rightY, shaped.rightX, shaped.rightY);
    this.gimbal.style.setProperty('--y', frame.gimbal.toFixed(3));

    for (const [id, pill] of this.buttons) {
      pill.classList.toggle('is-on', frame.buttons[id]);
    }

    if (settings.stickMode !== this.lastStickMode) {
      this.lastStickMode = settings.stickMode;
      this.left.caption.textContent = stickCaption('left', settings.stickMode);
      this.right.caption.textContent = stickCaption('right', settings.stickMode);
    }

    const status = statusLine(activeSource.label, frame.connected, settings.stickMode, frame.mode);
    if (status !== this.lastStatus) {
      this.lastStatus = status;
      this.status.textContent = status;
    }
    this.root.classList.toggle('is-disconnected', !frame.connected);
  }

  private buildStick(side: 'left' | 'right'): StickView {
    const figure = element('figure', 'sm-stick');
    figure.dataset.stick = side;
    const pad = element('div', 'sm-pad');
    pad.append(element('i', 'sm-ring'), element('i', 'sm-dot'));
    const caption = element('figcaption', 'sm-caption');
    figure.append(pad, caption);
    return { pad, caption };
  }

  private place(pad: HTMLElement, rawX: number, rawY: number, x: number, y: number): void {
    pad.style.setProperty('--raw-x', rawX.toFixed(3));
    pad.style.setProperty('--raw-y', rawY.toFixed(3));
    pad.style.setProperty('--x', x.toFixed(3));
    pad.style.setProperty('--y', y.toFixed(3));
  }
}
