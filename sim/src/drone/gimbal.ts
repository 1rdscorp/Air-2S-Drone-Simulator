import type { ButtonId } from '../input/types';
import { AIR_2S_SPECS, GIMBAL_TUNING } from './air2s.config';
import type { DroneState } from './droneState';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Below this speed, in rad/s, a gimbal that should be still is treated as still. */
const RESTING_RATE = 1e-6;

/** Highest tilt the pilot can command: level, or a little above level with the upward setting. */
export function gimbalUpperLimit(allowUpward: boolean): number {
  return allowUpward ? AIR_2S_SPECS.gimbal.tiltMaxExtended : AIR_2S_SPECS.gimbal.tiltMax;
}

/**
 * Moves the camera gimbal for one step.
 *
 * The gimbal keeps the camera steady: its tilt is measured against the horizon, not
 * against the aircraft, so the picture does not move when the aircraft tilts. The pilot
 * changes only the tilt, from straight down (-90°) to level (0°), or a little above level
 * when the upward setting is on.
 *
 *   dial      tilts up or down; the further it is turned, the faster. The movement
 *             starts and stops softly.
 *   C1        back to level ("recentre")
 *   C2        straight down
 *
 * A shortcut is a quick, smooth move; turning the dial during it takes over again.
 * Whatever was done last counts: a dial that is turned at the moment a shortcut is
 * pressed (a finger still on it, or the dial just springing back to its middle) is
 * overruled by the shortcut, and is listened to again once it has been let go.
 *
 * @param dial dial deflection, -1 (down) to 1 (up)
 * @param allowUpward the setting that lets the camera tilt above level
 */
export function stepGimbal(
  state: DroneState,
  dial: number,
  buttons: Readonly<Record<ButtonId, boolean>>,
  dt: number,
  allowUpward: boolean,
): void {
  const lowest = AIR_2S_SPECS.gimbal.tiltMin;
  const highest = gimbalUpperLimit(allowUpward);

  const turned = Number.isFinite(dial) ? clamp(dial, -1, 1) : 0;

  // Shortcut buttons act once per press.
  const recentrePressed = buttons.c1 && !state.c1ButtonWasDown;
  const lookDownPressed = buttons.c2 && !state.c2ButtonWasDown;
  state.c1ButtonWasDown = buttons.c1;
  state.c2ButtonWasDown = buttons.c2;
  if (recentrePressed || lookDownPressed) {
    state.gimbalMovingToTarget = true;
    state.gimbalTarget = recentrePressed ? 0 : lowest;
    state.gimbalDialOverruled = turned !== 0; // the shortcut came after the turn
  }
  if (turned === 0) {
    state.gimbalDialOverruled = false; // let go: from now on the dial counts again
  }

  const turn = state.gimbalDialOverruled ? 0 : turned;
  if (turn !== 0) {
    state.gimbalMovingToTarget = false; // the pilot's hand on the dial wins
  }

  let wantedRate: number;
  if (state.gimbalMovingToTarget) {
    const remaining = state.gimbalTarget - state.gimbalTilt;
    wantedRate = clamp(
      GIMBAL_TUNING.shortcutGain * remaining,
      -GIMBAL_TUNING.shortcutSpeed,
      GIMBAL_TUNING.shortcutSpeed,
    );
    if (Math.abs(remaining) < 1e-4 && Math.abs(state.gimbalRate) < 1e-3) {
      // Arrived: rest exactly on the target.
      state.gimbalTilt = state.gimbalTarget;
      state.gimbalRate = 0;
      state.gimbalMovingToTarget = false;
      return;
    }
  } else {
    wantedRate = turn * GIMBAL_TUNING.dialSpeed;
  }

  // The motor follows the wanted speed with a short delay, so starts and stops are soft.
  const share = Math.min(dt / GIMBAL_TUNING.smoothingSeconds, 1);
  state.gimbalRate += (wantedRate - state.gimbalRate) * share;
  if (wantedRate === 0 && Math.abs(state.gimbalRate) < RESTING_RATE) {
    state.gimbalRate = 0; // come to a complete rest instead of creeping for ever
  }
  state.gimbalRate = clamp(
    state.gimbalRate,
    -AIR_2S_SPECS.gimbal.maxTiltSpeed,
    AIR_2S_SPECS.gimbal.maxTiltSpeed,
  );
  state.gimbalTilt += state.gimbalRate * dt;

  // End stops: the camera cannot go past them, and does not keep pushing against them.
  if (state.gimbalTilt >= highest) {
    state.gimbalTilt = highest;
    state.gimbalRate = Math.min(state.gimbalRate, 0);
  } else if (state.gimbalTilt <= lowest) {
    state.gimbalTilt = lowest;
    state.gimbalRate = Math.max(state.gimbalRate, 0);
  }
}
