import { describe, expect, it } from 'vitest';
import { createDroneState, createFlyingState, type DroneState } from '../drone/droneState';
import {
  compassPoint,
  formatBattery,
  formatClimb,
  formatDistance,
  formatFlightTime,
  formatGimbal,
  formatHeading,
  formatHeight,
  formatSpeed,
  hudValues,
  wrap180,
} from './hudValues';

const DEG = Math.PI / 180;

function flying(changes: Partial<DroneState> = {}): DroneState {
  return { ...createFlyingState(20), ...changes };
}

describe('hudValues', () => {
  it('on the ground before the first start: all zero, and no distance or direction yet', () => {
    const values = hudValues(createDroneState(), 'N');

    expect(values).toMatchObject({
      mode: 'N',
      height: 0,
      distance: null,
      speed: 0,
      climb: 0,
      heading: 0,
      homeBearing: null,
      homeDirection: null,
      pitch: 0,
      roll: 0,
      gimbal: 0,
      flightSeconds: 0,
    });
  });

  it('reads height, speed over the ground and climb rate', () => {
    const values = hudValues(flying({ y: 42.5, vx: 3, vz: -4, vy: -1.5 }), 'S');

    expect(values.mode).toBe('S');
    expect(values.height).toBe(42.5);
    expect(values.speed).toBeCloseTo(5, 12);
    expect(values.climb).toBe(-1.5);
  });

  it('the speed does not include climbing', () => {
    expect(hudValues(flying({ vy: 6 }), 'N').speed).toBe(0);
  });

  it('measures the distance to home over the ground', () => {
    const values = hudValues(flying({ x: 30, z: -40, y: 100, homeX: 0, homeZ: 0 }), 'N');

    expect(values.distance).toBeCloseTo(50, 12);
  });

  it('gives the heading as a compass bearing from 0 to 360', () => {
    expect(hudValues(flying({ heading: 90 * DEG }), 'N').heading).toBeCloseTo(90, 9);
    expect(hudValues(flying({ heading: -90 * DEG }), 'N').heading).toBeCloseTo(270, 9);
    expect(hudValues(flying({ heading: 765 * DEG }), 'N').heading).toBeCloseTo(45, 9);
  });

  it('gives the compass bearing from the aircraft to home', () => {
    // North is -z, east is +x. The aircraft is this far from a home point at the origin.
    const bearingFrom = (x: number, z: number): number | null =>
      hudValues(flying({ x, z }), 'N').homeBearing;

    expect(bearingFrom(0, -100)).toBeCloseTo(180, 9); // north of home: home is to the south
    expect(bearingFrom(0, 100)).toBeCloseTo(0, 9); // south of home: home is to the north
    expect(bearingFrom(100, 0)).toBeCloseTo(270, 9); // east of home: home is to the west
    expect(bearingFrom(-100, 0)).toBeCloseTo(90, 9); // west of home: home is to the east
    expect(bearingFrom(-100, 100)).toBeCloseTo(45, 9);
  });

  it('gives the direction to home as seen from the aircraft', () => {
    // 100 m north of home, so home lies to the south.
    const directionFacing = (headingDeg: number): number | null =>
      hudValues(flying({ z: -100, heading: headingDeg * DEG }), 'N').homeDirection;

    expect(directionFacing(0)).toBeCloseTo(180, 9); // facing north: home is behind
    expect(directionFacing(180)).toBeCloseTo(0, 9); // facing south: home is straight ahead
    expect(directionFacing(90)).toBeCloseTo(90, 9); // facing east: home is to the right
    expect(directionFacing(270)).toBeCloseTo(-90, 9); // facing west: home is to the left
    expect(directionFacing(540)).toBeCloseTo(0, 9); // one and a half turns is facing south
  });

  it('has no direction to home on top of it or without a home point', () => {
    expect(hudValues(flying({ x: 0.2, z: 0.3 }), 'N').homeDirection).toBeNull();
    expect(hudValues(flying({ x: 0.2, z: 0.3 }), 'N').distance).toBeCloseTo(0.36, 2);
    expect(hudValues(flying({ x: 50, homeSet: false }), 'N')).toMatchObject({
      distance: null,
      homeBearing: null,
      homeDirection: null,
    });
  });

  it('uses the home point wherever it is', () => {
    const values = hudValues(flying({ x: 10, z: 10, homeX: 10, homeZ: -90 }), 'N');

    expect(values.distance).toBeCloseTo(100, 12);
    expect(values.homeBearing).toBeCloseTo(0, 9); // home is 100 m to the north
  });

  it('gives tilt, camera tilt and flight time in display units', () => {
    const values = hudValues(
      flying({ pitch: 20 * DEG, roll: -10 * DEG, gimbalTilt: -45 * DEG, flightSeconds: 75.4 }),
      'N',
    );

    expect(values.pitch).toBeCloseTo(20, 9);
    expect(values.roll).toBeCloseTo(-10, 9);
    expect(values.gimbal).toBeCloseTo(-45, 9);
    expect(values.flightSeconds).toBe(75.4);
  });

  it('shows a full battery until the battery model exists', () => {
    expect(hudValues(flying({ flightSeconds: 1500 }), 'N').battery).toBe(100);
  });
});

describe('wrap180', () => {
  it('brings any angle into -180 to 180', () => {
    expect(wrap180(0)).toBe(0);
    expect(wrap180(190)).toBe(-170);
    expect(wrap180(-190)).toBe(170);
    expect(wrap180(180)).toBe(180);
    expect(wrap180(-180)).toBe(180);
    expect(wrap180(725)).toBe(5);
  });
});

describe('display text', () => {
  it('height and speed have one decimal and never read minus zero', () => {
    expect(formatHeight(12.34)).toBe('12.3');
    expect(formatHeight(0)).toBe('0.0');
    expect(formatHeight(-0.0001)).toBe('0.0');
    expect(formatHeight(500)).toBe('500.0');
    expect(formatSpeed(14.96)).toBe('15.0');
    expect(formatSpeed(0.04)).toBe('0.0');
  });

  it('distance is whole metres, then kilometres, and a dash without a home point', () => {
    expect(formatDistance(null)).toEqual({ value: '–', unit: 'm' });
    expect(formatDistance(0)).toEqual({ value: '0', unit: 'm' });
    expect(formatDistance(45.4)).toEqual({ value: '45', unit: 'm' });
    expect(formatDistance(999.4)).toEqual({ value: '999', unit: 'm' });
    expect(formatDistance(999.6)).toEqual({ value: '1.00', unit: 'km' });
    expect(formatDistance(1234)).toEqual({ value: '1.23', unit: 'km' });
  });

  it('climb rate shows its sign, except at zero', () => {
    expect(formatClimb(1.52)).toBe('+1.5');
    expect(formatClimb(-3)).toBe('−3.0');
    expect(formatClimb(0)).toBe('0.0');
    expect(formatClimb(0.04)).toBe('0.0');
    expect(formatClimb(-0.04)).toBe('0.0');
    expect(formatClimb(-0.06)).toBe('−0.1');
  });

  it('flight time is minutes and seconds', () => {
    expect(formatFlightTime(0)).toBe('00:00');
    expect(formatFlightTime(59.99)).toBe('00:59');
    expect(formatFlightTime(60)).toBe('01:00');
    expect(formatFlightTime(187.2)).toBe('03:07');
    expect(formatFlightTime(31 * 60)).toBe('31:00');
    expect(formatFlightTime(125 * 60 + 3)).toBe('125:03');
    expect(formatFlightTime(-5)).toBe('00:00');
  });

  it('heading is three digits, and a full turn reads 000', () => {
    expect(formatHeading(0)).toBe('000°');
    expect(formatHeading(45.2)).toBe('045°');
    expect(formatHeading(359.4)).toBe('359°');
    expect(formatHeading(359.6)).toBe('000°');
  });

  it('names the nearest of the eight compass points', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(22)).toBe('N');
    expect(compassPoint(23)).toBe('NE');
    expect(compassPoint(90)).toBe('E');
    expect(compassPoint(135)).toBe('SE');
    expect(compassPoint(180)).toBe('S');
    expect(compassPoint(225)).toBe('SW');
    expect(compassPoint(270)).toBe('W');
    expect(compassPoint(315)).toBe('NW');
    expect(compassPoint(350)).toBe('N');
    expect(compassPoint(-90)).toBe('W');
  });

  it('camera tilt: level is 0°, down has a minus, up has a plus, never minus zero', () => {
    expect(formatGimbal(0)).toBe('0°');
    expect(formatGimbal(-90)).toBe('−90°');
    expect(formatGimbal(-44.6)).toBe('−45°');
    expect(formatGimbal(24)).toBe('+24°');
    expect(formatGimbal(-0.2)).toBe('0°');
    expect(formatGimbal(0.3)).toBe('0°');
  });

  it('battery is a whole percentage between 0 and 100', () => {
    expect(formatBattery(100)).toBe('100%');
    expect(formatBattery(47.6)).toBe('48%');
    expect(formatBattery(-3)).toBe('0%');
    expect(formatBattery(140)).toBe('100%');
  });
});
