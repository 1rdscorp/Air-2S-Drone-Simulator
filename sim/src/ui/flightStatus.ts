import type { FlightPhase } from '../drone/droneState';
import { FLIGHT_MODE_NAMES, type FlightMode } from '../input/types';

/** Short name of each flight phase, for the debug overlay. */
export const PHASE_LABELS: Record<FlightPhase, string> = {
  motorsOff: 'motors off',
  idle: 'motors on',
  takingOff: 'taking off',
  flying: 'flying',
  landing: 'landing',
  crashed: 'crashed',
};

/**
 * What the take-off / landing button is called on the device in use.
 * @param hasOwnButton false for a flight stick without a take-off button of its own: the
 *   T key on the keyboard then does it
 */
export function takeoffButtonName(sourceId: string, hasOwnButton = true): string {
  if (sourceId === 'keyboard' || !hasOwnButton) {
    return 'T';
  }
  if (sourceId === 'gamepad') {
    return 'Start';
  }
  return 'the take-off button';
}

/**
 * One line that tells the pilot what the aircraft is doing and what to do next.
 * @param button name of the take-off / landing button on the device in use
 */
export function flightStatusText(
  phase: FlightPhase,
  onGround: boolean,
  mode: FlightMode,
  button: string,
): string {
  switch (phase) {
    case 'motorsOff':
      return onGround ? `Motors off · press ${button} to take off` : 'Motors stopped · falling';
    case 'idle':
      return `Motors on · press ${button} to take off, or push the throttle up`;
    case 'takingOff':
      return 'Taking off…';
    case 'flying':
      return `Flying · ${FLIGHT_MODE_NAMES[mode]} mode · press ${button} to land`;
    case 'landing':
      return `Landing… · press ${button} to cancel`;
    case 'crashed':
      return 'Crashed · back at the start in a moment';
  }
}
