/** Limits a value to the range -1 to 1. Anything that is not a number becomes 0. */
export function clampAxis(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(Math.max(value, -1), 1);
}

/**
 * Deadzone: stick travel close to the centre counts as zero, so a stick that does not
 * rest exactly in the middle causes no drift. The rest of the travel is stretched to
 * still reach full deflection, and the output rises smoothly from zero at the edge of
 * the deadzone (no jump).
 *
 * @param value stick position, -1 to 1
 * @param deadzone size of the dead area, 0 to just under 1
 */
export function applyDeadzone(value: number, deadzone: number): number {
  const v = clampAxis(value);
  const d = Math.min(Math.max(deadzone, 0), 0.95);
  const size = Math.abs(v);
  if (size <= d) {
    return 0;
  }
  return Math.sign(v) * ((size - d) / (1 - d));
}

/**
 * Expo: makes the stick less sensitive around the centre for fine control, while full
 * deflection still gives full output. 0 is a straight line, 1 is a pure cubic curve.
 *
 * @param value stick position, -1 to 1
 * @param expo curve strength, 0 to 1
 */
export function applyExpo(value: number, expo: number): number {
  const v = clampAxis(value);
  const e = Math.min(Math.max(expo, 0), 1);
  return (1 - e) * v + e * v * v * v;
}

/** Deadzone first, then expo. */
export function shapeAxis(value: number, deadzone: number, expo: number): number {
  return applyExpo(applyDeadzone(value, deadzone), expo);
}
