// Renders a scripted flight to a sound file with the simulator's own sound code, and
// prints what is in it second by second. For checking the sound where nobody can listen,
// and for a file to listen to afterwards.
//
//   1. npm run dev              (in another terminal)
//   2. node scripts/render-sound.mjs flight.wav
//
// The flight: take off, hover, climb, Sport mode at full speed, brake, turn, descend, land.
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const output = process.argv[2] ?? 'flight.wav';
const address = process.env.SIM_URL ?? 'http://localhost:5173';
const RATE = 44100;
const SECONDS = 29;

/** What runs inside the page: flies the script and renders the sound faster than real time. */
async function renderInPage({ rate, seconds }) {
  const { AudioEngine } = await import('/src/audio/audioEngine.ts');
  const { soundFrame, toneForEvent } = await import('/src/audio/soundModel.ts');
  const { Simulation } = await import('/src/core/simulation.ts');
  const { neutralFrame, noButtonsPressed } = await import('/src/input/types.ts');

  const context = new OfflineAudioContext(2, rate * seconds, rate);
  const engine = new AudioEngine({ volume: 0.7, muted: false, createContext: () => context });
  engine.unlock();

  // [from second, controls held from then on]
  const script = [
    [0.0, {}],
    [0.5, { buttons: { takeoffLand: true } }],
    [0.6, {}],
    [5.0, { throttle: 1 }],
    [7.0, {}],
    [8.0, { mode: 'S' }],
    [8.3, { mode: 'S', pitch: 1 }],
    [13.0, { mode: 'S' }],
    [16.0, { mode: 'S', yaw: 1 }],
    [17.5, { mode: 'S', throttle: -1 }],
    [19.3, { mode: 'S' }],
    [20.5, { mode: 'N' }],
    [21.0, { mode: 'N', buttons: { takeoffLand: true } }],
    [21.1, { mode: 'N' }],
  ];
  const controlsAt = (time) => {
    let held = {};
    for (const [from, controls] of script) {
      if (time >= from) held = controls;
    }
    return {
      ...neutralFrame(0, 'N', true),
      ...held,
      buttons: { ...noButtonsPressed(), ...(held.buttons ?? {}) },
    };
  };

  const simulation = new Simulation();
  // Heard from the chase camera, 1.7 m behind the aircraft.
  const listener = { distance: 1.7, pan: 0 };
  const events = [];
  const step = 1 / 120;
  let tick = 0;
  for (let frame = 0; frame < seconds * 60; frame++) {
    const time = frame / 60;
    for (let i = 0; i < 2; i++) {
      simulation.step(step, controlsAt(tick * step));
      tick++;
      simulation.drainEvents((event) => {
        const tone = toneForEvent(event);
        events.push(`${time.toFixed(1)} s  ${event.type}${tone ? `  (tone ${tone.name})` : ''}`);
        if (tone) engine.playTone(tone, time);
      });
    }
    engine.update(soundFrame(simulation.state, listener), time);
  }

  const rendered = await context.startRendering();
  return {
    left: Array.from(rendered.getChannelData(0)),
    right: Array.from(rendered.getChannelData(1)),
    events,
  };
}

/** A 16-bit stereo WAV file. */
function wav(left, right) {
  const file = Buffer.alloc(44 + left.length * 4);
  file.write('RIFF', 0);
  file.writeUInt32LE(36 + left.length * 4, 4);
  file.write('WAVEfmt ', 8);
  file.writeUInt32LE(16, 16);
  file.writeUInt16LE(1, 20);
  file.writeUInt16LE(2, 22);
  file.writeUInt32LE(RATE, 24);
  file.writeUInt32LE(RATE * 4, 28);
  file.writeUInt16LE(4, 32);
  file.writeUInt16LE(16, 34);
  file.write('data', 36);
  file.writeUInt32LE(left.length * 4, 40);
  const sample = (value) => Math.round(Math.max(-1, Math.min(1, value)) * 32767);
  for (let i = 0; i < left.length; i++) {
    file.writeInt16LE(sample(left[i]), 44 + i * 4);
    file.writeInt16LE(sample(right[i]), 46 + i * 4);
  }
  return file;
}

/** Strength of each frequency in `samples` (length a power of two), by a plain FFT. */
function spectrum(samples) {
  const size = samples.length;
  const real = Float64Array.from(samples, (value, i) => {
    return value * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
  });
  const imaginary = new Float64Array(size);
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [real[i], real[j]] = [real[j], real[i]];
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    for (let start = 0; start < size; start += length) {
      for (let k = 0; k < length / 2; k++) {
        const cos = Math.cos(angle * k);
        const sin = Math.sin(angle * k);
        const a = start + k;
        const b = a + length / 2;
        const re = real[b] * cos - imaginary[b] * sin;
        const im = real[b] * sin + imaginary[b] * cos;
        real[b] = real[a] - re;
        imaginary[b] = imaginary[a] - im;
        real[a] += re;
        imaginary[a] += im;
      }
    }
  }
  return Array.from({ length: size / 2 }, (_, i) => Math.hypot(real[i], imaginary[i]));
}

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH ?? undefined,
  args: ['--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage();
  await page.goto(`${address}/?paused=1&sound=0`);
  await page.waitForSelector('html[data-sim-ready="true"]', { timeout: 30_000 });
  const { left, right, events } = await page.evaluate(renderInPage, {
    rate: RATE,
    seconds: SECONDS,
  });
  writeFileSync(output, wav(left, right));

  console.log(events.join('\n'));
  console.log('\nsecond  loudness  strongest note  share above 1 kHz');
  const SIZE = 32768;
  let loudest = 0;
  for (let second = 0; second < SECONDS; second++) {
    const part = left.slice(second * RATE, second * RATE + SIZE);
    if (part.length < SIZE) break;
    const loudness = Math.sqrt(part.reduce((sum, value) => sum + value * value, 0) / SIZE);
    const strengths = spectrum(part);
    const peak = strengths.indexOf(Math.max(...strengths));
    const total = strengths.reduce((sum, value) => sum + value * value, 0) || 1;
    const high = strengths.reduce(
      (sum, value, bin) => ((bin * RATE) / SIZE > 1000 ? sum + value * value : sum),
      0,
    );
    const note = loudness < 0.0005 ? 'silence' : `${Math.round((peak * RATE) / SIZE)} Hz`;
    console.log(
      `${String(second).padStart(5)}  ${loudness.toFixed(4).padStart(8)}  ${note.padStart(14)}  ${((100 * high) / total).toFixed(1).padStart(8)} %`,
    );
  }
  for (const value of left) loudest = Math.max(loudest, Math.abs(value));
  console.log(`\nLoudest sample: ${loudest.toFixed(3)} (1.000 would be distorted)`);
  console.log(`Written: ${output}`);
} finally {
  await browser.close();
}
