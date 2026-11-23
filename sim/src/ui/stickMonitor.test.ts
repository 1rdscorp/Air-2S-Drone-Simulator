import { describe, expect, it } from 'vitest';
import { statusLine, stickCaption } from './stickMonitor';

describe('stickCaption', () => {
  it('names what each stick does in mode 2', () => {
    expect(stickCaption('left', 2)).toBe('Throttle · Yaw');
    expect(stickCaption('right', 2)).toBe('Pitch · Roll');
  });

  it('names what each stick does in mode 1', () => {
    expect(stickCaption('left', 1)).toBe('Pitch · Yaw');
    expect(stickCaption('right', 1)).toBe('Throttle · Roll');
  });

  it('names what each stick does in mode 3', () => {
    expect(stickCaption('left', 3)).toBe('Pitch · Roll');
    expect(stickCaption('right', 3)).toBe('Throttle · Yaw');
  });
});

describe('statusLine', () => {
  it('shows the device, the stick mode and the flight mode', () => {
    expect(statusLine('Keyboard', true, 2, 'N')).toBe('Keyboard · Stick mode 2 · Normal');
    expect(statusLine('Gamepad (Xbox)', true, 1, 'S')).toBe(
      'Gamepad (Xbox) · Stick mode 1 · Sport',
    );
    expect(statusLine('Keyboard', true, 3, 'C')).toBe('Keyboard · Stick mode 3 · Cine');
  });

  it('leaves the stick mode out for a device with its own layout', () => {
    expect(statusLine('Flight stick', true, null, 'S')).toBe('Flight stick · Sport');
    expect(statusLine('Flight stick', false, null, 'N')).toBe(
      'Flight stick (not connected) · Normal',
    );
  });

  it('says so when the device is not connected', () => {
    expect(statusLine('Gamepad', false, 2, 'N')).toBe(
      'Gamepad (not connected) · Stick mode 2 · Normal',
    );
  });
});
