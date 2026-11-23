import type { CameraRig } from '../camera/cameraRig';

/** How far the free camera turns per pixel of mouse movement, in radians. */
const TURN_PER_PIXEL = 0.006;
/** How much one notch of the mouse wheel changes the distance. */
const ZOOM_PER_WHEEL_UNIT = 0.0012;

/**
 * Lets the mouse (or a finger) move the free camera: drag to look around the aircraft,
 * scroll to move closer or further away. In the other views the mouse does nothing.
 *
 * @returns a function that removes the handlers again
 */
export function bindFreeCameraControls(canvas: HTMLCanvasElement, rig: CameraRig): () => void {
  let draggingPointer: number | null = null;
  let lastX = 0;
  let lastY = 0;

  const onPointerDown = (event: PointerEvent): void => {
    if (rig.mode !== 'free' || event.button !== 0) {
      return;
    }
    draggingPointer = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('is-dragging');
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== draggingPointer || rig.mode !== 'free') {
      return;
    }
    // Dragging right turns the scene to the right; dragging down looks from higher up.
    rig.orbit(-(event.clientX - lastX) * TURN_PER_PIXEL, (event.clientY - lastY) * TURN_PER_PIXEL);
    lastX = event.clientX;
    lastY = event.clientY;
  };

  const stopDragging = (event: PointerEvent): void => {
    if (event.pointerId === draggingPointer) {
      draggingPointer = null;
      canvas.classList.remove('is-dragging');
    }
  };

  const onWheel = (event: WheelEvent): void => {
    if (rig.mode !== 'free') {
      return;
    }
    event.preventDefault(); // do not scroll or zoom the page
    rig.zoom(Math.exp(event.deltaY * ZOOM_PER_WHEEL_UNIT));
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', stopDragging);
  canvas.addEventListener('pointercancel', stopDragging);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', stopDragging);
    canvas.removeEventListener('pointercancel', stopDragging);
    canvas.removeEventListener('wheel', onWheel);
  };
}
