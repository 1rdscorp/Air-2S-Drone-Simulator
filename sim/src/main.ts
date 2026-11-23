import './style.css';
import { ACESFilmicToneMapping, PerspectiveCamera, Vector3, WebGLRenderer } from 'three';
import { AudioEngine, soundLabelText } from './audio/audioEngine';
import { type Listener, listenerAt, soundFrame, toneForEvent } from './audio/soundModel';
import {
  CAMERA_MODE_NAMES,
  cameraLabelText,
  type CameraMode,
  CameraRig,
  VIEW_FOV_DEG,
} from './camera/cameraRig';
import { aimSunAt, createBaseScene } from './core/baseScene';
import { FrameStats } from './core/frameStats';
import { GameLoop } from './core/gameLoop';
import { parseParams } from './core/params';
import { Simulation } from './core/simulation';
import { installTestHook, type ScriptedControls } from './core/testHook';
import { animateRotors, applyPose, createDroneModel } from './drone/droneModel';
import { headingDegrees, horizontalSpeed } from './drone/droneState';
import { GamepadSource } from './input/gamepadSource';
import { InputManager } from './input/inputManager';
import { joystickLabelText, JoystickSource, type JoystickStatus } from './input/joystickSource';
import { browserStorage, loadJoystickMapping, saveJoystickMapping } from './input/joystickStorage';
import { KeyboardSource } from './input/keyboardSource';
import { type ControlFrame, neutralFrame, noButtonsPressed } from './input/types';
import { bindDebugKeys, nextTimeScale } from './ui/debugControls';
import { type DebugInfo, DebugOverlay, formatTimeScale } from './ui/debugOverlay';
import { flightStatusText, takeoffButtonName } from './ui/flightStatus';
import { flightMessage } from './ui/flightMessages';
import { bindFreeCameraControls } from './ui/freeCameraControls';
import { Hud } from './ui/hud';
import { JoystickSetupScreen } from './ui/joystickSetup';
import { hudValues } from './ui/hudValues';
import { StickMonitor } from './ui/stickMonitor';
import { ToastList } from './ui/toasts';

const MAX_PIXEL_RATIO = 2;

function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Element ${selector} is missing from index.html`);
  }
  return element;
}

function start(): void {
  const canvas = requireElement<HTMLCanvasElement>('#view');
  const message = requireElement('#message');
  const statusBadge = requireElement('#status-badge');
  const flightStatus = requireElement('#flight-status');
  const cameraLabel = requireElement('#camera-label');
  const soundLabel = requireElement('#sound-label');
  const stickLabel = requireElement('#stick-label');
  requireElement('#build-label').textContent = `Air 2S Drone Simulator · v${__APP_VERSION__}`;

  const { params, warnings } = parseParams(window.location.search);
  for (const warning of warnings) {
    console.warn(warning);
  }

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true });
  } catch {
    message.textContent =
      'This browser could not start 3D graphics (WebGL). ' +
      'Try a current version of Chrome or Edge with hardware acceleration switched on.';
    message.hidden = false;
    return;
  }
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;

  const { scene, sun } = createBaseScene();
  const drone = createDroneModel();
  scene.add(drone.root);

  const camera = new PerspectiveCamera(VIEW_FOV_DEG, 1, 0.1, 5000);
  const cameraRig = new CameraRig(params.camera);
  bindFreeCameraControls(canvas, cameraRig);

  /** Shows which view is in use, and what the mouse does in it. */
  const refreshCameraLabel = (): void => {
    cameraLabel.textContent = cameraLabelText(cameraRig.mode);
    canvas.classList.toggle('is-free-camera', cameraRig.mode === 'free');
  };
  refreshCameraLabel();

  const resize = (): void => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  // Controls. Read once per display frame; the stick monitor shows what was read.
  const keyboard = new KeyboardSource();
  keyboard.attach(window);
  const gamepad = new GamepadSource(() => navigator.getGamepads());
  // Flight sticks, throttles and pedals, read through the setup the pilot made.
  const storage = browserStorage();
  const joystick = new JoystickSource(() => navigator.getGamepads(), loadJoystickMapping(storage));
  const input = new InputManager([keyboard, gamepad, joystick], {
    stickMode: params.stickMode,
    expo: params.expo,
  });
  const stickMonitor = new StickMonitor(requireElement('#stick-monitor'));
  stickMonitor.visible = params.sticks;

  /** Controls set by a test through `window.__sim`; they replace the pilot's while set. */
  let scripted: ControlFrame | null = null;
  const currentControls = (): ControlFrame => scripted ?? input.frame;

  // Flight display. It shows the simulation state and the messages about what happens in
  // the flight; the messages live in simulated time.
  const hud = new Hud(requireElement('#hud'));
  const toasts = new ToastList();

  // Sound. Browsers allow it only after a key press or a click, so it starts with the
  // first one. It follows the simulation and never influences it.
  const audio = new AudioEngine({ volume: params.volume, muted: !params.sound });
  const unlockSound = (): void => {
    audio.unlock();
  };
  window.addEventListener('keydown', unlockSound, { capture: true });
  window.addEventListener('pointerdown', unlockSound, { capture: true });
  document.addEventListener('visibilitychange', () => {
    audio.setHidden(document.hidden);
  });

  let shownSoundLabel = '';
  const refreshSoundLabel = (): void => {
    const text = soundLabelText(audio.state, audio.muted);
    if (text !== shownSoundLabel) {
      shownSoundLabel = text;
      soundLabel.textContent = text;
    }
  };

  /** Where the camera hears the aircraft from. The drone camera sits on the aircraft itself. */
  const cameraRight = new Vector3();
  const ONBOARD: Listener = { distance: 0.7, pan: 0 };
  const listener = (pose: { x: number; y: number; z: number }): Listener => {
    if (cameraRig.mode === 'fpv') {
      return ONBOARD;
    }
    cameraRight.setFromMatrixColumn(camera.matrixWorld, 0);
    return listenerAt(
      [pose.x - camera.position.x, pose.y - camera.position.y, pose.z - camera.position.z],
      [cameraRight.x, cameraRight.y, cameraRight.z],
    );
  };

  // Simulation and loop. The simulation only changes in `step`; `render` only reads it.
  const sim = new Simulation({ gimbalUpward: params.gimbalUpward });
  /** Real time since the previous display frame; the chase camera eases with it. */
  let frameSeconds = 0;
  const loop = new GameLoop({
    step: (dt, tick) => {
      sim.step(dt, currentControls());
      sim.drainEvents((event) => {
        toasts.push(flightMessage(event), (tick + 1) * dt);
        const tone = toneForEvent(event);
        if (tone) {
          audio.playTone(tone);
        }
      });
    },
    render: (alpha) => {
      const pose = sim.interpolate(alpha);
      applyPose(drone, pose);
      animateRotors(drone, sim.phase, loop.simTime);
      // The drone camera looks out of the camera pod, so the pod itself must not be drawn.
      drone.gimbal.visible = cameraRig.mode !== 'fpv';
      cameraRig.update(camera, pose, frameSeconds);
      aimSunAt(sun, pose.x, pose.y, pose.z);
      renderer.render(scene, camera);
      hud.update(hudValues(sim.state, currentControls().mode), toasts.active(loop.simTime));
      audio.setPaused(loop.paused);
      audio.update(soundFrame(sim.state, listener(pose)));
    },
  });
  loop.paused = params.paused;
  loop.timeScale = params.speed;

  // Debug tools.
  const stats = new FrameStats();
  const overlay = new DebugOverlay(requireElement('#debug-overlay'));
  overlay.visible = params.debug;

  const debugInfo = (): DebugInfo => {
    const state = sim.snapshot();
    return {
      fps: stats.fps,
      frameMs: stats.frameMs,
      maxFrameMs: stats.maxFrameMs,
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      tick: loop.tick,
      simTime: loop.simTime,
      timeScale: loop.timeScale,
      paused: loop.paused,
      inputSource: scripted ? 'Test script' : input.activeSource.label,
      camera: CAMERA_MODE_NAMES[cameraRig.mode],
      drone: {
        phase: state.phase,
        height: state.y,
        speed: horizontalSpeed(state),
        climbRate: state.vy,
        headingDeg: headingDegrees(state.heading),
        onGround: state.onGround,
        gimbalDeg: (state.gimbalTilt * 180) / Math.PI,
      },
      params,
    };
  };

  /** Shows "Paused" or a speed other than 1×, so a still or slow picture is never a mystery. */
  const refreshStatus = (): void => {
    const parts: string[] = [];
    if (loop.paused) {
      parts.push('Paused');
    }
    if (loop.timeScale !== 1) {
      parts.push(`Speed ${formatTimeScale(loop.timeScale)}`);
    }
    statusBadge.textContent = parts.join(' · ');
    statusBadge.hidden = parts.length === 0;
    overlay.refreshSoon();
  };
  refreshStatus();

  /** Draws a frame right away, with every camera settled in its place. */
  const drawNow = (): void => {
    cameraRig.snap();
    frameSeconds = 0;
    loop.frame(0);
  };

  const resetFlight = (height?: number): void => {
    sim.reset(height);
    toasts.clear();
    drawNow();
    overlay.refreshSoon();
  };

  const setCamera = (mode: CameraMode): void => {
    cameraRig.mode = mode;
    refreshCameraLabel();
    drawNow();
    overlay.refreshSoon();
  };

  // Flight stick setup: one question at a time, answered by moving the control. Nothing
  // flies while it is open, so the simulation is paused for as long.
  let pausedBeforeSetup = false;
  const joystickSetup = new JoystickSetupScreen(requireElement('#joystick-setup'), {
    devices: () => joystick.devices(),
    onSave: (mapping) => {
      joystick.mapping = mapping;
      const kept = saveJoystickMapping(storage, mapping);
      toasts.push(
        {
          key: 'joystick',
          text: kept
            ? 'Flight stick set up'
            : 'Flight stick set up · this browser will not remember it',
          kind: 'info',
        },
        loop.simTime,
      );
    },
    onOpenChange: (open) => {
      if (open) {
        pausedBeforeSetup = loop.paused;
        loop.paused = true;
      } else {
        loop.paused = pausedBeforeSetup;
      }
      refreshStatus();
    },
  });
  const openJoystickSetup = (): void => {
    joystickSetup.open(performance.now());
  };
  stickLabel.addEventListener('click', openJoystickSetup);
  // While the setup is open the keyboard belongs to it: no key reaches the aircraft.
  window.addEventListener(
    'keydown',
    (event) => {
      const browserKey =
        event.ctrlKey || event.metaKey || event.altKey || /^F\d+$/.test(event.code);
      if (!joystickSetup.isOpen || browserKey) {
        return;
      }
      if (joystickSetup.handleKey(event.code, performance.now())) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    },
    { capture: true },
  );

  /** Says whether a flight stick is there, and offers the setup. */
  let shownStickStatus: JoystickStatus | null = null;
  const refreshStickLabel = (): void => {
    const status = joystick.status;
    if (status === shownStickStatus) {
      return;
    }
    if (status === 'needsSetup' && shownStickStatus !== null) {
      toasts.push(
        { key: 'joystick', text: 'Flight stick found · press J to set it up', kind: 'info' },
        loop.simTime,
      );
    }
    shownStickStatus = status;
    stickLabel.textContent = joystickLabelText(status);
    stickLabel.classList.toggle('needs-setup', status === 'needsSetup');
  };

  /** Tells the pilot what the aircraft is doing and which button comes next. */
  let shownFlightStatus = '';
  const refreshFlightStatus = (): void => {
    const state = sim.state;
    const source = input.activeSource;
    const text = flightStatusText(
      state.phase,
      state.onGround,
      currentControls().mode,
      takeoffButtonName(source.id, source !== joystick || joystick.hasButton('takeoffLand')),
    );
    if (text !== shownFlightStatus) {
      shownFlightStatus = text;
      flightStatus.textContent = text;
    }
  };

  bindDebugKeys(window, {
    toggleOverlay: () => {
      overlay.toggle();
    },
    toggleStickMonitor: () => {
      stickMonitor.toggle();
    },
    nextCamera: () => {
      cameraRig.next();
      refreshCameraLabel();
      overlay.refreshSoon();
    },
    togglePause: () => {
      loop.paused = !loop.paused;
      refreshStatus();
    },
    stepOnce: () => {
      loop.advance(1);
      refreshStatus();
    },
    changeSpeed: (direction) => {
      loop.timeScale = nextTimeScale(loop.timeScale, direction);
      refreshStatus();
    },
    resetFlight: () => {
      resetFlight();
    },
    toggleSound: () => {
      audio.muted = !audio.muted;
      refreshSoundLabel();
    },
    openJoystickSetup,
    isPaused: () => loop.paused,
  });

  installTestHook({
    version: __APP_VERSION__,
    params,
    get tick() {
      return loop.tick;
    },
    get time() {
      return loop.simTime;
    },
    get paused() {
      return loop.paused;
    },
    get timeScale() {
      return loop.timeScale;
    },
    set timeScale(value: number) {
      loop.timeScale = value;
      refreshStatus();
    },
    pause: () => {
      loop.paused = true;
      refreshStatus();
    },
    resume: () => {
      loop.paused = false;
      refreshStatus();
    },
    step: (count = 1) => {
      loop.advance(count);
      drawNow();
      refreshStatus();
    },
    reset: (options) => {
      resetFlight(options?.height);
    },
    setControls: (controls: ScriptedControls | null) => {
      scripted = controls
        ? {
            ...neutralFrame(0, 'N', true),
            ...controls,
            buttons: { ...noButtonsPressed(), ...controls.buttons },
          }
        : null;
    },
    getState: () => {
      const state = sim.snapshot();
      return {
        tick: loop.tick,
        time: loop.simTime,
        ...state,
        speed: horizontalSpeed(state),
        headingDeg: headingDegrees(state.heading),
      };
    },
    getStats: () => ({
      fps: stats.fps,
      frameMs: stats.frameMs,
      maxFrameMs: stats.maxFrameMs,
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    }),
    getInput: () => ({
      source: input.activeSource.id,
      stickMode: input.settings.stickMode,
      expo: input.settings.expo,
      frame: { ...input.frame, buttons: { ...input.frame.buttons } },
      raw: { ...input.raw },
      shaped: { ...input.shaped },
    }),
    getAudio: () => audio.snapshot(),
    getJoystick: () => ({
      status: joystick.status,
      mapping: joystick.mapping,
      devices: joystick.devices().map((device) => device.id),
      setupOpen: joystickSetup.isOpen,
    }),
    setCamera,
    getCamera: () => {
      const direction = camera.getWorldDirection(new Vector3());
      const degrees = 180 / Math.PI;
      return {
        mode: cameraRig.mode,
        position: [camera.position.x, camera.position.y, camera.position.z],
        direction: [direction.x, direction.y, direction.z],
        free: {
          azimuthDeg: cameraRig.azimuth * degrees,
          elevationDeg: cameraRig.elevation * degrees,
          distance: cameraRig.distance,
        },
      };
    },
  });

  let lastFrameMs: number | null = null;
  void renderer.setAnimationLoop((timeMs: number) => {
    const elapsed = lastFrameMs === null ? 0 : (timeMs - lastFrameMs) / 1000;
    lastFrameMs = timeMs;

    stats.record(elapsed);
    input.update(timeMs);
    frameSeconds = elapsed;
    loop.frame(elapsed);
    stickMonitor.update(input);
    refreshFlightStatus();
    refreshSoundLabel();
    refreshStickLabel();
    joystickSetup.update(timeMs);
    overlay.update(elapsed, debugInfo);

    // Lets tests wait until something has really been drawn.
    document.documentElement.dataset.simReady = 'true';
  });
}

start();
