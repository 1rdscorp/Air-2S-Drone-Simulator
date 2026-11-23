import './style.css';
import { ACESFilmicToneMapping, PerspectiveCamera, WebGLRenderer } from 'three';
import { placeFollowCamera } from './camera/followCamera';
import { aimSunAt, createBaseScene } from './core/baseScene';
import { FrameStats } from './core/frameStats';
import { GameLoop } from './core/gameLoop';
import { parseParams } from './core/params';
import { Simulation } from './core/simulation';
import { installTestHook, type ScriptedControls } from './core/testHook';
import { headingDegrees, horizontalSpeed } from './drone/droneState';
import { applyPose, createDroneStandIn } from './drone/standInMesh';
import { GamepadSource } from './input/gamepadSource';
import { InputManager } from './input/inputManager';
import { KeyboardSource } from './input/keyboardSource';
import { type ControlFrame, neutralFrame } from './input/types';
import { bindDebugKeys, nextTimeScale } from './ui/debugControls';
import { type DebugInfo, DebugOverlay, formatTimeScale } from './ui/debugOverlay';
import { StickMonitor } from './ui/stickMonitor';

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
  const drone = createDroneStandIn();
  scene.add(drone);

  const camera = new PerspectiveCamera(55, 1, 0.1, 5000);

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

  // Simulation and loop. The simulation only changes in `step`; `render` only reads it.
  const sim = new Simulation();
  const loop = new GameLoop({
    step: (dt) => {
      sim.step(dt, currentControls());
    },
    render: (alpha) => {
      const pose = sim.interpolate(alpha);
      applyPose(drone, pose);
      placeFollowCamera(camera, pose);
      aimSunAt(sun, pose.x, pose.y, pose.z);
      renderer.render(scene, camera);
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
      drone: {
        height: state.y,
        speed: horizontalSpeed(state),
        climbRate: state.vy,
        headingDeg: headingDegrees(state.heading),
        onGround: state.onGround,
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

  const drawNow = (): void => {
    loop.frame(0);
  };

  const resetFlight = (): void => {
    sim.reset();
    drawNow();
    overlay.refreshSoon();
  };

  bindDebugKeys(window, {
    toggleOverlay: () => {
      overlay.toggle();
    },
    toggleStickMonitor: () => {
      stickMonitor.toggle();
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
    resetFlight,
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
    reset: resetFlight,
    setControls: (controls: ScriptedControls | null) => {
      scripted = controls ? { ...neutralFrame(0, 'N', true), ...controls } : null;
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
  });

  let lastFrameMs: number | null = null;
  void renderer.setAnimationLoop((timeMs: number) => {
    const elapsed = lastFrameMs === null ? 0 : (timeMs - lastFrameMs) / 1000;
    lastFrameMs = timeMs;

    stats.record(elapsed);
    input.update(timeMs);
    loop.frame(elapsed);
    stickMonitor.update(input);
    overlay.update(elapsed, debugInfo);

    // Lets tests wait until something has really been drawn.
    document.documentElement.dataset.simReady = 'true';
  });
}

start();
