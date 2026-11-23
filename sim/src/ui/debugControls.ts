/** Simulation speeds that the − and = keys step through. */
export const TIME_SCALE_PRESETS = [0.1, 0.25, 0.5, 1, 2, 4, 8] as const;

const SLOWEST_PRESET = Math.min(...TIME_SCALE_PRESETS);
const FASTEST_PRESET = Math.max(...TIME_SCALE_PRESETS);

/** The next slower (direction -1) or faster (direction 1) preset from the current speed. */
export function nextTimeScale(current: number, direction: 1 | -1): number {
  const tolerance = 1e-9;
  if (direction === 1) {
    const faster = TIME_SCALE_PRESETS.filter((preset) => preset > current + tolerance);
    return faster.length > 0 ? Math.min(...faster) : FASTEST_PRESET;
  }
  const slower = TIME_SCALE_PRESETS.filter((preset) => preset < current - tolerance);
  return slower.length > 0 ? Math.max(...slower) : SLOWEST_PRESET;
}

export interface DebugActions {
  toggleOverlay(): void;
  toggleStickMonitor(): void;
  togglePause(): void;
  /** Advance one simulation step. Only called while paused. */
  stepOnce(): void;
  changeSpeed(direction: 1 | -1): void;
  isPaused(): boolean;
}

/**
 * Keyboard shortcuts for the debug tools. Keys are matched by position on the keyboard
 * (`event.code`), so they are the same on every keyboard layout.
 *
 *   ` or F2   show / hide the overlay
 *   I         show / hide the stick monitor
 *   P         pause / resume
 *   .         one step forward (while paused; hold to keep stepping)
 *   − and =   slower / faster
 *
 * @returns a function that removes the shortcuts again
 */
export function bindDebugKeys(target: Window, actions: DebugActions): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const element = event.target;
    if (
      element instanceof HTMLElement &&
      (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName))
    ) {
      return;
    }

    switch (event.code) {
      case 'Backquote':
      case 'F2':
        if (!event.repeat) {
          actions.toggleOverlay();
        }
        break;
      case 'KeyI':
        if (!event.repeat) {
          actions.toggleStickMonitor();
        }
        break;
      case 'KeyP':
        if (!event.repeat) {
          actions.togglePause();
        }
        break;
      case 'Period':
        if (actions.isPaused()) {
          actions.stepOnce();
        }
        break;
      case 'Minus':
      case 'NumpadSubtract':
        actions.changeSpeed(-1);
        break;
      case 'Equal':
      case 'NumpadAdd':
        actions.changeSpeed(1);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  target.addEventListener('keydown', onKeyDown);
  return () => {
    target.removeEventListener('keydown', onKeyDown);
  };
}
