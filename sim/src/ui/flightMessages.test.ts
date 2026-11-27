import { describe, expect, it } from 'vitest';
import { FLIGHT_EVENT_TYPES } from '../drone/flightEvents';
import { flightMessage } from './flightMessages';

describe('flightMessage', () => {
  it('has words for every flight event', () => {
    for (const type of FLIGHT_EVENT_TYPES) {
      const message = flightMessage({ type, mode: 'N' });

      expect(message.text.length, type).toBeGreaterThan(5);
      expect(message.key.length, type).toBeGreaterThan(0);
    }
  });

  it('names the new mode and its top speed', () => {
    expect(flightMessage({ type: 'modeChanged', mode: 'C' }).text).toBe('Cine mode · up to 5 m/s');
    expect(flightMessage({ type: 'modeChanged', mode: 'N' }).text).toBe(
      'Normal mode · up to 15 m/s',
    );
    expect(flightMessage({ type: 'modeChanged', mode: 'S' }).text).toBe(
      'Sport mode · up to 19 m/s',
    );
  });

  it('says how high the automatic take-off went', () => {
    expect(flightMessage({ type: 'takeoffComplete' }).text).toBe(
      'Take-off complete · hovering at 1.2 m',
    );
  });

  it('marks what the pilot must not miss as a warning', () => {
    const warnings = FLIGHT_EVENT_TYPES.filter(
      (type) => flightMessage({ type }).kind === 'warning',
    );

    expect(warnings).toEqual(['motorsCut', 'hitGround', 'crashed', 'controlLost']);
  });

  it('lets a later message about the flight replace the earlier one', () => {
    expect(flightMessage({ type: 'takeoffStarted' }).key).toBe(
      flightMessage({ type: 'takeoffComplete' }).key,
    );
    expect(flightMessage({ type: 'motorsCut' }).key).toBe(flightMessage({ type: 'hitGround' }).key);
  });

  it('keeps home point, mode and controller messages apart from the flight ones', () => {
    const keys = new Set(
      (['homePointSet', 'takeoffStarted', 'modeChanged', 'controlLost'] as const).map(
        (type) => flightMessage({ type }).key,
      ),
    );

    expect(keys.size).toBe(4);
  });
});
