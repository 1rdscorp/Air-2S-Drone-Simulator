import type { SoundFrame, ToneSpec } from './soundModel';

/**
 * 'unavailable': this browser has no Web Audio.
 * 'waiting': browsers only allow sound after a key press or a click; none has come yet.
 * 'running': sound is being made (it may still be muted).
 */
export type AudioState = 'unavailable' | 'waiting' | 'running';

/** What the engine is doing, for the sound label and for tests. */
export interface AudioSnapshot {
  state: AudioState;
  muted: boolean;
  volume: number;
  /** True while nothing may be heard: muted, paused, or the page is in the background. */
  silenced: boolean;
  /** What the engine is steering towards. */
  motorRunning: boolean;
  motorFrequency: number;
  motorGain: number;
  airGain: number;
  /** Loudness measured at the output right now, 0 to about 1. */
  level: number;
  /** The strongest frequency measured at the output right now, in hertz. */
  peakFrequency: number;
  /** Names of the most recent tones, oldest first. */
  tonesPlayed: string[];
}

export interface AudioEngineOptions {
  /** Overall loudness, 0 to 1. */
  volume: number;
  muted: boolean;
  /** Makes the browser's audio context. Tests and offline rendering supply their own. */
  createContext?: () => BaseAudioContext | null;
}

/** How quickly things change, as time constants in seconds: smaller is quicker. */
const SMOOTHING = {
  /** Motor note following the thrust. */
  motorPitch: 0.09,
  /** Motors running up from standstill, and running down. */
  spinUp: 0.22,
  spinDown: 0.45,
  loudness: 0.08,
  /** Fading everything out and in for mute, pause and a hidden page. */
  master: 0.04,
} as const;

/**
 * Strength of the motor note's overtones, first to twelfth. A propeller does not hum a
 * pure note; the overtones are what makes it a buzz.
 */
const MOTOR_OVERTONES = [1, 0.72, 0.55, 0.44, 0.34, 0.27, 0.2, 0.16, 0.12, 0.09, 0.07, 0.05];

/** A stopped motor is steered down to this note, in hertz, while it fades out. */
const STOPPED_FREQUENCY = 12;

const MAX_TONES_REMEMBERED = 20;

/** Loudness of the parts before the master volume. */
const MIX = { motor: 0.34, motorHiss: 0.05, air: 0.5, tones: 0.5 } as const;

function defaultContext(): BaseAudioContext | null {
  const scope = globalThis as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Context = scope.AudioContext ?? scope.webkitAudioContext;
  return Context ? new Context({ latencyHint: 'interactive' }) : null;
}

interface Graph {
  context: BaseAudioContext;
  master: GainNode;
  analyser: AnalyserNode;
  motors: OscillatorNode[];
  motorGain: GainNode;
  motorHiss: GainNode;
  motorFilter: BiquadFilterNode;
  motorPan: StereoPannerNode;
  airFilter: BiquadFilterNode;
  airGain: GainNode;
  tones: GainNode;
}

/**
 * Makes the simulator's sound with the browser's Web Audio: four motor notes, their hiss,
 * rushing air, and short tones. It is told what to play by `soundModel.ts` and adds only
 * the smooth changes between one moment and the next.
 *
 * Sound never influences the simulation.
 */
export class AudioEngine {
  private readonly createContext: () => BaseAudioContext | null;
  private graph: Graph | null = null;
  private unavailable = false;
  private mutedValue: boolean;
  private paused = false;
  private hidden = false;
  private motorWasRunning = false;
  private target = { motorRunning: false, motorFrequency: 0, motorGain: 0, airGain: 0 };
  private readonly played: string[] = [];
  private samples: Float32Array<ArrayBuffer> | null = null;
  private spectrum: Float32Array<ArrayBuffer> | null = null;

  readonly volume: number;

  constructor(options: AudioEngineOptions) {
    this.volume = Math.min(Math.max(options.volume, 0), 1);
    this.mutedValue = options.muted;
    this.createContext = options.createContext ?? defaultContext;
  }

  get state(): AudioState {
    if (this.unavailable) {
      return 'unavailable';
    }
    return this.graph && this.graph.context.state === 'running' ? 'running' : 'waiting';
  }

  get muted(): boolean {
    return this.mutedValue;
  }

  set muted(value: boolean) {
    this.mutedValue = value;
    this.applyMaster();
  }

  /** The time on the audio clock, in seconds; 0 before any sound was allowed. */
  get now(): number {
    return this.graph?.context.currentTime ?? 0;
  }

  /**
   * Starts the sound. Browsers only allow this in answer to a key press or a click, so
   * call it from one. Calling it again does no harm.
   */
  unlock(): void {
    if (this.unavailable) {
      return;
    }
    if (!this.graph) {
      let context: BaseAudioContext | null;
      try {
        context = this.createContext();
      } catch {
        context = null;
      }
      if (!context) {
        this.unavailable = true;
        return;
      }
      this.graph = this.build(context);
      this.applyMaster();
    }
    const context = this.graph.context;
    if (context.state === 'suspended' && 'resume' in context) {
      void (context as AudioContext).resume().catch(() => undefined);
    }
  }

  /** Silence while the simulation is paused. */
  setPaused(paused: boolean): void {
    if (paused !== this.paused) {
      this.paused = paused;
      this.applyMaster();
    }
  }

  /** Silence while the page is in the background, where nothing is drawn or steered. */
  setHidden(hidden: boolean): void {
    if (hidden !== this.hidden) {
      this.hidden = hidden;
      this.applyMaster();
    }
  }

  /**
   * Steers the sound towards `frame`. Call for every drawn frame.
   * @param when time on the audio clock; only offline rendering passes it
   */
  update(frame: SoundFrame, when?: number): void {
    const frequency =
      frame.motorFrequencies.reduce((sum, value) => sum + value, 0) / frame.motorFrequencies.length;
    this.target = {
      motorRunning: frame.motorRunning,
      motorFrequency: frequency,
      motorGain: frame.motorGain,
      airGain: frame.airGain,
    };
    const graph = this.graph;
    if (!graph) {
      return;
    }
    const at = when ?? graph.context.currentTime;

    // Motors: a stopped motor runs down to a growl and fades; a started one runs up.
    let pitchTime: number = SMOOTHING.motorPitch;
    if (frame.motorRunning !== this.motorWasRunning) {
      pitchTime = frame.motorRunning ? SMOOTHING.spinUp : SMOOTHING.spinDown;
    } else if (!frame.motorRunning) {
      pitchTime = SMOOTHING.spinDown;
    }
    this.motorWasRunning = frame.motorRunning;
    graph.motors.forEach((motor, index) => {
      const note = frame.motorRunning
        ? (frame.motorFrequencies[index] ?? STOPPED_FREQUENCY)
        : STOPPED_FREQUENCY;
      motor.frequency.setTargetAtTime(Math.max(note, 1), at, pitchTime);
    });
    const motorGain = frame.motorRunning ? frame.motorGain : 0;
    const fade = frame.motorRunning ? SMOOTHING.loudness : SMOOTHING.spinDown * 0.6;
    graph.motorGain.gain.setTargetAtTime(motorGain * MIX.motor, at, fade);
    graph.motorHiss.gain.setTargetAtTime(motorGain * MIX.motorHiss, at, fade);
    graph.motorFilter.frequency.setTargetAtTime(frame.cutoff, at, SMOOTHING.loudness);
    graph.motorPan.pan.setTargetAtTime(frame.pan, at, SMOOTHING.loudness);

    graph.airGain.gain.setTargetAtTime(frame.airGain * MIX.air, at, SMOOTHING.loudness);
    graph.airFilter.frequency.setTargetAtTime(
      Math.min(frame.airFrequency, frame.cutoff),
      at,
      SMOOTHING.loudness,
    );
  }

  /**
   * Plays a short tone. Nothing is played, and nothing is kept for later, while sound is
   * not running or is silenced.
   * @param when time on the audio clock; only offline rendering passes it
   */
  playTone(tone: ToneSpec, when?: number): void {
    const graph = this.graph;
    if (!graph || (when === undefined && (this.state !== 'running' || this.silenced))) {
      return;
    }
    const start = when ?? graph.context.currentTime;
    for (const note of tone.notes) {
      const from = start + note.start;
      const to = from + note.duration;
      const oscillator = graph.context.createOscillator();
      oscillator.type = note.shape;
      oscillator.frequency.setValueAtTime(note.frequency, from);
      if (note.slideTo !== undefined) {
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(note.slideTo, 1), to);
      }
      // A soft start and end, or every note would begin and end with a click.
      const envelope = graph.context.createGain();
      envelope.gain.setValueAtTime(0, from);
      envelope.gain.linearRampToValueAtTime(note.level, from + 0.008);
      envelope.gain.setValueAtTime(note.level, Math.max(from + 0.008, to - 0.03));
      envelope.gain.linearRampToValueAtTime(0, to);
      oscillator.connect(envelope).connect(graph.tones);
      oscillator.start(from);
      oscillator.stop(to + 0.02);
    }
    this.played.push(tone.name);
    if (this.played.length > MAX_TONES_REMEMBERED) {
      this.played.shift();
    }
  }

  snapshot(): AudioSnapshot {
    const measured = this.measure();
    return {
      state: this.state,
      muted: this.mutedValue,
      volume: this.volume,
      silenced: this.silenced,
      ...this.target,
      level: measured.level,
      peakFrequency: measured.peakFrequency,
      tonesPlayed: [...this.played],
    };
  }

  private get silenced(): boolean {
    return this.mutedValue || this.paused || this.hidden;
  }

  private applyMaster(): void {
    const graph = this.graph;
    if (!graph) {
      return;
    }
    const gain = this.silenced ? 0 : this.volume;
    graph.master.gain.setTargetAtTime(gain, graph.context.currentTime, SMOOTHING.master);
  }

  /** Loudness and strongest frequency at the output, measured by the browser. */
  private measure(): { level: number; peakFrequency: number } {
    const graph = this.graph;
    if (!graph || this.state !== 'running') {
      return { level: 0, peakFrequency: 0 };
    }
    const { analyser, context } = graph;
    this.samples ??= new Float32Array(analyser.fftSize);
    this.spectrum ??= new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatTimeDomainData(this.samples);
    let squares = 0;
    for (const sample of this.samples) {
      squares += sample * sample;
    }
    analyser.getFloatFrequencyData(this.spectrum);
    let peak = 0;
    for (let bin = 1; bin < this.spectrum.length; bin++) {
      if ((this.spectrum[bin] ?? -Infinity) > (this.spectrum[peak] ?? -Infinity)) {
        peak = bin;
      }
    }
    return {
      level: Math.sqrt(squares / this.samples.length),
      peakFrequency: (peak * context.sampleRate) / analyser.fftSize,
    };
  }

  private build(context: BaseAudioContext): Graph {
    // Everything ends in the master volume; a limiter behind it keeps loud moments clean.
    const master = context.createGain();
    master.gain.value = 0;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 8;
    const analyser = context.createAnalyser();
    analyser.fftSize = 8192;
    analyser.smoothingTimeConstant = 0.5;
    master.connect(limiter).connect(context.destination);
    master.connect(analyser);

    // One second of noise, played round and round: the raw material for hiss and wind.
    const noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = noise.getChannelData(0);
    let seed = 0x2f6e2b1;
    for (let i = 0; i < data.length; i++) {
      // A small fixed-seed generator, so the noise is the same on every run.
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      data[i] = seed / 0x80000000;
    }
    const noiseSource = (): AudioBufferSourceNode => {
      const source = context.createBufferSource();
      source.buffer = noise;
      source.loop = true;
      source.start();
      return source;
    };

    // Motors: four notes with overtones, slightly apart, plus a hiss.
    const real = new Float32Array(MOTOR_OVERTONES.length + 1);
    const imaginary = new Float32Array(MOTOR_OVERTONES.length + 1);
    MOTOR_OVERTONES.forEach((strength, index) => {
      imaginary[index + 1] = strength;
    });
    const wave = context.createPeriodicWave(real, imaginary);
    const motorFilter = context.createBiquadFilter();
    motorFilter.type = 'lowpass';
    motorFilter.frequency.value = 9000;
    motorFilter.Q.value = 0.5;
    const motorGain = context.createGain();
    motorGain.gain.value = 0;
    const motors = [0, 1, 2, 3].map(() => {
      const motor = context.createOscillator();
      motor.setPeriodicWave(wave);
      motor.frequency.value = STOPPED_FREQUENCY;
      motor.connect(motorGain);
      motor.start();
      return motor;
    });
    const hissBand = context.createBiquadFilter();
    hissBand.type = 'bandpass';
    hissBand.frequency.value = 2800;
    hissBand.Q.value = 0.7;
    const motorHiss = context.createGain();
    motorHiss.gain.value = 0;
    noiseSource().connect(hissBand).connect(motorHiss);
    const motorPan = context.createStereoPanner();
    motorGain.connect(motorFilter);
    motorHiss.connect(motorFilter);
    motorFilter.connect(motorPan).connect(master);

    // Rushing air: noise through a band that rises with speed.
    const airFilter = context.createBiquadFilter();
    airFilter.type = 'bandpass';
    airFilter.frequency.value = 300;
    airFilter.Q.value = 0.6;
    const airGain = context.createGain();
    airGain.gain.value = 0;
    noiseSource().connect(airFilter).connect(airGain).connect(master);

    const tones = context.createGain();
    tones.gain.value = MIX.tones;
    tones.connect(master);

    return {
      context,
      master,
      analyser,
      motors,
      motorGain,
      motorHiss,
      motorFilter,
      motorPan,
      airFilter,
      airGain,
      tones,
    };
  }
}

/** The line that tells the pilot whether there is sound and how to change that. */
export function soundLabelText(state: AudioState, muted: boolean): string {
  if (state === 'unavailable') {
    return 'No sound in this browser';
  }
  if (muted) {
    return 'Sound off · M to switch on';
  }
  return state === 'running'
    ? 'Sound on · M to mute'
    : 'Sound starts with your first key press or click';
}
