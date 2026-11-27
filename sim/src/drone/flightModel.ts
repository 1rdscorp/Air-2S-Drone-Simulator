import { type ControlFrame, noButtonsPressed } from '../input/types';
import { FLAT_WORLD, type FlightWorld } from '../world/collision';
import {
  CRASH_CHOSEN,
  DRAG,
  FLIGHT_PROCEDURE,
  type FlightTuning,
  GRAVITY,
  MODE_LIMITS,
  MODE_TUNING,
  type ModeLimits,
} from './air2s.config';
import { createDroneState, type DroneState } from './droneState';
import { type Sticks, updatePhase } from './flightPhase';
import { updateFlightRecord } from './flightRecord';
import { stepGimbal } from './gimbal';

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
 * automatic take-off, flying, or automatic landing. Then the aircraft moves accordingly,
 * and last it is checked against the world: has it come down on something, or hit it?
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
 * @param world where the ground is and what stands on it; flat ground if left out
 */
export function stepDrone(
  state: DroneState,
  controls: ControlFrame,
  dt: number,
  options: Readonly<FlightOptions> = DEFAULT_FLIGHT_OPTIONS,
  world: FlightWorld = FLAT_WORLD,
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

  const before = { x: state.x, y: state.y, z: state.z };
  const ground = world.heightAt(state.x, state.z);

  const phaseBefore = state.phase;
  updatePhase(state, sticks, buttons, dt, ground);
  updateFlightRecord(state, phaseBefore, dt);
  stepGimbal(state, live ? controls.gimbal : 0, buttons, dt, options.gimbalUpward);

  const limits = MODE_LIMITS[controls.mode];
  const tuning = MODE_TUNING[controls.mode];

  switch (state.phase) {
    case 'motorsOff':
      if (!state.onGround) {
        fall(state, dt);
        if (touches(state, before, world) !== 'nothing') {
          // Whatever it meets on the way down ends the fall; a hard one is a crash.
          const hard = -state.vy > CRASH_CHOSEN.maxTouchdownSpeed;
          comeToRest(state, before, world, hard ? 'crashed' : 'motorsOff');
        }
      }
      break;

    case 'idle':
      // Standing on the ground with the motors running: nothing moves.
      break;

    case 'takingOff': {
      // Straight up to hover height, slowing down as it gets there. The sticks are ignored,
      // and it behaves the same whatever the flight mode is.
      const remaining = ground + FLIGHT_PROCEDURE.takeoffHeight - state.y;
      const climb = clamp(
        FLIGHT_PROCEDURE.takeoffGain * remaining,
        -0.5,
        FLIGHT_PROCEDURE.takeoffClimbSpeed,
      );
      const centred = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
      flyPowered(state, centred, climb, dt, MODE_LIMITS.N, MODE_TUNING.N, ground);
      landOrCrash(state, before, world, 'idle');
      break;
    }

    case 'flying':
      flyPowered(state, sticks, null, dt, limits, tuning, ground);
      // Set down by hand: the motors keep running.
      landOrCrash(state, before, world, 'idle');
      break;

    case 'landing': {
      // Steady descent that slows near the ground. The pilot can still steer and turn.
      const descent = gentleDescent(state.y - ground, FLIGHT_PROCEDURE.landingSpeed);
      flyPowered(state, sticks, -descent, dt, limits, tuning, ground);
      // An automatic landing ends with the motors stopped.
      landOrCrash(state, before, world, 'motorsOff');
      break;
    }

    case 'crashed':
      if (!state.onGround) {
        fall(state, dt);
        if (touches(state, before, world) !== 'nothing') {
          comeToRest(state, before, world, 'crashed');
        }
      } else {
        state.crashSeconds += dt;
        if (state.crashSeconds >= CRASH_CHOSEN.resetDelay) {
          backToStart(state, world);
        }
      }
      break;
  }

  state.groundY = world.heightAt(state.x, state.z);
}

/**
 * The descent speed that is safe at this height: `fastest` high up, slowing below
 * `landingSlowHeight` to the gentle touchdown speed. Used by the automatic landing, and as
 * the limit when the pilot descends by hand, so that an ordinary landing is never a crash.
 */
function gentleDescent(heightAboveGround: number, fastest: number): number {
  const share = clamp(heightAboveGround / FLIGHT_PROCEDURE.landingSlowHeight, 0, 1);
  const slowest = Math.min(FLIGHT_PROCEDURE.landingTouchdownSpeed, fastest);
  return slowest + (fastest - slowest) * share;
}

/**
 * How the aircraft has met the world in this step, if at all.
 *
 *   surface  it came down on something: the ground, a slope, a roof
 *   wall     the surface at its new place is well above where it was flying: it flew
 *            into the side of something
 */
function touches(
  state: DroneState,
  before: { x: number; y: number; z: number },
  world: FlightWorld,
): 'nothing' | 'surface' | 'wall' {
  const surface = world.heightAt(state.x, state.z);
  if (state.y > surface) {
    return 'nothing';
  }
  return before.y >= surface - CRASH_CHOSEN.stepHeight ? 'surface' : 'wall';
}

/**
 * After a step of powered flight: sets the aircraft down, stops it at a wall, or crashes it.
 * @param landedPhase the phase a gentle touchdown leads to
 */
function landOrCrash(
  state: DroneState,
  before: { x: number; y: number; z: number },
  world: FlightWorld,
  landedPhase: 'idle' | 'motorsOff',
): void {
  const contact = touches(state, before, world);
  if (contact === 'nothing') {
    return;
  }
  const sideways = Math.hypot(state.vx, state.vz);

  if (contact === 'wall') {
    if (sideways > CRASH_CHOSEN.maxBumpSpeed) {
      comeToRest(state, before, world, 'crashed');
      return;
    }
    // A slow nudge: it stops where it was and stays in the air.
    state.x = before.x;
    state.z = before.z;
    state.vx = 0;
    state.vz = 0;
    state.holdActive = false;
    if (state.y > world.heightAt(state.x, state.z)) {
      return;
    }
  } else if (state.vy > 0) {
    // Skimming a surface while climbing away from it is not a landing.
    state.y = world.heightAt(state.x, state.z);
    return;
  }

  const hard = -state.vy > CRASH_CHOSEN.maxTouchdownSpeed || sideways > CRASH_CHOSEN.maxSlideSpeed;
  comeToRest(state, before, world, hard ? 'crashed' : landedPhase);
}

/**
 * Ends the motion. A wall throws the aircraft back to where it was, from where it falls;
 * a surface is where it stays. A crash leaves it lying tipped over.
 */
function comeToRest(
  state: DroneState,
  before: { x: number; y: number; z: number },
  world: FlightWorld,
  phase: 'idle' | 'motorsOff' | 'crashed',
): void {
  if (touches(state, before, world) === 'wall') {
    state.x = before.x;
    state.z = before.z;
  }
  const surface = world.heightAt(state.x, state.z);
  const crashed = phase === 'crashed';
  if (crashed && state.phase !== 'crashed') {
    state.crashSeconds = 0;
  }
  state.phase = phase;
  state.vx = 0;
  state.vz = 0;
  state.pitchRate = 0;
  state.rollRate = 0;
  state.yawRate = 0;
  state.holdActive = false;
  state.altitudeHoldActive = false;

  if (state.y > surface) {
    // Stopped by a wall high up: the motors are off and it drops from here.
    state.vy = Math.min(state.vy, 0);
    state.onGround = false;
    return;
  }
  state.y = surface;
  state.vy = 0;
  state.onGround = true;
  state.pitch = crashed ? CRASH_CHOSEN.restPitch : 0;
  state.roll = crashed ? CRASH_CHOSEN.restRoll : 0;
}

/**
 * Puts a crashed aircraft back where the flight started, as if it had never flown. Buttons
 * and sticks that are still held do not count as newly pressed.
 */
function backToStart(state: DroneState, world: FlightWorld): void {
  const { spawn } = world;
  const fresh = createDroneState({
    x: spawn.x,
    z: spawn.z,
    heading: spawn.heading,
    ground: world.heightAt(spawn.x, spawn.z),
  });
  fresh.takeoffButtonWasDown = state.takeoffButtonWasDown;
  fresh.pauseButtonWasDown = state.pauseButtonWasDown;
  fresh.c1ButtonWasDown = state.c1ButtonWasDown;
  fresh.c2ButtonWasDown = state.c2ButtonWasDown;
  fresh.stickCommandArmed = false;
  Object.assign(state, fresh);
}

/**
 * Powered flight for one step.
 * @param climbOverride climb rate in m/s chosen by the flight controller (take-off,
 *   landing), or null to let the pilot's throttle stick decide
 * @param ground height of the surface below the aircraft, in metres
 */
function flyPowered(
  state: DroneState,
  sticks: Sticks,
  climbOverride: number | null,
  dt: number,
  limits: ModeLimits,
  tuning: FlightTuning,
  ground: number,
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
    // Close to the ground the aircraft slows its descent by itself, as the real one does.
    climbTarget = Math.max(climbTarget, -gentleDescent(state.y - ground, limits.maxDescent));
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
}

/** Motors off in the air: the aircraft falls, slowed only by air drag. */
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
}
