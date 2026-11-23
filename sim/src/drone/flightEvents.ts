import type { FlightMode } from '../input/types';
import { FLIGHT_PROCEDURE } from './air2s.config';
import type { DroneState } from './droneState';

/**
 * Things that happen during a flight and are worth telling the pilot.
 *
 *   homePointSet      the motors were started; this spot is now the home point
 *   motorsStarted     motors running, standing on the ground
 *   takeoffStarted    automatic take-off began
 *   takeoffComplete   automatic take-off reached hover height
 *   takeoffStopped    automatic take-off was stopped before hover height (flight pause)
 *   liftedOff         left the ground by hand, with the throttle stick
 *   landingStarted    automatic landing began
 *   landingCancelled  automatic landing was stopped; hovering again
 *   landed            automatic landing touched down and the motors stopped
 *   touchedDown       set down by hand; the motors are still running
 *   motorsStopped     motors stopped on the ground
 *   motorsCut         motors stopped in the air (emergency stop); the aircraft falls
 *   hitGround         a falling aircraft reached the ground
 *   modeChanged       the flight mode switch was moved; `mode` is the new mode
 *   controlLost       the controller is no longer connected
 *   controlRestored   the controller is connected again
 */
export const FLIGHT_EVENT_TYPES = [
  'homePointSet',
  'motorsStarted',
  'takeoffStarted',
  'takeoffComplete',
  'takeoffStopped',
  'liftedOff',
  'landingStarted',
  'landingCancelled',
  'landed',
  'touchedDown',
  'motorsStopped',
  'motorsCut',
  'hitGround',
  'modeChanged',
  'controlLost',
  'controlRestored',
] as const;
export type FlightEventType = (typeof FLIGHT_EVENT_TYPES)[number];

export interface FlightEvent {
  type: FlightEventType;
  /** The new flight mode; only with `modeChanged`. */
  mode?: FlightMode;
}

/** How close to hover height an automatic take-off must be to count as complete, in metres. */
const TAKEOFF_COMPLETE_WITHIN = 0.1;

/**
 * Compares the aircraft before and after one simulation step and names what happened.
 * Reads only; the events are a report, they never change the flight.
 */
export function phaseEvents(
  before: Readonly<DroneState>,
  after: Readonly<DroneState>,
): FlightEventType[] {
  if (before.phase === after.phase) {
    const fellToGround = after.phase === 'motorsOff' && !before.onGround && after.onGround;
    return fellToGround ? ['hitGround'] : [];
  }

  const events: FlightEventType[] = [];
  if (before.phase === 'motorsOff') {
    events.push('homePointSet');
  }

  switch (after.phase) {
    case 'motorsOff':
      if (!after.onGround) {
        events.push('motorsCut');
      } else if (before.phase === 'landing') {
        events.push('landed');
      } else {
        events.push('motorsStopped');
      }
      break;

    case 'idle':
      events.push(before.phase === 'motorsOff' ? 'motorsStarted' : 'touchedDown');
      break;

    case 'takingOff':
      events.push('takeoffStarted');
      break;

    case 'flying':
      if (before.phase === 'takingOff') {
        const reached =
          Math.abs(after.y - FLIGHT_PROCEDURE.takeoffHeight) < TAKEOFF_COMPLETE_WITHIN;
        events.push(reached ? 'takeoffComplete' : 'takeoffStopped');
      } else if (before.phase === 'landing') {
        events.push('landingCancelled');
      } else {
        events.push('liftedOff');
      }
      break;

    case 'landing':
      events.push('landingStarted');
      break;
  }
  return events;
}
