import { FLIGHT_MODE_NAMES, type FlightMode } from '../input/types';
import {
  compassPoint,
  formatBattery,
  formatClimb,
  formatDistance,
  formatFlightTime,
  formatGimbal,
  formatHeading,
  formatHeight,
  formatSpeed,
  type HudValues,
  wrap180,
} from './hudValues';
import type { Toast } from './toasts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Compass tape: how wide it is on screen and how much of the horizon it shows. */
export const COMPASS_WIDTH_PX = 300;
export const COMPASS_SPAN_DEG = 90;
const PX_PER_DEGREE = COMPASS_WIDTH_PX / COMPASS_SPAN_DEG;
/** The tape from top to bottom: a row for the home mark, the ticks, then the labels. */
const TAPE_HEIGHT_PX = 40;
const TAPE_TICKS_Y = 14;
const TAPE_LABELS_Y = 36;
/** The home mark stops this far from the centre of the tape and then shows an arrow. */
const COMPASS_HOME_LIMIT_PX = COMPASS_WIDTH_PX / 2 - 12;

/** Horizon instrument, in its own drawing units: the picture is 100 wide. */
const HORIZON_RADIUS = 36;
const HORIZON_UNITS_PER_DEGREE = 0.8;
const HOME_MARK_RADIUS = 44;

function html<K extends keyof HTMLElementTagNameMap>(
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

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number> = {},
  children: SVGElement[] = [],
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, String(value));
  }
  node.append(...children);
  return node;
}

/** Where the home mark sits on the compass tape, and whether home lies beyond its edge. */
export function compassHomePosition(
  heading: number,
  homeBearing: number,
): { offsetPx: number; beyond: 'left' | 'right' | null } {
  const offset = wrap180(homeBearing - heading) * PX_PER_DEGREE;
  if (offset > COMPASS_HOME_LIMIT_PX) {
    return { offsetPx: COMPASS_HOME_LIMIT_PX, beyond: 'right' };
  }
  if (offset < -COMPASS_HOME_LIMIT_PX) {
    return { offsetPx: -COMPASS_HOME_LIMIT_PX, beyond: 'left' };
  }
  return { offsetPx: offset, beyond: null };
}

/** Label under a tick of the compass tape: a compass point every 45°, otherwise the number. */
export function compassLabel(degrees: number): string {
  const bearing = ((degrees % 360) + 360) % 360;
  return bearing % 45 === 0 ? compassPoint(bearing) : String(bearing);
}

/**
 * Writes to the page only when the value has changed. The display is refreshed on every
 * frame, and most values stay the same from one frame to the next.
 */
class Cell {
  private last: string | null = null;

  constructor(private readonly write: (value: string) => void) {}

  set(value: string): void {
    if (value !== this.last) {
      this.last = value;
      this.write(value);
    }
  }
}

const textCell = (node: Element): Cell => new Cell((value) => (node.textContent = value));
const attributeCell = (node: Element, name: string): Cell =>
  new Cell((value) => node.setAttribute(name, value));

interface Readout {
  value: Cell;
  unit: Cell;
}

/**
 * The flight display: what a pilot needs to see while flying.
 *
 *   top left     flight mode, flight time, battery
 *   top centre   compass tape with the heading and a mark for the direction of home
 *   below it     short messages (take-off, landing, mode changes, warnings)
 *   bottom left  horizon instrument with the direction to home on its rim, and the
 *                numbers: height, distance from home, speed, climb rate, camera tilt
 *
 * The layout is our own. Every value carries a `data-hud` name so tests can read it.
 */
export class Hud {
  private readonly mode: Cell;
  private readonly modeClass: Cell;
  private readonly time: Cell;
  private readonly battery: Cell;
  private readonly batteryFill: Cell;

  private readonly tape: Cell;
  private readonly heading: Cell;
  private readonly point: Cell;
  private readonly compassHome: HTMLElement;
  private readonly compassHomeText: Cell;
  private readonly compassHomeLeft: Cell;

  private readonly horizon: Cell;
  private readonly rollPointer: Cell;
  private readonly attitudePitch: Cell;
  private readonly attitudeRoll: Cell;
  private readonly homeMark: SVGGElement;
  private readonly homeMarkShown: Cell;
  private readonly homeMarkPlace: Cell;
  private readonly homeMarkDirection: Cell;

  private readonly height: Readout;
  private readonly distance: Readout;
  private readonly speed: Readout;
  private readonly climb: Readout;
  private readonly gimbal: Readout;

  private readonly toasts: HTMLElement;
  private shownToasts = '';

  constructor(private readonly root: HTMLElement) {
    root.replaceChildren();

    // ---- Top left: mode, flight time, battery ------------------------------------------
    const top = html('div', 'hud-panel hud-top');
    const mode = html('span', 'hud-mode');
    mode.dataset.hud = 'mode';
    this.mode = textCell(mode);
    this.modeClass = new Cell((value) => (mode.dataset.mode = value));

    const time = html('span', 'hud-value');
    time.dataset.hud = 'time';
    this.time = textCell(time);
    const timeItem = html('span', 'hud-item');
    timeItem.append(html('span', 'hud-label', 'Flight time'), time);

    const batteryFill = svg('rect', { x: 2, y: 2, width: 20, height: 8, rx: 1 });
    const batteryIcon = svg('svg', { viewBox: '0 0 27 12', class: 'hud-battery-icon' }, [
      svg('rect', { x: 0.5, y: 0.5, width: 23, height: 11, rx: 2.5, class: 'hud-battery-case' }),
      svg('rect', { x: 24.5, y: 3.5, width: 2, height: 5, rx: 1, class: 'hud-battery-tip' }),
      batteryFill,
    ]);
    batteryFill.setAttribute('class', 'hud-battery-fill');
    this.batteryFill = attributeCell(batteryFill, 'width');
    const battery = html('span', 'hud-value');
    battery.dataset.hud = 'battery';
    this.battery = textCell(battery);
    const batteryItem = html('span', 'hud-item');
    batteryItem.append(batteryIcon, battery);

    top.append(mode, timeItem, batteryItem);

    // ---- Top centre: compass -----------------------------------------------------------
    const compass = html('div', 'hud-compass');
    compass.dataset.hud = 'compass';
    const tapeGroup = svg('g', {}, this.buildTape());
    const tape = svg(
      'svg',
      {
        viewBox: `0 0 ${COMPASS_WIDTH_PX} ${TAPE_HEIGHT_PX}`,
        class: 'hud-tape',
        'aria-hidden': 'true',
      },
      [tapeGroup],
    );
    this.tape = attributeCell(tapeGroup, 'transform');

    this.compassHome = html('span', 'hud-compass-home');
    this.compassHome.dataset.hud = 'compass-home';
    this.compassHome.hidden = true;
    this.compassHomeText = textCell(this.compassHome);
    this.compassHomeLeft = new Cell((value) => (this.compassHome.style.left = value));

    const window_ = html('div', 'hud-compass-window');
    window_.append(tape, html('i', 'hud-compass-needle'), this.compassHome);

    const readout = html('p', 'hud-panel hud-compass-readout');
    const heading = html('span', 'hud-value');
    heading.dataset.hud = 'heading';
    this.heading = textCell(heading);
    const point = html('span', 'hud-unit');
    point.dataset.hud = 'compass-point';
    this.point = textCell(point);
    readout.append(heading, point);
    compass.append(window_, readout);

    // ---- Messages ----------------------------------------------------------------------
    this.toasts = html('div', 'hud-toasts');
    this.toasts.dataset.hud = 'toasts';
    this.toasts.setAttribute('role', 'status');
    this.toasts.setAttribute('aria-live', 'polite');

    // ---- Bottom left: horizon and numbers ----------------------------------------------
    const flight = html('div', 'hud-panel hud-flight');

    const horizonGroup = svg('g', {}, this.buildHorizon());
    const rollPointer = svg('path', { d: 'M0 -36 L-3.5 -29.5 L3.5 -29.5 Z', class: 'hud-roll' });
    const homeLetter = svg('text', { x: 0, y: 0.5, class: 'hud-home-letter' });
    homeLetter.textContent = 'H';
    this.homeMark = svg('g', { class: 'hud-home-mark' }, [
      svg('circle', { r: 6.5, class: 'hud-home-disc' }),
      homeLetter,
    ]);
    this.homeMark.dataset.hud = 'home-direction';
    // Shown and hidden with `display`, so that hiding the whole display hides it too.
    this.homeMark.style.display = 'none';
    const attitude = svg(
      'svg',
      { viewBox: '-52 -52 104 104', class: 'hud-attitude', role: 'img' },
      [
        svg('defs', {}, [
          svg('clipPath', { id: 'hud-horizon-clip' }, [svg('circle', { r: HORIZON_RADIUS })]),
        ]),
        svg('g', { 'clip-path': 'url(#hud-horizon-clip)' }, [horizonGroup]),
        svg('circle', { r: HORIZON_RADIUS, class: 'hud-rim' }),
        ...[-30, -15, 0, 15, 30].map((angle) =>
          svg('line', {
            x1: 0,
            y1: -HORIZON_RADIUS,
            x2: 0,
            y2: -HORIZON_RADIUS - (angle === 0 ? 5 : 3),
            transform: `rotate(${angle})`,
            class: 'hud-roll-tick',
          }),
        ),
        rollPointer,
        // The aircraft itself: fixed, the horizon moves behind it.
        svg('path', { d: 'M-20 0 H-8 M8 0 H20', class: 'hud-wings' }),
        svg('circle', { r: 1.8, class: 'hud-nose' }),
        this.homeMark,
      ],
    );
    attitude.dataset.hud = 'attitude';
    attitude.setAttribute('aria-label', 'Horizon and direction to home');
    this.horizon = attributeCell(horizonGroup, 'transform');
    this.rollPointer = attributeCell(rollPointer, 'transform');
    this.attitudePitch = new Cell((value) => (attitude.dataset.pitch = value));
    this.attitudeRoll = new Cell((value) => (attitude.dataset.roll = value));
    this.homeMarkShown = new Cell((value) => (this.homeMark.style.display = value));
    this.homeMarkPlace = attributeCell(this.homeMark, 'transform');
    this.homeMarkDirection = new Cell((value) => (this.homeMark.dataset.direction = value));

    const readouts = html('dl', 'hud-readouts');
    this.height = this.buildReadout(readouts, 'height', 'Height', 'm');
    this.distance = this.buildReadout(readouts, 'distance', 'From home', 'm');
    this.speed = this.buildReadout(readouts, 'speed', 'Speed', 'm/s');
    this.climb = this.buildReadout(readouts, 'climb', 'Climb', 'm/s');
    this.gimbal = this.buildReadout(readouts, 'gimbal', 'Camera tilt', '');
    flight.append(attitude, readouts);

    root.append(top, compass, this.toasts, flight);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  set visible(value: boolean) {
    this.root.hidden = !value;
  }

  /** Call for every drawn frame. */
  update(values: HudValues, toasts: readonly Toast[]): void {
    this.showMode(values.mode);
    this.time.set(formatFlightTime(values.flightSeconds));
    this.battery.set(formatBattery(values.battery));
    this.batteryFill.set((20 * Math.min(Math.max(values.battery, 0), 100)) / 100 + '');

    // Compass: the tape slides so that the current heading sits under the needle.
    this.tape.set(
      `translate(${(COMPASS_WIDTH_PX / 2 - values.heading * PX_PER_DEGREE).toFixed(1)} 0)`,
    );
    this.heading.set(formatHeading(values.heading));
    this.point.set(compassPoint(values.heading));
    if (values.homeBearing === null) {
      this.compassHome.hidden = true;
    } else {
      const { offsetPx, beyond } = compassHomePosition(values.heading, values.homeBearing);
      this.compassHome.hidden = false;
      this.compassHomeLeft.set(`calc(50% + ${offsetPx.toFixed(1)}px)`);
      this.compassHomeText.set(beyond === 'left' ? '‹ H' : beyond === 'right' ? 'H ›' : 'H');
    }

    // Horizon: banking right turns the horizon left; nose down moves it up.
    const roll = values.roll.toFixed(1);
    const pitch = values.pitch.toFixed(1);
    this.horizon.set(
      `rotate(${(-values.roll).toFixed(1)}) translate(0 ${(-values.pitch * HORIZON_UNITS_PER_DEGREE).toFixed(1)})`,
    );
    this.rollPointer.set(`rotate(${(-values.roll).toFixed(1)})`);
    this.attitudeRoll.set(roll === '-0.0' ? '0.0' : roll);
    this.attitudePitch.set(pitch === '-0.0' ? '0.0' : pitch);

    // Home on the rim: straight up is straight ahead.
    if (values.homeDirection === null) {
      this.homeMarkShown.set('none');
      this.homeMarkDirection.set('');
    } else {
      const angle = (values.homeDirection * Math.PI) / 180;
      const x = Math.sin(angle) * HOME_MARK_RADIUS;
      const y = -Math.cos(angle) * HOME_MARK_RADIUS;
      this.homeMarkShown.set('');
      this.homeMarkPlace.set(`translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      this.homeMarkDirection.set(String(Math.round(values.homeDirection)));
    }

    this.height.value.set(formatHeight(values.height));
    const distance = formatDistance(values.distance);
    this.distance.value.set(distance.value);
    this.distance.unit.set(distance.unit);
    this.speed.value.set(formatSpeed(values.speed));
    this.climb.value.set(formatClimb(values.climb));
    this.gimbal.value.set(formatGimbal(values.gimbal));

    this.showToasts(toasts);
  }

  private showMode(mode: FlightMode): void {
    this.mode.set(FLIGHT_MODE_NAMES[mode]);
    this.modeClass.set(mode);
  }

  private showToasts(toasts: readonly Toast[]): void {
    const signature = toasts.map((toast) => toast.id).join(',');
    if (signature === this.shownToasts) {
      return;
    }
    this.shownToasts = signature;
    this.toasts.replaceChildren(
      ...toasts.map((toast) => {
        const line = html('p', `hud-toast is-${toast.kind}`, toast.text);
        line.dataset.toast = toast.key;
        return line;
      }),
    );
  }

  private buildReadout(list: HTMLElement, name: string, label: string, unit: string): Readout {
    const row = html('div', 'hud-readout');
    const value = html('span', 'hud-value');
    value.dataset.hud = name;
    const unitNode = html('span', 'hud-unit', unit);
    const data = html('dd', '');
    data.append(value, unitNode);
    row.append(html('dt', 'hud-label', label), data);
    list.append(row);
    return { value: textCell(value), unit: textCell(unitNode) };
  }

  /** Ticks every 5° and a label every 15°, with enough either side of 0° to 360° to slide. */
  private buildTape(): SVGElement[] {
    const parts: SVGElement[] = [];
    const margin = COMPASS_SPAN_DEG / 2 + 15;
    for (let degrees = -margin; degrees <= 360 + margin; degrees += 5) {
      const x = degrees * PX_PER_DEGREE;
      const labelled = degrees % 15 === 0;
      parts.push(
        svg('line', {
          x1: x,
          y1: TAPE_TICKS_Y,
          x2: x,
          y2: TAPE_TICKS_Y + (labelled ? 9 : 5),
          class: 'hud-tape-tick',
        }),
      );
      if (labelled) {
        const label = compassLabel(degrees);
        const text = svg('text', {
          x,
          y: TAPE_LABELS_Y,
          class: /^[NESW]$/.test(label) ? 'hud-tape-label is-cardinal' : 'hud-tape-label',
        });
        text.textContent = label;
        parts.push(text);
      }
    }
    return parts;
  }

  /** Sky, ground and the horizon line, with a short line every 10° of pitch. */
  private buildHorizon(): SVGElement[] {
    const parts: SVGElement[] = [
      svg('rect', { x: -150, y: -300, width: 300, height: 300, class: 'hud-sky' }),
      svg('rect', { x: -150, y: 0, width: 300, height: 300, class: 'hud-ground' }),
      svg('line', { x1: -150, y1: 0, x2: 150, y2: 0, class: 'hud-horizon-line' }),
    ];
    for (const degrees of [-30, -20, -10, 10, 20, 30]) {
      const y = degrees * HORIZON_UNITS_PER_DEGREE;
      parts.push(svg('line', { x1: -7, y1: y, x2: 7, y2: y, class: 'hud-pitch-line' }));
    }
    return parts;
  }
}
