import { describe, expect, it } from 'vitest';
import { SIM_DT, SIM_HZ } from '../core/gameLoop';
import { Simulation } from '../core/simulation';
import { type ButtonId, type ControlFrame, neutralFrame, noButtonsPressed } from '../input/types';
import { CRASH_CHOSEN, FLIGHT_PROCEDURE } from './air2s.config';
import { createDroneState, createFlyingState } from './droneState';
import { type FlightEvent, phaseEvents } from './flightEvents';

type Input = Partial<
  Pick<ControlFrame, 'roll' | 'pitch' | 'yaw' | 'throttle' | 'mode' | 'connected'>
> & { press?: ButtonId[] };

function frame(input: Input = {}): ControlFrame {
  const { press = [], ...rest } = input;
  const buttons = noButtonsPressed();
  for (const id of press) {
    buttons[id] = true;
  }
  return { ...neutralFrame(0, 'N', true), ...rest, buttons };
}

/** Flies for `seconds` and returns the names of everything that happened, in order. */
function run(sim: Simulation, seconds: number, input: Input = {}): string[] {
  const controls = frame(input);
  const seen: FlightEvent[] = [];
  for (let i = 0; i < Math.round(seconds * SIM_HZ); i++) {
    sim.step(SIM_DT, controls);
    sim.drainEvents((event) => seen.push(event));
  }
  return seen.map((event) => (event.mode ? `${event.type}:${event.mode}` : event.type));
}

function airborne(height = 30): Simulation {
  const sim = new Simulation();
  sim.reset(height);
  return sim;
}

/** Both sticks down and inward: starts and stops the motors. */
const STICK_COMMAND: Input = { throttle: -1, pitch: -1, yaw: 1, roll: -1 };

describe('flight events', () => {
  it('reports nothing while nothing happens', () => {
    expect(run(new Simulation(), 5)).toEqual([]);
    expect(run(airborne(), 5, { pitch: 1, yaw: 0.5, throttle: 0.2 })).toEqual([]);
  });

  it('automatic take-off: home point, take-off, then complete at hover height', () => {
    const sim = new Simulation();

    expect(run(sim, 0.1, { press: ['takeoffLand'] })).toEqual(['homePointSet', 'takeoffStarted']);
    expect(run(sim, 8)).toEqual(['takeoffComplete']);
    expect(sim.snapshot().y).toBeCloseTo(FLIGHT_PROCEDURE.takeoffHeight, 1);
  });

  it('a take-off stopped with flight pause is not reported as complete', () => {
    const sim = new Simulation();
    run(sim, 0.1, { press: ['takeoffLand'] });
    run(sim, 0.3);

    expect(run(sim, 0.1, { press: ['pause'] })).toEqual(['takeoffStopped']);
    expect(sim.snapshot().y).toBeLessThan(1);
  });

  it('automatic landing: started, then landed with the motors off', () => {
    const sim = airborne(4);

    expect(run(sim, 0.1, { press: ['takeoffLand'] })).toEqual(['landingStarted']);
    expect(run(sim, 20)).toEqual(['landed']);
    expect(sim.phase).toBe('motorsOff');
  });

  it('a cancelled landing', () => {
    const sim = airborne(40);
    run(sim, 0.1, { press: ['takeoffLand'] });
    run(sim, 1);

    expect(run(sim, 0.1, { press: ['takeoffLand'] })).toEqual(['landingCancelled']);
    expect(sim.phase).toBe('flying');
  });

  it('flying by hand: motors started, lifted off, touched down, motors stopped', () => {
    const sim = new Simulation();

    expect(run(sim, FLIGHT_PROCEDURE.stickCommandHold + 0.05, STICK_COMMAND)).toEqual([
      'homePointSet',
      'motorsStarted',
    ]);
    run(sim, 0.2); // let the sticks go
    expect(run(sim, 2, { throttle: 1 })).toEqual(['liftedOff']);
    // Throttle held down: it descends, stands on the ground, and after 3 s the motors stop.
    expect(run(sim, 12, { throttle: -1 })).toEqual(['touchedDown', 'motorsStopped']);
    expect(sim.phase).toBe('motorsOff');
  });

  it('emergency stop high up: motors cut, crashed, then back at the start', () => {
    const sim = airborne(30);

    expect(run(sim, FLIGHT_PROCEDURE.emergencyStopHold + 0.1, STICK_COMMAND)).toEqual([
      'motorsCut',
    ]);
    expect(run(sim, 4)).toEqual(['crashed']);
    expect(sim.snapshot()).toMatchObject({ phase: 'crashed', onGround: true });

    expect(run(sim, CRASH_CHOSEN.resetDelay)).toEqual(['backAtStart']);
    expect(sim.snapshot()).toEqual(createDroneState());
  });

  it('a short fall that ends gently is reported as hitting the ground, not as a crash', () => {
    const falling = { ...createFlyingState(0.3), phase: 'motorsOff' as const };
    const landed = { ...createDroneState(), homeSet: true };

    expect(phaseEvents(falling, landed)).toEqual(['hitGround']);
  });

  it('a crash, and being put back at the start, are each reported once', () => {
    const flying = createFlyingState(5);
    const wreck = { ...createDroneState(), phase: 'crashed' as const };

    expect(phaseEvents(flying, wreck)).toEqual(['crashed']);
    expect(phaseEvents(wreck, wreck)).toEqual([]);
    expect(phaseEvents(wreck, createDroneState())).toEqual(['backAtStart']);
  });

  it('flying into the ground at speed is a crash', () => {
    const sim = airborne(3);

    expect(run(sim, 4, { pitch: 1, throttle: -1 })).toEqual(['crashed']);
  });

  it('reports a change of flight mode once, with the new mode', () => {
    const sim = airborne();
    run(sim, 1);

    expect(run(sim, 1, { mode: 'S' })).toEqual(['modeChanged:S']);
    expect(run(sim, 1, { mode: 'S' })).toEqual([]);
    expect(run(sim, 1, { mode: 'C' })).toEqual(['modeChanged:C']);
  });

  it('does not report the mode the flight starts in', () => {
    expect(run(airborne(), 1, { mode: 'S' })).toEqual([]);
  });

  it('reports a lost and a restored controller', () => {
    const sim = airborne();
    run(sim, 1);

    expect(run(sim, 1, { connected: false })).toEqual(['controlLost']);
    expect(run(sim, 1, { connected: false })).toEqual([]);
    expect(run(sim, 1)).toEqual(['controlRestored']);
  });

  it('hands each event out only once', () => {
    const sim = new Simulation();
    sim.step(SIM_DT, frame({ press: ['takeoffLand'] }));
    const first: string[] = [];
    const second: string[] = [];

    sim.drainEvents((event) => first.push(event.type));
    sim.drainEvents((event) => second.push(event.type));

    expect(first).toEqual(['homePointSet', 'takeoffStarted']);
    expect(second).toEqual([]);
  });

  it('forgets uncollected events when the flight is reset', () => {
    const sim = new Simulation();
    sim.step(SIM_DT, frame({ press: ['takeoffLand'] }));
    sim.reset();

    expect(run(sim, 1)).toEqual([]);
  });

  it('keeps only the newest events when nobody collects them', () => {
    const sim = airborne();
    for (let i = 0; i < 500; i++) {
      sim.step(SIM_DT, frame({ mode: i % 2 === 0 ? 'N' : 'S' }));
    }
    const kept: FlightEvent[] = [];
    sim.drainEvents((event) => kept.push(event));

    expect(kept.length).toBe(64);
    expect(kept.at(-1)).toEqual({ type: 'modeChanged', mode: 'S' });
  });

  it('never changes the flight: the same flight with and without collecting', () => {
    const script = (i: number): ControlFrame =>
      frame({
        pitch: Math.sin(i * 0.01),
        yaw: Math.cos(i * 0.007),
        mode: i % 600 < 300 ? 'N' : 'S',
        press: i % 2400 < 12 ? ['takeoffLand'] : [],
      });
    const collected = new Simulation();
    const ignored = new Simulation();
    for (let i = 0; i < 60 * SIM_HZ; i++) {
      collected.step(SIM_DT, script(i));
      collected.drainEvents(() => undefined);
      ignored.step(SIM_DT, script(i));
    }

    expect(collected.snapshot()).toEqual(ignored.snapshot());
  });
});

describe('phaseEvents', () => {
  it('is empty for two equal states', () => {
    expect(phaseEvents(createDroneState(), createDroneState())).toEqual([]);
    expect(phaseEvents(createFlyingState(5), createFlyingState(5))).toEqual([]);
  });

  it('reports motors stopping on the ground during a take-off as stopped, not cut', () => {
    const before = { ...createDroneState(), phase: 'takingOff' as const };
    const after = createDroneState();

    expect(phaseEvents(before, after)).toEqual(['motorsStopped']);
  });

  it('reports a landing started straight from a take-off', () => {
    const before = { ...createFlyingState(0.5), phase: 'takingOff' as const };
    const after = { ...createFlyingState(0.5), phase: 'landing' as const };

    expect(phaseEvents(before, after)).toEqual(['landingStarted']);
  });
});
