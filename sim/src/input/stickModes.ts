import type { StickMode, StickPositions } from './types';

export type AxisFunction = 'roll' | 'pitch' | 'yaw' | 'throttle';

export const AXIS_FUNCTION_NAMES: Record<AxisFunction, string> = {
  roll: 'Roll',
  pitch: 'Pitch',
  yaw: 'Yaw',
  throttle: 'Throttle',
};

/** For each physical stick axis, the function it controls. */
export type StickLayout = Record<keyof StickPositions, AxisFunction>;

export const STICK_LAYOUTS: Record<StickMode, StickLayout> = {
  1: { leftY: 'pitch', leftX: 'yaw', rightY: 'throttle', rightX: 'roll' },
  2: { leftY: 'throttle', leftX: 'yaw', rightY: 'pitch', rightX: 'roll' },
  3: { leftY: 'pitch', leftX: 'roll', rightY: 'throttle', rightX: 'yaw' },
};

/** Turns the two physical stick positions into roll, pitch, yaw and throttle. */
export function mapSticks(sticks: StickPositions, mode: StickMode): Record<AxisFunction, number> {
  const layout = STICK_LAYOUTS[mode];
  const result: Record<AxisFunction, number> = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
  result[layout.leftX] = sticks.leftX;
  result[layout.leftY] = sticks.leftY;
  result[layout.rightX] = sticks.rightX;
  result[layout.rightY] = sticks.rightY;
  return result;
}
