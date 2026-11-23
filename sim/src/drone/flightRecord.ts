import type { DroneState, FlightPhase } from './droneState';

/**
 * Keeps the home point and the flight clock.
 *
 * Starting the motors records the spot the aircraft stands on as its home point and sets
 * the clock to zero. The clock runs for as long as the motors run, also while standing on
 * the ground, and keeps its last value after they stop.
 *
 * TODO(step-26): Return-to-Home flies back to this point.
 *
 * @param phaseBefore the flight phase before this step's phase decision
 */
export function updateFlightRecord(state: DroneState, phaseBefore: FlightPhase, dt: number): void {
  const motorsRunning = state.phase !== 'motorsOff';
  if (motorsRunning && phaseBefore === 'motorsOff') {
    state.homeSet = true;
    state.homeX = state.x;
    state.homeZ = state.z;
    state.flightSeconds = 0;
  }
  if (motorsRunning) {
    state.flightSeconds += dt;
  }
}
