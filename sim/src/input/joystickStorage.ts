import { type JoystickMapping, parseMapping } from './joystickMapping';

/** Where the flight stick setup is kept in the browser. */
export const JOYSTICK_STORAGE_KEY = 'air2s-sim.joystick-mapping';

/** The part of the browser's storage that is used here. */
export type MappingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * The flight stick setup saved in this browser, or null when there is none or it cannot
 * be read. Storage can be switched off (private windows); then nothing is remembered.
 * TODO(step-34): the settings screen keeps all settings in one place.
 */
export function loadJoystickMapping(storage: MappingStorage | null): JoystickMapping | null {
  try {
    const text = storage?.getItem(JOYSTICK_STORAGE_KEY);
    return text ? parseMapping(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

/** Saves the setup. Returns false when the browser would not keep it. */
export function saveJoystickMapping(
  storage: MappingStorage | null,
  mapping: JoystickMapping,
): boolean {
  try {
    if (!storage) {
      return false;
    }
    storage.setItem(JOYSTICK_STORAGE_KEY, JSON.stringify(mapping));
    return true;
  } catch {
    return false;
  }
}

/** The browser's storage, or null where it is not available. */
export function browserStorage(): MappingStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
