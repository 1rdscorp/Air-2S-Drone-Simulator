import './style.css';
import { ACESFilmicToneMapping, PerspectiveCamera, Vector3, WebGLRenderer } from 'three';
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
import { KeyboardSource } from './input/keyboardSource';
import { type ControlFrame, neutralFrame, noButtonsPressed } from './input/types';
import { bindDebugKeys, nextTimeScale } from './ui/debugControls';
import { type DebugInfo, DebugOverlay, formatTimeScale } from './ui/debugOverlay';
import { flightStatusText, takeoffButtonName } from './ui/flightStatus';
import { flightMessage } from './ui/flightMessages';
import { bindFreeCameraControls } from './ui/freeCameraControls';
import { Hud } from './ui/hud';
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
  const input = new InputManager([keyboard, gamepad], {
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

  // Simulation and loop. The simulation only changes in `step`; `render` only reads it.
  const sim = new Simulation({ gimbalUpward: params.gimbalUpward });
  /** Real time since the previous display frame; the chase camera eases with it. */
  let frameSeconds = 0;
  const loop = new GameLoop({
    step: (dt, tick) => {
      sim.step(dt, currentControls());
      sim.drainEvents((event) => {
        toasts.push(flightMessage(event), (tick + 1) * dt);
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

  /** Tells the pilot what the aircraft is doing and which button comes next. */
  let shownFlightStatus = '';
  const refreshFlightStatus = (): void => {
    const state = sim.state;
    const text = flightStatusText(
      state.phase,
      state.onGround,
      currentControls().mode,
      takeoffButtonName(input.activeSource.id),
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
    overlay.update(elapsed, debugInfo);

    // Lets tests wait until something has really been drawn.
    document.documentElement.dataset.simReady = 'true';
  });
}

start();
