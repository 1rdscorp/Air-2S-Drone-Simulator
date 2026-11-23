import './style.css';
import { ACESFilmicToneMapping, PerspectiveCamera, WebGLRenderer } from 'three';
import { createBaseScene } from './core/baseScene';
import { FrameStats } from './core/frameStats';
import { GameLoop } from './core/gameLoop';
import { parseParams } from './core/params';
import { Simulation } from './core/simulation';
import { installTestHook } from './core/testHook';
import { GamepadSource } from './input/gamepadSource';
import { InputManager } from './input/inputManager';
import { KeyboardSource } from './input/keyboardSource';
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

  const { scene, marker } = createBaseScene();

  const camera = new PerspectiveCamera(55, 1, 0.1, 2000);
  camera.position.set(7, 4, 9);
  camera.lookAt(0, 0.8, 0);

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
  // TODO(step-05): hand `input.frame` to the flight controller in every simulation step.
  const keyboard = new KeyboardSource();
  keyboard.attach(window);
  const gamepad = new GamepadSource(() => navigator.getGamepads());
  const input = new InputManager([keyboard, gamepad], {
    stickMode: params.stickMode,
    expo: params.expo,
  });
  const stickMonitor = new StickMonitor(requireElement('#stick-monitor'));
  stickMonitor.visible = params.sticks;

  // Simulation and loop. The simulation only changes in `step`; `render` only reads it.
  const sim = new Simulation();
  const loop = new GameLoop({
    step: (dt) => {
      sim.step(dt);
    },
    render: (alpha) => {
      marker.rotation.y = sim.interpolate(alpha).markerYaw;
      renderer.render(scene, camera);
    },
  });
  loop.paused = params.paused;
  loop.timeScale = params.speed;

  // Debug tools.
  const stats = new FrameStats();
  const overlay = new DebugOverlay(requireElement('#debug-overlay'));
  overlay.visible = params.debug;

  const debugInfo = (): DebugInfo => ({
    fps: stats.fps,
    frameMs: stats.frameMs,
    maxFrameMs: stats.maxFrameMs,
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    tick: loop.tick,
    simTime: loop.simTime,
    timeScale: loop.timeScale,
    paused: loop.paused,
    inputSource: input.activeSource.label,
    params,
  });

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
    getState: () => ({ tick: loop.tick, time: loop.simTime, ...sim.snapshot() }),
    getStats: () => {
      const info = debugInfo();
      return {
        fps: info.fps,
        frameMs: info.frameMs,
        maxFrameMs: info.maxFrameMs,
        drawCalls: info.drawCalls,
        triangles: info.triangles,
      };
    },
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
