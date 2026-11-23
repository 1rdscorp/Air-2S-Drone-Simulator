import { describe, expect, it } from 'vitest';
import { AIR_2S_SPECS, GRAVITY, PROPULSION_CHOSEN } from '../drone/air2s.config';
import { createDroneState, createFlyingState, type DroneState } from '../drone/droneState';
import { FLIGHT_EVENT_TYPES } from '../drone/flightEvents';
import { type AudioState, soundLabelText } from './audioEngine';
import {
  airSound,
  distanceCutoff,
  distanceGain,
  listenerAt,
  motorLoad,
  motorSound,
  soundFrame,
  SOUND_TUNING,
  toneForEvent,
  toneLength,
} from './soundModel';

const DEG = Math.PI / 180;
const HOVER_NOTE = (PROPULSION_CHOSEN.hoverRpm * PROPULSION_CHOSEN.blades) / 60;

function flying(changes: Partial<DroneState> = {}): DroneState {
  return { ...createFlyingState(20), ...changes };
}

const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

describe('propeller numbers', () => {
  it('the chosen hover speed carries the aircraft, by the usual propeller formula', () => {
    const turnsPerSecond = PROPULSION_CHOSEN.hoverRpm / 60;
    const diameter = 0.183;
    const airDensity = 1.225;
    const thrustPerMotor = 0.11 * airDensity * turnsPerSecond ** 2 * diameter ** 4;
    const weightPerMotor = (AIR_2S_SPECS.takeoffMassKg * GRAVITY) / 4;

    expect(thrustPerMotor / weightPerMotor).toBeGreaterThan(0.9);
    expect(thrustPerMotor / weightPerMotor).toBeLessThan(1.1);
  });

  it('idle is below hover, and the top speed above it', () => {
    expect(PROPULSION_CHOSEN.idleRpm).toBeLessThan(PROPULSION_CHOSEN.hoverRpm);
    expect(PROPULSION_CHOSEN.maxRpm).toBeGreaterThan(PROPULSION_CHOSEN.hoverRpm);
  });
});

describe('motor sound', () => {
  it('is silent while the motors are off', () => {
    expect(motorSound(createDroneState())).toEqual({
      running: false,
      rpm: 0,
      frequencies: [0, 0, 0, 0],
      level: 0,
    });
  });

  it('hums at about 197 Hz in a hover: two blades at 5900 turns per minute', () => {
    const sound = motorSound(flying());

    expect(sound.running).toBe(true);
    expect(sound.rpm).toBeCloseTo(5900, 6);
    expect(HOVER_NOTE).toBeCloseTo(196.67, 2);
    expect(mean(sound.frequencies)).toBeCloseTo(HOVER_NOTE, 0);
    expect(sound.level).toBeCloseTo(SOUND_TUNING.hoverLevel, 6);
  });

  it('gives the four motors slightly different notes, which makes the buzz', () => {
    const { frequencies } = motorSound(flying());

    expect(new Set(frequencies.map((f) => f.toFixed(2))).size).toBe(4);
    for (const frequency of frequencies) {
      expect(Math.abs(frequency / HOVER_NOTE - 1)).toBeLessThan(0.02);
    }
  });

  it('idles low and quietly on the ground with the motors running', () => {
    const idle = motorSound({ ...createDroneState(), phase: 'idle' });

    expect(idle.rpm).toBe(PROPULSION_CHOSEN.idleRpm);
    expect(mean(idle.frequencies)).toBeCloseTo(73.3, 0);
    expect(idle.level).toBeLessThan(SOUND_TUNING.hoverLevel / 3);
    expect(idle.level).toBeGreaterThan(0.05);
  });

  it('rises in a climb and falls in a descent', () => {
    const hover = motorSound(flying());
    const climbing = motorSound(flying({ vy: 6 }));
    const descending = motorSound(flying({ vy: -6 }));

    expect(climbing.rpm).toBeGreaterThan(hover.rpm * 1.08);
    expect(descending.rpm).toBeLessThan(hover.rpm * 0.92);
    expect(climbing.level).toBeGreaterThan(hover.level);
    expect(descending.level).toBeLessThan(hover.level);
  });

  it('rises when the aircraft tilts, because a tilted aircraft needs more thrust', () => {
    const level = motorSound(flying());
    const normal = motorSound(flying({ pitch: 25 * DEG }));
    const sport = motorSound(flying({ pitch: 35 * DEG }));
    const sideways = motorSound(flying({ roll: -35 * DEG }));

    expect(normal.rpm).toBeGreaterThan(level.rpm * 1.03);
    expect(sport.rpm).toBeGreaterThan(normal.rpm);
    expect(sideways.rpm).toBeCloseTo(sport.rpm, 6);
  });

  it('never goes above the top motor speed, whatever the state', () => {
    const extreme = motorSound(flying({ pitch: 85 * DEG, roll: 85 * DEG, vy: 40 }));

    expect(extreme.rpm).toBe(PROPULSION_CHOSEN.maxRpm);
    expect(extreme.level).toBeLessThanOrEqual(1);
  });

  it('speeds up the rear motors to tip forward and the left ones to tip right', () => {
    const [frontLeft, frontRight, rearLeft, rearRight] = motorSound(
      flying({ pitchRate: 3 }),
    ).frequencies;
    expect(Math.min(rearLeft, rearRight)).toBeGreaterThan(Math.max(frontLeft, frontRight));

    const tipRight = motorSound(flying({ rollRate: 3 })).frequencies;
    expect(Math.min(tipRight[0], tipRight[2])).toBeGreaterThan(Math.max(tipRight[1], tipRight[3]));
  });

  it('speeds up one diagonal pair to turn, without changing the average', () => {
    const still = motorSound(flying());
    const turning = motorSound(flying({ yawRate: 4 }));
    const [frontLeft, frontRight, rearLeft, rearRight] = turning.frequencies;

    expect(Math.min(frontLeft, rearRight)).toBeGreaterThan(Math.max(frontRight, rearLeft));
    // The same to within a fraction of a hertz: the motors' small differences shift it a little.
    expect(Math.abs(mean(turning.frequencies) - mean(still.frequencies))).toBeLessThan(0.3);
    expect(turning.rpm).toBe(still.rpm);
  });

  it('thrust is 1 in a level hover', () => {
    expect(motorLoad({ pitch: 0, roll: 0, vy: 0 })).toBe(1);
    expect(motorLoad({ pitch: 0, roll: 0, vy: 6 })).toBeCloseTo(1 + SOUND_TUNING.climbLoad, 9);
    expect(motorLoad({ pitch: 60 * DEG, roll: 0, vy: 0 })).toBeCloseTo(2, 9);
  });
});

describe('rushing air', () => {
  it('is silent at rest', () => {
    expect(airSound({ vx: 0, vy: 0, vz: 0 }).level).toBe(0);
  });

  it('grows quickly with speed and is full at 20 m/s', () => {
    const slow = airSound({ vx: 5, vy: 0, vz: 0 }).level;
    const fast = airSound({ vx: 0, vy: 0, vz: -10 }).level;
    const full = airSound({ vx: 20, vy: 0, vz: 0 }).level;

    expect(fast).toBeCloseTo(slow * 4, 9);
    expect(full).toBeCloseTo(SOUND_TUNING.airLevel, 9);
  });

  it('is also heard in a fall, and never goes above full loudness', () => {
    expect(airSound({ vx: 0, vy: -15, vz: 0 }).level).toBeGreaterThan(0.4);
    expect(airSound({ vx: 0, vy: -60, vz: 0 }).level).toBe(1);
  });

  it('sounds higher the faster the air is', () => {
    const slow = airSound({ vx: 3, vy: 0, vz: 0 }).frequency;
    const fast = airSound({ vx: 19, vy: 0, vz: 0 }).frequency;

    expect(fast).toBeGreaterThan(slow * 2);
  });
});

describe('distance', () => {
  it('leaves a sound at full loudness up to two metres', () => {
    expect(distanceGain(0)).toBe(1);
    expect(distanceGain(1.7)).toBe(1);
    expect(distanceGain(2)).toBe(1);
  });

  it('makes it quieter the farther away, but never quite silent', () => {
    expect(distanceGain(20)).toBeCloseTo(0.156, 3);
    expect(distanceGain(100)).toBeLessThan(distanceGain(20) / 4);
    expect(distanceGain(1000)).toBeGreaterThan(0);
  });

  it('dulls it: the highest frequency halves every 40 metres at first', () => {
    expect(distanceCutoff(0)).toBe(9000);
    expect(distanceCutoff(40)).toBe(4500);
    expect(distanceCutoff(400)).toBeLessThan(1000);
  });
});

describe('listener', () => {
  const RIGHT = [1, 0, 0] as const;

  it('measures the distance to the aircraft', () => {
    expect(listenerAt([3, 0, -4], RIGHT).distance).toBe(5);
  });

  it('hears an aircraft on the right from the right, and on the left from the left', () => {
    expect(listenerAt([10, 0, -10], RIGHT).pan).toBeGreaterThan(0.4);
    expect(listenerAt([-10, 0, -10], RIGHT).pan).toBeLessThan(-0.4);
    expect(listenerAt([0, 3, -10], RIGHT).pan).toBe(0);
  });

  it('never puts a sound fully to one side', () => {
    expect(listenerAt([50, 0, 0], RIGHT).pan).toBeCloseTo(SOUND_TUNING.panWidth, 9);
    expect(listenerAt([-50, 0, 0], RIGHT).pan).toBeCloseTo(-SOUND_TUNING.panWidth, 9);
  });

  it('treats an aircraft closer than a metre as straight ahead', () => {
    expect(listenerAt([0.6, 0, 0], RIGHT).pan).toBe(0);
  });
});

describe('soundFrame', () => {
  const NEAR = { distance: 1.7, pan: 0 };

  it('is silent on the ground with the motors off', () => {
    const frame = soundFrame(createDroneState(), NEAR);

    expect(frame.motorRunning).toBe(false);
    expect(frame.motorGain).toBe(0);
    expect(frame.airGain).toBe(0);
  });

  it('in a hover next to the camera: motors at their hover loudness, no air', () => {
    const frame = soundFrame(flying(), NEAR);

    expect(frame.motorRunning).toBe(true);
    expect(frame.motorGain).toBeCloseTo(SOUND_TUNING.hoverLevel, 6);
    expect(frame.airGain).toBe(0);
    expect(mean(frame.motorFrequencies)).toBeCloseTo(HOVER_NOTE, 0);
  });

  it('is quieter and duller from far away, and comes from where the aircraft is', () => {
    const near = soundFrame(flying({ vx: 15 }), NEAR);
    const far = soundFrame(flying({ vx: 15 }), { distance: 80, pan: 0.5 });

    expect(far.motorGain).toBeLessThan(near.motorGain / 10);
    expect(far.airGain).toBeLessThan(near.airGain / 10);
    expect(far.cutoff).toBeLessThan(near.cutoff / 2);
    expect(far.pan).toBe(0.5);
    expect(far.motorFrequencies).toEqual(near.motorFrequencies);
  });

  it('lets the air be heard after the motors are cut, while the aircraft falls', () => {
    const falling = soundFrame(flying({ phase: 'motorsOff', vy: -20 }), NEAR);

    expect(falling.motorRunning).toBe(false);
    expect(falling.motorGain).toBe(0);
    expect(falling.airGain).toBeGreaterThan(0.5);
  });
});

describe('tones for flight events', () => {
  const SILENT = ['homePointSet', 'motorsStarted', 'motorsStopped', 'liftedOff'];

  it('has a tone for every event that the motors do not already tell', () => {
    for (const type of FLIGHT_EVENT_TYPES) {
      const tone = toneForEvent({ type, mode: 'N' });
      if (SILENT.includes(type)) {
        expect(tone, type).toBeNull();
      } else {
        expect(tone?.notes.length, type).toBeGreaterThan(0);
      }
    }
  });

  it('keeps every tone short, audible and not too loud', () => {
    for (const type of FLIGHT_EVENT_TYPES) {
      for (const mode of ['C', 'N', 'S'] as const) {
        const tone = toneForEvent({ type, mode });
        if (!tone) continue;
        expect(toneLength(tone), tone.name).toBeLessThanOrEqual(1);
        for (const note of tone.notes) {
          expect(note.frequency, tone.name).toBeGreaterThanOrEqual(40);
          expect(note.frequency, tone.name).toBeLessThanOrEqual(2000);
          expect(note.level, tone.name).toBeGreaterThan(0.1);
          expect(note.level, tone.name).toBeLessThanOrEqual(1);
          expect(note.duration, tone.name).toBeGreaterThan(0.03);
        }
      }
    }
  });

  it('rises for the take-off and falls for the landing', () => {
    const takeoff = toneForEvent({ type: 'takeoffStarted' })?.notes.map((n) => n.frequency) ?? [];
    const landing = toneForEvent({ type: 'landingStarted' })?.notes.map((n) => n.frequency) ?? [];
    const landed = toneForEvent({ type: 'landed' })?.notes.map((n) => n.frequency) ?? [];

    expect(takeoff[1]).toBeGreaterThan(takeoff[0] ?? Infinity);
    expect(landing[1]).toBeLessThan(landing[0] ?? 0);
    expect(landed).toEqual([...landed].sort((a, b) => b - a));
  });

  it('plays the notes of a tone one after the other, not on top of each other', () => {
    const notes = toneForEvent({ type: 'landed' })?.notes ?? [];

    expect(notes).toHaveLength(3);
    for (let i = 1; i < notes.length; i++) {
      const previous = notes[i - 1];
      expect(notes[i]?.start).toBeGreaterThanOrEqual(
        (previous?.start ?? 0) + (previous?.duration ?? 0),
      );
    }
  });

  it('uses harsh notes for warnings and soft ones for the rest', () => {
    const shapes = (type: (typeof FLIGHT_EVENT_TYPES)[number]): string[] =>
      toneForEvent({ type })?.notes.map((note) => note.shape) ?? [];

    expect(new Set(shapes('motorsCut'))).toEqual(new Set(['square']));
    expect(new Set(shapes('controlLost'))).toEqual(new Set(['square']));
    expect(shapes('takeoffComplete')).toEqual(['sine']);
    expect(shapes('controlRestored')).not.toContain('square');
  });

  it('gives each flight mode its own note: the faster the mode, the higher', () => {
    const first = (mode: 'C' | 'N' | 'S'): number =>
      toneForEvent({ type: 'modeChanged', mode })?.notes[0]?.frequency ?? 0;

    expect(first('C')).toBeLessThan(first('N'));
    expect(first('N')).toBeLessThan(first('S'));
    expect(toneForEvent({ type: 'modeChanged', mode: 'S' })?.name).toBe('modeS');
    expect(toneForEvent({ type: 'modeChanged', mode: 'S' })?.notes).toHaveLength(2);
  });

  it('a knock on the ground is a low note that drops', () => {
    const thud = toneForEvent({ type: 'hitGround' })?.notes[0];

    expect(thud?.frequency).toBeLessThan(200);
    expect(thud?.slideTo).toBeLessThan(thud?.frequency ?? 0);
  });
});

describe('sound label', () => {
  it('says whether there is sound and how to change it', () => {
    const cases: [AudioState, boolean, string][] = [
      ['running', false, 'Sound on · M to mute'],
      ['running', true, 'Sound off · M to switch on'],
      ['waiting', false, 'Sound starts with your first key press or click'],
      ['waiting', true, 'Sound off · M to switch on'],
      ['unavailable', false, 'No sound in this browser'],
      ['unavailable', true, 'No sound in this browser'],
    ];
    for (const [state, muted, text] of cases) {
      expect(soundLabelText(state, muted), `${state} ${muted}`).toBe(text);
    }
  });
});
