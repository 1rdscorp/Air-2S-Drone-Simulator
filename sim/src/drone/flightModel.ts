import { type ControlFrame, noButtonsPressed } from '../input/types';
import {
  DRAG,
  FLIGHT_PROCEDURE,
  type FlightTuning,
  GRAVITY,
  MODE_LIMITS,
  MODE_TUNING,
  type ModeLimits,
} from './air2s.config';
import type { DroneState } from './droneState';
import { type Sticks, updatePhase } from './flightPhase';
import { stepGimbal } from './gimbal';

/** Height of the ground. Flat for now. TODO(step-10): ask the environment. */
const GROUND_HEIGHT = 0;

const NO_BUTTONS = noButtonsPressed();

/** Aircraft settings the pilot can change. */
export interface FlightOptions {
  /** Lets the camera tilt above level, up to +24°. */
  gimbalUpward: boolean;
}

export const DEFAULT_FLIGHT_OPTIONS: Readonly<FlightOptions> = { gimbalUpward: false };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function stick(value: number): number {
  return Number.isFinite(value) ? clamp(value, -1, 1) : 0;
}

/**
 * Advances the aircraft by one fixed step.
 *
 * First the flight phase is decided (see `updatePhase`): motors off, idle on the ground,
 * automatic take-off, flying, or automatic landing. Then the aircraft moves accordingly.
 *
 * In powered flight it works the way a camera drone does. The pilot does not steer
 * motors; the sticks ask the flight controller for a speed, a climb rate and a turn rate:
 *
 *   1. Sticks -> target speed over the ground (in the direction the nose points),
 *      target climb rate, target turn rate. The limits come from the flight mode.
 *   2. Speed error -> wanted acceleration -> wanted tilt, limited to the largest tilt.
 *   3. The aircraft takes a moment to reach that tilt.
 *   4. Tilt accelerates the aircraft; air drag slows it.
 *   5. With the sticks centred the controller brakes, then holds the spot and the height.
 *
 * The camera gimbal moves in every phase, also on the ground with the motors off.
 *
 * @param state changed in place
 * @param dt step length in seconds
 */
export function stepDrone(
  state: DroneState,
  controls: ControlFrame,
  dt: number,
  options: Readonly<FlightOptions> = DEFAULT_FLIGHT_OPTIONS,
): void {
  // TODO(step-24): proper signal-loss behaviour. For now a lost controller means centred
  // sticks and no buttons.
  const live = controls.connected;
  const sticks: Sticks = {
    roll: live ? stick(controls.roll) : 0,
    pitch: live ? stick(controls.pitch) : 0,
    yaw: live ? stick(controls.yaw) : 0,
    throttle: live ? stick(controls.throttle) : 0,
  };

  const buttons = live ? controls.buttons : NO_BUTTONS;

  updatePhase(state, sticks, buttons, dt);
  stepGimbal(state, live ? controls.gimbal : 0, buttons, dt, options.gimbalUpward);

  const limits = MODE_LIMITS[controls.mode];
  const tuning = MODE_TUNING[controls.mode];

  switch (state.phase) {
    case 'motorsOff':
      if (!state.onGround) {
        fall(state, dt);
      }
      break;

    case 'idle':
      // Standing on the ground with the motors running: nothing moves.
      break;

    case 'takingOff': {
      // Straight up to hover height, slowing down as it gets there. The sticks are ignored,
      // and it behaves the same whatever the flight mode is.
      const remaining = FLIGHT_PROCEDURE.takeoffHeight - state.y;
      const climb = clamp(
        FLIGHT_PROCEDURE.takeoffGain * remaining,
        -0.5,
        FLIGHT_PROCEDURE.takeoffClimbSpeed,
      );
      const centred = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
      flyPowered(state, centred, climb, dt, MODE_LIMITS.N, MODE_TUNING.N);
      break;
    }

    case 'flying':
      flyPowered(state, sticks, null, dt, limits, tuning);
      if (state.onGround) {
        state.phase = 'idle'; // landed by hand: motors keep running
      }
      break;

    case 'landing': {
      // Steady descent that slows near the ground. The pilot can still steer and turn.
      const height = clamp((state.y - GROUND_HEIGHT) / FLIGHT_PROCEDURE.landingSlowHeight, 0, 1);
      const descent =
        FLIGHT_PROCEDURE.landingTouchdownSpeed +
        (FLIGHT_PROCEDURE.landingSpeed - FLIGHT_PROCEDURE.landingTouchdownSpeed) * height;
      flyPowered(state, sticks, -descent, dt, limits, tuning);
      if (state.onGround) {
        state.phase = 'motorsOff'; // automatic landing ends with the motors stopped
      }
      break;
    }
  }
}

/**
 * Powered flight for one step.
 * @param climbOverride climb rate in m/s chosen by the flight controller (take-off,
 *   landing), or null to let the pilot's throttle stick decide
 */
function flyPowered(
  state: DroneState,
  sticks: Sticks,
  climbOverride: number | null,
  dt: number,
  limits: ModeLimits,
  tuning: FlightTuning,
): void {
  state.onGround = false;

  // ---- Height -----------------------------------------------------------------------
  let climbTarget: number;
  if (climbOverride !== null) {
    state.altitudeHoldActive = false;
    climbTarget = climbOverride;
  } else if (sticks.throttle !== 0) {
    state.altitudeHoldActive = false;
    climbTarget = sticks.throttle * (sticks.throttle > 0 ? limits.maxAscent : limits.maxDescent);
  } else {
    if (!state.altitudeHoldActive && Math.abs(state.vy) < tuning.altitudeLatchSpeed) {
      state.altitudeHoldActive = true;
      state.holdY = state.y;
    }
    climbTarget = state.altitudeHoldActive
      ? clamp(
          tuning.altitudeGain * (state.holdY - state.y),
          -tuning.altitudeMaxSpeed,
          tuning.altitudeMaxSpeed,
        )
      : 0;
  }
  const climbAcceleration = clamp(
    tuning.verticalGain * (climbTarget - state.vy),
    -tuning.maxDownAcceleration,
    tuning.maxUpAcceleration,
  );

  // ---- Turning ----------------------------------------------------------------------
  const yawAcceleration = clamp(
    tuning.yawGain * (sticks.yaw * limits.maxYawRate - state.yawRate),
    -tuning.maxYawAcceleration,
    tuning.maxYawAcceleration,
  );

  // ---- Speed over the ground --------------------------------------------------------
  // Unit vectors of the aircraft in the world: forward (nose) and right.
  const sin = Math.sin(state.heading);
  const cos = Math.cos(state.heading);
  const forwardX = sin;
  const forwardZ = -cos;
  const rightX = cos;
  const rightZ = sin;

  // Both sticks fully over must not give more than full speed.
  let forwardStick = sticks.pitch;
  let rightStick = sticks.roll;
  const deflection = Math.hypot(forwardStick, rightStick);
  if (deflection > 1) {
    forwardStick /= deflection;
    rightStick /= deflection;
  }

  let targetVx: number;
  let targetVz: number;
  if (deflection > 0) {
    state.holdActive = false;
    const forwardSpeed = forwardStick * limits.maxSpeed;
    const rightSpeed = rightStick * limits.maxSpeed;
    targetVx = forwardSpeed * forwardX + rightSpeed * rightX;
    targetVz = forwardSpeed * forwardZ + rightSpeed * rightZ;
  } else {
    // Sticks centred: brake first, then fix the hover point and stay on it.
    if (!state.holdActive && Math.hypot(state.vx, state.vz) < tuning.holdLatchSpeed) {
      state.holdActive = true;
      state.holdX = state.x;
      state.holdZ = state.z;
    }
    if (state.holdActive) {
      targetVx = tuning.holdGain * (state.holdX - state.x);
      targetVz = tuning.holdGain * (state.holdZ - state.z);
      const pull = Math.hypot(targetVx, targetVz);
      if (pull > tuning.holdMaxSpeed) {
        targetVx *= tuning.holdMaxSpeed / pull;
        targetVz *= tuning.holdMaxSpeed / pull;
      }
    } else {
      targetVx = 0;
      targetVz = 0;
    }
  }

  // Air drag acts against the motion and grows with the square of the speed.
  const speed = Math.hypot(state.vx, state.vz);
  const dragX = -DRAG * speed * state.vx;
  const dragZ = -DRAG * speed * state.vz;

  // Acceleration the controller wants, with the drag it has to overcome added on top.
  const wantedX = tuning.velocityGain * (targetVx - state.vx) - dragX;
  const wantedZ = tuning.velocityGain * (targetVz - state.vz) - dragZ;

  // The same acceleration seen from the aircraft, limited to what the largest tilt gives.
  let wantedForward = wantedX * forwardX + wantedZ * forwardZ;
  let wantedRight = wantedX * rightX + wantedZ * rightZ;
  const wanted = Math.hypot(wantedForward, wantedRight);
  const strongest = GRAVITY * Math.tan(limits.maxTilt);
  if (wanted > strongest) {
    wantedForward *= strongest / wanted;
    wantedRight *= strongest / wanted;
  }
  const pitchTarget = Math.atan(wantedForward / GRAVITY);
  const rollTarget = Math.atan(wantedRight / GRAVITY);

  // ---- Tilt response: the aircraft needs a moment to reach the wanted tilt -----------
  const stiffness = tuning.attitudeFrequency * tuning.attitudeFrequency;
  const damping = 2 * tuning.attitudeDamping * tuning.attitudeFrequency;

  state.pitchRate += (stiffness * (pitchTarget - state.pitch) - damping * state.pitchRate) * dt;
  state.pitchRate = clamp(state.pitchRate, -tuning.maxTiltRate, tuning.maxTiltRate);
  state.pitch += state.pitchRate * dt;

  state.rollRate += (stiffness * (rollTarget - state.roll) - damping * state.rollRate) * dt;
  state.rollRate = clamp(state.rollRate, -tuning.maxTiltRate, tuning.maxTiltRate);
  state.roll += state.rollRate * dt;

  // ---- Motion: the actual tilt accelerates the aircraft, drag slows it ---------------
  const thrustForward = GRAVITY * Math.tan(state.pitch);
  const thrustRight = GRAVITY * Math.tan(state.roll);
  state.vx += (thrustForward * forwardX + thrustRight * rightX + dragX) * dt;
  state.vz += (thrustForward * forwardZ + thrustRight * rightZ + dragZ) * dt;
  state.vy += climbAcceleration * dt;

  state.x += state.vx * dt;
  state.y += state.vy * dt;
  state.z += state.vz * dt;

  state.yawRate += yawAcceleration * dt;
  state.heading += state.yawRate * dt;

  if (state.y <= GROUND_HEIGHT && state.vy <= 0) {
    settleOnGround(state);
  }
}

/** Motors cut in the air: the aircraft falls, slowed only by air drag, until it hits the ground. */
function fall(state: DroneState, dt: number): void {
  const speed = Math.hypot(state.vx, state.vy, state.vz);
  state.vx += -DRAG * speed * state.vx * dt;
  state.vy += (-GRAVITY - DRAG * speed * state.vy) * dt;
  state.vz += -DRAG * speed * state.vz * dt;

  state.x += state.vx * dt;
  state.y += state.vy * dt;
  state.z += state.vz * dt;

  state.yawRate = 0;
  state.pitchRate = 0;
  state.rollRate = 0;

  if (state.y <= GROUND_HEIGHT) {
    settleOnGround(state);
  }
}

/**
 * Puts the aircraft at rest on the ground.
 * TODO(step-10): hard landings and crashes. For now touching the ground simply stops.
 */
function settleOnGround(state: DroneState): void {
  state.y = GROUND_HEIGHT;
  state.vx = 0;
  state.vy = 0;
  state.vz = 0;
  state.pitch = 0;
  state.roll = 0;
  state.pitchRate = 0;
  state.rollRate = 0;
  state.yawRate = 0;
  state.onGround = true;
  state.holdActive = false;
  state.altitudeHoldActive = false;
}
