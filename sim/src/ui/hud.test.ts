import { describe, expect, it } from 'vitest';
import { COMPASS_SPAN_DEG, COMPASS_WIDTH_PX, compassHomePosition, compassLabel } from './hud';

const PX_PER_DEGREE = COMPASS_WIDTH_PX / COMPASS_SPAN_DEG;

describe('compassLabel', () => {
  it('names the compass points and numbers the ticks between them', () => {
    expect(compassLabel(0)).toBe('N');
    expect(compassLabel(15)).toBe('15');
    expect(compassLabel(45)).toBe('NE');
    expect(compassLabel(90)).toBe('E');
    expect(compassLabel(180)).toBe('S');
    expect(compassLabel(255)).toBe('255');
    expect(compassLabel(270)).toBe('W');
    expect(compassLabel(315)).toBe('NW');
  });

  it('repeats beyond one turn, so the tape can slide past north', () => {
    expect(compassLabel(360)).toBe('N');
    expect(compassLabel(375)).toBe('15');
    expect(compassLabel(-15)).toBe('345');
    expect(compassLabel(-45)).toBe('NW');
  });
});

describe('compassHomePosition', () => {
  it('is under the needle when the nose points at home', () => {
    expect(compassHomePosition(120, 120)).toEqual({ offsetPx: 0, beyond: null });
  });

  it('moves right when home is to the right, left when it is to the left', () => {
    expect(compassHomePosition(100, 120).offsetPx).toBeCloseTo(20 * PX_PER_DEGREE, 9);
    expect(compassHomePosition(100, 80).offsetPx).toBeCloseTo(-20 * PX_PER_DEGREE, 9);
  });

  it('takes the short way round past north', () => {
    expect(compassHomePosition(350, 10).offsetPx).toBeCloseTo(20 * PX_PER_DEGREE, 9);
    expect(compassHomePosition(10, 350).offsetPx).toBeCloseTo(-20 * PX_PER_DEGREE, 9);
  });

  it('stops at the end of the tape and says on which side home lies', () => {
    const right = compassHomePosition(0, 90);
    const left = compassHomePosition(0, 270);

    expect(right.beyond).toBe('right');
    expect(left.beyond).toBe('left');
    expect(right.offsetPx).toBeLessThan(COMPASS_WIDTH_PX / 2);
    expect(left.offsetPx).toBe(-right.offsetPx);
  });

  it('shows home straight behind at the right-hand end', () => {
    expect(compassHomePosition(0, 180).beyond).toBe('right');
  });
});
