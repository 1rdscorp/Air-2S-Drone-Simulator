import { SIM_HZ } from '../core/gameLoop';
import type { SimParams } from '../core/params';
import type { FlightPhase } from '../drone/droneState';
import { PHASE_LABELS } from './flightStatus';

export interface DebugInfo {
  fps: number;
  frameMs: number;
  maxFrameMs: number;
  drawCalls: number;
  triangles: number;
  tick: number;
  simTime: number;
  timeScale: number;
  paused: boolean;
  /** Name of the control source in use. */
  inputSource: string;
  /** Name of the camera view in use. */
  camera: string;
  drone: {
    phase: FlightPhase;
    /** Height above the ground in metres. */
    height: number;
    /** Speed over the ground in m/s. */
    speed: number;
    /** Climb rate in m/s; negative is descending. */
    climbRate: number;
    /** Compass heading, 0 to 360 degrees. */
    headingDeg: number;
    onGround: boolean;
    /** Camera tilt against the horizon in degrees; negative looks down. */
    gimbalDeg: number;
  };
  params: Readonly<SimParams>;
}

/** How often the overlay text is refreshed. Faster than this is unreadable. */
const REFRESH_SECONDS = 0.25;

/** Formats a speed such as 0.5 or 2 as "0.5×" or "2×". */
export function formatTimeScale(scale: number): string {
  return `${Number(scale.toFixed(2))}×`;
}

/** Flight numbers in one line, for example "flying · 12.0 m · 15.0 m/s · climb +0.0 m/s · 045°". */
export function formatDrone(drone: DebugInfo['drone']): string {
  // Avoids "-0.0" and always shows the sign, so climbing and descending are easy to tell apart.
  const climb = Math.abs(drone.climbRate) < 0.05 ? 0 : drone.climbRate;
  const heading = String(Math.round(drone.headingDeg) % 360).padStart(3, '0');
  const falling = drone.phase === 'motorsOff' && !drone.onGround;
  const parts = [
    falling ? 'falling' : PHASE_LABELS[drone.phase],
    `${drone.height.toFixed(1)} m`,
    `${drone.speed.toFixed(1)} m/s`,
    `climb ${climb >= 0 ? '+' : '−'}${Math.abs(climb).toFixed(1)} m/s`,
    `${heading}°`,
  ];
  return parts.join(' · ');
}

/** Camera tilt for display, for example "−45°" (looking down) or "+10°". Level is "0°". */
export function formatGimbal(degrees: number): string {
  const rounded = Math.round(degrees);
  if (rounded === 0) {
    return '0°';
  }
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}°`;
}

/** The overlay text. A pure function, so it can be tested without a browser. */
export function formatDebugText(info: DebugInfo): string {
  const { params } = info;
  const rows: [string, string][] = [
    ['FPS', info.fps.toFixed(0)],
    ['Frame', `${info.frameMs.toFixed(1)} ms (max ${info.maxFrameMs.toFixed(1)})`],
    ['Draw calls', String(info.drawCalls)],
    ['Triangles', info.triangles.toLocaleString('en-US')],
    ['Sim', `${SIM_HZ} Hz · tick ${info.tick} · ${info.simTime.toFixed(2)} s`],
    ['Speed', `${formatTimeScale(info.timeScale)}${info.paused ? ' · paused' : ''}`],
    ['Drone', formatDrone(info.drone)],
    ['Input', `${info.inputSource} · stick mode ${params.stickMode}`],
    ['Camera', `${info.camera} · gimbal ${formatGimbal(info.drone.gimbalDeg)}`],
    ['Env', params.env ?? '–'],
    ['Time of day', params.timeOfDay === null ? '–' : `${params.timeOfDay} h`],
    ['Seed', String(params.seed)],
    ['Quality', params.quality ?? '–'],
  ];
  const labelWidth = Math.max(...rows.map(([label]) => label.length));
  const lines = rows.map(([label, value]) => `${label.padEnd(labelWidth)}  ${value}`);
  lines.push('', '`/F2 overlay · I sticks · V camera · P pause · . step · − = speed · ⌫ restart');
  return lines.join('\n');
}

/** The debug panel in the top-left corner. */
export class DebugOverlay {
  private sinceRefresh = Number.POSITIVE_INFINITY;

  constructor(private readonly element: HTMLElement) {}

  get visible(): boolean {
    return !this.element.hidden;
  }

  set visible(value: boolean) {
    this.element.hidden = !value;
    this.refreshSoon();
  }

  /** Rewrite the text on the next frame instead of waiting for the usual interval. */
  refreshSoon(): void {
    this.sinceRefresh = Number.POSITIVE_INFINITY;
  }

  toggle(): void {
    this.visible = !this.visible;
  }

  /**
   * Call once per display frame. Rewrites the text a few times per second.
   * @param getInfo only called when the text is about to be rewritten
   */
  update(frameSeconds: number, getInfo: () => DebugInfo): void {
    if (!this.visible) {
      return;
    }
    this.sinceRefresh += frameSeconds;
    if (this.sinceRefresh >= REFRESH_SECONDS) {
      this.sinceRefresh = 0;
      this.element.textContent = formatDebugText(getInfo());
    }
  }
}
