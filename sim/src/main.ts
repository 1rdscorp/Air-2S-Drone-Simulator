import './style.css';
import { ACESFilmicToneMapping, PerspectiveCamera, WebGLRenderer } from 'three';
import { createBaseScene } from './core/baseScene';

const MAX_PIXEL_RATIO = 2;

function showMessage(text: string): void {
  const message = document.querySelector<HTMLElement>('#message');
  if (message) {
    message.textContent = text;
    message.hidden = false;
  }
}

function start(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#view');
  if (!canvas) {
    throw new Error('Canvas #view is missing from index.html');
  }

  const label = document.querySelector<HTMLElement>('#build-label');
  if (label) {
    label.textContent = `Air 2S Drone Simulator · v${__APP_VERSION__}`;
  }

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true });
  } catch {
    showMessage(
      'This browser could not start 3D graphics (WebGL). ' +
        'Try a current version of Chrome or Edge with hardware acceleration switched on.',
    );
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

  // TODO(step-02): replace with the fixed 120 Hz game loop and interpolated rendering.
  let firstFrame = true;
  void renderer.setAnimationLoop((timeMs: number) => {
    marker.rotation.y = (timeMs / 1000) * 0.5;
    renderer.render(scene, camera);
    if (firstFrame) {
      firstFrame = false;
      // Lets the smoke test wait until something has really been drawn.
      document.documentElement.dataset.simReady = 'true';
    }
  });
}

start();
