import { describe, expect, it } from 'vitest';
import { FrameStats } from './frameStats';

describe('FrameStats', () => {
  it('reports zero before any frame', () => {
    const stats = new FrameStats();

    expect(stats.fps).toBe(0);
    expect(stats.frameMs).toBe(0);
    expect(stats.maxFrameMs).toBe(0);
  });

  it('measures a steady 60 Hz display', () => {
    const stats = new FrameStats();
    for (let i = 0; i < 300; i++) {
      stats.record(1 / 60);
    }

    expect(stats.fps).toBeCloseTo(60, 6);
    expect(stats.frameMs).toBeCloseTo(16.6667, 3);
    expect(stats.maxFrameMs).toBeCloseTo(16.6667, 3);
  });

  it('follows a change in frame rate once the window has passed', () => {
    const stats = new FrameStats(0.5);
    for (let i = 0; i < 120; i++) {
      stats.record(1 / 60);
    }
    for (let i = 0; i < 60; i++) {
      stats.record(1 / 30);
    }

    expect(stats.fps).toBeCloseTo(30, 6);
  });

  it('shows the slowest frame in the window', () => {
    const stats = new FrameStats(0.5);
    for (let i = 0; i < 10; i++) {
      stats.record(1 / 60);
    }
    stats.record(0.1);
    stats.record(1 / 60);

    expect(stats.maxFrameMs).toBeCloseTo(100, 6);
  });

  it('still reports a single frame that is longer than the window', () => {
    const stats = new FrameStats(0.5);
    stats.record(2);

    expect(stats.fps).toBeCloseTo(0.5, 6);
    expect(stats.maxFrameMs).toBeCloseTo(2000, 6);
  });

  it('ignores frame times that make no sense', () => {
    const stats = new FrameStats();
    stats.record(0);
    stats.record(-1);
    stats.record(Number.NaN);

    expect(stats.fps).toBe(0);
  });
});
