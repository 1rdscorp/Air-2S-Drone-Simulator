import type { ButtonId } from '../input/types';
import { FLIGHT_PROCEDURE } from './air2s.config';
import type { DroneState } from './droneState';

/** The four stick values the flight controller works with, each from -1 to 1. */
export interface Sticks {
  roll: number;
  pitch: number;
  yaw: number;
  throttle: number;
}

/**
 * The stick command that starts and stops the motors: both sticks pulled down and pushed
 * either towards each other or away from each other.
 *
 * Seen as stick functions this is the same in every stick mode: throttle and pitch are
 * both fully down, and roll and yaw are fully over in opposite directions.
 */
export function isStickCommand(sticks: Sticks): boolean {
  const limit = FLIGHT_PROCEDURE.stickCommandThreshold;
  return (
    sticks.throttle <= -limit &&
    sticks.pitch <= -limit &&
    Math.abs(sticks.roll) >= limit &&
    Math.abs(sticks.yaw) >= limit &&
    sticks.roll * sticks.yaw < 0
  );
}

/** Automatic take-off is finished when the aircraft is at hover height and has all but stopped climbing. */
function hasReachedHoverHeight(state: DroneState): boolean {
  return Math.abs(FLIGHT_PROCEDURE.takeoffHeight - state.y) < 0.05 && Math.abs(state.vy) < 0.15;
}

/**
 * Decides what the aircraft is doing: reads the stick command and the buttons and moves
 * between motors off, idle, take-off, flying and landing. Changes only `state.phase` and
 * the timers and flags that belong to it; the motion itself is done by the flight model.
 *
 *   motors off --stick command--> idle --throttle up--> flying
 *   motors off or idle --take-off button--> taking off --hover height reached--> flying
 *   flying --take-off / landing button--> landing --touchdown--> motors off
 *   landing --button again, or flight pause--> flying
 *   idle --stick command, or throttle held down--> motors off
 *   any time in the air --stick command held--> motors off (emergency stop; it falls)
 *
 * Touching the ground while flying leads to idle; that is decided by the flight model.
 */
export function updatePhase(
  state: DroneState,
  sticks: Sticks,
  buttons: Readonly<Record<ButtonId, boolean>>,
  dt: number,
): void {
  // Buttons act once per press, not for as long as they are held.
  const takeoffPressed = buttons.takeoffLand && !state.takeoffButtonWasDown;
  const pausePressed = buttons.pause && !state.pauseButtonWasDown;
  state.takeoffButtonWasDown = buttons.takeoffLand;
  state.pauseButtonWasDown = buttons.pause;

  // The stick command acts once per hold: after it has acted, the sticks must be let go.
  let stickCommandHeldFor = 0;
  if (isStickCommand(sticks)) {
    if (state.stickCommandArmed) {
      state.stickCommandSeconds += dt;
      stickCommandHeldFor = state.stickCommandSeconds;
    }
  } else {
    state.stickCommandSeconds = 0;
    state.stickCommandArmed = true;
  }
  const useStickCommand = (): void => {
    state.stickCommandSeconds = 0;
    state.stickCommandArmed = false;
  };

  if (state.phase !== 'idle') {
    state.throttleDownSeconds = 0;
  }

  switch (state.phase) {
    case 'motorsOff':
      if (!state.onGround) {
        break; // falling: nothing can be started in the air
      }
      if (takeoffPressed) {
        state.phase = 'takingOff';
      } else if (stickCommandHeldFor >= FLIGHT_PROCEDURE.stickCommandHold) {
        useStickCommand();
        state.phase = 'idle';
      }
      break;

    case 'idle':
      if (takeoffPressed) {
        state.phase = 'takingOff';
      } else if (stickCommandHeldFor >= FLIGHT_PROCEDURE.stickCommandHold) {
        useStickCommand();
        state.phase = 'motorsOff';
      } else if (sticks.throttle > 0) {
        state.phase = 'flying';
      } else {
        const fullyDown = sticks.throttle <= -FLIGHT_PROCEDURE.stickCommandThreshold;
        state.throttleDownSeconds = fullyDown ? state.throttleDownSeconds + dt : 0;
        if (state.throttleDownSeconds >= FLIGHT_PROCEDURE.throttleDownStopHold) {
          state.throttleDownSeconds = 0;
          state.phase = 'motorsOff';
        }
      }
      break;

    case 'takingOff':
      if (stickCommandHeldFor >= FLIGHT_PROCEDURE.emergencyStopHold) {
        useStickCommand();
        state.phase = 'motorsOff';
      } else if (takeoffPressed) {
        state.phase = 'landing';
      } else if (pausePressed) {
        state.phase = 'flying'; // stays at whatever height it has reached
      } else if (hasReachedHoverHeight(state)) {
        state.phase = 'flying';
        state.altitudeHoldActive = true;
        state.holdY = FLIGHT_PROCEDURE.takeoffHeight;
      }
      break;

    case 'flying':
      if (stickCommandHeldFor >= FLIGHT_PROCEDURE.emergencyStopHold) {
        useStickCommand();
        state.phase = 'motorsOff';
      } else if (takeoffPressed) {
        state.phase = 'landing';
      }
      break;

    case 'landing':
      if (stickCommandHeldFor >= FLIGHT_PROCEDURE.emergencyStopHold) {
        useStickCommand();
        state.phase = 'motorsOff';
      } else if (takeoffPressed || pausePressed) {
        state.phase = 'flying';
      }
      break;
  }
}
