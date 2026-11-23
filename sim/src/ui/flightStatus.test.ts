import { describe, expect, it } from 'vitest';
import { FLIGHT_PHASES } from '../drone/droneState';
import { flightStatusText, PHASE_LABELS, takeoffButtonName } from './flightStatus';

describe('flightStatusText', () => {
  it('tells the pilot how to take off when the motors are off', () => {
    expect(flightStatusText('motorsOff', true, 'N', 'T')).toBe('Motors off · press T to take off');
  });

  it('says the aircraft is falling when the motors are off in the air', () => {
    expect(flightStatusText('motorsOff', false, 'N', 'T')).toBe('Motors stopped · falling');
  });

  it('offers both ways to lift off when the motors are running on the ground', () => {
    expect(flightStatusText('idle', true, 'N', 'T')).toBe(
      'Motors on · press T to take off, or push the throttle up',
    );
  });

  it('shows the flight mode and how to land while flying', () => {
    expect(flightStatusText('flying', false, 'N', 'T')).toBe(
      'Flying · Normal mode · press T to land',
    );
    expect(flightStatusText('flying', false, 'C', 'T')).toContain('Cine mode');
    expect(flightStatusText('flying', false, 'S', 'T')).toContain('Sport mode');
  });

  it('shows take-off and landing in progress', () => {
    expect(flightStatusText('takingOff', false, 'N', 'T')).toBe('Taking off…');
    expect(flightStatusText('landing', false, 'N', 'T')).toBe('Landing… · press T to cancel');
  });

  it('names the button of the device in use', () => {
    expect(flightStatusText('motorsOff', true, 'N', 'Start')).toContain('press Start to');
  });

  it('has a text for every phase', () => {
    for (const phase of FLIGHT_PHASES) {
      expect(flightStatusText(phase, phase !== 'flying', 'N', 'T').length).toBeGreaterThan(5);
      expect(PHASE_LABELS[phase].length).toBeGreaterThan(3);
    }
  });
});

describe('takeoffButtonName', () => {
  it('is T on the keyboard and Start on a gamepad', () => {
    expect(takeoffButtonName('keyboard')).toBe('T');
    expect(takeoffButtonName('gamepad')).toBe('Start');
    expect(takeoffButtonName('ble-bridge')).toBe('the take-off button');
  });
});

describe('takeoffButtonName with a flight stick', () => {
  it("names the stick's own button when it has one, and the T key when it has not", () => {
    expect(takeoffButtonName('joystick', true)).toBe('the take-off button');
    expect(takeoffButtonName('joystick', false)).toBe('T');
    expect(takeoffButtonName('gamepad', true)).toBe('Start');
  });
});
