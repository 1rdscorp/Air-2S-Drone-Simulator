/**
 * Every number that describes the DJI Air 2S lives in this file.
 *
 * Two kinds of numbers are kept apart:
 *
 *   AIR_2S_SPECS   Values DJI publishes. Each has its source next to it. Checked on
 *                  2026-11-23 through web search of the pages named below; the pages
 *                  themselves could not be opened from the build session.
 *   NORMAL_TUNING  Values DJI does not publish (how quickly the aircraft reacts). They
 *                  are tuned by feel and by the tests, and are the ones to change when
 *                  the flight does not feel right.
 *
 * Sources:
 *   [support]  DJI support page, https://www.dji.com/support/product/air-2s
 *   [info]     DJI product page, https://www.dji.com/air-2s/info
 *   [manual]   DJI Air 2S User Manual
 */

const DEG = Math.PI / 180;

/** Limits that depend on the flight mode. Angles in radians, speeds in m/s. */
export interface ModeLimits {
  /** Highest horizontal speed. */
  maxSpeed: number;
  /** Highest climb speed. */
  maxAscent: number;
  /** Highest descent speed. */
  maxDescent: number;
  /** Highest turn rate around the vertical axis. */
  maxYawRate: number;
  /** Largest tilt of the aircraft from level. */
  maxTilt: number;
}

export const AIR_2S_SPECS = {
  /** Take-off weight in kg. [support] "595 g" */
  takeoffMassKg: 0.595,

  /** Size unfolded, length x width x height, in metres. [support] "183x253x77 mm" */
  sizeUnfoldedM: { length: 0.183, width: 0.253, height: 0.077 },

  /** Highest horizontal speed in m/s, near sea level, no wind. [support] S 19, N 15, C 5. */
  maxSpeed: { C: 5, N: 15, S: 19 },

  /** Highest climb and descent speed in m/s. [support] 6 in S and N. Not published for C. */
  maxAscent: { N: 6, S: 6 },
  maxDescent: { N: 6, S: 6 },

  /** Highest turn rate ("max angular velocity"). [support] S 250, N 90, C 60 deg/s. */
  maxYawRate: { C: 60 * DEG, N: 90 * DEG, S: 250 * DEG },

  /**
   * Largest tilt from level. [support] S 35 deg, N 25 deg (35 deg in strong wind).
   * Not published for C.
   */
  maxTilt: { N: 25 * DEG, S: 35 * DEG },

  /** [info] "31 minutes" with no wind; hovering "30 minutes". Used from Step 26. */
  maxFlightTimeMin: 31,
  maxHoverTimeMin: 30,

  /** [support] Max wind speed resistance "10.7 m/s". Used from Step 19. */
  maxWindResistance: 10.7,

  /** Gimbal. [support] Used from Step 08. */
  gimbal: {
    /** Tilt the pilot can command by default: -90 deg (straight down) to 0 deg (level). */
    tiltMin: -90 * DEG,
    tiltMax: 0,
    /** Upper tilt limit with the "extended" setting: +24 deg. */
    tiltMaxExtended: 24 * DEG,
    /** Fastest commanded tilt: 100 deg/s. */
    maxTiltSpeed: 100 * DEG,
  },

  /** Camera lens. [support] FOV 88 deg, 22 mm equivalent, f/2.8. Used from Step 08. */
  camera: {
    fieldOfView: 88 * DEG,
    focalLengthEquivalentMm: 22,
  },

  /**
   * Obstacle sensing: measurement range in metres. There is none to the sides.
   * [support] Used from Step 27.
   */
  sensing: {
    forward: { min: 0.38, max: 23.8 },
    backward: { min: 0.37, max: 23.4 },
    upward: { min: 0.34, max: 28.6 },
    downward: { min: 0.1, max: 8 },
  },

  /** Battery. [manual] "11.55 V, 3500 mAh"; [support] 40.42 Wh. Used from Step 26. */
  battery: {
    capacityMah: 3500,
    voltage: 11.55,
    energyWh: 40.42,
  },
} as const;

/**
 * Limits for Normal mode, all published.
 * TODO(step-06): add Cine and Sport. Cine needs chosen values where DJI publishes none.
 */
export const NORMAL_LIMITS: ModeLimits = {
  maxSpeed: AIR_2S_SPECS.maxSpeed.N,
  maxAscent: AIR_2S_SPECS.maxAscent.N,
  maxDescent: AIR_2S_SPECS.maxDescent.N,
  maxYawRate: AIR_2S_SPECS.maxYawRate.N,
  maxTilt: AIR_2S_SPECS.maxTilt.N,
};

/** Gravity in m/s². */
export const GRAVITY = 9.81;

/**
 * Air drag, as deceleration = DRAG * speed², in 1/m. Not published; derived so that the
 * published tilt limits and top speeds agree: at 35 deg tilt the aircraft can just hold a
 * little over 19 m/s, and at 25 deg a little over 15 m/s.
 */
export const DRAG = 0.0185;

/** How the aircraft reacts. None of this is published; all of it is tuned. */
export interface FlightTuning {
  /** How hard the controller chases the target speed, in 1/s. Higher is snappier. */
  velocityGain: number;
  /** Speed of the tilt response (natural frequency), in rad/s. */
  attitudeFrequency: number;
  /** Damping of the tilt response. 1 means no overshoot. */
  attitudeDamping: number;
  /** Fastest the aircraft can change its tilt, in rad/s. */
  maxTiltRate: number;
  /** How hard the controller chases the target climb rate, in 1/s. */
  verticalGain: number;
  /** Largest upward and downward acceleration, in m/s². */
  maxUpAcceleration: number;
  maxDownAcceleration: number;
  /** How hard the controller chases the target turn rate, in 1/s. */
  yawGain: number;
  /** Largest turn acceleration, in rad/s². */
  maxYawAcceleration: number;
  /** Position hold: speed below which the hover point is fixed, in m/s. */
  holdLatchSpeed: number;
  /** Position hold: pull towards the hover point, in 1/s, and the fastest it may move. */
  holdGain: number;
  holdMaxSpeed: number;
  /** Height hold: the same three values for the vertical axis. */
  altitudeLatchSpeed: number;
  altitudeGain: number;
  altitudeMaxSpeed: number;
}

/** Tuning for Normal mode. TODO(step-06): add Cine and Sport and use the selected mode. */
export const NORMAL_TUNING: FlightTuning = {
  velocityGain: 2,
  attitudeFrequency: 10,
  attitudeDamping: 1,
  maxTiltRate: 200 * DEG,
  verticalGain: 3,
  maxUpAcceleration: 4.5,
  maxDownAcceleration: 4,
  yawGain: 6,
  maxYawAcceleration: 300 * DEG,
  holdLatchSpeed: 0.2,
  holdGain: 1,
  holdMaxSpeed: 2,
  altitudeLatchSpeed: 0.15,
  altitudeGain: 1.5,
  altitudeMaxSpeed: 1,
};

/** Height of the aircraft's underside above the ground when the simulator starts, in metres. */
export const START_HEIGHT = 2;
