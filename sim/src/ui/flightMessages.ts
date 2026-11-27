import { FLIGHT_PROCEDURE, MODE_LIMITS } from '../drone/air2s.config';
import type { FlightEvent } from '../drone/flightEvents';
import { FLIGHT_MODE_NAMES } from '../input/types';
import type { ToastMessage } from './toasts';

/**
 * The words the pilot reads when something happens in the flight.
 *
 * Everything about what the aircraft is doing shares one key, so "Taking off" gives way
 * to "Take-off complete" instead of standing next to it.
 */
export function flightMessage(event: FlightEvent): ToastMessage {
  const info = (key: string, text: string): ToastMessage => ({ key, text, kind: 'info' });
  const warning = (key: string, text: string): ToastMessage => ({ key, text, kind: 'warning' });

  switch (event.type) {
    case 'homePointSet':
      return info('home', 'Home point recorded');
    case 'motorsStarted':
      return info('flight', 'Motors started');
    case 'takeoffStarted':
      return info('flight', 'Taking off');
    case 'takeoffComplete':
      return info('flight', `Take-off complete · hovering at ${FLIGHT_PROCEDURE.takeoffHeight} m`);
    case 'takeoffStopped':
      return info('flight', 'Take-off stopped · hovering');
    case 'liftedOff':
      return info('flight', 'Lifted off');
    case 'landingStarted':
      return info('flight', 'Landing');
    case 'landingCancelled':
      return info('flight', 'Landing cancelled · hovering');
    case 'landed':
      return info('flight', 'Landed · motors off');
    case 'touchedDown':
      return info('flight', 'On the ground · motors still running');
    case 'motorsStopped':
      return info('flight', 'Motors stopped');
    case 'motorsCut':
      return warning('flight', 'Emergency stop · motors cut');
    case 'hitGround':
      return warning('flight', 'The aircraft hit the ground');
    case 'crashed':
      return warning('flight', 'Crashed');
    case 'backAtStart':
      return info('flight', 'Back at the start');
    case 'modeChanged': {
      const mode = event.mode ?? 'N';
      return info(
        'mode',
        `${FLIGHT_MODE_NAMES[mode]} mode · up to ${MODE_LIMITS[mode].maxSpeed} m/s`,
      );
    }
    case 'controlLost':
      return warning('control', 'Controller connection lost · hovering');
    case 'controlRestored':
      return info('control', 'Controller connected again');
  }
}
